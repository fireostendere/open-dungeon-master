import { spendAction, spendAttack, type TurnBudget } from "./action-budget.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { matchWeapon } from "../srd/weapons.ts";
import { spendPetCommand, type PetCombatant } from "./pet-combat.ts";
import type { PublicEncounter } from "../db/encounter-view.ts";

// Both combat panels preview the same authoritative budget, never another actor's.
export function combatIntentBudget(encounter: Pick<PublicEncounter, "currentActorId" | "turnBudget">, fresh: TurnBudget): TurnBudget {
  return encounter.currentActorId === fresh.ownerId && encounter.turnBudget
    ? { ...fresh, ...encounter.turnBudget, oncePerTurn: encounter.turnBudget.oncePerTurn ?? [] }
    : fresh;
}

export type CombatChoice =
  | { type: "attack"; targetEnemyId: string; weapon: string }
  | { type: "dodge" }
  | { type: "action"; action: "dash" | "disengage" | "hide" | "help" | "grapple" | "shove"; targetEnemyId?: string; targetCharacterId?: string }
  | { type: "pet"; petName: string; attack: string; targetEnemyId: string }
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
  equipment: Array<{ name: string; qty: number; equipped?: boolean; gear?: { weapon?: unknown } }>;
  resources: Record<string, { max: number; used: number }>;
  pets?: PetCombatant[];
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
    .filter((item) => item.qty > 0 && item.equipped !== false && (Boolean(item.gear?.weapon) || matchWeapon(item.name)))
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
    (item) => item.qty > 0 && item.equipped !== false && item.name === weapon && (Boolean(item.gear?.weapon) || matchWeapon(item.name)),
  );
}

export function validateCombatTurnIntent(
  intent: CombatTurnIntent,
  sheet: CombatIntentSheet,
  visibleEnemyIds: Set<string>,
  allyIds: Set<string>,
  budget: TurnBudget,
  presentation?: { language: string; names: ReadonlyMap<string, string> },
): CombatIntentResult {
  let next = budget;
  const selections: string[] = [];
  const usedResources: Record<string, number> = {};
  const usedItems: Record<string, number> = {};
  const copy = presentation?.language === "ru"
    ? { turn: "Боевой ход", attack: "Атака", dodge: "Защита: уклонение", resource: "Способность", item: "Предмет", target: "цель", end: "Завершаю ход после разрешения указанных действий." }
    : { turn: "Combat turn", attack: "Attack", dodge: "Defence: Dodge", resource: "Ability", item: "Item", target: "target", end: "End my turn after resolving the declared actions." };
  const name = (id: string) => presentation?.names.get(id) ?? id;
  if (intent.choices.length > 12) return { ok: false, error: "Too many choices in one turn." };
  for (const choice of intent.choices) {
    if (choice.type === "attack") {
      if (!visibleEnemyIds.has(choice.targetEnemyId)) return { ok: false, error: "Choose a visible living enemy." };
      if (!knownWeapon(sheet, choice.weapon)) return { ok: false, error: "Choose a weapon on your character sheet." };
      const spent = spendAttack(next, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`${copy.attack}: ${choice.weapon}; ${copy.target}: ${name(choice.targetEnemyId)}`);
    } else if (choice.type === "dodge") {
      const spent = spendAction(next, "action", "Dodge", sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(copy.dodge);
    } else if (choice.type === "pet") {
      const pet = sheet.pets?.find(entry => entry.name === choice.petName);
      if (!pet || !pet.attacks.some(attack => attack.name === choice.attack) || !visibleEnemyIds.has(choice.targetEnemyId)) return { ok: false, error: "Choose a living pet's available attack and a visible enemy." };
      const spent = spendPetCommand(next, pet, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`${pet.name}: ${choice.attack}; ${copy.target}: ${name(choice.targetEnemyId)}`);
    } else if (choice.type === "action") {
      const specialAttack = choice.action === "grapple" || choice.action === "shove";
      if (specialAttack && !visibleEnemyIds.has(choice.targetEnemyId ?? "")) return { ok: false, error: "Choose a visible enemy." };
      if (choice.action === "help" && (!allyIds.has(choice.targetCharacterId ?? "") || choice.targetCharacterId === sheet.id)) return { ok: false, error: "Help requires another ally." };
      const spent = specialAttack ? spendAttack(next, sheet.name, false) : spendAction(next, "action", choice.action, sheet.name, ["dash", "hide", "disengage"].includes(choice.action));
      if (!spent.ok) return spent;
      next = spent.budget;
      const labels = { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помощь", grapple: "Захват", shove: "Толчок" };
      selections.push(`${presentation?.language === "ru" ? labels[choice.action] : choice.action}${choice.targetEnemyId || choice.targetCharacterId ? `; ${copy.target}: ${name(choice.targetEnemyId ?? choice.targetCharacterId!)}` : ""}`);
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
      selections.push(`${copy.resource}: ${action.name}; ${copy.target}: ${name(target)}`);
    } else {
      const item = sheet.equipment.find((entry) => entry.name === choice.item && entry.qty > 0);
      if (!item || !consumableName.test(item.name) || item.qty <= (usedItems[item.name] ?? 0)) return { ok: false, error: "Choose an available consumable." };
      if (choice.targetCharacterId && !allyIds.has(choice.targetCharacterId)) return { ok: false, error: "Choose an eligible ally for that item." };
      const spent = spendAction(next, "action", `use ${item.name}`, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      usedItems[item.name] = (usedItems[item.name] ?? 0) + 1;
      selections.push(`${copy.item}: ${item.name}; ${copy.target}: ${name(choice.targetCharacterId ?? sheet.id)}`);
    }
  }
  const prose = intent.prose?.trim();
  return {
    ok: true,
    budget: next,
    content: `${copy.turn}: ${sheet.name}\n${selections.map((selection, index) => `${index + 1}. ${selection}`).join("\n")}${prose ? `\n\n${prose}` : ""}\n\n${copy.end}`,
  };
}
