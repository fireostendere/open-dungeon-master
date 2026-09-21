import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { NarratorOrchestrator } from "../narrator/orchestration.mjs";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-autopilot-mcp-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const {
  createCampaign,
  getGlobalTurnState,
  joinByInviteCode,
  latestSeq,
  setCampaignStatus,
  setMemberAutopilot,
} = await import("../src/lib/db/campaigns.ts");
const { createCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { startGlobalTurn } = await import("../src/lib/dm/global-turn-logic.ts");
const { executeMcpNarratorControl, McpNarratorControlError } = await import("../src/lib/mcp-narrator-control.ts");

function characterInput(name) {
  return createSheetSchema.parse({
    name,
    race: "human",
    class: "fighter",
    subclass: "",
    background: "soldier",
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    maxHp: 12,
    ac: 16,
    speed: 30,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: {
      saves: ["str", "con"],
      skills: ["athletics"],
      languages: ["common"],
      tools: [],
      armor: [],
      weapons: [],
    },
    equipment: [],
    gold: 0,
    copper: 0,
  });
}

test("trusted MCP autopilot action requires live opt-in and seals quorum without server AI", async () => {
  const dm = createUser("autopilot_dm", "hash");
  const player = createUser("autopilot_player", "hash");
  const campaign = createCampaign(dm.id, {
    title: "Autopilot",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {
      dmMode: "human",
      ttsEnabled: false,
      mapsEnabled: false,
      globalTurn: {
        enabled: true,
        turnCollectionMinutes: 0,
        quorumPlayers: 1,
        quorumDelayMinutes: 0,
      },
    },
  });
  const joined = joinByInviteCode(player.id, campaign.inviteCode);
  assert.equal("error" in joined, false);

  const library = createCharacter(player.id, 1, characterInput("Игнат"));
  const sheet = instantiateIntoCampaign(library.id, campaign.id, player.id, 1);
  assert.ok(!("error" in sheet));
  setCampaignStatus(campaign.id, "active");

  const started = startGlobalTurn(campaign.id, "mcp_trigger");
  assert.equal(started?.phase, "active");
  const before = latestSeq(campaign.id);

  await assert.rejects(
    () => executeMcpNarratorControl("narrator.autopilot_action", {
      campaignId: campaign.id,
      expectedSeq: before,
      commandId: randomUUID(),
      characterId: sheet.id,
      roundNumber: 1,
      kind: "do",
      content: "Игнат оглядывается и держится рядом с группой.",
    }),
    error => error instanceof McpNarratorControlError && error.status === 409,
  );
  assert.equal(latestSeq(campaign.id), before, "rejected impersonation must not consume the story cursor");

  assert.equal(setMemberAutopilot(campaign.id, player.id, true)?.autopilot, true);
  const commandId = randomUUID();
  const result = await executeMcpNarratorControl("narrator.autopilot_action", {
    campaignId: campaign.id,
    expectedSeq: before,
    commandId,
    characterId: sheet.id,
    roundNumber: 1,
    kind: "do",
    content: "Игнат оглядывается и держится рядом с группой.",
  });
  assert.equal(result.handled, true);
  assert.equal(result.result.commandId, commandId);
  assert.equal(result.result.result.characterId, sheet.id);
  assert.equal(getGlobalTurnState(campaign.id).phase, "ready", "zero-grace quorum must seal in the same trusted write");

  const replay = await executeMcpNarratorControl("narrator.autopilot_action", {
    campaignId: campaign.id,
    expectedSeq: before,
    commandId,
    characterId: sheet.id,
    roundNumber: 1,
    kind: "do",
    content: "Игнат оглядывается и держится рядом с группой.",
  });
  assert.equal(replay.result.replayed, true, "receipt recovery must not duplicate the player action");
});

test("orchestrator uses the isolated actor role and MCP write during an active global round", async () => {
  const generated = [];
  const calls = [];
  const adapter = {
    runtimeSource: "custom-opencode",
    generate: async (role, prompt) => {
      generated.push({ role, packet: JSON.parse(prompt) });
      if (role !== "actor") throw new Error(`unexpected role ${role}`);
      return JSON.stringify({ kind: "do", content: "Игнат прикрывает товарищей и внимательно осматривает проход." });
    },
  };
  const controller = new NarratorOrchestrator({ adapter, startAfterSeq: 0, maxSteps: 4 });
  const snapshot = {
    campaignId: "11111111-1111-4111-8111-111111111111",
    campaign: {
      id: "11111111-1111-4111-8111-111111111111",
      dmUserId: "22222222-2222-4222-8222-222222222222",
      title: "Game",
      theme: "",
      scene: "Corridor",
      floor: { mode: "open" },
      gameSettings: { globalTurn: { enabled: true }, unitSystem: "metric", language: "ru" },
      globalTurnState: { roundNumber: 3, phase: "active", actionsByCharacter: {} },
    },
    currentSeq: 10,
    nextCursor: 10,
    hasMore: false,
    timelineEpoch: "a".repeat(64),
    spatial: { enabled: false },
    messages: [],
    recentMessages: [],
    events: [],
    recentRolls: [],
    pendingRolls: [],
    members: [{
      userId: "33333333-3333-4333-8333-333333333333",
      username: "player",
      autopilot: true,
      muted: false,
      skipTurnsCount: 0,
    }],
    sheets: [{
      id: "44444444-4444-4444-8444-444444444444",
      userId: "33333333-3333-4333-8333-333333333333",
      name: "Игнат",
      class: "fighter",
      level: 3,
      isCompanion: false,
      deathSaves: { dead: false },
    }],
  };
  const host = {
    campaignId: snapshot.campaignId,
    timelineEpoch: snapshot.timelineEpoch,
    lastSeq: 10,
    stopping: false,
    readMaxBytes: 65536,
    sectionCache: null,
    stateCache: null,
    saveCheckpoint: () => {},
    memory: {
      getPromptContext: ({ viewerUserId }) => ({
        summary: "",
        recentMessages: [{ content: "visible only to the opted-in player", witnessUserIds: [viewerUserId] }],
      }),
    },
    callControl: async (action, params) => {
      calls.push({ action, params });
      if (action !== "narrator.autopilot_action") throw new Error(`unexpected control action ${action}`);
      return {
        commandId: params.commandId,
        receiptId: randomUUID(),
        committedSeq: 12,
        currentSeq: 12,
        replayed: false,
        result: { characterId: params.characterId, messageId: randomUUID(), sealed: false },
      };
    },
    drainStory: async () => ({ ...snapshot, currentSeq: 12, nextCursor: 12 }),
  };

  const progressed = await controller.tick(host, snapshot);
  assert.equal(progressed, true);
  assert.deepEqual(generated.map(item => item.role), ["actor"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "narrator.autopilot_action");
  assert.equal(calls[0].params.characterId, snapshot.sheets[0].id);
  assert.equal(calls[0].params.roundNumber, 3);
  assert.equal(calls[0].params.kind, "do");
  assert.equal(controller.state.current, null);
  assert.equal(controller.state.pending, null);
  assert.equal(controller.state.handledSeq, 0, "autopilot message must remain pending for the later global_turn_ready batch");
});

removeTempDir(dir);
console.log("PASS external MCP autopilot opt-in, actor orchestration, idempotency, and quorum sealing");
