// A fight only part of the party is in runs as the team round: the heroes
// elsewhere keep acting through the global turn (the fight's floor is not
// theirs), each fighter has one initiative turn per global round, the round
// seals only once the fighter has had it, the fighter's next turn waits for
// the next round, and everyone sees the fight. Real routes and narrator
// facade on an isolated database; no model or network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
const directory = mkdtempSync(path.join(os.tmpdir(), "odm-team-round-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
register("./lab/lab-loader.mjs", import.meta.url);
const { labRequest } = await import("./lab/next-headers-shim.mjs");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { createCampaign, joinByInviteCode, latestSeq, setCampaignStatus, getFloor, getGlobalTurnState } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { getLocationByName, upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getActiveEncounter } = await import("../src/lib/db/encounters.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const { composerGate } = await import("../src/app/campaigns/[campaignId]/composerGate.ts");
const actions = await import("../src/app/api/campaigns/[campaignId]/actions/route.ts");

try {
  const dm = createUser(`team-dm-${randomUUID()}`, "hash");
  const users = [0, 1, 2].map(index => createUser(`team-${index}-${randomUUID()}`, "hash"));
  const campaign = createCampaign(dm.id, { title: "Team round", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false, language: "ru",
      globalTurn: { enabled: true, turnCollectionMinutes: 0, quorumPlayers: 3, quorumDelayMinutes: 0 } } });
  for (const user of users) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
  const sheet = name => createSheetSchema.parse({ name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 200, ac: 12, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  const [oleg, levik, sigalis] = ["Олег", "Левик", "Сигалис"].map((name, index) => createSheet(campaign.id, users[index].id, 1, sheet(name)));
  const [olegToken, levikToken, sigalisToken] = users.map(user => mintSession(user.id).token);
  upsertCurrentLocation({ campaignId: campaign.id, name: "Костёр" });
  const narrator = (operation, params) => executeMcpNarratorControl(operation, { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), ...params });
  const invoke = (name, args) => narrator("narrator.invoke", { name, args });
  const act = async (token, body) => {
    const request = new Request("http://odm.test/actions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const response = await labRequest.run(request, () => actions.POST(request, { params: Promise.resolve({ campaignId: campaign.id }) }));
    return { status: response.status, body: await response.json() };
  };
  const round = () => getGlobalTurnState(campaign.id);

  // Opening narration opens global round 1; Сигалис walks into the forest and is ambushed there.
  await narrator("narrator.narrate", { content: "Костёр трещит.", startGlobalRound: 1 });
  assert.equal(round().phase, "active");
  await invoke("move_party", { name: "Лес", characterIds: [sigalis.id] });
  const forest = getLocationByName(campaign.id, "Лес").id;
  await invoke("start_encounter", { enemies: [{ monster: "Разбойник", cr: 0.25 }], locationId: forest, rollInitiative: true });
  const encounter = getActiveEncounter(campaign.id);
  assert.ok(encounter.orderReady);
  assert.deepEqual(getFloor(campaign.id), { mode: "initiative", encounterId: encounter.id, userIds: [users[2].id], currentName: "Сигалис", round: encounter.round },
    "Сигалис has not acted this round, so his turn is open");

  // The heroes at the camp are not in the fight: they act through the global round.
  assert.deepEqual([...activePublicEncounter(campaign.id).outsideIds].sort(), [levik.id, oleg.id].sort());
  const blocked = composerGate({ floor: getFloor(campaign.id), outsideFight: true, sheets: [oleg, levik, sigalis], meUserId: users[0].id, kind: "do",
    myName: "Олег", leadPrivate: false, openingNarrationPlaying: false, globalTurnEnabled: true, globalTurnState: round(), locale: "ru" });
  assert.equal(blocked.inputBlocked, false, "the camp's composer is open while the forest fights");
  assert.equal((await act(olegToken, { kind: "do", content: "Подбрасываю дров в костёр." })).status, 202);
  assert.equal((await act(levikToken, { kind: "do", content: "Чищу доспех." })).status, 202);
  assert.equal((await act(olegToken, { kind: "do", content: "И ещё раз." })).status, 409, "one action per hero per round");
  assert.equal((await act(sigalisToken, { kind: "do", content: "Болтаю у костра." })).status, 400, "a fighter plays the fight through the combat builder");
  assert.notEqual(round().phase, "ready", "the round waits for Сигалис's turn in the fight");

  // Everyone sees the fight: the camp watches through Сигалис's eyes.
  const view = buildPlayerMapView(campaign.id, users[0].id);
  assert.ok(view.tokens.some(token => token.kind === "pc"), "the spectator sees the hero in the fight");
  assert.ok(view.terrain.replace(/ /g, "").length > 0, "and the ground around him, not a dark field");

  // Сигалис's turn ends: it was his action this round, the round seals, and
  // his next turn (the order wraps) waits for the next round.
  await invoke("end_turn", { characterId: sigalis.id });
  assert.equal(round().phase, "ready", "every hero has acted: the round goes to the narrator");
  const held = getFloor(campaign.id);
  assert.equal(held.mode, "hold");
  assert.deepEqual(held.team, { round: 1 });
  assert.equal(held.next.currentName, "Сигалис");
  await assert.rejects(() => invoke("end_turn", { characterId: sigalis.id }), /waits for the rest of the party/);
  await assert.rejects(() => narrator("narrator.release_floor", {}), /waits for the rest of the party/);
  const read = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0 });
  assert.equal(findTurnLock(read)?.state, "awaiting_team", "the narrator reads why the fight waits");

  // The narrator resolves the round: round 2 opens and so does Сигалис's turn.
  await narrator("narrator.narrate", { content: "Пламя, доспех, лес.", completeGlobalRound: 1 });
  assert.equal(round().roundNumber, 2);
  assert.equal(round().phase, "active");
  assert.equal(getFloor(campaign.id).mode, "initiative");
  assert.equal((await act(olegToken, { kind: "do", content: "Иду за Сигалисом." })).status, 202, "round 2 is open at the camp too");

  // Everyone walks into the fight: it is a whole-party fight again and owns the table.
  await invoke("move_party", { name: "Лес", characterIds: [oleg.id, levik.id] });
  assert.equal(activePublicEncounter(campaign.id).outsideIds, undefined);
  console.log("test-team-round: camp acts during the fight, one turn per round, round seals on the fighter, held turn, release on next round, spectator view passed");

} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}

function findTurnLock(value) {
  if (!value || typeof value !== "object") return null;
  if ("turnLock" in value && value.turnLock) return value.turnLock;
  for (const child of Object.values(value)) {
    const found = findTurnLock(child);
    if (found) return found;
  }
  return null;
}
