// Local isolated DB: regression of the actual Healing Word / staff / pet flow.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-combat-dialogue-'));
process.env.SQLITE_DB_PATH = path.join(dir, 'test.sqlite');
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString('hex');
register('./lib/register-alias.mjs', import.meta.url);

const { createUser } = await import('../src/lib/db/users.ts');
const { createCampaign, setFloor, getFloor, latestSeq } = await import('../src/lib/db/campaigns.ts');
const { createSheet, getSheetById, patchSheet } = await import('../src/lib/db/sheets.ts');
const { createHomebrew } = await import('../src/lib/db/homebrew.ts');
const { createSheetSchema } = await import('../src/lib/schemas/sheet.ts');
const { createEncounter, getEncounter, insertEnemy, saveEncounter } = await import('../src/lib/db/encounters.ts');
const { invokeEngineSynchronous: invoke } = await import('../src/lib/dm/invoke.ts');
const { createDmTurn, listPendingForTurn } = await import('../src/lib/db/dm-turns.ts');
const { handlePcAttack, resolvePendingPcAttack } = await import('../src/lib/dm/pc-attack.ts');
const { handleRequestPlayerInput } = await import('../src/lib/dm/basic-adjudications.ts');
const { conditionRollRiders, conditionOnHitDice } = await import('../src/lib/srd/condition-effects.ts');
const { executeNarratorCommand } = await import('../src/lib/dm/narrator-command.ts');

const user = createUser('combat-regression', 'x');
const allyUser = createUser('combat-ally', 'x');
const campaign = createCampaign(user.id, { title: 'Combat regression', description: '', theme: '', maxPlayers: 2, startingLevel: 3, difficulty: 'normal' });
const base = { race: 'human', class: 'druid', abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 16, cha: 16 }, maxHp: 24, ac: 13,
  hitDice: { die: 'd8', total: 3, spent: 0 }, proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: ['simple'] },
  equipment: [{ name: 'Булава «Аргумент»', qty: 1, equipped: true }],
  spellcasting: { ability: 'wis', slots: { '1': { max: 3, used: 0 } }, known: ['Healing Word', 'Eldritch Blast', 'Cure Wounds'], prepared: [] } };
const hero = createSheet(campaign.id, user.id, 3, createSheetSchema.parse({ ...base, name: 'Hero' }));
const ally = createSheet(campaign.id, allyUser.id, 3, createSheetSchema.parse({ ...base, name: 'Ally' }));
for (const [name, level, casting_time, desc] of [
  ['Healing Word', 1, '1 bonus action', 'A creature regains hit points equal to 1d4 + your spellcasting ability modifier.'],
  ['Cure Wounds', 1, '1 action', 'A creature regains hit points equal to 1d8 + your spellcasting ability modifier.'],
  ['Eldritch Blast', 0, '1 action', 'Make a ranged spell attack. On a hit, the target takes 1d10 force damage.'],
]) createHomebrew(user.id, { kind: 'spell', name, data: { level, casting_time, desc } });
const encounter = createEncounter(campaign.id, 'Regression');
const enemy = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: 'dummy', displayName: 'Dummy', initiative: 1,
  stats: { maxHp: 1000, ac: 12, cr: 0, xp: 0, dexMod: 0, speed: '0', attacks: [], traits: [], resist: '', immune: '', vulnerable: '', conditionImmune: '' } });
encounter.order = [{ kind: 'pc', characterId: hero.id, userId: user.id, name: hero.name, initiative: 20 }, { kind: 'pc', characterId: ally.id, userId: allyUser.id, name: ally.name, initiative: 10 }, { kind: 'enemy', enemyId: enemy.id, name: enemy.displayName, initiative: 1 }];
encounter.orderReady = true;
saveEncounter(encounter);
const dm = { kind: 'human', userId: user.id };
const call = (name, args) => invoke(campaign, dm, { name, args });
function reset() {
  const e = getEncounter(encounter.id);
  e.turnIndex = 0; e.round++; e.turnBudget = null; saveEncounter(e);
  const next = { mode: 'initiative', encounterId: e.id, round: e.round, userIds: [user.id], currentName: hero.name };
  setFloor(campaign.id, { mode: 'hold', next, combat: { encounterId: e.id, round: e.round, turnIndex: 0, characterId: hero.id, requiresEndTurn: true, mechanicsResolved: false } });
  patchSheet(hero.id, { spellcasting: base.spellcasting, conditions: [], pets: [] });
  patchSheet(ally.id, { currentHp: 1 });
}

reset();
const combo = call('combat_turn', { characterId: hero.id, steps: [
  { name: 'heal', args: { characterId: ally.id, spell: 'Healing Word', level: 1 } },
  { name: 'pc_attack', args: { targetEnemyId: enemy.id, weapon: 'Булава «Аргумент»' } },
] });
assert.equal(combo.ok, true, JSON.stringify(combo));
assert.equal(combo.result.status, 'completed', JSON.stringify(combo));
assert.equal(combo.result.steps.length, 2);
assert.equal(getSheetById(hero.id).spellcasting.slots['1'].used, 1);
assert.ok(getSheetById(ally.id).currentHp > 1);
assert.equal(getEncounter(encounter.id).turnIndex, 1, 'one compound turn advances exactly once');
assert.equal(getFloor(campaign.id).mode, 'hold', 'narration still owns the final publication gate');

reset();
const payload = { name: 'combat_turn', args: { characterId: hero.id, steps: [{ name: 'heal', args: { characterId: ally.id, spell: 'Healing Word', level: 1 } }] } };
const command = { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), operation: 'narrator.invoke', payload,
  loadState: () => campaign, work: () => invoke(campaign, dm, payload) };
const receipt = await executeNarratorCommand(command);
const stateAfterReceipt = { hp: getSheetById(ally.id).currentHp, slot: getSheetById(hero.id).spellcasting.slots['1'].used, seq: latestSeq(campaign.id) };
const replay = await executeNarratorCommand(command);
assert.equal(receipt.result.ok, true);
assert.equal(replay.replayed, true);
assert.deepEqual(replay.result, receipt.result);
assert.deepEqual({ hp: getSheetById(ally.id).currentHp, slot: getSheetById(hero.id).spellcasting.slots['1'].used, seq: latestSeq(campaign.id) }, stateAfterReceipt, 'receipt replay cannot heal, spend, roll or advance twice');

reset();
const badCombo = call('combat_turn', { characterId: hero.id, steps: [
  { name: 'heal', args: { characterId: ally.id, spell: 'Healing Word', level: 1 } },
  { name: 'heal', args: { characterId: ally.id, spell: 'Cure Wounds', level: 1 } },
] });
assert.equal(badCombo.ok, true);
assert.equal(badCombo.result.status, 'blocked');
assert.equal(badCombo.result.nextStep, 1);
assert.equal(getSheetById(hero.id).spellcasting.slots['1'].used, 1, 'confirmed first heal survives second-step refusal');
assert.ok(getSheetById(ally.id).currentHp > 1);
assert.equal(getEncounter(encounter.id).turnIndex, 0);
assert.equal(getEncounter(encounter.id).turnBudget.bonusUsed, true);

reset();
const wrongCaster = call('heal', { characterId: hero.id, casterId: ally.id, spell: 'Healing Word', level: 1 });
assert.equal(wrongCaster.ok, false);
assert.equal(getSheetById(ally.id).spellcasting.slots['1'].used, 0);
const blast = call('pc_attack', { characterId: hero.id, weapon: 'Eldritch Blast', targetEnemyId: enemy.id });
assert.equal(blast.ok, true, JSON.stringify(blast));
assert.equal(blast.result.weapon, 'Eldritch Blast');
assert.equal(getSheetById(hero.id).spellcasting.slots['1'].used, 0, 'cantrip spends no slot');
assert.equal(getEncounter(encounter.id).turnBudget.actionUsed, true);
assert.equal(call('pc_attack', { characterId: hero.id, spell: 'Eldritch Blast', targetEnemyId: enemy.id }).ok, false);

reset();
const summoned = call('summon_pet', { characterId: hero.id, name: 'Fedya', kind: 'other', form: 'test beast', hp: 12, ac: 13, commandCost: 'bonus', attacks: [{ name: 'Claws', toHit: 4, damage: '1d4+2', type: 'slashing' }] });
assert.equal(summoned.ok, true, JSON.stringify(summoned));
const petAttack = call('pet_attack', { characterId: hero.id, petName: 'Fedya', enemyId: enemy.id, attack: 'Claws' });
assert.equal(petAttack.ok, true, JSON.stringify(petAttack));
assert.equal(getEncounter(encounter.id).turnBudget.bonusUsed, true);
assert.equal(call('pet_attack', { characterId: hero.id, petName: 'Fedya', targetEnemyId: enemy.id, attack: 'Claws' }).ok, false);
assert.equal(call('pc_attack', { characterId: hero.id, targetEnemyId: enemy.id }).ok, true, 'pet bonus leaves the owner action');
assert.equal(call('damage_pet', { characterId: hero.id, petName: 'Fedya', amount: 12 }).ok, true);
assert.equal(getSheetById(hero.id).pets[0].hp, 0);
assert.equal(getSheetById(hero.id).currentHp, 24, 'pet damage never hits owner');

// An explicit clarification reopens only the current actor, with its budget intact.
const beforeBudget = getEncounter(encounter.id).turnBudget;
const sheets = [getSheetById(hero.id), getSheetById(ally.id)];
const byId = new Map(sheets.map(s => [s.id, s]));
assert.ok(handleRequestPlayerInput(campaign, JSON.stringify({ characterIds: [ally.id], prompt: 'Which target?' }), sheets, byId).error);
assert.equal(handleRequestPlayerInput(campaign, JSON.stringify({ characterIds: [hero.id], prompt: 'Which target?' }), sheets, byId).ok, true);
assert.equal(getFloor(campaign.id).mode, 'initiative');
assert.deepEqual(getEncounter(encounter.id).turnBudget, beforeBudget);

reset();
const reactionState = getEncounter(encounter.id);
reactionState.reactionsUsed = [hero.id, ally.id];
saveEncounter(reactionState);
assert.equal(call('end_turn', { characterId: hero.id }).ok, true);
assert.deepEqual(getEncounter(encounter.id).reactionsUsed, [hero.id], 'only the incoming actor refreshes its reaction');

// Physical dice preserve a hit-triggered Smite on a miss; a hit consumes it.
assert.deepEqual(conditionRollRiders(['wrathful smite'], 'attack').spent, []);
assert.equal(conditionOnHitDice(['wrathful smite'], { weapon: false, melee: false }).suffix, '');
for (const hit of [false, true]) {
  reset(); patchSheet(hero.id, { conditions: ['wrathful smite'] });
  const sheet = getSheetById(hero.id);
  const turn = createDmTurn(campaign.id, []);
  const parked = handlePcAttack(campaign, turn, JSON.stringify({ characterId: hero.id, targetEnemyId: enemy.id, weapon: 'Булава «Аргумент»' }), [sheet, ally], new Map([[sheet.id, sheet], [ally.id, ally]]), new Set([user.id]), 'test');
  assert.equal(parked._parked, true);
  const pending = listPendingForTurn(turn.id).at(-1);
  assert.ok(getSheetById(hero.id).conditions.includes('wrathful smite'));
  resolvePendingPcAttack(pending, { total: hit ? 20 : 1, breakdown: { crit: hit ? 'nat20' : 'nat1', natural: hit ? 20 : 1 } });
  assert.equal(getSheetById(hero.id).conditions.includes('wrathful smite'), !hit);
  // Do not leave this test's parked physical roll in the next scenario.
  const { getDatabase } = await import('../src/lib/db/core.ts');
  getDatabase().prepare("UPDATE pending_rolls SET status='submitted'").run();
}
// Merely having Sneak Attack must not opt the player into an optional rider.
for (const declared of [false, true]) {
  reset();
  patchSheet(hero.id, { class: 'rogue', features: [{ name: 'Sneak Attack' }], equipment: [{ name: 'Dagger', qty: 1, equipped: true }] });
  const rogue = getSheetById(hero.id), turn = createDmTurn(campaign.id, []);
  const result = handlePcAttack(campaign, turn, JSON.stringify({ characterId: hero.id, targetEnemyId: enemy.id,
    weapon: 'Dagger', advantage: 'advantage', ...(declared ? { sneakAttack: true } : {}) }), [rogue, ally], new Map([[hero.id, rogue], [ally.id, ally]]), new Set([user.id]), 'sneak');
  assert.equal(result._parked, true);
  const pending = listPendingForTurn(turn.id).at(-1);
  assert.equal(pending.attack.damageExpression.includes('+2d6'), declared, 'optional rider requires explicit intent even with advantage');
  const { getDatabase } = await import('../src/lib/db/core.ts');
  getDatabase().prepare("UPDATE pending_rolls SET status='submitted'").run();
}

function mercy() {
  reset();
  patchSheet(hero.id, { class: 'monk', features: [{ name: 'Martial Arts' }, { name: 'Hand of Healing' }], resources: { ki: { max: 3, used: 0 } } });
}
mercy();
const mercyPayload = { name: 'combat_turn', args: { characterId: hero.id, steps: [
  { name: 'pc_attack', args: { targetEnemyId: enemy.id, weapon: 'Unarmed strike' } },
  { name: 'use_resource', args: { resource: 'ki', variant: 'flurry_of_healing', targetCharacterId: ally.id } },
  { name: 'pc_attack', args: { targetEnemyId: enemy.id, weapon: 'Unarmed strike', flurry: true } },
] } };
const mercyCommand = { campaignId: campaign.id, expectedSeq: latestSeq(campaign.id), commandId: randomUUID(), operation: 'narrator.invoke', payload: mercyPayload,
  loadState: () => campaign, work: () => invoke(campaign, dm, mercyPayload) };
const mercyReceipt = await executeNarratorCommand(mercyCommand);
assert.equal(mercyReceipt.result.result.status, 'completed', JSON.stringify(mercyReceipt));
assert.equal(getSheetById(hero.id).resources.ki.used, 1);
assert.ok(getSheetById(ally.id).currentHp >= 5 && getSheetById(ally.id).currentHp <= 8, 'server rolls d4 + Wisdom 3');
assert.equal(getEncounter(encounter.id).turnIndex, 1);
const mercyState = { hp: getSheetById(ally.id).currentHp, seq: latestSeq(campaign.id) };
assert.equal((await executeNarratorCommand(mercyCommand)).replayed, true);
assert.deepEqual({ hp: getSheetById(ally.id).currentHp, seq: latestSeq(campaign.id) }, mercyState);
mercy();
assert.equal(call('use_resource', { characterId: hero.id, resource: 'ki', variant: 'flurry_of_healing', targetCharacterId: ally.id }).ok, false, 'Flurry requires the Attack action');
assert.equal(getSheetById(hero.id).resources.ki.used, 0);
const hand = { characterId: hero.id, resource: 'ki', variant: 'hand_of_healing', targetCharacterId: ally.id };
assert.equal(call('use_resource', hand).ok, true);
assert.equal(getEncounter(encounter.id).turnBudget.actionUsed, true);
assert.equal(call('use_resource', hand).ok, false, 'no second healing action');
assert.equal(getSheetById(hero.id).resources.ki.used, 1);
mercy(); patchSheet(hero.id, { features: [{ name: 'Martial Arts' }] });
assert.equal(call('use_resource', hand).ok, false, 'requires the healing feature');
mercy(); patchSheet(hero.id, { resources: { ki: { max: 3, used: 3 } } });
assert.equal(call('use_resource', hand).ok, false, 'no free healing with exhausted ki');
assert.equal(getSheetById(ally.id).currentHp, 1);
mercy();
assert.equal(call('pc_attack', { characterId: hero.id, targetEnemyId: enemy.id, weapon: 'Unarmed strike', flurry: true }).ok, false, 'no free Flurry attack');
console.log('combat-dialogue-integration: compound turns, replay, healing, cantrips, pets, clarification, explicit Sneak Attack, Mercy/Flurry passed');
