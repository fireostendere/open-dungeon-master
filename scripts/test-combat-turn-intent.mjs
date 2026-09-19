import assert from "node:assert/strict";
import { freshBudget } from "../src/lib/dm/action-budget.ts";
import { combatChoiceDescriptors, validateCombatTurnIntent } from "../src/lib/dm/combat-turn-intent.ts";

const sheet = {
  id: "hero", name: "Vex", equipment: [{ name: "Longsword", qty: 1 }, { name: "Potion of Healing", qty: 2 }],
  resources: { second_wind: { max: 1, used: 0 } },
};
const budget = () => freshBudget({ ownerId: sheet.id, round: 1, attacksAllowed: 2 });
const intent = (choices) => ({ encounterId: "encounter", round: 1, turnIndex: 0, choices });

assert.equal(validateCombatTurnIntent(intent([{ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }, { type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).ok, true);
assert.match(validateCombatTurnIntent(intent([{ type: "attack", targetEnemyId: "hidden", weapon: "Longsword" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).error, /visible/);
assert.match(validateCombatTurnIntent(intent([{ type: "item", item: "Potion of Healing" }, { type: "dodge" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).error, /already used their action/);
assert.equal(validateCombatTurnIntent(intent([{ type: "resource", resource: "second_wind" }]), sheet, new Set(["enemy"]), new Set(["hero"]), budget()).ok, true);
const check = (choices, source = sheet) => validateCombatTurnIntent(intent(choices), source, new Set(["enemy"]), new Set(["hero", "ally"]), budget());
assert.equal(check([{ type: "attack", targetEnemyId: "enemy", weapon: "Longsword" }, { type: "resource", resource: "second_wind" }]).budget.bonusUsed, true);
assert.equal(check([{ type: "resource", resource: "second_wind" }, { type: "resource", resource: "second_wind" }]).ok, false);
assert.equal(check([{ type: "resource", resource: "bardic_inspiration", targetCharacterId: "hero" }], { ...sheet, resources: { bardic_inspiration: { max: 3, used: 0 } } }).ok, false);
assert.equal(combatChoiceDescriptors(sheet).some(choice => choice.type === "item" && choice.name === "Longsword"), false);
assert.equal(check([{ type: "item", item: "Longsword" }]).ok, false);
console.log("test-combat-turn-intent: 9 passed");
