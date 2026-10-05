// Real narrator commands, private delivery and table-wide OOC on isolated SQLite.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-player-feedback-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getFloor, getGlobalTurnState, joinByInviteCode, latestSeq, setCampaignStatus, setFloor } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, getEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { createDmTurn, createPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listWhispersForUser } = await import("../src/lib/db/dm-whispers.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listEventsSince, subscribe } = await import("../src/lib/events.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const { withEncounterRoom } = await import("../src/lib/spatial/publication-scope.mjs");

const run = async (action, params) => (await executeMcpNarratorControl(action, params)).result;
const subscriptions = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network calls are forbidden"); };
try {
  const dm = createUser("feedback_dm", "hash");
  const one = createUser("feedback_one", "hash");
  const two = createUser("feedback_two", "hash");
  const outsider = createUser("feedback_outsider", "hash");
  const campaign = createCampaign(dm.id, {
    title: "Feedback", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false },
  });
  for (const user of [one, two]) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
  const sheet = (user, name) => createSheet(campaign.id, user.id, 1, createSheetSchema.parse({
    name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 12, ac: 15,
    hitDice: { die: "d10", total: 1, spent: 0 }, equipment: [],
    proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] },
  }));
  const first = sheet(one, "Первая");
  const second = sheet(two, "Второй");
  const fight = createEncounter(campaign.id, "Засада");
  fight.orderReady = true;
  fight.order = [
    { kind: "pc", characterId: first.id, userId: one.id, name: first.name, initiative: 18 },
    { kind: "pc", characterId: second.id, userId: two.id, name: second.name, initiative: 10 },
  ];
  saveEncounter(fight);
  setFloor(campaign.id, { mode: "hold", next: { mode: "initiative", encounterId: fight.id, userIds: [one.id], currentName: first.name, round: 1 },
    combat: { encounterId: fight.id, round: 1, turnIndex: 0, characterId: first.id, requiresEndTurn: true, mechanicsResolved: false } });
  const turn = createDmTurn(campaign.id, [], "human_dm");
  createPendingRoll({ campaignId: campaign.id, turnId: turn.id, toolCallId: null, userId: one.id, characterId: first.id,
    kind: "check", detail: "test", expression: "1d20", advantage: "none", dc: 10, reason: "Прыжок" });
  const before = { floor: getFloor(campaign.id), fight: getEncounter(fight.id), round: getGlobalTurnState(campaign.id),
    pending: listOpenPendingRolls(campaign.id), sheet: getSheetById(first.id), messages: listRecentMessages(campaign.id, 20) };
  const frames = new Map([dm, one, two, outsider].map(user => [user.id, []]));
  for (const user of [dm, one, two, outsider]) subscriptions.push(subscribe(campaign.id, frame => frames.get(user.id).push(frame), user.id));

  const catalog = await run("narrator.catalog", { campaignId: campaign.id, action: "send_ooc", summaryOnly: false });
  assert.equal(catalog.groups[0]?.entries[0]?.name, "send_ooc", "the external DM discovers table feedback");
  const send = (name, args, overrides = {}) => run("narrator.invoke", {
    campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name, args, ...overrides,
  });
  const privateText = "Цель за каменным выступом: из этой позиции выстрелить нельзя. Твой ход пока не завершён.";
  await send("send_whisper", { characterIds: [first.id], message: privateText });
  assert.equal(listWhispersForUser(campaign.id, one.id).at(-1).content, privateText);
  assert.deepEqual(listWhispersForUser(campaign.id, two.id), []);
  assert.equal([...frames.values()].flat().join("").includes(privateText), false, "private prose never enters SSE");

  const args = { message: "(ooc) Игра на паузе. Подождите, пока я разберусь с заявкой; повторно отправлять её не нужно." };
  const command = { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name: "send_ooc", args };
  const sent = await run("narrator.invoke", command);
  assert.equal(sent.result.ok, true);
  const oocFrames = user => frames.get(user.id).filter(frame => frame.includes("event: ooc_message\n"));
  for (const user of [dm, one, two]) {
    assert.equal(oocFrames(user).length, 1);
    const message = JSON.parse(oocFrames(user)[0].split("data: ")[1]).message;
    assert.equal(message.authorType, "dm");
    assert.equal(message.userId, dm.id);
    assert.equal(message.kind, "ooc");
    assert.equal(message.content, args.message);
  }
  assert.deepEqual(oocFrames(outsider), [], "non-members never receive table talk");
  assert.equal((await run("narrator.invoke", command)).replayed, true);
  assert.equal(oocFrames(one).length, 1, "receipt recovery cannot duplicate OOC");
  await assert.rejects(() => send("send_ooc", { message: "Продолжаем." }, { expectedSeq: command.expectedSeq }), error => error.status === 409);
  for (const message of ["expectedSeq 15", "Вызываю request_roll.", "MCP вернул ошибку.", "(ooc)", " ", "x".repeat(2001)]) {
    const seq = latestSeq(campaign.id);
    await assert.rejects(() => send("send_ooc", { message }), error => error.status === 400);
    assert.equal(latestSeq(campaign.id), seq, "invalid feedback writes nothing");
  }
  await assert.rejects(() => send("send_whisper", { characterIds: [first.id], message: "request_roll отклонён" }), error => error.status === 400);

  assert.deepEqual(getFloor(campaign.id), before.floor);
  assert.deepEqual(getEncounter(fight.id), before.fight);
  assert.deepEqual(getGlobalTurnState(campaign.id), before.round);
  assert.deepEqual(listOpenPendingRolls(campaign.id), before.pending);
  assert.deepEqual(getSheetById(first.id), before.sheet);
  assert.deepEqual(listRecentMessages(campaign.id, 20), before.messages, "feedback does not become a story scene");
  const story = await run("narrator.read", { campaignId: campaign.id, projection: "live", maxBytes: 131072 });
  assert.equal(JSON.stringify(story.events).includes(args.message), false);
  assert.equal(JSON.stringify(listEventsSince(campaign.id, 0)).includes(privateText), false);

  // No room or fight is needed for table communications, even with room mode enabled.
  const room = (await send("location_enable", { name: "Начало" })).result.roomId;
  const otherRoom = (await send("location_create_room", { name: "Сарай", connectTo: room })).result.roomId;
  await send("location_move", { roomId: otherRoom, characterIds: [second.id] });
  await withEncounterRoom(campaign.id, room, () => send("send_whisper", { characterIds: [first.id, second.id], message: "Подождите ответа Мастера." }));
  await send("send_ooc", { message: "Общее правило: закрытую стеной цель нельзя атаковать напрямую." });
  assert.equal(oocFrames(two).length, 2, "OOC reaches every room");
  assert.equal(listWhispersForUser(campaign.id, two.id).at(-1).content, "Подождите ответа Мастера.");

  // Deferred publication rolls back with a failed receipt commit.
  getDatabase().exec(`CREATE TRIGGER refuse_feedback_receipt BEFORE INSERT ON campaign_events WHEN NEW.type = 'narrator_command_completed'
    BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;`);
  const count = oocFrames(one).length;
  await assert.rejects(() => send("send_ooc", { message: "Не доставлять." }), /receipt failure/);
  assert.equal(oocFrames(one).length, count);
  console.log("test-narrator-player-feedback: ok");
} finally {
  for (const unsubscribe of subscriptions) unsubscribe();
  globalThis.fetch = nativeFetch;
  removeTempDir(dir);
}
