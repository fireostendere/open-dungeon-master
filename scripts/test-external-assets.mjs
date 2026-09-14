import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "odm-assets-test-"));
process.env.SQLITE_DB_PATH = path.join(root, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = "asset-test-key";
process.env.ODM_SQLITE_DRIVER = "node";
process.env.ODM_MEDIA_ROOT = path.join(root, "media");
process.env.ODM_ASSET_MAX_BYTES = String(1024 * 1024);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { inspectImage } = await import("../src/lib/assets/image.ts");
const { assetStorage } = await import("../src/lib/assets/storage.ts");
const { planCampaignAssets } = await import("../src/lib/assets/planner.ts");
const {
  assetHealth,
  attachAsset,
  beginUploadGrant,
  claimJob,
  consumeDownloadGrant,
  createDownloadGrant,
  createPack,
  createUploadGrant,
  deleteAsset,
  ensureAssetPipelineSchema,
  failUploadGrant,
  finishUploadGrant,
  getJob,
  listAssets,
  listJobs,
  setPrimaryAsset,
  submitResult,
} = await import("../src/lib/db/asset-pipeline.ts");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngVariant(source, text) {
  const iend = source.length - 12;
  const data = Buffer.from(text, "utf8");
  const type = Buffer.from("tEXt", "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return Buffer.concat([source.subarray(0, iend), chunk, source.subarray(iend)]);
}

const PNG_ALT = pngVariant(PNG, "variant=two");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const db = getDatabase();
ensureAssetPipelineSchema();
const now = new Date().toISOString();
db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
  .run("user-assets", "asset_owner", "x", now);
db.prepare(`
  INSERT INTO campaigns (
    id, title, description, invite_code, owner_user_id, status, max_players, starting_level,
    difficulty, theme, settings_json, scene, quest_log_json, story_summary, story_summary_count,
    next_seq, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'lobby', 5, 1, 'normal', ?, '{}', ?, ?, '', 0, 1, ?, ?)
`).run(
  "campaign-assets",
  "Ash Observatory",
  "A ruined observatory and the cult beneath it",
  "ASSET123",
  "user-assets",
  "dark fantasy",
  "The party enters the shattered telescope hall.",
  JSON.stringify(["Find the missing astronomer"]),
  now,
  now,
);
db.prepare("INSERT INTO npcs (id, campaign_id, name, trait, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
  .run("npc-smith", "campaign-assets", "Berrik", "scarred practical smith", "Old Forge", now, now);
db.prepare("INSERT INTO locations (id, campaign_id, name, layout_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
  .run("loc-observatory", "campaign-assets", "Ruined Observatory", "collapsed dome, brass telescope, flooded lower ring", now, now);

await test("image inspector validates dimensions and hash", () => {
  const inspected = inspectImage(PNG);
  assert.equal(inspected.mimeType, "image/png");
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  assert.equal(inspected.sha256.length, 64);
});

await test("corrupted PNG is rejected instead of trusting magic bytes", () => {
  const corrupted = Buffer.from(PNG);
  corrupted[corrupted.length - 20] ^= 0x01;
  assert.throws(() => inspectImage(corrupted), /Corrupted PNG/);
});

await test("planner is deterministic and idempotent", () => {
  const first = planCampaignAssets("campaign-assets");
  const firstIds = first.pack.jobs.map((entry) => entry.id).sort();
  assert.ok(firstIds.length >= 5, `expected a useful backlog, got ${firstIds.length}`);
  const second = planCampaignAssets("campaign-assets");
  assert.deepEqual(second.pack.jobs.map((entry) => entry.id).sort(), firstIds);
  assert.equal(second.changes.planned.length, 0);
});

const manualPack = createPack({
  campaignId: "campaign-assets",
  title: "Villain variants",
  packType: "npc_pack",
  jobs: [{
    kind: "npc_portrait",
    title: "Villain portrait",
    suggestedPrompt: "A masked astronomer cult leader",
    target: { type: "npc", id: "npc-smith" },
    dedupeKey: "villain-portrait",
  }],
});
const jobId = manualPack.jobs[0].id;

await test("job claim excludes a second worker and expired leases recover", () => {
  const first = claimJob(jobId, "worker-a", 60);
  assert.equal(first.claimedBy, "worker-a");
  assert.throws(() => claimJob(jobId, "worker-b", 60), /not claimable|claimed/i);
  db.prepare("UPDATE asset_jobs SET claim_expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", jobId);
  const second = claimJob(jobId, "worker-b", 60);
  assert.equal(second.claimedBy, "worker-b");
  assert.equal(second.attempts, 2);
});

await test("upload grants are one-time, MIME-scoped and size-scoped", () => {
  const wrongMime = createUploadGrant({ jobId, workerId: "worker-b", expectedMimeType: "image/jpeg", expectedMaxBytes: 1024 });
  beginUploadGrant(wrongMime.uploadId, wrongMime.token);
  assert.throws(() => beginUploadGrant(wrongMime.uploadId, wrongMime.token), /already been used/);
  assert.throws(() => finishUploadGrant(wrongMime.uploadId, inspectImage(PNG), PNG), /MIME/);
  failUploadGrant(wrongMime.uploadId);

  const tooSmall = createUploadGrant({ jobId, workerId: "worker-b", expectedMaxBytes: 16 });
  beginUploadGrant(tooSmall.uploadId, tooSmall.token);
  assert.throws(() => finishUploadGrant(tooSmall.uploadId, inspectImage(PNG), PNG), /size limit/);
  failUploadGrant(tooSmall.uploadId);
});

let primaryAsset;
let alternateAsset;
await test("submitted bytes become a persistent linked primary asset", () => {
  const grant = createUploadGrant({ jobId, workerId: "worker-b", expectedMimeType: "image/png" });
  beginUploadGrant(grant.uploadId, grant.token);
  finishUploadGrant(grant.uploadId, inspectImage(PNG), PNG);
  const submitted = submitResult({
    jobId,
    uploadId: grant.uploadId,
    workerId: "worker-b",
    provider: "qwen",
    model: "fixture-model",
    promptUsed: "A masked astronomer cult leader",
    variantLabel: "A",
    setPrimary: true,
  });
  primaryAsset = submitted.asset;
  assert.equal(primaryAsset.provider, "qwen");
  assert.equal(primaryAsset.width, 1);
  assert.equal(primaryAsset.isPrimary, true);
  assert.ok(assetStorage().exists(primaryAsset.storageKey));
  assert.ok(primaryAsset.links.some((link) => link.entityType === "npc" && link.entityId === "npc-smith"));
  assert.equal(getJob(jobId).status, "ready");
});

await test("one job keeps alternatives, selects primary and deduplicates bytes", () => {
  const grant = createUploadGrant({ jobId, workerId: "worker-b", expectedMimeType: "image/png" });
  beginUploadGrant(grant.uploadId, grant.token);
  finishUploadGrant(grant.uploadId, inspectImage(PNG_ALT), PNG_ALT);
  const submitted = submitResult({
    jobId,
    uploadId: grant.uploadId,
    workerId: "worker-b",
    provider: "external",
    variantLabel: "B",
    setPrimary: false,
  });
  alternateAsset = submitted.asset;
  assert.equal(listAssets({ jobId }).length, 2);
  setPrimaryAsset({ assetId: alternateAsset.id, entityType: "npc", entityId: "npc-smith" });
  const rows = listAssets({ jobId });
  assert.equal(rows.find((asset) => asset.id === alternateAsset.id).isPrimary, true);
  assert.equal(rows.find((asset) => asset.id === primaryAsset.id).isPrimary, false);

  const duplicateGrant = createUploadGrant({ jobId, workerId: "worker-b", expectedMimeType: "image/png" });
  beginUploadGrant(duplicateGrant.uploadId, duplicateGrant.token);
  finishUploadGrant(duplicateGrant.uploadId, inspectImage(PNG_ALT), PNG_ALT);
  const duplicate = submitResult({ jobId, uploadId: duplicateGrant.uploadId, workerId: "worker-b", variantLabel: "duplicate" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(listAssets({ jobId }).length, 2);
});

await test("linked deletion requires confirm and explicit force", () => {
  attachAsset({ assetId: alternateAsset.id, entityType: "campaign", entityId: "campaign-assets", role: "gallery" });
  assert.throws(() => deleteAsset(alternateAsset.id, false, false), /confirm=true/);
  assert.throws(() => deleteAsset(alternateAsset.id, true, false), /still linked/);
});

await test("reference download grant is scoped and one-time", () => {
  const grant = createDownloadGrant(primaryAsset.id, 60);
  const asset = consumeDownloadGrant(grant.downloadId, grant.token);
  assert.equal(asset.id, primaryAsset.id);
  assert.throws(() => consumeDownloadGrant(grant.downloadId, grant.token), /already been used/);
});

await test("storage rejects traversal and health sees consistent media", () => {
  assert.throws(() => assetStorage().read("../secrets.txt"), /storage key/);
  const health = assetHealth("campaign-assets");
  assert.equal(health.ok, true, JSON.stringify(health));
  assert.deepEqual(health.missingFiles, []);
  assert.deepEqual(health.brokenLinks, []);
});

await test("ready job remains visible through status filters", () => {
  const ready = listJobs({ campaignId: "campaign-assets", status: "ready" });
  assert.ok(ready.some((entry) => entry.id === jobId));
});

console.log(`external asset tests: ${passed} passed`);

globalThis.__localRoleplayDb?.close();
globalThis.__localRoleplayDb = undefined;
fs.rmSync(root, { recursive: true, force: true });
