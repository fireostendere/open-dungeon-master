// Real engine calls for the 5e rules audit fixes: reactions come back on the
// owner's turn (enemies included), "until your next turn" effects end then,
// Help covers an attack and never a save, dying heroes are unconscious,
// Action Surge buys a real action, magic weapons are magical, incapacitation
// and opportunity-attack damage reach concentration, and every casting-time
// spelling in the content parses.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

process.env.SQLITE_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-rules-")), "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, insertEnemy, getEncounter, getEnemy, saveEncounter, setEnemyConcentration } = await import("../src/lib/db/encounters.ts");
const { createBattleMap, placeTokens } = await import("../src/lib/db/battle-maps.ts");
const { handlePcAttack } = await import("../src/lib/dm/pc-attack.ts");
const { applyEncounterCall, skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { handleTakeAction } = await import("../src/lib/dm/action-tools.ts");
const { applyDmMutation } = await import("../src/lib/dm/mutations.ts");
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { castingCost, freshBudget, grantActionSurge, spendAction, spendAttack } = await import("../src/lib/dm/action-budget.ts");
const { attackContext, damageAdjust } = await import("../src/lib/dm/condition-logic.ts");
const { resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { resolveRollExpression } = await import("../src/lib/dm/rolls.ts");

// Queued die faces win over the real RNG (src/lib/dice.ts draws through
// crypto.getRandomValues), so the rolls that decide a branch are fixed.
const dice = [];
const realRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
globalThis.crypto.getRandomValues = (array) => {
  if (dice.length) {
    array[0] = dice.shift() - 1;
    return array;
  }
  return realRandom(array);
};

let checks = 0;
const test = (name, run) => { run(); checks += 1; console.log(`ok ${checks} - ${name}`); };

test("every casting-time spelling in the content parses to its cost", () => {
  for (const [time, cost] of [
    ["1 action", "action"], ["action", "action"], ["Action", "action"], ["1 bonus action", "bonus"], ["bonus-action", "bonus"],
    ["Bonus Action", "bonus"], ["reaction", "reaction"], ["1 reaction, which you take when you are hit", "reaction"],
    ["1 action, or 1 reaction that you take when", "action"], ["1 minute", null], ["10 minutes", null], ["1 hour", null], ["", null],
  ]) assert.equal(castingCost(time), cost, time);
});

test("plain incapacitated stops actions but does not open the target up", () => {
  const plain = attackContext({ attackerConditions: [], targetConditions: ["incapacitated"], melee: true, adjacent: true, requested: "none" });
  assert.equal(plain.advantage, "none");
  const stunned = attackContext({ attackerConditions: [], targetConditions: ["stunned"], melee: true, adjacent: true, requested: "none" });
  assert.equal(stunned.advantage, "advantage");
});

test("Action Surge: a whole second Attack action, spent after Haste's narrower one", () => {
  const swung = { ...freshBudget({ ownerId: "f", round: 1, attacksAllowed: 2 }), actionUsed: true, attacksMade: 2 };
  assert.equal(spendAttack(swung, "F").ok, false);
  const surged = grantActionSurge(swung, "F");
  assert.equal(surged.ok, true);
  assert.equal(grantActionSurge(surged.budget, "F").ok, false, "once per turn");
  const third = spendAttack(surged.budget, "F");
  assert.equal(third.ok, true);
  assert.equal(third.budget.attacksMade, 1);
  const fourth = spendAttack(third.budget, "F");
  assert.equal(fourth.ok, true, "Extra Attack rides the surged action");
  assert.equal(spendAttack(fourth.budget, "F").ok, false);
  const both = { ...surged.budget, extraActions: 1 };
  const dash = spendAction(both, "action", "Dash", "F", true);
  assert.deepEqual([dash.budget.extraActions, dash.budget.surgeActions], [0, 1], "Haste pays for the Dash, the surge stays");
  assert.equal(spendAction(both, "action", "Fireball", "F").budget.surgeActions, 0, "a spell needs the surge");
});

test("+1 weapons and attuned or homebrew magic weapons overcome nonmagical resistance", () => {
  const derived = { abilityMods: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, proficiencyBonus: 3 };
  const profile = (name, extra = {}) => weaponAttackProfile(derived, ["martial"],
    resolveAttackWeapon([{ name, qty: 1, equipped: true, ...extra }], ["martial"], name, { requireCarried: true }));
  assert.equal(profile("+1 Longsword").magical, true);
  assert.equal(profile("Longsword").magical, undefined);
  assert.equal(profile("Longsword", { attuned: true }).magical, true);
  const resist = "bludgeoning, piercing, and slashing from nonmagical attacks";
  assert.equal(damageAdjust(10, "slashing", resist, "", "", true).amount, 10);
  assert.equal(damageAdjust(10, "slashing", resist, "", "", false).amount, 5);
});

const owner = createUser("rules-owner", "x");
const campaign = createCampaign(owner.id, { title: "Rules", description: "", theme: "", maxPlayers: 4, startingLevel: 5, difficulty: "normal" });
const hero = (userName, input) => {
  const user = createUser(userName, "x");
  const sheet = createSheet(campaign.id, user.id, 5, createSheetSchema.parse({
    race: "human", maxHp: 60, ac: 12, hitDice: { die: "d10", total: 5, spent: 0 },
    proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    ...input,
  }));
  return { user, sheet };
};
const bram = hero("bram", {
  name: "Bram", class: "fighter", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const cass = hero("cass", {
  name: "Cass", class: "wizard", abilities: { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 10 },
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
});
const dain = hero("dain", {
  name: "Dain", class: "cleric", abilities: { str: 12, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
  equipment: [{ name: "Mace", qty: 1, equipped: true }],
});
const sheets = () => [bram, cass, dain].map(({ sheet }) => getSheetById(sheet.id));
const byId = () => new Map(sheets().map((sheet) => [sheet.id, sheet]));
const conditions = (who) => getSheetById(who.sheet.id).conditions;

test("Help gives advantage on a check, never on a saving throw", () => {
  const helped = { ...getSheetById(bram.sheet.id), conditions: ["helped"] };
  const save = resolveRollExpression({ kind: "saving_throw", ability: "dex" }, helped);
  assert.doesNotMatch(save.spendInspiration ?? "", /helped/);
  const check = resolveRollExpression({ kind: "skill_check", skill: "athletics" }, helped);
  assert.match(check.spendInspiration ?? "", /helped/);
  assert.match(check.expression, /^2d20kh1/);
});

const turn = createDmTurn(campaign.id, []);
const encounter = createEncounter(campaign.id, "Rules at the ford");
const orc = insertEnemy({
  campaignId: campaign.id, encounterId: encounter.id, slug: "orc", displayName: "Orc", initiative: 10,
  stats: { maxHp: 300, ac: 13, cr: 1, xp: 0, dexMod: 0, speed: "30 ft.", attacks: [{ name: "Greataxe", toHit: 5, damage: "1d12+3", type: "slashing", reach: 5 }], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "", saves: {} },
});
encounter.order = [
  { kind: "pc", characterId: bram.sheet.id, userId: bram.user.id, name: "Bram", initiative: 20 },
  { kind: "pc", characterId: cass.sheet.id, userId: cass.user.id, name: "Cass", initiative: 15 },
  { kind: "enemy", enemyId: orc.id, name: "Orc", initiative: 10 },
];
encounter.orderReady = true;
saveEncounter(encounter);
const map = createBattleMap({ campaignId: campaign.id, encounterId: encounter.id, width: 10, height: 5, terrain: ".".repeat(50), ambient: "bright", theme: "dungeon", lights: [], seed: 1 });
placeTokens(map.id, campaign.id, [
  { kind: "pc", refId: bram.sheet.id, name: "Bram", spot: { x: 2, y: 2 } },
  { kind: "pc", refId: cass.sheet.id, name: "Cass", spot: { x: 4, y: 2 } },
  { kind: "enemy", refId: orc.id, name: "Orc", spot: { x: 3, y: 2 } },
]);
const current = () => { const fresh = getEncounter(encounter.id); return fresh.order[fresh.turnIndex].name; };
const attack = (who, args) => handlePcAttack(campaign, turn,
  JSON.stringify({ characterId: who.sheet.id, targetEnemyId: orc.id, ...args }), sheets(), byId(), new Set(), null);
const act = (who, args) => handleTakeAction(campaign, turn, JSON.stringify({ characterId: who.sheet.id, ...args }), sheets(), byId());

test("a reaction comes back at the start of its owner's turn, for enemies too", () => {
  const fresh = getEncounter(encounter.id);
  fresh.reactionsUsed = [orc.id, cass.sheet.id, bram.sheet.id];
  saveEncounter(fresh);
  assert.equal(skipCurrentTurn(campaign.id), true);
  assert.equal(current(), "Cass");
  assert.deepEqual(getEncounter(encounter.id).reactionsUsed.sort(), [bram.sheet.id, orc.id].sort());
  assert.equal(skipCurrentTurn(campaign.id), true);
  assert.equal(current(), "Bram");
  assert.deepEqual(getEncounter(encounter.id).reactionsUsed, [], "the orc's turn passed, then Bram's began");
});

test("Dodge lasts until the start of the dodger's next turn, across the round wrap", () => {
  skipCurrentTurn(campaign.id);
  assert.equal(current(), "Cass");
  assert.equal(act(cass, { action: "dodge" }).ok, true);
  assert.equal(getSheetById(cass.sheet.id).conditionMeta.dodging.untilTurnOf, cass.sheet.id);
  skipCurrentTurn(campaign.id);
  assert.equal(current(), "Bram");
  assert.ok(conditions(cass).includes("dodging"), "still dodging through the orc's turn, the round wrap and Bram's turn");
  skipCurrentTurn(campaign.id);
  assert.equal(current(), "Cass");
  assert.ok(!conditions(cass).includes("dodging"), "gone when Cass's turn starts");
});

test("Help lasts until the helper's next turn and is spent by the helped hero's attack", () => {
  assert.equal(act(cass, { action: "help", targetCharacterId: bram.sheet.id }).ok, true);
  skipCurrentTurn(campaign.id);
  assert.equal(current(), "Bram");
  assert.ok(conditions(bram).includes("helped"), "Cass's turn has not come round yet");
  const swing = attack(bram, { weapon: "Longsword" });
  assert.equal(swing.error, undefined, JSON.stringify(swing));
  assert.ok(swing.conditionEffects.some((note) => /Help/.test(note)), JSON.stringify(swing.conditionEffects));
  assert.ok(!conditions(bram).includes("helped"));
});

test("Action Surge: use_resource adds a whole Attack action to the fighter's turn", () => {
  assert.deepEqual(getSheetById(bram.sheet.id).resources.action_surge, { max: 1, used: 0 });
  assert.equal(attack(bram, { weapon: "Longsword" }).error, undefined, "Extra Attack");
  assert.match(attack(bram, { weapon: "Longsword" }).error, /all 2 of their attacks/);
  const surge = applyDmMutation(campaign, turn.id, "use_resource", JSON.stringify({ characterId: bram.sheet.id, resource: "Action Surge" }), sheets(), byId()).result;
  assert.equal(surge.ok, true, JSON.stringify(surge));
  assert.equal(getEncounter(encounter.id).turnBudget.surgeActions, 1);
  assert.equal(attack(bram, { weapon: "Longsword" }).error, undefined);
  assert.equal(attack(bram, { weapon: "Longsword" }).error, undefined);
  assert.match(attack(bram, { weapon: "Longsword" }).error, /all 2 of their attacks/);
  assert.equal(getSheetById(bram.sheet.id).resources.action_surge.used, 1);
});

test("a hero at 0 HP is unconscious and prone; healing wakes them, still prone", () => {
  patchSheet(dain.sheet.id, { currentHp: 5 });
  applyDmMutation(campaign, turn.id, "apply_damage", JSON.stringify({ characterId: dain.sheet.id, amount: 10 }), sheets(), byId());
  assert.deepEqual(conditions(dain).sort(), ["prone", "unconscious"]);
  applyDmMutation(campaign, turn.id, "heal", JSON.stringify({ characterId: dain.sheet.id, amount: 4 }), sheets(), byId());
  assert.deepEqual(conditions(dain), ["prone"]);
  assert.equal(getSheetById(dain.sheet.id).deathSaves, null);
});

test("an incapacitating condition ends a hero's concentration", () => {
  patchSheet(dain.sheet.id, { concentratingOn: "Bless" });
  const stunned = applyDmMutation(campaign, turn.id, "set_condition", JSON.stringify({ characterId: dain.sheet.id, condition: "stunned" }), sheets(), byId()).result;
  assert.match(stunned.concentrationBroken, /Bless/);
  assert.equal(getSheetById(dain.sheet.id).concentratingOn, null);
  const poisoned = applyDmMutation(campaign, turn.id, "set_condition", JSON.stringify({ characterId: cass.sheet.id, condition: "poisoned" }), sheets(), byId()).result;
  assert.equal(poisoned.concentrationBroken, undefined);
});

test("an opportunity attack's damage forces the caster's concentration save", () => {
  patchSheet(cass.sheet.id, { concentratingOn: "Mage Armor" });
  const fresh = getEncounter(encounter.id);
  fresh.reactionsUsed = [];
  saveEncounter(fresh);
  // To hit 19+5, damage 6+3 = 9, CON save natural 1 against DC 10.
  dice.push(19, 6, 1);
  const outcome = resolveOpportunityAttacks(campaign, cass.sheet.id, { x: 4, y: 2 }, { x: 6, y: 2 }, false);
  assert.equal(dice.length, 0, "all three dice were drawn");
  assert.match(outcome.notes.join(" "), /loses concentration on Mage Armor/);
  assert.equal(getSheetById(cass.sheet.id).concentratingOn, null);
});

test("enemy concentration: damage forces the save, being stunned ends it", () => {
  setEnemyConcentration(orc.id, "Hold Person");
  const hurt = applyEncounterCall(campaign, turn, "damage_enemy", JSON.stringify({ enemyId: orc.id, amount: 30, type: "psychic" }), sheets(), byId()).result;
  assert.match(hurt.concentration, /keeps concentrating|loses concentration/, JSON.stringify(hurt));
  setEnemyConcentration(orc.id, "Hold Person");
  const stun = applyEncounterCall(campaign, turn, "set_enemy_condition", JSON.stringify({ enemyId: orc.id, condition: "stunned" }), sheets(), byId()).result;
  assert.match(stun.concentrationBroken, /stunned and loses concentration on Hold Person/);
  assert.equal(getEnemy(orc.id).concentration, null);
});

test("the fight's end clears what lasts until a next turn", () => {
  const fresh = getEncounter(encounter.id);
  fresh.turnIndex = 0;
  fresh.turnBudget = null;
  saveEncounter(fresh);
  assert.equal(act(bram, { action: "dodge" }).ok, true);
  applyEncounterCall(campaign, turn, "end_encounter", JSON.stringify({ outcome: "truce" }), sheets(), byId());
  assert.ok(!conditions(bram).includes("dodging"));
});

console.log(`test-rules-audit-integration: ${checks} checks passed`);
