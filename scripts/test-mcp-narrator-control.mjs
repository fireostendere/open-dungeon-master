// Regression coverage for the trusted, no-server-AI narrator control path.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-narrator-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { allocateSeq, createCampaign, setCampaignStatus, latestSeq, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { createCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn, createPendingRoll, resolvePendingRoll, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { insertAsk } = await import("../src/lib/db/asks.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { getRoll, insertRoll, setRollSeq } = await import("../src/lib/db/rolls.ts");
const { publishWithSeq } = await import("../src/lib/events.ts");
const { executeMcpNarratorControl, McpNarratorControlError, EXTERNAL_NARRATOR_ACTIONS } = await import("../src/lib/mcp-narrator-control.ts");
const { executeMcpControl } = await import("../src/lib/mcp-control.ts");
const { extendControlResult } = await import("../src/lib/mcp-external-control.ts");
const { resumeHumanTurn } = await import("../src/lib/dm/invoke.ts");

const capabilities = extendControlResult("server.capabilities", { actions: [] });
assert.deepEqual(capabilities.actions.slice(0, 6), [
  "narrator.connect", "narrator.read", "narrator.catalog", "narrator.invoke", "narrator.narrate", "narrator.release_floor",
]);
assert.equal(extendControlResult("server.status", { mcpControlActions: 0 }).mcpControlActions, capabilities.actions.length);

const dm = createUser("external_dm", "hash");
const campaign = createCampaign(dm.id, {
  title: "No AI", description: "", theme: "", maxPlayers: 4, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
updateStorySettings(campaign.id, { customApiKey: "must-not-leak" });
const libraryCharacter = createCharacter(dm.id, 1, createSheetSchema.parse({
  name: "Test Hero", race: "human", class: "fighter", subclass: "", background: "soldier",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, maxHp: 12, ac: 16, speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  equipment: [], gold: 0, copper: 0,
}));
const liveSheet = instantiateIntoCampaign(libraryCharacter.id, campaign.id, dm.id, 1);
assert.ok(!("error" in liveSheet));

const nativeFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls += 1; throw new Error("provider/network call is forbidden"); };

// Red regression: lobby writes used to leave a durable attempt marker.
const lobbySeq = latestSeq(campaign.id);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.narrate", { campaignId: campaign.id, expectedSeq: lobbySeq, content: "Too early." }),
  (error) => error instanceof McpNarratorControlError && error.status === 409,
);
assert.equal(latestSeq(campaign.id), lobbySeq, "lobby rejection must not consume a cursor");
setCampaignStatus(campaign.id, "active");

const connected = await executeMcpNarratorControl("narrator.connect", { campaignId: campaign.id });
assert.equal(connected.handled, true);
assert.ok(connected.result.state.currentSeq >= 0);
assert.equal(connected.result.state.campaign.dmOutline, "");
assert.equal(JSON.stringify(connected.result.state).includes("must-not-leak"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("generate_image"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("search_lore"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("set_npc"), true);
assert.equal(connected.result.state.campaign.gameSettings.mapsEnabled, false);

const first = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 1 });
assert.equal(first.result.hasMore, false);
const beforeNarrate = first.result.currentSeq;
const narrated = await executeMcpNarratorControl("narrator.narrate", {
  campaignId: campaign.id, expectedSeq: beforeNarrate, content: "The lantern gutters in the wind.",
});
assert.equal(narrated.result.currentSeq, latestSeq(campaign.id));
assert.ok(narrated.result.currentSeq > beforeNarrate);

const invoked = await executeMcpNarratorControl("narrator.invoke", {
  campaignId: campaign.id, expectedSeq: narrated.result.currentSeq, name: "set_npc", args: { name: "Mira", attitude: "friendly" },
});
assert.equal(invoked.result.result.ok, true, "audited rules engine action must resolve");
const npcRead = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 100 });
assert.equal(npcRead.result.npcs.some((npc) => npc.name === "Mira"), true);

const concurrentSeq = invoked.result.currentSeq;
const concurrent = await Promise.allSettled([
  executeMcpNarratorControl("narrator.narrate", { campaignId: campaign.id, expectedSeq: concurrentSeq, content: "One narrator wins." }),
  executeMcpNarratorControl("narrator.narrate", { campaignId: campaign.id, expectedSeq: concurrentSeq, content: "The stale duplicate loses." }),
]);
assert.equal(concurrent.filter((entry) => entry.status === "fulfilled").length, 1);
assert.equal(concurrent.filter((entry) => entry.status === "rejected").length, 1);

const partialSeq = latestSeq(campaign.id);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: partialSeq, name: "set_npc", args: {} }),
  McpNarratorControlError,
);
assert.equal(latestSeq(campaign.id), partialSeq, "refused engine command rolls back completely, including sequence");

const digitalSeq = latestSeq(campaign.id);
const digital = await executeMcpNarratorControl("narrator.invoke", {
  campaignId: campaign.id, expectedSeq: digitalSeq, name: "request_roll",
  args: { characterId: liveSheet.id, kind: "custom", expression: "1d20", reason: "A visible test roll" },
});
assert.equal(digital.result.result.ok, true);
assert.equal(typeof digital.result.result.result.total, "number");

await assert.rejects(
  () => executeMcpNarratorControl("narrator.narrate", { campaignId: campaign.id, expectedSeq: beforeNarrate, content: "Duplicate." }),
  (error) => error instanceof McpNarratorControlError && error.status === 409,
);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), name: "generate_image", args: {} }),
  (error) => error instanceof McpNarratorControlError && error.status === 403,
);

const page = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 1 });
assert.equal(page.result.hasMore, true);
assert.ok(page.result.nextCursor < page.result.currentSeq, "cursor must not masquerade as current sequence");

// A crashed publisher can allocate a trailing sequence without an event. A
// drained page must advance over that gap rather than trapping reconnects.
const hole = allocateSeq(campaign.id);
const drained = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: page.result.nextCursor, limit: 100 });
assert.equal(drained.result.hasMore, false);
assert.equal(drained.result.nextCursor, hole);

const turn = createDmTurn(campaign.id, [], "human_dm");
turn.status = "awaiting_rolls";
saveDmTurn(turn);
const pending = createPendingRoll({ campaignId: campaign.id, turnId: turn.id, toolCallId: null, userId: dm.id, characterId: null, kind: "check", detail: "test", expression: "1d20", advantage: "none", dc: null, reason: "test" });
assert.equal(pending.status, "pending");
const roll = insertRoll({ campaignId: campaign.id, requestedBy: "player", kind: "custom", result: { expression: "1d20", total: 17, terms: [] } });
assert.equal(resolvePendingRoll(pending.id, "submitted", roll.id)?.rollId, roll.id);
publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, pendingRollId: pending.id, source: "physical" });
assert.equal(resumeHumanTurn(turn.id), true, "real-dice completion resumes only the human turn");
const settled = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: hole, limit: 20 });
assert.equal(settled.result.events.find((event) => event.type === "roll_result")?.payload.roll.total, 17);
assert.equal(settled.result.events.find((event) => event.type === "roll_result")?.payload.pendingRollId, pending.id);
assert.equal(settled.result.recentRolls.find((entry) => entry.id === roll.id)?.total, 17);
assert.ok(settled.result.recentRolls.some((entry) => entry.total === digital.result.result.result.total));

const rollWithSeq = insertRoll({ campaignId: campaign.id, requestedBy: "player", kind: "custom", result: { expression: "1d20", total: 19, terms: [] }, seq: 42 });
assert.equal(rollWithSeq.eventSeq, 42);
const reloaded = getRoll(rollWithSeq.id);
assert.equal(reloaded?.eventSeq, 42);

setRollSeq(rollWithSeq.id, 43);
assert.equal(getRoll(rollWithSeq.id)?.eventSeq, 43);

setCampaignStatus(campaign.id, "ended");
const endedSeq = latestSeq(campaign.id);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.release_floor", { campaignId: campaign.id, expectedSeq: endedSeq }),
  (error) => error instanceof McpNarratorControlError && error.status === 409,
);
assert.equal(latestSeq(campaign.id), endedSeq);

const workshop = createCampaign(dm.id, {
  title: "Prep only", description: "", theme: "", maxPlayers: 1, startingLevel: 1,
  difficulty: "normal", kind: "workshop", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
setCampaignStatus(workshop.id, "active");
const workshopSeq = latestSeq(workshop.id);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.narrate", { campaignId: workshop.id, expectedSeq: workshopSeq, content: "No game write." }),
  (error) => error instanceof McpNarratorControlError && error.status === 409,
);
assert.equal(latestSeq(workshop.id), workshopSeq);

const unsafeSettings = createCampaign(dm.id, {
  title: "Unsafe settings", description: "", theme: "", maxPlayers: 1, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: true, mapsEnabled: false },
});
await assert.rejects(
  () => executeMcpNarratorControl("narrator.connect", { campaignId: unsafeSettings.id }),
  (error) => error instanceof McpNarratorControlError && error.status === 409,
);

const oocCampaign = createCampaign(dm.id, {
  title: "OOC Filter Test", description: "", theme: "", maxPlayers: 4, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
setCampaignStatus(oocCampaign.id, "active");

const icSeq = allocateSeq(oocCampaign.id);
const icMsg = insertCampaignMessage({
  campaignId: oocCampaign.id,
  seq: icSeq,
  authorType: "player",
  userId: dm.id,
  characterId: null,
  content: "I search for traps.",
});
publishWithSeq(oocCampaign.id, icSeq, "message_added", { message: icMsg });

const oocSeq = allocateSeq(oocCampaign.id);
const oocMsg = insertCampaignMessage({
  campaignId: oocCampaign.id,
  seq: oocSeq,
  authorType: "player",
  userId: dm.id,
  characterId: null,
  content: "(ooc) AFK grabbing tea",
});
publishWithSeq(oocCampaign.id, oocSeq, "message_added", { message: oocMsg });

const icSeq2 = allocateSeq(oocCampaign.id);
const icMsg2 = insertCampaignMessage({
  campaignId: oocCampaign.id,
  seq: icSeq2,
  authorType: "player",
  userId: dm.id,
  characterId: null,
  content: '"Can anyone hear me?"',
});
publishWithSeq(oocCampaign.id, icSeq2, "message_added", { message: icMsg2 });

const oocRead = await executeMcpNarratorControl("narrator.read", { campaignId: oocCampaign.id, afterSeq: 0, limit: 50 });
assert.equal(oocRead.result.messages.some((m) => m.id === oocMsg.id), false, "OOC message must not be in narrator.read messages");
assert.equal(oocRead.result.messages.some((m) => m.id === icMsg.id), true, "IC message must be in narrator.read messages");
assert.equal(oocRead.result.messages.some((m) => m.id === icMsg2.id), true, "Second IC message must be in narrator.read messages");

assert.equal(oocRead.result.recentMessages.some((m) => m.id === oocMsg.id), false, "OOC message must not be in recentMessages");
assert.equal(oocRead.result.recentMessages.some((m) => m.id === icMsg.id), true, "IC message must be in recentMessages");

const oocEvents = await executeMcpControl("campaigns.events", { campaignId: oocCampaign.id, afterSeq: 0, limit: 50 });
assert.equal(oocEvents.events.some((e) => e.seq === oocSeq), false, "OOC event must not be returned by campaigns.events");
assert.equal(oocEvents.events.some((e) => e.seq === icSeq), true, "IC event must be returned by campaigns.events");
assert.equal(oocEvents.events.some((e) => e.seq === icSeq2), true, "Second IC event must be returned by campaigns.events");

const testAsk = insertAsk({
  campaignId: oocCampaign.id,
  userId: dm.id,
  characterId: null,
  visibility: "private",
  scope: "rules",
  question: "How does sneak attack work?",
  answer: "Forwarded to DM...",
  citations: [],
  status: "pending",
});

const askRead = await executeMcpNarratorControl("narrator.read", { campaignId: oocCampaign.id, afterSeq: 0, limit: 10 });
assert.ok(askRead.result.asks.some((a) => a.id === testAsk.id), "narrator.read must include asks");

const answerCommandId = randomUUID();
const askSequence = latestSeq(oocCampaign.id);
const answerRequest = {
  campaignId: oocCampaign.id,
  askId: testAsk.id,
  expectedVersion: testAsk.version,
  commandId: answerCommandId,
  answer: "Sneak attack grants extra damage once per turn when you have advantage.",
};
const answeredAsk = await executeMcpNarratorControl("narrator.answer_ask", answerRequest);
assert.equal(answeredAsk.handled, true);
assert.equal(answeredAsk.result.ask.status, "answered");
assert.equal(answeredAsk.result.ask.answer.includes("Sneak attack grants extra damage"), true);

assert.equal(latestSeq(oocCampaign.id), askSequence);
assert.equal((await executeMcpNarratorControl("narrator.answer_ask", answerRequest)).result.ask.version, 1);
await assert.rejects(() => executeMcpNarratorControl("narrator.answer_ask", { ...answerRequest, commandId: randomUUID(), answer: "Conflicting answer" }), error => error.status === 409);
assert.equal((await executeMcpNarratorControl("narrator.read", { campaignId: oocCampaign.id })).result.asks.some(a => a.id === testAsk.id), false);

assert.equal(fetchCalls, 0, "no server provider/network call may be attempted");

globalThis.fetch = nativeFetch;
removeTempDir(dir);
console.log("PASS mcp narrator no-AI lifecycle, cursor gaps, privacy, concurrent writes, and roll replay");
