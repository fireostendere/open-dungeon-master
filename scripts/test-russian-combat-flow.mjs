// Focused regressions; no model/provider calls. Uses the real façade/lifecycle
// source with mocked DB/rules dependencies, not a reimplementation of the façade.
// Run: node --experimental-vm-modules scripts/test-russian-combat-flow.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { inferScope, shouldSearchArchive, parseAskJson } from '../src/lib/dm/ask-logic.ts';
import { parseCompleteTurn, sameCombatTurn, combatCompletionDisposition } from '../src/lib/dm/combat-completion.ts';
import { normalizeEncounterSnapshot } from '../narrator/encounter-state.mjs';
import { readNarratorSnapshot } from '../narrator/read-session.mjs';
import { startAskWorker, driveNarratorCycle } from '../narrator/poll-cycle.mjs';

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
const plain = value => JSON.parse(JSON.stringify(value));

for (const [question, expected] of [
  ['Как работает атака по возможности?', 'rules'],
  ['Что значит преимущество?', 'rules'],
  ['Как работает концентрация?', 'rules'],
  ['Что даёт короткий отдых?', 'rules'],
  ['Сколько у меня осталось ячеек заклинаний?', 'sheet'],
  ['Мастер, могу ли я ещё атаковать?', 'sheet'],
  ['Как работает моя Скрытая атака?', 'sheet'],
  ['Моё бонусное действие доступно?', 'sheet'],
  ['Кто был в трактире?', 'story'],
  ['Что видно за дверью?', 'story'],
  ['how does grappling work?', 'rules'],
  ['what is my AC?', 'sheet'],
  ['who owns the mill?', 'story'],
]) await test(`Ask scope: ${question}`, () => assert.equal(inferScope(question), expected));

await test('Russian rule questions avoid unrelated archive retrieval', () => {
  assert.equal(shouldSearchArchive('Как работает атака по возможности?'), false);
  assert.equal(shouldSearchArchive('Сколько у меня осталось ячеек заклинаний?'), false);
  assert.equal(shouldSearchArchive('Что обещал Артемий?'), true);
  assert.equal(shouldSearchArchive('Расскажи про Марлу'), true);
  assert.equal(shouldSearchArchive('как работает захват', true), true);
  assert.equal(parseAskJson('{"answer":"Да, можешь.","citations":[]}').answer, 'Да, можешь.');
});

await test('Completion is opt-in, boolean, scoped and backwards-compatible', () => {
  assert.deepEqual(parseCompleteTurn('pc_attack', undefined, 'human'), { ok: true, requested: false });
  assert.deepEqual(parseCompleteTurn('pc_attack', false, 'human'), { ok: true, requested: false });
  assert.deepEqual(parseCompleteTurn('pc_attack', true, 'human'), { ok: true, requested: true });
  assert.equal(parseCompleteTurn('cast_at_enemy', true, 'human').ok, true);
  for (const value of ['true', 1, null, {}]) assert.equal(parseCompleteTurn('pc_attack', value, 'human').ok, false);
  assert.equal(parseCompleteTurn('enemy_attack', true, 'human').ok, false);
  assert.equal(parseCompleteTurn('pc_attack', true, 'ai').ok, false);
});
const key = { encounterId: 'enc', round: 2, turnIndex: 0, characterId: 'pc-a' };
await test('Completion never skips a pending roll or a changed combatant', () => {
  assert.equal(sameCombatTurn(key, { ...key }), true);
  assert.equal(combatCompletionDisposition(key, key, 0), 'complete');
  assert.equal(combatCompletionDisposition(key, key, 1), 'awaiting_rolls');
  for (const after of [null, { ...key, encounterId: 'other' }, { ...key, round: 3 },
    { ...key, turnIndex: 1 }, { ...key, characterId: 'pc-b' }]) {
    assert.equal(sameCombatTurn(key, after), false);
    assert.equal(combatCompletionDisposition(key, after, 0), 'already_advanced');
  }
  assert.throws(() => combatCompletionDisposition(key, key, -1));
});

const wireSnapshot = () => ({
  campaign: { id: 'campaign', dmUserId: 'dm' }, currentSeq: 7, nextCursor: 7,
  timelineEpoch: 'epoch', hasMore: false, messages: [], events: [],
  encounter: { encounter: { id: 'enc', status: 'active', kind: 'fight', orderReady: true }, enemies: [{ id: 'enemy' }] },
});
await test('Nested and legacy combat reads preserve the wire object', () => {
  const wire = wireSnapshot();
  const saved = JSON.stringify(wire);
  const view = normalizeEncounterSnapshot(wire);
  assert.equal(view.encounter.orderReady, true);
  assert.equal(view.encounter.status, 'active');
  assert.equal(view.encounter.kind, 'fight');
  assert.deepEqual(view.encounter.enemies, wire.encounter.enemies);
  assert.equal(JSON.stringify(wire), saved);
  const flat = { encounter: { orderReady: true, status: 'active', kind: 'fight' } };
  assert.equal(normalizeEncounterSnapshot(flat), flat);
  assert.equal(normalizeEncounterSnapshot({ encounter: null }).encounter, null);
  assert.equal(normalizeEncounterSnapshot({ encounter: { encounter: null, enemies: [] } }).encounter, null);
});
await test('Real readSnapshot normalizes only after page integrity succeeds', async () => {
  const wire = wireSnapshot();
  const shape = Object.fromEntries(Object.entries(wire).map(([name, value]) => [name, Array.isArray(value) ? 'array' : 'value']));
  const entries = Object.entries(wire).flatMap(([key, value]) => Array.isArray(value)
    ? value.map((item, index) => ({ key, index, value: item })) : [{ key, value }]);
  const page = { format: 'odm.read.page.v1', hash: crypto.createHash('sha256').update(JSON.stringify(wire)).digest('hex'),
    shape, entries, offset: 0, complete: true };
  const host = { readPageRetries: 0, readMaxBytes: 65536, deltaReads: false, callControl: async () => structuredClone(page) };
  const view = await readNarratorSnapshot(host, { campaignId: 'campaign', projection: 'live' });
  assert.equal(view.encounter.orderReady, true);
  assert.equal(wire.encounter.orderReady, undefined);
  page.hash = '0'.repeat(64);
  await assert.rejects(() => readNarratorSnapshot(host, { campaignId: 'campaign' }), /integrity/);
  host.callControl = async () => wireSnapshot();
  assert.equal((await readNarratorSnapshot(host, { campaignId: 'campaign' })).encounter.orderReady, true);
});

function askHost() {
  const calls = [], handled = [];
  const host = {
    campaignId: 'campaign', timelineEpoch: 'epoch', askResponder: true,
    pendingAskCommands: new Map(), pendingAskAttempts: new Map(), answeredAsks: new Set(),
    readPageRetries: 0, readMaxBytes: 65536, deltaReads: false, pollIntervalMs: 1000,
    callControl: async (name, params) => {
      calls.push({ name, params });
      return { campaign: { id: 'campaign' }, currentSeq: 7, nextCursor: 7, timelineEpoch: 'epoch',
        asks: [{ id: 'ask-1', question: 'Мастер, могу я атаковать?', visibility: 'private' }],
        askQueue: { pending: true, hasMore: false } };
    },
    handlePendingAsk: async ask => { handled.push(ask); host.answeredAsks.add(ask.id); },
  };
  return { host, calls, handled };
}
const storyOnly = { currentSeq: 7, askQueue: { pending: false } };
await test('Private Ask is polled even when story-only metadata says pending:false', async () => {
  const { host, calls, handled } = askHost();
  const task = startAskWorker(host, storyOnly);
  assert.equal(startAskWorker(host, storyOnly), task, 'only one worker');
  await task;
  assert.equal(host.askError, null);
  assert.equal(handled.length, 1);
  assert.equal(calls[0].params.includeAsks, true);
  assert.equal(calls[0].params.afterAskSeq, 0);
  assert.equal(host.lastSeq, undefined, 'Ask must not advance the story cursor');
  host.nextAskPollAt = Number.MAX_SAFE_INTEGER;
  assert.equal(startAskWorker(host, storyOnly), null, 'zero-delay mechanics ticks must not spam Ask reads');
});
await test('Private Ask latency does not block the story controller', async () => {
  const { host } = askHost();
  let release;
  host.handlePendingAsk = () => new Promise(resolve => { release = resolve; });
  host.drainStory = async () => storyOnly;
  let storyCalls = 0;
  host.storyController = { tick: async (_host, snapshot) => { storyCalls++; assert.equal(snapshot, storyOnly); return true; } };
  await driveNarratorCycle(host);
  assert.equal(storyCalls, 1);
  assert.equal(host.madeProgress, true);
  await new Promise(resolve => setImmediate(resolve));
  release?.();
  await host.askTask;
});

// Execute the actual TypeScript façade and lifecycle with deterministic test
// dependencies. The rules/DB mocks below let failures and pending dice be forced
// without generating random rolls, contacting a provider or touching live data.
if (typeof vm.SourceTextModule !== 'function') throw new Error('Run with --experimental-vm-modules');
let state, calls;
const campaign = { id: 'campaign', gameSettings: { dicePolicy: 'server' } };
function reset(options = {}) {
  state = {
    encounter: { id: 'enc', orderReady: true, round: 1, turnIndex: 0,
      order: [{ kind: 'pc', characterId: 'pc-a' }, { kind: 'pc', characterId: 'pc-b' }] },
    floor: { mode: 'hold', next: { mode: 'initiative', encounterId: 'enc', round: 1 },
      combat: { encounterId: 'enc', round: 1, turnIndex: 0, characterId: 'pc-a', requiresEndTurn: true, mechanicsResolved: false } },
    pending: [], turn: { id: 'dm-turn', campaignId: 'campaign', actor: 'human_dm', status: 'done', resolvedCharacterIds: [] },
    damage: 0, ...options,
  };
  calls = [];
}
const context = vm.createContext({ console, Map, Set, JSON });
const mocks = {
  '@/lib/db/campaigns': {
    getCampaignById: () => campaign, getFloor: () => structuredClone(state.floor),
    setFloor: (_id, floor) => { state.floor = structuredClone(floor); }, listMembers: () => [],
  },
  '@/lib/db/dm-turns': {
    createDmTurn: () => structuredClone(state.turn), getDmTurn: () => structuredClone(state.turn),
    saveDmTurn: turn => { state.turn = structuredClone(turn); }, listOpenPendingRolls: () => state.pending,
  },
  '@/lib/db/sheets': { getSheetById: () => null, listSheets: () => [{ id: 'pc-a', userId: 'a' }, { id: 'pc-b', userId: 'b' }] },
  '@/lib/spatial/publication-scope.mjs': { currentEncounterRoom: () => undefined, withEncounterRoom: (_id, _room, work) => work(), withFight: (_id, _fight, work) => work() },
  '@/lib/spatial/service': { spatialEnabled: () => false, spatialContext: () => ({}), spatialStore: () => ({}) },
  '@/lib/dm/fight-presence': { atFight: () => true, joinFight() {}, placeArrivingHero() {}, fightPlaceName: () => "here", syncFightBoards: () => ({ notes: [], leftOnTheirTurn: [], arrivals: [] }), fightCrossing: () => null, fightForCall: () => ({}) }, '@/lib/db/overworld': { partyStanding: () => ({}), getOverworldPartyPositions: () => [] },
  '@/lib/db/encounters': { getActiveEncounter: () => state.encounter },
  '@/lib/db/human-adjudication-scopes': { scopedHumanTurn: () => structuredClone(state.turn) },
  '@/lib/dm/invoke-catalog': {
    adjudication: name => ['pc_attack', 'cast_at_enemy', 'end_turn'].includes(name) ? { name, fields: [] } : null,
    checkArgs: (_entry, args) => typeof args.characterId === 'string' ? null : 'characterId required',
  },
  '@/lib/dm/invoke-dispatch': {
    ASYNC_ADJUDICATIONS: new Set(), dispatchAdjudication: () => { throw new Error('unexpected async path'); },
    dispatchSynchronousAdjudication: (name, raw, { turn }) => {
      const args = JSON.parse(raw);
      calls.push({ name, args });
      if (name === 'end_turn') {
        if (state.blockEnd) return { error: 'test finalizer blocked' };
        turn.resolvedCharacterIds.push(args.characterId);
        state.floor.combat.mechanicsResolved = true;
        return { ok: true };
      }
      if (state.failAttack) return { error: 'test illegal attack' };
      state.damage += 3;
      if (state.physical) state.pending.push({ id: 'roll', turnId: 'dm-turn' });
      if (state.endsEncounter) state.encounter = null;
      if (state.movesActor) state.encounter.turnIndex = 1;
      return { ok: true, hit: true, damage: 3 };
    },
  },
  '@/lib/dm/tool-transaction': {
    executeDmTool: (_objects, work) => {
      const before = structuredClone(state);
      try {
        const result = work();
        if (result?.ok === false || result && Object.hasOwn(result, 'error')) state = before;
        return result;
      } catch (error) { state = before; throw error; }
    },
  },
  '@/lib/dm/encounter-tools': {
    advanceAfterTurn: () => {
      if (state.throwAdvance) throw new Error('test advancement failure');
      state.encounter.turnIndex++;
      state.floor = { mode: 'initiative', encounterId: 'enc', round: 1 };
    },
    announceCurrentTurn: () => { calls.push({ name: 'announce' }); },
    queueSkippedCombatTurn: () => {},
  },
  '@/lib/events': { publishPersisted: () => {} },
  '@/lib/operation-scope.mjs': { currentOperationSignal: () => undefined },
  '@/lib/dm/encounter-template-logic': { parseRoster: () => [] },
  '@/lib/dm/combat-completion': { parseCompleteTurn, combatCompletionDisposition },
};
const modules = new Map();
function sourceModule(relative) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  return new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'strip' }), { context, identifier: relative });
}
const lifecycle = sourceModule('../src/lib/dm/human-turn-lifecycle.ts');
modules.set('@/lib/dm/human-turn-lifecycle', lifecycle);
async function link(specifier) {
  if (modules.has(specifier)) return modules.get(specifier);
  const values = mocks[specifier];
  if (!values) throw new Error(`Unmocked dependency: ${specifier}`);
  const record = new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context, identifier: specifier });
  modules.set(specifier, record);
  return record;
}
await lifecycle.link(link);
await lifecycle.evaluate();
const facade = sourceModule('../src/lib/dm/invoke.ts');
await facade.link(link);
await facade.evaluate();
const invoke = (args = {}, name = 'pc_attack') => facade.namespace.invokeEngineSynchronous(
  campaign, { kind: 'human', userId: 'dm' }, { name, args: { characterId: 'pc-a', targetEnemyId: 'enemy', ...args } });

await test('Final simple attack resolves and closes exactly once in one façade call', () => {
  reset();
  const result = invoke({ completeTurn: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.turnCompletion.status, 'completed');
  assert.deepEqual(calls.map(call => call.name), ['pc_attack', 'end_turn']);
  assert.equal(Object.hasOwn(calls[0].args, 'completeTurn'), false, 'do not leak façade flags into rules handlers');
  assert.equal(state.damage, 3);
  assert.equal(state.encounter.turnIndex, 0, 'resolved, but initiative waits for the handoff');
  assert.equal(state.floor.combat.mechanicsResolved, true);
  assert.equal(result.result.turnCompletion.result.turnHandoff, 'awaiting_pass');
  assert.equal(lifecycle.namespace.passCombatTurn(campaign), true);
  assert.equal(state.encounter.turnIndex, 1);
  assert.equal(state.floor.mode, 'initiative');
  assert.deepEqual(calls.map(call => call.name), ['pc_attack', 'end_turn', 'announce']);
});
await test('Legacy/partial attacks keep the same actor for further declared actions', () => {
  reset();
  const result = invoke();
  assert.equal(result.ok, true);
  assert.equal(result.result.turnCompletion, undefined);
  assert.equal(state.encounter.turnIndex, 0);
  assert.deepEqual(calls.map(call => call.name), ['pc_attack']);
});
await test('Two declared attacks close only on the final attack', () => {
  reset();
  invoke({ completeTurn: false });
  assert.equal(state.encounter.turnIndex, 0);
  const result = invoke({ completeTurn: true });
  assert.equal(result.result.turnCompletion.status, 'completed');
  assert.deepEqual(calls.map(call => call.name), ['pc_attack', 'pc_attack', 'end_turn']);
  assert.equal(state.damage, 6);
});
await test('Physical attack keeps the original pending-roll continuation', () => {
  reset({ physical: true });
  const result = invoke({ completeTurn: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.turnCompletion.status, 'awaiting_rolls');
  assert.equal(state.encounter.turnIndex, 0);
  assert.equal(state.turn.status, 'awaiting_rolls');
  assert.deepEqual(calls.map(call => call.name), ['pc_attack']);
});
await test('Outstanding rolls and wrong actors are rejected before effects', () => {
  reset({ pending: [{ id: 'old-roll', turnId: 'dm-turn' }] });
  assert.equal(invoke({ completeTurn: true }).ok, false);
  assert.equal(calls.length, 0);
  reset();
  assert.equal(invoke({ characterId: 'pc-b', completeTurn: true }).ok, false);
  assert.equal(calls.length, 0);
  reset(); state.encounter.orderReady = false;
  assert.equal(invoke({ completeTurn: true }).ok, false);
  assert.equal(calls.length, 0);
});
await test('A refused attack never advances initiative', () => {
  reset({ failAttack: true });
  assert.equal(invoke({ completeTurn: true }).ok, false);
  assert.equal(state.damage, 0);
  assert.equal(state.encounter.turnIndex, 0);
  assert.deepEqual(calls.map(call => call.name), ['pc_attack']);
});
await test('A failed handoff leaves the table held and the turn resolved', () => {
  reset({ throwAdvance: true });
  const result = invoke({ completeTurn: true });
  assert.equal(result.result.turnCompletion.status, 'completed', 'end_turn itself no longer moves initiative');
  assert.throws(() => lifecycle.namespace.passCombatTurn(campaign), /test advancement failure/);
  assert.equal(state.encounter.turnIndex, 0);
});
for (const option of ['blockEnd']) await test(`${option}: keep the confirmed attack, not a reroll`, () => {
  reset({ [option]: true });
  const result = invoke({ completeTurn: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.turnCompletion.status, 'blocked');
  assert.equal(state.damage, 3);
  assert.equal(state.encounter.turnIndex, 0);
  assert.equal(state.floor.combat.mechanicsResolved, false);
  assert.deepEqual(calls.map(call => call.name), ['pc_attack', 'end_turn']);
});
for (const option of ['endsEncounter', 'movesActor']) await test(`${option}: never finish the next actor`, () => {
  reset({ [option]: true });
  const result = invoke({ completeTurn: true });
  assert.equal(result.ok, true);
  assert.equal(result.result.turnCompletion.status, 'already_advanced');
  assert.deepEqual(calls.map(call => call.name), ['pc_attack']);
  assert.equal(state.damage, 3);
});
await test('Spell attack uses the same final-action completion path', () => {
  reset();
  const result = invoke({ completeTurn: true }, 'cast_at_enemy');
  assert.equal(result.result.turnCompletion.status, 'completed');
  assert.deepEqual(calls.map(call => call.name), ['cast_at_enemy', 'end_turn']);
});

await test('Compound turn parks at its first physical roll without starting later actions', () => {
  reset({ physical: true });
  const result = invoke({ steps: [{ name: 'pc_attack', args: { targetEnemyId: 'enemy' } }, { name: 'pc_attack', args: { targetEnemyId: 'enemy' } }] }, 'combat_turn');
  assert.equal(result.ok, true);
  assert.equal(result.result.status, 'awaiting_rolls');
  assert.equal(result.result.nextStep, 1);
  assert.deepEqual(calls.map(call => call.name), ['pc_attack']);
  assert.equal(state.encounter.turnIndex, 0);
});
await test('Compound turn rejects nested completion and another character before dice', () => {
  reset();
  for (const args of [{ characterId: 'pc-b' }, { completeTurn: true }]) {
    assert.equal(invoke({ steps: [{ name: 'pc_attack', args }] }, 'combat_turn').ok, false);
    assert.equal(calls.length, 0);
  }
});

console.log(`test-russian-combat-flow: ${passed} tests passed; provider/gameplay quality is not evaluated by these deterministic tests.`);
