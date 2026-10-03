import { getFloor, setFloor, type Campaign, type Floor } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listOpenPendingRolls, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { scopedHumanTurn } from "@/lib/db/human-adjudication-scopes";
import { advanceAfterTurn, announceCurrentTurn, queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";
import { publishPersisted } from "@/lib/events";

/** Only synchronous state finalization, inside the caller's transaction.
 * Narration does not implicitly finish a turn. No AI finalize, model, TTS or
 * upkeep runs here. The exact adjudication turn carries enemy bookkeeping.
 *
 * A turn the player submitted (a combat hold) only records its resolution
 * here: initiative stays on the submitting character, so the table sees
 * nobody's turn while the DM writes every message about it. The handoff is a
 * separate explicit write (passCombatTurn).
 */
export function finishHumanAdjudication(campaign: Campaign, turn: DmTurn, action: string): void {
  if (turn.campaignId !== campaign.id || turn.actor !== "human_dm") throw new Error("Invalid human adjudication turn.");
  const pending = listOpenPendingRolls(campaign.id);
  if (action === "end_turn") {
    if (pending.length) throw new Error("Resolve pending physical rolls before ending the combat turn.");
    const before = getActiveEncounter(campaign.id);
    const floor = getFloor(campaign.id);
    if (floor.mode === "hold" && floor.team) {
      throw new Error("This hero's next turn waits for the rest of the party to finish team round " +
        `${floor.team.round}; it opens when the next global round starts. Resolve the round (completeGlobalRound) instead.`);
    }
    const initiative = floor.mode === "hold" ? floor.next : floor;
    if (!before?.orderReady || initiative.mode !== "initiative" || initiative.encounterId !== before.id) {
      throw new Error("The initiative floor no longer matches this encounter.");
    }
    const current = before.order[before.turnIndex];
    if (!current || current.kind !== "pc" || !turn.resolvedCharacterIds.includes(current.characterId)) {
      throw new Error("This adjudication did not resolve the current character's turn.");
    }
    if (!(floor.mode === "hold" && floor.combat)) {
      // Nothing was submitted (the DM ended an idle player's turn, or the
      // table sits under a plain discussion hold): the pointer moves now.
      if (floor.mode === "hold") setFloor(campaign.id, initiative);
      const previous = { id: before.id, round: before.round, turnIndex: before.turnIndex };
      advanceAfterTurn(campaign, turn, { announce: floor.mode !== "hold" });
      const after = getActiveEncounter(campaign.id);
      if (after?.id === previous.id && after.round === previous.round && after.turnIndex === previous.turnIndex) {
        throw new Error("The engine could not advance initiative; the command was rolled back.");
      }
      if (floor.mode === "hold") {
        const next = getFloor(campaign.id);
        const held = next.mode === "hold" ? next : { mode: "hold" as const, next };
        setFloor(campaign.id, held);
        publishPersisted(campaign.id, "floor_changed", { floor: held });
      }
    }
  }
  turn.status = pending.some((roll) => roll.turnId === turn.id) ? "awaiting_rolls" : "done";
  saveDmTurn(turn);
}

// Where a held combat turn stands. `resolving`: the DM is still adjudicating
// it (end_turn not called yet, or a physical roll is out). `ready`: mechanics
// are done and the DM may still be writing; the next actor gets the floor
// only on passCombatTurn.
export type CombatHandoff =
  | { state: "none" }
  | { state: "resolving" | "ready"; characterId: string; pendingRolls: number };

export function combatHandoffState(campaignId: string, floor: Floor = getFloor(campaignId)): CombatHandoff {
  if (floor.mode !== "hold" || !floor.combat) return { state: "none" };
  const pendingRolls = listOpenPendingRolls(campaignId).length;
  const resolved = !floor.combat.requiresEndTurn || floor.combat.mechanicsResolved;
  return { state: resolved && !pendingRolls ? "ready" : "resolving", characterId: floor.combat.characterId, pendingRolls };
}

export class CombatHandoffError extends Error {}

/** Hand a resolved, held combat turn to the next actor, inside the caller's
 * transaction: move initiative (enemies the DM did not play act by the server
 * fallback), open the floor for the next character and announce them. Returns
 * false when no combat turn is held. Throws when the turn is not resolved
 * yet, so no caller can open the table mid-adjudication.
 */
export function passCombatTurn(campaign: Campaign): boolean {
  const floor = getFloor(campaign.id);
  if (floor.mode !== "hold" || !floor.combat) return false;
  const gate = floor.combat;
  if (listOpenPendingRolls(campaign.id).length) throw new CombatHandoffError("Resolve pending physical rolls before passing the turn.");
  if (gate.requiresEndTurn && !gate.mechanicsResolved) {
    throw new CombatHandoffError("This combat turn is not resolved yet: call end_turn (or completeTurn) for the acting character first.");
  }
  const encounter = getActiveEncounter(campaign.id);
  const samePosition = Boolean(encounter?.orderReady && encounter.id === gate.encounterId &&
    encounter.round === gate.round && encounter.turnIndex === gate.turnIndex &&
    floor.next.mode === "initiative" && floor.next.encounterId === encounter.id);
  // Un-hold without an event of its own: the handoff below publishes the one
  // floor the table should see.
  setFloor(campaign.id, floor.next);
  if (gate.requiresEndTurn && encounter && samePosition) {
    const turn = scopedHumanTurn(campaign.id, `${gate.encounterId}:${gate.round}:${gate.turnIndex}`);
    if (!turn.resolvedCharacterIds.includes(gate.characterId)) turn.resolvedCharacterIds.push(gate.characterId);
    advanceAfterTurn(campaign, turn, { announce: false });
    saveDmTurn(turn);
    const after = getActiveEncounter(campaign.id);
    if (after?.id === encounter.id && after.round === gate.round && after.turnIndex === gate.turnIndex) {
      throw new CombatHandoffError("The engine could not advance initiative; nothing was changed.");
    }
    // Server-played enemies post first, then whose turn it is now.
    if (after?.orderReady) announceCurrentTurn(campaign);
  } else {
    // The fight ended (victory, flight) or the order was edited under the
    // hold: open whatever the hold was going to become.
    publishPersisted(campaign.id, "floor_changed", { floor: floor.next });
    if (gate.requiresEndTurn && encounter?.orderReady && floor.next.mode === "initiative") announceCurrentTurn(campaign);
  }
  queueSkippedCombatTurn(campaign.id);
  return true;
}
