import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { z } from 'zod';
import { loadSource, sqliteFixture } from './lib/readiness-harness.mjs';
import { freshBudget } from '../src/lib/dm/action-budget.ts';
import * as actionBudget from '../src/lib/dm/action-budget.ts';
import { RESOURCE_ACTIONS } from '../src/lib/dm/resource-action-cost.ts';

register('./lib/register-alias.mjs', import.meta.url);
const { combatSpellNames, validateCombatTurnIntent } = await import('../src/lib/dm/combat-turn-intent.ts');

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
  const floorDb = { ...f.campaigns, getFloor: campaigns.getFloor, setFloor: campaigns.setFloor, canAct: campaigns.canAct, getGlobalTurnState: () => ({ phase: 'active' }), campaignSeats: () => ({}), listMembers: () => [{ userId, autopilot: false }] };
  const sheets = [
    { id: heroId, userId: 'u1', name: 'First', equipment: [], resources: {}, conditions: [] },
    { id: 'other', userId: 'u2', name: 'Second', equipment: [], resources: {}, conditions: [] },
  ];
  const campaign = { id: 'c1', status: 'active', gameSettings: { dmMode: 'human', globalTurn: { enabled: true } } };
  let userId = 'u1';
  let pending = [];
  let visibleEnemies = [];
  let encounter = { id: encounterId, round: 1, turnIndex: 0, orderReady: true, order: [{ kind: 'pc', characterId: heroId, userId: 'u1' }] };
  const floor = { mode: 'initiative', encounterId, userIds: ['u1'], currentName: 'First', round: 1 };
  campaigns.setFloor('c1', floor);
  const sheetDb = { getSheetForUser: (_id, uid) => sheets.find(s => s.userId === uid), listSheets: () => sheets };
  const turns = { listOpenPendingRolls: () => pending };
  const spatial = { spatialEnabled: () => false };
  const route = loadSource('src/app/api/campaigns/[campaignId]/actions/route.ts', {
    zod: { z }, '@/lib/spatial/service': spatial,
    '@/lib/db/core': f.core, '@/lib/db/commit-effects': f.effects,
    '@/lib/i18n/locale-text': { localeText: (locale, values) => values[locale] },
    '@/lib/ingress-budget': { enforcePlayerIngress: () => null },
    '@/lib/campaign-api': { requireMember: async () => ({ campaign, user: { id: userId } }), requireVoice: async () => ({ campaign, user: { id: userId } }), isErrorResponse: () => false },
    '@/lib/db/campaigns': floorDb, '@/lib/db/messages': { ...f.messages, countMessages: () => 1, listRecentMessages: () => [] },
    '@/lib/db/sheets': sheetDb, '@/lib/dm/loop': { requestDmTurn: () => { throw new Error('No model in this test'); } },
    '@/lib/dm/delegation': { coverInEffect: () => false }, '@/lib/dm/viewer': { hasHumanDm: () => true },
    '@/lib/dm/queue': {}, '@/lib/dm/recap': {}, '@/lib/events': f.events,
    '@/lib/dm/global-turn-logic': { recordGlobalTurnAction: () => { if (encounter) throw new Error('Combat must bypass global turns'); return { allowed: true }; } },
    '@/lib/db/encounters': { getActiveEncounter: () => encounter },
    '@/lib/db/encounter-view': { activePublicEncounter: () => ({ enemies: visibleEnemies }) },
    '@/lib/dm/action-tools': { attacksAllowedFor: () => 1, budgetFor: () => freshBudget({ ownerId: heroId, round: 1 }) },
    '@/lib/dm/combat-turn-intent': { combatSpellNames, validateCombatTurnIntent },
     '@/lib/content': {
       findSpellByName: name => name === 'Eldritch Blast' ? { level: 0, data: { casting_time: '1 action' } } : name === 'Hex' ? { level: 1, data: { casting_time: '1 bonus action' } } : null,
       spellMechanicsFor: ({ spell }) => spell === 'Eldritch Blast' ? { mech: { resolution: 'attack' } } : spell === 'Hex' ? { mech: { resolution: 'buff', buff: { target: 'ally' } } } : null,
     },
    '@/lib/srd/spell-mechanics': { authoredSpellRow: () => null },
    '@/lib/srd/condition-effects': { conditionExtraActions: () => 0 }, '@/lib/db/dm-turns': turns,
  });
  // The handoff moves initiative; this fixture's engine stand-in wraps the
  // one-hero order into the next round and keeps whoever the floor names.
  const lifecycle = loadSource('src/lib/dm/human-turn-lifecycle.ts', {
    '@/lib/db/campaigns': floorDb, '@/lib/db/encounters': { getActiveEncounter: () => encounter },
    '@/lib/db/dm-turns': { ...turns, saveDmTurn() {} },
    '@/lib/db/human-adjudication-scopes': { scopedHumanTurn: () => ({ resolvedCharacterIds: [] }) },
    '@/lib/dm/encounter-tools': {
      advanceAfterTurn() {
        encounter = { ...encounter, round: encounter.round + 1 };
        campaigns.setFloor('c1', { ...campaigns.getFloor('c1'), round: encounter.round });
      },
      announceCurrentTurn() {}, queueSkippedCombatTurn() {},
    },
    '@/lib/events': f.events,
  });
  const narration = loadSource('src/lib/dm/human-narration.ts', {
    '@/lib/spatial/service': spatial, '@/lib/db/campaigns': floorDb, '@/lib/db/core': f.core,
    '@/lib/db/commit-effects': f.effects, '@/lib/db/messages': f.messages,
    '@/lib/db/dm-turns': turns, '@/lib/events': f.events,
    '@/lib/dm/encounter-tools': { queueSkippedCombatTurn() {} },
    '@/lib/dm/human-turn-lifecycle': lifecycle,
  });
  return { ...f, campaigns, floor, campaign, sheets,
    options: () => route.GET(new Request('http://localhost/actions'), { params: Promise.resolve({ campaignId: 'c1' }) }),
    send: body => route.POST(new Request('http://localhost/actions', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ campaignId: 'c1' }) }),
     user: value => { userId = value; }, pending: value => { pending = value; }, encounter: value => { encounter = value; }, enemies: value => { visibleEnemies = value; },
    narrate: () => narration.persistHumanNarration(campaign, 'Resolved outcome', 'dm'),
     intent: { kind: 'do', combatTurn: { encounterId, round: 1, turnIndex: 0, choices: [] } },
  };
}

test('warlock spell and direct pet order survive the real action route without spending resources', async () => {
  const f = fixture();
  try {
    const hero = f.sheets[0];
    const targetEnemyId = '00000000-0000-4000-8000-000000000099';
    f.enemies([{ id: targetEnemyId, name: 'Training target', status: 'alive' }]);
    hero.spellcasting = { known: ['Eldritch Blast', 'Hex'], prepared: ['Eldritch Blast'], slots: { 2: { max: 2, used: 2 } } };
    hero.pets = [{ name: 'Федя', kind: 'familiar', hp: 7, attacks: [] }];
    hero.features = [{ name: 'Pact of the Chain' }];
    const options = await (await f.options()).json();
    assert.deepEqual(options.spells.map(spell => spell.name), ['Eldritch Blast', 'Hex']);
    assert.equal(options.spells[0].level, 0);
    assert.equal(options.spells[1].cost, 'bonus');
    f.user('u2'); assert.deepEqual((await (await f.options()).json()).spells, [], 'another member never gets the warlock list');
    f.user('u1');
    const send = choices => f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, choices } });
    assert.equal((await send([{ type: 'spell', spell: 'Fireball' }])).status, 400);
    assert.equal((await send([{ type: 'spell', spell: 'Hex', slotLevel: 2 }])).status, 400);
    assert.equal((await send([{ type: 'pet_order', petName: 'Not mine', order: 'Scout' }])).status, 400);
    assert.equal((await send([{ type: 'feature', feature: 'Invented' }])).status, 400);
    assert.equal(f.campaigns.getFloor('c1').mode, 'initiative', 'invalid choices never hold the turn');
    const choices = [{ type: 'spell', spell: 'Eldritch Blast', targetId: targetEnemyId }, { type: 'pet_order', petName: 'Федя', order: 'Стань невидимым' }];
    const response = await send(choices);
    assert.equal(response.status, 202, await response.clone().text());
    const message = f.db.prepare('SELECT content FROM campaign_messages').get();
    assert.match(message.content, /Заклинание: Eldritch Blast/);
    assert.match(message.content, /Приказ: Федя — Стань невидимым/);
    assert.match(message.content, /стоимость и эффект определяются правилами/);
    assert.equal(hero.spellcasting.slots[2].used, 2);
    assert.equal(f.campaigns.getFloor('c1').combat.mechanicsResolved, false);
    assert.equal(f.campaigns.getFloor('c1').combat.submissionMessageId, (await response.json()).messageId);
  } finally { f.close(); }
});

test('raw text and legacy combat prose are rejected during initiative', async () => {
  const f = fixture();
  try {
    f.sheets[0].features = [{ name: 'Sneak Attack' }];
    assert.equal((await f.send({ kind: 'do', content: 'Тычу кинжалом в дьявола!' })).status, 400);
    assert.equal((await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, prose: 'Тычу кинжалом в дьявола!' } })).status, 400);
    assert.equal((await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, choices: [], description: 'Атакую!' } })).status, 400, 'description alone cannot bypass the builder');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_messages').get().n, 0);
    assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
  } finally { f.close(); }
});

test('optional combat description accompanies selected actions without replacing them', async () => {
  const f = fixture();
  try {
    const targetEnemyId = '00000000-0000-4000-8000-000000000099';
    f.enemies([{ id: targetEnemyId, name: 'Dummy', status: 'alive' }]);
    f.sheets[0].equipment = [{ name: 'Longsword', qty: 1 }];
    const choice = { type: 'attack', targetEnemyId, weapon: 'Longsword' };
    const turn = { ...f.intent.combatTurn, choices: [choice], description: '  Кричу: Держитесь!  ' };
    assert.equal((await f.send({ kind: 'do', combatTurn: { ...turn, description: 'x'.repeat(2001) } })).status, 400);
    assert.equal((await f.send({ kind: 'do', combatTurn: turn, content: 'Вторая атака' })).status, 400, 'top-level combat text stays forbidden');
    assert.equal((await f.send({ kind: 'do', combatTurn: turn })).status, 202);
    const message = f.db.prepare('SELECT content FROM campaign_messages').get();
    assert.match(message.content, /Атака: Longsword; цель: Dummy/);
    assert.match(message.content, /Описание игрока: Кричу: Держитесь!/);
    const event = JSON.parse(f.db.prepare("SELECT payload_json FROM campaign_events WHERE type='message_added'").get().payload_json);
    assert.deepEqual(event.message.combatTurn.choices, [choice]);
    assert.equal(event.message.combatTurn.description, 'Кричу: Держитесь!');
  } finally { f.close(); }
});

test('Sneak Attack is a once-per-turn rider on a declared attack, not another action', async () => {
  const f = fixture();
  try {
    const targetEnemyId = '00000000-0000-4000-8000-000000000099';
    const hero = f.sheets[0];
    hero.class = 'rogue';
    hero.level = 5;
    hero.features = [{ name: 'Sneak Attack' }];
    hero.equipment = [{ name: 'Dagger', qty: 1 }];
    f.enemies([{ id: targetEnemyId, name: 'Barbed Devil', status: 'alive' }]);
    const invalid = await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, choices: [
      { type: 'attack', targetEnemyId, weapon: 'Dagger' },
      { type: 'feature', feature: 'Sneak Attack' },
    ] } });
    assert.equal(invalid.status, 400, 'the server rejects the old two-entry pattern');
    const valid = await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, choices: [
      { type: 'attack', targetEnemyId, weapon: 'Dagger', sneakAttack: true },
    ] } });
    assert.equal(valid.status, 202, await valid.text());
    const { content } = f.db.prepare('SELECT content FROM campaign_messages').get();
    assert.match(content, /Атака: Dagger; цель: Barbed Devil; Скрытая атака, если соблюдены условия/);
    assert.equal(content.match(/Скрытая атака/g)?.length, 1);
  } finally { f.close(); }
});

test('action route rejects missing clarifications and resolves Cunning Action as a bonus action', async () => {
  const f = fixture();
  try {
    const enemyId = '00000000-0000-4000-8000-000000000099';
    f.enemies([{ id: enemyId, name: 'Target', status: 'alive' }]);
    const hero = f.sheets[0];
    hero.features = [{ name: 'Хитрое действие (Cunning Action)' }];
    const send = choices => f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, choices } });
    assert.equal((await send([{ type: 'action', action: 'help' }])).status, 400, 'missing ally target is rejected before the turn is held');
    assert.equal((await send([{ type: 'action', action: 'grapple' }])).status, 400, 'missing enemy target is rejected before the turn is held');
    const response = await send([{ type: 'action', action: 'hide', cunningAction: true }]);
    assert.equal(response.status, 202, await response.text());
    assert.match(f.db.prepare('SELECT content FROM campaign_messages').get().content, /Хитрое действие: Скрыться/);
  } finally { f.close(); }
});

test('sequential spotlight emits one durable batch barrier after every selected player responds', async () => {
  const f = fixture();
  try {
    f.encounter(null);
    f.campaign.gameSettings.globalTurn.enabled = false;
    f.campaigns.setFloor('c1', { mode: 'spotlight', userIds: ['u1', 'u2'], respondedUserIds: [], prompt: '' });
    assert.equal((await f.send({ kind: 'do', content: 'I inspect the chest.' })).status, 202);
    assert.deepEqual(f.campaigns.getFloor('c1').respondedUserIds, ['u1']);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events WHERE type='spotlight_ready'").get().n, 0);
    assert.equal((await f.send({ kind: 'do', content: 'I try again.' })).status, 409);
    f.user('u2');
    assert.equal((await f.send({ kind: 'do', content: 'I say: Wait here.' })).status, 202);
    assert.equal(f.campaigns.getFloor('c1').mode, 'hold', 'selected players stay locked until confirmed narration');
    assert.equal(f.campaigns.getFloor('c1').next.mode, 'open');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events WHERE type='spotlight_ready'").get().n, 1);
  } finally { f.close(); }
});

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

test('text and button submissions both stay locked until turn resolution; victory waits for narration', async () => {
  const f = fixture();
  try {
    assert.equal((await f.send({ kind: 'do', content: 'I speak while fighting' })).status, 400);
    assert.equal((await f.send(f.intent)).status, 202, 'the completed builder request can submit a pass');
    f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'hold');
    assert.equal((await f.send({ kind: 'do', content: 'a second action' })).status, 409);
    const first = f.campaigns.getFloor('c1');
    f.campaigns.setFloor('c1', { ...first, combat: { ...first.combat, mechanicsResolved: true } });
    f.narrate(); assert.equal(f.campaigns.getFloor('c1').mode, 'initiative');
    assert.equal(f.campaigns.getFloor('c1').round, 2, 'the handing-over narration moves initiative');
    assert.equal((await f.send(f.intent)).status, 409, 'the old turn is gone');
    assert.equal((await f.send({ ...f.intent, combatTurn: { ...f.intent.combatTurn, round: 2 } })).status, 202);
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
      '@/lib/dm/combat-mode': loadSource('src/lib/dm/combat-mode.ts'),
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
  const sheet = { id: heroId, name: 'First', currentHp: 10, conditions: [] };
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
    '@/lib/srd/spell-mechanics': {},
    '@/lib/db/dm-turns': { listOpenPendingRolls: () => [] },
    '@/lib/dm/condition-sources': { addConditionSource: () => ({ conditions: [], meta: {} }), sourceMeta: () => null },
    '@/lib/schemas/sheet': { fullPatchSheetSchema: { pick: () => z.any() }, concentrationSourceSchema: z.any() },
    '@/lib/dm/mutation-math': {}, '@/lib/srd/currency': {}, '@/lib/dm/death': {},
    '@/lib/dm/death-logic': {},
    '@/lib/dm/companion-tools': {}, '@/lib/dm/condition-logic': { incapacitatedBy: () => null },
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
