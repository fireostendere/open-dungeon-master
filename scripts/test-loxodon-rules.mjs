import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { acBreakdownFor, findRace, sizeForRace } = await import("../src/lib/srd/index.ts");
const { racialTraitsFor } = await import("../src/lib/srd/features.ts");
const { unarmoredFormulaFor, computeArmorClass } = await import("../src/lib/srd/armor.ts");
const { encumbranceFor } = await import("../src/lib/srd/encumbrance.ts");
const { describeFeature, describeRace, describeRaceTrait } = await import("../src/lib/help/index.ts");
const { describeContentEntry } = await import("../src/lib/help/index.ts");
const { hasLoxodonKeenSmell, hasLoxodonSerenity } = await import("../src/lib/srd/feature-effects.ts");
const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");

const race = findRace("loxodon");
assert.ok(race, "Loxodon belongs to the selectable 2014 race catalog");
assert.deepEqual(race.asi, { con: 2, wis: 1 });
assert.equal(race.size, "Medium");
assert.equal(race.speed, 30);
assert.equal(race.nameRu, "Локсодон");
assert.equal(sizeForRace("Loxodon"), "Medium", "Powerful Build does not change creature size");
assert.equal(race.powerfulBuild, true);

const racialFeatures = racialTraitsFor("Loxodon");
assert.deepEqual(racialFeatures.map(({ name, source }) => [name, source]), [
  ["Loxodon Serenity", "race"],
  ["Natural Armor", "race"],
  ["Powerful Build", "race"],
  ["Trunk", "race"],
  ["Keen Smell", "race"],
]);

const naturalArmor = unarmoredFormulaFor("wizard", racialFeatures, "Loxodon");
assert.equal(naturalArmor?.source, "Loxodon Natural Armor");
assert.deepEqual(naturalArmor, {
  source: "Loxodon Natural Armor",
  base: 12,
  ability: "con",
  allowsShield: true,
  dexterity: false,
});

const ac = (equipment, unarmored = naturalArmor) => computeArmorClass({
  equipment,
  armorProfs: [],
  dexMod: 1,
  abilityMods: { con: 3, wis: 2 },
  strength: 8,
  unarmored,
});
assert.equal(ac([]).ac, 15);
assert.equal(ac([{ name: "Leather", equipped: true }]).ac, 12, "Loxodon Natural Armor only applies while not wearing armor");
assert.equal(ac([{ name: "Leather", equipped: true }, { name: "Shield", equipped: true }]).ac, 14);
assert.equal(ac([{ name: "Half Plate", equipped: true }]).ac, 16, "better armor remains better");
assert.equal(ac([{ name: "Shield", equipped: true }]).ac, 17, "shields still add to Natural Armor");
assert.equal(acBreakdownFor({
  class: "wizard",
  race: "Loxodon",
  abilities: { str: 8, dex: 12, con: 16, int: 15, wis: 14, cha: 10 },
  proficiencies: { armor: [] },
  equipment: [],
  features: racialFeatures,
}).ac, 15, "the character sheet derives Loxodon AC without a manual override");
assert.equal(acBreakdownFor({
  class: "monk",
  race: "loxodon",
  abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 16, cha: 10 },
  proficiencies: { armor: [] },
  equipment: [],
  features: [...racialFeatures, { name: "Unarmored Defense", source: "class" }],
}).ac, 16, "Loxodon monks can use whichever unarmored AC formula is better");
const lizardNaturalArmor = unarmoredFormulaFor(
  "wizard",
  racialTraitsFor("lizardfolk"),
  "lizardfolk",
);
assert.equal(lizardNaturalArmor?.source, "Lizardfolk Natural Armor");
assert.equal(ac([], lizardNaturalArmor).ac, 14);
assert.equal(ac([{ name: "Leather", equipped: true }], lizardNaturalArmor).ac, 12);

const rollSheet = {
  id: "loxodon-test",
  name: "Test Loxodon",
  race: "loxodon",
  class: "wizard",
  subclass: "",
  level: 1,
  abilities: { str: 10, dex: 10, con: 16, int: 14, wis: 12, cha: 10 },
  proficiencies: { saves: [], skills: ["perception"], expertise: [], armor: [], weapons: [], tools: [], languages: [] },
  equipment: [],
  gold: 0,
  features: racialFeatures,
  spellcasting: null,
  conditions: [],
  conditionMeta: {},
  exhaustion: 0,
};
assert.match(
  resolveRollExpression({ kind: "saving_throw", ability: "wis", against: "frightened" }, rollSheet).expression,
  /^2d20kh1/,
);
assert.match(
  resolveRollExpression({ kind: "saving_throw", ability: "wis", against: "charmed" }, rollSheet).expression,
  /^2d20kh1/,
);
assert.match(
  resolveRollExpression({ kind: "skill_check", skill: "perception", reason: "I track the scent" }, rollSheet).expression,
  /^2d20kh1/,
);
assert.match(
  resolveRollExpression({ kind: "skill_check", skill: "perception", reason: "I search the room" }, rollSheet).expression,
  /^1d20/,
);
assert.match(
  resolveRollExpression({ kind: "skill_check", skill: "investigation", reason: "Ищу по запаху" }, rollSheet).expression,
  /^2d20kh1/,
);

const burden = encumbranceFor({ strength: 8, equipment: [], size: "Medium", powerfulBuild: true });
assert.equal(burden.capacityLb, 240, "Powerful Build doubles carrying capacity without changing size");
assert.equal(burden.encumberedAtLb, 80, "Powerful Build doubles variant encumbrance thresholds");
assert.equal(burden.heavilyEncumberedAtLb, 160);

const raceText = describeRace("loxodon", "ru");
assert.ok(raceText?.includes("локсодон"));
for (const trait of race.traits) {
  assert.ok(describeRaceTrait("loxodon", trait, "ru")?.trim(), `missing Russian details: ${trait}`);
}
assert.match(describeRaceTrait("loxodon", "Natural Armor", "ru") ?? "", /когда вы не носите броню/i);
assert.doesNotMatch(describeRaceTrait("loxodon", "Natural Armor", "ru") ?? "", /надетая броня/i);
assert.match(describeRaceTrait("loxodon", "Trunk", "ru") ?? "", /безоружные удары/i);
assert.ok(describeFeature("wizard", "School of Necromancy", "Grim Harvest", "ru")?.includes("нежити"));
assert.equal(describeContentEntry({ desc: "English", desc_ru: "Русское описание" }, "ru"), "Русское описание");
assert.equal(hasLoxodonSerenity({ race: "Loxodon" }), true);
assert.equal(hasLoxodonKeenSmell({ race: "Loxodon" }), true);
console.log("PASS Loxodon catalog, traits, AC, Powerful Build and Russian help coverage");
