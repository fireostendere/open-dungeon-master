import { getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listOpenPendingRolls, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { advanceAfterTurn } from "@/lib/dm/encounter-tools";
import { publishPersisted } from "@/lib/events";

/** Only synchronous state finalization, inside the caller's transaction.
 * Narration does not implicitly finish a turn. No AI finalize, model, TTS or
 * upkeep runs here. The exact adjudication turn carries enemy bookkeeping.
 */
export function finishHumanAdjudication(campaign: Campaign, turn: DmTurn, action: string): void {
  if (turn.campaignId !== campaign.id || turn.actor !== "human_dm") throw new Error("Invalid human adjudication turn.");
  const pending = listOpenPendingRolls(campaign.id);
  if (action === "end_turn") {
    if (pending.length) throw new Error("Resolve pending physical rolls before ending the combat turn.");
    const before = getActiveEncounter(campaign.id);
    const floor = getFloor(campaign.id);
    const initiative = floor.mode === "hold" ? floor.next : floor;
    if (!before?.orderReady || initiative.mode !== "initiative" || initiative.encounterId !== before.id) {
      throw new Error("The initiative floor no longer matches this encounter.");
    }
    const current = before.order[before.turnIndex];
    if (!current || current.kind !== "pc" || !turn.resolvedCharacterIds.includes(current.characterId)) {
      throw new Error("This adjudication did not resolve the current character's turn.");
    }
    // Hold remains a submission gate, not an excuse to return success without
    // moving initiative. All intermediate state/events commit atomically.
    if (floor.mode === "hold") setFloor(campaign.id, initiative);
    const previous = { id: before.id, round: before.round, turnIndex: before.turnIndex };
    advanceAfterTurn(campaign, turn);
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
  turn.status = pending.some((roll) => roll.turnId === turn.id) ? "awaiting_rolls" : "done";
  saveDmTurn(turn);
}
