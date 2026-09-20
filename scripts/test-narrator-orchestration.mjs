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
  const modelCalls = [], writes = [], receipts = new Map();
  const adapter = { async generate(role, prompt) {
    modelCalls.push({ role, packet: JSON.parse(prompt) });
    const reply = typeof replies === 'function' ? await replies(role, JSON.parse(prompt)) : replies.shift();
    if (reply === undefined) throw new Error('Unexpected model call');
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  } };
  const controller = new NarratorOrchestrator({ adapter, ...options });
  const host = {
    campaignId: 'c', snapshot: snapshot(), saved: null, writes, modelCalls, controller,
    memory: { getPromptContext: () => ({ summary: 'Earlier public events.' }) },
    saveCheckpoint() { this.saved = this.controller.serialize(); },
    async drainStory() {
      this.snapshot.nextCursor = this.snapshot.currentSeq;
      this.controller.ingestReadSnapshot(this.snapshot);
      this.saveCheckpoint(); return structuredClone(this.snapshot);
    },
    async callControl(action, params) {
      if (action === 'narrator.catalog') {
        const names = ['request_roll', 'start_encounter', 'pc_attack', 'end_turn'];
        return { groups: [{ category: 'combat', ...(params.summaryOnly ? { actions: names.map(name => ({ name })) } : { entries: [{ name: params.action, fields: [] }] }) }] };
      }
      writes.push({ action, params: structuredClone(params) });
      if (receipts.has(params.commandId)) return receipts.get(params.commandId);
      if (params.expectedSeq !== this.snapshot.currentSeq) throw Object.assign(new Error('Stale narrator cursor; reread and drain events before writing.'), { status: 409 });
      const result = this.onInvoke ? await this.onInvoke(action, params) : { ok: true, total: 14, success: true };
      const receipt = { commandId: params.commandId, receiptId: 'receipt', committedSeq: ++this.snapshot.currentSeq, result };
      this.snapshot.nextCursor = this.snapshot.currentSeq; receipts.set(params.commandId, receipt);
      if (this.timeoutAfterCommit) { this.timeoutAfterCommit = false; throw new Error('transport timeout'); }
      return receipt;
    },
    tick() { this.snapshot.nextCursor = this.snapshot.currentSeq; return this.controller.tick(this, structuredClone(this.snapshot)); },
  };
  return host;
}

test('real legacy player messages have no kind; referee receives IDs, state and actual catalog', async () => {
  const h = fixture([{ kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', kind: 'skill_check', skill: 'investigation', dc: 12 } },
    { kind: 'narrate', text: 'You find the clue.', writer: true, releaseFloor: true }, 'Among the papers lies the clue.']);
  await h.tick();
  assert.equal(h.writes[0].params.args.characterId, 'hero');
  assert.equal(h.modelCalls[0].packet.state.sheets[0].id, 'hero');
  assert.ok(h.modelCalls[0].packet.actions[0].actions.some(action => action.name === 'pc_attack'));
  await h.tick();
  assert.equal(h.writes[1].action, 'narrator.narrate');
  assert.equal(h.writes[1].params.content, 'Among the papers lies the clue.');
  assert.equal(h.controller.state.handledSeq, 2);
  await h.tick(); assert.equal(h.modelCalls.length, 3, 'idle polling must not spend model calls');
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
  let h;
  h = fixture(() => { h.snapshot.messages.push(player(++h.snapshot.currentSeq)); return { kind: 'narrate', text: 'Stale draft.' }; });
  await h.tick(); assert.equal(h.writes.length, 0);
  assert.equal(h.controller.state.queue.length, 1);
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
  handler({ url: '/status', headers: {} }, response);
  assert.equal(body.lastError, 'ask_write_ambiguous');
});

test('initial connect failure degrades health until a successful poll', async t => {
  let handler;
  const server = { listen() {}, close(callback) { callback(); } };
  const f = await narratorHarness({ healthPort: 3007, pollIntervalMs: 86_400_000,
    http: { createServer(callback) { handler = callback; return server; } },
    control: () => { throw new Error('unavailable'); } });
  t.after(() => f.instance.stop());
  await f.instance.start();
  let body;
  const response = { statusCode: 200, setHeader() {}, end(value) { body = JSON.parse(value); } };
  handler({ url: '/healthz', headers: {} }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(body.status, 'degraded');
  handler({ url: '/status', headers: {} }, response);
  assert.equal(body.lastError, 'connect_failed');
});

test('checkpoint restores only known operator error codes', async () => {
  const known = await narratorHarness({ checkpoint: { campaignId: 'c', lastError: 'story_paused' } });
  known.instance.loadCheckpoint(); assert.equal(known.instance.lastError, 'story_paused');
  const unknown = await narratorHarness({ checkpoint: { campaignId: 'c', lastError: 'private text' } });
  unknown.instance.loadCheckpoint(); assert.equal(unknown.instance.lastError, null);
});
