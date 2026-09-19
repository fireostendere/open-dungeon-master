// Real DB combat round trip: Shillelagh must consume the current PC's bonus action
// and flow into pc_attack without callers supplying an artificial attack stance.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-shillelagh-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn, listPendingForTurn } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, insertEnemy, getEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { handleCastBuff } = await import("../src/lib/dm/cast-tools.ts");
const { handlePcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
const { tickEncounterConditions } = await import("../src/lib/dm/condition-tick.ts");
const { canonicalCondition } = await import("../src/lib/dm/mutations.ts");

assert.equal(canonicalCondition("shillelagh (Poisoned Club)"), "shillelagh (poisoned club)");

function druid(name) {
  return createSheetSchema.parse({
    name, race: "human", class: "druid", abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 }, maxHp: 8, ac: 10,
    hitDice: { die: "d8", total: 1, spent: 0 }, proficiencies: { saves: ["wis"], skills: [], languages: [], tools: [], armor: [], weapons: ["simple"] },
    equipment: [{ name: "Боевой посох", qty: 1, equipped: true }],
    spellcasting: { ability: "wis", slots: { "1": { max: 2, used: 0 } }, known: ["Shillelagh"], prepared: [] },
  });
}

const user = createUser("shillelagh", "x");
const otherUser = createUser("other-druid", "x");
const campaign = createCampaign(user.id, { title: "test", description: "", theme: "", maxPlayers: 2, startingLevel: 1, difficulty: "normal" });
const sheet = createSheet(campaign.id, user.id, 1, druid("Oleg"));
const other = createSheet(campaign.id, otherUser.id, 1, druid("Other"));
const sheets = [sheet, other];
const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
const turn = createDmTurn(campaign.id, []);
const encounter = createEncounter(campaign.id, "Shillelagh integration");
assert.ok(encounter);
const enemy = insertEnemy({
  encounterId: encounter.id, campaignId: campaign.id, slug: "training-dummy", displayName: "Training Dummy", initiative: 1,
  stats: { maxHp: 100, ac: 10, cr: 0, xp: 0, dexMod: 0, speed: "0", attacks: [], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "" },
});
encounter.order = [
  { kind: "pc", characterId: sheet.id, userId: user.id, name: sheet.name, initiative: 20 },
  { kind: "enemy", enemyId: enemy.id, name: enemy.displayName, initiative: 1 },
];
encounter.orderReady = true;
encounter.turnIndex = 0;
saveEncounter(encounter);

const castArgs = (characterId) => JSON.stringify({ characterId, spell: "Shillelagh", variant: "Боевой посох" });
const wrongActor = handleCastBuff(campaign, turn, castArgs(other.id), sheets, sheetsById);
assert.match(wrongActor.error, /current combat turn/i);
assert.equal(getSheetById(other.id).conditions.length, 0);

const cast = handleCastBuff(campaign, turn, castArgs(sheet.id), sheets, sheetsById);
assert.equal(cast.ok, true, JSON.stringify(cast));
let fresh = getSheetById(sheet.id);
const condition = fresh.conditions.find((entry) => /shillelagh \(боевой посох\)/i.test(entry));
assert.ok(condition, JSON.stringify(fresh.conditions));
assert.equal(fresh.conditionMeta[condition].rounds, 10);
assert.equal(fresh.spellcasting.slots["1"].used, 0);
let combat = getEncounter(encounter.id);
assert.equal(combat.turnBudget.bonusUsed, true);
assert.equal(combat.turnBudget.actionUsed, false);

const beforeSecondCast = JSON.stringify({ conditions: fresh.conditions, meta: fresh.conditionMeta, budget: combat.turnBudget });
const secondCast = handleCastBuff(campaign, turn, castArgs(sheet.id), sheets, sheetsById);
assert.match(secondCast.error, /bonus action/i);
fresh = getSheetById(sheet.id);
combat = getEncounter(encounter.id);
assert.equal(JSON.stringify({ conditions: fresh.conditions, meta: fresh.conditionMeta, budget: combat.turnBudget }), beforeSecondCast);

const attack = handlePcAttack(
  campaign, turn,
  JSON.stringify({ characterId: sheet.id, enemyId: enemy.id, targetEnemyId: enemy.id, weapon: "Боевой посох" }),
  sheets, sheetsById, new Set([user.id]), "shillelagh-attack",
);
assert.equal(attack[PC_ATTACK_PARKED], true, JSON.stringify(attack));
const pending = listPendingForTurn(turn.id).at(-1);
assert.equal(pending.attack.damageExpression, "1d8+4");
assert.equal(pending.attack.magical, true);
assert.match(pending.expression, /\+6$/);

// Unequipping removes the bound effect; re-equipping must not revive stale metadata.
patchSheet(sheet.id, { equipment: fresh.equipment.map((item) => ({ ...item, equipped: false })) });
patchSheet(sheet.id, { equipment: fresh.equipment.map((item) => ({ ...item, equipped: true })) });
fresh = getSheetById(sheet.id);
assert.ok(!fresh.conditions.some((entry) => entry.toLowerCase().startsWith("shillelagh (")));
assert.ok(!Object.keys(fresh.conditionMeta).some((entry) => entry.toLowerCase().startsWith("shillelagh (")));

// Simulate Oleg's next turn: a new round creates a fresh budget for its current actor.
combat = getEncounter(encounter.id);
combat.round += 1;
combat.turnBudget = null;
saveEncounter(combat);
const recast = handleCastBuff(campaign, turn, castArgs(sheet.id), sheets, sheetsById);
assert.equal(recast.ok, true, JSON.stringify(recast));
fresh = getSheetById(sheet.id);
assert.deepEqual(fresh.conditions.filter((entry) => entry.toLowerCase().startsWith("shillelagh (")), [condition]);
assert.equal(fresh.conditionMeta[condition].rounds, 10);

for (let round = 0; round < 10; round += 1) {
  tickEncounterConditions(campaign, getEncounter(encounter.id));
}
fresh = getSheetById(sheet.id);
assert.ok(!fresh.conditions.includes(condition));
assert.equal(fresh.conditionMeta[condition], undefined);
console.log("test-shillelagh-integration: passed");
