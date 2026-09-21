import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-global-turn-force-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const {
  createCampaign,
  getGlobalTurnState,
  setCampaignStatus,
} = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const {
  resolveGlobalTurn,
  startGlobalTurn,
} = await import("../src/lib/dm/global-turn-logic.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(scriptsDir, relative), "utf8");

try {
  const owner = createUser("force-turn-owner", "hash");
  const campaign = createCampaign(owner.id, {
    title: "Manual turn finish",
    description: "",
    theme: "",
    maxPlayers: 6,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {
      globalTurn: {
        enabled: true,
        turnCollectionMinutes: 0,
        quorumPlayers: 6,
        quorumDelayMinutes: 30,
      },
    },
  });
  setCampaignStatus(campaign.id, "active");

  const started = startGlobalTurn(campaign.id, "mcp_trigger");
  assert.ok(started);
  assert.equal(started.phase, "active");
  assert.equal(started.firstActionAt, null, "round should still have no player response");

  // Manual completion deliberately bypasses quorum/deadline readiness and uses
  // the same sealing primitive as automatic closure.
  const sealed = await resolveGlobalTurn(campaign.id, started.roundNumber);
  assert.ok(sealed);
  assert.equal(sealed.phase, "ready");
  assert.equal(getGlobalTurnState(campaign.id).phase, "ready");

  const readyEvent = getDatabase()
    .prepare(
      "SELECT type, payload_json FROM campaign_events WHERE campaign_id = ? AND type = 'global_turn_ready' ORDER BY seq DESC LIMIT 1",
    )
    .get(campaign.id);
  assert.ok(readyEvent, "manual sealing must persist the narrator wake-up barrier");
  assert.equal(readyEvent.type, "global_turn_ready");
  assert.equal(JSON.parse(readyEvent.payload_json).roundNumber, started.roundNumber);

  const route = read("../src/app/api/campaigns/[campaignId]/global-turn/resolve/route.ts");
  const card = read("../src/app/campaigns/[campaignId]/GlobalTurnCard.tsx");
  const orchestration = read("../narrator/orchestration.mjs");

  assert.match(route, /!isLead\(context\) && !steersStory\(context\)/);
  assert.match(route, /resolveGlobalTurn\(campaignId, roundNumber\)/);
  assert.match(card, /Завершить ход/);
  assert.match(card, /\/global-turn\/resolve/);
  assert.match(card, /roundNumber:\s*turnState\.roundNumber/);
  assert.match(
    orchestration,
    /event\.type === 'global_turn_ready'/,
    "the narrator host must wake on the barrier emitted by manual completion",
  );

  console.log("PASS manual global-turn finish seals immediately and wakes the MCP narrator");
} finally {
  removeTempDir(dir);
}
