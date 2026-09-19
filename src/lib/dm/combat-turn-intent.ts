import { spendAction, spendAttack, type TurnBudget } from "./action-budget.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { matchWeapon } from "../srd/weapons.ts";

export type CombatChoice =
  | { type: "attack"; targetEnemyId: string; weapon: string }
  | { type: "dodge" }
  | { type: "resource"; resource: string; targetCharacterId?: string }
  | { type: "item"; item: string; targetCharacterId?: string };

export type CombatTurnIntent = {
  encounterId: string;
  round: number;
  turnIndex: number;
  choices: CombatChoice[];
  prose?: string;
};

export type CombatIntentSheet = {
  id: string;
  name: string;
  equipment: Array<{ name: string; qty: number; gear?: { weapon?: unknown } }>;
  resources: Record<string, { max: number; used: number }>;
};

export type CombatChoiceDescriptor =
  | { type: "weapon"; name: string }
  | { type: "resource"; id: string; name: string; left: number; cost: "action" | "bonus"; target: "self" | "ally" | "other" }
  | { type: "item"; name: string; qty: number };

export type CombatIntentResult = { ok: true; content: string; budget: TurnBudget } | { ok: false; error: string };

const consumableName = /potion|vial|elixir|flask|draught|philter|scroll|ration|torch|зель|эликсир|свиток|рацион|факел/i;

// Client-safe: it only reads the sheet data already delivered to the owner.
export function combatChoiceDescriptors(sheet: CombatIntentSheet): CombatChoiceDescriptor[] {
  const weapons = sheet.equipment
    .filter((item) => item.qty > 0 && (Boolean(item.gear?.weapon) || matchWeapon(item.name)))
    .map((item) => ({ type: "weapon" as const, name: item.name }));
  return [
    ...weapons,
    { type: "weapon", name: "Unarmed strike" },
    ...Object.entries(sheet.resources).flatMap(([id, state]) => {
      const action = Object.hasOwn(RESOURCE_ACTIONS, id) ? RESOURCE_ACTIONS[id] : undefined;
      return action && state.used < state.max
        ? [{ type: "resource" as const, id, ...action, left: state.max - state.used }]
        : [];
    }),
    ...sheet.equipment
      .filter((item) => item.qty > 0 && consumableName.test(item.name))
      .map((item) => ({ type: "item" as const, name: item.name, qty: item.qty })),
  ];
}

function knownWeapon(sheet: CombatIntentSheet, weapon: string) {
  return /^(unarmed strike|unarmed|fist|punch|kick)$/i.test(weapon) || sheet.equipment.some(
    (item) => item.qty > 0 && item.name === weapon && (Boolean(item.gear?.weapon) || matchWeapon(item.name)),
  );
}

export function validateCombatTurnIntent(
  intent: CombatTurnIntent,
  sheet: CombatIntentSheet,
  visibleEnemyIds: Set<string>,
  allyIds: Set<string>,
  budget: TurnBudget,
): CombatIntentResult {
  let next = budget;
  const selections: string[] = [];
  const usedResources: Record<string, number> = {};
  const usedItems: Record<string, number> = {};
  if (intent.choices.length > 12) return { ok: false, error: "Too many choices in one turn." };
  for (const choice of intent.choices) {
    if (choice.type === "attack") {
      if (!visibleEnemyIds.has(choice.targetEnemyId)) return { ok: false, error: "Choose a visible living enemy." };
      if (!knownWeapon(sheet, choice.weapon)) return { ok: false, error: "Choose a weapon on your character sheet." };
      const spent = spendAttack(next, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`Attack ${choice.weapon} at ${choice.targetEnemyId}`);
    } else if (choice.type === "dodge") {
      const spent = spendAction(next, "action", "Dodge", sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push("Dodge");
    } else if (choice.type === "resource") {
      const state = Object.hasOwn(sheet.resources, choice.resource) ? sheet.resources[choice.resource] : undefined;
      const action = Object.hasOwn(RESOURCE_ACTIONS, choice.resource) ? RESOURCE_ACTIONS[choice.resource] : undefined;
      if (!action || !state || state.used + (usedResources[choice.resource] ?? 0) >= state.max) return { ok: false, error: "Choose an available supported resource." };
      const target = action.target === "self" ? sheet.id : choice.targetCharacterId ?? sheet.id;
      if (!allyIds.has(target) || (action.target === "other" && target === sheet.id)) return { ok: false, error: "Choose an eligible ally for that resource." };
      const spent = spendAction(next, action.cost, action.name, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      usedResources[choice.resource] = (usedResources[choice.resource] ?? 0) + 1;
      selections.push(`Use resource ${action.name} (${choice.resource}) on ${target}`);
    } else {
      const item = sheet.equipment.find((entry) => entry.name === choice.item && entry.qty > 0);
      if (!item || !consumableName.test(item.name) || item.qty <= (usedItems[item.name] ?? 0)) return { ok: false, error: "Choose an available consumable." };
      if (choice.targetCharacterId && !allyIds.has(choice.targetCharacterId)) return { ok: false, error: "Choose an eligible ally for that item." };
      const spent = spendAction(next, "action", `use ${item.name}`, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      usedItems[item.name] = (usedItems[item.name] ?? 0) + 1;
      selections.push(`Use ${item.name}${choice.targetCharacterId ? ` on ${choice.targetCharacterId}` : ""}`);
    }
  }
  const prose = intent.prose?.trim();
  return {
    ok: true,
    budget: next,
    content: `[combat turn intent] ${selections.length ? selections.join("; ") : "End turn"}${prose ? `\n${prose}` : ""}\n[end turn requested]`,
  };
}
