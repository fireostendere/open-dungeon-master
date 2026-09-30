// Which miniature stands for a token: Russian names reach the bestiary's
// English rules, sizes follow the word, and an unknown name is a person.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { figureInput, figureKey, figureScale, slugify } = await import("../src/lib/battlemap/figures.ts");
const { deriveCreatureSpec } = await import("../src/lib/bestiary3d/spec.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const planOf = (kind, name) => deriveCreatureSpec(figureInput(kind, name)).plan;

test("Russian creature names become the bestiary's own creatures", () => {
  const cases = [
    ["Гоблин", "biped"],
    ["Гоблин-лучник", "biped"],
    ["Волк", "quadruped"],
    ["Волки", "quadruped"],
    ["Огр", "biped"],
    ["Скелет", "biped"],
    ["Паук-охотник", "octopod"],
    ["Дракон", "dragon"],
    ["Костяной дракон", "dragon"],
    ["Слизь", "blob"],
    ["Призрак", "spirit"],
    ["Медведь", "quadruped"],
  ];
  for (const [name, plan] of cases) {
    const spec = deriveCreatureSpec(figureInput("enemy", name));
    assert.equal(spec.matchedBy, "name", `${name} is recognised by name`);
    assert.equal(spec.plan, plan, `${name} -> ${spec.plan}`);
  }
});

test("a word's size comes with it", () => {
  assert.equal(figureInput("enemy", "Огр").size, "large");
  assert.equal(figureInput("enemy", "Гоблин").size, "small");
  assert.equal(figureInput("enemy", "Великан").size, "huge");
  assert.equal(figureInput("enemy", "Бандит").size, "medium");
  assert.ok(figureScale("huge") > figureScale("large") && figureScale("large") > figureScale("medium") && figureScale("medium") > figureScale("small"));
  assert.equal(figureScale("no such size"), 1);
});

test("a short word is a word, not the start of another", () => {
  // "магистр" is not a mage by the letters "маг", and "левша" is not a lion.
  assert.equal(figureInput("enemy", "Левша").type, "humanoid");
  assert.doesNotMatch(figureInput("enemy", "Левша").name, /lion/);
  assert.doesNotMatch(figureInput("enemy", "Магистр").name, /mage/);
  assert.match(figureInput("enemy", "Лев").name, /lion/);
  assert.match(figureInput("enemy", "Маг").name, /mage/);
  assert.match(figureInput("enemy", "Магом").name, /mage/);
  assert.match(figureInput("enemy", "Тёмный маг").name, /mage/, "ё is read as е");
});

test("English names the bestiary already knows pass straight through", () => {
  assert.equal(planOf("enemy", "Wolf"), "quadruped");
  assert.equal(planOf("enemy", "Giant Spider"), "octopod");
  assert.equal(planOf("enemy", "Goblin"), "biped");
  assert.equal(planOf("enemy", "Ancient Red Dragon"), "dragon");
  assert.equal(deriveCreatureSpec(figureInput("enemy", "Wolf")).matchedBy, "name");
});

test("a name nothing matches is a person, never a random beast", () => {
  for (const name of ["Тёмный незнакомец", "Xyzzy", "Барон фон Штайн", "Юнга"]) {
    const input = figureInput("enemy", name);
    assert.equal(input.type, "humanoid");
    assert.equal(deriveCreatureSpec(input).plan, "biped", name);
  }
  assert.equal(planOf("npc", "Трактирщик"), "biped");
});

test("two goblins are one miniature, and a wolf is not a goblin", () => {
  assert.equal(figureKey("enemy", "Гоблин"), figureKey("enemy", " гоблин "));
  assert.notEqual(figureKey("enemy", "Гоблин"), figureKey("enemy", "Волк"));
  assert.notEqual(figureKey("enemy", "Гоблин"), figureKey("npc", "Гоблин"), "an ally and a foe are different models");
});

test("input is stable, so a model is the same every time it is built", () => {
  assert.deepEqual(figureInput("enemy", "Огр-берсерк"), figureInput("enemy", "Огр-берсерк"));
  assert.equal(slugify("Огр-берсерк"), "огр-берсерк");
  assert.equal(slugify("!!!"), "creature");
});

console.log(`battlemap figures: ${passed} tests passed`);
