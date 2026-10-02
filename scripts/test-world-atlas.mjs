// Real, isolated campaign state. No model, external server or game data.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
const { createSheet, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { upsertCurrentLocation, insertKnownLocation } = await import("../src/lib/db/locations.ts");
const { getOverworld, overworldView, regenerateOverworld, setOverworldAnchor, setOverworldPins, setOverworldNotes, setOverworldLabels } = await import("../src/lib/db/overworld.ts");
const { atlasQuests, atlasRoute, questId, locationKind, constrainAtlasView, layoutAtlasMarkers } = await import("../src/lib/overworld/atlas.ts");
const { atlasTerrain, environmentForLocation, landmarkForLocation, landmarkSprite, LANDMARK_ASSETS, LANDMARK_NAMES, TERRAIN_NAMES, TERRAIN_ASSETS, materialAt } = await import("../src/lib/overworld/cartography.ts");
const { placeAnchor } = await import("../src/lib/overworld/logic.ts");
const { spatialContext, spatialStore } = await import("../src/lib/spatial/service.ts");
const { notifySpatialChange, subscribeSpatialChanges, waitForPrivateUpdate } = await import("../src/lib/spatial/updates.mjs");
try {
  assert.equal(Object.keys(TERRAIN_ASSETS).length, 19);
  for (const path of Object.values(TERRAIN_ASSETS)) {
    assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), `missing ${path}`);
    assert.ok(existsSync(new URL(`../public${path.replace(".webp", ".prompt.txt")}`, import.meta.url)), `missing generation prompt ${path}`);
  }
  assert.equal(Object.keys(LANDMARK_ASSETS).length, 24);
  assert.equal(new Set(Object.keys(LANDMARK_ASSETS).map(id => JSON.stringify(landmarkSprite(id)))).size, 24, "landmarks must be distinct artwork");
  for (const [id, names] of Object.entries(LANDMARK_NAMES)) for (const [language, name] of names.entries()) {
    assert.equal(landmarkForLocation({ name: "Каменная пристань", layoutDescription: `${language ? "Place type" : "Тип места"}: ${name}.` }), id, `explicit type ${name}`);
  }
  for (const [id, names] of Object.entries(TERRAIN_NAMES)) for (const [language, name] of names.entries()) {
    assert.equal(environmentForLocation({ name: "Лес старый", layoutDescription: `${language ? "Environment" : "Окружение"}: ${name}.` }).material, id, `explicit environment ${name}`);
  }
  for (const [name, expected] of [["Каменная пристань", "port"], ["Деревня у леса", "village"], ["Башня мага", "wizardTower"],
    ["Руины Вороньей крепости", "ruinedCastle"], ["Город эльфов", "elvenCity"], ["Эльфийский город", "elvenCity"], ["Пещера", "cave"], ["Вулкан", "volcano"], ["???", null]]) {
    assert.equal(landmarkForLocation({ name }), expected, name);
  }
  assert.equal(landmarkForLocation({ name: "Белый камень", layoutDescription: "Деревня у леса" }), "village");
  assert.equal(landmarkForLocation({ name: "Белый камень", layoutDescription: "Здесь путники говорят о далёком замке" }), null);
  const ground = { seed: 555, width: 40, height: 32, terrain: "m".repeat(40 * 32) };
  const sites = [{ id: "port", name: "Каменная пристань", anchor: { x: 6, y: 6 } },
    { id: "volcano", name: "Вулкан Пепельный", anchor: { x: 27, y: 18 } },
    { id: "forest", name: "Осенний лес", anchor: { x: 18, y: 6 } },
    { id: "lake", name: "Ледяное озеро", anchor: { x: 7, y: 24 } }];
  const ecological = atlasTerrain(ground, sites);
  const tile = (map, x, y) => map.terrain[y * ground.width + x];
  const material = (map, x, y) => materialAt(map.materialGrid, y * ground.width + x);
  assert.equal(tile(ecological, 6, 6), "p", "the harbour must have dry ground");
  assert.ok([-1, 0, 1].some(dx => [-1, 0, 1].some(dy => tile(ecological, 6 + dx, 6 + dy) === "w")), "a harbour must touch water even on legacy all-mountain terrain");
  assert.equal(tile(ecological, 27, 18), "m");
  assert.equal(material(ecological, 29, 18), "lava");
  assert.equal(tile(ecological, 18, 6), "f");
  assert.equal(material(ecological, 18, 6), "autumn");
  assert.equal(material(ecological, 7, 24), "ice");
  assert.ok(!ecological.conflicts.length);
  assert.deepEqual(atlasTerrain(ground, [...sites].reverse()), ecological, "location order cannot move terrain");
  const flooded = atlasTerrain({ ...ground, terrain: "w".repeat(ground.terrain.length) }, [sites[1]]);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    assert.notEqual(tile(flooded, 27 + dx, 18 + dy), "w", "volcanic ground cannot show blue water");
    assert.ok(["volcanic", "lava"].includes(material(flooded, 27 + dx, 18 + dy)));
  }
  assert.equal(atlasTerrain(ground, [{ id: "unknown", name: "???", anchor: { x: 6, y: 6 } }]).terrain, ground.terrain);
  assert.equal(environmentForLocation({ name: "Лавовое озеро" }).water, "lava");
  assert.ok(atlasTerrain(ground, [sites[0], { ...sites[1], anchor: sites[0].anchor }]).conflicts.length, "incompatible co-located places need a visible authoring warning");
  const shoreGrid = { ...ground, terrain: Array.from({ length: ground.width * ground.height }, (_, i) => i % ground.width < 4 ? "w" : "p").join("") };
  const portAnchor = placeAnchor({ ...shoreGrid, name: "Каменная пристань", existing: [], connected: null });
  assert.equal(portAnchor.x, 4, "new harbours choose a real shoreline before adding terrain");
  const unavailable = placeAnchor({ ...ground, name: "Порт", connected: null, existing: [{ x: 26, y: 16 }, { x: 20, y: 16 }] });
  assert.ok(![{ x: 26, y: 16 }, { x: 20, y: 16 }].some(at => Math.abs(at.x - unavailable.x) <= 1 && Math.abs(at.y - unavailable.y) <= 1), "missing biomes cannot place a new site on an occupied anchor");
  for (const viewport of [{ width: 350, height: 420 }, { width: 950, height: 680 }]) {
    const map = { width: 1536, height: 1152 };
    const limited = constrainAtlasView({ x: 1e6, y: -1e6, zoom: 0.0001 }, viewport, map);
    assert.equal(limited.zoom, Math.min(viewport.width / map.width, viewport.height / map.height));
    assert.ok(limited.x >= 0 && limited.y >= 0, "the entire overview cannot drift outside the viewport");
    const markers = Array.from({ length: 24 }, (_, i) => ({ id: String(i), name: `Long location ${i}`, x: 130 + i % 6 * 17, y: 165 + Math.floor(i / 6) * 35, priority: i === 0 ? 1000 : 100, partyCount: i === 0 ? 4 : 0 }));
    for (const detailed of [false, true]) {
      const groups = layoutAtlasMarkers(markers, viewport.width, viewport.height, detailed);
      assert.equal(groups[0].marker.id, "0", "the party remains the primary marker");
      assert.equal(groups.flatMap(group => group.members).length, markers.length);
      assert.ok(groups.length < markers.length, "close locations should collapse into groups");
      const labels = groups.filter(group => group.label).map(group => ({ x: group.marker.x + group.label.x - group.label.width / 2, y: group.marker.y + group.label.y - group.label.height / 2, ...{ width: group.label.width, height: group.label.height } }));
      labels.forEach((a, i) => {
        assert.ok(a.x >= 8 && a.y >= 8 && a.x + a.width <= viewport.width - 8 && a.y + a.height <= viewport.height - 8);
        for (const b of labels.slice(i + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, "map labels overlap");
      });
    }
  }
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
  assert.deepEqual(atlasRoute([...view.locations, { ...view.locations.find(location => location.id === target.id), id: "duplicate-name" }], start.id, target.id), [], "duplicate location names cannot guess a route");
  assert.equal(atlasQuests(["Compare Village with Old keep"], view.locations, [])[0].anchor, null, "ambiguous targets must stay unplaced");
  assert.equal(atlasQuests(["Go to Old keepers"], view.locations, [])[0].anchor, null, "partial names are not a destination");
  assert.equal(atlasQuests(["Leave Old keepers and enter Old keep"], view.locations, [])[0].locationId, target.id);
  assert.deepEqual(atlasRoute(view.locations.map(location => ({ ...location, connections: location.id === start.id ? [] : [start.name] })), start.id, target.id), [], "a reverse passage is not a forward route");
  assert.equal(locationKind({ name: "Village", layoutDescription: "A village beside a forest and mountain" }), "settlement");
  assert.equal(locationKind({ name: "Перевал Серых Ветров" }), "mountain");
  const id = questId(text);
  setOverworldPins(campaign.id, [{ id: `${id}@${target.id}`, x: 2, y: 2, label: text }]);
  setOverworldAnchor(campaign.id, target.id, { x: 30, y: 25 });
  regenerateOverworld(campaign.id, { seed: 17 });
  assert.deepEqual(getOverworld(campaign.id).anchors[target.id], { x: 30, y: 25 }, "rerolling the landscape must not move a recorded destination");
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
  const hidden = command("create_room", { name: "SECRET_ROOM_MARKER Вулкан" }).roomId;
  command("move", { roomId: hidden, userIds: [second.id] });
  setOverworldNotes(campaign.id, "SECRET_NOTE_MARKER");
  setOverworldLabels(campaign.id, [{ id: "secret", x: 3, y: 3, text: "SECRET_LABEL_MARKER", size: "small" }]);
  setQuestLog(campaign.id, ["SECRET_JOURNAL_MARKER"]);
  const privateView = overworldView(campaign.id, true, first.id);
  assert.equal(privateView.map.terrain, getOverworld(campaign.id).terrain, "hidden locations must not leave terrain signatures");
  assert.ok(![...privateView.map.materialGrid].some((_, index) => ["volcanic", "lava"].includes(materialAt(privateView.map.materialGrid, index))), "hidden volcano materials must not load in a player's projection");
  assert.ok(privateView.locations.some(location => location.id === room));
  assert.equal(privateView.party.find(character => character.id === hero.id).locationId, room);
  assert.ok(!privateView.party.some(character => character.id === scout.id), "unknown rooms must not reveal party positions");
  for (const secret of ["SECRET_ROOM_MARKER", "SECRET_NOTE_MARKER", "SECRET_LABEL_MARKER", "SECRET_JOURNAL_MARKER"]) {
    assert.ok(!JSON.stringify(privateView).includes(secret), `leaked ${secret}`);
  }
  assert.equal(overworldView(campaign.id, true, dm.id).party.find(character => character.id === scout.id).locationId, hidden);
  const exit = command("create_room", { name: "Known exit", connectTo: room }).roomId;
  const known = overworldView(campaign.id, false, first.id);
  assert.equal(known.locations.find(location => location.id === exit).visited, false, "a known exit is not yet visited");
  assert.deepEqual(atlasRoute(known.locations, room, exit), [room, exit]);

  command("move", { roomId: exit, userIds: [second.id] });
  const split = overworldView(campaign.id, false, first.id);
  assert.equal(split.party.find(character => character.id === scout.id)?.locationId, exit, "a hero in a known place must stay on the map after splitting the party");
  assert.equal(split.party.find(character => character.id === hero.id)?.locationId, room);
  const firstActor = spatialContext(campaign.id, first.id).actor;
  assert.deepEqual(store.view(firstActor).rooms.find(location => location.id === exit)?.occupants ?? [], [], "map positions must not expand room chat membership");
  for (const condition of ["invisible", "hidden"]) {
    patchSheet(scout.id, { conditions: [condition] });
    assert.ok(!overworldView(campaign.id, false, first.id).party.some(character => character.id === scout.id), `${condition} heroes must not appear on the map`);
    assert.equal(overworldView(campaign.id, true, dm.id).party.find(character => character.id === scout.id)?.locationId, exit);
  }
  patchSheet(scout.id, { conditions: [] });
  const secondActor = spatialContext(campaign.id, second.id).actor;
  store.command(secondActor, randomUUID(), "send", { roomId: exit, expectedRevision: store.getUserPosition(campaign.id, second.id).revision,
    kind: "do", characterId: scout.id, content: "PRIVATE_MAP_ACTION", stealth: true });
  assert.ok(!overworldView(campaign.id, false, first.id).party.some(character => character.id === scout.id), "pending stealth must not reveal a map position");
  store.reveal(campaign.id, scout.id);
  assert.equal(overworldView(campaign.id, false, first.id).party.find(character => character.id === scout.id)?.locationId, exit, "revealed heroes must reappear at their current place");

  const before = JSON.stringify(overworldView(campaign.id, false, first.id));
  const polling = waitForPrivateUpdate({ waitMs: 1000, recheckMs: 20, subscribe: listener => subscribeSpatialChanges(campaign.id, listener),
    load: async () => {
      const body = JSON.stringify(overworldView(campaign.id, false, first.id));
      return body === before ? new Response(null, { status: 304 }) : new Response(body);
    } });
  command("move", { roomId: room, userIds: [second.id] });
  notifySpatialChange(campaign.id);
  const response = await polling;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).party.find(character => character.id === scout.id).locationId, room, "an open atlas must update another hero's move without reopening");
  command("move", { roomId: exit, userIds: [first.id] });
  const moved = overworldView(campaign.id, false, first.id);
  assert.equal(moved.party.find(character => character.id === hero.id).locationId, exit);
  assert.equal(moved.party.find(character => character.id === scout.id).locationId, room, "previously visited places must keep their party markers");
  assert.equal(moved.locations.find(location => location.isCurrent).id, exit);
  console.log("test-world-atlas: 44 artworks, ecology, camera/label geometry, journal, movement, privacy and live updates passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}
