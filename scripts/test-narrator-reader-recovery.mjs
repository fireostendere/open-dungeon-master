// Execute the real runner with a fake control transport, checkpoint I/O and
// optional fake-model Ask adapter. No paid model, production or browser call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HostContextMemory } from '../narrator/compaction.mjs';

async function runner(options = {}) {
  const saved = [], calls = [], usage = [];
  const deps = {
    'node:http': { default: http }, 'node:path': { default: path }, 'node:crypto': { default: crypto }, 'node:url': { fileURLToPath },
    './checkpoint-io.mjs': { atomicWriteJson: (_file, value) => saved.push(structuredClone(value)), readJsonSafe: () => options.checkpoint ?? null },
    './semantic-gate.mjs': { classifyInput: () => ({ decision: 'allow' }), DM_REFUSALS: { ru: 'Game only' } },
    './cost-tracker.mjs': { NarratorCostTracker: class { getMetrics() { return {}; } recordUsage(value) { usage.push(value); } } },
    './compaction.mjs': { HostContextMemory },
  };
  const context = vm.createContext({ console: { ...console, error() {} }, process, Buffer, structuredClone, URL, AbortSignal, setTimeout, clearTimeout });
  const url = new URL('../narrator/run.mjs', import.meta.url);
  const module = new vm.SourceTextModule(readFileSync(url, 'utf8'), { context, initializeImportMeta: meta => { meta.url = url.href; } });
  await module.link(name => { assert.ok(deps[name], `Missing dependency ${name}`);
    return new vm.SyntheticModule(Object.keys(deps[name]), function () { for (const [key, value] of Object.entries(deps[name])) this.setExport(key, value); }, { context }); });
  await module.evaluate();
  const instance = new module.namespace.NarratorRunner({ campaignId: 'c', token: 'fake-test-token', healthPort: 0,
    readPageRetries: 0, ...options, fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body); calls.push(request);
      const result = await options.control?.(request.action, request.params);
      return Response.json({ ok: true, result });
    } });
  return { instance, saved, calls, usage };
}
const snapshot = (cursor, nextCursor, currentSeq, hasMore, messages = [], extra = {}) => ({
  campaign: { id: 'c' }, cursor, nextCursor, currentSeq, hasMore, messages,
  asks: [], askQueue: { nextCursor: 0, hasMore: false }, ...extra,
});
const message = (seq, content = `m${seq}`) => ({ id: `m${seq}`, seq, content, roomId: 'tavern', witnessUserIds: ['A'], authorType: 'player' });
const ahead = () => Object.assign(new Error('Narrator cursor is ahead of campaign state; reconnect from a fresh read.'), { status: 409 });
function pages(value) {
  const shape = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? 'array' : 'value']));
  const entries = Object.entries(value).flatMap(([key, item]) => Array.isArray(item) ? item.map((value, index) => ({ key, index, value })) : [{ key, value: item }]);
  const hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const split = Math.ceil(entries.length / 2);
  return [
    { format: 'odm.read.page.v1', shape, hash, offset: 0, complete: false, nextPage: 'p2', entries: entries.slice(0, split) },
    { format: 'odm.read.page.v1', shape, hash, offset: split, complete: true, nextPage: null, entries: entries.slice(split) },
  ];
}

test('R06: initial handshake never skips unread private pages', async () => {
  const f = await runner({ control: (action, params) => {
    if (action === 'narrator.connect') return { state: snapshot(0, 1, 3, true, [message(1)]) };
    assert.equal(action, 'narrator.read'); assert.equal(params.projection, 'live');
    return params.afterSeq === 0 ? snapshot(0, 1, 3, true, [message(1)])
      : snapshot(1, 3, 3, false, [message(2), message(3)]);
  } });
  await f.instance.connect();
  assert.deepEqual(f.calls.filter(c => c.action === 'narrator.read').map(c => c.params.afterSeq), [0, 1]);
  assert.equal(f.instance.lastSeq, 3);
  assert.deepEqual(f.instance.memory.messages.map(m => m.id), ['m1', 'm2', 'm3']);
  assert.equal(f.saved.at(-1).lastSeq, 3);
});

test('R06: failed second story page rolls memory back with cursor and retries without losing messages', async () => {
  let fail = true;
  const f = await runner({ control: (_action, params) => {
    if (params.afterSeq === 0) return snapshot(0, 1, 2, true, [message(1)]);
    if (fail) throw new Error('Network failure');
    return snapshot(1, 2, 2, false, [message(2)]);
  } });
  await assert.rejects(f.instance.drainStory(), /Network/);
  assert.equal(f.instance.lastSeq, 0); assert.equal(f.instance.memory.messages.length, 0);
  fail = false; await f.instance.drainStory();
  assert.equal(f.instance.lastSeq, 2); assert.deepEqual(f.instance.memory.messages.map(m => m.id), ['m1', 'm2']);
});

test('R06: byte pages assemble completely before ingest/cursor advancement', async () => {
  const payload = snapshot(0, 2, 2, false, [message(1), message(2)]), chunks = pages(payload);
  const f = await runner({ control: (_action, params) => params.pageCursor ? chunks[1] : chunks[0] });
  await f.instance.drainStory();
  assert.equal(f.instance.lastSeq, 2); assert.equal(f.instance.memory.messages.length, 2);
  assert.equal(f.calls[1].params.afterSeq, 0); assert.equal(f.calls[1].params.pageCursor, 'p2');
});

test('R06: repeated byte-page cursor and wrong hash fail without a partial checkpoint', async () => {
  const chunks = pages(snapshot(0, 1, 1, false, [message(1)]));
  const f = await runner({ control: () => chunks[0] });
  await assert.rejects(f.instance.drainStory(), /cursor did not advance/);
  assert.equal(f.instance.lastSeq, 0); assert.equal(f.instance.memory.messages.length, 0);
  const bad = await runner({ control: (_action, params) => params.pageCursor ? { ...chunks[1], hash: 'wrong' } : chunks[0] });
  await assert.rejects(bad.instance.drainStory(), /Inconsistent/);
  assert.equal(bad.instance.lastSeq, 0);
});

test('R06: poll recovers a rewind once, clears discarded memory and consumes replacement timeline', async () => {
  const f = await runner({ control: (_action, params) => {
    if (params.afterSeq > 2) throw ahead();
    return snapshot(params.afterSeq, 2, 2, false, params.afterSeq === 0 ? [message(1, 'REPLACEMENT')] : []);
  } });
  f.instance.lastSeq = 100;
  f.instance.memory.ingestReadSnapshot({ campaignId: 'c', currentSeq: 100, messages: [message(99, 'DISCARDED_SECRET')] });
  f.instance.answeredAsks.add('old-ask');
  assert.equal(await f.instance.pollTick(), true);
  assert.equal(f.instance.lastSeq, 2); assert.equal(f.instance.answeredAsks.size, 0);
  assert.equal(JSON.stringify(f.instance.memory.serializeState()).includes('DISCARDED_SECRET'), false);
  assert.ok(JSON.stringify(f.instance.memory.serializeState()).includes('REPLACEMENT'));
  assert.deepEqual(f.calls.slice(0, 2).map(c => c.params.afterSeq), [100, 0]);
});

test('R06: an unrelated 409 or network failure does not reset the consumed cursor', async () => {
  const f = await runner({ control: () => { throw Object.assign(new Error('Snapshot changed'), { status: 409 }); } });
  f.instance.lastSeq = 9;
  assert.equal(await f.instance.pollTick(), false);
  assert.equal(f.instance.lastSeq, 9); assert.equal(f.calls.length, 1);
});

test('R06: invalid/nonadvancing story cursors are not accepted as successful drains', async () => {
  for (const data of [snapshot(0, 0, 10, true), snapshot(0, 5, 10, false), snapshot(0, -1, 10, false)]) {
    const f = await runner({ control: () => data });
    await assert.rejects(f.instance.drainStory(), /Invalid story cursor/);
    assert.equal(f.instance.lastSeq, 0);
  }
});

test('R07: collector leaves legitimate Ask pending and never invents an answer or token usage', async () => {
  const f = await runner({ control: () => { throw new Error('Collector must not write'); } });
  await f.instance.handlePendingAsk({ id: 'q', userId: 'A', version: 1, question: 'Can I hide?' });
  assert.equal(f.calls.length, 0); assert.equal(f.usage.length, 0);
  assert.equal(f.instance.answeredAsks.size, 0); assert.equal(f.instance.mode, 'collector');
});

test('R07: real adapter result is published; lost response replays the original UUID without a second model call', async () => {
  let attempts = 0, modelCalls = 0;
  const f = await runner({ askResponder: async () => { modelCalls++; return { answer: 'Adapter answer', citations: [], usage: { promptTokens: 12, completionTokens: 3 } }; },
    control: action => { assert.equal(action, 'narrator.answer_ask'); if (++attempts === 1) throw new Error('Lost after commit'); return { ok: true }; } });
  const ask = { id: 'q', userId: 'A', version: 1, question: 'Can I hide?' };
  await assert.rejects(f.instance.handlePendingAsk(ask), /Lost/);
  await f.instance.handlePendingAsk(ask);
  assert.equal(modelCalls, 1); assert.equal(f.usage.length, 1);
  assert.deepEqual(f.calls[0].params, f.calls[1].params);
  assert.equal(f.instance.answeredAsks.has('q'), true);
});

test('R07: version conflict does not falsely mark a pending Ask answered', async () => {
  const f = await runner({ askResponder: async () => ({ answer: 'A', citations: [] }),
    control: () => { throw Object.assign(new Error('Version changed'), { status: 409 }); } });
  await f.instance.handlePendingAsk({ id: 'q', userId: 'A', question: 'Question', version: 0 });
  assert.equal(f.instance.answeredAsks.has('q'), false); assert.equal(f.instance.pendingAskCommands.size, 0);
});

test('R06: existing valid checkpoint starts from its consumed cursor, not from zero or latest', async () => {
  const f = await runner({ checkpoint: { campaignId: 'c', lastSeq: 5, memory: { summary: 'KNOWN' } }, control: (action, params) => {
    if (action === 'narrator.connect') return { state: snapshot(0, 1, 10, true) };
    assert.equal(params.afterSeq, 5); return snapshot(5, 10, 10, false, [message(6)]);
  } });
  f.instance.loadCheckpoint(); await f.instance.connect();
  assert.equal(f.instance.lastSeq, 10); assert.ok(f.instance.memory.summary.includes('KNOWN'));
});
