import test, { after } from "node:test";
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
register("./lab/lab-loader.mjs", import.meta.url);
const { labRequest } = await import("./lab/next-headers-shim.mjs");
const { mintSession } = await import("../src/lib/auth.ts");
const autopilotRoute = await import("../src/app/api/campaigns/[campaignId]/members/[userId]/autopilot/route.ts");

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

const nativeFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls += 1;
  throw new Error("server provider/network call is forbidden");
};

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
  assert.equal(fetchCalls, 0, "server autopilot path must not call a model/provider/network");
});

test("frontend opt-in hands control to the narrator even behind a closed round gate", async () => {
  const dm = createUser("handoff_dm", "hash");
  const player = createUser("handoff_player", "hash");
  const campaign = createCampaign(dm.id, {
    title: "Handoff", description: "", theme: "", maxPlayers: 4,
    startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false,
      globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 1, quorumDelayMinutes: 0 } },
  });
  joinByInviteCode(player.id, campaign.inviteCode);
  const library = createCharacter(player.id, 1, characterInput("Автопилот"));
  const sheet = instantiateIntoCampaign(library.id, campaign.id, player.id, 1);
  setCampaignStatus(campaign.id, "active");
  const token = mintSession(player.id).token;
  const post = async (autopilot, session = token) => {
    const request = new Request("http://odm.test/autopilot", {
      method: "POST", headers: { Authorization: `Bearer ${session}` },
      body: JSON.stringify({ autopilot }),
    });
    return labRequest.run(request, () => autopilotRoute.POST(request, {
      params: Promise.resolve({ campaignId: campaign.id, userId: player.id }),
    }));
  };
  const before = latestSeq(campaign.id);
  assert.equal(getGlobalTurnState(campaign.id).phase, "waiting");
  assert.equal((await post(true)).status, 200);
  const read = (await executeMcpNarratorControl("narrator.read", {
    campaignId: campaign.id, afterSeq: before, projection: "live", maxBytes: 131072,
  })).result;
  const requests = read.events.filter(e => e.type === "autopilot_action_requested");
  assert.equal(requests.length, 1, "enabling must wake the narrator even while input is locked");
  assert.equal(requests[0].payload.characterId, sheet.id);
  assert.equal(requests[0].payload.controller, "narrator");
  assert.equal(requests[0].payload.reason, "autopilot_enabled");
  assert.equal(read.members.find(m => m.userId === player.id).autopilot, true);
  assert.equal(getGlobalTurnState(campaign.id).phase, "waiting", "handoff must not open a round");
  const enabledSeq = latestSeq(campaign.id);
  assert.equal((await post(true)).status, 200);
  assert.equal(latestSeq(campaign.id), enabledSeq, "repeated enable must not duplicate a wake signal");
  assert.equal((await post(false)).status, 200);
  const disabled = (await executeMcpNarratorControl("narrator.read", {
    campaignId: campaign.id, afterSeq: enabledSeq, projection: "live", maxBytes: 131072,
  })).result;
  assert.equal(disabled.members.find(m => m.userId === player.id).autopilot, false);
  assert.equal(disabled.events.some(e => e.type === "autopilot_action_requested"), false);
  assert.equal((await post(true, mintSession(dm.id).token)).status, 403, "DM cannot opt in a player");
  assert.equal(fetchCalls, 0, "handoff must never call a model/provider/network");
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

  const fallbackCalls = [];
  const fallbackController = new NarratorOrchestrator({
    adapter: {
      runtimeSource: "custom-opencode",
      generate: async () => {
        throw new Error("actor timed out");
      },
    },
    startAfterSeq: 0,
    maxSteps: 4,
  });
  const fallbackHost = {
    ...host,
    callControl: async (action, params) => {
      fallbackCalls.push({ action, params });
      return {
        commandId: params.commandId,
        receiptId: randomUUID(),
        committedSeq: 12,
        currentSeq: 12,
        replayed: false,
        result: { characterId: params.characterId, messageId: randomUUID(), sealed: false },
      };
    },
  };
  assert.equal(await fallbackController.tick(fallbackHost, snapshot), true);
  assert.equal(fallbackController.state.paused, null, "actor failure must not pause the narrator host");
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].action, "narrator.autopilot_action");
  assert.equal(fallbackCalls[0].params.kind, "do");
  assert.match(fallbackCalls[0].params.content, /Игнат/);
  assert.match(fallbackCalls[0].params.content, /не тратит ограниченные ресурсы/);
});

after(() => {
  globalThis.fetch = nativeFetch;
  removeTempDir(dir);
});
console.log("PASS external MCP autopilot opt-in, actor orchestration, idempotency, and quorum sealing");
