import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { driveNarratorCycle, startAskWorker, narratorPollDelay } from '../narrator/poll-cycle.mjs';
import { drainNarratorStory } from '../narrator/read-session.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function moduleAt(relative, mocks) {
  const url = new URL(relative, import.meta.url);
  const context = vm.createContext({ URL, Buffer, AbortSignal, structuredClone, performance, console, process, setTimeout, clearTimeout });
  const module = new vm.SourceTextModule(fs.readFileSync(url, 'utf8'), { context, identifier: fileURLToPath(url), initializeImportMeta: meta => { meta.url = url.href; } });
  await module.link(async name => {
    const values = mocks[name] ?? await import(name);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate(); return module.namespace;
}
function host(overrides = {}) {
  return { campaignId: 'c', timelineEpoch: 'e', stopping: false, askTask: null, askResponder: () => {},
    pendingAskCommands: new Map(), pendingAskAttempts: new Map(), answeredAsks: new Set(),
    callControl: async (action, params) => {
      assert.equal(action, 'narrator.read');
      assert.equal(params.includeAsks, true);
      return { campaign: { id: 'c' }, currentSeq: 10, nextCursor: 10, hasMore: false, timelineEpoch: 'e',
        asks: [{ id: 'q1' }, { id: 'q2' }], askQueue: { nextCursor: 2, hasMore: false } };
    },
    drainStory: async () => ({ currentSeq: 10, nextCursor: 10, hasMore: false, timelineEpoch: 'e',
      asks: [], askQueue: { nextCursor: 0, hasMore: false, pending: true } }),
    storyController: { tick: async () => true }, ...overrides };
}

test('ordinary drains use live projection; bootstrap and roll recovery can explicitly request full', async () => {
  const modes = [];
  const h = { campaignId: 'c', timelineEpoch: 'e', lastSeq: 0,
    readSnapshot: async p => { modes.push(p.projection); return { currentSeq: 1, nextCursor: 1, hasMore: false, messages: [], timelineEpoch: 'e' }; },
    memory: { serializeState: () => ({}), ingestReadSnapshot: () => {}, restoreState: () => {} }, saveCheckpoint: () => {} };
  await drainNarratorStory(h); await drainNarratorStory(h, { full: true });
  assert.deepEqual(modes, ['live', 'full']); assert.equal(h.lastSeq, 1);
});

test('productive steps do not sleep; idle and failed polls retain backoff', () => {
  assert.equal(narratorPollDelay({ madeProgress: true, lastError: null, pollIntervalMs: 2000 }), 0);
  assert.equal(narratorPollDelay({ madeProgress: false, lastError: null, pollIntervalMs: 2000 }), 2000);
  assert.equal(narratorPollDelay({ madeProgress: true, lastError: 'failed', pollIntervalMs: 2000 }), 2000);
});

test('empty Ask metadata avoids a second MCP read', async () => {
  let reads = 0;
  const h = host({ callControl: async () => { reads++; throw new Error('Ask read should not run'); } });
  const result = startAskWorker(h, { currentSeq: 10, timelineEpoch: 'e', asks: [], askQueue: { pending: false, hasMore: false } });
  assert.equal(result, null);
  assert.equal(reads, 0);
});

test('stalled Ask does not block story and only one Ask worker runs', async () => {
  const gate = deferred(); let calls = 0, stories = 0;
  const h = host({ handlePendingAsk: async () => { calls++; await gate.promise; }, storyController: { tick: async () => { stories++; return true; } } });
  await driveNarratorCycle(h); await driveNarratorCycle(h);
  assert.equal(stories, 2); assert.equal(calls, 1); assert.ok(h.askTask);
  const task = h.askTask; gate.resolve(); await task; assert.equal(h.askTask, null);
});

test('Ask batch budget is enforced without dropping unprocessed questions', async () => {
  const ids = []; const h = host({ maxAsksPerTick: 1, handlePendingAsk: async ask => { ids.push(ask.id); h.answeredAsks.add(ask.id); } });
  const snapshot = await h.drainStory();
  await startAskWorker(h, snapshot); await startAskWorker(h, snapshot);
  assert.deepEqual(ids, ['q1', 'q2']);
});

test('changed timeline or stopping discards queued private work', async () => {
  for (const change of [h => { h.timelineEpoch = 'new'; }, h => { h.stopping = true; }]) {
    let calls = 0; const h = host({ handlePendingAsk: async () => { calls++; } });
    const task = startAskWorker(h, await h.drainStory()); change(h); await task;
    assert.equal(calls, 0); assert.equal(h.askTask, null);
  }
});

test('Ask errors are contained and cannot become unhandled rejections or stop story', async () => {
  const h = host({ handlePendingAsk: async () => { throw new Error('private question'); } });
  await driveNarratorCycle(h); await h.askTask;
  assert.equal(h.madeProgress, true); assert.equal(h.askError, 'ask_failed');
});

test('blocked Ask page advances using an isolated read cache and fixed cursor', async () => {
  const requests = [], ids = [], cache = { scope: 'unrelated', values: {}, versions: {} };
  const h = host({ sectionCache: cache, deltaReads: true, readPageRetries: 0, readMaxBytes: 65536,
    pendingAskAttempts: new Map([['q1', 2]]),
    handlePendingAsk: async ask => ids.push(ask.id),
    callControl: async (action, params) => {
      requests.push({ action, params });
      if (requests.length === 1) return { campaign: { id: 'c' }, currentSeq: 10, nextCursor: 10, hasMore: false,
        timelineEpoch: 'e', asks: [{ id: 'q1' }], askQueue: { hasMore: true, nextCursor: 8 } };
      return { campaign: { id: 'c' }, currentSeq: 10, nextCursor: 10, hasMore: false,
        timelineEpoch: 'e', asks: [{ id: 'q3' }], askQueue: { hasMore: false, nextCursor: 9 } };
    } });
  await startAskWorker(h, { currentSeq: 10, timelineEpoch: 'e', asks: [], askQueue: { hasMore: false, pending: true } });
  assert.deepEqual(ids, ['q3']);
  assert.equal(requests[0].params.afterSeq, 10); assert.equal(requests[0].params.afterAskSeq, 0);
  assert.equal(requests[0].params.includeAsks, true);
  assert.equal(requests[1].params.afterAskSeq, 8);
  assert.equal(h.sectionCache, cache); assert.equal(h.askBlocked, true);
});

const runner = await moduleAt('../narrator/run.mjs', {
  './checkpoint-io.mjs': { atomicWriteJson: () => {}, readJsonSafe: () => null },
  './semantic-gate.mjs': { classifyInput: () => ({ decision: 'allow' }), DM_REFUSALS: { ru: 'refusal' } },
  './cost-tracker.mjs': { NarratorCostTracker: class {} }, './compaction.mjs': { HostContextMemory: class {} },
  './read-session.mjs': { connectNarrator: () => {}, drainNarratorStory: () => {}, readNarratorSnapshot: () => {} },
  './poll-cycle.mjs': { driveNarratorCycle, narratorPollDelay },
});
function askHost(responder) {
  return host({ askResponder: responder, memory: { getPromptContext: scope => ({ viewerUserId: scope.viewerUserId }) },
    saveCheckpoint: () => {}, costTracker: { recordUsage: () => {} } });
}

test('actual Ask handler discards model output generated before a rewind', async () => {
  const gate = deferred(); let writes = 0;
  const h = askHost(async (_ask, context) => { assert.equal(context.viewerUserId, 'alice'); return gate.promise; });
  h.callControl = async () => { writes++; };
  const work = runner.NarratorRunner.prototype.handlePendingAsk.call(h, { id: 'q', userId: 'alice', question: 'game' });
  await tick(); h.timelineEpoch = 'new'; gate.resolve({ answer: 'old private answer' }); await work;
  assert.equal(writes, 0); assert.equal(h.pendingAskCommands.size, 0); assert.equal(h.answeredAsks.size, 0);
});

test('ambiguous Ask retries retain exact persisted UUID and stop after two attempts', async () => {
  const h = askHost(async () => ({ answer: 'private answer' })); const commands = []; let generations = 0;
  h.askResponder = async () => { generations++; return { answer: 'private answer' }; };
  h.callControl = async (_action, params) => { commands.push(JSON.stringify(params)); throw new Error('transport'); };
  const ask = { id: 'q', userId: 'alice', question: 'game', version: 0 };
  for (let n = 0; n < 2; n++) await assert.rejects(runner.NarratorRunner.prototype.handlePendingAsk.call(h, ask));
  await runner.NarratorRunner.prototype.handlePendingAsk.call(h, ask);
  assert.equal(generations, 1); assert.equal(commands.length, 2); assert.equal(commands[0], commands[1]); assert.equal(h.askBlocked, true);
});

const adapterModule = await moduleAt('../narrator/opencode-adapter.mjs', { './role-profiles.mjs': { trustedInstruction: role => `trusted ${role}` } });
function adapterFixture({ fail = false, cleanupTimeoutMs = 50 } = {}) {
  const cleanup = deferred(), requests = [], timings = []; let sessions = 0;
  const adapter = new adapterModule.OpenCodeAdapter({ endpoint: 'http://127.0.0.1:8000', model: { providerID: 'test', id: 'test' },
    workspace: process.cwd(), cleanupTimeoutMs, onTiming: value => timings.push(value),
    fetchImpl: async (url, options) => {
      requests.push({ path: url.pathname, method: options.method, body: options.body });
      if (options.method === 'DELETE') return cleanup.promise;
      if (url.pathname === '/api/session') { const body = JSON.parse(options.body); return Response.json({ id: `ses${++sessions}`, agent: body.agent, model: body.model }); }
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      return Response.json({ text: fail ? '' : 'approved prose' });
    } });
  return { adapter, cleanup, requests, timings };
}

test('actual adapter returns completed answer before DELETE and keeps sessions isolated', async () => {
  const { adapter, cleanup, requests, timings } = adapterFixture();
  const answer = await adapter.generate('referee', 'private input');
  assert.equal(answer, 'approved prose'); assert.equal(adapter.pendingCleanups.size, 1);
  await adapter.generate('writer', 'public draft'); assert.equal(adapter.pendingCleanups.size, 2);
  assert.equal(requests.filter(r => r.path === '/api/session').length, 2);
  assert.deepEqual(requests.filter(r => r.method === 'DELETE').map(r => r.path), ['/api/session/ses1', '/api/session/ses2']);
  cleanup.resolve(new Response(null, { status: 204 })); await adapter.close(); await tick();
  assert.equal(adapter.pendingCleanups.size, 0);
  assert.ok(timings.every(value => /^adapter_(session|policy|model|cleanup)$/.test(value.stage) && Number.isFinite(value.durationMs) && Number.isFinite(value.responseBytes)));
  assert.ok(!JSON.stringify(timings).includes('private input'));
});

test('failed generation still cleans only its own session without masking the error', async () => {
  const { adapter, cleanup, requests } = adapterFixture({ fail: true });
  await assert.rejects(adapter.generate('referee', 'input'), /Malformed/);
  assert.equal(requests.at(-1).method, 'DELETE'); assert.equal(adapter.pendingCleanups.size, 1);
  cleanup.resolve(new Response(null, { status: 204 })); await adapter.close();
});

test('cleanup has an independent short abort deadline', async () => {
  let signal;
  const adapter = new adapterModule.OpenCodeAdapter({ endpoint: 'http://127.0.0.1:8000', model: { providerID: 'test', id: 'test' },
    workspace: process.cwd(), timeoutMs: 120000, cleanupTimeoutMs: 5,
    fetchImpl: async (_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  adapter.cleanup('/api/session/ses1'); await new Promise(resolve => setTimeout(resolve, 15)); await adapter.close();
  assert.equal(signal.aborted, true); assert.equal(adapter.pendingCleanups.size, 0);
});

test('actor generation uses its own shorter abort deadline', async () => {
  let actorSignal;
  let sessions = 0;
  const adapter = new adapterModule.OpenCodeAdapter({
    endpoint: 'http://127.0.0.1:8000',
    model: { providerID: 'test', id: 'test' },
    workspace: process.cwd(),
    timeoutMs: 120000,
    actorTimeoutMs: 5,
    cleanupTimeoutMs: 20,
    fetchImpl: async (url, options) => {
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.pathname === '/api/session') {
        const body = JSON.parse(options.body);
        return Response.json({ id: `ses${++sessions}`, agent: body.agent, model: body.model });
      }
      if (options.method === 'PUT') return new Response(null, { status: 204 });
      actorSignal = options.signal;
      return new Promise((_resolve, reject) => {
        actorSignal.addEventListener('abort', () => reject(actorSignal.reason), { once: true });
      });
    },
  });
  await assert.rejects(adapter.generate('actor', 'bounded actor input'));
  assert.equal(actorSignal?.aborted, true);
  await adapter.close();
});
