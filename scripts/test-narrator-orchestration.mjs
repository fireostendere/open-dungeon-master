import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NarratorOrchestrator, validateDecision } from '../narrator/orchestration.mjs';
import { OpenCodeAdapter } from '../narrator/opencode-adapter.mjs';
import { readNarratorSnapshot } from '../narrator/read-session.mjs';
import { HostContextMemory } from '../narrator/compaction.mjs';
import { narratorHarness } from './lib/astra-narrator-harness.mjs';

const epoch = 'a'.repeat(64);
const player = (seq = 2) => ({ id: `message-${seq}`, seq, authorType: 'player', userId: 'user', characterId: 'hero', content: 'I search the chest.' });
const snapshot = (extra = {}) => ({ campaign: { id: 'c', status: 'active', scene: 'An old chamber.', gameSettings: { language: 'ru', unitSystem: 'metric' } },
  timelineEpoch: epoch, currentSeq: 4, nextCursor: 4, hasMore: false, spatial: { enabled: false },
  messages: [player()], events: [], pendingRolls: [], sheets: [{ id: 'hero', name: 'Ada', currentHp: 8, resources: {} }],
  facts: [], notes: [], npcs: [], ...extra });

function fixture(replies, options = {}) {
  const modelCalls = [], writes = [], commits = [], receipts = new Map();
  const adapter = { runtimeSource: 'custom-opencode', async generate(role, prompt) {
    modelCalls.push({ role, packet: JSON.parse(prompt) });
    const reply = typeof replies === 'function' ? await replies(role, JSON.parse(prompt)) : replies.shift();
    if (reply === undefined) throw new Error('Unexpected model call');
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  } };
  const controller = new NarratorOrchestrator({ adapter, ...options });
  const host = {
    campaignId: 'c', snapshot: snapshot(), saved: null, writes, commits, modelCalls, controller, drains: [],
    memory: { getPromptContext: () => ({ summary: 'Earlier public events.' }) },
    saveCheckpoint() { this.saved = this.controller.serialize(); },
    async drainStory(options = {}) {
      this.drains.push(structuredClone(options));
      this.snapshot.nextCursor = this.snapshot.currentSeq;
      this.controller.ingestReadSnapshot(this.snapshot);
      this.saveCheckpoint(); return structuredClone(this.snapshot);
    },
    async callControl(action, params) {
      if (action === 'narrator.catalog') {
        const names = ['request_roll', 'start_encounter', 'pc_attack', 'end_turn',
          'location_enable', 'location_disable', 'location_create_room', 'location_link', 'location_move',
          'location_narrate', 'location_observe', 'location_revoke', 'location_propagate', 'location_perceive',
          'location_stealth_resolve', 'location_detect', 'location_lose_detection', 'location_set_floor'];
        return { groups: [{ category: 'combat', ...(params.summaryOnly ? { actions: names.map(name => ({ name })) } : { entries: [{ name: params.action, fields: [] }] }) }] };
      }
      if (action === 'narrator.read') return structuredClone(this.snapshot);
      writes.push({ action, params: structuredClone(params) });
      if (receipts.has(params.commandId)) return receipts.get(params.commandId);
      if (params.expectedSeq !== this.snapshot.currentSeq || this.originalExpectedSeq !== undefined && params.expectedSeq !== this.originalExpectedSeq) throw Object.assign(new Error('Stale narrator cursor; reread and drain events before writing.'), { status: 409 });
      const result = this.onInvoke ? await this.onInvoke(action, params) : { ok: true, total: 14, success: true };
      const receipt = { commandId: params.commandId, receiptId: 'receipt', committedSeq: ++this.snapshot.currentSeq, result };
      this.snapshot.nextCursor = this.snapshot.currentSeq; receipts.set(params.commandId, receipt); commits.push(receipt);
      if (this.timeoutAfterCommit) { this.timeoutAfterCommit = false; throw new Error('transport timeout'); }
      return receipt;
    },
    tick() { this.snapshot.nextCursor = this.snapshot.currentSeq; this.originalExpectedSeq = this.snapshot.currentSeq; return this.controller.tick(this, structuredClone(this.snapshot)); },
  };
  return host;
}

test('real legacy player messages have no kind; referee receives IDs, state and actual catalog', async () => {
  const h = fixture([{ kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', kind: 'skill_check', skill: 'investigation', dc: 12 } },
    { kind: 'narrate', text: 'You find the clue.', writer: true, releaseFloor: true }, 'Among the papers lies the clue.']);
  await h.tick();
  assert.equal(h.writes[0].params.args.characterId, 'hero');
  assert.equal(h.modelCalls[0].packet.state.sheets[0].id, 'hero');
  assert.equal(h.modelCalls[0].packet.actions[0].actions[0].name, 'game');
  assert.ok(h.modelCalls[0].packet.actions[0].actions[0].operations.some(action => action.name === 'pc_attack'));
  await h.tick();
  assert.equal(h.writes[1].action, 'narrator.narrate');
  assert.equal(h.writes[1].params.content, 'Among the papers lies the clue.');
  assert.equal(h.controller.state.handledSeq, 2);
  await h.tick(); assert.equal(h.modelCalls.length, 3, 'idle polling must not spend model calls');
});

test('referee packet omits presentation and retired hosted-AI settings', async () => {
  const h = fixture([{ kind: 'done' }]);
  h.snapshot.campaign.gameSettings = {
    language: 'ru',
    unitSystem: 'metric',
    combatMode: 'classical',
    globalTurn: { enabled: false, turnCollectionMinutes: 10, quorumPlayers: 2, quorumDelayMinutes: 2 },
    dmDifficulty: 7,
    variantRules: { flanking: true, restVariant: 'standard' },
    ttsEnabled: true,
    ttsVoice: 'voice',
    mapsEnabled: true,
    enemyHpVisibility: 'exact',
    enemyConditionVisibility: 'status_turns',
    beatReminder: { messages: 10, rolls: 12 },
    stages: { compaction: false, recall: false, retrieval: false, chapterSummary: false },
    voice: { enabled: true, turnEnforcement: 'soft', rules: {} },
  };
  await h.tick();
  const settings = h.modelCalls[0].packet.campaign.gameSettings;
  assert.equal(settings.dmDifficulty, 7);
  assert.equal(settings.variantRules.flanking, true);
  assert.equal(Object.hasOwn(settings, 'ttsEnabled'), false);
  assert.equal(Object.hasOwn(settings, 'mapsEnabled'), false);
  assert.equal(Object.hasOwn(settings, 'voice'), false);
  assert.equal(Object.hasOwn(settings, 'enemyHpVisibility'), false);
  assert.equal(Object.hasOwn(settings, 'stages'), false);
});

test('global turn opening stays locked until MCP narration starts the round', async () => {
  const h = fixture([{ kind: 'narrate', text: 'The torchlight reveals the hall.' }]);
  h.snapshot.campaign.gameSettings.globalTurn = {
    enabled: true,
    turnCollectionMinutes: 0,
    quorumPlayers: 2,
    quorumDelayMinutes: 0,
  };
  h.snapshot.campaign.globalTurnState = {
    roundNumber: 1, phase: 'waiting', startedAt: null,
    firstActionAt: null, deadlineAt: null, quorumReachedAt: null, actionsByCharacter: {},
  };
  // Simulate a stale pre-trigger player message from before global-turn mode
  // was armed. It must never become part of round 1.
  h.snapshot.messages = [player(1)];
  h.snapshot.currentSeq = 1;
  h.snapshot.nextCursor = 1;

  assert.equal(await h.tick(), false);
  assert.equal(h.modelCalls.length, 0, 'waiting alone must not wake the model');

  h.snapshot.currentSeq = 2;
  h.snapshot.nextCursor = 2;
  h.snapshot.events = [{
    seq: 2,
    type: 'global_turn_narrator_trigger',
    payload: { kind: 'opening', roundNumber: 1 },
  }];

  assert.equal(await h.tick(), true);
  assert.equal(h.modelCalls[0].packet.input.kind, 'global_turn_trigger');
  assert.equal(h.modelCalls[0].packet.input.roundNumber, 1);
  assert.equal(h.writes[0].action, 'narrator.narrate');
  assert.equal(h.writes[0].params.startGlobalRound, 1);
  assert.equal(h.writes[0].params.completeGlobalRound, undefined);
  assert.equal(h.controller.state.queue.length, 0, 'pre-trigger input must be discarded at the start boundary');
});

test('global turn waits for ready barrier, batches the round, and closes it through MCP narration', async () => {
  const h = fixture([{ kind: 'narrate', text: 'The party acts together.' }]);
  h.snapshot.campaign.gameSettings.globalTurn = {
    enabled: true,
    turnCollectionMinutes: 0,
    quorumPlayers: 2,
    quorumDelayMinutes: 0,
  };
  h.snapshot.campaign.globalTurnState = {
    roundNumber: 7, phase: 'active', startedAt: '2026-01-01T00:00:00.000Z',
    firstActionAt: null, deadlineAt: null, quorumReachedAt: null, actionsByCharacter: {},
  };
  h.snapshot.messages = [
    player(2),
    { ...player(3), id: 'message-3', userId: 'user-2', characterId: 'hero-2', content: 'I bar the door.' },
  ];
  h.snapshot.currentSeq = 3;
  h.snapshot.nextCursor = 3;

  assert.equal(await h.tick(), false);
  assert.equal(h.modelCalls.length, 0, 'player messages must not wake the narrator before the round barrier');

  h.snapshot.currentSeq = 4;
  h.snapshot.nextCursor = 4;
  h.snapshot.campaign.globalTurnState.phase = 'ready';
  h.snapshot.events = [{ seq: 4, type: 'global_turn_ready', payload: { roundNumber: 7 } }];
  assert.equal(await h.tick(), true);

  assert.equal(h.modelCalls.length, 1);
  assert.equal(h.modelCalls[0].packet.input.kind, 'global_round');
  assert.equal(h.modelCalls[0].packet.input.roundNumber, 7);
  assert.deepEqual(h.modelCalls[0].packet.input.messages.map(message => message.seq), [2, 3]);
  assert.deepEqual(h.modelCalls[0].packet.public.messages.map(message => message.seq), []);
  assert.equal(h.writes[0].action, 'narrator.narrate');
  assert.equal(h.writes[0].params.completeGlobalRound, 7);
  assert.equal(h.controller.state.handledSeq, 4);
});

test('spatial global round stays locked until every affected room is narrated and finalizer commits', async () => {
  const h = fixture([
    { kind: 'invoke', action: 'game', args: { action: 'location_narrate', args: { roomId: 'room-a', content: 'Room A resolves.' } } },
    { kind: 'invoke', action: 'game', args: { action: 'location_narrate', args: { roomId: 'room-b', content: 'Room B resolves.' } } },
    { kind: 'done' },
  ]);
  h.snapshot.campaign.gameSettings.globalTurn = {
    enabled: true, turnCollectionMinutes: 0, quorumPlayers: 2, quorumDelayMinutes: 0,
  };
  h.snapshot.campaign.globalTurnState = {
    roundNumber: 4, phase: 'ready', startedAt: '2026-01-01T00:00:00.000Z',
    firstActionAt: '2026-01-01T00:00:01.000Z', deadlineAt: null,
    quorumReachedAt: '2026-01-01T00:00:02.000Z', actionsByCharacter: {},
  };
  h.snapshot.spatial = { enabled: true };
  h.snapshot.spatialRooms = [
    { id: 'room-a', name: 'A', occupants: ['user'] },
    { id: 'room-b', name: 'B', occupants: ['user-2'] },
  ];
  h.snapshot.messages = [
    { ...player(2), roomId: 'room-a', channel: 'location', kind: 'do' },
    { ...player(3), id: 'message-3', userId: 'user-2', characterId: 'hero-2',
      content: 'I listen at the door.', roomId: 'room-b', channel: 'location', kind: 'say' },
  ];
  h.snapshot.currentSeq = 4;
  h.snapshot.nextCursor = 4;
  h.snapshot.events = [{ seq: 4, type: 'global_turn_ready', payload: { roundNumber: 4 } }];

  await h.tick();
  await h.tick();
  await h.tick();

  assert.deepEqual(
    h.writes.slice(0, 2).map(write => write.params.name),
    ['location_narrate', 'location_narrate'],
  );
  assert.equal(h.writes[2].action, 'narrator.finish_global_round');
  assert.equal(h.writes[2].params.mode, 'complete');
  assert.equal(h.writes[2].params.roundNumber, 4);
  assert.equal(h.controller.state.current, null);
});

test('spatial global opening requires narration for every occupied room before start finalizer', async () => {
  const h = fixture([
    { kind: 'invoke', action: 'game', args: { action: 'location_narrate', args: { roomId: 'room-a', content: 'The tavern wakes.' } } },
    { kind: 'invoke', action: 'game', args: { action: 'location_narrate', args: { roomId: 'room-b', content: 'Rain runs down the alley.' } } },
    { kind: 'done' },
  ]);
  h.snapshot.campaign.gameSettings.globalTurn = {
    enabled: true, turnCollectionMinutes: 0, quorumPlayers: 2, quorumDelayMinutes: 0,
  };
  h.snapshot.campaign.globalTurnState = {
    roundNumber: 1, phase: 'waiting', startedAt: null, firstActionAt: null,
    deadlineAt: null, quorumReachedAt: null, actionsByCharacter: {},
  };
  h.snapshot.spatial = { enabled: true };
  h.snapshot.spatialRooms = [
    { id: 'room-a', name: 'Tavern', occupants: ['user'] },
    { id: 'room-b', name: 'Alley', occupants: ['user-2'] },
  ];
  h.snapshot.messages = [];
  h.snapshot.currentSeq = 2;
  h.snapshot.nextCursor = 2;
  h.snapshot.events = [{
    seq: 2, type: 'global_turn_narrator_trigger',
    payload: { kind: 'opening', roundNumber: 1 },
  }];

  await h.tick();
  await h.tick();
  await h.tick();

  assert.equal(h.writes[2].action, 'narrator.finish_global_round');
  assert.equal(h.writes[2].params.mode, 'start');
  assert.equal(h.writes[2].params.roundNumber, 1);
  assert.equal(h.controller.state.current, null);
});

test('YOLO spatial catalog expands after enable without refetching the catalog', async () => {
  const h = fixture([
    { kind: 'invoke', action: 'game', args: { action: 'location_enable', args: { name: 'Tavern' } } },
    { kind: 'done' },
  ], { yolo: true });
  h.onInvoke = (_action, params) => {
    if (params.name === 'location_enable') {
      h.snapshot.spatial = { enabled: true };
      h.snapshot.spatialRooms = [{ id: 'room-a', name: 'Tavern' }];
      return { enabled: true };
    }
    return { ok: true };
  };
  await h.tick();
  const before = h.modelCalls[0].packet.actions[0].actions[0].operations.map(operation => operation.name);
  assert.ok(before.includes('location_enable'));
  assert.ok(!before.includes('location_disable'));
  await h.tick();
  const after = h.modelCalls[1].packet.actions[0].actions[0].operations.map(operation => operation.name);
  assert.ok(!after.includes('location_enable'));
  assert.ok(after.includes('location_disable'));
  assert.ok(after.includes('location_narrate'));
});

test('YOLO accepts room player input and scopes plain narration through location_narrate', async () => {
  const h = fixture([{ kind: 'narrate', text: 'Only the tavern hears this.' }], { yolo: true });
  h.snapshot.spatial = { enabled: true };
  h.snapshot.spatialRooms = [{ id: 'room-a', name: 'Tavern' }, { id: 'room-b', name: 'Street' }];
  h.snapshot.messages = [{
    id: 'room-message', seq: 2, authorType: 'player', userId: 'user', characterId: 'hero',
    content: 'I whisper to the bartender.', roomId: 'room-a', channel: 'location', kind: 'say',
  }];
  await h.tick();
  assert.equal(h.controller.state.paused, null);
  assert.equal(h.modelCalls[0].packet.input.roomId, 'room-a');
  const operations = h.modelCalls[0].packet.actions[0].actions[0].operations.map(operation => operation.name);
  assert.ok(operations.includes('location_narrate'));
  assert.ok(!operations.includes('location_enable'));
  assert.equal(h.writes[0].action, 'narrator.invoke');
  assert.equal(h.writes[0].params.name, 'location_narrate');
  assert.equal(h.writes[0].params.args.roomId, 'room-a');
  assert.equal(h.writes[0].params.scopeRoomId, 'room-a');
});

test('writer can be disabled for short combat narration', async () => {
  const h = fixture([{ kind: 'narrate', text: 'Короткое последствие.', writer: true }, 'writer output']);
  h.snapshot.encounter = { status: 'active', kind: 'fight' };
  await h.tick();
  await h.tick();
  assert.deepEqual(h.modelCalls.map(call => call.role), ['referee']);
  assert.equal(h.writes[0].params.content, 'Короткое последствие.');
});

test('initiative setup and attack are separate confirmed steps, not a blanket one-invoke limit', async () => {
  const h = fixture([{ kind: 'invoke', action: 'start_encounter', args: { enemies: 'goblin' } },
    { kind: 'invoke', action: 'pc_attack', args: { characterId: 'hero', enemyId: 'enemy', targetEnemyId: 'enemy', weapon: 'sword' } },
    { kind: 'narrate', text: 'The blow lands.' }]);
  for (let i = 0; i < 3; i++) await h.tick();
  assert.deepEqual(h.writes.map(write => write.params.name ?? write.action), ['start_encounter', 'pc_attack', 'narrator.narrate']);
  assert.equal(h.modelCalls[1].packet.outcomes[0].name, 'start_encounter');
});

test('matching physical roll_result is required; disappearance or another roll cannot resume', async () => {
  const h = fixture([{ kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', kind: 'skill_check', skill: 'stealth' } },
    { kind: 'narrate', text: 'Your foot scrapes the stone.' }]);
  h.onInvoke = action => {
    if (action === 'narrator.invoke') { h.snapshot.pendingRolls = [{ id: 'pending', characterId: 'hero' }]; return { ok: true, parked: true }; }
    return { messageId: 'narration' };
  };
  await h.tick(); await h.tick(); assert.equal(h.modelCalls.length, 1);
  h.snapshot.pendingRolls = []; h.snapshot.currentSeq++;
  h.snapshot.events = [{ seq: h.snapshot.currentSeq, type: 'roll_result', payload: { pendingRollId: 'another', roll: { id: 'r-other', visibility: 'public', total: 20 } } }];
  await h.tick(); assert.equal(h.modelCalls.length, 1);
  h.snapshot.currentSeq++;
  h.snapshot.events.push({ seq: h.snapshot.currentSeq, type: 'roll_result', payload: { pendingRollId: 'pending', roll: { id: 'r', characterId: 'hero', kind: 'skill_check', visibility: 'public', total: 3 } } });
  await h.tick(); assert.equal(h.modelCalls.length, 2);
  assert.equal(h.writes.length, 2);
});

test('resolved physical roll does not trigger a redundant narrator read', async () => {
  const h = fixture([
    { kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', kind: 'skill_check', skill: 'stealth' } },
    { kind: 'done' },
  ]);
  h.onInvoke = action => {
    if (action === 'narrator.invoke') {
      h.snapshot.pendingRolls = [{ id: 'pending', characterId: 'hero' }];
      return { ok: true, parked: true };
    }
    return { ok: true };
  };
  await h.tick();
  h.drains.length = 0;
  h.snapshot.pendingRolls = [];
  h.snapshot.currentSeq++;
  h.snapshot.nextCursor = h.snapshot.currentSeq;
  h.snapshot.events = [{
    seq: h.snapshot.currentSeq,
    type: 'roll_result',
    payload: { pendingRollId: 'pending', roll: { id: 'r1', characterId: 'hero', kind: 'skill_check', visibility: 'public', total: 12 } },
  }];
  await h.tick();
  assert.equal(h.drains.length, 0, 'the already-drained roll_result is authoritative');
  assert.equal(h.modelCalls.length, 2);
  assert.equal(h.modelCalls[1].packet.outcomes[0].physicalRolls[0].roll.id, 'r1');
});

test('timeout recovery after restart sends the exact saved command without another model call', async () => {
  const h = fixture([{ kind: 'invoke', action: 'request_roll', args: { dc: 12 } }, { kind: 'narrate', text: 'A clue emerges.' }]);
  h.timeoutAfterCommit = true;
  await assert.rejects(h.tick(), /timeout/);
  const saved = h.saved;
  const controller = new NarratorOrchestrator({ adapter: h.controller.adapter }); controller.restore(saved); h.controller = controller;
  await h.tick();
  assert.deepEqual(h.writes[1], h.writes[0]);
  assert.equal(h.modelCalls.length, 1);
  await h.tick(); assert.equal(h.controller.state.handledSeq, 2);
});

test('at most one ambiguous retry survives repeated polls and checkpoint restore', async () => {
  const h = fixture([{ kind: 'narrate', text: 'The door creaks.' }]);
  const original = h.callControl;
  h.callControl = async function(action, params) {
    if (action === 'narrator.catalog') return original.call(this, action, params);
    this.writes.push({ action, params }); throw new Error('offline');
  };
  await assert.rejects(h.tick()); await h.tick(); await h.tick();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0], h.writes[1]);
  assert.equal(h.controller.state.paused, 'ambiguous_write');
  assert.throws(() => h.controller.resume(), /reconciliation/);
});

test('messages arriving during a committed write survive the next empty read and a restart', async () => {
  const h = fixture([{ kind: 'narrate', text: 'First reply.' }, { kind: 'narrate', text: 'Second reply.' }]);
  h.onInvoke = () => { h.snapshot.messages.push(player(++h.snapshot.currentSeq)); return { messageId: 'reply' }; };
  await h.tick();
  const secondSeq = h.controller.state.queue[0].seq;
  h.onInvoke = null; h.snapshot.messages = [];
  const next = new NarratorOrchestrator({ adapter: h.controller.adapter }); next.restore(h.saved); h.controller = next;
  await h.tick();
  assert.equal(h.controller.state.handledSeq, secondSeq);
  assert.equal(h.writes.length, 2);
});

test('read-only drafts are discarded if another event arrives during generation', async () => {
  let h, generations = 0;
  h = fixture(() => {
    if (generations++ === 0) { h.snapshot.messages.push(player(++h.snapshot.currentSeq)); return { kind: 'narrate', text: 'Stale draft.' }; }
    return { kind: 'done' };
  });
  await h.tick(); assert.equal(h.commits.length, 0);
  assert.equal(h.controller.state.queue.length, 1);
  await h.tick(); assert.equal(h.modelCalls.length, 2); assert.equal(h.controller.state.queue[0].seq, h.snapshot.currentSeq);
});

test('wait does not call a model again until an event changes the sequence', async () => {
  const h = fixture([{ kind: 'wait' }, { kind: 'done' }]);
  await h.tick(); await h.tick(); assert.equal(h.modelCalls.length, 1);
  h.snapshot.currentSeq++; await h.tick(); assert.equal(h.modelCalls.length, 2);
});

test('spatial campaigns pause, and public writer never receives raw private state', async () => {
  const paused = fixture([]); paused.snapshot.spatial = { enabled: true }; await paused.tick();
  assert.equal(paused.modelCalls.length, 0); assert.equal(paused.writes.length, 0);
  const h = fixture([{ kind: 'narrate', text: 'An uneasy silence.', writer: true }, 'Silence settles over the chamber.']);
  Object.assign(h.snapshot, { asks: [{ question: 'ASK_SECRET' }], playerWhispers: ['WHISPER_SECRET'], facts: ['DM_SECRET'],
    sheets: [{ id: 'hero', notes: 'SHEET_SECRET' }], encounter: { enemies: [{ ac: 99, secret: 'ENEMY_SECRET' }] } });
  h.snapshot.campaign.dmOutline = 'OUTLINE_SECRET';
  await h.tick();
  assert.doesNotMatch(JSON.stringify(h.modelCalls.find(call => call.role === 'writer')), /SECRET|99/);
  assert.match(JSON.stringify(h.modelCalls.find(call => call.role === 'referee')), /OUTLINE_SECRET/);
  assert.doesNotMatch(JSON.stringify(h.modelCalls), /ASK_SECRET|WHISPER_SECRET/);
});

test('decisions cannot select administrative actions or transport credentials', () => {
  const allowedActions = new Set(['request_roll']);
  for (const value of [{ kind: 'invoke', action: 'campaigns.delete', args: {} },
    { kind: 'done', provider: 'other' }, { kind: 'invoke', action: 'request_roll', args: { campaignId: 'foreign' } },
    { kind: 'narrate', writer: true }, { kind: 'narrate', text: 'ok', releaseFloor: 'yes' }]) assert.throws(() => validateDecision(value, { allowedActions }));
});

test('timeline reset quarantines pending work and requires an explicit input boundary', async () => {
  const h = fixture([{ kind: 'wait' }]); await h.tick();
  h.controller.reset('b'.repeat(64));
  assert.equal(h.controller.state.current, null);
  assert.throws(() => h.controller.resume(), /cursor/);
  h.controller.resume({ afterSeq: 8 }); assert.equal(h.controller.state.handledSeq, 8);
  assert.equal(h.controller.state.usage.calls, 1, 'rewind must not reset usage budgets');
});

test('content-addressed delta reconstructs full arrays and preserves explicit empty clears', async () => {
  const versions = Object.fromEntries(['sheets', 'facts', 'notes', 'npcs'].map(key => [key, '1'.repeat(64)]));
  const calls = [];
  let state = snapshot({ sectionVersions: versions });
  const h = { deltaReads: true, readPageRetries: 0, readMaxBytes: 65536, async callControl(_action, params) { calls.push(params); return structuredClone(state); } };
  const params = { campaignId: 'c', timelineEpoch: epoch };
  const full = await readNarratorSnapshot(h, params);
  state = snapshot({ sectionVersions: versions, sheets: [], omittedSections: ['sheets'] });
  assert.deepEqual((await readNarratorSnapshot(h, params)).sheets, full.sheets);
  assert.deepEqual(calls[1].knownSections, versions);
  state.sectionVersions = { ...versions, sheets: '2'.repeat(64) }; state.omittedSections = [];
  assert.deepEqual((await readNarratorSnapshot(h, params)).sheets, []);
  h.sectionCache = null; state.omittedSections = ['sheets'];
  await assert.rejects(readNarratorSnapshot(h, params), /baseline/);
  state = snapshot({ sectionVersions: versions, timelineEpoch: 'b'.repeat(64) });
  await assert.rejects(readNarratorSnapshot(h, params), /timeline/);
});

test('live roll events update durable memory without repeated historical roll arrays', () => {
  const memory = new HostContextMemory({ campaignId: 'c' });
  memory.ingestReadSnapshot(snapshot({ events: [{ seq: 3, type: 'roll_result', payload: { roll: { id: 'roll', seq: 3, visibility: 'public', total: 14 } } }] }));
  assert.equal(memory.serializeState().rolls[0].total, 14);
});

test('OpenCode adapter pins model/role, denies tools, installs policy before data, then deletes only its session', async () => {
  const calls = [], model = { providerID: 'openai', id: 'selected-model', variant: 'selected-effort' };
  const adapter = new OpenCodeAdapter({ endpoint: 'http://127.0.0.1:4096', token: 'token', workspace: '/isolated', model,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ data: String(url).endsWith('/api/session') ? { id: 'ses_owned', agent: 'narrator-referee', model } : String(url).includes('/instructions/') ? {} : { text: '{"kind":"done"}' } });
    } });
  await adapter.generate('referee', 'player-data');
  assert.deepEqual(JSON.parse(calls[0].options.body).model, model);
  assert.deepEqual(JSON.parse(calls[0].options.body).permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.match(calls[1].options.body, /ODM Dungeon Master policy/);
  assert.doesNotMatch(calls[1].options.body, /player-data/);
  assert.match(calls[2].options.body, /player-data/);
  assert.equal(calls[3].options.method, 'DELETE');
  assert.throws(() => new OpenCodeAdapter({ endpoint: 'http://remote.example', workspace: '/isolated', model }), /HTTPS/);
});

test('workspace exporter emits V2 permission arrays and refuses to overwrite files', t => {
  const dir = fs.mkdtempSync('/tmp/opencode/odm-roles-'); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = new URL('../narrator/export-opencode-workspace.mjs', import.meta.url);
  assert.equal(spawnSync(process.execPath, [script.pathname, dir]).status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8'));
  for (const agent of Object.values(config.agents)) {
    assert.deepEqual(agent.permissions, [{ action: '*', resource: '*', effect: 'deny' }]);
    assert.match(agent.system, /ODM Dungeon Master policy/);
  }
  assert.equal(config.warming, false);
  assert.notEqual(spawnSync(process.execPath, [script.pathname, dir]).status, 0);
});

test('OpenCode skips duplicate policy PUT only when exported workspace system is exact', async t => {
  const dir = fs.mkdtempSync('/tmp/opencode/odm-policy-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = new URL('../narrator/export-opencode-workspace.mjs', import.meta.url);
  assert.equal(spawnSync(process.execPath, [script.pathname, dir]).status, 0);

  const calls = [];
  const model = { providerID: 'openai', id: 'selected-model' };
  const adapter = new OpenCodeAdapter({
    endpoint: 'http://127.0.0.1:4096',
    workspace: dir,
    model,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url).endsWith('/api/session')) {
        return Response.json({ data: { id: 'ses_owned', agent: 'narrator-referee', model } });
      }
      if (String(url).endsWith('/generate')) return Response.json({ data: { text: '{"kind":"done"}' } });
      return Response.json({ data: {} });
    },
  });

  await adapter.generate('referee', 'player-data');
  assert.equal(calls.filter(call => call.url.includes('/instructions/')).length, 0);
  assert.equal(calls.filter(call => call.url.endsWith('/generate')).length, 1);

  const configPath = path.join(dir, 'opencode.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.agents['narrator-referee'].system += '\nchanged';
  fs.writeFileSync(configPath, JSON.stringify(config));
  const fallbackCalls = [];
  const fallback = new OpenCodeAdapter({
    endpoint: 'http://127.0.0.1:4096',
    workspace: dir,
    model,
    fetchImpl: async (url, options) => {
      fallbackCalls.push({ url: String(url), options });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url).endsWith('/api/session')) {
        return Response.json({ data: { id: 'ses_fallback', agent: 'narrator-referee', model } });
      }
      if (String(url).endsWith('/generate')) return Response.json({ data: { text: '{"kind":"done"}' } });
      return Response.json({ data: {} });
    },
  });
  await fallback.generate('referee', 'player-data');
  assert.equal(fallbackCalls.filter(call => call.url.includes('/instructions/')).length, 1);
});

test('actual runner preserves queued input through connect, empty reads, writes and idle polls', async () => {
  const h = fixture([{ kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', skill: 'investigation', dc: 12 } },
    { kind: 'narrate', text: 'The clue is found.' }]);
  const f = await narratorHarness({ storyController: h.controller, control: async (action, params) => {
    if (action === 'narrator.connect') return { state: {} };
    if (action === 'narrator.read') return { ...structuredClone(h.snapshot), cursor: params.afterSeq, nextCursor: h.snapshot.currentSeq,
      messages: h.snapshot.messages.filter(message => message.seq > params.afterSeq), recentMessages: h.snapshot.messages,
      asks: [], askQueue: { nextCursor: 0, hasMore: false } };
    return h.callControl(action, params);
  } });
  await f.instance.connect(); assert.equal(h.controller.state.queue.length, 1);
  assert.equal(await f.instance.pollTick(), true);
  assert.equal(await f.instance.pollTick(), true);
  assert.equal(await f.instance.pollTick(), true);
  assert.equal(h.modelCalls.length, 2);
  assert.equal(h.writes.length, 2);
  assert.equal(h.controller.state.handledSeq, 2);
  assert.equal(f.saved.at(-1).storyController.current, null);
});

test('private Ask uses only its supplied author context and never publishes a story command', async () => {
  const h = fixture([{ answer: 'You can attempt to hide if the circumstances permit it.' }]);
  const reply = await h.controller.answerAsk(h, { id: 'q', userId: 'user', question: 'Can I hide?', locale: 'en' }, { summary: 'Known to this author.' });
  assert.equal(reply.citations.length, 0);
  assert.equal(h.modelCalls[0].packet.task, 'answer_ask');
  assert.equal(h.modelCalls[0].packet.context.summary, 'Known to this author.');
  assert.equal(h.writes.length, 0);
  assert.equal(h.controller.state.current, null);
});

test('enabling automation does not mistake a collector checkpoint for handled player inputs', async () => {
  const h = fixture([{ kind: 'done' }], { startAfterSeq: 1 });
  const f = await narratorHarness({ storyController: h.controller,
    checkpoint: { campaignId: 'c', lastSeq: 4, timelineEpoch: epoch },
    control: (action, params) => action === 'narrator.connect' ? { state: {} } : {
      ...h.snapshot, cursor: params.afterSeq, messages: h.snapshot.messages.filter(message => message.seq > params.afterSeq),
    } });
  f.instance.loadCheckpoint(); assert.equal(f.instance.lastSeq, 1);
  await f.instance.connect();
  assert.equal(h.controller.state.queue[0].seq, 2);
});

test('private answer transport has one persisted retry after restart', async () => {
  const ask = { id: 'ask', userId: 'user', version: 0, question: 'Can I hide?' };
  const f = await narratorHarness({ askResponder: async () => ({ answer: 'You may try.', citations: [] }),
    control: () => { throw new Error('ambiguous transport'); } });
  await assert.rejects(f.instance.handlePendingAsk(ask));
  await assert.rejects(f.instance.handlePendingAsk(ask));
  const restored = await narratorHarness({ checkpoint: f.saved.at(-1), askResponder: async () => { throw new Error('Do not generate again.'); },
    control: () => { throw new Error('Do not write again.'); } });
  restored.instance.loadCheckpoint();
  await restored.instance.handlePendingAsk(ask);
  assert.equal(restored.calls.length, 0);
  assert.equal(restored.instance.askBlocked, true);
});

test('OpenCode never generates with a substituted model or retries oversized output', async () => {
  for (const wrongModel of [true, false]) {
    const calls = [], model = { providerID: 'openai', id: 'chosen' };
    const adapter = new OpenCodeAdapter({ endpoint: 'http://127.0.0.1:4096', workspace: '/isolated', model,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init.method });
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        if (String(url).endsWith('/api/session')) return Response.json({ data: { id: 'ses_owned', agent: 'narrator-referee', model: wrongModel ? { ...model, id: 'substituted' } : model } });
        return Response.json({ data: String(url).endsWith('/generate') ? { text: 'x'.repeat(270000) } : {} });
      } });
    await assert.rejects(adapter.generate('referee', 'bounded input'), wrongModel ? /selected role\/model/ : /byte budget/);
    assert.equal(calls.filter(call => call.url.endsWith('/generate')).length, wrongModel ? 0 : 1);
    assert.equal(calls.at(-1).method, 'DELETE');
  }
});

test('operator health signals a paused host without disclosing private input', async () => {
  let handler;
  const f = await narratorHarness({ healthPort: 3007, http: { createServer(callback) { handler = callback; return { listen() {} }; } } });
  f.instance.lastError = 'ask_write_ambiguous';
  f.instance.startHealthServer();
  let body;
  const response = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value); } };
  handler({ url: '/healthz' }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(body.ok, false);
  assert.equal(body.status, 'degraded');
  assert.equal(Object.hasOwn(body, 'asks'), false);
});
