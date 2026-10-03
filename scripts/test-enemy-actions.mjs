// An enemy takes the actions its printed block gives it: a giant spider's
// web reaches 30/60 ft and restrains, its bite poisons on a failed save, a
// breath weapon is everyone's save, limited actions stay spent until they
// recharge, and an unknown action is refused instead of swapped for a bite.
// Real isolated campaign state through the narrator facade; no model or network.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
const directory = mkdtempSync(path.join(os.tmpdir(), "odm-enemy-actions-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const cwd = process.cwd();
process.chdir(directory);
register("./lib/register-alias.mjs", import.meta.url);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, joinByInviteCode, latestSeq, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { getActiveEncounter, getEnemy, insertEnemy, patchEnemyConditions, setEnemySpent } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, getTokenByRef, placeToken, placeTokens, setBattleMapTerrain } = await import("../src/lib/db/battle-maps.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { rechargeEnemies } = await import("../src/lib/dm/enemy-actions.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");

const spiderBlock = {
  cr: 1, hit_points: 26, armor_class: 14, dexterity: 16, speed: { walk: 30, climb: 30 },
  actions: [
    { name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one.", attack_bonus: 5, damage_dice: "1d8", damage_bonus: 3 },
    { name: "Web (Recharge 5-6)", desc: "Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success.", attack_bonus: 5 },
  ],
};
const houndBlock = {
  cr: 3, hit_points: 45, armor_class: 15, dexterity: 12,
  actions: [
    { name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 7 (2d6) fire damage." },
    { name: "Fire Breath (Recharge 5-6)", desc: "The hound exhales fire in a 15-foot cone. Each creature in that area must make a DC 12 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one." },
  ],
};

try {
  const dm = createUser(`actions-dm-${randomUUID()}`, "hash");
  const users = [0, 1].map(index => createUser(`actions-${index}-${randomUUID()}`, "hash"));
  const campaign = createCampaign(dm.id, { title: "Enemy actions", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
    gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false } });
  for (const user of users) assert.ok(joinByInviteCode(user.id, campaign.inviteCode).campaign);
  setCampaignStatus(campaign.id, "active");
  const sheet = name => createSheetSchema.parse({ name, race: "human", class: "fighter", abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 200, ac: 10, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  const [oleg, levik] = ["Олег", "Левик"].map((name, index) => createSheet(campaign.id, users[index].id, 1, sheet(name)));
  upsertCurrentLocation({ campaignId: campaign.id, name: "Лес" });
  const invoke = (name, args) => executeMcpNarratorControl("narrator.invoke", { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), name, args });
  const result = response => response.result.result.result;

  await invoke("start_encounter", { enemies: [{ monster: "Разбойник", cr: 0.25 }], rollInitiative: true });
  const encounter = getActiveEncounter(campaign.id);
  const spider = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "giant-spider", displayName: "Паук", initiative: 9, stats: parseMonster(spiderBlock, 1) });
  const hound = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "hell-hound", displayName: "Гончая", initiative: 9, stats: parseMonster(houndBlock, 3) });

  // An open field: the spider 35 ft (7 tiles) from Олег, as at the table.
  const map = getBattleMapForEncounter(encounter.id);
  assert.ok(map.width >= 16, "the board is wide enough for a 60 ft shot");
  setBattleMapTerrain(map.id, ".".repeat(map.width * map.height));
  placeToken(getTokenByRef(map.id, oleg.id).id, 2, 2);
  placeToken(getTokenByRef(map.id, levik.id).id, 2, 4);
  const bandit = encounter.order.find(entry => entry.kind === "enemy").enemyId;
  placeToken(getTokenByRef(map.id, bandit).id, 0, map.height - 1);
  placeTokens(map.id, campaign.id, [{ kind: "enemy", refId: spider.id, name: "Паук", spot: { x: 9, y: 2 } }, { kind: "enemy", refId: hound.id, name: "Гончая", spot: { x: 0, y: 8 } }]);
  const spiderAt = (x, y) => placeToken(getTokenByRef(map.id, spider.id).id, x, y);

  // An action the block does not have is refused, never quietly a bite.
  await assert.rejects(() => invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id, attack: "Sting" }),
    /has no action "Sting"\. Its actions: Bite, Web \(Recharge 5-6\)/);

  // Held in place (speed 0) it cannot close to 30 ft: the web flies at long range, at disadvantage.
  patchEnemyConditions(spider.id, ["grappled"]);
  const far = result(await invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id, attack: "Web" }));
  assert.equal(far.attack, "Web (Recharge 5-6)");
  assert.equal(far.range, "long range: disadvantage");
  assert.deepEqual(getEnemy(spider.id).spent, ["Web (Recharge 5-6)"], "a used web is spent whether or not it lands");
  await assert.rejects(() => invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id, attack: "Web" }),
    /Web \(Recharge 5-6\) is spent until it recharges \(a d6 of 5\+/);

  // Past 60 ft there is no shot at all.
  setEnemySpent(spider.id, []);
  spiderAt(15, 2);
  await assert.rejects(() => invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id, attack: "Web" }), /beyond Web \(Recharge 5-6\)'s/);

  // Free to move, it walks into its 30 ft range; a landed web restrains, with the way out spelled out.
  patchEnemyConditions(spider.id, []);
  spiderAt(9, 2);
  let webbed = null;
  for (let tries = 0; tries < 60 && !webbed; tries++) {
    setEnemySpent(spider.id, []);
    const shot = result(await invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id, attack: "Web" }));
    assert.equal(shot.range, undefined, "within 30 ft the shot is a normal one");
    if (shot.hit) webbed = shot.swings[0];
  }
  assert.ok(webbed, "a +5 web hits AC 10 sometime in 60 tries");
  assert.equal(webbed.damage, undefined, "the web deals no damage");
  assert.equal(webbed.condition, "restrained");
  assert.match(webbed.escape, /DC 12/);
  assert.ok(getSheetById(oleg.id).conditions.includes("restrained"));
  assert.ok(chebyshevFrom(getTokenByRef(map.id, spider.id), { x: 2, y: 2 }) <= 6, "it moved into its 30 ft range");

  // The bite walks into reach and its poison is Олег's own CON save.
  let poisoned = null;
  for (let tries = 0; tries < 60 && !poisoned; tries++) {
    const bite = result(await invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: oleg.id }));
    assert.equal(bite.attack, "Bite", "the everyday attack is the bite, not the web");
    if (bite.hit) poisoned = bite.swings[0];
  }
  assert.ok(poisoned?.damage > 0);
  assert.equal(poisoned.save.dc, 11);
  assert.equal(typeof poisoned.save.saved, "boolean");
  assert.equal(chebyshevFrom(getTokenByRef(map.id, spider.id), { x: 2, y: 2 }), 1);

  // Recharge: a spent web comes back on a 5 or 6 at the top of a round.
  setEnemySpent(spider.id, ["Web (Recharge 5-6)"]);
  for (let round = 0; round < 80 && getEnemy(spider.id).spent.length; round++) rechargeEnemies([getEnemy(spider.id)]);
  assert.deepEqual(getEnemy(spider.id).spent, [], "a web recharges within 80 rounds of d6 rolls");

  // A breath weapon: everyone named rolls their own save; the damage is rolled once.
  const before = [oleg, levik].map(hero => getSheetById(hero.id).currentHp);
  const breath = result(await invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: oleg.id, targetCharacterIds: [levik.id], attack: "Fire Breath" }));
  assert.equal(breath.action, "Fire Breath (Recharge 5-6)");
  assert.equal(breath.save, "DEX DC 12");
  assert.equal(breath.results.length, 2);
  const after = [oleg, levik].map(hero => getSheetById(hero.id).currentHp);
  assert.ok(after.every((hp, index) => hp < before[index]), "a save for half still burns");
  assert.deepEqual(getEnemy(hound.id).spent, ["Fire Breath (Recharge 5-6)"]);
  await assert.rejects(() => invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: oleg.id, attack: "Fire Breath" }), /is spent until it recharges/);
  console.log("test-enemy-actions: refusal, long range, max range, web restrain + escape, recharge, bite poison save, breath weapon passed");
} finally {
  process.chdir(cwd);
  rmSync(directory, { recursive: true, force: true });
}

function chebyshevFrom(token, point) {
  return Math.max(Math.abs(token.x - point.x), Math.abs(token.y - point.y));
}
