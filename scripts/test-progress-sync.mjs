import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-progress-test-"));
process.env.SQLITE_DB_PATH = path.join(root, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = "progress-test-key";
process.env.ODM_SQLITE_DRIVER = "node";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createCharacter, getCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { ProgressConflictError, getProgressState, syncPartyProgress } = await import("../src/lib/db/progress-sync.ts");
const { finishAndSyncParty, syncProgressLookup } = await import("../src/lib/progress/service.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const db = getDatabase();
const now = new Date().toISOString();
function addUser(id, username) {
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, username, "x", now);
}
function addCampaign(id, code, title, status = "active") {
  db.prepare(`
    INSERT INTO campaigns (
      id, title, description, invite_code, owner_user_id, status, max_players, starting_level,
      difficulty, theme, settings_json, scene, quest_log_json, story_summary, story_summary_count,
      next_seq, created_at, updated_at
    ) VALUES (?, ?, '', ?, ?, ?, 5, 1, 'normal', '', '{}', '', '[]', '', 0, 1, ?, ?)
  `).run(id, title, code, "user-main", status, now, now);
}

addUser("user-main", "hero_owner");
addUser("user-unlinked", "guest_player");
addCampaign("campaign-old", "PROGOLD1", "Old Campaign");
addCampaign("campaign-next", "PROGNXT1", "Next Campaign", "lobby");

const baseSheet = createSheetSchema.parse({
  name: "Iria Vale",
  race: "human",
  class: "wizard",
  subclass: "evocation",
  background: "sage",
  abilities: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 },
  maxHp: 8,
  ac: 12,
  speed: 30,
  hitDice: { die: "d6", total: 1, spent: 0 },
  proficiencies: { saves: ["int", "wis"], skills: ["arcana", "history"], languages: ["common"], tools: [], armor: [], weapons: [] },
  equipment: [{ name: "Spellbook", qty: 1 }, { name: "Potion", qty: 2 }],
  gold: 10,
  copper: 5,
  spellcasting: {
    ability: "int",
    slots: { "1": { max: 2, used: 0 } },
    prepared: ["magic missile"],
    known: ["magic missile", "shield"],
  },
});

const library = createCharacter("user-main", 1, baseSheet);
const instantiated = instantiateIntoCampaign(library.id, "campaign-old", "user-main", 1);
assert.ok(!("error" in instantiated), JSON.stringify(instantiated));
const sheetId = instantiated.id;

// Simulate real campaign progression, including temporary combat state that
// must never leak back into the reusable library copy.
const progressedSlots = {
  ability: "int",
  slots: { "1": { max: 4, used: 3 }, "2": { max: 2, used: 2 } },
  prepared: ["magic missile", "misty step"],
  known: ["magic missile", "shield", "misty step"],
};
const progressedAt = new Date(Date.now() + 1000).toISOString();
db.prepare(`
  UPDATE character_sheets SET
    level = 3, xp = 900, max_hp = 20, current_hp = 2, temp_hp = 5,
    hit_dice_json = ?, spellcasting_json = ?, conditions_json = ?, exhaustion = 2,
    death_saves_json = ?, gold = 125, copper = 42, updated_at = ?
  WHERE id = ?
`).run(
  JSON.stringify({ die: "d6", total: 3, spent: 2 }),
  JSON.stringify(progressedSlots),
  JSON.stringify(["poisoned", "prone"]),
  JSON.stringify({ successes: 1, failures: 2, stable: false, dead: false }),
  progressedAt,
  sheetId,
);

await test("single sync uses sheetId and preserves only durable progression", () => {
  const result = syncProgressLookup({ sheetId, expectedVersion: 0 });
  assert.equal(result.revision, 1);
  assert.equal(result.before.level, 1);
  assert.equal(result.after.level, 3);
  assert.equal(result.level, 3);
  assert.equal(result.xp, 900);
  assert.equal(result.sheet.currentHp, 2, "live sheet remains wounded");
  const stored = getCharacter(library.id);
  assert.equal(stored.level, 3);
  assert.equal(stored.xp, 900);
  assert.equal(stored.sheet.maxHp, 20);
  assert.equal(stored.sheet.gold, 125);
  assert.equal(stored.sheet.copper, 42);
  assert.equal(stored.sheet.hitDice.total, 3);
  assert.equal(stored.sheet.hitDice.spent, 0);
  assert.equal(stored.sheet.spellcasting.slots["1"].max, 4);
  assert.equal(stored.sheet.spellcasting.slots["1"].used, 0);
  assert.equal(stored.sheet.spellcasting.slots["2"].used, 0);
  assert.equal("currentHp" in stored.sheet, false, "library CreateSheetInput carries no current combat HP");
  assert.equal("conditions" in stored.sheet, false, "temporary conditions are campaign-local");
  assert.equal("deathSaves" in stored.sheet, false, "death save track is campaign-local");
});

await test("optimistic revision prevents stale progress sync", () => {
  assert.throws(() => syncProgressLookup({ sheetId, expectedVersion: 0 }), ProgressConflictError);
  assert.equal(getProgressState(library.id).revision, 1);
});

await test("campaign plus username lookup resolves the same live sheet", () => {
  const result = syncProgressLookup({ campaignId: "campaign-old", username: "hero_owner", expectedVersion: 1 });
  assert.equal(result.sheetId, sheetId);
  assert.equal(result.revision, 2);
});

// A second player has an unlinked live sheet. This is intentionally valid
// campaign state: finish_and_sync_party must report it, not silently discard
// that player's result or end the campaign when requireAllSynced=true.
createSheet("campaign-old", "user-unlinked", 1, createSheetSchema.parse({
  ...baseSheet,
  name: "Temporary Guest",
  class: "fighter",
  subclass: "",
  hitDice: { die: "d10", total: 1, spent: 0 },
  spellcasting: null,
}));

await test("party sync reports synced skipped and failed independently", () => {
  const result = syncPartyProgress("campaign-old", { skipUnlinked: true });
  assert.equal(result.totals.candidates, 2);
  assert.equal(result.totals.synced, 1);
  assert.equal(result.totals.skipped, 1);
  assert.equal(result.totals.failed, 0);
  assert.equal(result.skipped[0].name, "Temporary Guest");
});

await test("finish is blocked when requireAllSynced sees an unlinked party member", () => {
  const result = finishAndSyncParty({
    campaignId: "campaign-old",
    skipUnlinked: true,
    requireAllSynced: true,
    confirm: true,
  });
  assert.equal(result.ended, false);
  assert.equal(getCampaignById("campaign-old").status, "active");
  const event = db.prepare("SELECT type FROM campaign_events WHERE campaign_id = ? ORDER BY seq DESC LIMIT 1").get("campaign-old");
  assert.equal(event.type, "campaign.finish_sync_blocked");
});

await test("finish requires explicit confirmation", () => {
  assert.throws(
    () => finishAndSyncParty({ campaignId: "campaign-old", requireAllSynced: false, confirm: false }),
    /confirm=true/,
  );
  assert.equal(getCampaignById("campaign-old").status, "active");
});

await test("finish can deliberately tolerate reported skips and records audit event", () => {
  const result = finishAndSyncParty({
    campaignId: "campaign-old",
    skipUnlinked: true,
    requireAllSynced: false,
    confirm: true,
  });
  assert.equal(result.ended, true);
  assert.equal(result.sync.totals.skipped, 1);
  assert.equal(getCampaignById("campaign-old").status, "ended");
  const event = db.prepare("SELECT type, payload_json FROM campaign_events WHERE campaign_id = ? ORDER BY seq DESC LIMIT 1").get("campaign-old");
  assert.equal(event.type, "campaign.finished_progress_sync");
  assert.equal(JSON.parse(event.payload_json).status, "ended");
});

await test("synced library character can seed the next campaign at its durable level", () => {
  const stored = getCharacter(library.id);
  assert.equal(stored.level, 3);
  const next = instantiateIntoCampaign(library.id, "campaign-next", "user-main", stored.level);
  assert.ok(!("error" in next), JSON.stringify(next));
  assert.equal(next.level, 3);
  assert.equal(next.maxHp, 20);
  assert.equal(next.currentHp, 20, "new campaign starts at full HP");
  assert.deepEqual(next.conditions, []);
  assert.equal(next.hitDice.total, 3);
  assert.equal(next.hitDice.spent, 0);
  assert.equal(next.spellcasting.slots["1"].used, 0);
});

console.log(`progress sync tests: ${passed} passed`);

globalThis.__localRoleplayDb?.close();
globalThis.__localRoleplayDb = undefined;
fs.rmSync(root, { recursive: true, force: true });
