import { spendAction, spendAttack, spendSpell, type ActionKind, type TurnBudget } from "./action-budget.ts";
import { RESOURCE_ACTIONS } from "./resource-action-cost.ts";
import { matchWeapon, type SrdWeapon } from "../srd/weapons.ts";
import { spendPetCommand, type PetCombatant } from "./pet-combat.ts";
import type { PublicEncounter } from "../db/encounter-view.ts";
import type { Spellcasting } from "../schemas/sheet.ts";
import { effectsFor, hasCunningAction, hasFeat } from "../srd/feature-effects.ts";
import { attackWeaponUse, bonusAttackError, type BonusAttackKind } from "./bonus-attacks.ts";
import type { AttackWeaponUse } from "./action-budget.ts";

// Both combat panels preview the same authoritative budget, never another actor's.
export function combatIntentBudget(encounter: Pick<PublicEncounter, "currentActorId" | "turnBudget">, fresh: TurnBudget): TurnBudget {
  return encounter.currentActorId === fresh.ownerId && encounter.turnBudget
    ? { ...fresh, ...encounter.turnBudget, oncePerTurn: encounter.turnBudget.oncePerTurn ?? [] }
    : fresh;
}

export type CombatChoice =
  | {
      type: "attack";
      targetEnemyId?: string;
      targetCharacterId?: string;
      weapon: string;
      sneakAttack?: boolean;
      // A bonus-action swing after the Attack action (two-weapon fighting,
      // Polearm Master, Crossbow Expert, Great Weapon Master). A Great
      // Weapon Master swing may leave the target open: the nearest enemy.
      bonusAttack?: BonusAttackKind;
      // Great Weapon Master / Sharpshooter: -5 to hit, +10 damage.
      powerAttack?: boolean;
      // Lucky feat: a luck point for an extra d20 on this attack roll.
      lucky?: boolean;
    }
  | { type: "dodge" }
  | { type: "action"; action: "dash" | "disengage" | "hide" | "help" | "grapple" | "shove"; targetEnemyId?: string; targetCharacterId?: string; cunningAction?: boolean }
  | { type: "pet"; petName: string; attack: string; targetEnemyId: string }
  | { type: "pet_order"; petName: string; order: string }
  | { type: "spell"; spell: string; slotLevel?: number; targetId: string }
  | { type: "feature"; feature: string; targetId?: string }
  | { type: "resource"; resource: string; targetCharacterId?: string }
  | { type: "item"; item: string; targetCharacterId: string }
  // Requests the DM adjudicates with engine rolls (talk, run, anything
  // improvised); each spends the action.
  | { type: "parley"; approach: ParleyApproach; targetEnemyId?: string }
  | { type: "flee" }
  | { type: "improvise"; text: string };

export const PARLEY_APPROACHES = ["persuade", "intimidate", "deceive"] as const;
export type ParleyApproach = (typeof PARLEY_APPROACHES)[number];
const PARLEY_LABELS = {
  ru: { persuade: "убедить", intimidate: "запугать", deceive: "обмануть" },
  en: { persuade: "persuade", intimidate: "intimidate", deceive: "deceive" },
};
export const BONUS_ATTACK_LABELS: Record<"ru" | "en", Record<BonusAttackKind, string>> = {
  ru: { off_hand: "вторая рука", pole_strike: "удар древком", crossbow_expert: "ручной арбалет", great_weapon_master: "Мастер большого оружия" },
  en: { off_hand: "off-hand", pole_strike: "butt strike", crossbow_expert: "hand crossbow", great_weapon_master: "Great Weapon Master" },
};

export type CombatTurnIntent = {
  encounterId: string;
  round: number;
  turnIndex: number;
  choices: CombatChoice[];
  description?: string;
};

export function combatChoiceLabel(
  choice: CombatChoice,
  language: "ru" | "en",
  names: ReadonlyMap<string, string> = new Map(),
  // Display names for weapons, items and spells (the sheet stores SRD names).
  localize: (kind: "item" | "spell", name: string) => string = (_kind, name) => name,
): string {
  const ru = language === "ru";
  const target = (id?: string) => id ? ` → ${names.get(id) ?? (ru ? "цель" : "target")}` : "";
  if (choice.type === "parley") return `${ru ? "Переговоры" : "Parley"} (${PARLEY_LABELS[language][choice.approach]})${choice.targetEnemyId ? target(choice.targetEnemyId) : ru ? " → все враги" : " → all enemies"}`;
  if (choice.type === "flee") return ru ? "Бегство с поля боя" : "Flee the fight";
  if (choice.type === "improvise") return `${ru ? "Своё действие" : "Own action"}: ${choice.text}`;
  if (choice.type === "attack") {
    const bonus = choice.bonusAttack;
    const gwmOpen = bonus === "great_weapon_master" && !choice.targetEnemyId && !choice.targetCharacterId;
    return `${bonus ? `${ru ? "Бонусная атака" : "Bonus attack"} (${BONUS_ATTACK_LABELS[language][bonus]})` : ru ? "Атака" : "Attack"}: ${
      choice.weapon === "Unarmed strike" && ru ? "Безоружный удар" : localize("item", choice.weapon)
    }${gwmOpen ? (ru ? " → ближайший враг" : " → nearest enemy") : target(choice.targetEnemyId ?? choice.targetCharacterId)}${
      bonus === "great_weapon_master" ? (ru ? " · если крит или убийство" : " · if a crit or kill") : ""
    }${choice.powerAttack ? (ru ? " · −5/+10" : " · −5/+10") : ""}${choice.lucky ? (ru ? " · удача" : " · luck") : ""}${
      choice.sneakAttack ? (ru ? " · Скрытая атака" : " · Sneak Attack") : ""
    }`;
  }
  if (choice.type === "dodge") return ru ? "Защита: уклонение" : "Defence: Dodge";
  if (choice.type === "action") {
    const labels = ru
      ? { dash: "Рывок", disengage: "Отход", hide: "Скрыться", help: "Помощь", grapple: "Захват", shove: "Толчок" }
      : { dash: "Dash", disengage: "Disengage", hide: "Hide", help: "Help", grapple: "Grapple", shove: "Shove" };
    const prefix = choice.cunningAction ? (ru ? "Хитрое действие: " : "Cunning Action: ") : "";
    return `${prefix}${labels[choice.action]}${target(choice.targetEnemyId ?? choice.targetCharacterId)}`;
  }
  if (choice.type === "spell") return `${ru ? "Заклинание" : "Spell"}: ${localize("spell", choice.spell)}${choice.slotLevel ? ` (${ru ? "ячейка" : "slot"} ${choice.slotLevel})` : ""}${target(choice.targetId)}`;
  if (choice.type === "feature") return `${choice.feature}${target(choice.targetId)}`;
  if (choice.type === "resource") {
    const labels: Record<string, string> = ru
      ? { second_wind: "Второе дыхание", rage: "Ярость", bardic_inspiration: "Бардовское вдохновение", lay_on_hands: "Наложение рук" }
      : { second_wind: "Second Wind", rage: "Rage", bardic_inspiration: "Bardic Inspiration", lay_on_hands: "Lay on Hands" };
    return `${labels[choice.resource] ?? choice.resource}${target(choice.targetCharacterId)}`;
  }
  if (choice.type === "item") return `${ru ? "Предмет" : "Item"}: ${localize("item", choice.item)}${target(choice.targetCharacterId)}`;
  if (choice.type === "pet") return `${choice.petName}: ${choice.attack}${target(choice.targetEnemyId)}`;
  return `${ru ? "Приказ" : "Order"}: ${choice.petName} — ${choice.order}`;
}

export type CombatIntentSheet = {
  id: string;
  name: string;
  class?: string;
  feats?: string[];
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
  return [...new Set([...(casting?.cantrips ?? []), ...(casting?.known ?? []), ...(casting?.prepared ?? []),
    ...(casting?.casters ?? []).flatMap(caster => [...(caster.cantrips ?? []), ...caster.known, ...caster.prepared])])];
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

// The SRD row for a weapon on the sheet, and what it is for the bonus-attack
// rules; unarmed strikes have no row.
function weaponOn(sheet: CombatIntentSheet, weapon: string): { srd: SrdWeapon | null; use: AttackWeaponUse; carried: number } {
  if (/^(unarmed strike|unarmed|fist|punch|kick)$/i.test(weapon)) {
    return { srd: null, use: { name: "Unarmed strike", melee: true, light: false, twoHanded: false, pole: false }, carried: 1 };
  }
  const items = sheet.equipment.filter((item) => item.qty > 0 && item.name === weapon);
  const srd = (items[0]?.gear?.weapon as SrdWeapon | undefined) ?? matchWeapon(weapon);
  return {
    srd,
    use: attackWeaponUse({ displayName: weapon, srd }),
    carried: items.reduce((sum, item) => sum + Math.max(1, item.qty), 0),
  };
}

const BONUS_FEATS: Partial<Record<BonusAttackKind, Parameters<typeof hasFeat>[1]>> = {
  pole_strike: "polearm master",
  crossbow_expert: "crossbow expert",
  great_weapon_master: "great weapon master",
};

export function validateCombatTurnIntent(
  intent: CombatTurnIntent,
  sheet: CombatIntentSheet,
  visibleEnemyIds: Set<string>,
  allyIds: Set<string>,
  budget: TurnBudget,
  presentation?: { language: string; names: ReadonlyMap<string, string>; spells?: CombatSpellDescriptor[]; friendlyFire?: boolean },
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
  // Attack-action swings so far (made this turn, then queued in the plan),
  // which the bonus-action attacks must follow.
  const attackSwings: AttackWeaponUse[] = [...(budget.attackWeapons ?? [])];
  const luck = sheet.resources.luck_points;
  let luckLeft = luck ? luck.max - luck.used : 0;
  const ru = presentation?.language === "ru";
  const adjudication = ru ? "заявка мастеру; стоимость и эффект определяются правилами" : "request for DM adjudication; rules determine cost and effect";
  const ruling = ru ? "заявка мастеру; исход решают правила и броски" : "request for DM adjudication; rules and rolls decide the outcome";
  const copy = presentation?.language === "ru"
    ? { turn: "Боевой ход", attack: "Атака", dodge: "Защита: уклонение", resource: "Способность", item: "Предмет", target: "цель", end: "Завершаю ход после разрешения указанных действий." }
    : { turn: "Combat turn", attack: "Attack", dodge: "Defence: Dodge", resource: "Ability", item: "Item", target: "target", end: "End my turn after resolving the declared actions." };
  const name = (id: string) => presentation?.names.get(id) ?? id;
  if (intent.choices.length > 12) return { ok: false, error: "Too many choices in one turn." };
  const description = intent.description?.trim();
  if (intent.description !== undefined && (!description || description.length > 2000 || !intent.choices.length)) {
    return { ok: false, error: "A description needs a selected action and must be 1–2000 characters." };
  }
  for (const choice of intent.choices) {
    if (choice.type === "spell") {
      const spell = presentation?.spells?.find(entry => entry.name === choice.spell);
      if (!combatSpellNames(sheet).includes(choice.spell) || !spell) return { ok: false, error: "Choose a spell on your character sheet." };
      if (!spell.target || spell.cost === null || spell.cost === "reaction" || spell.level === null) return { ok: false, error: "This spell is not available in the structured combat builder." };
      if (spell.target === "enemy" && !visibleEnemyIds.has(choice.targetId) && !(presentation?.friendlyFire && allyIds.has(choice.targetId) && choice.targetId !== sheet.id)) return { ok: false, error: "Choose a visible enemy spell target." };
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
      const bonus = choice.bonusAttack;
      const openTarget = bonus === "great_weapon_master" && !choice.targetEnemyId && !choice.targetCharacterId;
      if (!openTarget && (Boolean(choice.targetEnemyId) === Boolean(choice.targetCharacterId) ||
        (choice.targetCharacterId ? !presentation?.friendlyFire || !allyIds.has(choice.targetCharacterId) || choice.targetCharacterId === sheet.id : !visibleEnemyIds.has(choice.targetEnemyId!)))) {
        return { ok: false, error: "Choose a visible living enemy, or a party target when friendly fire is enabled." };
      }
      if (!knownWeapon(sheet, choice.weapon)) return { ok: false, error: "Choose a weapon on your character sheet." };
      if (choice.sneakAttack && !hasSneakAttack) return { ok: false, error: "This character has no Sneak Attack feature." };
      if (choice.sneakAttack && sneakAttackUsed) return { ok: false, error: "Sneak Attack can be declared only once per turn." };
      const weapon = weaponOn(sheet, choice.weapon);
      const neededFeat = bonus ? BONUS_FEATS[bonus] : undefined;
      if (neededFeat && !hasFeat(sheet, neededFeat)) return { ok: false, error: "This bonus-action attack needs a feat the character does not have." };
      if (bonus) {
        const complaint = bonus === "great_weapon_master"
          ? (!weapon.use.melee ? "Great Weapon Master's bonus attack is a melee weapon attack." : attackSwings.some((swing) => swing.melee) ? null : "Great Weapon Master's bonus attack follows a melee weapon attack this turn.")
          : bonusAttackError(bonus, weapon.use, attackSwings, { dualWielder: hasFeat(sheet, "dual wielder"), carried: weapon.carried, who: sheet.name });
        if (complaint) return { ok: false, error: complaint };
      }
      if (choice.powerAttack) {
        const heavyMelee = weapon.srd?.kind === "melee" && Boolean(weapon.srd.properties?.includes("heavy")) && hasFeat(sheet, "great weapon master");
        const rangedShot = weapon.srd?.kind === "ranged" && hasFeat(sheet, "sharpshooter");
        if (!heavyMelee && !rangedShot) return { ok: false, error: "-5/+10 needs Great Weapon Master with a heavy melee weapon or Sharpshooter with a ranged weapon." };
      }
      if (choice.lucky) {
        if (luckLeft < 1) return { ok: false, error: "No luck points left." };
        luckLeft -= 1;
      }
      const spent = bonus ? spendAction(next, "bonus", "a bonus-action attack", sheet.name) : spendAttack(next, sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      if (!bonus) attackSwings.push(weapon.use);
      if (choice.sneakAttack) sneakAttackUsed = true;
      const riders = [
        bonus ? `${ru ? "бонусное действие" : "bonus action"}: ${BONUS_ATTACK_LABELS[ru ? "ru" : "en"][bonus]}${bonus === "great_weapon_master" ? (ru ? ", только если в этот ход был крит или убийство в ближнем бою" : ", only after a melee critical hit or kill this turn") : ""}` : "",
        choice.powerAttack ? (ru ? "−5 к попаданию, +10 к урону" : "-5 to hit, +10 damage") : "",
        choice.lucky ? (ru ? "очко удачи: лишний к20" : "a luck point: an extra d20") : "",
        choice.sneakAttack ? (ru ? "Скрытая атака, если соблюдены условия" : "Sneak Attack, if eligible") : "",
      ].filter(Boolean);
      selections.push(`${copy.attack}: ${choice.weapon}; ${copy.target}: ${openTarget ? (ru ? "ближайший враг в досягаемости" : "the nearest enemy in reach") : name(choice.targetEnemyId ?? choice.targetCharacterId!)}${riders.map((rider) => `; ${rider}`).join("")}`);
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
    } else if (choice.type === "parley") {
      if (!PARLEY_APPROACHES.includes(choice.approach) || !visibleEnemyIds.size || (choice.targetEnemyId !== undefined && !visibleEnemyIds.has(choice.targetEnemyId))) {
        return { ok: false, error: "Choose how to talk and a visible enemy, or address them all." };
      }
      const spent = spendAction(next, "action", "a parley", sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`${ru ? "Переговоры" : "Parley"} (${PARLEY_LABELS[ru ? "ru" : "en"][choice.approach]}); ${copy.target}: ${choice.targetEnemyId ? name(choice.targetEnemyId) : ru ? "все враги" : "all enemies"}; ${ruling}`);
    } else if (choice.type === "flee") {
      // Running for it is a Dash or Disengage, so Haste's extra action can pay.
      const spent = spendAction(next, "action", "fleeing", sheet.name, true);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`${ru ? "Бегство с поля боя" : "Flee the fight"}; ${ruling}`);
    } else if (choice.type === "improvise") {
      const text = typeof choice.text === "string" ? choice.text.trim() : "";
      if (!text || text.length > 300) return { ok: false, error: "Describe your own action in 1–300 characters." };
      const spent = spendAction(next, "action", "an improvised action", sheet.name);
      if (!spent.ok) return spent;
      next = spent.budget;
      selections.push(`${ru ? "Своё действие" : "Own action"}: ${text}; ${ruling}`);
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
    content: `${copy.turn}: ${sheet.name}\n${declaration}${description ? `\n\n${ru ? "Описание игрока" : "Player description"}: ${description}` : ""}\n\n${copy.end}`,
  };
}
