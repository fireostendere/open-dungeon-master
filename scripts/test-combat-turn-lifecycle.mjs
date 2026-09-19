import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { loadSource, sqliteFixture } from './lib/readiness-harness.mjs';
import { validateCombatTurnIntent } from '../src/lib/dm/combat-turn-intent.ts';
import { freshBudget } from '../src/lib/dm/action-budget.ts';
import * as actionBudget from '../src/lib/dm/action-budget.ts';
import { RESOURCE_ACTIONS } from '../src/lib/dm/resource-action-cost.ts';

const encounterId = '00000000-0000-4000-8000-000000000001';
const heroId = '00000000-0000-4000-8000-000000000002';

function fixture() {
  const f = sqliteFixture();
  const campaigns = loadSource('src/lib/db/campaigns.ts', {
    '@/lib/db/core': f.core, '@/lib/db/settings': {}, '@/lib/runtime-defaults': {},
    '@/lib/schemas/game-settings': {}, '@/lib/workshop/kind': {}, '@/lib/uploads': {},
    '@/lib/dm/arc-logic': {}, '@/lib/dm/delegation': {}, '@/lib/dm/calendar': {},
    '@/lib/dm/party-logic': {}, '@/lib/dm/viewer': {},
  });
  const floorDb = { ...f.campaigns, getFloor: campaigns.getFloor, setFloor: campaigns.setFloor, canAct: campaigns.canAct, campaignSeats: () => ({}) };
  const sheets = [
    { id: heroId, userId: 'u1', name: 'First', equipment: [], resources: {}, conditions: [] },
    { id: 'other', userId: 'u2', name: 'Second', equipment: [], resources: {}, conditions: [] },
  ];
  const campaign = { id: 'c1', status: 'active', gameSettings: { dmMode: 'human', globalTurn: { enabled: true } } };
  let userId = 'u1';
  let pending = [];
  let encounter = { id: encounterId, round: 1, turnIndex: 0, orderReady: true, order: [{ kind: 'pc', characterId: heroId, userId: 'u1' }] };
  const floor = { mode: 'initiative', encounterId, userIds: ['u1'], currentName: 'First', round: 1 };
  campaigns.setFloor('c1', floor);
  const sheetDb = { getSheetForUser: (_id, uid) => sheets.find(s => s.userId === uid), listSheets: () => sheets };
  const turns = { listOpenPendingRolls: () => pending };
  const spatial = { spatialEnabled: () => false };
  const route = loadSource('src/app/api/campaigns/[campaignId]/actions/route.ts', {
    zod: { z }, '@/lib/spatial/service': spatial,
    '@/lib/ingress-budget': { enforcePlayerIngress: () => null },
    '@/lib/campaign-api': { requireVoice: async () => ({ campaign, user: { id: userId } }), isErrorResponse: () => false },
    '@/lib/db/campaigns': floorDb, '@/lib/db/messages': { ...f.messages, countMessages: () => 1, listRecentMessages: () => [] },
    '@/lib/db/sheets': sheetDb, '@/lib/dm/loop': { requestDmTurn: () => { throw new Error('No model in this test'); } },
    '@/lib/dm/delegation': { coverInEffect: () => false }, '@/lib/dm/viewer': { hasHumanDm: () => true },
    '@/lib/dm/queue': {}, '@/lib/dm/recap': {}, '@/lib/events': f.events,
    '@/lib/dm/global-turn-logic': { recordGlobalTurnAction: () => { throw new Error('Combat must bypass global turns'); } },
    '@/lib/db/encounters': { getActiveEncounter: () => encounter },
    '@/lib/db/encounter-view': { activePublicEncounter: () => ({ enemies: [] }) },
    '@/lib/dm/action-tools': { attacksAllowedFor: () => 1, budgetFor: () => freshBudget({ ownerId: heroId, round: 1 }) },
    '@/lib/dm/combat-turn-intent': { validateCombatTurnIntent },
    '@/lib/srd/condition-effects': { conditionExtraActions: () => 0 }, '@/lib/db/dm-turns': turns,
  });
  const narration = loadSource('src/lib/dm/human-narration.ts', {
    '@/lib/spatial/service': spatial, '@/lib/db/campaigns': floorDb, '@/lib/db/core': f.core,
    '@/lib/db/commit-effects': f.effects, '@/lib/db/messages': f.messages,
    '@/lib/db/dm-turns': turns, '@/lib/events': f.events,
    '@/lib/dm/encounter-tools': { queueSkippedCombatTurn() {} },
  });
  return { ...f, campaigns, floor, campaign,
    send: body => route.POST(new Request('http://localhost/actions', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ campaignId: 'c1' }) }),
    user: value => { userId = value; }, pending: value => { pending = value; }, encounter: value => { encounter = value; },
    narrate: () => narration.persistHumanNarration(campaign, 'Resolved outcome', 'dm'),
    intent: { kind: 'do', combatTurn: { encounterId, round: 1, turnIndex: 0, choices: [], prose: 'Hold position' } },
  };
}

test('combat CAS, owner admission, persistent gate, duplicate rejection and OOC', async () => {
  const f = fixture();
  try {
    f.user('u2'); assert.equal((await f.send(f.intent)).status, 409);
    assert.equal((await f.send({ ...f.intent, kind: 'ooc' })).status, 400);
    f.user('u1'); assert.equal((await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, round: 2 } })).status, 409);
    assert.equal((await f.send(f.intent)).status, 202);
    assert.equal(f.campaigns.getFloor('c1').combat.requiresEndTurn, true, 'metadata survives SQLite normalization');
    assert.equal((await f.send(f.intent)).status, 409);
    f.user('u2'); assert.equal((await f.send({ kind: 'do', content: 'interrupt' })).status, 409);
    assert.equal((await f.send({ kind: 'ooc', content: 'table talk' })).status, 202);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events WHERE type='dm_intent_queued'").get().n, 1, 'global pacing does not suppress the combat intent');
    f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'hold', 'narration alone cannot end a submitted turn');
    const held = f.campaigns.getFloor('c1');
    f.campaigns.setFloor('c1', { ...held, combat: { ...held.combat, mechanicsResolved: true } });
    f.pending([{ id: 'physical-roll' }]); f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'hold');
    f.pending([]); f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
  } finally { f.close(); }
});

test('legacy combat prose unlocks after narration; victory still waits for narration', async () => {
  const f = fixture();
  try {
    assert.equal((await f.send({ kind: 'do', content: 'I speak while fighting' })).status, 202);
    f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
    assert.equal((await f.send(f.intent)).status, 202);
    const held = f.campaigns.getFloor('c1');
    f.encounter(null);
    f.campaigns.setFloor('c1', { ...held, next: { mode: 'open' }, combat: { ...held.combat, mechanicsResolved: true } });
    assert.equal((await f.send({ kind: 'do', content: 'loot before narration' })).status, 409);
    f.narrate(); assert.deepEqual(f.campaigns.getFloor('c1'), { mode: 'open' });
  } finally { f.close(); }
});

test('Skip N queues one normal turn per arrival, never advances enemies or decrements twice', () => {
  const f = fixture();
  try {
    let remaining = 2;
    let wakes = 0;
    const encounter = { id: encounterId, round: 1, turnIndex: 0, orderReady: true, order: [{ kind: 'pc', characterId: heroId, userId: 'u1', name: 'First' }] };
    const tools = loadSource('src/lib/dm/encounter-tools.ts', {
      zod: { z }, '@/lib/spatial/service': { spatialEnabled: () => false }, '@/lib/db/campaigns': { ...f.campaigns,
        getCampaignById: () => f.campaign, allocateSeq: f.campaigns.allocateSeq,
        getMember: () => ({ userId: 'u1', skipTurnsCount: remaining }),
        setMemberSkipTurns: (_c, _u, count) => { remaining = count; return { userId: 'u1', skipTurnsCount: count }; },
      },
      '@/lib/db/encounters': { getActiveEncounter: () => encounter },
      '@/lib/db/sheets': {}, '@/lib/db/rolls': {}, '@/lib/db/messages': f.messages,
      '@/lib/db/dm-turns': { listOpenPendingRolls: () => [] }, '@/lib/dice': {}, '@/lib/events': f.events,
      '@/lib/srd': {}, '@/lib/srd/encounter-math': {}, '@/lib/bestiary': {}, '@/lib/bestiary/synthesize': {},
      '@/lib/dm/encounter-spawn': { enemyRequestSchema: z.any() }, '@/lib/bestiary/health': {},
      '@/lib/dm/encounter-logic': {}, '@/lib/dm/mutations': {}, '@/lib/dm/ambience-tools': {},
      '@/lib/dm/map-tools': {}, '@/lib/dm/enemy-damage': {},
      '@/lib/dm/encounter-tools-extra': { EXTRA_ENCOUNTER_TOOL_NAMES: [], extraEncounterTools: [] },
      '@/lib/dm/pc-attack': {}, '@/lib/db/users': {}, '@/lib/dm/wake': { wakeDm: () => { wakes++; } },
      '@/lib/dm/effect-tools': {}, '@/lib/dm/effects-logic': {}, '@/lib/dm/rolls': {},
      '@/lib/dm/arg-coerce': {}, '@/lib/dm/cast-tools': {},
      '@/lib/dm/action-tools': { ACTION_TOOL_NAMES: [], actionTools: [] },
      '@/lib/dm/condition-logic': {}, '@/lib/dm/condition-tick': {}, '@/lib/dm/death': {}, '@/lib/db/battle-maps': {},
    });
    assert.equal(tools.skipOwnTurn('c1', 'u2'), false);
    assert.equal(remaining, 2);
    tools.queueSkippedCombatTurn('c1');
    assert.equal(remaining, 1); assert.equal(wakes, 1);
    assert.equal(encounter.turnIndex, 0, 'skip is adjudicated by normal end_turn, not a pointer shortcut');
    assert.equal(f.campaigns.getFloor('c1').combat.mechanicsResolved, false);
    tools.queueSkippedCombatTurn('c1'); assert.equal(remaining, 1, 'pending intent is not queued twice');
    const held = f.campaigns.getFloor('c1');
    f.campaigns.setFloor('c1', { ...held, next: { ...f.floor, userIds: ['u2'] }, combat: { ...held.combat, mechanicsResolved: true } });
    f.narrate(); tools.queueSkippedCombatTurn('c1'); assert.equal(remaining, 1, 'other player still owns their turn');
    encounter.round++;
    f.campaigns.setFloor('c1', { ...f.floor, round: 2 });
    tools.queueSkippedCombatTurn('c1'); assert.equal(remaining, 0); assert.equal(wakes, 2);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events WHERE type='dm_intent_queued'").get().n, 2);
  } finally { f.close(); }
});

test('actual resource mutation spends shared action economy before any effect or dice', () => {
  const sheet = { id: heroId, name: 'First', conditions: [] };
  const encounter = { id: encounterId, orderReady: true, round: 1, turnIndex: 0, order: [{ kind: 'pc', characterId: heroId }], turnBudget: null };
  let effects = 0;
  const compute = () => { effects++; return { patch: {}, result: { ok: true } }; };
  const mutation = loadSource('src/lib/dm/mutations.ts', {
    zod: { z }, '@/lib/db/sheets': { getSheetById: () => sheet, patchSheet: () => sheet },
    '@/lib/db/sheet-audit': { insertSheetAudit: () => ({}) }, '@/lib/db/character-events': {},
    '@/lib/db/campaigns': { allocateSeq: () => 1 }, '@/lib/content': {}, '@/lib/srd': {},
    '@/lib/srd/class-resources': { matchResource: name => ({ id: name }) },
    '@/lib/db/encounters': { getActiveEncounter: () => encounter, saveEncounter() {} },
    '@/lib/dm/action-budget': actionBudget, '@/lib/dm/resource-action-cost': { RESOURCE_ACTIONS },
    '@/lib/srd/feature-effects': { combatRiders: () => ({ extraAttacks: 1 }) },
    '@/lib/srd/condition-effects': { conditionExtraActions: () => 0 }, '@/lib/events': { publishPersisted() {} },
    '@/lib/schemas/sheet': { fullPatchSheetSchema: { pick: () => z.any() } },
    '@/lib/dm/mutation-math': {}, '@/lib/srd/currency': {}, '@/lib/dm/death': {},
    '@/lib/dm/companion-tools': {}, '@/lib/dm/condition-logic': {},
    '@/lib/dm/arg-coerce': { normalizeAbility: value => value, normalizeListAction: value => value },
    '@/lib/dm/concentration': {}, '@/lib/dm/resource-tools': { resourceTools: [], computeUseItem: compute, computeUseResource: compute },
    '@/lib/content/mechanics': {}, '@/lib/classes': {}, '@/lib/db/rolls': {}, '@/lib/dice': {},
  });
  const invoke = (name, args) => mutation.applyDmMutation({ id: 'c1' }, 'turn', name, JSON.stringify({ characterId: heroId, ...args }), [sheet], new Map([[heroId, sheet]])).result;
  assert.equal(invoke('use_resource', { resource: 'second_wind' }).ok, true);
  assert.equal(encounter.turnBudget.bonusUsed, true);
  assert.equal(encounter.turnBudget.attacksAllowed, 2);
  assert.match(invoke('use_resource', { resource: 'rage' }).error, /bonus action/);
  assert.equal(effects, 1, 'a refused bonus action cannot roll or spend a class resource');
  assert.equal(invoke('use_item', { item: 'Potion of Healing' }).ok, true);
  assert.equal(encounter.turnBudget.actionUsed, true);
  assert.match(invoke('use_item', { item: 'Potion of Healing' }).error, /action/);
  assert.equal(effects, 2, 'a refused item cannot roll or consume inventory');
});
