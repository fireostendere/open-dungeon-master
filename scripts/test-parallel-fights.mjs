// Without rooms, fights at two places run side by side as team rounds:
// each fight keeps its own floor, the heroes at the camp keep acting, the
// global round seals only once both fights reached their round boundary, a
// hero who walks into a fight joins it at once, two heroes share one fight
// without waiting on each other, and anyone can watch any fight. Real routes
// and the narrator facade on an isolated database; no model or network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
const directory = mkdtempSync(path.join(os.tmpdir(), "odm-parallel-fights-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
register("./lab/lab-loader.mjs", import.meta.url);
const { labRequest } = await import("./lab/next-headers-shim.mjs");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { createCampaign, joinByInviteCode, latestSeq, setCampaignStatus, getFightFloor, getFloor, getGlobalTurnState } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { getLocationByName, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getEncounter, listActiveFights } = await import("../src/lib/db/encounters.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const actions = await import("../src/app/api/campaigns/[campaignId]/actions/route.ts");
const battleMap = await import("../src/app/api/campaigns/[campaignId]/battle-map/route.ts");
const encounterRoute = await import("../src/app/api/campaigns/[campaignId]/encounter/route.ts");

try {
  const dm = createUser(`par-dm-${randomUUID()}`, "hash");
  const users = [0, 1, 2, 3].map(index => createUser(`par-${index}-${randomUUID()}`, "hash"));
  const campaign = createCampaign(dm.id, { title: "Parallel fights", description: "", theme: "", maxPlayers: 5, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false, language: "ru",
      globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 4, quorumDelayMinutes: 0 } } });
  for (const user of users) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
  const sheet = name => createSheetSchema.parse({ name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 300, ac: 12, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  const [oleg, levik, sigalis, kak] = ["Олег", "Левик", "Сигалис", "Как"].map((name, index) => createSheet(campaign.id, users[index].id, 1, sheet(name)));
  const tokens = users.map(user => mintSession(user.id).token);
  upsertCurrentLocation({ campaignId: campaign.id, name: "Костёр" });
  const narrator = (operation, params) => executeMcpNarratorControl(operation, { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), ...params });
  const invoke = (name, args) => narrator("narrator.invoke", { name, args });
  const call = async (route, method, token, { body, query = "" } = {}) => {
    const request = new Request(`http://odm.test/x${query}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await labRequest.run(request, () => route[method](request, { params: Promise.resolve({ campaignId: campaign.id }) }));
    return { status: response.status, body: await response.json() };
  };
  const act = (index, content) => call(actions, "POST", tokens[index], { body: { kind: "do", content } });
  const round = () => getGlobalTurnState(campaign.id);
  const fightAt = name => listActiveFights(campaign.id).find(fight => fight.locationId === getLocationByName(campaign.id, name).id);
  const current = fight => { const fresh = getEncounter(fight.id); return fresh.order[fresh.turnIndex]; };
  const waiting = fight => { const floor = getFightFloor(campaign.id, fight); return floor.mode === "hold" && Boolean(floor.team); };

  await narrator("narrator.narrate", { content: "Костёр трещит.", startGlobalRound: 1 });
  await invoke("move_party", { name: "Лес", characterIds: [sigalis.id] });
  await invoke("move_party", { name: "Пещера", characterIds: [kak.id] });
  const forestId = getLocationByName(campaign.id, "Лес").id;
  const caveId = getLocationByName(campaign.id, "Пещера").id;
  const bandit = [{ monster: "Разбойник", cr: 0.25 }];

  // Two fights at two places, side by side.
  await invoke("start_encounter", { enemies: bandit, locationId: forestId, rollInitiative: true });
  await invoke("start_encounter", { enemies: bandit, locationId: caveId, rollInitiative: true });
  await assert.rejects(() => invoke("start_encounter", { enemies: bandit, locationId: forestId, rollInitiative: true }), /already running at that place/);
  const forest = fightAt("Лес"), cave = fightAt("Пещера");
  assert.ok(forest && cave && forest.id !== cave.id, "two fights run at once");
  assert.equal(getFightFloor(campaign.id, forest).mode, "initiative");
  assert.deepEqual(getFightFloor(campaign.id, forest).userIds, [users[2].id], "the forest floor is Сигалис's");
  assert.deepEqual(getFightFloor(campaign.id, cave).userIds, [users[3].id], "the cave floor is Как's");
  assert.equal(getFloor(campaign.id, null).mode, "open", "the table keeps its own floor");

  // A fight tool that names nobody cannot guess which fight; naming a fighter is enough.
  await assert.rejects(() => invoke("end_turn", {}), /Several fights are running|needs/);
  // The camp is not in either fight: it acts in the global round.
  assert.equal((await act(0, "Подкидываю дров.")).status, 202);
  assert.equal((await act(1, "Точу меч.")).status, 202);
  assert.notEqual(round().phase, "ready", "the round waits for both fights");

  // The forest plays its combat round to the boundary and waits; the cave is still playing.
  await invoke("end_turn", { characterId: sigalis.id });
  assert.ok(waiting(forest), "the forest waits for the team");
  assert.equal(current(forest).characterId, sigalis.id);
  assert.notEqual(round().phase, "ready", "the cave has not finished its combat round");
  await assert.rejects(() => invoke("end_turn", { characterId: sigalis.id }), /waits for the rest of the party/);
  await invoke("end_turn", { characterId: kak.id });
  assert.ok(waiting(cave));
  assert.equal(round().phase, "ready", "both fights waiting and the camp done: the round seals");

  // The narrator resolves the round: both fights go on, each announcing its own place.
  await narrator("narrator.narrate", { content: "Лагерь, лес и пещера.", completeGlobalRound: 1 });
  assert.equal(round().roundNumber, 2);
  assert.ok(!waiting(forest) && !waiting(cave), "the next round opens both fights");

  // Левик walks into the forest: he joins at once and shares the fight with Сигалис.
  const arrival = await invoke("move_party", { name: "Лес", characterIds: [levik.id] });
  assert.match(JSON.stringify(arrival), /Левик joins the fight/);
  assert.ok(getEncounter(forest.id).order.some(entry => entry.kind === "pc" && entry.characterId === levik.id));
  // Play a fight to its round boundary, returning whose turns it gave.
  const playToBoundary = async (fight) => {
    const turns = [];
    for (let step = 0; step < 6 && !waiting(fight); step++) {
      const actor = current(fight);
      turns.push(actor.characterId);
      await invoke("end_turn", { characterId: actor.characterId });
    }
    assert.ok(waiting(fight), "the fight reaches its round boundary");
    return turns;
  };
  // This round Левик joined mid-way: he acts in it only if his initiative
  // slot is still ahead; Сигалис acts exactly once either way.
  const joinRound = await playToBoundary(forest);
  assert.equal(joinRound.filter(id => id === sigalis.id).length, 1);
  assert.ok(joinRound.filter(id => id === levik.id).length <= 1);

  // Anyone watches any fight; with none picked a camp hero sees the first one.
  const watched = await call(battleMap, "GET", tokens[0], { query: `?encounterId=${cave.id}` });
  assert.ok(watched.body.view?.tokens?.some(token => token.kind === "pc"), "the camp watches the cave");
  const listing = await call(encounterRoute, "GET", tokens[0], { query: `?encounterId=${cave.id}` });
  assert.equal(listing.body.encounter.id, cave.id);
  assert.equal(listing.body.fights.length, 2, "the switcher lists both fights");

  // Олег finishes round 2 at the camp; the cave plays its round; the round seals.
  assert.equal((await act(0, "Сторожу лагерь.")).status, 202);
  await playToBoundary(cave);
  assert.equal(round().phase, "ready");
  await narrator("narrator.narrate", { content: "Ещё раунд.", completeGlobalRound: 2 });

  // A full team round with two heroes in one fight: one turn each, no waiting on each other.
  assert.equal(round().roundNumber, 3);
  const fullRound = await playToBoundary(forest);
  assert.deepEqual([...fullRound].sort(), [levik.id, sigalis.id].sort(), "two heroes in one fight, one turn each");
  await playToBoundary(cave);
  assert.equal((await act(0, "Сторожу дальше.")).status, 202);
  assert.equal(round().phase, "ready", "camp done and both fights at their boundary: round 3 seals");
  // The cave falls: its XP goes to Как alone, the one hero who fought there.
  const xpBefore = Object.fromEntries([oleg, levik, sigalis, kak].map(hero => [hero.id, getSheetById(hero.id).xp]));
  const caveEnemy = getEncounter(cave.id).order.find(entry => entry.kind === "enemy").enemyId;
  await invoke("damage_enemy", { enemyId: caveEnemy, amount: 200 });
  assert.equal(getEncounter(cave.id).status, "ended");
  assert.ok(getSheetById(kak.id).xp > xpBefore[kak.id], "the fighter gets the fight's XP");
  for (const hero of [oleg, levik, sigalis]) assert.equal(getSheetById(hero.id).xp, xpBefore[hero.id], `${hero.name} was not in that fight`);
  assert.ok(fightAt("Лес"), "the forest fight goes on");
  console.log("test-parallel-fights: two fights at once, own floors, camp acts, round seals on both, join on arrival, two heroes one fight, spectating passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}
