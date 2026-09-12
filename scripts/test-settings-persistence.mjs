// Regression: campaign story settings must survive a server restart
// unchanged. Upstream core.ts carried a one-off migration for the author's
// own machine that rewrote every customBaseUrl ending in :11434/v1 to
// :8001/v1 on each DB open, silently breaking Ollama backends. The rewrite
// was removed on local/table-ready; this test re-opens the database in a
// child process (exactly like a restart) and asserts the stored settings —
// including an Ollama /v1 URL — come back byte-for-byte.
//
// Usage: node scripts/test-settings-persistence.mjs   (self-re-executes phase2)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const here = fileURLToPath(import.meta.url);

if (process.argv[2] === "phase2") {
  // Fresh process, existing DB file: getDatabase() runs the whole schema
  // pass again — this is the restart the regression hid in.
  register("./lib/register-alias.mjs", import.meta.url);
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const db = getDatabase();
  const row = db
    .prepare("SELECT settings_json FROM campaigns WHERE id = ?")
    .get(process.env.TEST_CAMPAIGN_ID);
  assert.ok(row, "campaign row missing after reopen");
  const settings = JSON.parse(row.settings_json);
  assert.equal(
    settings.customBaseUrl,
    "http://127.0.0.1:11434/v1",
    "customBaseUrl was rewritten across a DB reopen (the stale-backend migration is back)",
  );
  assert.equal(settings.customModel, "qwen3.8-dm", "customModel changed across reopen");
  assert.equal(settings.textProvider, "custom", "textProvider changed across reopen");
  console.log("ok: settings unchanged after DB reopen (restart)");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-settings-persistence-"));
const dbPath = path.join(dir, "test.sqlite");
const key = randomBytes(32).toString("hex");
process.env.SQLITE_DB_PATH = dbPath;
process.env.DB_ENCRYPTION_KEY = key;
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, updateStorySettings } = await import("../src/lib/db/campaigns.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const user = createUser("settings-owner", randomBytes(9).toString("hex"));
const campaign = createCampaign(user.id, {
  title: "Persistence check",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: {},
});

test("story settings accept an Ollama /v1 backend", () => {
  const saved = updateStorySettings(campaign.id, {
    textProvider: "custom",
    customBaseUrl: "http://127.0.0.1:11434/v1",
    customModel: "qwen3.8-dm",
  });
  assert.equal(saved.customBaseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(saved.customModel, "qwen3.8-dm");
});

test("settings survive a full DB reopen (restart)", () => {
  execFileSync(process.execPath, [here, "phase2"], {
    env: {
      ...process.env,
      SQLITE_DB_PATH: dbPath,
      DB_ENCRYPTION_KEY: key,
      TEST_CAMPAIGN_ID: campaign.id,
    },
    stdio: "inherit",
    cwd: path.dirname(path.dirname(here)),
  });
});

removeTempDir(dir);
console.log(`test-settings-persistence: ${passed} passed`);
