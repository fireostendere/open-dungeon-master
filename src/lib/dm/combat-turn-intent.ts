import { spendAction, spendAttack, spendSpell, type ActionKind, type TurnBudget } from "./action-budget.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { matchWeapon } from "../srd/weapons.ts";
import { spendPetCommand, type PetCombatant } from "./pet-combat.ts";
import type { PublicEncounter } from "../db/encounter-view.ts";
import type { Spellcasting } from "../schemas/sheet.ts";
import { effectsFor, hasCunningAction } from "../srd/feature-effects.ts";

// Both combat panels preview the same authoritative budget, never another actor's.
export function combatIntentBudget(encounter: Pick<PublicEncounter, "currentActorId" | "turnBudget">, fresh: TurnBudget): TurnBudget {
  return encounter.currentActorId === fresh.ownerId && encounter.turnBudget
    ? { ...fresh, ...encounter.turnBudget, oncePerTurn: encounter.turnBudget.oncePerTurn ?? [] }
    : fresh;
}

export type CombatChoice =
  | { type: "attack"; targetEnemyId: string; weapon: string; sneakAttack?: boolean }
  | { type: "dodge" }
  | { type: "action"; action: "dash" | "disengage" | "hide" | "help" | "grapple" | "shove"; targetEnemyId?: string; targetCharacterId?: string; cunningAction?: boolean }
  | { type: "pet"; petName: string; attack: string; targetEnemyId: string }
  | { type: "pet_order"; petName: string; order: string }
  | { type: "spell"; spell: string; slotLevel?: number; targetId: string }
  | { type: "feature"; feature: string; targetId?: string }
  | { type: "resource"; resource: string; targetCharacterId?: string }
  | { type: "item"; item: string; targetCharacterId: string };

export type CombatTurnIntent = {
  encounterId: string;
  round: number;
  turnIndex: number;
  choices: CombatChoice[];
};

export function combatChoiceLabel(choice: CombatChoice, language: "ru" | "en", names: ReadonlyMap<string, string> = new Map()): string {
  const ru = language === "ru";
  const target = (id?: string) => id ? ` → ${names.get(id) ?? (ru ? "цель" : "target")}` : "";
  if (choice.type === "attack") return `${ru ? "Атака" : "Attack"}: ${choice.weapon === "Unarmed strike" && ru ? "Безоружный удар" : choice.weapon}${target(choice.targetEnemyId)}${choice.sneakAttack ? (ru ? " · Скрытая атака" : " · Sneak Attack") : ""}`;
  if (choice.type === "dodge") return ru ? "Защита: уклонение" : "Defence: Dodge";
  if (choice.type === "action") {
    const labels = ru
      ? { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помощь", grapple: "Захват", shove: "Толчок" }
      : { dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help", grapple: "Grapple", shove: "Shove" };
    const prefix = choice.cunningAction ? (ru ? "Хитрое действие: " : "Cunning Action: ") : "";
    return `${prefix}${labels[choice.action]}${target(choice.targetEnemyId ?? choice.targetCharacterId)}`;
  }
  if (choice.type === "spell") return `${ru ? "Заклинание" : "Spell"}: ${choice.spell}${choice.slotLevel ? ` (${ru ? "ячейка" : "slot"} ${choice.slotLevel})` : ""}${target(choice.targetId)}`;
  if (choice.type === "feature") return `${choice.feature}${target(choice.targetId)}`;
  if (choice.type === "resource") {
    const labels: Record<string, string> = ru
      ? { second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук" }
      : { second_wind: "Second Wind", rage: "Rage", bardic_inspiration: "Bardic Inspiration", lay_on_hands: "Lay on Hands" };
    return `${labels[choice.resource] ?? choice.resource}${target(choice.targetCharacterId)}`;
  }
  if (choice.type === "item") return `${ru ? "Предмет" : "Item"}: ${choice.item}${target(choice.targetCharacterId)}`;
  if (choice.type === "pet") return `${choice.petName}: ${choice.attack}${target(choice.targetEnemyId)}`;
  return `${ru ? "Приказ" : "Order"}: ${choice.petName} — ${choice.order}`;
}

export type CombatIntentSheet = {
  id: string;
  name: string;
  class?: string;
  proficiencies?: { languages?: string[] };
  equipment: Array<{ name: string; qty: number; equipped?: boolean; gear?: { weapon?: unknown } }>;
  resources: Record<string, { max: number; used: number }>;
  pets?: PetCombatant[];
  features?: Array<{ name: string; description?: string; classId?: string }>;
  spellcasting?: Spellcasting;
};

export type CombatSpellTarget = "enemy" | "ally" | "self";
export type CombatSpellDescriptor = { type: "spell"; name: string; level: number | null; cost: ActionKind | null; target?: CombatSpellTarget | null };

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

function resolvedFeatureEffects(sheet: CombatIntentSheet) {
  return effectsFor({ class: sheet.class ?? "", features: sheet.features ?? [] });
}

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
  presentation?: { language: string; names: ReadonlyMap<string, string>; spells?: CombatSpellDescriptor[] },
): CombatIntentResult {
  let next = budget;
  const selections: string[] = [];
  const usedResources: Record<string, number> = {};
  const usedItems: Record<string, number> = {};
  const usedSlots = new Map<number, number>();
  const commandedPets = new Set<string>();
  const featureEffects = resolvedFeatureEffects(sheet);
  const hasSneakAttack = featureEffects.some(({ effect }) => effect.kind === "sneak_attack");
  let sneakAttackUsed = budget.oncePerTurn.includes("sneak_attack");
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
      if (!spell.target || spell.cost === null || spell.cost === "reaction" || spell.level === null) return { ok: false, error: "This spell is not available in the structured combat builder." };
      if (spell.target === "enemy" && !visibleEnemyIds.has(choice.targetId)) return { ok: false, error: "Choose a visible enemy spell target." };
      if (spell.target === "ally" && !allyIds.has(choice.targetId)) return { ok: false, error: "Choose an ally spell target." };
      if (spell.target === "self" && choice.targetId !== sheet.id) return { ok: false, error: "This spell targets only its caster." };
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
      selections.push(`${ru ? "Заклинание" : "Spell"}: ${spell.name}${choice.slotLevel ? ` (${ru ? "ячейка" : "slot"} ${choice.slotLevel})` : ""}; ${copy.target}: ${name(choice.targetId)}`);
    } else if (choice.type === "feature") {
      return { ok: false, error: "Unstructured feature requests are not available during combat; choose a supported action." };
    } else if (choice.type === "pet_order") {
      const pet = sheet.pets?.find(entry => entry.name === choice.petName);
      if (!pet || pet.hp <= 0 || !choice.order.trim() || choice.order.length > 500 || commandedPets.has(pet.name) || next.oncePerTurn.includes(`pet:${pet.name.toLowerCase()}`)) return { ok: false, error: "Choose your living pet and enter one order." };
      commandedPets.add(pet.name);
      // A free-text order is an intent, never a free mechanical pet action.
      selections.push(`${ru ? "Приказ" : "Order"}: ${pet.name} — ${choice.order.trim()}; ${adjudication}`);
    } else if (choice.type === "attack") {
      if (!visibleEnemyIds.has(choice.targetEnemyId)) return { ok: false, error: "Choose a visible living enemy." };
      if (!knownWeapon(sheet, choice.weapon)) return { ok: false, error: "Choose a weapon on your character sheet." };
      if (choice.sneakAttack && !hasSneakAttack) return { ok: false, error: "This character has no Sneak Attack feature." };
      if (choice.sneakAttack && sneakAttackUsed) return { ok: false, error: "Sneak Attack can be declared only once per turn." };
      const spent = spendAttack(next, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      if (choice.sneakAttack) sneakAttackUsed = true;
      selections.push(`${copy.attack}: ${choice.weapon}; ${copy.target}: ${name(choice.targetEnemyId)}${choice.sneakAttack ? `; ${ru ? "Скрытая атака, если соблюдены условия" : "Sneak Attack, if eligible"}` : ""}`);
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
      const cunningActions = ["dash", "disengage", "hide"];
      if (choice.cunningAction && (!cunningActions.includes(choice.action) || !hasCunningAction(sheet))) return { ok: false, error: "Cunning Action requires that feature and can only Dash, Disengage or Hide." };
      if (specialAttack && (!visibleEnemyIds.has(choice.targetEnemyId ?? "") || choice.targetCharacterId)) return { ok: false, error: "Choose a visible enemy." };
      if (choice.action === "help" && (!allyIds.has(choice.targetCharacterId ?? "") || choice.targetCharacterId === sheet.id || choice.targetEnemyId)) return { ok: false, error: "Help requires another ally." };
      if (!specialAttack && choice.action !== "help" && (choice.targetCharacterId || choice.targetEnemyId)) return { ok: false, error: "This action does not take a target." };
      const spent = specialAttack
        ? spendAttack(next, sheet.name, false)
        : spendAction(next, choice.cunningAction ? "bonus" : "action", choice.action, sheet.name, !choice.cunningAction && ["dash", "hide", "disengage"].includes(choice.action));
      if (!spent.ok) return spent;
      next = spent.budget;
      const labels = { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помощь", grapple: "Захват", shove: "Толчок" };
      const prefix = choice.cunningAction ? (ru ? "Хитрое действие: " : "Cunning Action: ") : "";
      selections.push(`${prefix}${presentation?.language === "ru" ? labels[choice.action] : choice.action}${choice.targetEnemyId || choice.targetCharacterId ? `; ${copy.target}: ${name(choice.targetEnemyId ?? choice.targetCharacterId!)}` : ""}`);
    } else if (choice.type === "resource") {
      const state = Object.hasOwn(sheet.resources, choice.resource) ? sheet.resources[choice.resource] : undefined;
      const action = Object.hasOwn(RESOURCE_ACTIONS, choice.resource) ? RESOURCE_ACTIONS[choice.resource] : undefined;
      if (!action || !state || state.used + (usedResources[choice.resource] ?? 0) >= state.max) return { ok: false, error: "Choose an available supported resource." };
      if (action.target !== "self" && !choice.targetCharacterId) return { ok: false, error: "Choose an eligible ally for that resource." };
      if (action.target === "self" && choice.targetCharacterId && choice.targetCharacterId !== sheet.id) return { ok: false, error: "This resource targets only its owner." };
      const target = action.target === "self" ? sheet.id : choice.targetCharacterId!;
      if (!allyIds.has(target) || (action.target === "other" && target === sheet.id)) return { ok: false, error: "Choose an eligible ally for that resource." };
      const spent = spendAction(next, action.cost, action.name, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      usedResources[choice.resource] = (usedResources[choice.resource] ?? 0) + 1;
      selections.push(`${copy.resource}: ${action.name}; ${copy.target}: ${name(target)}`);
    } else {
      const item = sheet.equipment.find((entry) => entry.name === choice.item && entry.qty > 0);
      if (!item || !consumableName.test(item.name) || item.qty <= (usedItems[item.name] ?? 0)) return { ok: false, error: "Choose an available consumable." };
      if (!choice.targetCharacterId || !allyIds.has(choice.targetCharacterId)) return { ok: false, error: "Choose an eligible ally for that item." };
      const spent = spendAction(next, "action", `use ${item.name}`, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      usedItems[item.name] = (usedItems[item.name] ?? 0) + 1;
      selections.push(`${copy.item}: ${item.name}; ${copy.target}: ${name(choice.targetCharacterId ?? sheet.id)}`);
    }
  }
  const declaration = selections.length
    ? `${ru ? "Явно выбранные действия (приоритет применения)" : "Explicitly queued actions (application priority)"}:\n${selections.map((selection, index) => `${index + 1}. ${selection}`).join("\n")}`
    : (ru ? "Пропускаю ход." : "I pass my turn.");
  return {
    ok: true,
    budget: next,
    content: `${copy.turn}: ${sheet.name}\n${declaration}\n\n${copy.end}`,
  };
}
