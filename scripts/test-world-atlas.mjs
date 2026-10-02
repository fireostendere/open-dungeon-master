// Real, isolated campaign state. No model, external server or game data.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
const directory = mkdtempSync(path.join(os.tmpdir(), "odm-atlas-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode, setQuestLog } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { upsertCurrentLocation, insertKnownLocation } = await import("../src/lib/db/locations.ts");
const { overworldView, setOverworldAnchor, setOverworldPins, setOverworldNotes, setOverworldLabels } = await import("../src/lib/db/overworld.ts");
const { atlasQuests, atlasRoute, questId, locationKind } = await import("../src/lib/overworld/atlas.ts");
const { spatialContext, spatialStore } = await import("../src/lib/spatial/service.ts");
const { notifySpatialChange, subscribeSpatialChanges, waitForPrivateUpdate } = await import("../src/lib/spatial/updates.mjs");
try {
  const dm = createUser(`atlas-dm-${randomUUID()}`, "hash");
  const first = createUser(`atlas-one-${randomUUID()}`, "hash");
  const second = createUser(`atlas-two-${randomUUID()}`, "hash");
  const campaign = createCampaign(dm.id, { title: "Atlas check", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  assert.ok(joinByInviteCode(first.id, campaign.inviteCode).campaign);
  assert.ok(joinByInviteCode(second.id, campaign.inviteCode).campaign);
  const sheet = name => createSheetSchema.parse({ name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 12, ac: 12, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  const hero = createSheet(campaign.id, first.id, 1, sheet("Torin"));
  const scout = createSheet(campaign.id, second.id, 1, sheet("Scout"));
  const start = upsertCurrentLocation({ campaignId: campaign.id, name: "Village", connections: ["Old keep"] });
  const target = insertKnownLocation({ campaignId: campaign.id, name: "Old keep", connections: ["Village"] });
  const text = "Find the relic: explore Old keep";
  setQuestLog(campaign.id, [text]);
  let view = overworldView(campaign.id, false, first.id);
  assert.equal(view.party.find(character => character.id === hero.id).locationId, start.id);
  assert.equal(atlasQuests(view.quests, view.locations, view.map.pins)[0].locationId, target.id);
  assert.deepEqual(atlasRoute(view.locations, start.id, target.id), [start.id, target.id]);
  assert.equal(atlasQuests(["Compare Village with Old keep"], view.locations, [])[0].anchor, null, "ambiguous targets must stay unplaced");
  assert.equal(atlasQuests(["Go to Old keepers"], view.locations, [])[0].anchor, null, "partial names are not a destination");
  assert.equal(atlasQuests(["Leave Old keepers and enter Old keep"], view.locations, [])[0].locationId, target.id);
  assert.deepEqual(atlasRoute(view.locations.map(location => ({ ...location, connections: location.id === start.id ? [] : [start.name] })), start.id, target.id), [], "a reverse passage is not a forward route");
  assert.equal(locationKind({ name: "Village", layoutDescription: "A village beside a forest and mountain" }), "settlement");
  assert.equal(locationKind({ name: "Перевал Серых Ветров" }), "mountain");
  const id = questId(text);
  setOverworldPins(campaign.id, [{ id: `${id}@${target.id}`, x: 2, y: 2, label: text }]);
  setOverworldAnchor(campaign.id, target.id, { x: 30, y: 25 });
  view = overworldView(campaign.id, false, first.id);
  assert.deepEqual(atlasQuests(["Another quest", text], view.locations, view.map.pins).find(quest => quest.id === id).anchor, { x: 30, y: 25 });
  assert.equal(atlasQuests([text], view.locations, [{ id: `${id}@unplaced`, x: 0, y: 0, label: text }])[0].anchor, null, "explicitly unplaced objectives do not reappear");
  upsertCurrentLocation({ campaignId: campaign.id, name: "Old keep" });
  view = overworldView(campaign.id, false, first.id);
  assert.equal(view.party.find(character => character.id === hero.id).locationId, target.id, "characters must follow the recorded move");
  assert.equal(view.locations.filter(location => location.isCurrent).length, 1);
  setQuestLog(campaign.id, []);
  assert.equal(overworldView(campaign.id, false, first.id).quests.length, 0, "completed quests leave the atlas");

  const store = spatialStore(), { actor } = spatialContext(campaign.id, dm.id);
  const command = (operation, args) => store.command(actor, randomUUID(), operation, args);
  const room = command("enable", { name: "Public road" }).roomId;
  const hidden = command("create_room", { name: "SECRET_ROOM_MARKER" }).roomId;
  command("move", { roomId: hidden, userIds: [second.id] });
  setOverworldNotes(campaign.id, "SECRET_NOTE_MARKER");
  setOverworldLabels(campaign.id, [{ id: "secret", x: 3, y: 3, text: "SECRET_LABEL_MARKER", size: "small" }]);
  setQuestLog(campaign.id, ["SECRET_JOURNAL_MARKER"]);
  const privateView = overworldView(campaign.id, true, first.id);
  assert.ok(privateView.locations.some(location => location.id === room));
  assert.equal(privateView.party.find(character => character.id === hero.id).locationId, room);
  assert.ok(!privateView.party.some(character => character.id === scout.id), "split-party positions are private");
  for (const secret of ["SECRET_ROOM_MARKER", "SECRET_NOTE_MARKER", "SECRET_LABEL_MARKER", "SECRET_JOURNAL_MARKER"]) {
    assert.ok(!JSON.stringify(privateView).includes(secret), `leaked ${secret}`);
  }
  assert.equal(overworldView(campaign.id, true, dm.id).party.find(character => character.id === scout.id).locationId, hidden);
  const exit = command("create_room", { name: "Known exit", connectTo: room }).roomId;
  const known = overworldView(campaign.id, false, first.id);
  assert.equal(known.locations.find(location => location.id === exit).visited, false, "a known exit is not yet visited");
  assert.deepEqual(atlasRoute(known.locations, room, exit), [room, exit]);

  const before = JSON.stringify(known);
  const polling = waitForPrivateUpdate({ waitMs: 1000, recheckMs: 20, subscribe: listener => subscribeSpatialChanges(campaign.id, listener),
    load: async () => {
      const body = JSON.stringify(overworldView(campaign.id, false, first.id));
      return body === before ? new Response(null, { status: 304 }) : new Response(body);
    } });
  command("move", { roomId: exit, userIds: [first.id] });
  notifySpatialChange(campaign.id);
  const response = await polling;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).party.find(character => character.id === hero.id).locationId, exit, "an open atlas must update without reopening");
  console.log("test-world-atlas: journal, bindings, routes, movement, private rooms and live updates passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}
