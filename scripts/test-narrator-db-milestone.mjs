import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-narrator-db-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { openDatabase } = await import("../src/lib/db/driver.ts");
const { listNarratorReceipts } = await import("../src/lib/db/narrator-commands.ts");
const { listNpcs } = await import("../src/lib/db/npcs.ts");
const { npcRosterForPrompt } = await import("../src/lib/dm/social-tools.ts");
const { ensureAskQueue } = await import("../src/lib/db/ask-queue.mjs");
const db = getDatabase();

test("warm narrator receipts do not execute schema DDL and recover after rollback/drop", () => {
  let receiptDdl = 0;
  const exec = db.exec.bind(db);
  db.exec = (sql) => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS narrator_commands")) receiptDdl += 1;
    return exec(sql);
  };
  try {
    listNarratorReceipts("campaign");
    assert.equal(receiptDdl, 1, "first receipt access creates its schema");
    listNarratorReceipts("campaign");
    assert.equal(receiptDdl, 1, "warm receipt access must not clear prepared programs with DDL");

    db.exec("DROP TABLE narrator_commands");
    const rolledBack = db.transaction(() => {
      listNarratorReceipts("campaign");
      throw new Error("rollback");
    });
    assert.throws(rolledBack, /rollback/);
    listNarratorReceipts("campaign");
    assert.equal(receiptDdl, 3, "rollback and a later schema drop are both re-ensured");

    db.exec("DROP TABLE narrator_commands");
    listNarratorReceipts("campaign");
    assert.equal(receiptDdl, 4, "a dropped receipt table is recreated on the same connection");

    const other = openDatabase(path.join(dir, "other.sqlite"));
    globalThis.__localRoleplayDb = other;
    try {
      listNarratorReceipts("campaign");
      assert.ok(other.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='narrator_commands'").get(), "a migrated connection gets its own lazy schema");
    } finally {
      globalThis.__localRoleplayDb = db;
      other.close();
    }
  } finally {
    db.exec = exec;
  }
});

test("bounded active NPC roster preserves strict archived semantics and skips facts when empty", () => {
  db.exec("DROP TABLE npcs; CREATE TABLE npcs (id TEXT, campaign_id TEXT, name TEXT, attitude TEXT, trait TEXT, location TEXT, last_shift_turn TEXT, aliases_json TEXT, personality_json TEXT, goals_json TEXT, relations_json TEXT, bonds_json TEXT, pressure_json TEXT, arc_cast_id TEXT, portrait_url TEXT, role TEXT, archived, created_at TEXT, updated_at TEXT)");
  const insert = db.prepare("INSERT INTO npcs VALUES (?, ?, ?, 'indifferent', '', '', '', '[]', '{}', '[]', '[]', '{}', '{}', '', '', '', ?, '', '')");
  for (let index = 0; index < 140; index += 1) {
    insert.run(`npc-${index}`, "campaign", `NPC ${String(index).padStart(3, "0")}`, index % 4 === 0 ? 1 : index % 4 === 1 ? null : index % 4 === 2 ? 0 : 2);
  }
  const expected = listNpcs("campaign").filter((npc) => !npc.archived).slice(0, 100).map((npc) => npc.name);
  const roster = npcRosterForPrompt("campaign", 100);
  assert.deepEqual(roster.map((npc) => npc.name), expected);
  assert.equal(roster.length, 100, "the narrator maps at most 100 active NPC rows");

  db.exec("DELETE FROM npcs");
  const prepared = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    prepared.push(sql);
    return prepare(sql);
  };
  try {
    assert.deepEqual(npcRosterForPrompt("campaign", 100), []);
    assert.equal(prepared.some((sql) => sql.includes("world_facts")), false, "facts are not queried for an empty active roster");
  } finally {
    db.prepare = prepare;
  }
});

test("schema mutation during receipt initialization cannot publish an unchecked revision", () => {
  db.exec("CREATE TABLE receipt_migration_probe (id INTEGER)");
  const other = openDatabase(path.join(dir, "test.sqlite"));
  if (other.encrypted) {
    other.pragma("cipher='chacha20'");
    other.pragma(`key='${process.env.DB_ENCRYPTION_KEY}'`);
  }
  const prepare = db.prepare.bind(db);
  let dropped = false;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.includes("SELECT name FROM sqlite_master")) return statement;
    return {
      ...statement,
      all: (...args) => {
        const rows = statement.all(...args);
        if (!dropped) {
          dropped = true;
          other.exec("DROP TABLE narrator_commands");
        }
        return rows;
      },
    };
  };
  try {
    assert.throws(() => listNarratorReceipts("campaign"), /no such table/);
  } finally { db.prepare = prepare; other.close(); }
  assert.deepEqual(listNarratorReceipts("campaign"), [], "next read must recheck the changed schema");
});

test("warm Ask schema keeps prepared programs but never caches the migration marker", () => {
  ensureAskQueue(db);
  ensureAskQueue(db);
  const exec = db.exec.bind(db), prepare = db.prepare.bind(db);
  let ddl = 0, migrated = 0;
  db.exec = sql => { ddl++; return exec(sql); };
  db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("INSERT OR IGNORE INTO campaign_ask_queue")) return statement;
    return { ...statement, run: (...args) => { migrated++; return statement.run(...args); } };
  };
  try {
    const statement = db.prepare("SELECT 1");
    ensureAskQueue(db);
    assert.equal(ddl, 0);
    assert.equal(db.prepare("SELECT 1"), statement);
    db.prepare("DELETE FROM odm_ask_queue_migrations").run();
    assert.throws(db.transaction(() => { ensureAskQueue(db); throw Error("rollback marker"); }), /rollback marker/);
    assert.equal(db.prepare("SELECT version FROM odm_ask_queue_migrations").get(), undefined);
    ensureAskQueue(db);
    assert.equal(migrated, 2, "a rolled-back marker must not suppress the migration");
    assert.equal(ddl, 0, "marker repair does not repeat existing schema DDL");
  } finally { db.exec = exec; db.prepare = prepare; }
  db.exec("DROP TABLE campaign_ask_queue; DROP TABLE odm_ask_queue_migrations");
  assert.throws(db.transaction(() => { ensureAskQueue(db); throw Error("rollback schema"); }), /rollback schema/);
  ensureAskQueue(db);
  assert.ok(db.prepare("SELECT version FROM odm_ask_queue_migrations WHERE version=1").get());
});

test.after(() => {
  db.close();
  removeTempDir(dir);
});
