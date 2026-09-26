// Pure façade policy. This does not interpret player prose or implement rules.
// The narrator sets completeTurn only on the LAST declared action; the ordinary
// end_turn handler remains the only implementation of initiative advancement.
export const COMPLETE_TURN_ACTIONS: readonly string[] = Object.freeze([
  "pc_attack", "cast_at_enemy", "cast_buff", "heal", "pet_attack", "take_action", "use_item", "use_resource",
]);

export type CombatTurnKey = {
  encounterId: string;
  round: number;
  turnIndex: number;
  characterId: string;
};

export function parseCompleteTurn(
  action: string,
  value: unknown,
  actorKind: "human" | "ai",
): { ok: true; requested: boolean } | { ok: false; error: string } {
  if (value === undefined || value === false) return { ok: true, requested: false };
  if (value !== true) return { ok: false, error: "completeTurn must be a boolean." };
  if (!COMPLETE_TURN_ACTIONS.includes(action)) {
    return { ok: false, error: "This action does not support completeTurn." };
  }
  if (actorKind !== "human") {
    return { ok: false, error: "completeTurn is available to the external/human adjudication path only." };
  }
  return { ok: true, requested: true };
}

export function sameCombatTurn(before: CombatTurnKey | null, after: CombatTurnKey | null): boolean {
  return before !== null && after !== null &&
    before.encounterId === after.encounterId && before.round === after.round &&
    before.turnIndex === after.turnIndex && before.characterId === after.characterId;
}

export function combatCompletionDisposition(
  before: CombatTurnKey,
  after: CombatTurnKey | null,
  pendingRollCount: number,
): "awaiting_rolls" | "already_advanced" | "complete" {
  if (!Number.isSafeInteger(pendingRollCount) || pendingRollCount < 0) {
    throw new Error("Invalid pending-roll count.");
  }
  if (pendingRollCount > 0) return "awaiting_rolls";
  return sameCombatTurn(before, after) ? "complete" : "already_advanced";
}
