import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-global-turn-start-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const {
  createCampaign,
  getFloor,
  getGlobalTurnState,
  setCampaignStatus,
  setFloor,
} = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { recordGlobalTurnAction, startGlobalTurn, sealGlobalTurnNow } = await import("../src/lib/dm/global-turn-logic.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(scriptsDir, relative), "utf8");

try {
  const owner = createUser("start-turn-owner", "hash");
  const campaign = createCampaign(owner.id, {
    title: "Lead round recovery",
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
        quorumDelayMinutes: 0,
      },
    },
  });
  setCampaignStatus(campaign.id, "active");

  // Simulate the common stuck state: the round is WAITING and a stale floor
  // hold from narration still blocks the composer.
  setFloor(campaign.id, { mode: "hold", next: { mode: "open" } });
  const started = startGlobalTurn(campaign.id, "lead_recovery");
  assert.ok(started);
  assert.equal(started.phase, "active");
  assert.equal(started.roundNumber, 1);
  assert.deepEqual(getFloor(campaign.id), { mode: "open" }, "start must repair a stale input floor lock");

  const startedEvent = getDatabase()
    .prepare(
      "SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND type = 'global_turn_started' ORDER BY seq DESC LIMIT 1",
    )
    .get(campaign.id);
  assert.ok(startedEvent);
  assert.equal(JSON.parse(startedEvent.payload_json).reason, "lead_recovery");

  // Re-opening an already active round must be idempotent: no new round number
  // and no loss of already-collected action usage.
  const first = recordGlobalTurnAction(campaign.id, "hero", owner.id, "do");
  assert.equal(first.allowed, true);
  assert.equal(first.state?.actionsByCharacter.hero.actionsCount, 1);
  assert.equal(recordGlobalTurnAction(campaign.id, "hero", owner.id, "do").allowed, false,
    "one submitted Do must lock the character until the DM completes the round");
  setFloor(campaign.id, {
    mode: "spotlight",
    userIds: ["stale-user"],
    prompt: "",
    respondedUserIds: [],
  });

  const reopened = startGlobalTurn(campaign.id, "lead_recovery");
  assert.ok(reopened);
  assert.equal(reopened.roundNumber, 1);
  assert.equal(reopened.phase, "active");
  assert.equal(reopened.actionsByCharacter.hero.actionsCount, 1);
  assert.deepEqual(getFloor(campaign.id), { mode: "open" }, "re-open must clear stale spotlight without wiping submissions");

  const sealed = sealGlobalTurnNow(campaign.id, 1);
  assert.equal(sealed.phase, "ready", "lead response request must seal the current collection window");
  assert.equal(sealed.roundNumber, 1);
  assert.equal(getGlobalTurnState(campaign.id).actionsByCharacter.hero.actionsCount, 1);
  assert.ok(getDatabase().prepare("SELECT 1 FROM campaign_events WHERE campaign_id = ? AND type = 'global_turn_ready'").get(campaign.id));

  const route = read("../src/app/api/campaigns/[campaignId]/global-turn/start/route.ts");
  const resolveRoute = read("../src/app/api/campaigns/[campaignId]/global-turn/resolve/route.ts");
  const card = read("../src/app/campaigns/[campaignId]/GlobalTurnCard.tsx");

  assert.match(route, /requireLead\(campaignId\)/);
  assert.match(route, /startGlobalTurn\(campaignId, "lead_recovery"\)/);
  assert.match(route, /current\.phase === "ready" \|\| current\.phase === "resolving"/);
  assert.match(card, /Стартовать раунд/);
  assert.match(card, /Переоткрыть ввод/);
  assert.match(card, /\/global-turn\/start/);
  assert.match(card, /\/global-turn\/resolve/);
  assert.match(resolveRoute, /requireLead\(campaignId\)/);
  assert.match(resolveRoute, /sealGlobalTurnNow\(campaignId, before\.roundNumber\)/);

  console.log("PASS lead can recover, then seal a global round on demand");
} finally {
  removeTempDir(dir);
}
