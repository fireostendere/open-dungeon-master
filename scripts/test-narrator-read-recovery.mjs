import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { assembleReadPages } from '../narrator/read-session.mjs';

// Actual runner/read session/memory/atomic checkpoint code; only model budget
// and semantic classification are doubles. Control responses are protocol fixtures.
async function runnerClass() {
  const context = vm.createContext({ console: { ...console, error() {} }, process, Buffer, URL, TextEncoder, TextDecoder, performance,
    AbortSignal, AbortController, fetch, structuredClone, setTimeout, clearTimeout });
  const cache = new Map();
  const stubs = {
    'semantic-gate.mjs': { classifyInput: () => ({ decision: 'clarify', replyText: 'Please clarify.' }), DM_REFUSALS: { ru: 'No.' } },
    'cost-tracker.mjs': { NarratorCostTracker: class { getMetrics() { return {}; } recordUsage() {} checkBudget() { return { allowed: true }; } } },
  };
  async function load(name, parent) {
    const url = name.startsWith('node:') ? name : new URL(name, parent?.identifier ?? import.meta.url).href;
    if (cache.has(url)) return cache.get(url);
    const stub = stubs[url.split('/').at(-1)]; let vmModule;
    if (url.startsWith('node:') || stub) {
      const values = stub || await import(url);
      vmModule = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: url });
    } else vmModule = new vm.SourceTextModule(readFileSync(fileURLToPath(url), 'utf8'), {
      context, identifier: url, initializeImportMeta(meta) { meta.url = url; },
    });
    cache.set(url, vmModule); return vmModule;
  }
  const runModule = await load('../narrator/run.mjs'); await runModule.link(load); await runModule.evaluate(); return runModule.namespace.NarratorRunner;
}
const Runner = await runnerClass();
const message = (seq, marker = 'CURRENT') => ({ id: `m-${marker}-${seq}`, seq, roomId: 'vault', witnessUserIds: ['A'], kind: 'say', content: `${marker}_${seq}` });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function pagesFor(state, size = 12) {
  const shape = {}, entries = [];
  for (const [key, value] of Object.entries(state)) {
    shape[key] = Array.isArray(value) ? 'array' : 'value';
    if (Array.isArray(value)) value.forEach((item, index) => entries.push({ key, index, value: item }));
    else entries.push({ key, value });
  }
  const digest = hash(state), pages = [];
  for (let offset = 0; offset < entries.length; offset += size) pages.push({ format: 'odm.read.page.v1', hash: digest, shape, offset,
    entries: entries.slice(offset, offset + size), complete: offset + size >= entries.length,
    nextPage: offset + size >= entries.length ? null : `${digest}:${offset + size}`,
    currentSeq: state.currentSeq, nextCursor: state.nextCursor, hasMore: state.hasMore });
  return pages;
}
function fixture(count = 123) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'odm-read-test-'));
  const state = { epoch: 'a'.repeat(64), messages: Array.from({ length: count }, (_, index) => message(index + 1)), requests: [], intercept: null };
  const fetchImpl = async (_url, init) => {
    const { action, params } = JSON.parse(init.body); state.requests.push({ action, params });
    const interception = await state.intercept?.(action, params); if (interception) return interception;
    const currentSeq = state.messages.at(-1)?.seq ?? 0;
    if (params.timelineEpoch && params.timelineEpoch !== state.epoch) return Response.json({ error: 'Changed timeline', code: 'timeline_changed' }, { status: 409 });
    if ((params.afterSeq ?? 0) > currentSeq) return Response.json({ error: 'Cursor ahead' }, { status: 409 });
    const cursor = params.afterSeq ?? 0, candidates = state.messages.filter(item => item.seq > cursor);
    const messages = candidates.slice(0, params.limit ?? 50), hasMore = candidates.length > messages.length;
    const snapshot = { campaignId: 'c', timelineEpoch: state.epoch, currentSeq, cursor,
      nextCursor: hasMore ? messages.at(-1).seq : currentSeq, hasMore, messages, recentMessages: [],
      asks: [], askQueue: { nextCursor: 0, hasMore: false } };
    const pages = pagesFor(snapshot);
    if (action === 'narrator.connect') return Response.json({ ok: true, result: { state: pages[0], contractVersion: 2 } });
    if (action !== 'narrator.read') throw new Error(`Unexpected fixture action ${action}`);
    const offset = params.pageCursor ? Number(params.pageCursor.split(':').at(-1)) : 0;
    if (params.pageCursor && !params.pageCursor.startsWith(`${pages[0].hash}:`)) return Response.json({ error: 'Snapshot changed' }, { status: 409 });
    return Response.json({ ok: true, result: pages.find(page => page.offset === offset) });
  };
  const options = { campaignId: 'c', token: 'test-only', healthPort: 0, checkpointPath: path.join(directory, 'checkpoint.json'), fetchImpl, readPageRetries: 1 };
  return { state, options, runner: new Runner(options), close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('R06: connect drains every byte and story page instead of acknowledging first-page currentSeq', async () => {
  const f = fixture();
  try {
    await f.runner.connect(); const checkpoint = JSON.parse(readFileSync(f.options.checkpointPath));
    assert.equal(f.runner.lastSeq, 123); assert.equal(checkpoint.lastSeq, 123); assert.equal(checkpoint.memory.seenMessages.length, 123);
    assert.ok(checkpoint.memory.seenMessages.some(([id]) => id === 'm-CURRENT-123'));
    const cursors = f.state.requests.filter(request => request.action === 'narrator.read' && request.params.projection === 'full' && !request.params.pageCursor).map(request => request.params.afterSeq);
    assert.deepEqual(cursors, [0, 50, 100]);
    assert.ok(f.state.requests.some(request => request.params.pageCursor));
    if (process.platform !== 'win32') assert.equal(statSync(f.options.checkpointPath).mode & 0o777, 0o600);
  } finally { f.close(); }
});

test('R06: interrupted second story page resumes from its last durable predecessor after restart', async () => {
  const f = fixture();
  try {
    f.state.intercept = (action, params) => action === 'narrator.read' && params.projection === 'full' && params.afterSeq === 50
      ? Response.json({ error: 'temporary outage' }, { status: 503 }) : null;
    await assert.rejects(f.runner.connect()); assert.equal(f.runner.lastSeq, 50);
    assert.equal(JSON.parse(readFileSync(f.options.checkpointPath)).lastSeq, 50);
    const resumed = new Runner(f.options); resumed.loadCheckpoint(); f.state.intercept = null;
    await resumed.connect(); assert.equal(resumed.lastSeq, 123); assert.equal(resumed.memory.seenMessages.size, 123);
  } finally { f.close(); }
});

test('R06: failed checkpoint persistence rolls back in-memory acknowledgement and ingest', async () => {
  const f = fixture(2);
  try {
    f.runner.saveCheckpoint(); const save = f.runner.saveCheckpoint.bind(f.runner);
    f.runner.saveCheckpoint = () => { if (f.runner.lastSeq > 0) throw new Error('disk failure'); save(); };
    await assert.rejects(f.runner.connect(), /disk failure/);
    assert.equal(f.runner.lastSeq, 0); assert.equal(f.runner.memory.seenMessages.size, 0);
    assert.equal(JSON.parse(readFileSync(f.options.checkpointPath)).lastSeq, 0);
    f.runner.saveCheckpoint = save; await f.runner.connect(); assert.equal(f.runner.lastSeq, 2);
  } finally { f.close(); }
});

test('R06: cursor-ahead reconnect clears future memory and stale pending writes', async () => {
  const f = fixture(3);
  try {
    f.runner.lastSeq = 200; f.runner.timelineEpoch = f.state.epoch;
    f.runner.memory.ingestReadSnapshot({ messages: [message(200, 'DELETED_FUTURE')] });
    f.runner.pendingAskCommands.set('old-ask', { commandId: 'old', answer: 'FUTURE_ANSWER' });
    await f.runner.connect(); assert.equal(f.runner.lastSeq, 3); assert.equal(f.runner.pendingAskCommands.size, 0);
    assert.doesNotMatch(JSON.stringify(f.runner.memory.serializeState()), /DELETED_FUTURE/);
  } finally { f.close(); }
});

test('R06: rewind with a higher new counter still resyncs via epoch and next poll succeeds', async () => {
  const f = fixture(3);
  try {
    await f.runner.connect(); f.runner.pendingAskCommands.set('old', { commandId: 'old', answer: 'FUTURE_ANSWER' });
    f.state.epoch = 'b'.repeat(64); f.state.messages = Array.from({ length: 5 }, (_, index) => message(index + 1, 'REWOUND'));
    assert.equal(await f.runner.pollTick(), true); assert.equal(f.runner.lastSeq, 5);
    assert.equal(f.runner.timelineEpoch, f.state.epoch); assert.equal(f.runner.pendingAskCommands.size, 0);
    assert.doesNotMatch(JSON.stringify(f.runner.memory.serializeState()), /CURRENT/);
    assert.equal(await f.runner.pollTick(), true);
    assert.equal(JSON.parse(readFileSync(f.options.checkpointPath)).timelineEpoch, f.state.epoch);
  } finally { f.close(); }
});

test('R06: byte-page conflicts restart the complete read without erasing durable history', async () => {
  const f = fixture(45); let failed = false;
  try {
    f.state.intercept = (action, params) => {
      if (!failed && action === 'narrator.read' && params.projection === 'full' && params.pageCursor) {
        failed = true; return Response.json({ error: 'Snapshot changed while paging' }, { status: 409 });
      }
      return null;
    };
    await f.runner.connect(); assert.equal(f.runner.lastSeq, 45); assert.equal(f.runner.memory.seenMessages.size, 45);
    assert.equal(f.state.requests.filter(request => request.params.projection === 'full' && !request.params.pageCursor).length, 2);
  } finally { f.close(); }
});

test('R06: non-advancing story cursor is rejected without acknowledgement', async () => {
  const f = fixture(3);
  try {
    f.state.intercept = (action, params) => action === 'narrator.read' && params.projection === 'full'
      ? Response.json({ ok: true, result: { currentSeq: 3, nextCursor: 0, hasMore: true, messages: [] } }) : null;
    await assert.rejects(f.runner.connect(), /cursor did not advance/); assert.equal(f.runner.lastSeq, 0);
  } finally { f.close(); }
});

test('R06: page integrity, duplicate scalars, array gaps and missing tails are rejected', () => {
  const pages = pagesFor({ currentSeq: 3, messages: [message(1), message(2), message(3)] }, 2);
  assert.equal(assembleReadPages(pages).messages.length, 3);
  assert.throws(() => assembleReadPages(pages.slice(0, -1)), /Incomplete/);
  const duplicate = structuredClone(pages); duplicate[0].entries.push({ key: 'currentSeq', value: 3 });
  assert.throws(() => assembleReadPages(duplicate), /Duplicate/);
  const gap = structuredClone(pages); gap[0].entries[1].index = 1;
  assert.throws(() => assembleReadPages(gap), /array gap/);
  const tampered = structuredClone(pages); tampered.at(-1).entries.at(-1).value.content = 'TAMPERED';
  assert.throws(() => assembleReadPages(tampered), /integrity/);
});

test('R06: an unconfirmed Ask conflict is not marked delivered', async () => {
  const f = fixture(0);
  try {
    f.runner.askResponder = async () => ({ answer: 'Private answer.', citations: [] });
    f.state.intercept = action => action === 'narrator.answer_ask' ? Response.json({ error: 'conflict' }, { status: 409 }) : null;
    await f.runner.handlePendingAsk({ id: 'ask', version: 2, question: 'Question' });
    assert.equal(f.runner.answeredAsks.has('ask'), false); assert.equal(f.runner.pendingAskCommands.size, 0);
    assert.equal(f.state.requests.filter(request => request.action === 'narrator.answer_ask').length, 1);
    assert.equal(JSON.parse(readFileSync(f.options.checkpointPath)).answeredAsks.length, 0);
  } finally { f.close(); }
});

test('R06: actual narrator dispatcher rejects stale epoch before command execution', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,created_at TEXT,payload_json TEXT,type TEXT)');
  const campaignId = '11111111-1111-4111-8111-111111111111';
  let executions = 0;
  class CommandError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  const chain = new Proxy({}, { get: (_target, key) => key === 'safeParse' ? data => ({ success: true, data }) : () => chain });
  const campaign = { id: campaignId, kind: 'campaign', status: 'active', dmUserId: 'DM', floor: { mode: 'open' }, gameSettings: { dmMode: 'human' } };
  const overrides = {
    z: chain, getDatabase: () => sqlite, getCampaignById: () => campaign, getFloor: () => ({ mode: 'hold', next: { mode: 'open' } }),
    listOpenPendingRolls: () => [], queueSkippedCombatTurn: () => {}, coverInEffect: () => false,
    NarratorCommandError: CommandError, SPATIAL_NARRATOR_OPERATIONS: {}, SPATIAL_NARRATOR_CATALOG: [],
    executeNarratorCommand: args => { executions++; return args.work(args.loadState()); },
    consoleAdjudications: () => [], publishPersisted: () => {}, setFloor: () => {},
  };
  const context = vm.createContext({ console, Buffer, crypto: (await import('node:crypto')).webcrypto });
  const sourcePath = new URL('../src/lib/mcp-narrator-control.ts', import.meta.url);
  const source = stripTypeScriptTypes(readFileSync(sourcePath, 'utf8'));
  const exportsByModule = new Map();
  for (const match of source.matchAll(/(?:import|export)\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = exportsByModule.get(match[2]) || new Set();
    for (const spec of match[1].split(',')) names.add(spec.trim().split(/\s+as\s+/)[0]);
    exportsByModule.set(match[2], names);
  }
  const cache = new Map();
  async function resolve(name) {
    if (cache.has(name)) return cache.get(name);
    let vmModule;
    if (name === '@/lib/spatial/timeline') {
      vmModule = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/lib/spatial/timeline.ts', import.meta.url), 'utf8')), { context });
    } else {
      const native = name.startsWith('node:') ? await import(name) : {};
      const names = name.startsWith('node:') ? Object.keys(native) : [...(exportsByModule.get(name) || ['getDatabase'])];
      const values = Object.fromEntries(names.map(key => [key, native[key] ?? overrides[key] ?? (() => undefined)]));
      vmModule = new vm.SyntheticModule(names, function () { for (const key of names) this.setExport(key, values[key]); }, { context });
    }
    cache.set(name, vmModule); await vmModule.link(resolve); return vmModule;
  }
  try {
    const dispatcher = new vm.SourceTextModule(source, { context }); await dispatcher.link(resolve); await dispatcher.evaluate();
    const epochModule = cache.get('@/lib/spatial/timeline'), epoch = epochModule.namespace.campaignTimelineEpoch(campaignId);
    for (const action of ['narrator.read', 'narrator.invoke', 'narrator.answer_ask', 'narrator.release_floor']) {
      await assert.rejects(dispatcher.namespace.executeMcpNarratorControl(action, { campaignId, timelineEpoch: 'f'.repeat(64) }), error => error.status === 409 && error.code === 'timeline_changed');
    }
    assert.equal(executions, 0);
    const result = await dispatcher.namespace.executeMcpNarratorControl('narrator.release_floor', { campaignId, timelineEpoch: epoch, expectedSeq: 0 });
    assert.equal(result.handled, true); assert.equal(executions, 1);
    sqlite.prepare('INSERT INTO campaign_events VALUES(?,?,?,?,?)').run(campaignId, 1, 'fixed', '{"nonce":"rewind"}', 'campaign_rewound');
    await assert.rejects(dispatcher.namespace.executeMcpNarratorControl('narrator.release_floor', { campaignId, timelineEpoch: epoch, expectedSeq: 0 }));
    assert.equal(executions, 1);
  } finally { sqlite.close(); }
});
