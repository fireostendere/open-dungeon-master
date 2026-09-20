// Real application DB + narrator integration. Run with the repository's
// installed dependencies. No provider or external network may be contacted.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
const previousCwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-spatial-integration-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, latestSeq } = await import("../src/lib/db/campaigns.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listEventsSince } = await import("../src/lib/events.ts");
const { executeMcpNarratorControl, McpNarratorControlError } = await import("../src/lib/mcp-narrator-control.ts");
const { spatialStore, spatialContext } = await import("../src/lib/spatial/service.ts");
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Location narration must not call a provider or network"); };
try {
  const dm = createUser("spatial_dm", "hash");
  const campaign = createCampaign(dm.id, { title: "Split party", description: "", theme: "", maxPlayers: 4,
    startingLevel: 1, difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false } });
  setCampaignStatus(campaign.id, "active");
  const invoke = (name, args) => executeMcpNarratorControl("narrator.invoke", {
    campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name, args,
  });
  // A failed first write must not leave a cached store pointing at rolled-back DDL.
  await assert.rejects(() => invoke("location_create_room", { name: "Too early" }), error => error instanceof McpNarratorControlError && error.status === 409);
  const enabled = await invoke("location_enable", { name: "Street" });
  const street = enabled.result.result.roomId;
  const created = await invoke("location_create_room", { name: "Tavern", connectTo: street, sound: true, sight: true });
  const tavern = created.result.result.roomId;
  const cursorBefore = latestSeq(campaign.id);
  const request = { campaignId: campaign.id, expectedSeq: cursorBefore, commandId: randomUUID(),
    name: "location_narrate", args: { roomId: tavern, content: "secret-scene-marker" } };
  const first = await executeMcpNarratorControl("narrator.invoke", request);
  const replay = await executeMcpNarratorControl("narrator.invoke", request);
  assert.equal(replay.result.replayed, true);
  assert.equal(first.result.result.messageId, replay.result.result.messageId);
  assert.equal(JSON.stringify(first.result.result).includes("secret-scene-marker"), false, "receipts should not duplicate narrator prose");
  const read = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: cursorBefore, projection: "live" });
  assert.equal(read.result.spatial.enabled, true);
  assert.ok(read.result.spatialRooms.some(room => room.id === tavern));
  assert.equal(read.result.messages.filter(message => message.content === "secret-scene-marker").length, 1);
  assert.equal(read.result.messages.find(message => message.content === "secret-scene-marker").roomId, tavern);
  assert.equal(JSON.stringify(listEventsSince(campaign.id, 0, 500)).includes("secret-scene-marker"), false);
  assert.equal(JSON.stringify(listRecentMessages(campaign.id, 400)).includes("secret-scene-marker"), false);
  await assert.rejects(() => executeMcpNarratorControl("narrator.narrate", {
    campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), content: "must-not-be-global",
  }), error => error instanceof McpNarratorControlError && error.status === 409);
  const { actor } = spatialContext(campaign.id, dm.id);
  spatialStore().command(actor, randomUUID(), "send", { kind: "ooc", content: "global-ooc-marker" });
  const afterOoc = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: read.result.currentSeq, projection: "live" });
  assert.equal(JSON.stringify(afterOoc.result.messages).includes("global-ooc-marker"), false);
  assert.equal(afterOoc.result.hasMore, false);
  assert.equal(afterOoc.result.nextCursor, latestSeq(campaign.id));
  const catalog = await executeMcpNarratorControl("narrator.catalog", { campaignId: campaign.id });
  assert.ok(catalog.result.groups.flatMap(group => group.entries).some(entry => entry.name === "location_observe"));
  assert.ok(catalog.result.groups.flatMap(group => group.entries).some(entry => entry.name === "location_disable"));
  const disabled = await invoke("location_disable", {});
  assert.equal(disabled.result.result.disabled, true);
  const afterDisable = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: latestSeq(campaign.id), projection: "live" });
  assert.equal(afterDisable.result.spatial.enabled, false);
  console.log("Spatial application/narrator integration passed.");
} finally {
  globalThis.fetch = nativeFetch;
  process.chdir(previousCwd);
  removeTempDir(dir);
}
