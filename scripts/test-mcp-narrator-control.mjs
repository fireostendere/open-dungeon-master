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
const { allocateSeq, createCampaign, getCampaignById, getFloor, getGlobalTurnState, joinByInviteCode, setCampaignStatus, setFloor, setMemberAutopilot, latestSeq, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { createCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn, createPendingRoll, resolvePendingRoll, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { insertAsk } = await import("../src/lib/db/asks.ts");
const { getCampaignMessage, insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { createEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getRoll, insertRoll, setRollSeq } = await import("../src/lib/db/rolls.ts");
const { applyNarratorStatePatch } = await import("../shared/narrator-state-delta.mjs");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { publishWithSeq } = await import("../src/lib/events.ts");
const { getDmStatus } = await import("../src/lib/dm/status.ts");
const { executeMcpNarratorControl, McpNarratorControlError, EXTERNAL_NARRATOR_ACTIONS } = await import("../src/lib/mcp-narrator-control.ts");
const { executeMcpControl } = await import("../src/lib/mcp-control.ts");
const { extendControlResult } = await import("../src/lib/mcp-external-control.ts");
const { resumeHumanTurn } = await import("../src/lib/dm/invoke.ts");
const { narratorInputSchema } = await import("../mcp/narrator-schema.mjs");

const capabilities = extendControlResult("server.capabilities", { actions: [] });
assert.deepEqual(capabilities.actions.slice(0, 10), [
  "narrator.connect", "narrator.read", "narrator.snapshot", "narrator.catalog", "narrator.invoke", "narrator.narrate", "narrator.status", "narrator.store_audio", "narrator.delete_message", "narrator.edit_message",
]);
assert.equal(extendControlResult("server.status", { mcpControlActions: 0 }).mcpControlActions, capabilities.actions.length);
assert.ok(capabilities.actions.includes("narrator.autopilot_action"), "external autopilot write must be advertised");
assert.ok(capabilities.actions.includes("narrator.store_audio"), "external narrator must be able to attach generated narration audio");
assert.ok(capabilities.actions.includes("narrator.delete_message"), "external narrator must be able to delete transcript messages");
assert.ok(capabilities.actions.includes("narrator.edit_message"), "external narrator must be able to edit transcript messages");
assert.ok(capabilities.actions.includes("narrator.finish_global_round"), "external narrator must expose the spatial round finalizer");
assert.ok(capabilities.actions.includes("narrator.status"), "external narrator activity must be advertised");

const dm = createUser("external_dm", "hash");
const narratorHostA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const narratorHostB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

const statusInput = { operation: "status", campaignId: campaign.id, state: "thinking" };
assert.equal(narratorInputSchema.safeParse(statusInput).success, true, "MCP schema must expose narrator activity");
await executeMcpNarratorControl("narrator.status", { campaignId: campaign.id, state: "thinking" });
assert.equal(getDmStatus(campaign.id), "thinking");
await executeMcpNarratorControl("narrator.status", { campaignId: campaign.id, state: "idle" });
assert.equal(getDmStatus(campaign.id), "idle");

const connected = await executeMcpNarratorControl("narrator.connect", { campaignId: campaign.id });
assert.equal(connected.handled, true);
assert.ok(connected.result.state.currentSeq >= 0);
assert.equal(connected.result.state.campaign.dmOutline, "");
assert.equal(JSON.stringify(connected.result.state).includes("must-not-leak"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("generate_image"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("search_lore"), false);
assert.equal(EXTERNAL_NARRATOR_ACTIONS.has("set_npc"), true);
assert.equal(connected.result.state.campaign.gameSettings.mapsEnabled, false);
await assert.rejects(
  () => executeMcpNarratorControl("narrator.connect", { campaignId: campaign.id, stateDelta: true }),
  error => error instanceof McpNarratorControlError && error.status === 400,
  "state delta must have transport-owned host identity",
);
const deltaConnected = await executeMcpNarratorControl("narrator.connect", { campaignId: campaign.id, stateDelta: true, narratorHostId: narratorHostA });
assert.equal(deltaConnected.result.contractVersion, 8);
assert.equal(deltaConnected.result.features.compoundCombatTurn, true);
assert.equal(deltaConnected.result.features.atomicHealing, true);
assert.ok(deltaConnected.result.cursor.currentSeq >= 0);
assert.match(deltaConnected.result.cursor.timelineEpoch, /^[a-f0-9]{64}$/);
assert.equal(Object.hasOwn(deltaConnected.result, "state"), false, "delta connect must not echo a full state snapshot");
await assert.rejects(
  () => executeMcpNarratorControl("narrator.connect", { campaignId: campaign.id, stateDelta: true, narratorHostId: narratorHostB }),
  error => error instanceof McpNarratorControlError && error.status === 409,
  "a second live narrator process must not acquire the campaign lease",
);
for (const action of ["add_companion","dismiss_companion","mount_up","dismount","roll_treasure","damage_object","group_check","check_notice"]) {
  assert.equal(EXTERNAL_NARRATOR_ACTIONS.has(action), true, action + " must be available to the external narrator");
}

const compactSnapshot = await executeMcpNarratorControl("narrator.snapshot", {
  campaignId: campaign.id,
  maxBytes: 8192,
});
assert.equal(compactSnapshot.handled, true);
assert.equal(compactSnapshot.result.format, "odm.orchestration.v1");
assert.equal(compactSnapshot.result.campaign.id, campaign.id);
assert.ok(compactSnapshot.result.party.characters.some((entry) => entry.id === liveSheet.id));
assert.ok(Buffer.byteLength(JSON.stringify(compactSnapshot.result), "utf8") <= 8192);
assert.equal(JSON.stringify(compactSnapshot.result).includes("must-not-leak"), false);
assert.equal(Object.hasOwn(compactSnapshot.result.campaign, "dmOutline"), false);
assert.equal(Object.hasOwn(compactSnapshot.result.campaign, "storyArc"), false);

const unchangedSnapshot = await executeMcpNarratorControl("narrator.snapshot", {
  campaignId: campaign.id,
  knownRevision: compactSnapshot.result.revision,
});
assert.equal(unchangedSnapshot.result.unchanged, true);
assert.equal(unchangedSnapshot.result.revision, compactSnapshot.result.revision);
assert.equal(Object.hasOwn(unchangedSnapshot.result, "party"), false);

const combatOnlySnapshot = await executeMcpNarratorControl("narrator.snapshot", {
  campaignId: campaign.id,
  sections: ["combat"],
});
assert.equal(Object.hasOwn(combatOnlySnapshot.result, "party"), false);
assert.ok(Array.isArray(combatOnlySnapshot.result.combat));

const first = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 1 });
assert.equal(first.result.hasMore, false);
const beforeNarrate = first.result.currentSeq;
const narrated = await executeMcpNarratorControl("narrator.narrate", {
  campaignId: campaign.id, expectedSeq: beforeNarrate, content: "The lantern gutters in the wind.",
});
assert.equal(narrated.result.currentSeq, latestSeq(campaign.id));
assert.ok(narrated.result.currentSeq > beforeNarrate);
const audioMessageId = getDatabase().prepare("SELECT id FROM campaign_messages WHERE campaign_id=? AND author_type='dm' ORDER BY seq DESC LIMIT 1").get(campaign.id).id;
const wav = Buffer.alloc(44);
wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(36, 4); wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii"); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36, "ascii");
const audioInput = { operation: "store_audio", campaignId: campaign.id, messageId: audioMessageId, mimeType: "audio/wav", audioBase64: wav.toString("base64") };
assert.equal(narratorInputSchema.safeParse(audioInput).success, true, "MCP schema must expose the audio upload operation");
const audio = await executeMcpNarratorControl("narrator.store_audio", {
  campaignId: campaign.id, messageId: audioMessageId, mimeType: "audio/wav", audioBase64: wav.toString("base64"),
});
assert.equal(audio.result.audioUrl, `/generated-audio/${campaign.id}/${audioMessageId}.wav`);
assert.equal(getCampaignMessage(audioMessageId).narrationAudioUrl, audio.result.audioUrl);

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

const legacyMediaSettings = createCampaign(dm.id, {
  title: "Legacy media flags", description: "", theme: "", maxPlayers: 1, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: true, mapsEnabled: true },
});
setCampaignStatus(legacyMediaSettings.id, "active");
const legacyMediaConnect = await executeMcpNarratorControl("narrator.connect", {
  campaignId: legacyMediaSettings.id,
});
assert.equal(legacyMediaConnect.handled, true,
  "retired hosted TTS/map flags must not block the external narrator");

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

const editRequest = {
  campaignId: oocCampaign.id,
  expectedSeq: latestSeq(oocCampaign.id),
  commandId: randomUUID(),
  timelineEpoch: oocRead.result.timelineEpoch,
  messageId: icMsg2.id,
  content: '"I hear you now."',
};
const edited = await executeMcpNarratorControl("narrator.edit_message", editRequest);
assert.equal(edited.result.result.message.content, '"I hear you now."');
assert.equal(getCampaignMessage(icMsg2.id).content, '"I hear you now."');
assert.equal((await executeMcpNarratorControl("narrator.edit_message", editRequest)).result.replayed, true);

const deleteCommandId = randomUUID();
const deleteRequest = {
  campaignId: oocCampaign.id,
  expectedSeq: latestSeq(oocCampaign.id),
  commandId: deleteCommandId,
  timelineEpoch: oocRead.result.timelineEpoch,
  messageId: icMsg.id,
};
const deletedPlayerMessage = await executeMcpNarratorControl("narrator.delete_message", deleteRequest);
assert.equal(deletedPlayerMessage.handled, true);
assert.equal(deletedPlayerMessage.result.result.deleted.id, icMsg.id);
assert.equal(deletedPlayerMessage.result.result.deleted.authorType, "player");
assert.equal(getCampaignMessage(icMsg.id), null, "player transcript row must be removed");
const replayedDelete = await executeMcpNarratorControl("narrator.delete_message", deleteRequest);
assert.equal(replayedDelete.result.replayed, true, "identical delete retry must recover its receipt");
const afterDeleteRead = await executeMcpNarratorControl("narrator.read", {
  campaignId: oocCampaign.id,
  afterSeq: oocRead.result.currentSeq,
  limit: 50,
});
assert.equal(afterDeleteRead.result.events.some((event) => event.type === "message_deleted"), true);
assert.equal(afterDeleteRead.result.events.find((event) => event.type === "message_updated")?.payload?.message?.id, icMsg2.id);
assert.equal(afterDeleteRead.result.events.find((event) => event.type === "message_deleted")?.payload?.messageId, icMsg.id);
assert.equal(afterDeleteRead.result.recentMessages.some((message) => message.id === icMsg.id), false);

const combatCampaign = createCampaign(dm.id, {
  title: "Combat deletion", description: "", theme: "", maxPlayers: 1, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
setCampaignStatus(combatCampaign.id, "active");
const combatSheet = instantiateIntoCampaign(libraryCharacter.id, combatCampaign.id, dm.id, 1);
assert.ok(!("error" in combatSheet));
const combatEncounter = createEncounter(combatCampaign.id, "Test fight");
assert.ok(combatEncounter);
combatEncounter.order = [{ kind: "pc", characterId: combatSheet.id, userId: dm.id, name: combatSheet.name, initiative: 10 }];
combatEncounter.orderReady = true;
saveEncounter(combatEncounter);
const combatFloor = { mode: "initiative", encounterId: combatEncounter.id, userIds: [dm.id], currentName: combatSheet.name, round: combatEncounter.round };
const unrelatedMessage = insertCampaignMessage({ campaignId: combatCampaign.id, seq: allocateSeq(combatCampaign.id),
  authorType: "player", userId: dm.id, characterId: combatSheet.id, content: "Earlier message" });
const submittedMessage = insertCampaignMessage({ campaignId: combatCampaign.id, seq: allocateSeq(combatCampaign.id),
  authorType: "player", userId: dm.id, characterId: combatSheet.id, content: "Accidental action" });
setFloor(combatCampaign.id, { mode: "hold", next: combatFloor, combat: {
  encounterId: combatEncounter.id, round: combatEncounter.round, turnIndex: combatEncounter.turnIndex,
  characterId: combatSheet.id, submissionMessageId: submittedMessage.id, requiresEndTurn: true, mechanicsResolved: false,
} });
const combatRead = await executeMcpNarratorControl("narrator.read", { campaignId: combatCampaign.id, afterSeq: 0 });
const unrelatedDelete = await executeMcpNarratorControl("narrator.delete_message", {
  campaignId: combatCampaign.id, expectedSeq: latestSeq(combatCampaign.id), commandId: randomUUID(),
  timelineEpoch: combatRead.result.timelineEpoch, messageId: unrelatedMessage.id,
});
assert.equal(unrelatedDelete.result.result.inputReopened, false);
assert.equal(getFloor(combatCampaign.id).mode, "hold", "deleting an older message must not reopen the current turn");
const submissionDelete = await executeMcpNarratorControl("narrator.delete_message", {
  campaignId: combatCampaign.id, expectedSeq: latestSeq(combatCampaign.id), commandId: randomUUID(),
  timelineEpoch: combatRead.result.timelineEpoch, messageId: submittedMessage.id,
});
assert.equal(submissionDelete.result.result.inputReopened, true);
assert.deepEqual(getFloor(combatCampaign.id), combatFloor, "only the same actor's current turn reopens");
assert.equal(getCampaignMessage(submittedMessage.id), null);

const held = await executeMcpNarratorControl("narrator.set_floor", {
  campaignId: oocCampaign.id, expectedSeq: latestSeq(oocCampaign.id),
  commandId: randomUUID(), timelineEpoch: oocRead.result.timelineEpoch, mode: "hold",
});
assert.equal(held.result.result.floor.mode, "hold");
const opened = await executeMcpNarratorControl("narrator.set_floor", {
  campaignId: oocCampaign.id, expectedSeq: latestSeq(oocCampaign.id),
  commandId: randomUUID(), timelineEpoch: oocRead.result.timelineEpoch, mode: "open",
});
assert.equal(opened.result.result.floor.mode, "open");
const requested = await executeMcpNarratorControl("narrator.request_response", {
  campaignId: oocCampaign.id, expectedSeq: latestSeq(oocCampaign.id),
  commandId: randomUUID(), timelineEpoch: oocRead.result.timelineEpoch,
});
assert.equal(requested.result.result.requested, true);
assert.equal((await executeMcpNarratorControl("narrator.read", { campaignId: oocCampaign.id, afterSeq: opened.result.currentSeq }))
  .result.events.some(event => event.type === "lead_response_requested"), true);


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
const storyOnlyRead = await executeMcpNarratorControl("narrator.read", {
  campaignId: oocCampaign.id, afterSeq: 0, limit: 10, includeAsks: false,
});
assert.deepEqual(storyOnlyRead.result.asks, [], "story-only reads must not repeat pending Ask payloads");
assert.equal(storyOnlyRead.result.askQueue.hasMore, false);
assert.equal(storyOnlyRead.result.askQueue.nextCursor, 0);

const answerCommandId = randomUUID();
const askSequence = latestSeq(oocCampaign.id);
const answerRequest = {
  campaignId: oocCampaign.id,
  askId: testAsk.id,
  expectedVersion: testAsk.version,
  commandId: answerCommandId,
  timelineEpoch: askRead.result.timelineEpoch,
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

// Optimizations verification: catalog summary & filter
const fullCatalog = await executeMcpNarratorControl("narrator.catalog", { campaignId: oocCampaign.id });
const summaryCatalog = await executeMcpNarratorControl("narrator.catalog", { campaignId: oocCampaign.id, summaryOnly: true });
assert.ok(fullCatalog.result.groups.length > 0);
assert.ok(summaryCatalog.result.groups.length > 0);
assert.ok(JSON.stringify(summaryCatalog.result).length < JSON.stringify(fullCatalog.result).length / 5, "summary catalog must be at least 5x smaller than full");
const combatOnly = await executeMcpNarratorControl("narrator.catalog", { campaignId: oocCampaign.id, category: "combat" });
assert.ok(combatOnly.result.groups.every(g => g.category === "combat"));
const startEncounter = combatOnly.result.groups.flatMap(g => g.entries).find(entry => entry.name === "start_encounter");
const roomFields = startEncounter.fields.filter(field => field.name === "roomId");
assert.equal(roomFields.length, 1, "narrator catalog exposes one roomId field");
assert.match(roomFields[0].help, /Required after location_enable/);
const attackOnly = await executeMcpNarratorControl("narrator.catalog", { campaignId: oocCampaign.id, action: "pc_attack" });
assert.equal(attackOnly.result.groups[0].entries.length, 1);
assert.equal(attackOnly.result.groups[0].entries[0].name, "pc_attack");

// Optimizations verification: compound narration with floor release
const preFloorSeq = latestSeq(oocCampaign.id);
const compoundNarrate = await executeMcpNarratorControl("narrator.narrate", {
  campaignId: oocCampaign.id,
  expectedSeq: preFloorSeq,
  content: "The mist rolls in as you press forward.",
  releaseFloor: true,
});
assert.equal(compoundNarrate.handled, true);
assert.equal(compoundNarrate.result.result.floorReleased, true);
assert.ok(compoundNarrate.result.result.floor);
assert.ok(compoundNarrate.result.currentSeq > preFloorSeq);

// Delta section negotiation is content-addressed: an old cursor alone is never
// permission to omit state, including mutations with no matching event type.
const deltaBaseline = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: 0, delta: true,
});
assert.match(deltaBaseline.result.sectionVersions.sheets, /^[a-f0-9]{64}$/);
const legacyDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: deltaBaseline.result.currentSeq, delta: true,
  knownSeq: deltaBaseline.result.currentSeq,
});
assert.equal(legacyDelta.result.sheets.length, 1, "legacy knownSeq must retain full sections");

const negotiatedDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: deltaBaseline.result.currentSeq, delta: true,
  knownSeq: deltaBaseline.result.currentSeq, knownSections: deltaBaseline.result.sectionVersions,
});
assert.deepEqual(negotiatedDelta.result.sheets, []);
assert.deepEqual(negotiatedDelta.result.facts, []);
assert.ok(negotiatedDelta.result.omittedSections.includes("sheets"));
assert.ok(negotiatedDelta.result.omittedSections.includes("facts"));
assert.deepEqual(
  Object.fromEntries(["sheets", "facts", "notes", "npcs"].map(section => [section,
      negotiatedDelta.result.omittedSections.includes(section) ? deltaBaseline.result[section] : negotiatedDelta.result[section],
    ])),
  Object.fromEntries(["sheets", "facts", "notes", "npcs"].map(section => [section, deltaBaseline.result[section]])),
  "an omitted section reconstructs from the negotiated baseline",
);
const baselineSectionBytes = Buffer.byteLength(JSON.stringify({ sheets: deltaBaseline.result.sheets, facts: deltaBaseline.result.facts, notes: deltaBaseline.result.notes, npcs: deltaBaseline.result.npcs }));
const omittedSectionBytes = Buffer.byteLength(JSON.stringify({ sheets: negotiatedDelta.result.sheets, facts: negotiatedDelta.result.facts, notes: negotiatedDelta.result.notes, npcs: negotiatedDelta.result.npcs }));
assert.ok(omittedSectionBytes < baselineSectionBytes, "negotiated fixture must omit cached section bytes");
const fullResponseBytes = Buffer.byteLength(JSON.stringify(legacyDelta.result));
const deltaResponseBytes = Buffer.byteLength(JSON.stringify(negotiatedDelta.result));
assert.ok(deltaResponseBytes < fullResponseBytes, "whole response, including version metadata, must shrink");
assert.ok(negotiatedDelta.result.omittedSections.includes("recentMessages"));
const historicalMessage = deltaBaseline.result.recentMessages[0];
assert.ok(historicalMessage);
getDatabase().prepare("UPDATE campaign_messages SET content = ? WHERE id = ?").run("Corrected historical narration.", historicalMessage.id);
const editedHistory = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: deltaBaseline.result.currentSeq, delta: true, knownSections: deltaBaseline.result.sectionVersions,
});
assert.equal(editedHistory.result.omittedSections.includes("recentMessages"), false);
assert.ok(editedHistory.result.recentMessages.some(message => message.id === historicalMessage.id && message.content === "Corrected historical narration."));

// This intentionally bypasses event publication: old event-name heuristics
// omitted the changed resources payload because the sequence did not advance.
const stateDeltaBaseline = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: deltaBaseline.result.currentSeq, delta: true, stateDelta: true, narratorHostId: narratorHostA,
});
assert.equal(stateDeltaBaseline.result.stateDelta.full, true);
assert.equal(stateDeltaBaseline.result.sectionVersions, undefined);
assert.ok(Array.isArray(stateDeltaBaseline.result.sheets));
const stateDeltaBaselineBytes = Buffer.byteLength(JSON.stringify(stateDeltaBaseline.result));

getDatabase().prepare("UPDATE character_sheets SET resources_json = ? WHERE id = ?")
  .run(JSON.stringify({ test_resource: { current: 0, max: 1 } }), liveSheet.id);
const changedDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: deltaBaseline.result.currentSeq, delta: true,
  knownSeq: deltaBaseline.result.currentSeq, knownSections: deltaBaseline.result.sectionVersions,
});
assert.equal(changedDelta.result.sheets[0].resources.test_resource.current, 0);
assert.equal(changedDelta.result.omittedSections.includes("sheets"), false);

const entityDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, afterSeq: stateDeltaBaseline.result.currentSeq, delta: true, stateDelta: true, narratorHostId: narratorHostA,
  knownStateRevision: stateDeltaBaseline.result.stateDelta.revision,
});
assert.equal(entityDelta.result.stateDelta.full, false);
assert.equal(Object.hasOwn(entityDelta.result, "sheets"), false, "entity delta must not resend the whole sheets array");
assert.deepEqual(entityDelta.result.stateDelta.patch.entities.sheets.upsert, []);
{
  const liveSheetBefore = stateDeltaBaseline.result.sheets.find((sheet) => sheet.id === liveSheet.id);
  const sheetPatch = entityDelta.result.stateDelta.patch.entities.sheets.update[liveSheet.id];
  const rebuilt = applyNarratorStatePatch({ sheets: [liveSheetBefore] }, { format: "odm.state.patch.v1", entities: { sheets: entityDelta.result.stateDelta.patch.entities.sheets } }).sheets[0];
  assert.equal(rebuilt.resources.test_resource.current, 0, "the changed field arrives as a field patch");
  assert.ok(JSON.stringify(sheetPatch).length < JSON.stringify(liveSheetBefore).length / 2, "a one-field change does not resend the sheet");
}
assert.ok(Buffer.byteLength(JSON.stringify(entityDelta.result)) < stateDeltaBaselineBytes, "entity delta must shrink the wire payload");
await assert.rejects(
  () => executeMcpNarratorControl("narrator.read", {
    campaignId: campaign.id, stateDelta: false, knownStateRevision: entityDelta.result.stateDelta.revision,
  }),
  error => error instanceof McpNarratorControlError && error.status === 400,
);

const tombstoneBase = entityDelta.result.stateDelta.revision;
const changedBaseline = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, delta: true });
getDatabase().prepare("DELETE FROM character_sheets WHERE id = ?").run(liveSheet.id);
const deletedDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, delta: true, knownSections: changedBaseline.result.sectionVersions,
});
assert.deepEqual(deletedDelta.result.sheets, [], "a changed section returns an empty array to clear the cache");
assert.equal(deletedDelta.result.omittedSections.includes("sheets"), false);
const deletedEntityDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: campaign.id, delta: true, stateDelta: true, narratorHostId: narratorHostA, knownStateRevision: tombstoneBase,
});
assert.equal(deletedEntityDelta.result.stateDelta.full, false);
assert.ok(deletedEntityDelta.result.stateDelta.patch.entities.sheets.remove.includes(liveSheet.id), "deletion must travel as a tombstone");
assert.equal(Object.hasOwn(deletedEntityDelta.result, "sheets"), false);

const scopedDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: oocCampaign.id, delta: true, knownSections: deltaBaseline.result.sectionVersions,
});
assert.equal(scopedDelta.result.omittedSections.includes("facts"), false, "campaign-scoped hashes cannot cross campaigns");
publishWithSeq(oocCampaign.id, allocateSeq(oocCampaign.id), "campaign_rewound", {});
const epochDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: oocCampaign.id, delta: true, knownSections: scopedDelta.result.sectionVersions,
});
assert.equal(epochDelta.result.omittedSections.includes("facts"), false, "epoch-scoped hashes cannot cross rewinds");

const deltaTurn = createDmTurn(oocCampaign.id, [], "human_dm");
const pendingDelta = createPendingRoll({ campaignId: oocCampaign.id, turnId: deltaTurn.id, toolCallId: null, userId: dm.id, characterId: null, kind: "check", detail: "delta", expression: "1d20", advantage: "none", dc: null, reason: "delta" });
const deltaRoll = insertRoll({ campaignId: oocCampaign.id, requestedBy: "player", kind: "custom", result: { expression: "1d20", total: 11, terms: [] } });
const pagedDelta = await executeMcpNarratorControl("narrator.read", {
  campaignId: oocCampaign.id, afterSeq: 0, limit: 1, delta: true, knownSections: epochDelta.result.sectionVersions,
});
assert.equal(pagedDelta.result.hasMore, true, "delta retains event pagination");
assert.ok(pagedDelta.result.pendingRolls.some(roll => roll.id === pendingDelta.id), "delta retains pending rolls");
assert.ok(pagedDelta.result.recentRolls.some(roll => roll.id === deltaRoll.id), "delta retains recent rolls");
await assert.rejects(
  () => executeMcpNarratorControl("narrator.read", { campaignId: oocCampaign.id, delta: true, knownSections: { sheets: "bad" } }),
  McpNarratorControlError,
);
assert.equal(pagedDelta.result.deltaState?.enabled, true);

const seatOwner = createUser("seat_owner", "hash");
const technicalDm = createUser("technical_dm", "hash");
const seatCampaign = createCampaign(seatOwner.id, {
  title: "MCP seats", description: "", theme: "", maxPlayers: 4, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
assert.equal("error" in joinByInviteCode(technicalDm.id, seatCampaign.inviteCode), false);
const assigned = await executeMcpControl("campaigns.assign_dm_seat", { campaignId: seatCampaign.id, seat: "dm", userId: technicalDm.id });
assert.equal(assigned.userId, technicalDm.id);
assert.equal(getCampaignById(seatCampaign.id).dmUserId, technicalDm.id);
assert.equal(JSON.parse(getDatabase().prepare("SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND type = 'campaign_updated' ORDER BY seq DESC LIMIT 1").get(seatCampaign.id).payload_json).dmUserId, technicalDm.id);
await assert.rejects(() => executeMcpControl("campaigns.assign_dm_seat", { campaignId: seatCampaign.id, seat: "dm", userId: null }),
  error => error.status === 400);
const ownerCharacter = createCharacter(seatOwner.id, 1, createSheetSchema.parse({
  name: "Lead Hero", race: "human", class: "fighter", background: "soldier",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, maxHp: 12, ac: 16, speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  equipment: [], gold: 0, copper: 0,
}));
const ownerSheet = instantiateIntoCampaign(ownerCharacter.id, seatCampaign.id, seatOwner.id, 1);
assert.ok(!("error" in ownerSheet));
setCampaignStatus(seatCampaign.id, "active");
const spotlight = await executeMcpNarratorControl("narrator.set_floor", {
  campaignId: seatCampaign.id, expectedSeq: latestSeq(seatCampaign.id), mode: "spotlight",
  characterIds: [ownerSheet.id], commandId: randomUUID(),
});
assert.deepEqual(spotlight.result.result.floor.userIds, [seatOwner.id]);
setMemberAutopilot(seatCampaign.id, seatOwner.id, true);
const autoSpotlight = await executeMcpNarratorControl("narrator.autopilot_action", {
  campaignId: seatCampaign.id, expectedSeq: latestSeq(seatCampaign.id), commandId: randomUUID(),
  characterId: ownerSheet.id, kind: "do", content: "I inspect the doorway.",
});
assert.equal(autoSpotlight.result.result.spotlightComplete, true);
assert.equal(getFloor(seatCampaign.id).mode, "hold");
assert.ok(getDatabase().prepare("SELECT 1 FROM campaign_events WHERE campaign_id = ? AND type = 'spotlight_ready'").get(seatCampaign.id));
const autoNarration = await executeMcpNarratorControl("narrator.narrate", {
  campaignId: seatCampaign.id, expectedSeq: latestSeq(seatCampaign.id), commandId: randomUUID(),
  content: "The doorway remains quiet.", releaseFloor: true,
});
assert.equal(autoNarration.result.result.floorReleased, true);
assert.equal(getFloor(seatCampaign.id).mode, "open");

await executeMcpControl("campaigns.update_game_settings", { campaignId: seatCampaign.id,
  patch: { globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 1, quorumDelayMinutes: 0 } } });
assert.equal(JSON.parse(getDatabase().prepare("SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND type = 'campaign_updated' ORDER BY seq DESC LIMIT 1").get(seatCampaign.id).payload_json).gameSettings.globalTurn.enabled, true);
assert.equal(getGlobalTurnState(seatCampaign.id).phase, "waiting", "MCP mode switch must lock collection until opening narration");
assert.ok(getDatabase().prepare("SELECT 1 FROM campaign_events WHERE campaign_id = ? AND type = 'global_turn_narrator_trigger'").get(seatCampaign.id));
const globalSeq = latestSeq(seatCampaign.id);
await assert.rejects(() => executeMcpNarratorControl("narrator.set_floor", {
  campaignId: seatCampaign.id, expectedSeq: globalSeq, mode: "spotlight", characterIds: [ownerSheet.id], commandId: randomUUID(),
}), error => error instanceof McpNarratorControlError && error.status === 409);
assert.equal(latestSeq(seatCampaign.id), globalSeq, "manual floor control must not corrupt global-turn pacing");

// External narration must feed the story tab and retain its canonical plan.
const storyCampaign = createCampaign(dm.id, {
  title: "Story continuity", description: "", theme: "", maxPlayers: 4, startingLevel: 1,
  difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
});
const settingsBeforePatch = getCampaignById(storyCampaign.id).gameSettings;
await executeMcpControl("campaigns.update_game_settings", { campaignId: storyCampaign.id, patch: { midGameJoinOpen: true } });
assert.deepEqual(getCampaignById(storyCampaign.id).gameSettings, { ...settingsBeforePatch, midGameJoinOpen: true },
  "editing one setting must retain all existing game settings, including disabled media");
await executeMcpControl("campaigns.update_game_settings", { campaignId: storyCampaign.id, patch: {} });
assert.deepEqual(getCampaignById(storyCampaign.id).gameSettings, { ...settingsBeforePatch, midGameJoinOpen: true },
  "an empty settings patch must not restore creation defaults");
await executeMcpControl("campaigns.set_outline", { campaignId: storyCampaign.id, outline: "The mayor secretly serves the dragon." });
setCampaignStatus(storyCampaign.id, "active");
const storyArc = {
  premise: "Recover the missing bell.",
  cast: [{ name: "Mayor", role: "Patron", agenda: "Protect the dragon.", status: "gone" }],
  events: [{ kind: "discovery", name: "Dragon tracks", detail: "The party found dragon tracks.", trigger: "After arriving", status: "fired" }],
  subArcs: [{ name: "Lost child", goal: "Find the child.", status: "resolved", resolution: "The child returned home." }],
  saga: { title: "The missing bell", sketches: [{ act: 1, milestone: "Recover the bell.", status: "detailed" }], sagaIndex: 2,
    priorSagas: [{ title: "The old tower", resolution: "The party rescued the tower keeper." }] },
  beats: [
  { text: "Find the bell tower", detail: "The party identified the tower.", waypoints: [{ kind: "place", text: "Bell tower", done: false }] },
  { text: "Confront the bell thief" },
] };
const arcOnlyStory = await executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: latestSeq(storyCampaign.id), commandId: randomUUID(), name: "update_story",
  args: { arc: storyArc }, readAfter: { projection: "live", maxBytes: 131072 },
});
assert.equal(arcOnlyStory.result.state.chapters.length, 1, "arc-only authoring must initialize the story tab's chapter");
assert.equal(arcOnlyStory.result.state.chapters[0].summary, "");
const storyCommand = {
  campaignId: storyCampaign.id, expectedSeq: latestSeq(storyCampaign.id), commandId: randomUUID(),
  name: "update_story", args: { arc: storyArc, chapterTitle: "The silent village", chapterSummary: "The party learned the bell was stolen.",
    chapterHighlights: ["The villagers asked for help."], scene: "The village square.", quests: ["Recover the bell."] },
  readAfter: { projection: "live", maxBytes: 131072 },
};
const savedStory = await executeMcpNarratorControl("narrator.invoke", storyCommand);
assert.equal(savedStory.result.readRequired, false);
assert.equal(savedStory.result.state.campaign.dmOutline, "The mayor secretly serves the dragon.");
assert.equal(savedStory.result.state.campaign.storyArc.beats[0].status, "active");
assert.equal(savedStory.result.state.chapters[0].summary, storyCommand.args.chapterSummary);
assert.equal(getCampaignById(storyCampaign.id).questLog[0], "Recover the bell.");
const savedStorySeq = latestSeq(storyCampaign.id);
assert.equal((await executeMcpNarratorControl("narrator.invoke", storyCommand)).result.replayed, true);
assert.equal(latestSeq(storyCampaign.id), savedStorySeq, "a replay must not write another story update");
await assert.rejects(() => executeMcpNarratorControl("narrator.invoke", { ...storyCommand, commandId: randomUUID() }), error => error.status === 409);
for (const args of [
  { arc: { premise: "Invalid" } },
  { arc: { ...getCampaignById(storyCampaign.id).storyArc, beats: [
    { ...getCampaignById(storyCampaign.id).storyArc.beats[0], status: "done" },
    { ...getCampaignById(storyCampaign.id).storyArc.beats[1], status: "active" },
  ] } },
  { arc: { ...getCampaignById(storyCampaign.id).storyArc, beats: [
    { ...getCampaignById(storyCampaign.id).storyArc.beats[0], waypoints: [] },
    getCampaignById(storyCampaign.id).storyArc.beats[1],
  ] } },
  { chapterSummary: "request_roll returned currentSeq 100" },
  { dmOutline: "Erase the canonical plan" },
]) {
  await assert.rejects(() => executeMcpNarratorControl("narrator.invoke", {
    campaignId: storyCampaign.id, expectedSeq: savedStorySeq, commandId: randomUUID(), name: "update_story", args,
  }));
  assert.equal(latestSeq(storyCampaign.id), savedStorySeq, "invalid story edits must leave the cursor unchanged");
}
const closedStory = await executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: savedStorySeq, commandId: randomUUID(), name: "update_story",
  args: { closeChapter: true }, readAfter: { projection: "live", maxBytes: 131072 },
});
assert.equal(closedStory.result.state.chapters.length, 2);
assert.equal(closedStory.result.state.chapters[0].status, "closed");
assert.equal(closedStory.result.state.chapters[0].summary, storyCommand.args.chapterSummary);
assert.equal(closedStory.result.state.chapters[1].status, "open");
assert.equal(getCampaignById(storyCampaign.id).dmOutline, "The mayor secretly serves the dragon.");
await assert.rejects(() => executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: latestSeq(storyCampaign.id), commandId: randomUUID(),
  name: "complete_beat", args: {},
}), /open waypoints/);
await executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: latestSeq(storyCampaign.id), commandId: randomUUID(),
  name: "move_party", args: { name: "Bell tower" },
});
await executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: latestSeq(storyCampaign.id), commandId: randomUUID(),
  name: "complete_beat", args: {},
});
const progressedArc = getCampaignById(storyCampaign.id).storyArc;
assert.equal(progressedArc.beats[0].status, "done");
const progressedSeq = latestSeq(storyCampaign.id);
await assert.rejects(() => executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: progressedSeq, commandId: randomUUID(),
  name: "update_story", args: { arc: storyArc },
}), /Preserve existing beat/);
assert.equal(latestSeq(storyCampaign.id), progressedSeq);
await executeMcpNarratorControl("narrator.invoke", {
  campaignId: storyCampaign.id, expectedSeq: progressedSeq, commandId: randomUUID(), name: "update_story",
  args: { arc: { premise: progressedArc.premise, beats: progressedArc.beats } },
});
assert.equal(getCampaignById(storyCampaign.id).storyArc.cast[0].agenda, "Protect the dragon.", "omitted arc layers must retain canon");
assert.equal(getCampaignById(storyCampaign.id).storyArc.beats[0].status, "done");
const canon = getCampaignById(storyCampaign.id).storyArc;
for (const patch of [
  { cast: [], events: [], subArcs: [], saga: null },
  { cast: canon.cast.map(npc => ({ ...npc, status: "active" })), events: canon.events.map(event => ({ ...event, status: "pending" })),
    subArcs: canon.subArcs.map(thread => ({ ...thread, status: "pending", resolution: "" })), saga: { ...canon.saga, priorSagas: [] } },
]) {
  const beforeEditSeq = latestSeq(storyCampaign.id);
  const edited = await executeMcpNarratorControl("narrator.invoke", {
    campaignId: storyCampaign.id, expectedSeq: beforeEditSeq, commandId: randomUUID(), name: "update_story",
    args: { arc: { ...canon, ...patch, beats: canon.beats.map((beat, index) => index === 0 ? { ...beat, detail: "Invented replacement history." } : beat) } },
    readAfter: { projection: "live", maxBytes: 131072 },
  });
  const afterEditArc = getCampaignById(storyCampaign.id).storyArc;
  for (const key of ["cast", "events", "subArcs", "saga", "worldArcs", "actRecaps"]) assert.deepEqual(afterEditArc[key], canon[key]);
  assert.equal(afterEditArc.beats[0].detail, canon.beats[0].detail, "settled beat details must retain actual history");
  assert.equal(edited.result.state.chapters[1].summary, "", "arc-only refresh must leave the public recap unchanged");
  const updatedChapter = getDatabase().prepare("SELECT payload_json FROM campaign_events WHERE campaign_id = ? AND seq > ? AND type = 'chapter_updated' ORDER BY seq DESC LIMIT 1").get(storyCampaign.id, beforeEditSeq);
  assert.equal(JSON.parse(updatedChapter.payload_json).chapter.id, edited.result.state.chapters[1].id, "arc-only edits must emit the existing public refresh signal");
}

assert.equal(fetchCalls, 0, "no server provider/network call may be attempted");

globalThis.fetch = nativeFetch;
removeTempDir(dir);
console.log(`PASS mcp narrator no-AI lifecycle, cursor gaps, privacy, concurrent writes, and roll replay (delta fixture sections ${baselineSectionBytes}B -> ${omittedSectionBytes}B; whole response ${fullResponseBytes}B -> ${deltaResponseBytes}B)`);
