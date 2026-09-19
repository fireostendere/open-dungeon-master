import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-schema-upgrade-"));
process.env.SQLITE_DB_PATH = path.join(root, "existing.sqlite");
process.env.DB_ENCRYPTION_KEY = "schema-upgrade-test-key";
process.env.ODM_SQLITE_DRIVER = "node";
process.env.ODM_MEDIA_ROOT = path.join(root, "media");

const { openDatabase } = await import("../src/lib/db/driver.ts");
const legacy = openDatabase(process.env.SQLITE_DB_PATH);
legacy.exec(`
  CREATE TABLE encounters (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    round INTEGER NOT NULL DEFAULT 1,
    turn_index INTEGER NOT NULL DEFAULT 0,
    order_ready INTEGER NOT NULL DEFAULT 0,
    order_json TEXT NOT NULL DEFAULT '[]',
    waiting_seq INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
legacy.close();

const { getDatabase } = await import("../src/lib/db/core.ts");
const db = getDatabase();
const before = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
);
assert.equal(before.has("asset_packs"), false, "pre-feature database should not require external tables yet");
assert.equal(before.has("character_progress_events"), false);

// Existing ODM's migration convention is idempotent CREATE/ALTER during
// first use/startup rather than a separate migration executable. Feature
// access must therefore upgrade an already-created DB without operator SQL.
const { ensureAssetPipelineSchema } = await import("../src/lib/db/asset-pipeline.ts");
const { ensureProgressSchema } = await import("../src/lib/db/progress-sync.ts");
ensureAssetPipelineSchema();
ensureProgressSchema();
ensureAssetPipelineSchema();
ensureProgressSchema();

const after = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
);
for (const table of [
  "asset_packs",
  "asset_jobs",
  "asset_files",
  "asset_links",
  "asset_access_grants",
  "character_progress_state",
  "character_progress_events",
]) {
  assert.ok(after.has(table), `missing upgraded table ${table}`);
}

const indexes = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name),
);
for (const index of [
  "idx_encounters_room",
  "idx_asset_packs_campaign",
  "idx_asset_jobs_campaign_status",
  "idx_asset_jobs_pack_status",
  "idx_asset_files_campaign",
  "idx_asset_files_job",
  "idx_asset_files_sha256",
  "idx_asset_links_target",
  "idx_character_progress_revision",
  "idx_character_progress_campaign",
]) {
  assert.ok(indexes.has(index), `missing upgraded index ${index}`);
}
const encounterColumns = new Set(
  db.prepare("PRAGMA table_info(encounters)").all().map((row) => row.name),
);
assert.ok(encounterColumns.has("room_id"), "legacy encounters table did not gain room_id before indexing");

console.log("external schema migration: automatic and idempotent");

globalThis.__localRoleplayDb?.close();
globalThis.__localRoleplayDb = undefined;
fs.rmSync(root, { recursive: true, force: true });
