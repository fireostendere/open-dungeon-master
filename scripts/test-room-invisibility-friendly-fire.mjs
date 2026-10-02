// One real SQLite round trip through visibility, room receipts and both dice paths.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
const dir = mkdtempSync(path.join(os.tmpdir(), "odm-room-ff-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);
const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateGameSettings, joinByInviteCode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createDmTurn, listPendingForTurn, resolvePendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter, getEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { insertRoll, getRoll } = await import("../src/lib/db/rolls.ts");
const { invokeEngineSynchronous } = await import("../src/lib/dm/invoke.ts");
const { handlePcAttack, resolvePendingPcAttack, PC_ATTACK_PARKED } = await import("../src/lib/dm/pc-attack.ts");
const { handleCastAtEnemy } = await import("../src/lib/dm/cast-tools.ts");
const { applyPendingDamageRoll, autoEndOnVictory } = await import("../src/lib/dm/enemy-damage.ts");
const { spatialStore, spatialContext, runSpatialCommand } = await import("../src/lib/spatial/service.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { createBattleMap, insertToken } = await import("../src/lib/db/battle-maps.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { applyExtraEncounterCall } = await import("../src/lib/dm/encounter-tools-extra.ts");

try {
  const [dm, a, b, c] = ["dm", "a", "b", "c"].map(name => createUser(`room-ff-${name}`, "x"));
  let campaign = createCampaign(dm.id, { title: "regression", description: "", theme: "", maxPlayers: 4,
    startingLevel: 1, difficulty: "normal", gameSettings: { globalTurn: { enabled: false }, mapsEnabled: false, ttsEnabled: false } });
  for (const user of [a, b, c]) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  // A normal authored content row keeps this check independent of an installed pack.
  createHomebrew(a.id, { kind: "spell", name: "Poison Spray", data: { level: 0, casting_time: "1 action", range: "10 feet",
    desc: "The target must succeed on a Constitution saving throw or take 1d12 poison damage.",
    mech: { resolution: "save", save: "con", damageType: "poison", halfOnSave: false } } });
  const makeSheet = (user, name) => createSheet(campaign.id, user.id, 1, createSheetSchema.parse({
    name, race: "human", class: "wizard", abilities: { str: 18, dex: 12, con: 10, int: 18, wis: 10, cha: 10 },
    maxHp: 100, ac: 10, hitDice: { die: "d6", total: 1, spent: 0 },
    proficiencies: { saves: ["int", "wis"], skills: [], languages: [], tools: [], armor: [], weapons: ["simple"] },
    equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
    spellcasting: { ability: "int", slots: { "1": { max: 5, used: 0 } }, known: ["Poison Spray"], prepared: ["Poison Spray"] },
  }));
  const sheets = [makeSheet(a, "A"), makeSheet(b, "B"), makeSheet(c, "C")];
  const [attacker, target, remote] = sheets;
  const byId = new Map(sheets.map(sheet => [sheet.id, sheet]));
  setCampaignStatus(campaign.id, "active"); campaign = getCampaignById(campaign.id);
  const command = (user, operation, input = {}) => runSpatialCommand(campaign.id, user.id, { operation, requestId: randomUUID(), ...input });
  const room = command(dm, "enable", { name: "Tavern" }).roomId;
  const otherRoom = command(dm, "create_room", { name: "Cellar", connectTo: room, walkable: true }).roomId;
  command(dm, "move", { roomId: otherRoom, userIds: [c.id] });
  patchSheet(target.id, { conditions: ["invisible"] });
  const actor = user => spatialContext(campaign.id, user.id).actor;
  assert.ok(!spatialStore().view(actor(a)).rooms.find(r => r.id === room).occupants.includes(b.id));
  assert.ok(spatialStore().view(actor(b)).rooms.find(r => r.id === room).occupants.includes(b.id));
  assert.ok(spatialStore().view(actor(dm)).rooms.find(r => r.id === room).occupants.includes(b.id));
  const privateAction = command(b, "send", { roomId: room, expectedRevision: 1, kind: "do", content: "Secret invisible plan", stealth: false }).message;
  assert.equal(privateAction.stealth, true);
  assert.equal(spatialStore().canReadMessage(actor(a), privateAction.id), false);
  assert.equal(spatialStore().canReadMessage(actor(c), privateAction.id), false);
  assert.equal(spatialStore().canReadMessage(actor(b), privateAction.id), true);
  command(dm, "detect", { observerId: a.id, targetId: target.id, roomId: room, sense: "sound" });
  assert.equal(spatialStore().isUnseen(campaign.id, target.id, [a.id], room), true);
  command(dm, "detect", { observerId: a.id, targetId: target.id, roomId: room, sense: "special" });
  assert.equal(spatialStore().isUnseen(campaign.id, target.id, [a.id], room), false);
  assert.equal(spatialStore().canReadMessage(actor(a), privateAction.id), false);
  command(dm, "lose_detection", { observerId: a.id, targetId: target.id });
  patchSheet(target.id, { conditions: [] });
  assert.equal(spatialStore().isUnseen(campaign.id, target.id, [a.id], room), false);
  assert.ok(spatialStore().view(actor(a)).rooms.find(r => r.id === room).occupants.includes(b.id));
  patchSheet(target.id, { conditions: ["invisible"] });

  const encounter = createEncounter(campaign.id, "Party dispute", "fight", room);
  encounter.order = [attacker, target].map((s, i) => ({ kind: "pc", characterId: s.id, userId: s.userId, name: s.name, initiative: 20 - i }));
  encounter.orderReady = true; saveEncounter(encounter);
  spatialStore().setRoomFloor(campaign.id, room, { mode: "initiative", encounterId: encounter.id,
    userIds: [b.id], currentName: target.name, round: 1 });
  assert.equal(spatialStore().view(actor(a)).floor.mode, "hold");
  assert.equal(spatialStore().view(actor(b)).floor.currentName, target.name);
  spatialStore().setRoomFloor(campaign.id, room, { mode: "open" });
  assert.equal(activePublicEncounter(campaign.id, { roomId: room, viewerUserId: a.id }).order.some(e => e.id === target.id), false);
  assert.equal(activePublicEncounter(campaign.id, { roomId: room, viewerUserId: b.id }).order.some(e => e.id === target.id), true);
  const map = createBattleMap({ encounterId: encounter.id, campaignId: campaign.id, width: 5, height: 5, terrain: ".".repeat(25), ambient: "bright", theme: "dungeon", lights: [], seed: 1 });
  for (const s of [attacker, target]) insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: s.id, name: s.name, x: 2, y: 2 });
  assert.equal(buildPlayerMapView(campaign.id, a.id, { encounter }).tokens.some(t => t.refId === target.id), false);
  assert.equal(buildPlayerMapView(campaign.id, b.id, { encounter }).tokens.some(t => t.refId === target.id), true);
  encounter.turnIndex = 1; saveEncounter(encounter);
  assert.equal(buildPlayerMapView(campaign.id, a.id, { encounter }).currentTurnName, "");
  assert.equal(buildPlayerMapView(campaign.id, b.id, { encounter }).currentTurnName, target.name);
  encounter.turnIndex = 0; saveEncounter(encounter);
  const turn = createDmTurn(campaign.id, []);
  const attackArgs = { characterId: attacker.id, targetCharacterId: target.id, weapon: "Quarterstaff" };
  const attack = (args = attackArgs) => handlePcAttack(campaign, turn, JSON.stringify(args), sheets, byId, new Set([a.id]), "friendly-fire");
  assert.match(attack().error, /friendly fire is disabled/i);
  assert.equal(getEncounter(encounter.id).turnBudget, null);
  updateGameSettings(campaign.id, { friendlyFire: true }); campaign = getCampaignById(campaign.id);
  assert.match(attack({ ...attackArgs, targetCharacterId: remote.id }).error, /participat|location/i);
  assert.equal(attack()[PC_ATTACK_PARKED], true);
  const pending = listPendingForTurn(turn.id).at(-1);
  assert.equal(pending.attack.targetCharacterId, target.id);
  const hitRoll = insertRoll({ campaignId: campaign.id, characterId: attacker.id, requestedBy: "dm", kind: "attack", detail: "test", result: { expression: "1d20+6", total: 26, natural: 20, crit: "nat20", terms: [] } });
  assert.match(resolvePendingPcAttack(pending, hitRoll), /now rolls damage/);
  resolvePendingRoll(pending.id, "submitted", hitRoll.id);
  const damagePending = listPendingForTurn(turn.id).at(-1);
  const damageRoll = insertRoll({ campaignId: campaign.id, characterId: attacker.id, requestedBy: "dm", kind: "damage", detail: "test", result: { expression: "2d6+4", total: 12, terms: [] } });
  patchSheet(target.id, { tempHp: 5 });
  assert.match(applyPendingDamageRoll(damagePending, damageRoll), /applied 12 damage/);
  assert.equal(getSheetById(target.id).currentHp, 93);
  applyPendingDamageRoll(damagePending, getRoll(damageRoll.id));
  assert.equal(getSheetById(target.id).currentHp, 93);
  resolvePendingRoll(damagePending.id, "submitted", damageRoll.id);
  assert.deepEqual(autoEndOnVictory(campaign, turn, getEncounter(encounter.id), sheets, byId), {});
  assert.equal(getEncounter(encounter.id).status, "active");
  const reset = () => { const fight = getEncounter(encounter.id); fight.turnBudget = null; saveEncounter(fight); };
  reset(); patchSheet(attacker.id, { conditions: ["invisible"] });
  const cast = handleCastAtEnemy(campaign, turn, JSON.stringify({ characterId: attacker.id, targetCharacterId: target.id, spell: "Poison Spray", saveAbility: "con", damage: "1d12", damageType: "poison" }), sheets, byId);
  assert.equal(cast.ok, true, JSON.stringify(cast));
  assert.equal(getSheetById(target.id).currentHp, 93 - (cast.damage ?? 0));
  assert.equal(getSheetById(attacker.id).spellcasting.slots["1"].used, 0);
  assert.equal(getSheetById(attacker.id).conditions.includes("invisible"), false);
  reset();
  const beforeArea = [attacker, target].map(s => getSheetById(s.id).currentHp);
  const area = applyExtraEncounterCall(campaign, turn, "aoe_damage", JSON.stringify({ casterId: attacker.id, damage: 10, dc: 30, saveAbility: "dex", halfOnSave: true,
    area: { shape: "sphere", origin: { x: 2, y: 2 }, target: { x: 2, y: 2 }, sizeTiles: 1 } }), sheets, byId);
  assert.equal(area.result.ok, true, JSON.stringify(area));
  assert.ok(getSheetById(attacker.id).currentHp < beforeArea[0]);
  assert.ok(getSheetById(target.id).currentHp < beforeArea[1]);
  assert.equal(getSheetById(remote.id).currentHp, 100);
  // A second room's combat must not steal this attack's encounter or budget.
  const second = createEncounter(campaign.id, "Separate fight", "fight", otherRoom);
  second.orderReady = true;
  second.order = [{ kind: "pc", characterId: remote.id, userId: c.id, name: remote.name, initiative: 10 }];
  saveEncounter(second); reset();
  setFloor(campaign.id, { mode: "initiative", encounterId: encounter.id, userIds: [a.id], currentName: attacker.name, round: 1 }, room);
  const ordinary = { casterId: target.id, casterKind: "pc", spell: "Invisibility", instanceId: randomUUID(), rounds: 10 };
  const greater = { casterId: attacker.id, casterKind: "pc", spell: "Greater Invisibility", instanceId: randomUUID(), rounds: 10 };
  patchSheet(attacker.id, { conditions: ["invisible"], conditionMeta: { invisible: { concentrationSources: [ordinary, greater] } } });
  const beforeDigital = getSheetById(target.id).currentHp;
  const digital = invokeEngineSynchronous(campaign, { kind: "human", userId: dm.id }, { name: "pc_attack", args: attackArgs });
  assert.equal(digital.ok, true, JSON.stringify(digital));
  assert.equal(typeof digital.result.hit, "boolean");
  assert.equal(getSheetById(target.id).currentHp, beforeDigital - (digital.result.hit ? digital.result.damage : 0));
  assert.equal(getEncounter(second.id).turnBudget, null);
  assert.equal(getSheetById(attacker.id).conditions.includes("invisible"), true);
  assert.deepEqual(getSheetById(attacker.id).conditionMeta.invisible.concentrationSources.map(s => s.spell), ["Greater Invisibility"]);
  console.log("PASS: room privacy, invisible visibility, physical PvP, player spells and measured friendly fire");
} finally { rmSync(dir, { recursive: true, force: true }); }
