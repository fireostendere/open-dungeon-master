import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-claim-race-"));
process.env.SQLITE_DB_PATH = path.join(root, "race.sqlite");
process.env.DB_ENCRYPTION_KEY = "claim-race-test-key";
process.env.ODM_SQLITE_DRIVER = "node";
process.env.ODM_MEDIA_ROOT = path.join(root, "media");

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createPack } = await import("../src/lib/db/asset-pipeline.ts");
const db = getDatabase();
const now = new Date().toISOString();
db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
  .run("race-user", "race_owner", "x", now);
db.prepare(`
  INSERT INTO campaigns (
    id, title, description, invite_code, owner_user_id, status, max_players, starting_level,
    difficulty, theme, settings_json, scene, quest_log_json, story_summary, story_summary_count,
    next_seq, created_at, updated_at
  ) VALUES (?, ?, '', ?, ?, 'lobby', 5, 1, 'normal', '', '{}', '', '[]', '', 0, 1, ?, ?)
`).run("race-campaign", "Claim race", "RACE1234", "race-user", now, now);
const pack = createPack({
  campaignId: "race-campaign",
  title: "Race pack",
  packType: "test",
  jobs: [{ kind: "generic", title: "Race job", dedupeKey: "race-job" }],
});
const jobId = pack.jobs[0].id;

function runWorker(workerId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "asset-claim-worker.mjs")], {
      env: {
        ...process.env,
        ODM_TEST_JOB_ID: jobId,
        ODM_TEST_WORKER_ID: workerId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, workerId }));
  });
}

const [a, b] = await Promise.all([runWorker("race-worker-a"), runWorker("race-worker-b")]);
const winners = [a, b].filter((result) => result.code === 0);
const losers = [a, b].filter((result) => result.code !== 0);
assert.equal(winners.length, 1, JSON.stringify({ a, b }));
assert.equal(losers.length, 1, JSON.stringify({ a, b }));
assert.match(losers[0].stdout + losers[0].stderr, /not claimable|claimed/i);

const row = db.prepare("SELECT status, claimed_by, attempts FROM asset_jobs WHERE id = ?").get(jobId);
assert.equal(row.status, "claimed");
assert.equal(row.claimed_by, winners[0].workerId);
assert.equal(row.attempts, 1, "losing concurrent worker must not increment attempts");
console.log(`asset claim concurrency: winner=${winners[0].workerId}`);

globalThis.__localRoleplayDb?.close();
globalThis.__localRoleplayDb = undefined;
fs.rmSync(root, { recursive: true, force: true });
