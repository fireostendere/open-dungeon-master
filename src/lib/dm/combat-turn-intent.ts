import { spendAction, spendAttack, spendSpell, type ActionKind, type TurnBudget } from "./action-budget.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { matchWeapon } from "../srd/weapons.ts";
import { spendPetCommand, type PetCombatant } from "./pet-combat.ts";
import type { PublicEncounter } from "../db/encounter-view.ts";
import type { Spellcasting } from "../schemas/sheet.ts";

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
  | { type: "pet_order"; petName: string; order: string }
  | { type: "spell"; spell: string; slotLevel?: number; targetId?: string }
  | { type: "feature"; feature: string; targetId?: string }
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
  features?: Array<{ name: string; description?: string }>;
  spellcasting?: Spellcasting;
};

export type CombatSpellDescriptor = { type: "spell"; name: string; level: number | null; cost: ActionKind | null };

export function combatSpellNames(sheet: CombatIntentSheet): string[] {
  const casting = sheet.spellcasting;
  return [...new Set([...(casting?.known ?? []), ...(casting?.prepared ?? []),
    ...(casting?.casters ?? []).flatMap(caster => [...caster.known, ...caster.prepared])])];
}

export function combatSpellSlots(sheet: CombatIntentSheet, level: number): Array<{ level: number; left: number }> {
  if (level === 0) return [];
  const slots = new Map(Object.entries(sheet.spellcasting?.slots ?? {}).map(([key, slot]) => [Number(key), Math.max(0, slot.max - slot.used)]));
  const pact = sheet.spellcasting?.pact;
  if (pact) slots.set(pact.level, (slots.get(pact.level) ?? 0) + Math.max(0, pact.max - pact.used));
  return [...slots].filter(([key, left]) => key >= level && left > 0).sort(([a], [b]) => a - b).map(([key, left]) => ({ level: key, left }));
}

export type CombatChoiceDescriptor =
  | { type: "weapon"; name: string }
  | { type: "feature"; name: string; description?: string }
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
    ...(sheet.features ?? []).map(feature => ({ type: "feature" as const, ...feature })),
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
  presentation?: { language: string; names: ReadonlyMap<string, string>; spells?: CombatSpellDescriptor[] },
): CombatIntentResult {
  let next = budget;
  const selections: string[] = [];
  const usedResources: Record<string, number> = {};
  const usedItems: Record<string, number> = {};
  const usedSlots = new Map<number, number>();
  const commandedPets = new Set<string>();
  const ru = presentation?.language === "ru";
  const adjudication = ru ? "заявка мастеру; стоимость и эффект определяются правилами" : "request for DM adjudication; rules determine cost and effect";
  const copy = presentation?.language === "ru"
    ? { turn: "Боевой ход", attack: "Атака", dodge: "Защита: уклонение", resource: "Способность", item: "Предмет", target: "цель", end: "Завершаю ход после разрешения указанных действий." }
    : { turn: "Combat turn", attack: "Attack", dodge: "Defence: Dodge", resource: "Ability", item: "Item", target: "target", end: "End my turn after resolving the declared actions." };
  const name = (id: string) => presentation?.names.get(id) ?? id;
  if (intent.choices.length > 12) return { ok: false, error: "Too many choices in one turn." };
  for (const choice of intent.choices) {
    if (choice.type === "spell") {
      const spell = presentation?.spells?.find(entry => entry.name === choice.spell);
      if (!combatSpellNames(sheet).includes(choice.spell) || !spell) return { ok: false, error: "Choose a spell on your character sheet." };
      if (choice.targetId && !visibleEnemyIds.has(choice.targetId) && !allyIds.has(choice.targetId)) return { ok: false, error: "Choose a visible spell target." };
      if (spell.cost === "reaction") return { ok: false, error: "A reaction spell requires its trigger; describe it to the DM when triggered." };
      if (spell.level !== null && spell.level > 0) {
        const slot = combatSpellSlots(sheet, spell.level).find(entry => entry.level === choice.slotLevel);
        if (!slot || slot.left <= (usedSlots.get(slot.level) ?? 0)) return { ok: false, error: "Choose an available spell slot." };
        usedSlots.set(slot.level, (usedSlots.get(slot.level) ?? 0) + 1);
      } else if (choice.slotLevel !== undefined) return { ok: false, error: "This spell does not take a selected slot." };
      if (spell.cost && spell.level !== null) {
        const spent = spendSpell(next, spell.cost, spell.level, spell.name, sheet.name);
        if (!spent.ok) return spent;
        next = spent.budget;
      }
      selections.push(`${ru ? "Заклинание" : "Spell"}: ${spell.name}${choice.slotLevel ? ` (${ru ? "ячейка" : "slot"} ${choice.slotLevel})` : ""}${choice.targetId ? `; ${copy.target}: ${name(choice.targetId)}` : ""}${!spell.cost || spell.level === null ? `; ${adjudication}` : ""}`);
    } else if (choice.type === "feature") {
      if (!sheet.features?.some(feature => feature.name === choice.feature)) return { ok: false, error: "Choose a feature on your character sheet." };
      if (choice.targetId && !visibleEnemyIds.has(choice.targetId) && !allyIds.has(choice.targetId)) return { ok: false, error: "Choose a visible feature target." };
      selections.push(`${copy.resource}: ${choice.feature}${choice.targetId ? `; ${copy.target}: ${name(choice.targetId)}` : ""}; ${adjudication}`);
    } else if (choice.type === "pet_order") {
      const pet = sheet.pets?.find(entry => entry.name === choice.petName);
      if (!pet || pet.hp <= 0 || !choice.order.trim() || choice.order.length > 500 || commandedPets.has(pet.name) || next.oncePerTurn.includes(`pet:${pet.name.toLowerCase()}`)) return { ok: false, error: "Choose your living pet and enter one order." };
      commandedPets.add(pet.name);
      // A free-text order is an intent, never a free mechanical pet action.
      selections.push(`${ru ? "Приказ" : "Order"}: ${pet.name} — ${choice.order.trim()}; ${adjudication}`);
    } else if (choice.type === "attack") {
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
      if (!pet || commandedPets.has(pet.name) || !pet.attacks.some(attack => attack.name === choice.attack) || !visibleEnemyIds.has(choice.targetEnemyId)) return { ok: false, error: "Choose a living pet's available attack and a visible enemy." };
      const spent = spendPetCommand(next, pet, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      commandedPets.add(pet.name);
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
  const declaration = selections.length
    ? `${ru ? "Явно выбранные действия (приоритет применения)" : "Explicitly queued actions (application priority)"}:\n${selections.map((selection, index) => `${index + 1}. ${selection}`).join("\n")}\n\n${prose ? `${ru ? "Описание игрока" : "Player description"}: ${prose}` : (ru ? "Без дополнительного описания." : "No additional description.")}`
    : prose ? `${ru ? "Свободная заявка" : "Free-text intent"}: ${prose}` : (ru ? "Пропускаю ход." : "I pass my turn.");
  return {
    ok: true,
    budget: next,
    content: `${copy.turn}: ${sheet.name}\n${declaration}\n\n${copy.end}`,
  };
}
