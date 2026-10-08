import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { budgetApplies } from "@/lib/dm/action-budget";

// Great Weapon Master: a melee critical hit or a kill on the hero's own turn
// opens a bonus-action melee attack. Recorded on the live turn budget from
// whichever path learns the outcome: the digital roll in pc_attack, or a
// physical-dice player's to-hit and damage submissions. A leaf module, so
// pc-attack and enemy-damage can both reach it without an import cycle.
export const GWM_TRIGGER = "trigger:gwm";

export function markGwmTrigger(campaignId: string, characterId: string): void {
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget ?? null;
  if (!encounter || !budgetApplies(budget, characterId, encounter.round) || budget.oncePerTurn.includes(GWM_TRIGGER)) {
    return;
  }
  encounter.turnBudget = { ...budget, oncePerTurn: [...budget.oncePerTurn, GWM_TRIGGER] };
  saveEncounter(encounter);
}
