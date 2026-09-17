// Executes the production persistence boundaries and revision trigger against
// real SQLite. Existing sheet mapping/level adaptation are explicit doubles;
// this tests copy/sync concurrency, not D&D feature derivation or HTTP auth.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const root = path.resolve(import.meta.dirname, "..");
const load = (file, mocks) => loadReviewModule(path.join(root, file), mocks);

function fixture() {
  const raw = new DatabaseSync(":memory:");
  const db = sqliteAdapter(raw);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE library_characters (id TEXT PRIMARY KEY, user_id TEXT, level INTEGER, xp INTEGER, subclass TEXT, sheet_json TEXT, updated_at TEXT);
    CREATE TABLE character_sheets (id TEXT PRIMARY KEY, campaign_id TEXT, user_id TEXT, library_character_id TEXT, level INTEGER, xp INTEGER, sheet_json TEXT, updated_at TEXT);`);
  const input = { name: "Hero", subclass: "", copper: 7, gold: 5, hitDice: { die: "d8", total: 3, spent: 0 }, hitDicePools: null, notes: "", equipment: [] };
  db.prepare("INSERT INTO library_characters VALUES ('hero','u',3,1200,'',?,'1')").run(JSON.stringify(input));
  const core = { getDatabase: () => db };
  const baseline = load("src/lib/db/progress-baseline.ts", { "@/lib/db/core": core });
  function getSheetById(id) {
    const row = db.prepare("SELECT * FROM character_sheets WHERE id=?").get(id);
    return row ? { ...JSON.parse(row.sheet_json), id, campaignId: row.campaign_id, userId: row.user_id, libraryCharacterId: row.library_character_id, level: row.level, xp: row.xp, updatedAt: row.updated_at } : null;
  }
  let serial = 0;
  const sheetStore = {
    getSheetById,
    createSheet: (campaignId, userId, level, input, libraryCharacterId) => {
      const id = `sheet${++serial}`;
      db.prepare("INSERT INTO character_sheets VALUES (?,?,?,?,?,0,?,?)")
        .run(id, campaignId, userId, libraryCharacterId ?? null, level, JSON.stringify(input), String(serial));
      return getSheetById(id);
    },
  };
  const sheets = load("src/lib/db/sheets.ts", {
    "@/lib/db/core": core, "@/lib/db/sheets-store": sheetStore, "@/lib/db/progress-baseline": baseline,
  });
  function getCharacter(id) {
    const row = db.prepare("SELECT * FROM library_characters WHERE id=?").get(id);
    return row ? { id, userId: row.user_id, level: row.level, xp: row.xp, sheet: JSON.parse(row.sheet_json), updatedAt: row.updated_at } : null;
  }
  const legacy = {
    getCharacter,
    instantiateIntoCampaign: (id, campaignId, userId, targetLevel) => {
      const source = getCharacter(id);
      if (!source || source.userId !== userId) return { error: "not owned" };
      return sheets.createSheet(campaignId, userId, targetLevel, source.sheet, id);
    },
    syncProgressToLibrary: (id) => {
      const sheet = getSheetById(id), before = getCharacter(sheet.libraryCharacterId);
      db.prepare("UPDATE library_characters SET level=?,xp=?,sheet_json=?,updated_at='sync' WHERE id=?")
        .run(sheet.level, sheet.xp, JSON.stringify({ ...before.sheet, gold: sheet.gold, notes: sheet.notes, equipment: sheet.equipment }), before.id);
      return getCharacter(before.id);
    },
  };
  const characters = load("src/lib/db/characters.ts", {
    "@/lib/db/core": core, "@/lib/db/characters-store": legacy,
    "@/lib/db/sheets": sheets, "@/lib/db/progress-baseline": baseline,
  });
  return { db, raw, baseline, sheets, characters, getSheetById, getCharacter, input };
}

test("R05: A -> sync -> B at the same level -> sync preserves level and XP", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 3);
    assert.equal(a.xp, 1200);
    f.db.prepare("UPDATE character_sheets SET xp=1500 WHERE id=?").run(a.id);
    assert.equal(f.characters.syncProgressToLibrary(a.id).xp, 1500);
    const b = f.characters.instantiateIntoCampaign("hero", "B", "u", 3);
    assert.equal(b.level, 3);
    assert.equal(b.xp, 1500);
    assert.equal(f.characters.syncProgressToLibrary(b.id).xp, 1500);
  } finally { f.raw.close(); }
});
test("R05: scaled copies use fresh-campaign XP and cannot silently reduce library progression", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 1);
    assert.equal(a.xp, 0);
    assert.throws(() => f.characters.syncProgressToLibrary(a.id), f.baseline.ProgressConflictError);
    assert.equal(f.getCharacter("hero").xp, 1200);
    assert.equal(f.getCharacter("hero").level, 3);
  } finally { f.raw.close(); }
});
test("R06: editing notes on a stale B cannot overwrite A's reward", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 3);
    const b = f.characters.instantiateIntoCampaign("hero", "B", "u", 3);
    f.db.prepare("UPDATE character_sheets SET xp=1800,sheet_json=? WHERE id=?")
      .run(JSON.stringify({ ...f.input, gold: 105, equipment: [{ name: "Reward" }] }), a.id);
    f.characters.syncProgressToLibrary(a.id);
    f.db.prepare("UPDATE character_sheets SET sheet_json=?,updated_at='99999999' WHERE id=?")
      .run(JSON.stringify({ ...f.input, notes: "cosmetic edit" }), b.id);
    assert.throws(() => f.characters.syncProgressToLibrary(b.id), /Library progress changed/);
    const library = f.getCharacter("hero");
    assert.equal(library.xp, 1800);
    assert.equal(library.sheet.gold, 105);
    assert.deepEqual(library.sheet.equipment, [{ name: "Reward" }]);
    // A's own checkpoint advances, so later legitimate rewards still sync.
    f.db.prepare("UPDATE character_sheets SET xp=2000 WHERE id=?").run(a.id);
    assert.equal(f.characters.syncProgressToLibrary(a.id).xp, 2000);
  } finally { f.raw.close(); }
});
test("R06: direct library edits increment the trigger revision even with unchanged timestamps", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 3);
    f.db.prepare("UPDATE library_characters SET xp=1600 WHERE id='hero'").run();
    assert.equal(f.baseline.libraryProgressRevision("hero"), 1);
    assert.throws(() => f.characters.syncProgressToLibrary(a.id), /baseline 0, current 1/);
    assert.equal(f.getCharacter("hero").xp, 1600);
  } finally { f.raw.close(); }
});
test("R06: legacy copies without a baseline fail closed; reconciliation requires inspected versions", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 3);
    f.db.prepare("DELETE FROM sheet_progress_baselines WHERE sheet_id=?").run(a.id);
    assert.throws(() => f.characters.syncProgressToLibrary(a.id), /no verified library baseline/);
    const request = { sheetId: a.id, expectedLibraryRevision: 0, expectedSheetUpdatedAt: a.updatedAt, confirmOverwriteFromCampaign: true };
    assert.throws(() => f.baseline.adoptProgressBaseline({ ...request, confirmOverwriteFromCampaign: false }), /confirmation/);
    assert.throws(() => f.baseline.adoptProgressBaseline({ ...request, expectedLibraryRevision: 999 }), /version changed/);
    f.baseline.adoptProgressBaseline(request);
    assert.equal(f.characters.syncProgressToLibrary(a.id).xp, 1200);
  } finally { f.raw.close(); }
});
test("R06: failed checkpoint update rolls back library data and revision", () => {
  const f = fixture();
  try {
    const a = f.characters.instantiateIntoCampaign("hero", "A", "u", 3);
    f.db.prepare("UPDATE character_sheets SET xp=9999 WHERE id=?").run(a.id);
    f.db.exec(`CREATE TRIGGER fail_baseline BEFORE UPDATE ON sheet_progress_baselines BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END;`);
    assert.throws(() => f.characters.syncProgressToLibrary(a.id), /injected/);
    assert.equal(f.getCharacter("hero").xp, 1200);
    assert.equal(f.baseline.libraryProgressRevision("hero"), 0);
  } finally { f.raw.close(); }
});
test("R05/R06: new unlinked sheets remain valid and invalid initial XP cannot leave a partial sheet", () => {
  const f = fixture();
  try {
    const plain = f.sheets.createSheet("plain", "u", 1, f.input);
    assert.equal(plain.xp, 0);
    assert.equal(f.characters.syncProgressToLibrary(plain.id), null);
    for (const initialXp of [-1, NaN, Infinity, 1.5]) {
      assert.throws(() => f.sheets.createSheet("bad", "u", 1, f.input, null, { initialXp }), /Initial XP/);
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM character_sheets").get().n, 1);
  } finally { f.raw.close(); }
});
