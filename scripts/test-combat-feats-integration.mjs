// Real engine calls for the combat feats: bonus-action attacks (two-weapon
// fighting, Polearm Master, Great Weapon Master), the -5/+10 trade, luck
// points, Polearm Master and Sentinel reactions, War Caster and Dual Wielder.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

process.env.SQLITE_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-feats-")), "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn, listPendingForTurn, resolvePendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, insertEnemy, getEncounter, saveEncounter, patchEnemyHp, listEnemies } = await import("../src/lib/db/encounters.ts");
const { createBattleMap, placeTokens, getTokenByRef, moveToken } = await import("../src/lib/db/battle-maps.ts");
const { handlePcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
const { applyEncounterCall } = await import("../src/lib/dm/encounter-tools.ts");
const { handleMoveToken } = await import("../src/lib/dm/map-tools.ts");
const { applyDmMutation } = await import("../src/lib/dm/mutations.ts");
const { concentrationDamageHook } = await import("../src/lib/dm/concentration.ts");
const { GWM_TRIGGER, markGwmTrigger } = await import("../src/lib/dm/bonus-trigger.ts");

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

const owner = createUser("feats-owner", "x");
const campaign = createCampaign(owner.id, { title: "Feats", description: "", theme: "", maxPlayers: 4, startingLevel: 5, difficulty: "normal" });
const hero = (userName, input) => {
  const user = createUser(userName, "x");
  const sheet = createSheet(campaign.id, user.id, 5, createSheetSchema.parse({
    race: "human", maxHp: 60, ac: 12, hitDice: { die: "d10", total: 5, spent: 0 },
    proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    ...input,
  }));
  return { user, sheet };
};
const torvald = hero("torvald", {
  name: "Torvald", class: "fighter", abilities: { str: 18, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Glaive", qty: 1, equipped: true }],
  feats: ["Polearm Master", "Great Weapon Master", "Sentinel", "Lucky"],
});
const mira = hero("mira", {
  name: "Mira", class: "rogue", abilities: { str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 12 },
  equipment: [{ name: "Rapier", qty: 1, equipped: true }, { name: "Shortsword", qty: 1, equipped: true }],
  feats: ["Dual Wielder"],
});
const ilsa = hero("ilsa", {
  name: "Ilsa", class: "wizard", abilities: { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 10 },
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }], feats: ["War Caster"],
});
const plain = hero("plain", {
  name: "Plain", class: "wizard", abilities: { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 10 },
  equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
});
const sheets = () => [torvald, mira, ilsa, plain].map(({ sheet }) => getSheetById(sheet.id));
const byId = () => new Map(sheets().map((sheet) => [sheet.id, sheet]));
let checks = 0;
const test = (name, run) => { run(); checks += 1; console.log(`ok ${checks} - ${name}`); };

test("the Lucky feat brings three luck points, the halfling trait does not", () => {
  assert.deepEqual(getSheetById(torvald.sheet.id).resources.luck_points, { max: 3, used: 0 });
  assert.equal(getSheetById(mira.sheet.id).resources.luck_points, undefined);
});

test("Dual Wielder: +1 AC while a separate melee weapon is in each hand", () => {
  const twin = hero("twin", {
    name: "Twin", class: "rogue", abilities: { str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 12 },
    equipment: [{ name: "Rapier", qty: 1, equipped: true }, { name: "Shortsword", qty: 1, equipped: true }],
    acOverride: false,
  });
  const dual = getSheetById(patchSheet(mira.sheet.id, { acOverride: false }).id);
  assert.equal(dual.ac, getSheetById(twin.sheet.id).ac + 1);
  const shielded = patchSheet(mira.sheet.id, { equipment: [...dual.equipment, { name: "Shield", qty: 1, equipped: true }] });
  assert.equal(shielded.ac, getSheetById(twin.sheet.id).ac + 2, "a shield takes a hand: +2 for the shield, no Dual Wielder");
  patchSheet(mira.sheet.id, { equipment: dual.equipment });
});

const turn = createDmTurn(campaign.id, []);
const encounter = createEncounter(campaign.id, "Feats in the yard");
const statBlock = (hp, ac) => ({ maxHp: hp, ac, cr: 2, xp: 0, dexMod: 0, speed: "30 ft.", attacks: [{ name: "Greatclub", toHit: 6, damage: "2d8+4", type: "bludgeoning", reach: 5 }], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "" });
const ogre = insertEnemy({ campaignId: campaign.id, encounterId: encounter.id, slug: "ogre", displayName: "Ogre", initiative: 1, stats: statBlock(300, 11) });
const goblin = insertEnemy({ campaignId: campaign.id, encounterId: encounter.id, slug: "goblin", displayName: "Goblin", initiative: 2, stats: statBlock(300, 11) });
encounter.order = [
  { kind: "pc", characterId: torvald.sheet.id, userId: torvald.user.id, name: "Torvald", initiative: 20 },
  { kind: "pc", characterId: mira.sheet.id, userId: mira.user.id, name: "Mira", initiative: 18 },
  { kind: "enemy", enemyId: ogre.id, name: "Ogre", initiative: 10 },
  { kind: "enemy", enemyId: goblin.id, name: "Goblin", initiative: 5 },
];
encounter.orderReady = true;
saveEncounter(encounter);
const map = createBattleMap({ campaignId: campaign.id, encounterId: encounter.id, width: 12, height: 5, terrain: ".".repeat(60), ambient: "bright", theme: "dungeon", lights: [], seed: 1 });
placeTokens(map.id, campaign.id, [
  { kind: "pc", refId: torvald.sheet.id, name: "Torvald", spot: { x: 2, y: 2 } },
  { kind: "pc", refId: mira.sheet.id, name: "Mira", spot: { x: 4, y: 1 } },
  { kind: "enemy", refId: goblin.id, name: "Goblin", spot: { x: 4, y: 2 } },
  { kind: "enemy", refId: ogre.id, name: "Ogre", spot: { x: 10, y: 2 } },
]);
const actor = (index, round = getEncounter(encounter.id).round + 1) => {
  const fresh = getEncounter(encounter.id);
  fresh.turnIndex = index;
  fresh.round = round;
  fresh.turnBudget = null;
  fresh.reactionsUsed = [];
  saveEncounter(fresh);
};
const attack = (who, args, physical = false) => handlePcAttack(campaign, turn,
  JSON.stringify({ characterId: who.sheet.id, ...args }), sheets(), byId(), physical ? new Set([who.user.id]) : new Set(), null);
const lastPending = () => listPendingForTurn(turn.id).filter((entry) => entry.status === "pending").at(-1);
const settle = () => { for (const pending of listPendingForTurn(turn.id).filter((entry) => entry.status === "pending")) resolvePendingRoll(pending.id, "fallback", null); };

test("two-weapon fighting: the off-hand swing follows a light-or-Dual-Wielder pair", () => {
  actor(1);
  assert.match(attack(mira, { targetEnemyId: goblin.id, weapon: "Shortsword", bonusAttack: "off_hand" }).error, /Attack action first/);
  assert.equal(attack(mira, { targetEnemyId: goblin.id, weapon: "Rapier" }).error, undefined);
  const offHand = attack(mira, { targetEnemyId: goblin.id, weapon: "Shortsword", bonusAttack: "off_hand" });
  assert.equal(offHand.error, undefined, JSON.stringify(offHand));
  assert.equal(offHand.bonusAttack, "off_hand");
  const budget = getEncounter(encounter.id).turnBudget;
  assert.equal(budget.bonusUsed, true);
  assert.deepEqual(budget.attackWeapons.map((entry) => entry.name), ["Rapier"]);
  assert.match(attack(mira, { targetEnemyId: goblin.id, weapon: "Shortsword", bonusAttack: "off_hand" }).error, /bonus action/);
});

test("Polearm Master: the butt strike is a 1d4 bludgeoning bonus attack after a glaive swing", () => {
  actor(0);
  assert.match(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", bonusAttack: "pole_strike" }).error, /Attack action first/);
  assert.equal(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive" }, true)[PC_ATTACK_PARKED], true);
  assert.match(lastPending().attack.damageExpression, /^1d10\+4/);
  settle();
  assert.equal(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", bonusAttack: "pole_strike" }, true)[PC_ATTACK_PARKED], true);
  const butt = lastPending().attack;
  assert.match(butt.damageExpression, /^1d4\+4/);
  assert.equal(butt.damageType, "bludgeoning");
  assert.equal(getEncounter(encounter.id).turnBudget.bonusUsed, true);
  settle();
});

test("Great Weapon Master: -5 to hit for +10 damage on the heavy glaive", () => {
  assert.equal(lastPending(), undefined);
  assert.equal(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", powerAttack: true }, true)[PC_ATTACK_PARKED], true);
  const pending = lastPending();
  assert.match(pending.expression, /^1d20\+2$/, "+4 STR +3 proficiency -5");
  assert.match(pending.attack.damageExpression, /\+10$/);
  settle();
  assert.match(attack(mira, { targetEnemyId: goblin.id, weapon: "Rapier", powerAttack: true }).error, /turn|Great Weapon Master/);
});

test("Lucky: a declared luck point rolls an extra d20 and is gone after the roll", () => {
  actor(0);
  assert.equal(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", lucky: true }, true)[PC_ATTACK_PARKED], true);
  assert.match(lastPending().expression, /^2d20kh1\+7$/);
  const after = getSheetById(torvald.sheet.id);
  assert.deepEqual(after.resources.luck_points, { max: 3, used: 1 });
  assert.equal(after.conditions.includes("lucky"), false, "the luck point's condition is spent by this roll");
  settle();
  // Spent through use_resource first (a check or save the player asked luck
  // for), the held point rides the next own d20 roll instead.
  const held = applyDmMutation(campaign, turn.id, "use_resource", JSON.stringify({ characterId: torvald.sheet.id, resource: "luck_points" }), sheets(), byId()).result;
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.ok(getSheetById(torvald.sheet.id).conditions.includes("lucky"));
  assert.equal(attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive" }, true)[PC_ATTACK_PARKED], true);
  assert.match(lastPending().expression, /^2d20kh1\+7$/);
  assert.equal(getSheetById(torvald.sheet.id).conditions.includes("lucky"), false);
  assert.deepEqual(getSheetById(torvald.sheet.id).resources.luck_points, { max: 3, used: 2 });
  settle();
});

test("Great Weapon Master: the bonus swing waits for a melee crit or kill, then finds a living target", () => {
  actor(0);
  const skipped = attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", bonusAttack: "great_weapon_master" });
  assert.equal(skipped.skipped, true);
  assert.equal(getEncounter(encounter.id).turnBudget?.bonusUsed ?? false, false, "nothing is spent when it does not trigger");
  // A natural 20 on the glaive opens it.
  dice.push(20, 5, 5);
  const crit = attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive" });
  assert.equal(crit.crit, true, JSON.stringify(crit));
  assert.ok(getEncounter(encounter.id).turnBudget.oncePerTurn.includes(GWM_TRIGGER));
  // The goblin is down: the swing goes to the nearest living enemy in reach.
  patchEnemyHp(goblin.id, 0, "dead");
  const tokens = getTokenByRef(map.id, ogre.id);
  assert.ok(tokens);
  const blocked = attack(torvald, { targetEnemyId: goblin.id, weapon: "Glaive", bonusAttack: "great_weapon_master" });
  assert.equal(blocked.skipped, true, "the ogre is far away: nobody in reach");
  patchEnemyHp(goblin.id, 300, "alive");
  const swing = attack(torvald, { weapon: "Glaive", bonusAttack: "great_weapon_master" });
  assert.equal(swing.error, undefined, JSON.stringify(swing));
  assert.equal(swing.target, "Goblin");
  assert.equal(getEncounter(encounter.id).turnBudget.bonusUsed, true);
  markGwmTrigger(campaign.id, torvald.sheet.id);
});

test("Polearm Master and Sentinel: stepping into the glaive's reach provokes, and a hit stops the walk", () => {
  actor(2);
  // To-hit 15 vs AC 11, then the glaive's d10.
  dice.push(15, 6);
  const moved = handleMoveToken(campaign, JSON.stringify({ tokenName: "Ogre", x: 3, y: 2 }), sheets(), byId());
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.match(moved.opportunityAttacks.join(" "), /steps into reach \(Polearm Master\)/);
  assert.match(moved.opportunityAttacks.join(" "), /Sentinel/);
  // It walks around the goblin and is stopped on the first tile 3 m from
  // Torvald, short of the tile it was sent to.
  const stop = getTokenByRef(map.id, ogre.id);
  assert.equal(Math.max(Math.abs(stop.x - 2), Math.abs(stop.y - 2)), 2, JSON.stringify(stop));
  assert.notDeepEqual({ x: stop.x, y: stop.y }, { x: 3, y: 2 });
  assert.match(moved.note, /Sentinel stopped/);
  assert.ok(getEncounter(encounter.id).reactionsUsed.includes(torvald.sheet.id));
  assert.ok(listEnemies(encounter.id).find((enemy) => enemy.id === ogre.id).currentHp < 300);
});

test("Sentinel: an enemy next to the sentinel that attacks someone else takes a reaction attack", () => {
  actor(2);
  // A fresh round on the board: the ogre stands next to both heroes.
  moveToken(getTokenByRef(map.id, goblin.id).id, 8, 4, 0);
  moveToken(getTokenByRef(map.id, ogre.id).id, 3, 2, 0);
  moveToken(getTokenByRef(map.id, mira.sheet.id).id, 4, 3, 0);
  const result = applyEncounterCall(campaign, turn, "enemy_attack", JSON.stringify({ enemyId: ogre.id, targetCharacterId: mira.sheet.id, attack: "Greatclub" }), sheets(), byId()).result;
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.match((result.reactions ?? []).join(" "), /Torvald .* for attacking Mira \(Sentinel\)/);
  assert.ok(getEncounter(encounter.id).reactionsUsed.includes(torvald.sheet.id));
});

test("War Caster: advantage on the concentration save", () => {
  for (const { sheet, expectHeld } of [{ sheet: ilsa.sheet, expectHeld: true }, { sheet: plain.sheet, expectHeld: false }]) {
    patchSheet(sheet.id, { concentratingOn: "Bless" });
    dice.length = 0;
    dice.push(3, 18);
    const outcome = concentrationDamageHook(campaign, turn.id, getSheetById(sheet.id), 12);
    dice.length = 0;
    assert.equal(outcome.concentration?.held, expectHeld, JSON.stringify(outcome));
  }
});

globalThis.crypto.getRandomValues = realRandom;
console.log(`test-combat-feats-integration: ${checks} checks passed`);
