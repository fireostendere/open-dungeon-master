import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, sqliteFixture } from './lib/readiness-harness.mjs';
import * as operation from '../src/lib/operation-scope.mjs';
import { parseCompleteTurn, combatCompletionDisposition } from '../src/lib/dm/combat-completion.ts';

// Domain rules/catalog/turn mapper are explicit fixtures. The facade, rollback,
// lifecycle, scope mapper, SQL and events are production modules. This tests
// boundaries, not the complete combat model or a real Polymorph spell.
function fixture() {
  const f = sqliteFixture();
  f.db.exec(`CREATE TABLE dm_turns (id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id), value_json TEXT NOT NULL);
    CREATE TABLE encounter_test (campaign_id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE sheet_test (id TEXT PRIMARY KEY, slots INTEGER NOT NULL);
    INSERT INTO sheet_test VALUES ('pc1', 3);`);
  const campaign = { id: 'c1', dmUserId: 'dm', gameSettings: { dicePolicy: 'digital' } };
  const pending = [];
  const turns = {
    createDmTurn: (campaignId, _conversation, actor) => {
      const turn = { id: crypto.randomUUID(), campaignId, actor, status: 'running', resolvedCharacterIds: [], actedEnemyIds: [], conversation: [] };
      f.db.prepare('INSERT INTO dm_turns VALUES (?, ?, ?)').run(turn.id, campaignId, JSON.stringify(turn)); return turn;
    },
    getDmTurn: (id) => { const row = f.db.prepare('SELECT value_json FROM dm_turns WHERE id = ?').get(id); return row ? JSON.parse(row.value_json) : null; },
    saveDmTurn: (turn) => f.db.prepare('UPDATE dm_turns SET value_json = ? WHERE id = ?').run(JSON.stringify(turn), turn.id),
    listOpenPendingRolls: () => pending,
  };
  const encounters = {
    getActiveEncounter: () => { const row = f.db.prepare("SELECT value_json FROM encounter_test WHERE campaign_id = 'c1'").get(); return row ? JSON.parse(row.value_json) : null; },
    save: (encounter) => f.db.prepare('INSERT OR REPLACE INTO encounter_test VALUES (?, ?)').run('c1', JSON.stringify(encounter)),
    listActiveFights: () => { const encounter = encounters.getActiveEncounter(); return encounter ? [encounter] : []; },
  };
  let advanceCalls = 0, enemyAttacks = 0;
  const encounterTools = { advanceAfterTurn: (_campaign, turn) => {
    advanceCalls++;
    const enc = encounters.getActiveEncounter();
    assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
    const current = enc.order[enc.turnIndex];
    assert.ok(turn.resolvedCharacterIds.includes(current.characterId));
    if (enc.turnIndex === 1 && !turn.actedEnemyIds.includes('enemy')) enemyAttacks++;
    enc.turnIndex = (enc.turnIndex + 1) % 3;
    if (enc.turnIndex === 0) enc.round++;
    encounters.save(enc);
    f.events.publishPersisted('c1', 'encounter_updated', {});
  } };
  const scopes = loadSource('src/lib/db/human-adjudication-scopes.ts', { '@/lib/db/core': f.core, '@/lib/db/dm-turns': turns });
  let announcements = 0;
  Object.assign(encounterTools, { announceCurrentTurn: () => { announcements++; }, queueSkippedCombatTurn() {} });
  const lifecycle = loadSource('src/lib/dm/human-turn-lifecycle.ts', { '@/lib/db/campaigns': f.campaigns, '@/lib/db/dm-turns': turns, '@/lib/db/encounters': encounters, '@/lib/db/human-adjudication-scopes': scopes, '@/lib/dm/encounter-tools': encounterTools, '@/lib/events': f.events, '@/lib/dm/global-turn-logic': { startGlobalTurn: () => null }, '@/lib/spatial/service': { spatialEnabled: () => false } });
  const sheets = [{ id: 'pc1', slots: 3 }];
  let handler = () => ({ success: true });
  const dispatcher = {
    ASYNC_ADJUDICATIONS: new Set(['generate_image', 'search_lore', 'recall_story', 'add_companion']),
    dispatchSynchronousAdjudication: (...args) => handler(...args), dispatchAdjudication: () => { throw new Error('unexpected async path'); },
  };
  const invoke = loadSource('src/lib/dm/invoke.ts', {
    '@/lib/spatial/service': { spatialEnabled: () => false }, '@/lib/dm/fight-presence': { fightCrossing: () => null, fightForCall: () => ({}) },
    '@/lib/db/campaigns': { ...f.campaigns, getCampaignById: () => campaign, listMembers: () => [] },
    '@/lib/db/dm-turns': turns, '@/lib/db/sheets': { listSheets: () => sheets },
    '@/lib/dm/invoke-catalog': { adjudication: (name) => ({ name, fields: [] }), checkArgs: () => null },
    '@/lib/dm/invoke-dispatch': dispatcher,
    '@/lib/dm/encounter-template-logic': { parseRoster: (value) => value },
    '@/lib/dm/tool-transaction': f.transactions, '@/lib/db/human-adjudication-scopes': scopes,
    '@/lib/db/encounters': encounters, '@/lib/dm/human-turn-lifecycle': lifecycle,
    '@/lib/dm/combat-completion': { parseCompleteTurn, combatCompletionDisposition },
    '@/lib/operation-scope.mjs': operation,
  });
  return { ...f, ...invoke, ...lifecycle, campaign, turns, sheets, pending, encounters,
    setHandler: (next) => { handler = next; }, counts: () => ({ advanceCalls, enemyAttacks }), announcements: () => announcements,
    invoke: (name, args = {}) => invoke.invokeEngineSynchronous(campaign, { kind: 'human', userId: 'dm' }, { name, args }),
  };
}
for (const refusal of ['returned', 'thrown']) test(`M02: ${refusal} external refusal rolls back slots, cache, turn creation and notifications`, () => {
  const f = fixture(); const heard = [];
  const off = f.events.subscribe('c1', (chunk) => heard.push(chunk));
  f.setHandler((_name, _args, ctx) => {
    f.db.exec("UPDATE sheet_test SET slots = slots - 1 WHERE id = 'pc1'");
    ctx.sheets[0].slots--; ctx.turn.resolvedCharacterIds.push('pc1');
    f.events.publishPersisted('c1', 'sheet_updated', {});
    if (refusal === 'thrown') throw new Error('CR too high');
    return { error: 'CR too high' };
  });
  assert.deepEqual(f.invoke('cast_buff'), { ok: false, error: 'CR too high' });
  assert.equal(f.db.prepare('SELECT slots FROM sheet_test').get().slots, 3);
  assert.equal(f.sheets[0].slots, 3);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM dm_turns').get().n, 0);
  assert.equal(f.campaigns.latestSeq('c1'), 0); assert.deepEqual(heard, []);
  off(); f.close();
});

test('M02: failed dice result is a valid committed action, not an operation refusal', () => {
  const f = fixture(); f.setHandler(() => ({ success: false, total: 2 }));
  const result = f.invoke('request_roll'); assert.equal(result.ok, true);
  assert.equal(f.turns.getDmTurn(result.turnId).status, 'done'); f.close();
});

test('M02: forbidden async adjudication cannot enter a transaction or execute a handler', () => {
  const f = fixture(); f.setHandler(() => { throw new Error('should not execute'); });
  assert.equal(f.invoke('generate_image').ok, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM dm_turns').get().n, 0); f.close();
});

function start(f, held = false) {
  f.encounters.save({ id: 'enc', orderReady: true, round: 1, turnIndex: 0,
    order: ['pc1', 'pc2', 'companion'].map((characterId) => ({ kind: 'pc', characterId })) });
  const floor = { mode: 'initiative', encounterId: 'enc' };
  f.campaigns.setFloor('c1', held ? { mode: 'hold', next: floor } : floor);
  f.setHandler((name, raw, ctx) => {
    const args = JSON.parse(raw);
    if (name === 'enemy_attack') ctx.turn.actedEnemyIds.push('enemy');
    if (name === 'end_turn') {
      const enc = f.encounters.getActiveEncounter();
      if (enc.order[enc.turnIndex].characterId !== args.characterId) return { error: 'Wrong character' };
      ctx.turn.resolvedCharacterIds.push(args.characterId);
    }
    return { ok: true };
  });
}

test('M01: two rounds with two PCs and companion retain exact scope and enemy bookkeeping', () => {
  const f = fixture(); start(f);
  for (let round = 1; round <= 2; round++) {
    for (const characterId of ['pc1', 'pc2', 'companion']) {
      const attack = f.invoke('pc_attack', { characterId });
      assert.equal(attack.ok, true);
      const before = f.encounters.getActiveEncounter().turnIndex;
      if (characterId === 'pc2') assert.equal(f.invoke('enemy_attack').turnId, attack.turnId);
      const end = f.invoke('end_turn', { characterId });
      assert.equal(end.ok, true); assert.equal(end.turnId, attack.turnId);
      assert.notEqual(f.encounters.getActiveEncounter().turnIndex, before);
      assert.equal(f.invoke('end_turn', { characterId }).ok, false, 'a different current character cannot be ended twice');
    }
  }
  assert.deepEqual(f.counts(), { advanceCalls: 6, enemyAttacks: 0 });
  assert.equal(f.encounters.getActiveEncounter().round, 3);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM human_adjudication_scopes').get().n, 6);
  f.close();
});

test('M01: holding submissions preserves hold while committing one initiative transition', () => {
  const f = fixture(); start(f, true);
  assert.equal(f.invoke('end_turn', { characterId: 'pc1' }).ok, true);
  assert.equal(f.encounters.getActiveEncounter().turnIndex, 1);
  assert.equal(f.campaigns.getFloor('c1').mode, 'hold');
  assert.equal(f.counts().advanceCalls, 1); f.close();
});

test('a submitted combat turn stays nobody\'s after end_turn until the explicit handoff', () => {
  const f = fixture(); start(f);
  const gate = { encounterId: 'enc', round: 1, turnIndex: 0, characterId: 'pc1', requiresEndTurn: true, mechanicsResolved: false };
  f.campaigns.setFloor('c1', { mode: 'hold', next: { mode: 'initiative', encounterId: 'enc' }, combat: gate });
  assert.equal(f.combatHandoffState('c1').state, 'resolving');
  assert.throws(() => f.passCombatTurn(f.campaign), /not resolved yet/, 'no handoff before the DM resolves the turn');
  const attack = f.invoke('pc_attack', { characterId: 'pc1' });
  // The handler marks the gate resolved the way handleEndTurn does.
  f.setHandler((name, raw, ctx) => {
    const args = JSON.parse(raw);
    if (name === 'end_turn') {
      ctx.turn.resolvedCharacterIds.push(args.characterId);
      const floor = f.campaigns.getFloor('c1');
      f.campaigns.setFloor('c1', { ...floor, combat: { ...floor.combat, mechanicsResolved: true } });
    }
    return { ok: true };
  });
  const end = f.invoke('end_turn', { characterId: 'pc1' });
  assert.equal(end.ok, true); assert.equal(end.turnId, attack.turnId);
  assert.equal(end.result.turnHandoff, 'awaiting_pass');
  assert.equal(f.encounters.getActiveEncounter().turnIndex, 0, 'initiative does not move on end_turn');
  assert.equal(f.campaigns.getFloor('c1').mode, 'hold', 'players stay locked while the DM writes');
  assert.equal(f.counts().advanceCalls, 0);
  assert.equal(f.combatHandoffState('c1').state, 'ready');
  f.pending.push({ turnId: 'other' });
  assert.throws(() => f.passCombatTurn(f.campaign), /pending physical rolls/);
  f.pending.length = 0;
  assert.equal(f.passCombatTurn(f.campaign), true);
  assert.equal(f.counts().advanceCalls, 1);
  assert.equal(f.encounters.getActiveEncounter().turnIndex, 1);
  assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
  assert.equal(f.announcements(), 1, 'the next actor is announced once, by the handoff');
  assert.equal(f.passCombatTurn(f.campaign), false, 'nothing is held any more');
  f.close();
});

test('M01: pending physical roll prevents turn end without leaving resolved bookkeeping', () => {
  const f = fixture(); start(f);
  const attack = f.invoke('pc_attack');
  f.pending.push({ turnId: attack.turnId });
  const result = f.invoke('end_turn', { characterId: 'pc1' });
  assert.equal(result.ok, false); assert.match(result.error, /physical rolls/);
  assert.deepEqual(f.turns.getDmTurn(attack.turnId).resolvedCharacterIds, []);
  assert.equal(f.counts().advanceCalls, 0);
  f.pending.length = 0;
  assert.equal(f.invoke('end_turn', { characterId: 'pc1' }).ok, true);
  assert.equal(f.counts().advanceCalls, 1); f.close();
});
