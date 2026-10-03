// A fight belongs to one place: nobody standing elsewhere rolls initiative,
// takes a turn, acts, is hit or shows on its board. Real isolated campaign
// state through the narrator facade; no model or network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
const directory = mkdtempSync(path.join(os.tmpdir(), "odm-fight-place-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode, latestSeq, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { getLocationByName, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getActiveEncounter } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
try {
  const dm = createUser(`fight-dm-${randomUUID()}`, "hash");
  const users = [0, 1, 2].map(index => createUser(`fight-${index}-${randomUUID()}`, "hash"));
  const campaign = createCampaign(dm.id, { title: "Fight place", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false } });
  for (const user of users) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
  const sheet = name => createSheetSchema.parse({ name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 12, ac: 12, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  const [oleg, levik, sigalis] = ["Олег", "Левик", "Сигалис"].map((name, index) => createSheet(campaign.id, users[index].id, 1, sheet(name)));
  const camp = upsertCurrentLocation({ campaignId: campaign.id, name: "Костёр" });
  const invoke = (name, args) => executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name, args });
  await invoke("move_party", { name: "Лес", characterIds: [sigalis.id] });

  const bandits = [{ monster: "Разбойник", cr: 0.25 }];
  await assert.rejects(() => invoke("start_encounter", { enemies: bandits }), /party is split; pass locationId.*Сигалис: Лес/);
  await assert.rejects(() => invoke("start_encounter", { enemies: bandits, locationId: "nowhere" }), /Nobody stands at that locationId/);
  await invoke("start_encounter", { enemies: bandits, locationId: camp.id, rollInitiative: true });
  let encounter = getActiveEncounter(campaign.id);
  assert.equal(encounter.locationId, camp.id);
  assert.ok(encounter.orderReady, "initiative waits for nobody outside the fight");
  const pcs = () => getActiveEncounter(campaign.id).order.filter(entry => entry.kind === "pc").map(entry => entry.name).sort();
  assert.deepEqual(pcs(), ["Левик", "Олег"], "only heroes at the fight's place roll initiative");
  const map = getBattleMapForEncounter(encounter.id);
  assert.ok(getTokenByRef(map.id, oleg.id) && !getTokenByRef(map.id, sigalis.id), "the board shows only those at the fight");
  const enemyId = encounter.order.find(entry => entry.kind === "enemy").enemyId;

  const seq = latestSeq(campaign.id);
  await assert.rejects(() => invoke("pc_attack", { characterId: sigalis.id, enemyId, targetEnemyId: enemyId }), /Сигалис is not at the fight \(Костёр\)/);
  await assert.rejects(() => invoke("enemy_attack", { enemyId, targetCharacterId: "Сигалис" }), /not at the fight/, "names resolve too");
  await assert.rejects(() => invoke("heal", { casterId: levik.id, characterId: sigalis.id, amount: 3 }), /not at the fight/, "no healing across places");
  await assert.rejects(() => invoke("aoe_damage", { characterIds: [oleg.id, sigalis.id], damage: "2d6", saveAbility: "dex", dc: 12, type: "fire" }), /not at the fight/);
  assert.equal(latestSeq(campaign.id), seq, "refused crossings change nothing");
  const elsewhere = await invoke("grant_item", { characterId: sigalis.id, name: "Шишка", qty: 1 });
  assert.equal(elsewhere.result.result.result.granted, "Шишка", "what happens elsewhere is not part of the fight");

  // Walking in is the only way to join, and walking in joins: initiative is
  // rolled at once and the hero takes their place in the order.
  const arrival = await invoke("move_party", { name: "Костёр", characterIds: [sigalis.id] });
  assert.match(arrival.result.result.result.fight.join(" "), /Сигалис joins the fight at initiative \d+/);
  assert.deepEqual(pcs(), ["Левик", "Олег", "Сигалис"]);
  assert.ok(getTokenByRef(map.id, sigalis.id), "a late arrival gets a token next to the party");

  // Leaving takes a hero off the board and out of the turn order; leaving
  // on your own turn hands it on.
  encounter = getActiveEncounter(campaign.id);
  const leaver = [oleg, levik, sigalis].find(hero => hero.id === encounter.order[encounter.turnIndex].characterId);
  const departure = await invoke("move_party", { name: "Лес", characterIds: [leaver.id] });
  const notes = departure.result.result.result.fight.join(" ");
  assert.match(notes, new RegExp(`${leaver.name} left the fight at Костёр`));
  assert.match(notes, new RegExp(`It was ${leaver.name}'s turn; it passed to`));
  assert.equal(getTokenByRef(map.id, leaver.id), null);
  await assert.rejects(() => invoke("pc_attack", { characterId: leaver.id, enemyId, targetEnemyId: enemyId }), new RegExp(`${leaver.name} is not at the fight`));
  const order = getActiveEncounter(campaign.id).order;
  for (let step = 0; step < order.length * 2; step++) {
    encounter = getActiveEncounter(campaign.id);
    const current = encounter.order[encounter.turnIndex];
    assert.notEqual(current.characterId, leaver.id, "the pointer never rests on someone who left");
    await invoke("end_turn", { characterId: current.characterId });
  }
  await invoke("end_encounter", { outcome: "truce" });

  // An ambush on everyone there (here the lone hero in the forest) used to
  // build the order and never lock it: every hero was surprised, so no one
  // could take the first turn. Round 1 is the enemies'; the hero acts in round 2.
  const forest = getLocationByName(campaign.id, "Лес");
  const ambush = await invoke("start_encounter", { enemies: bandits, locationId: forest.id, surprised: "party", rollInitiative: true });
  encounter = getActiveEncounter(campaign.id);
  assert.ok(encounter.orderReady, "a fully surprised party still gets an initiative order");
  assert.equal(encounter.round, 2);
  assert.deepEqual(encounter.surprisedIds, []);
  assert.equal(encounter.order[encounter.turnIndex].characterId, leaver.id);
  assert.match(ambush.result.result.result.next, /Combat begins\. .* acts first: call enemy_attack/);
  await invoke("end_turn", { characterId: leaver.id });
  assert.equal(getActiveEncounter(campaign.id).order[getActiveEncounter(campaign.id).turnIndex].characterId, leaver.id, "the solo hero's turn comes round again");
  await invoke("end_encounter", { outcome: "truce" });

  // With location chat on the fight is its room's, and the same rules hold.
  const yard = (await invoke("location_enable", { name: "Двор" })).result.result.roomId;
  const barn = (await invoke("location_create_room", { name: "Сарай", connectTo: yard })).result.result.roomId;
  await invoke("location_move", { roomId: barn, characterIds: [sigalis.id] });
  await invoke("start_encounter", { enemies: bandits, roomId: yard, rollInitiative: true });
  encounter = getActiveEncounter(campaign.id, yard);
  assert.deepEqual(encounter.order.filter(entry => entry.kind === "pc").map(entry => entry.name).sort(), ["Левик", "Олег"]);
  const roomEnemy = encounter.order.find(entry => entry.kind === "enemy").enemyId;
  await assert.rejects(() => invoke("pc_attack", { roomId: yard, characterId: sigalis.id, enemyId: roomEnemy, targetEnemyId: roomEnemy }), /Сигалис is not at the fight \(Двор\)/);
  await assert.rejects(() => invoke("enemy_attack", { roomId: yard, enemyId: roomEnemy, targetCharacterId: sigalis.id }), /not at the fight \(Двор\)/);
  const walkIn = await invoke("location_move", { roomId: yard, characterIds: [sigalis.id] });
  assert.match(walkIn.result.result.fight.join(" "), /Сигалис joins the fight at initiative \d+/);
  assert.ok(getActiveEncounter(campaign.id, yard).order.some(entry => entry.kind === "pc" && entry.characterId === sigalis.id), "walking into the room and rolling joins its fight");
  console.log("test-fight-location: split-party start, roster, board, crossing refusals, late join, departure, turn skipping and room fights passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}
