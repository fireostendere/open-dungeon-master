import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { freshBudget } = await import("../src/lib/dm/action-budget.ts");
const { combatChoiceDescriptors, combatChoiceLabel, combatIntentBudget, combatSpellNames, combatSpellSlots, validateCombatTurnIntent } = await import("../src/lib/dm/combat-turn-intent.ts");

const sheet = {
  id: "hero", name: "Vex", equipment: [{ name: "Longsword", qty: 1 }, { name: "Potion of Healing", qty: 2 }],
  resources: { second_wind: { max: 1, used: 0 } },
};
const budget = () => freshBudget({ ownerId: sheet.id, round: 1, attacksAllowed: 2 });
const intent = (choices) => ({ encounterId: "encounter", round: 1, turnIndex: 0, choices });

const fighterWithExtraAttack = { ...sheet, class: 'fighter', level: 5, features: [{ name: 'Extra Attack' }] };
assert.equal(validateCombatTurnIntent(intent([{ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }, { type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }]), fighterWithExtraAttack, new Set(["enemy"]), new Set(["hero"]), budget()).ok, true);
assert.equal(combatChoiceDescriptors(fighterWithExtraAttack).some(choice => choice.type === 'feature' && choice.name === 'Extra Attack'), false, 'Extra Attack is part of attack capacity, not a separate queued action');
assert.equal(validateCombatTurnIntent(intent([{ type: 'feature', feature: 'Extra Attack' }]), fighterWithExtraAttack, new Set(['enemy']), new Set(['hero']), budget()).ok, false);
const oneAttackBudget = freshBudget({ ownerId: sheet.id, round: 1, attacksAllowed: 1 });
assert.equal(validateCombatTurnIntent(intent([{ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }, { type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }]), sheet, new Set(["enemy"]), new Set(["hero"]), oneAttackBudget).ok, false, 'a character without Extra Attack cannot queue a second swing');
assert.equal(validateCombatTurnIntent(intent(Array.from({ length: 3 }, () => ({ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }))), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).ok, false, 'Extra Attack does not permit more swings than the sheet grants');
assert.match(validateCombatTurnIntent(intent([{ type: "attack", targetEnemyId: "hidden", weapon: "Longsword" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).error, /visible/);
assert.match(validateCombatTurnIntent(intent([{ type: "item", item: "Potion of Healing" }, { type: "dodge" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).error, /already used their action/);
assert.equal(validateCombatTurnIntent(intent([{ type: "resource", resource: "second_wind" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).ok, true);
const check = (choices, source = sheet) => validateCombatTurnIntent(intent(choices), source, new Set(["enemy"]), new Set(["hero", "ally"]), budget());
assert.equal(check([{ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }, { type: "resource", resource: "second_wind" }]).budget.bonusUsed, true);
assert.equal(check([{ type: "resource", resource: "second_wind" }, { type: "resource", resource: "second_wind" }]).ok, false);
assert.equal(check([{ type: "resource", resource: "bardic_inspiration", targetCharacterId: "hero" }], { ...sheet, resources: { bardic_inspiration: { max: 3, used: 0 } } }).ok, false);
assert.equal(combatChoiceDescriptors(sheet).some(choice => choice.type === "item" && choice.name === "Longsword"), false);
assert.equal(check([{ type: "item", item: "Longsword" }]).ok, false);
const pet = { name: 'Fedya', kind: 'drake', hp: 12, attacks: [{ name: 'Bite', toHit: 4, damage: '1d6+2', type: 'piercing' }] };
const petChoice = { type: 'pet', petName: 'Fedya', attack: 'Bite', targetEnemyId: 'enemy' };
assert.equal(check([petChoice, { type: 'attack', targetEnemyId: 'enemy', weapon: 'Longsword' }], { ...sheet, pets: [pet] }).ok, true);
assert.equal(check([petChoice, petChoice], { ...sheet, pets: [pet] }).ok, false);
assert.equal(check([petChoice], { ...sheet, pets: [{ ...pet, hp: 0 }] }).ok, false);
assert.equal(check([{ type: 'action', action: 'grapple', targetEnemyId: 'enemy' }, { type: 'attack', targetEnemyId: 'enemy', weapon: 'Longsword' }]).ok, true);
assert.equal(check([{ type: 'action', action: 'help', targetCharacterId: 'hero' }]).ok, false);
assert.equal(check([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Longsword' }], { ...sheet, equipment: [{ name: 'Longsword', qty: 1, equipped: false }] }).ok, false);
const rogue = { ...sheet, class: 'rogue', level: 5, features: [{ name: 'Sneak Attack' }], equipment: [{ name: 'Dagger', qty: 1 }] };
const rogueCheck = choices => validateCombatTurnIntent(intent(choices), rogue, new Set(['enemy']), new Set(['hero']), oneAttackBudget, { language: 'ru', names: new Map([['enemy', 'Дьявол']]) });
assert.equal(combatChoiceDescriptors(rogue).some(choice => choice.type === 'feature' && choice.name === 'Sneak Attack'), false, 'an attack rider is not offered as a separate action');
const rogueWithCant = { ...rogue, proficiencies: { languages: ['Common', "Thieves' Cant"] }, features: [...rogue.features, { name: "Thieves' Cant" }] };
assert.equal(combatChoiceDescriptors(rogueWithCant).some(choice => choice.type === 'feature' && choice.name === "Thieves' Cant"), false, 'languages are not offered as standalone combat features');
assert.equal(validateCombatTurnIntent(intent([{ type: 'feature', feature: "Thieves' Cant", targetId: 'enemy' }]), rogueWithCant, new Set(['enemy']), new Set(['hero']), oneAttackBudget).ok, false, 'the server rejects a language queued as a combat action');
assert.equal(rogueCheck([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger' }, { type: 'feature', feature: 'Sneak Attack' }]).ok, false, 'cannot queue Sneak Attack as a second standalone action');
assert.equal(rogueCheck([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger', sneakAttack: true }]).ok, true, 'Sneak Attack rides the declared weapon attack');
assert.match(rogueCheck([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger', sneakAttack: true }]).content, /Атака: Dagger; цель: Дьявол; Скрытая атака/);
assert.equal(combatChoiceLabel({ type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger', sneakAttack: true }, 'ru', new Map([['enemy', 'Дьявол']])), 'Атака: Dagger → Дьявол · Скрытая атака');
assert.equal(check([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Longsword', sneakAttack: true }]).ok, false, 'a character without the feature cannot request the rider');
assert.equal(rogueCheck([{ type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger', sneakAttack: true }, { type: 'attack', targetEnemyId: 'enemy', weapon: 'Dagger', sneakAttack: true }]).ok, false, 'Sneak Attack is once per turn even with Extra Attack');
const spentBudget = { actionUsed: true, bonusUsed: true, reactionUsed: false, attacksMade: 2, attacksAllowed: 2, oncePerTurn: ['pet:fedya'] };
assert.equal(combatIntentBudget({ currentActorId: 'other', turnBudget: spentBudget }, budget()).bonusUsed, false, 'do not borrow another actor budget');
const shared = combatIntentBudget({ currentActorId: 'hero', turnBudget: spentBudget }, budget());
assert.equal(shared.bonusUsed, true);
assert.deepEqual(shared.oncePerTurn, ['pet:fedya']);
// Regression: the live warlock has no class resources and exhausted slots,
// but still needs cantrips, sheet features and a non-attack familiar order.
const warlock = { ...sheet, equipment: [{ name: 'Кинжал', qty: 1 }], resources: {},
  features: [{ name: 'Pact Boon: Pact of the Chain' }],
  spellcasting: { ability: 'cha', known: ['Eldritch Blast', 'Hex'], prepared: ['Eldritch Blast', 'Hex'], slots: { 2: { max: 2, used: 2 } } },
  pets: [{ ...pet, name: 'Федя', kind: 'familiar' }],
};
const spells = [
  { type: 'spell', name: 'Eldritch Blast', level: 0, cost: 'action' },
  { type: 'spell', name: 'Hex', level: 1, cost: 'bonus' },
];
const cast = { type: 'spell', spell: 'Eldritch Blast', targetId: 'enemy' };
const order = { type: 'pet_order', petName: 'Федя', order: 'Стань невидимым и разведай проход' };
const warlockCheck = (choices, source = warlock) => validateCombatTurnIntent(intent(choices), source, new Set(['enemy']), new Set(['hero']), budget(), { language: 'ru', names: new Map([['enemy', 'Дьявол']]), spells });
assert.ok(combatChoiceDescriptors(warlock).some(entry => entry.type === 'feature' && entry.name === warlock.features[0].name), 'features must not disappear when resources is empty');
assert.equal(warlockCheck([cast, order]).ok, true, 'exhausted slots do not block cantrips or declarative pet orders');
assert.match(warlockCheck([cast, order]).content, /Eldritch Blast.*Дьявол/);
assert.match(warlockCheck([cast, order]).content, /Федя.*Стань невидимым/);
assert.equal(warlockCheck([{ ...cast, spell: 'Fireball' }]).ok, false, 'cannot inject an unknown spell');
assert.equal(warlockCheck([{ ...cast, targetId: 'hidden' }]).ok, false);
assert.equal(warlockCheck([{ type: 'spell', spell: 'Hex', slotLevel: 2, targetId: 'enemy' }]).ok, false, 'cannot queue exhausted slots');
assert.equal(warlockCheck([cast, { type: 'attack', weapon: 'Кинжал', targetEnemyId: 'enemy' }]).ok, false, 'cantrip spends the action');
assert.equal(warlockCheck([cast, { type: 'pet', petName: 'Федя', attack: 'Bite', targetEnemyId: 'enemy' }]).ok, false, 'Chain attack replaces an attack, not a free bonus action');
assert.equal(warlockCheck([{ ...order, petName: 'Someone else' }]).ok, false);
assert.equal(warlockCheck([order, order]).ok, false);
assert.equal(warlockCheck([order], { ...warlock, pets: [{ ...warlock.pets[0], hp: 0 }] }).ok, false);
assert.equal(warlockCheck([{ type: 'feature', feature: warlock.features[0].name }]).ok, true);
assert.equal(warlockCheck([{ type: 'feature', feature: 'Invented power' }]).ok, false);
const rested = { ...warlock, spellcasting: { ...warlock.spellcasting, slots: { 2: { max: 2, used: 1 } } } };
const hex = { type: 'spell', spell: 'Hex', slotLevel: 2, targetId: 'enemy' };
assert.equal(warlockCheck([cast, hex], rested).ok, true, 'action cantrip plus bonus spell');
assert.equal(warlockCheck([hex, cast], rested).ok, true, 'same legal combo in the other order');
assert.equal(warlockCheck([hex, hex], rested).ok, false, 'cannot overdraw slots in a draft');
assert.deepEqual(combatSpellSlots({ ...warlock, spellcasting: { ...warlock.spellcasting, pact: { level: 2, max: 2, used: 1 } } }, 1), [{ level: 2, left: 1 }]);
assert.deepEqual(combatSpellNames({ ...warlock, spellcasting: { ...warlock.spellcasting, casters: [{ known: ['Healing Word'], prepared: ['Hex'] }] } }), ['Eldritch Blast', 'Hex', 'Healing Word']);
assert.equal(validateCombatTurnIntent(intent([order]), warlock, new Set(['enemy']), new Set(['hero']), { ...budget(), oncePerTurn: ['pet:федя'] }).ok, false);
assert.deepEqual(warlock.spellcasting.slots, { 2: { max: 2, used: 2 } }, 'draft never changes the sheet');
const freeText = validateCombatTurnIntent({ ...intent([]), prose: 'Врежу дьяволу кинжалом, чтоб искры из задницы!' }, warlock,
  new Set(['enemy']), new Set(['hero']), budget(), { language: 'ru', names: new Map(), spells });
assert.equal(freeText.ok, true);
assert.match(freeText.content, /Свободная заявка/);
assert.doesNotMatch(freeText.content, /Eldritch Blast|Pact Boon/, 'browsing / possessing an ability is never a declared action');
const explicit = warlockCheck([cast]);
assert.match(explicit.content, /Явно выбранные действия/);
assert.match(explicit.content, /Без дополнительного описания/);
console.log('test-combat-turn-intent: passed');
