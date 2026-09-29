// Pure rules behind the cinematic director's "the fight is won" moment, kept
// out of the component so they can be tested without a browser.

/** The rules engine's reason on victory XP (autoEndOnVictory in src/lib/dm/enemy-damage.ts). */
export const VICTORY_XP_REASON = /^encounter victory$/i;

export type FightEndEnemy = { id: string; name: string; status: string };
export type FightEndAudit = { kind: string; reason: string; seq: number };

/**
 * How a fight that just disappeared from the stream ended, from the player's
 * point of view. `enemies` are the visible foes as last seen, `statusOf` the
 * freshest status known for each, `audit` the audit trail, `since` the newest
 * audit seq while the fight was still running.
 *
 * The killing blow and the end of the fight often arrive in one render (or
 * one snapshot), so the last foe is never seen dead. XP awarded after the
 * fight settles it: the engine writes "encounter victory" only for a win and
 * "encounter ended: <outcome>" otherwise. Without XP to go by (foes worth
 * nothing), a fight with losses that ends with a single foe still standing
 * ended on that foe.
 */
export function fightEnding(input: {
  enemies: FightEndEnemy[];
  statusOf: (enemy: FightEndEnemy) => string;
  audit: FightEndAudit[];
  since: number;
}): { victory: boolean; lastStanding: FightEndEnemy[] } {
  const { enemies, statusOf, audit, since } = input;
  if (!enemies.length) return { victory: false, lastStanding: [] };
  const standing = enemies.filter((enemy) => statusOf(enemy) === "alive");
  const fallen = enemies.some((enemy) => statusOf(enemy) === "dead");
  const endXp = audit.filter((entry) => entry.kind === "award_xp" && entry.seq > since);
  const victory = endXp.length
    ? endXp.some((entry) => VICTORY_XP_REASON.test(entry.reason.trim()))
    : standing.length === 0
      ? fallen
      : standing.length === 1 && fallen;
  return { victory, lastStanding: victory ? standing : [] };
}
