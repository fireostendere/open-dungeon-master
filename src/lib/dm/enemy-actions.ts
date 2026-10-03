import { setEnemySpent, type EncounterEnemy } from "@/lib/db/encounters";
import { rollExpression } from "@/lib/dice";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyAttack, EnemySaveAction } from "@/lib/bestiary/statblock";

// Which of its printed actions an enemy takes, and whether it still can.
// enemy_attack names an action; nothing here ever swaps it for another one,
// because a web that silently became a bite is a fight the table did not see.

type Limited = { name: string; recharge?: number; uses?: number };

export type PickedAction = { attack: EnemyAttack } | { save: EnemySaveAction } | { error: string };

function timesUsed(enemy: EncounterEnemy, name: string): number {
  return (enemy.spent ?? []).filter((entry) => entry === name).length;
}

export function actionReady(enemy: EncounterEnemy, action: Limited): boolean {
  if (action.recharge) {
    return timesUsed(enemy, action.name) === 0;
  }
  return action.uses ? timesUsed(enemy, action.name) < action.uses : true;
}

// Unlimited actions cost nothing to track.
export function spendAction(enemy: EncounterEnemy, action: Limited) {
  if (action.recharge || action.uses) {
    setEnemySpent(enemy.id, [...(enemy.spent ?? []), action.name]);
  }
}

export function pickEnemyAction(enemy: EncounterEnemy, requested: string | undefined): PickedAction {
  const attacks = enemy.stats.attacks.length ? enemy.stats.attacks : synthesizeStats(enemy.cr).attacks;
  const saves = enemy.stats.saves ?? [];
  const wanted = (requested ?? "").trim().toLowerCase();
  if (!wanted) {
    // Its everyday attack; a limited one only when nothing else is printed.
    const attack = attacks.find((entry) => !entry.recharge && !entry.uses) ?? attacks.find((entry) => actionReady(enemy, entry));
    return attack ? { attack } : { error: `${enemy.displayName} has no usable attacks; narrate a different action.` };
  }
  const named: Array<EnemyAttack | EnemySaveAction> = [...attacks, ...saves];
  const match =
    named.find((entry) => entry.name.toLowerCase() === wanted) ??
    named.find((entry) => entry.name.toLowerCase().includes(wanted));
  if (!match) {
    return {
      error: `${enemy.displayName} has no action "${requested}". Its actions: ${named.map((entry) => entry.name).join(", ") || "none"}. Use one of those, or narrate what it does instead.`,
    };
  }
  if (!actionReady(enemy, match)) {
    return {
      error: `${enemy.displayName}'s ${match.name} is spent ${match.recharge ? `until it recharges (a d6 of ${match.recharge}+ at the top of each round)` : "for this fight"}. Use another action.`,
    };
  }
  return "toHit" in match ? { attack: match } : { save: match };
}

// The top of a round: each spent recharge action rolls its d6 and comes
// back on the printed number. Per-day actions stay spent.
export function rechargeEnemies(enemies: EncounterEnemy[]) {
  for (const enemy of enemies) {
    if (enemy.status !== "alive" || !enemy.spent?.length) {
      continue;
    }
    const recharge = new Map(
      [...enemy.stats.attacks, ...(enemy.stats.saves ?? [])].map((entry) => [entry.name, entry.recharge]),
    );
    const kept = enemy.spent.filter((name) => {
      const needs = recharge.get(name);
      return !needs || rollExpression("1d6").total < needs;
    });
    if (kept.length !== enemy.spent.length) {
      setEnemySpent(enemy.id, kept);
    }
  }
}
