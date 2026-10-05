import { withEncounterRoom, currentEncounterRoom, withFight } from "@/lib/spatial/publication-scope.mjs";
import { fightCrossing, fightForCall } from "@/lib/dm/fight-presence";
import { spatialEnabled, spatialStore, spatialContext } from "@/lib/spatial/service";
import { getSheetById } from "@/lib/db/sheets";
// The adjudication façade: one entry point into the rules engine, for both
// the AI DM and a person running the table.
//
// ODM's server has always been the rules engine; the AI DM is a voice and a
// tool caller sitting on top of it (see src/lib/dm/engine-boundary.ts,
// "The server is the rules engine and you are its voice"). Human-DM mode is
// therefore not a second game system, it is a second caller. This module is
// where that becomes literal: `invokeEngine` takes an actor and a named
// adjudication, and reaches exactly the handlers turn.ts reaches.
//
// The per-turn caps the AI works under (MUTATION_CAP_PER_TURN and friends)
// are rails on a model that might loop, not rules of the game, so they do
// not apply to a person. Saying that here, once, is better than the two
// paths quietly differing.
import { getCampaignById, getFloor, type Campaign } from "@/lib/db/campaigns";
import { createDmTurn, getDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { listMembers } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { adjudication, checkArgs, type CatalogEntry } from "@/lib/dm/invoke-catalog";
import { ASYNC_ADJUDICATIONS, dispatchAdjudication, dispatchSynchronousAdjudication } from "@/lib/dm/invoke-dispatch";
import { executeDmTool } from "@/lib/dm/tool-transaction";
import { scopedHumanTurn } from "@/lib/db/human-adjudication-scopes";
import { getActiveEncounter } from "@/lib/db/encounters";
import { combatHandoffState, finishHumanAdjudication } from "@/lib/dm/human-turn-lifecycle";
import { parseCompleteTurn, combatCompletionDisposition, type CombatTurnKey } from "@/lib/dm/combat-completion";
import { currentOperationSignal } from "@/lib/operation-scope.mjs";
// "goblin x4" is the same shorthand a prepared encounter is saved in, so the
// live form and the saved roster share one parser.
import { parseRoster } from "@/lib/dm/encounter-template-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type Actor =
  | { kind: "ai"; turnId: string }
  | { kind: "human"; userId: string };

export type Adjudication = { name: string; args: Record<string, unknown> };

export type InvokeOutcome =
  | { ok: true; result: Record<string, unknown>; turnId: string }
  | { ok: false; error: string };

// Arguments a form produces are not quite arguments a tool call produces.
// A person types "goblin x3" where the model sends an array, and a comma
// separated list where it sends one. Normalizing here keeps the console
// simple and the handlers untouched.
const LIST_FIELDS = new Set([
  "characterIds",
  "enemyIds",
  "targetCharacterIds",
  "connections",
  "replyToWhisperIds",
]);

function toList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

// "enemy:goblin-1 half" / "character:<id> double" / "goblin-2" -> what
// split_damage expects. A line with no share takes the full total, which is
// the common case and the one worth typing least for.
function toDamageTargets(
  value: unknown,
): Array<{ enemyId?: string; characterId?: string; share: string }> {
  if (Array.isArray(value)) {
    return value as Array<{ enemyId?: string; characterId?: string; share: string }>;
  }
  if (typeof value !== "string") {
    return [];
  }
  const rows: Array<{ enemyId?: string; characterId?: string; share: string }> = [];
  for (const line of value.split(/[\n;]/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const parts = text.split(/\s+/);
    const share = ["none", "half", "full", "double"].includes(
      (parts[parts.length - 1] ?? "").toLowerCase(),
    )
      ? (parts.pop() as string).toLowerCase()
      : "full";
    const ref = parts.join(" ");
    const asCharacter = /^character:/i.test(ref);
    const id = ref.replace(/^(enemy|character):/i, "").trim();
    if (!id) {
      continue;
    }
    rows.push(asCharacter ? { characterId: id, share } : { enemyId: id, share });
  }
  return rows;
}

export function normalizeArgs(
  entry: CatalogEntry,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (key === "enemies") {
      // A model/external narrator sends the rich engine shape:
      // { monster, name, count, cr }. parseRoster is only the human-console
      // shorthand parser and intentionally knows only monster/count; running
      // an already-structured array through it used to erase the in-world
      // name and CR before start_encounter saw them, so "Barmaid" backed by a
      // Rogue stat block appeared in combat as "Rogue".
      out.enemies = Array.isArray(value) ? value : parseRoster(value);
      continue;
    }
    if (key === "targets" && entry.name === "split_damage") {
      out.targets = toDamageTargets(value);
      continue;
    }
    if (LIST_FIELDS.has(key)) {
      out[key] = toList(value);
      continue;
    }
    out[key] = value;
  }
  // The console asks for one modifier as three flat fields, because a form
  // that built an array of objects would be a worse form. The handler takes
  // the array the model sends, so the shapes meet here rather than in either
  // of them (src/lib/dm/effect-tools.ts).
  if (entry.name === "set_effect" && !out.modifiers && typeof out.field === "string") {
    out.modifiers = [
      { field: out.field, mode: out.mode ?? "add", ...(out.value === undefined ? {} : { value: out.value }) },
    ];
    delete out.field;
    delete out.mode;
    delete out.value;
  }
  // A single-character form still has to satisfy handlers that take a list.
  if (
    entry.fields.some((field) => field.name === "characterIds") &&
    !out.characterIds &&
    typeof out.characterId === "string"
  ) {
    out.characterIds = [out.characterId];
  }
  // External callers historically supplied both enemyId and targetEnemyId for
  // pc_attack. Keep that façade contract while accepting the canonical target
  // from older callers and filling the compatibility alias deterministically.
  if (entry.name === "pc_attack" && out.targetEnemyId && !out.enemyId) {
    out.enemyId = out.targetEnemyId;
  }
  if (entry.name === "pet_attack" && !out.targetEnemyId && out.enemyId) out.targetEnemyId = out.enemyId;
  if (entry.name === "use_spell_slot" && !out.spell && out.name) out.spell = out.name;
  if (entry.name === "summon_pet" && typeof out.attacks === "string") {
    try { out.attacks = JSON.parse(out.attacks); } catch { /* The handler rejects invalid arrays. */ }
  }
  return out;
}

// Players who roll physical dice at the table. Their rolls park for them to
// enter rather than being rolled by the server, for a human DM exactly as
// for the AI one.
function realDiceUsers(campaign: Campaign): Set<string> {
  if (campaign.gameSettings.dicePolicy !== "real_allowed") {
    return new Set();
  }
  return new Set(
    listMembers(campaign.id)
      .filter((member) => member.useRealDice)
      .map((member) => member.userId),
  );
}

// Reuse combat bookkeeping by an explicit encounter/round/position key, not
// by "most recent turn". Pending physical rolls still attach to their own turn.
function humanTurnFor(campaignId: string): DmTurn {
  const pending = listOpenPendingRolls(campaignId)
    .map((roll) => getDmTurn(roll.turnId))
    .find((turn): turn is DmTurn => !!turn && turn.actor === "human_dm" && turn.status === "awaiting_rolls");
  const encounter = getActiveEncounter(campaignId);
  if (encounter?.orderReady) {
    return scopedHumanTurn(campaignId, `${encounter.id}:${encounter.round}:${encounter.turnIndex}`, pending);
  }
  return pending ?? createDmTurn(campaignId, [], "human_dm");
}

function currentPcTurnKey(campaignId: string): CombatTurnKey | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter?.orderReady) return null;
  const current = encounter.order[encounter.turnIndex];
  if (current?.kind !== "pc") return null;
  return { encounterId: encounter.id, round: encounter.round,
    turnIndex: encounter.turnIndex, characterId: current.characterId };
}

/** Deterministic entry point used by external commands. No await is permitted
 * between the first mutation and commit; returned refusals roll back too.
 */
function invokeInRoom(campaign: Campaign, actor: Actor, call: Adjudication): InvokeOutcome {
  if (call.name === "combat_turn") return invokeCombatTurn(campaign, actor, call.args);
  const entry = adjudication(call.name);
  if (!entry) return { ok: false, error: `Unknown action "${call.name}".` };
  if (ASYNC_ADJUDICATIONS.has(entry.name)) return { ok: false, error: "This action requires the asynchronous operator path." };
  const completion = parseCompleteTurn(entry.name, call.args?.completeTurn, actor.kind);
  if (!completion.ok) return completion;
  const args = normalizeArgs(entry, call.args ?? {});
  const complaint = checkArgs(entry, args);
  if (complaint) return { ok: false, error: complaint };
  // A façade option, not an argument to the attack/rules handler itself.
  delete args.completeTurn;
  try {
    currentOperationSignal()?.throwIfAborted();
    return executeDmTool<InvokeOutcome>([campaign], () => {
      currentOperationSignal()?.throwIfAborted();
      const anchor = completion.requested ? currentPcTurnKey(campaign.id) : null;
      if (completion.requested) {
        const floor = getFloor(campaign.id);
        const initiative = floor.mode === "hold" ? floor.next : floor;
        const actorId = entry.name === "heal" ? args.casterId ?? args.characterId : args.characterId;
        if (!anchor || anchor.characterId !== actorId || initiative.mode !== "initiative" ||
            initiative.encounterId !== anchor.encounterId || initiative.round !== anchor.round ||
            listOpenPendingRolls(campaign.id).length) {
          return { ok: false, error: "completeTurn requires this character's current initiative turn with no outstanding roll." };
        }
      }
      const turn = actor.kind === "ai" ? getDmTurn(actor.turnId) : humanTurnFor(campaign.id);
      if (!turn || turn.campaignId !== campaign.id) return { ok: false, error: "That DM turn no longer exists in this campaign." };
      // A fight never reaches a character standing somewhere else.
      const crossing = fightCrossing(campaign.id, getActiveEncounter(campaign.id), entry, args);
      if (crossing) return { ok: false, error: crossing };
      const activeRoom = currentEncounterRoom(campaign.id);
        const sheets = listSheets(campaign.id).filter(sheet => !activeRoom || spatialStore().getUserRoom(campaign.id, sheet.userId) === activeRoom);
      const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
      return executeDmTool<InvokeOutcome>([turn, sheets, sheetsById], () => {
        if (actor.kind === "human") turn.status = "running";
        const result = dispatchSynchronousAdjudication(entry.name, JSON.stringify(args), {
          campaign, turn, sheets, sheetsById, realDiceUserIds: realDiceUsers(campaign),
        });
        if (!result || typeof result !== "object" || typeof result.then === "function") throw new Error("Expected a synchronous adjudication result.");
        if ("error" in result) return { ok: false, error: typeof result.error === "string" ? result.error : JSON.stringify(result.error) ?? "The engine refused this action." };
        if (actor.kind === "human") {
          finishHumanAdjudication(campaign, turn, entry.name);
          if (entry.name === "end_turn") {
            const handoff = combatHandoffState(campaign.id);
            result.note = handoff.state === "none"
              ? "Initiative advancement committed; the next actor is announced."
              : "Turn resolved, initiative NOT moved: the table is nobody's until you hand it over. Play the enemies that act before the next hero now, post every narration message for this turn, and send the last one with passTurn:true (or call release_floor).";
            result.turnHandoff = handoff.state === "none" ? "advanced" : "awaiting_pass";
          }
          if (completion.requested && anchor) {
            const disposition = combatCompletionDisposition(anchor, currentPcTurnKey(campaign.id), listOpenPendingRolls(campaign.id).length);
            if (disposition === "complete") {
              // Reuse the existing scoped end_turn path under this same outer
              // command/receipt. No extra LLM decision and no duplicate rules.
              // A failed finalizer rolls back only its nested transaction: the
              // confirmed attack is returned and MUST NOT be rolled again.
              const ended = invokeEngineSynchronous(campaign, actor, {
                name: "end_turn", args: { characterId: anchor.characterId },
              });
              result.turnCompletion = ended.ok
                ? { status: "completed", result: ended.result }
                : { status: "blocked", error: ended.error };
            } else {
              // Physical dice keep their existing continuation; an attack
              // that changed/ended the encounter must not end the NEW actor.
              result.turnCompletion = { status: disposition };
            }
          }
        }
        else saveDmTurn(turn);
        return { ok: true, result, turnId: turn.id };
      });
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The engine could not resolve that." };
  }
}

// One receipt, one model decision for a compound turn. A refused later step
// does not roll back or repeat an earlier confirmed attack.
function invokeCombatTurn(campaign: Campaign, actor: Actor, args: Record<string, unknown>): InvokeOutcome {
  if (actor.kind !== "human") return { ok: false, error: "combat_turn requires external/human adjudication." };
  const anchor = currentPcTurnKey(campaign.id);
  const floor = getFloor(campaign.id);
  const initiative = floor.mode === "hold" ? floor.next : floor;
  if (!anchor || anchor.characterId !== args.characterId || initiative.mode !== "initiative" ||
      initiative.encounterId !== anchor.encounterId || initiative.round !== anchor.round || listOpenPendingRolls(campaign.id).length) {
    return { ok: false, error: "combat_turn requires the current actor with no pending roll." };
  }
  let steps = args.steps;
  if (typeof steps === "string") { try { steps = JSON.parse(steps); } catch { return { ok: false, error: "steps must be a JSON array." }; } }
  if (!Array.isArray(steps) || !steps.length || steps.length > 8) return { ok: false, error: "Provide 1–8 declared steps." };
  const allowed = new Set(["pc_attack", "cast_at_enemy", "cast_buff", "heal", "pet_attack", "take_action", "use_item", "use_resource"]);
  const calls: Adjudication[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || !allowed.has(step.name) || !step.args || typeof step.args !== "object" || Array.isArray(step.args)) {
      return { ok: false, error: "Each step needs a supported name and args object." };
    }
    const field = step.name === "heal" ? "casterId" : "characterId";
    if ((step.args[field] !== undefined && step.args[field] !== anchor.characterId) || step.args.completeTurn !== undefined) {
      return { ok: false, error: "Every step belongs to the current actor; only the bundle ends the turn." };
    }
    calls.push({ name: step.name, args: { ...step.args, [field]: anchor.characterId } });
  }
  return executeDmTool<InvokeOutcome>([campaign], () => {
    const results: Array<{ index: number; name: string; result: Record<string, unknown> }> = [];
    let turnId = "";
    for (const [index, step] of calls.entries()) {
      const disposition = combatCompletionDisposition(anchor, currentPcTurnKey(campaign.id), listOpenPendingRolls(campaign.id).length);
      if (disposition !== "complete") return { ok: true, turnId, result: { steps: results, nextStep: index, status: disposition } };
      const outcome = invokeEngineSynchronous(campaign, actor, step);
      if (!outcome.ok) return results.length
        ? { ok: true, turnId, result: { steps: results, nextStep: index, status: "blocked", failure: { message: outcome.error }, note: "Earlier steps committed. Do not repeat them." } }
        : outcome;
      turnId = outcome.turnId;
      results.push({ index, name: step.name, result: outcome.result });
    }
    const disposition = combatCompletionDisposition(anchor, currentPcTurnKey(campaign.id), listOpenPendingRolls(campaign.id).length);
    if (disposition !== "complete") return { ok: true, turnId, result: { steps: results, nextStep: calls.length, status: disposition } };
    const ended = invokeEngineSynchronous(campaign, actor, { name: "end_turn", args: { characterId: anchor.characterId } });
    return { ok: true, turnId, result: { steps: results, nextStep: calls.length,
      status: ended.ok ? "completed" : "blocked", turnCompletion: ended.ok ? ended.result : { error: ended.error } } };
  });
}

export async function invokeEngine(
  campaign: Campaign,
  actor: Actor,
  call: Adjudication,
): Promise<InvokeOutcome> {
  if (!ASYNC_ADJUDICATIONS.has(call.name)) return invokeEngineSynchronous(campaign, actor, call);
  // Model/retrieval operations are intentionally outside a synchronous SQL
  // transaction. They are not admitted by the external narrator allowlist.
  const entry = adjudication(call.name);
  if (!entry) {
    return { ok: false, error: `Unknown action "${call.name}".` };
  }
  const args = normalizeArgs(entry, call.args ?? {});
  const complaint = checkArgs(entry, args);
  if (complaint) {
    return { ok: false, error: complaint };
  }

  const turn =
    actor.kind === "ai" ? getDmTurn(actor.turnId) : humanTurnFor(campaign.id);
  if (!turn) {
    return { ok: false, error: "That DM turn no longer exists." };
  }

  const sheets: CharacterSheet[] = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

  let result: Record<string, unknown>;
  try {
    result = await dispatchAdjudication(entry.name, JSON.stringify(args), {
      campaign,
      turn,
      sheets,
      sheetsById,
      realDiceUserIds: realDiceUsers(campaign),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The engine could not resolve that.",
    };
  }

  // The handlers mutate the turn as they run (which enemies have acted, which
  // characters were resolved), and that bookkeeping is what stops an enemy
  // swinging twice. The AI's own turn loop saves its turn itself; a turn
  // reached through this façade has no loop behind it, so it is saved here or
  // the mutations are simply lost.
  //
  // Only a person's turn is closed here. A delegated AI turn may still have
  // more adjudications to come on it, so its caller decides when it is done.
  if (actor.kind === "human") {
    // A parked roll keeps the turn open so the answer lands on it; anything
    // else is finished the moment it resolves.
    const parked = listOpenPendingRolls(campaign.id).some(
      (pending) => pending.turnId === turn.id,
    );
    turn.status = parked ? "awaiting_rolls" : "done";
  }
  saveDmTurn(turn);

  if (typeof result.error === "string") {
    return { ok: false, error: result.error };
  }
  return { ok: true, result, turnId: turn.id };
}

// The counterpart to resumeDmTurn for a turn a person opened. There is no
// model to hand the answer back to: the rolls already published themselves
// and applied whatever they applied, so all that is left is to close the
// turn so the next adjudication starts a fresh one.
export function resumeHumanTurn(turnId: string): boolean {
  const turn = getDmTurn(turnId);
  if (!turn || turn.actor !== "human_dm" || turn.status !== "awaiting_rolls") {
    return false;
  }
  turn.status = "done";
  saveDmTurn(turn);
  return true;
}

// Convenience for routes that already have only the id.
export async function invokeEngineById(
  campaignId: string,
  actor: Actor,
  call: Adjudication,
): Promise<InvokeOutcome> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return { ok: false, error: "Campaign not found." };
  }
  return invokeEngine(campaign, actor, call);
}

export function invokeEngineSynchronous(campaign: Campaign, actor: Actor, call: Adjudication): InvokeOutcome {
  // Messages use their recipients, never a combat/room scope or action budget.
  if (call.name === "send_whisper" || call.name === "send_ooc") {
    return withEncounterRoom(campaign.id, undefined, () => withFight(campaign.id, null, () => invokeInRoom(campaign, actor, call)));
  }
  if (!spatialEnabled(campaign.id)) {
    // Without rooms several fights can run at once, one per place: run the
    // call in the fight it is about (src/lib/dm/fight-presence.ts).
    const entry = call.name === "combat_turn" ? { name: "combat_turn", needsEncounter: true } : adjudication(call.name);
    const scope = fightForCall(campaign.id, entry ?? { name: call.name }, call.args ?? {});
    if ("error" in scope) return { ok: false, error: scope.error };
    // locationId only picked the fight; a tool that takes no place never sees it.
    const takesPlace = Boolean(entry && "fields" in entry && entry.fields.some((field) => field.name === "locationId"));
    const scoped: Adjudication = !takesPlace && call.args && "locationId" in call.args
      ? { ...call, args: Object.fromEntries(Object.entries(call.args).filter(([key]) => key !== "locationId")) }
      : call;
    return scope.fightId === undefined
      ? invokeInRoom(campaign, actor, scoped)
      : withFight(campaign.id, scope.fightId, () => invokeInRoom(campaign, actor, scoped));
  }
  const args = call.args ?? {};
  const character = typeof args.characterId === "string" ? getSheetById(args.characterId) : null;
  const roomId = typeof args.roomId === "string" ? args.roomId
    : character?.campaignId === campaign.id ? spatialStore().getUserRoom(campaign.id, character.userId)
      : getActiveEncounter(campaign.id)?.roomId;
  if (!roomId) return { ok: false, error: "Specify the spatial roomId for this action." };
  const userId = actor.kind === "human" ? actor.userId : campaign.dmUserId;
  if (!userId) return { ok: false, error: "A DM seat is required." };
  const { actor: viewer } = spatialContext(campaign.id, userId);
  const rooms = spatialStore().view(viewer);
  if (!rooms.enabled || !rooms.rooms.some(room => room.id === roomId)) return { ok: false, error: "Unknown or inaccessible roomId." };
  return withEncounterRoom(campaign.id, roomId, () => invokeInRoom(campaign, actor, call));
}
