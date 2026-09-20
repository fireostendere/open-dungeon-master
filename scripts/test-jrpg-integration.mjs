// Real engine calls: JRPG relaxes positioning, not participants or turn costs.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

process.env.SQLITE_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "odm-jrpg-")), "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, insertEnemy, getEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { createBattleMap, placeTokens, getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { handlePcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
const { applyEncounterCall, advanceAfterTurn, setInitiativeFloor } = await import("../src/lib/dm/encounter-tools.ts");
const { resolveOpportunityAttacks, resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

const user = createUser("jrpg-test", "x");
const absentUser = createUser("absent", "x");
let campaign = createCampaign(user.id, { title: "Combat modes", description: "", theme: "", maxPlayers: 2, startingLevel: 1, difficulty: "normal" });
assert.equal(campaign.gameSettings.combatMode, "classical");
const input = createSheetSchema.parse({
  name: "Fighter", race: "human", class: "fighter", maxHp: 100, ac: 12,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  hitDice: { die: "d10", total: 1, spent: 0 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: ["martial"] },
});
const sheet = createSheet(campaign.id, user.id, 1, input);
const absent = createSheet(campaign.id, absentUser.id, 1, { ...input, name: "Elsewhere" });
const sheets = [sheet, absent];
const byId = new Map(sheets.map(entry => [entry.id, entry]));
const turn = createDmTurn(campaign.id, []);
const encounter = createEncounter(campaign.id, "Across the wall");
const enemy = insertEnemy({
  campaignId: campaign.id, encounterId: encounter.id, slug: "guard", displayName: "Guard", initiative: 1,
  stats: { maxHp: 100, ac: 12, cr: 0, xp: 0, dexMod: 0, speed: "30", attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6", type: "piercing" }], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "" },
});
encounter.order = [
  { kind: "pc", characterId: sheet.id, userId: user.id, name: sheet.name, initiative: 20 },
  { kind: "enemy", enemyId: enemy.id, name: enemy.displayName, initiative: 1 },
];
encounter.orderReady = true;
saveEncounter(encounter);
const map = createBattleMap({ campaignId: campaign.id, encounterId: encounter.id, width: 10, height: 1, terrain: "....#.....", ambient: "bright", theme: "dungeon", lights: [], seed: 1 });
placeTokens(map.id, campaign.id, [
  { kind: "pc", refId: sheet.id, name: sheet.name, spot: { x: 0, y: 0 } },
  { kind: "enemy", refId: enemy.id, name: enemy.displayName, spot: { x: 9, y: 0 } },
]);
const pcAttack = (character = sheet, physical = false) => handlePcAttack(campaign, turn,
  JSON.stringify({ characterId: character.id, targetEnemyId: enemy.id, enemyId: enemy.id, weapon: "Longsword" }),
  sheets, byId, physical ? new Set([user.id]) : new Set(), null);
const enemyAttack = (target = sheet) => applyEncounterCall(campaign, turn, "enemy_attack",
  JSON.stringify({ enemyId: enemy.id, targetCharacterId: target.id, attack: "Shortbow" }), sheets, byId).result;
const nextActor = index => {
  const fresh = getEncounter(encounter.id);
  fresh.turnIndex = index;
  fresh.round += 1;
  fresh.turnBudget = null;
  saveEncounter(fresh);
};

assert.match(pcAttack().error, /out of melee reach/);
assert.equal(turn.rollIds.length, 0);
assert.equal(getEncounter(encounter.id).turnBudget, null);
nextActor(1);
assert.ok(enemyAttack().error, "classical line of sight blocks the enemy");

updateGameSettings(campaign.id, { combatMode: "jrpg" });
campaign = getCampaignById(campaign.id);
assert.equal(campaign.gameSettings.combatMode, "jrpg");
nextActor(0);
assert.match(pcAttack(absent).error, /turn|encounter/i);
assert.match(enemyAttack().error, /turn/i);
patchSheet(sheet.id, { conditions: ["stunned"] });
assert.match(pcAttack().error, /stunned/);
patchSheet(sheet.id, { conditions: [], currentHp: 0 });
assert.match(pcAttack().error, /0 HP/);
patchSheet(sheet.id, { currentHp: 100 });
const pcResult = pcAttack();
assert.equal(pcResult.error, undefined, JSON.stringify(pcResult));
assert.equal(typeof pcResult.hit, "boolean");
assert.ok(turn.rollIds.length > 0, "actual server attack roll was recorded");
assert.equal(getEncounter(encounter.id).turnBudget.actionUsed, true);
const rollsAfterAttack = turn.rollIds.length;
assert.ok(pcAttack().error, "JRPG does not give a second action");
assert.equal(turn.rollIds.length, rollsAfterAttack);
nextActor(1);
assert.match(enemyAttack(absent).error, /encounter/i);
const before = getTokenByRef(map.id, enemy.id);
assert.equal(enemyAttack().error, undefined);
assert.deepEqual(getTokenByRef(map.id, enemy.id), before, "enemy attacks without repositioning");
const hp = getSheetById(sheet.id).currentHp;
assert.deepEqual(resolveOpportunityAttacks(campaign, sheet.id, { x: 8, y: 0 }, { x: 0, y: 0 }, false), { notes: [], downed: false });
assert.deepEqual(resolvePcOpportunityAttacks(campaign, enemy.id, { x: 1, y: 0 }, { x: 9, y: 0 }), []);
assert.equal(getSheetById(sheet.id).currentHp, hp);
nextActor(0);
setInitiativeFloor(campaign, getEncounter(encounter.id));
const fallbackTurn = createDmTurn(campaign.id, []);
fallbackTurn.resolvedCharacterIds.push(sheet.id);
advanceAfterTurn(campaign, fallbackTurn);
assert.ok(fallbackTurn.actedEnemyIds.includes(enemy.id), "an owed skipped enemy turn must still resolve in JRPG");
nextActor(0);
assert.equal(pcAttack(sheet, true)[PC_ATTACK_PARKED], true);
assert.match(pcAttack().error, /pending/i);

console.log("jrpg integration: classical/JRPG engine attacks, turn guards, costs, conditions, membership and opportunity checks passed");
