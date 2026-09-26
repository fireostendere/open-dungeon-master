import { claimOncePerTurn, spendAction, spendAttack, type SpendResult, type TurnBudget } from "./action-budget.ts";

export type PetCombatant = {
  name: string; kind: string; hp: number;
  commandCost?: "action" | "bonus" | "attack";
  attacks: Array<{ name: string; toHit: number; damage: string; type: string }>;
};

export function petCommandCost(pet: PetCombatant): "action" | "bonus" | "attack" | null {
  if (pet.kind === "beast_companion") return "action";
  if (pet.kind === "drake") return "bonus";
  if (pet.kind === "familiar") return "attack";
  return pet.commandCost ?? null;
}

export function spendPetCommand(budget: TurnBudget, pet: PetCombatant, owner: string): SpendResult {
  if (pet.hp <= 0 || !pet.attacks.length) return { ok: false, error: `${pet.name} cannot attack.` };
  const cost = petCommandCost(pet);
  if (!cost) return { ok: false, error: `${pet.name} needs an explicit command cost from its feature or homebrew rules.` };
  const claimed = claimOncePerTurn(budget, `pet:${pet.name.toLowerCase()}`);
  if (!claimed) return { ok: false, error: `${pet.name} already acted on this turn.` };
  return cost === "attack" ? spendAttack(claimed, owner, false) : spendAction(claimed, cost, `command ${pet.name}`, owner);
}
