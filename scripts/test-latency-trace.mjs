import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitLatency, latencyEnabled, withLatencyTrace, withNewLatencyTrace } from '../mcp/latency-trace.mjs';
import { createControlClient } from '../mcp/control-client.mjs';
import { atomicWriteJson } from '../narrator/checkpoint-io.mjs';
import { consumePostWriteRead } from '../narrator/read-session.mjs';

test('latency events allow only content-free fields and use opaque correlation IDs', () => {
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    process.env.ODM_LATENCY_LOG = '1';
    withLatencyTrace(() => emitLatency({ stage: 'adapter_model', durationMs: 1.8, role: 'referee', inputBytes: 12,
      content: 'player text', prompt: 'secret prompt', campaignId: 'private-room', ask: 'private Ask', token: 'credential' }));
  } finally { delete process.env.ODM_LATENCY_LOG; console.error = original; }
  assert.equal(logged.length, 1);
  const event = JSON.parse(logged[0].replace('[odm-latency] ', ''));
  assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'inputBytes', 'role', 'stage', 'traceId']);
  assert.match(event.traceId, /^[a-f0-9]{32}$/);
  assert.ok(!logged[0].includes('player text') && !logged[0].includes('secret prompt') && !logged[0].includes('private-room'));
});

test('disabled tracing does not emit or create a trace', () => {
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args);
  try { delete process.env.ODM_LATENCY_LOG; assert.equal(latencyEnabled(), false); assert.equal(withLatencyTrace(() => emitLatency({ stage: 'mcp_read', durationMs: 1 })), undefined); }
  finally { console.error = original; }
  assert.deepEqual(logged, []);
});

test('control timing never exposes request or private response values and callback failures are isolated', async () => {
  const timings = [];
  const client = createControlClient({ token: 'secret-token', onTiming: event => { timings.push(event); throw new Error('telemetry failed'); },
    fetchImpl: async () => Response.json({ ok: true, result: { answer: 'private Ask', content: 'player text', roomId: 'private room' } }) });
  const result = await client('narrator.read', { campaignId: 'campaign secret', prompt: 'model prompt', content: 'player text', ask: 'private Ask' });
  assert.equal(result.answer, 'private Ask');
  assert.deepEqual(Object.keys(timings[0]).sort(), ['durationMs', 'mcpCalls', 'responseBytes', 'stage', 'status', 'traceId']);
  assert.equal(timings[0].stage, 'mcp_read');
  assert.ok(!JSON.stringify(timings).includes('private Ask') && !JSON.stringify(timings).includes('player text') && !JSON.stringify(timings).includes('private room'));
});

test('a malicious timing callback cannot alter the logged sanitized event', () => {
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    process.env.ODM_LATENCY_LOG = '1';
    emitLatency({ stage: 'mcp_read', durationMs: .125 }, { onTiming: event => { assert.throws(() => { event.traceId = 'secret trace'; }); throw new Error('telemetry failed'); } });
  } finally { delete process.env.ODM_LATENCY_LOG; console.error = original; }
  const event = JSON.parse(logged[0].slice(14));
  assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'stage', 'traceId']);
  assert.match(event.traceId, /^[a-f0-9]{32}$/); assert.equal(logged[0].includes('secret trace'), false);
});

test('trace nesting groups a turn while a private worker gets a separate opaque trace', () => {
  const logged = [], original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    process.env.ODM_LATENCY_LOG = '1';
    withLatencyTrace(() => { emitLatency({ stage: 'mcp_read', durationMs: .125 }); emitLatency({ stage: 'narrator_model', durationMs: .25 }); });
    withNewLatencyTrace(() => emitLatency({ stage: 'mcp_ask', durationMs: .5 }));
  } finally { delete process.env.ODM_LATENCY_LOG; console.error = original; }
  const events = logged.map(line => JSON.parse(line.slice(14)));
  assert.equal(events[0].traceId, events[1].traceId); assert.notEqual(events[0].traceId, events[2].traceId);
  assert.equal(events[0].durationMs, .125);
});

test('failed checkpoint emits no successful write count after fsync failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-checkpoint-')), file = path.join(dir, 'state.json'), logged = [], originalLog = console.error, originalFsync = fs.fsyncSync;
  console.error = (...args) => logged.push(args.join(' '));
  let calls = 0; fs.fsyncSync = fd => { if (++calls === 2) throw new Error('directory fsync failed'); return originalFsync(fd); };
  try {
    process.env.ODM_LATENCY_LOG = '1';
    assert.throws(() => atomicWriteJson(file, { formatVersion: 3, memory: {}, lastSeq: 1 }), /directory fsync failed/);
  } finally { delete process.env.ODM_LATENCY_LOG; fs.fsyncSync = originalFsync; console.error = originalLog; fs.rmSync(dir, { recursive: true, force: true }); }
  const events = logged.map(line => JSON.parse(line.slice(14))), write = events.find(event => event.stage === 'checkpoint_write');
  assert.deepEqual({ writeCount: write.writeCount, attemptCount: write.attemptCount, errorCount: write.errorCount, ok: write.ok }, { writeCount: 0, attemptCount: 1, errorCount: 1, ok: false });
  assert.equal(events.some(event => event.stage === 'checkpoint_directory_fsync'), false);
});

test('post-write fallback timing waits for delayed resolution and rejection', async () => {
  const logged = [], original = console.error, host = { drainStory: async () => { await new Promise(resolve => setTimeout(resolve, 12)); return { currentSeq: 1 }; } };
  console.error = (...args) => logged.push(args.join(' '));
  try {
    process.env.ODM_LATENCY_LOG = '1';
    await consumePostWriteRead(host, { readRequired: true });
    host.drainStory = async () => { await new Promise(resolve => setTimeout(resolve, 12)); throw new Error('read failed'); };
    await assert.rejects(consumePostWriteRead(host, { readRequired: true }), /read failed/);
  } finally { delete process.env.ODM_LATENCY_LOG; console.error = original; }
  const events = logged.map(line => JSON.parse(line.slice(14))).filter(event => event.stage === 'post_write_read');
  assert.equal(events.length, 2); assert.ok(events.every(event => event.durationMs >= 8));
});

test('packaged sidecar import uses only flattened sibling modules', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-mcp-package-'));
  try {
    for (const file of ['control-client.mjs', 'dm-policy.mjs', 'latency-trace.mjs']) fs.copyFileSync(path.resolve(import.meta.dirname, '../mcp', file), path.join(dir, file));
    await import(`${new URL(`file://${path.join(dir, 'control-client.mjs')}`).href}?package-test`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('summarizer reports p50/p95 and distinct safe aggregates from prefixed or raw JSONL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-latency-'));
  const file = path.join(dir, 'trace.log');
  try {
    fs.writeFileSync(file, '[odm-latency] {"stage":"adapter_model","role":"referee","durationMs":10,"inputBytes":20,"outputBytes":3,"modelCalls":1}\nmalformed secret prompt\n{"stage":"adapter_model","role":"referee","durationMs":30,"inputBytes":40,"outputBytes":5,"modelCalls":1}\n{"stage":"checkpoint_write","durationMs":1,"writeCount":1,"attemptCount":1}\n');
    const output = execFileSync(process.execPath, ['scripts/summarize-latency.mjs', file], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.match(output, /adapter_model\s+referee\s+2\s+20\.000\s+29\.000\s+0\s+60\s+8\s+0\s+2/);
    assert.match(output, /checkpoint_write\s+-\s+1\s+1\.000\s+1\.000\s+0\s+0\s+0\s+0\s+0\s+0\s+0\s+0\s+1\s+1\s+0/);
    assert.ok(!output.includes('secret prompt'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
