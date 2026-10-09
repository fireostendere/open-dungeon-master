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
const { createCampaign, joinByInviteCode, latestSeq, setCampaignStatus, setQuestLog } = await import("../src/lib/db/campaigns.ts");
const { createSheet, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { upsertCurrentLocation, insertKnownLocation } = await import("../src/lib/db/locations.ts");
const { getOverworld, overworldView, regenerateOverworld, setOverworldAnchor, setOverworldPins, setOverworldNotes, setOverworldLabels } = await import("../src/lib/db/overworld.ts");
const { atlasQuests, atlasRoute, questId, locationKind, constrainAtlasView, layoutAtlasMarkers } = await import("../src/lib/overworld/atlas.ts");
const { atlasArt, atlasTerrain, atlasTowns, environmentForLocation, interiorPlace, landmarkForLocation, landmarkSprite, placeEnvironments, urbanPlace, LANDMARK_ASSETS, LANDMARK_NAMES, TERRAIN_NAMES, TERRAIN_ASSETS, materialAt } = await import("../src/lib/overworld/cartography.ts");
const { placeAnchor } = await import("../src/lib/overworld/logic.ts");
const { runSpatialCommand, spatialContext, spatialStore } = await import("../src/lib/spatial/service.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
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
  // Places in town: streets, squares, inns and homes stand on one town
  // footprint with the town miniature, never on the region's forest.
  for (const [name, layoutDescription] of [["Улица Медников, дом 7 — квартира Гризельды"], ["Главная площадь — Фей Парад"],
    ["Шаловливый палец гремлина", "Таверна у главной площади, внутри шумно."], ["Rusty Anchor Tavern"], ["Market Square"]]) {
    assert.equal(landmarkForLocation({ name, layoutDescription }), "town", name);
    assert.equal(urbanPlace({ name, layoutDescription }), true, name);
    assert.deepEqual(environmentForLocation({ name, layoutDescription }), { ground: "p", material: "plains", radius: 4 }, name);
  }
  assert.equal(environmentForLocation({ name: "Улица Медников", layoutDescription: "Улица петляет к лесу за стеной. Пахнет медью." }).material, "plains",
    "a forest beyond the walls does not move a street into it");
  assert.equal(landmarkForLocation({ name: "Смотровая площадка" }), null, "a lookout platform is not a town square");
  assert.equal(landmarkForLocation({ name: "Восточный лес" }), null);
  assert.equal(environmentForLocation({ name: "Восточный лес" }).material, "forest");
  assert.equal(urbanPlace({ name: "Деревня у леса" }), false, "a whole settlement keeps its own miniature and spacing");
  const woods = { seed: 9, width: 40, height: 32, terrain: "f".repeat(40 * 32) };
  const town = atlasTerrain(woods, [
    { id: "street", name: "Улица Медников, дом 7", anchor: { x: 10, y: 10 }, connections: ["Главная площадь"] },
    { id: "square", name: "Главная площадь", anchor: { x: 10, y: 16 }, connections: ["Улица Медников, дом 7", "Шаловливый палец гремлина"] },
    { id: "inn", name: "Шаловливый палец гремлина", anchor: { x: 15, y: 18 }, connections: [] },
    { id: "glade", name: "Чёрная Падь", anchor: { x: 30, y: 10 }, connections: [] },
  ]);
  const townPlaces = [
    { id: "street", name: "Улица Медников, дом 7", anchor: { x: 10, y: 10 }, connections: ["Главная площадь"] },
    { id: "square", name: "Главная площадь", anchor: { x: 10, y: 16 }, connections: ["Улица Медников, дом 7", "Шаловливый палец гремлина"] },
    { id: "inn", name: "Шаловливый палец гремлина", anchor: { x: 15, y: 18 }, connections: [] },
    { id: "glade", name: "Чёрная Падь", anchor: { x: 30, y: 10 }, connections: [] },
    { id: "far", name: "Рыночная площадь Дальнего Брода", anchor: { x: 34, y: 28 }, connections: [] },
  ];
  assert.deepEqual(atlasTowns(townPlaces), [{ ids: ["inn", "square", "street"], x: 35 / 3, y: 44 / 3, size: 13 }],
    "one settlement miniature under the streets, square and inn; a lone square elsewhere keeps its own pin art");
  const woodsTile = (x, y) => town.terrain[y * woods.width + x];
  for (const [x, y] of [[10, 10], [10, 13], [10, 16], [12, 17], [15, 18]]) assert.equal(woodsTile(x, y), "p", `town ground at ${x},${y}`);
  assert.equal(woodsTile(30, 10), "f", "an untyped place away from town keeps the forest");
  assert.equal(woodsTile(20, 25), "f");
  const townAnchors = [{ x: 10, y: 10 }, { x: 10, y: 16 }, { x: 15, y: 18 }];
  const nextDoor = placeAnchor({ ...woods, name: "Переулок Слепого Кота", connected: { x: 10, y: 16 }, existing: townAnchors });
  assert.ok(Math.max(Math.abs(nextDoor.x - 10), Math.abs(nextDoor.y - 16)) <= 3, "a new street stands beside its square, not out in the forest");
  const besideTown = placeAnchor({ ...woods, name: "Дом вдовы Кравец", connected: { x: 10, y: 16 }, connectedInTown: true, existing: townAnchors });
  assert.ok(Math.max(Math.abs(besideTown.x - 10), Math.abs(besideTown.y - 16)) <= 3, "an untyped place off the square is in town too");
  // Whatever the heroes find gets a fitting miniature: settlements, outposts,
  // temples, lairs, in Russian and English, read from the head of the name.
  for (const [name, expected] of [
    ["Застава на тракте", "watchtower"], ["Аванпост Северный", "watchtower"], ["Кордон лесника", "watchtower"], ["Маяк", "watchtower"],
    ["Форт Стальной", "castle"], ["Острог", "castle"], ["Посёлок Сухой Лог", "town"], ["Хутор Глушь", "village"],
    ["Мельница у реки", "village"], ["Часовня", "shrine"], ["Каменный круг", "shrine"], ["Собор Святого Луки", "temple"], ["Церковь", "temple"],
    ["Аббатство Святой Ирмы", "monastery"], ["Погост", "graveyard"], ["Курган вождя", "graveyard"], ["Логово волков", "cave"],
    ["Катакомбы", "dungeon"], ["Причал", "port"], ["Переправа", "bridge"], ["Зиккурат", "pyramid"], ["Обсерватория", "wizardTower"],
    ["Лагерь разбойников", "camp"], ["Столица", "city"], ["Казармы городской стражи", "town"], ["Лавка у кладбища", "town"],
    ["Northern Outpost", "watchtower"], ["Old Farmstead", "village"], ["Abbey of Dawn", "monastery"], ["Saint Mary's Cathedral", "temple"],
    ["Forest Chapel", "shrine"], ["The Catacombs", "dungeon"], ["Granite Quarry", "mine"], ["Wolf Lair", "cave"],
    ["Фортуна", null], ["Лес у деревни", null], ["Подвал замка", null], ["Тронный зал", null],
  ]) assert.equal(landmarkForLocation({ name }), expected, name);
  assert.equal(environmentForLocation({ name: "Лес у деревни" }).material, "forest", "a forest named for its village is a forest");
  assert.ok(interiorPlace({ name: "Подвал замка" }) && interiorPlace({ name: "Тронный зал" }) && !interiorPlace({ name: "Замок Чёрной Розы" }));
  assert.deepEqual(environmentForLocation({ name: "Лесная улица" }), { ground: "p", material: "plains", radius: 4 }, "a street name is not a forest");
  for (const [name, material, water] of [["Остров Чаек", "plains", "island"], ["Песчаный пляж", "desert", "coast"], ["Оазис Звёздный", "desert", "oasis"],
    ["Сосновый бор", "forest", undefined], ["Степь", "plains", undefined], ["Утёс Ветров", "mountains", undefined], ["Пустошь", "tundra", undefined]]) {
    const env = environmentForLocation({ name });
    assert.equal(env.material, material, name);
    assert.equal(env.water, water, name);
  }
  assert.equal(environmentForLocation({ name: "Столица" }).radius, 5, "a city clears more ground than a village");
  assert.equal(environmentForLocation({ name: "Посёлок Сухой Лог" }).radius, 3.5);
  assert.equal(environmentForLocation({ name: "Эльфийский город" }).material, "enchanted");
  const isles = atlasTerrain(woods, [{ id: "isle", name: "Остров Чаек", anchor: { x: 20, y: 16 } }, { id: "oasis", name: "Оазис Звёздный", anchor: { x: 8, y: 24 } }]);
  const isleTile = (x, y) => isles.terrain[y * woods.width + x];
  assert.equal(isleTile(20, 16), "p");
  assert.equal(isleTile(24, 16), "w", "open water round an island");
  assert.equal(materialAt(isles.materialGrid, 24 * woods.width + 8), "shallows", "an oasis has its pool");
  assert.equal(materialAt(isles.materialGrid, 24 * woods.width + 10), "jungle", "and a ring of palms");
  assert.equal(materialAt(isles.materialGrid, 24 * woods.width + 12), "desert");
  const keep = [{ id: "keep", name: "Замок Чёрной Розы", anchor: { x: 20, y: 10 }, connections: ["Тронный зал"] },
    { id: "throne", name: "Тронный зал", anchor: { x: 22, y: 11 }, connections: [] }];
  assert.deepEqual(placeEnvironments(keep).get("throne"), placeEnvironments(keep).get("keep"), "a room stands on its castle's ground");
  assert.equal(atlasTerrain(woods, keep).terrain[11 * woods.width + 22], "h");
  const armoury = placeAnchor({ ...woods, name: "Оружейная", connected: { x: 20, y: 10 }, existing: [{ x: 20, y: 10 }] });
  assert.ok(Math.max(Math.abs(armoury.x - 20), Math.abs(armoury.y - 10)) <= 3, "a room is placed beside the place it opens from");
  const art = atlasArt([...townPlaces, ...keep, { id: "hamlet", name: "Деревня Ивняки", anchor: { x: 30, y: 26 }, visited: false },
    { id: "capital", name: "Столица", anchor: { x: 36, y: 4 } }, { id: "camp", name: "Лагерь", anchor: { x: 36, y: 7 } }]);
  const byKey = new Map(art.map((entry) => [entry.ids.join(","), entry]));
  assert.equal(byKey.get("inn,square,street").asset, "town", "a town's streets share one miniature");
  assert.equal(byKey.get("keep").asset, "castle");
  assert.equal(byKey.has("throne"), false, "a room has no miniature of its own");
  assert.equal(byKey.get("hamlet").visited, false, "an unexplored place is drawn faded");
  assert.equal(byKey.get("hamlet").size, 4);
  assert.equal(byKey.get("capital").size, 4.5, "a crowded city shrinks to its neighbour's distance");
  assert.equal(byKey.get("far").asset, "town", "a lone market square keeps a small town miniature");
  assert.deepEqual(art.map((entry) => entry.y), [...art.map((entry) => entry.y)].sort((a, b) => a - b), "nearer miniatures overlap farther ones");
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
  const campaign = createCampaign(dm.id, { title: "Atlas check", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false } });
  assert.ok(joinByInviteCode(first.id, campaign.inviteCode).campaign);
  assert.ok(joinByInviteCode(second.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
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

  // The narrator moves part of the party; the rest stays where it stands.
  const invoke = (name, args) => executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name, args });
  const seqBeforeTypo = latestSeq(campaign.id);
  await assert.rejects(() => invoke("move_party", { name: "Forest edge", characterIds: ["no-such-hero"] }), /Unknown characterIds no-such-hero.*Scout/);
  assert.equal(latestSeq(campaign.id), seqBeforeTypo, "a wrong character id must move nobody");
  const scouting = await invoke("move_party", { name: "Forest edge", characterIds: [scout.id] });
  assert.equal(scouting.result.result.result.positions, "Torin: Old keep; Scout: Forest edge");
  const forest = overworldView(campaign.id, true, dm.id).locations.find(location => location.name === "Forest edge");
  assert.deepEqual(forest.connections, ["Old keep"], "the route the scout took is recorded");
  for (const viewer of [first, second]) {
    const party = overworldView(campaign.id, false, viewer.id).party;
    assert.equal(party.find(character => character.id === hero.id).locationId, target.id, "those not named stay put");
    assert.equal(party.find(character => character.id === scout.id).locationId, forest.id);
  }
  assert.equal(overworldView(campaign.id, false, second.id).locations.find(location => location.isCurrent).id, forest.id, "each player's own place is theirs");
  const splitRead = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, projection: "live", afterSeq: 0, maxBytes: 131072 });
  assert.deepEqual(splitRead.result.partyPositions.map(position => [position.name, position.locationName]), [["Torin", "Old keep"], ["Scout", "Forest edge"]]);
  await invoke("move_party", { name: "Old keep", characterIds: ["scout"] });
  assert.ok(overworldView(campaign.id, false, first.id).party.every(character => character.locationId === target.id), "a regrouped party is whole again");
  assert.equal(overworldView(campaign.id, false, first.id).locations.filter(location => location.isCurrent).length, 1);
  const longName = `Old keep ${"long ".repeat(18)}`;
  upsertCurrentLocation({ campaignId: campaign.id, name: longName });
  upsertCurrentLocation({ campaignId: campaign.id, name: longName });
  assert.equal(overworldView(campaign.id, true, dm.id).locations.filter(location => location.name.startsWith("Old keep long")).length, 1, "a long place name must not duplicate on every move");
  upsertCurrentLocation({ campaignId: campaign.id, name: "Old keep" });
  const together = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, projection: "live", afterSeq: 0, maxBytes: 131072 });
  assert.deepEqual(together.result.partyPositions.map(position => position.locationId), [target.id, target.id], "the narrator sees every hero's place, not only after a split");

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
  // With rooms on, a legacy move would change nothing the table sees.
  await assert.rejects(() => invoke("move_party", { name: "Old keep", roomId: room }), /location_move/);
  await invoke("location_move", { roomId: exit, characterIds: [scout.id] });
  assert.equal(store.getUserRoom(campaign.id, second.id), exit, "location_move takes the narrator's character ids");
  const roomRead = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, projection: "live", afterSeq: 0, maxBytes: 131072 });
  assert.equal(roomRead.result.location, null, "the stale pre-rooms place is not the narrator's current location");
  assert.deepEqual(roomRead.result.partyPositions.map(position => [position.name, position.locationName]), [["Torin", "Known exit"], ["Scout", "Known exit"]]);
  await invoke("location_move", { roomId: room, characterIds: ["Scout"] });
  assert.equal(store.getUserRoom(campaign.id, second.id), room);
  const anchorsBeforeDisable = getOverworld(campaign.id).anchors;
  const disable = { operation: "disable", requestId: randomUUID(), preserveMapPositions: true };
  assert.throws(() => runSpatialCommand(campaign.id, first.id, disable), error => error.status === 403);
  assert.ok(store.enabled(campaign.id), "a player cannot disable rooms or expose their map positions");
  const receipt = await executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id),
    commandId: disable.requestId, name: "location_disable", args: { preserveMapPositions: true }, readAfter: true });
  const disabled = receipt.result.result;
  assert.equal(disabled.disabled, true);
  assert.deepEqual(runSpatialCommand(campaign.id, dm.id, disable), disabled, "retry must preserve the same committed map positions");
  const ordinary = overworldView(campaign.id, false, first.id);
  const road = ordinary.locations.find(location => location.name === "Public road");
  const outside = ordinary.locations.find(location => location.name === "Known exit");
  assert.equal(ordinary.scope, "party");
  assert.equal(store.view(firstActor).enabled, false);
  assert.equal(ordinary.party.find(character => character.id === hero.id).locationId, outside.id);
  assert.equal(ordinary.party.find(character => character.id === scout.id).locationId, road.id);
  assert.equal(ordinary.locations.find(location => location.isCurrent).id, outside.id);
  assert.equal(overworldView(campaign.id, false, second.id).locations.find(location => location.isCurrent).id, road.id);
  assert.deepEqual(outside.anchor, anchorsBeforeDisable[exit]);
  assert.deepEqual(road.anchor, anchorsBeforeDisable[room]);
  assert.deepEqual(road.connections, [outside.name]);
  assert.ok(!JSON.stringify(ordinary.locations).includes("SECRET_ROOM_MARKER"), "empty private rooms must not become shared locations");
  const readDisabled = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, projection: "live", afterSeq: 0, maxBytes: 131072 });
  assert.equal(readDisabled.result.spatial.enabled, false);
  assert.deepEqual(readDisabled.result.partyPositions, disabled.preservedMapPositions);
  assert.ok(!JSON.stringify(readDisabled.result.messages).includes("PRIVATE_MAP_ACTION"), "room messages must not move into shared history");
  const snapshot = await executeMcpNarratorControl("narrator.snapshot", { campaignId: campaign.id, sections: ["location"] });
  assert.deepEqual(snapshot.result.location.partyPositions, disabled.preservedMapPositions);
  regenerateOverworld(campaign.id, { seed: 19 });
  assert.equal(overworldView(campaign.id, false, first.id).party.find(character => character.id === scout.id).locationId, road.id);
  patchSheet(scout.id, { conditions: ["invisible"] });
  assert.ok(!overworldView(campaign.id, false, first.id).party.some(character => character.id === scout.id));
  assert.ok(overworldView(campaign.id, true, dm.id).party.some(character => character.id === scout.id));
  patchSheet(scout.id, { conditions: [] });
  upsertCurrentLocation({ campaignId: campaign.id, name: "Village" });
  assert.ok(overworldView(campaign.id, false, first.id).party.every(character => character.locationId === start.id), "a later whole-party move must replace preserved positions");
  console.log("test-world-atlas: 44 artworks, ecology, camera/label geometry, journal, movement, privacy and live updates passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}
