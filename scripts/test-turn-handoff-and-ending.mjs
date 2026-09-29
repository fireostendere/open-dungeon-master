// A submitted combat turn stays nobody's until the narrator explicitly hands
// it over; player-visible narrator text refuses protocol/operator talk; and
// end_campaign closes a campaign with victory or defeat from any state.
// Real modules on an isolated, encrypted SQLite file; no model, no network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-turn-handoff-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, getFloor, latestSeq, setCampaignStatus, setFloor } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, getEncounter, insertEnemy, listActiveEncounters, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { createDmTurn, createPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { insertAsk, pendingAsksForCampaign } = await import("../src/lib/db/asks.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { executeMcpNarratorControl, McpNarratorControlError } = await import("../src/lib/mcp-narrator-control.ts");
const { technicalLeaks } = await import("../src/lib/dm/narration-guard.ts");
const { narratorInputSchema } = await import("../mcp/narrator-schema.mjs");

const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("provider/network call is forbidden"); };
const run = async (action, params) => (await executeMcpNarratorControl(action, params)).result;
const refused = (status) => (error) => error instanceof McpNarratorControlError && error.status === status;

try {
  // ---- the guard itself: precise on protocol talk, silent on table prose ----
  for (const leak of [
    "Ход передан. expectedSeq 2188",
    "(ooc) Ход Левика остаётся на удержании, движок не применил Wrathful Smite.",
    "Вызываю request_roll для Аннабель.",
    "{\"status\":\"triggered\"}",
    "[debug] seq: 44",
    "commandId сохранён",
    "Цель 5d1df220-21e9-4c4d-8cc3-9ba816db2572 ранена.",
    "Сервер обработал ход, MCP подтвердил.",
    "Ход Дуплодёра принят.",
  ]) assert.ok(technicalLeaks(leak).length, `must refuse: ${leak}`);
  for (const prose of [
    "*(Атака: **23** против КД 11 — **ПОПАДАНИЕ!** 6 колющего урона. HP громилы: **26/32**)*",
    "**[Аннабель — Медицина: 21]** Кровь останавливается.",
    "Тайный ход остаётся незамеченным, а за ним — лестница вниз.",
    "The cleric invokes the gods to heal the wounded; the party can travel at dawn.",
    "БУМ! Дверь слетает с петель. Что вы делаете?",
    "Руны на клинке: [roll:5d1df220-21e9-4c4d-8cc3-9ba816db2572]",
  ]) assert.deepEqual(technicalLeaks(prose), [], `must allow: ${prose}`);

  // ---- a table in the middle of a fight ----
  const dm = createUser("handoff_dm", "hash");
  const one = createUser("handoff_one", "hash");
  const two = createUser("handoff_two", "hash");
  const campaign = createCampaign(dm.id, {
    title: "Handoff", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
  });
  setCampaignStatus(campaign.id, "active");
  const sheetInput = (name) => createSheetSchema.parse({
    name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 12, ac: 15,
    hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
  });
  const first = createSheet(campaign.id, one.id, 1, sheetInput("Первая"));
  const second = createSheet(campaign.id, two.id, 1, sheetInput("Второй"));
  const encounter = createEncounter(campaign.id, "Засада");
  const enemy = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "dummy", displayName: "Чучело", initiative: 10,
    stats: { maxHp: 500, ac: 10, cr: 0, xp: 0, dexMod: 0, speed: "0", attacks: [], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "" } });
  encounter.order = [
    { kind: "pc", characterId: first.id, userId: one.id, name: first.name, initiative: 18 },
    { kind: "enemy", enemyId: enemy.id, name: enemy.displayName, initiative: 10 },
    { kind: "pc", characterId: second.id, userId: two.id, name: second.name, initiative: 5 },
  ];
  encounter.orderReady = true;
  saveEncounter(encounter);
  const firstTurn = { mode: "initiative", encounterId: encounter.id, userIds: [one.id], currentName: first.name, round: 1 };
  // What the action route leaves behind when the first player submits.
  setFloor(campaign.id, { mode: "hold", next: firstTurn, combat: {
    encounterId: encounter.id, round: 1, turnIndex: 0, characterId: first.id, requiresEndTurn: true, mechanicsResolved: false,
    heldAt: new Date().toISOString(),
  } });

  const read = () => run("narrator.read", { campaignId: campaign.id, projection: "live", maxBytes: 131072 });
  assert.equal((await read()).campaign.turnLock.state, "resolving");

  let seq = latestSeq(campaign.id);
  await assert.rejects(() => run("narrator.narrate", { campaignId: campaign.id, expectedSeq: seq, content: "Удар!", passTurn: true }), refused(409),
    "no handoff before end_turn");
  assert.equal(latestSeq(campaign.id), seq, "a refused handoff writes nothing");

  const ended = await run("narrator.invoke", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID(), name: "end_turn", args: { characterId: first.id } });
  assert.equal(ended.result.result.turnHandoff, "awaiting_pass");
  assert.equal(getEncounter(encounter.id).turnIndex, 0, "end_turn records the resolution without moving initiative");
  assert.equal(getFloor(campaign.id).mode, "hold", "the table stays nobody's");
  assert.equal((await read()).campaign.turnLock.state, "awaiting_pass");

  seq = latestSeq(campaign.id);
  const firstPart = await run("narrator.narrate", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID(), content: "Клинок входит в солому по рукоять." });
  assert.equal(firstPart.result.turnHandoff.status, "awaiting_pass");
  assert.equal(getFloor(campaign.id).mode, "hold", "a narration without passTurn keeps players locked");
  assert.equal(getEncounter(encounter.id).turnIndex, 0);

  seq = latestSeq(campaign.id);
  await assert.rejects(() => run("narrator.narrate", { campaignId: campaign.id, expectedSeq: seq, content: "(ooc) Ход передан, expectedSeq обновлён." }), refused(400));
  await assert.rejects(() => run("narrator.invoke", { campaignId: campaign.id, expectedSeq: seq, name: "send_whisper", args: { characterIds: [second.id], message: "Жди, ход на удержании." } }), refused(400));
  assert.equal(latestSeq(campaign.id), seq, "refused player-facing text writes nothing");

  const last = await run("narrator.narrate", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID(), content: "Чучело покачнулось. Солома летит во все стороны.", passTurn: true });
  assert.equal(last.result.turnHandoff.status, "passed");
  assert.equal(getEncounter(encounter.id).turnIndex, 2, "the handoff moves initiative past the enemy to the next hero");
  const afterHandoff = getFloor(campaign.id);
  assert.equal(afterHandoff.mode, "initiative");
  assert.deepEqual(afterHandoff.userIds, [two.id]);
  const tail = listRecentMessages(campaign.id, 10).map((message) => [message.authorType, message.content]);
  const narrationAt = tail.findIndex(([, content]) => content.startsWith("Чучело покачнулось"));
  const announceAt = tail.findIndex(([author, content]) => author === "system" && content.startsWith(`It is now ${second.name}'s turn`));
  assert.ok(narrationAt >= 0 && announceAt > narrationAt, "the next actor is announced only after the DM's last message");
  assert.equal((await read()).campaign.turnLock, null);

  // release_floor is the prose-free way to hand a resolved turn on.
  setFloor(campaign.id, { mode: "hold", next: afterHandoff, combat: {
    encounterId: encounter.id, round: 1, turnIndex: 2, characterId: second.id, requiresEndTurn: true, mechanicsResolved: false,
  } });
  seq = latestSeq(campaign.id);
  await assert.rejects(() => run("narrator.release_floor", { campaignId: campaign.id, expectedSeq: seq }), refused(409));
  await run("narrator.invoke", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID(), name: "end_turn", args: { characterId: second.id } });
  seq = latestSeq(campaign.id);
  const released = await run("narrator.release_floor", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID() });
  assert.equal(released.result.turnHandoff.status, "passed");
  assert.equal(getEncounter(encounter.id).round, 2);
  assert.equal(getFloor(campaign.id).mode, "initiative");

  // ---- ending the campaign mid-fight, with dice and an Ask outstanding ----
  setFloor(campaign.id, { mode: "hold", next: getFloor(campaign.id), combat: {
    encounterId: encounter.id, round: 2, turnIndex: 0, characterId: first.id, requiresEndTurn: true, mechanicsResolved: false,
  } });
  const turn = createDmTurn(campaign.id, [], "human_dm");
  createPendingRoll({ campaignId: campaign.id, turnId: turn.id, toolCallId: null, userId: one.id, characterId: first.id, kind: "check",
    detail: "test", expression: "1d20", advantage: "none", dc: 10, reason: "Прыжок через пропасть" });
  insertAsk({ campaignId: campaign.id, userId: two.id, characterId: second.id, visibility: "private", scope: "story",
    question: "Что за руны на стене?", answer: "", citations: [], status: "pending" });
  assert.equal(pendingAsksForCampaign(campaign.id).pending, true);

  const endInput = { operation: "end_campaign", campaignId: campaign.id, expectedSeq: 1, outcome: "defeat", epilogue: "Тьма сомкнулась." };
  assert.equal(narratorInputSchema.safeParse(endInput).success, true, "the MCP schema exposes end_campaign");
  seq = latestSeq(campaign.id);
  await assert.rejects(() => run("narrator.end_campaign", { campaignId: campaign.id, expectedSeq: seq, outcome: "defeat", epilogue: "seq 5: кампания закрыта" }), refused(400));
  await assert.rejects(() => run("narrator.end_campaign", { campaignId: campaign.id, expectedSeq: seq, outcome: "draw" }), refused(400));
  const commandId = randomUUID();
  const closeParams = { campaignId: campaign.id, expectedSeq: seq, commandId, outcome: "defeat", epilogue: "Тьма сомкнулась над отрядом." };
  const closed = await run("narrator.end_campaign", closeParams);
  assert.equal(closed.result.status, "ended");
  assert.deepEqual(closed.result.closed, { encounters: 1, pendingRolls: 1, asks: 1, itemProposals: 0, floorReleased: true });
  const after = getCampaignById(campaign.id);
  assert.equal(after.status, "ended");
  assert.equal(after.outcome, "defeat");
  assert.equal(after.ending.epilogue, "Тьма сомкнулась над отрядом.");
  assert.equal(after.ending.endedBy, "narrator");
  assert.deepEqual(getFloor(campaign.id), { mode: "open" });
  assert.equal(listActiveEncounters(campaign.id).length, 0);
  assert.equal(listOpenPendingRolls(campaign.id).length, 0);
  assert.equal(pendingAsksForCampaign(campaign.id).pending, false);
  const connect = await run("narrator.connect", { campaignId: campaign.id });
  assert.equal(connect.state.campaign.outcome, "defeat", "the narrator sees how the campaign ended");

  const replay = await run("narrator.end_campaign", closeParams);
  assert.equal(replay.replayed, true, "a retried close recovers its receipt from an ended campaign");
  seq = latestSeq(campaign.id);
  const corrected = await run("narrator.end_campaign", { campaignId: campaign.id, expectedSeq: seq, commandId: randomUUID(), outcome: "victory" });
  assert.equal(corrected.result.alreadyEnded, true);
  assert.equal(getCampaignById(campaign.id).outcome, "victory", "the outcome can be corrected");
  assert.equal(getCampaignById(campaign.id).ending.epilogue, "Тьма сомкнулась над отрядом.", "a correction without an epilogue keeps it");
  seq = latestSeq(campaign.id);
  await assert.rejects(() => run("narrator.narrate", { campaignId: campaign.id, expectedSeq: seq, content: "Ещё одна сцена." }), refused(409),
    "story writes stop once the campaign has ended");
  console.log("test-turn-handoff-and-ending: ok");
} finally {
  globalThis.fetch = nativeFetch;
  removeTempDir(dir);
}
