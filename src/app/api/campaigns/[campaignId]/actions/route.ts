import { getDatabase, nowIso } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { spatialEnabled, spatialStore, runSpatialCommand, SpatialError } from "@/lib/spatial/service";
import { localeText } from "@/lib/i18n/locale-text";
import { z } from "zod";
import { enforcePlayerIngress } from "@/lib/ingress-budget";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import {
  allocateSeq,
  canAct,
  getFloor,
  getGlobalTurnState,
  listMembers,
  setFloor,
  type Floor,
} from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { publishOocMessage, publishPersisted, publishWithSeq } from "@/lib/events";
import { recordGlobalTurnAction, resolveGlobalTurn } from "@/lib/dm/global-turn-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { inTeamRoundFight, teamRoundFight } from "@/lib/dm/team-round";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/action-tools";
import { combatSpellNames, validateCombatTurnIntent, type CombatSpellDescriptor } from "@/lib/dm/combat-turn-intent";
import { findSpellByName, spellMechanicsFor } from "@/lib/content";
import { authoredSpellRow } from "@/lib/srd/spell-mechanics";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function spellsFor(sheet: CharacterSheet): CombatSpellDescriptor[] {
  return combatSpellNames(sheet).map(name => {
    const entry = findSpellByName(name, sheet.userId);
    const authored = authoredSpellRow(name);
    const mechanics = spellMechanicsFor({ spell: name, userId: sheet.userId });
    const time = String(entry?.data.casting_time ?? authored?.casting_time ?? "").toLowerCase();
    const range = String(entry?.data.range ?? authored?.range ?? "");
    const areaTarget = /\b(cone|cube|line|sphere|cylinder|radius|hemisphere|wall)\b/i.test(range);
    const target = areaTarget ? null
      : mechanics?.mech.resolution === "attack" || mechanics?.mech.resolution === "save" || mechanics?.mech.resolution === "auto" ? "enemy"
      : mechanics?.mech.resolution === "heal" ? "ally"
      : mechanics?.mech.resolution === "buff" && mechanics.mech.buff?.target === "self" ? "self"
      : mechanics?.mech.resolution === "buff" && mechanics.mech.buff?.target === "ally" && !mechanics.mech.buff.variants ? "ally"
      : null;
    const cost: CombatSpellDescriptor["cost"] = /^1 bonus action/.test(time) ? "bonus" : /^1 reaction/.test(time) ? "reaction" : /^1 action/.test(time) ? "action" : null;
    const targetType: CombatSpellDescriptor["target"] = target;
    return { type: "spell" as const, name, level: entry?.level ?? authored?.level ?? null, cost, target: targetType };
  }).filter(spell => spell.target !== null && spell.level !== null && spell.cost !== null && spell.cost !== "reaction");
}

// Only the member's own spell list. The POST derives the same metadata afresh;
// neither casting times nor spell levels are accepted from the client.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  const sheet = getSheetForUser(campaignId, context.user.id);
  return Response.json({ spells: sheet ? spellsFor(sheet) : [] });
}

const actionSchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  kind: z.enum(["do", "ooc"]).default("do"),
  combatTurn: z.object({
    encounterId: z.string().uuid(),
    round: z.number().int().min(1),
    turnIndex: z.number().int().min(0),
    description: z.string().trim().min(1).max(2000).optional(),
    choices: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("attack"), targetEnemyId: z.string().uuid().optional(), targetCharacterId: z.string().uuid().optional(), weapon: z.string().trim().min(1).max(80), sneakAttack: z.boolean().optional() }),
      z.object({ type: z.literal("dodge") }),
      z.object({ type: z.literal("action"), action: z.enum(["dash", "disengage", "hide", "help", "grapple", "shove"]), targetEnemyId: z.string().uuid().optional(), targetCharacterId: z.string().uuid().optional(), cunningAction: z.boolean().optional() }).strict(),
      z.object({ type: z.literal("pet"), petName: z.string().trim().min(1).max(60), attack: z.string().trim().min(1).max(40), targetEnemyId: z.string().uuid() }),
      z.object({ type: z.literal("pet_order"), petName: z.string().trim().min(1).max(60), order: z.string().trim().min(1).max(500) }),
      z.object({ type: z.literal("spell"), spell: z.string().trim().min(1).max(80), slotLevel: z.number().int().min(1).max(9).optional(), targetId: z.string().uuid() }),
      z.object({ type: z.literal("feature"), feature: z.string().trim().min(1).max(120), targetId: z.string().uuid().optional() }),
      z.object({ type: z.literal("resource"), resource: z.string().trim().min(1).max(80), targetCharacterId: z.string().uuid().optional() }),
      z.object({ type: z.literal("item"), item: z.string().trim().min(1).max(80), targetCharacterId: z.string().uuid() }),
    ])).max(12),
  }).strict().refine(value => !value.description || value.choices.length > 0, "Choose an action before adding a description.").optional(),
}).strict()
  .refine((value) => Boolean(value.content || value.combatTurn), "An action needs content or a combat turn.")
  .refine((value) => !value.combatTurn || value.kind === "do", "Combat turns must be actions.")
  .refine((value) => !value.combatTurn || !value.content, "Combat turns cannot contain free-form action text.");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  const locale = /(?:^|;\s*)odm_locale=(ru|en)(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1]
    ?? campaign.gameSettings.language ?? "ru";
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  const limited = enforcePlayerIngress(campaignId, user.id, "action");
  if (limited) return limited;
  const { kind } = parsed.data;
  const sheet = getSheetForUser(campaignId, user.id);
  if (kind === "ooc" && !spatialEnabled(campaignId)) {
    const messageId = crypto.randomUUID();
    publishOocMessage(campaignId, {
      id: messageId,
      campaignId,
      seq: 0,
      authorType: "player",
      userId: user.id,
      characterId: sheet?.id ?? null,
      content: `(ooc) ${parsed.data.content!}`,
      kind: "ooc",
      authorUserId: user.id,
      roomId: null,
      createdAt: nowIso(),
    });
    return Response.json({ messageId }, { status: 202 });
  }
  // OOC without a character has already returned through the legacy or
  // spatial OOC path above; every remaining action needs its character sheet.
  if (!sheet) {
    return Response.json({ error: "You need a character to act." }, { status: 400 });
  }

  const member = listMembers(campaignId).find((entry) => entry.userId === user.id);
  if (kind !== "ooc" && member?.autopilot) {
    return Response.json(
      { error: localeText(locale === "ru" ? "ru" : "en", {
        ru: "Автопилот управляет этим персонажем. Отключите его, чтобы действовать вручную.",
        en: "Autopilot controls this character. Turn it off to act manually.",
      }) },
      { status: 409 },
    );
  }
  const spatial = spatialEnabled(campaignId);
  const roomId = spatial ? spatialStore().getUserRoom(campaignId, user.id) : undefined;
  // A fight only part of the party is in gates only the heroes standing at
  // it. Everyone else plays the team round as if there were no fight: their
  // floor is open and the global turn paces them (src/lib/dm/team-round.ts).
  const fight = getActiveEncounter(campaignId, roomId);
  const teamFight = spatial ? null : teamRoundFight(campaignId);
  const outsideFight = Boolean(fight && teamFight?.id === fight.id && !inTeamRoundFight(campaignId, fight, sheet));
  const encounter = outsideFight ? null : fight;

  // Global-turn collection is a hard server gate, not just a disabled UI.
  // Before global_turn_started and after global_turn_ready, no player composer
  // input is accepted or allowed to mutate floor/quorum state.
  if (
    !encounter &&
    campaign.gameSettings?.globalTurn?.enabled &&
    kind !== "ooc"
  ) {
    const globalTurn = getGlobalTurnState(campaignId);
    if (globalTurn.phase === "waiting") {
      return Response.json(
        { error: "The next round has not started yet." },
        { status: 409 },
      );
    }
    if (globalTurn.phase === "ready" || globalTurn.phase === "resolving") {
      return Response.json(
        { error: "The MCP Dungeon Master is resolving this round." },
        { status: 409 },
      );
    }
  }

  if (spatial && kind === "ooc") {
    try {
      const result = runSpatialCommand(campaignId, user.id, {
        operation: "send", requestId: crypto.randomUUID(), kind: "ooc", content: parsed.data.content,
      });
      return Response.json({ messageId: (result.message as { id: string }).id }, { status: 202 });
    } catch (error) {
      if (error instanceof SpatialError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  // Floor control: during a spotlight only the named players may act (ooc is
  // always allowed); the floor releases once ALL of them have answered.
  // During a hold nobody may act until the lead releases. This read-modify-
  // write must stay await-free so it is atomic in Node.
  const floor: Floor = outsideFight ? { mode: "open" } : getFloor(campaignId, roomId);
  if (!canAct(floor, user.id, kind)) {
    if (floor.mode === "hold") {
      return Response.json(
        {
          error: "The party lead has not opened responses yet. Use OOC for table talk.",
          floor,
        },
        { status: 409 },
      );
    }
    if (floor.mode === "initiative") {
      return Response.json(
        {
          error: `It is ${floor.currentName || "another character"}'s turn in the initiative order. Use OOC for table talk.`,
          floor,
        },
        { status: 409 },
      );
    }
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter(
              (entry) =>
                floor.userIds.includes(entry.userId) &&
                !floor.respondedUserIds.includes(entry.userId),
            )
            .map((entry) => entry.name)
            .join(", ")
        : "";
    return Response.json(
      {
        error: waitingOn
          ? `The DM is waiting on ${waitingOn}. Use OOC for table talk.`
          : "It is not your moment to act.",
        floor,
      },
      { status: 409 },
    );
  }
  if (kind !== "ooc" && encounter) {
    const actor = encounter.order[encounter.turnIndex];
    if (!encounter.orderReady || floor.mode !== "initiative" || actor?.kind !== "pc" || actor.characterId !== sheet.id || listOpenPendingRolls(campaignId).some(roll => !spatial || spatialStore().getUserRoom(campaignId, roll.userId) === roomId)) {
      return Response.json({ error: "Wait for your combat turn and pending rolls. OOC remains available." }, { status: 409 });
    }
    if (!parsed.data.combatTurn) {
      return Response.json({ error: "Use the combat action builder to submit a complete turn." }, { status: 400 });
    }
  }
  let combatContent: string | null = null;
  let combatGate: Extract<Floor, { mode: "hold" }>["combat"] | undefined;
  if (parsed.data.combatTurn) {
    const intent = parsed.data.combatTurn;
    if (kind !== "do" || floor.mode !== "initiative" || !encounter || !encounter.orderReady ||
      intent.encounterId !== encounter.id || intent.round !== encounter.round || intent.turnIndex !== encounter.turnIndex) {
      return Response.json({ error: "This combat turn is stale. Refresh the encounter." }, { status: 409 });
    }
    const current = encounter.order[encounter.turnIndex];
    if (!current || current.kind !== "pc" || current.characterId !== sheet.id) {
      return Response.json({ error: "It is not your initiative turn." }, { status: 409 });
    }
    const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
    if (!budget) return Response.json({ error: "This combat turn is no longer available." }, { status: 409 });
    const publicEncounter = activePublicEncounter(campaignId, { viewerUserId: user.id, roomId });
    const visibleCharacters = new Set(publicEncounter?.order.filter(entry => entry.kind === "pc").map(entry => entry.id));
    const allies = listSheets(campaignId).filter(entry => !entry.deathSaves?.dead && visibleCharacters.has(entry.id));
    const visibleEnemies = publicEncounter?.enemies.filter((enemy) => enemy.status === "alive") ?? [];
    const result = validateCombatTurnIntent(intent, sheet, new Set(visibleEnemies.map((enemy) => enemy.id)), new Set(allies.map((entry) => entry.id)), budget, {
      language: campaign.gameSettings.language ?? "ru",
      names: new Map([...allies, ...visibleEnemies].map((entry) => [entry.id, entry.name])),
      spells: spellsFor(sheet), friendlyFire: campaign.gameSettings.friendlyFire,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    combatContent = result.content;
    combatGate = { encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex, characterId: sheet.id, requiresEndTurn: true, mechanicsResolved: false };
  }
  if (spatial) {
    if (!parsed.data.combatTurn) return Response.json({ error: "Choose a location and send through location-chat." }, { status: 409 });
    try {
      const result = runSpatialCommand(campaignId, user.id, {
        operation: "send", requestId: crypto.randomUUID(), kind: "do", content: combatContent,
        completeTurn: true,
      });
      return Response.json({ messageId: (result.message as { id: string }).id }, { status: 202 });
    } catch (error) {
      if (error instanceof SpatialError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  // Global turn pacing: the first Do is the hero's complete submission.
  // Initiative already has a per-combatant action budget; global collection
  // pacing must not consume or reject combat turns.
  const turnResult = encounter?.orderReady ? { allowed: true } : recordGlobalTurnAction(campaignId, sheet.id, user.id, kind);
  if (!turnResult.allowed) {
    const fallback = {
      en: "This action is unavailable this turn.",
      ru: "Действие недоступно в этом ходе.",
    }[locale] ?? "This action is unavailable this turn.";
    return Response.json({ error: turnResult.error ?? fallback }, { status: 409 });
  }

  let spotlightStillWaiting = false;
  if (kind !== "ooc" && floor.mode === "spotlight") {
    const responded = [...floor.respondedUserIds, user.id];
    const allAnswered = floor.userIds.every((id) => responded.includes(id));
    const nextFloor: Floor = allAnswered ? { mode: "hold", next: { mode: "open" } } : { ...floor, respondedUserIds: responded };
    setFloor(campaignId, nextFloor);
    publishPersisted(campaignId, "floor_changed", { floor: nextFloor });
    spotlightStillWaiting = !allAnswered;
  }

  const content =
      combatContent ?? (kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content!);

  const message = withCommittedEffects(() => getDatabase().transaction(() => {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "player",
      userId: user.id,
      characterId: sheet.id,
      content,
      combatTurn: parsed.data.combatTurn,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    return message;
  })());
  const seq = message.seq;

  // Quorum with zero grace (or everybody answering) seals only after the
  // triggering message is durable. From this point the round belongs to the
  // external MCP narrator; no player/lead "finish turn" action is involved.
  if (turnResult.shouldResolve && turnResult.state) {
    await resolveGlobalTurn(campaignId, turnResult.state.roundNumber);
  }

  // Non-OOC combat input is exclusive until a DM narration completes. A
  // bundle additionally requires explicit end_turn, so prose cannot advance
  // initiative by guessing the player's intent.
  if (kind !== "ooc" && floor.mode === "initiative") {
    const gate = combatGate ?? {
      encounterId: floor.encounterId, round: floor.round, turnIndex: encounter?.turnIndex ?? 0,
      characterId: sheet.id, requiresEndTurn: true, mechanicsResolved: false,
    };
    const held: Floor = { mode: "hold", next: floor, combat: { ...gate, submissionMessageId: message.id, heldAt: new Date().toISOString() } };
    setFloor(campaignId, held);
    publishPersisted(campaignId, "floor_changed", { floor: held });
  }

  // The server never starts or calls a text model. Non-OOC player input is
  // persisted as an intent for the human/external MCP narrator to consume.
  const globalTurnActive = Boolean(campaign.gameSettings?.globalTurn?.enabled) && !encounter?.orderReady;
  if (!globalTurnActive && kind !== "ooc" && !spotlightStillWaiting) {
    publishPersisted(campaignId, "dm_intent_queued", {
      messageId: message.id,
      userId: user.id,
      characterId: sheet.id,
      seq,
    });
  }
  if (!globalTurnActive && floor.mode === "spotlight" && !spotlightStillWaiting && kind !== "ooc") {
    publishPersisted(campaignId, "spotlight_ready", { messageId: message.id, autoReleaseFloor: true });
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
