import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { probeConnection } from '../src/lib/provider-auth/connections.mjs';
import { withOperationSignal } from '../src/lib/operation-scope.mjs';

const target = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' };
function backend({ wait = 0, signals = [], onCall = () => {} } = {}) {
  return async (url, init) => {
    signals.push(init.signal); onCall();
    await delay(wait, undefined, { signal: init.signal });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
    const body = JSON.parse(init.body);
    if (body.tool_choice === 'auto') return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'probe-1', type: 'function', function: { name: 'probe_echo', arguments: '{"word":"куб","n":7}' } }] } }] });
    if (body.tool_choice === 'none') assert.equal(body.messages.at(-1).tool_call_id, 'probe-1');
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'готово' } }] });
  };
}
test('all probe stages succeed and preserve the original tool-call ID', async () => {
  const signals = [];
  const report = await probeConnection(target, { fetchImpl: backend({ signals }) });
  assert.equal(report.ok, true);
  assert.deepEqual(Object.keys(report.stages), ['models', 'chat', 'tool_call', 'tool_result']);
  assert.equal(signals[1], signals[2]); assert.equal(signals[2], signals[3]);
});
test('timeout is a total budget, not four fresh budgets', async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(probeConnection(target, { timeoutMs: 80, fetchImpl: backend({ wait: 35, onCall: () => calls++ }) }), { name: 'TimeoutError' });
  assert.equal(calls, 3);
  assert.ok(Date.now() - started < 150);
});
test('caller cancellation stops the probe and does not begin the next stage', async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = probeConnection(target, { signal: controller.signal, fetchImpl: backend({ wait: 100, onCall: () => calls++ }) });
  await delay(10); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('control-plane operation scope reaches nested provider calls', async () => {
  const controller = new AbortController();
  const pending = withOperationSignal(controller.signal, () => probeConnection(target, { fetchImpl: backend({ wait: 100 }) }));
  await delay(10); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('a pre-aborted operation makes no provider request', async () => {
  let calls = 0;
  await assert.rejects(probeConnection(target, { signal: AbortSignal.abort(), fetchImpl: backend({ onCall: () => calls++ }) }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

import { fileURLToPath } from 'node:url';
import { loadReviewModule } from './lib/review-module.mjs';
import * as core from '../src/lib/provider-auth/core.mjs';
import * as connections from '../src/lib/provider-auth/connections.mjs';
import * as scope from '../src/lib/operation-scope.mjs';
import * as guard from '../src/lib/safe-endpoint.mjs';
function providerActions(probe) {
  const writes = []; let saved;
  const loaded = loadReviewModule(fileURLToPath(new URL('../src/lib/provider-auth/actions.ts', import.meta.url)), {
    './service.mjs': {}, './core.mjs': core,
    './connections.mjs': { ...connections, probeConnection: probe },
    '../operation-scope.mjs': scope, '@/lib/url-guard': guard,
    '@/lib/schemas/llm-profile': { maskLlmProfile: p => p },
    '@/lib/db/llm-profiles': {
      createLlmProfile: config => { writes.push('create'); return saved = { ...config, id: 'saved-profile' }; },
      updateLlmProfileCheck: (id, check) => { writes.push('check'); return saved = { ...saved, lastCheck: check }; },
      applyLlmProfileToGlobal: () => { writes.push('apply'); return true; },
      getLlmProfile: () => saved, listLlmProfiles: () => [],
    },
  });
  return { ...loaded, writes };
}
const candidate = { action: 'connect', provider: 'qwen-local', model: 'fixture', apply: true };
test('abort after the probe but before persistence creates/applies nothing', async () => {
  const controller = new AbortController();
  const actions = providerActions(async () => { controller.abort(); return { ok: true, stages: {} }; });
  await assert.rejects(actions.performProviderAction('test', candidate, undefined, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(actions.writes, []);
});
test('failed transport leaves no partially-created profile', async () => {
  const actions = providerActions(async () => { throw new DOMException('Timed out', 'TimeoutError'); });
  await assert.rejects(actions.performProviderAction('test', candidate), { name: 'TimeoutError' });
  assert.deepEqual(actions.writes, []);
});
test('successful non-applying probe saves its report without changing settings', async () => {
  const actions = providerActions(config => probeConnection(config, { fetchImpl: backend() }));
  const result = await actions.performProviderAction('test', { ...candidate, apply: false });
  assert.equal(result.report.ok, true); assert.equal(result.applied, false);
  assert.deepEqual(actions.writes, ['create', 'check']);
});
test('successful applying probe saves its verified report before applying', async () => {
  const actions = providerActions(config => probeConnection(config, { fetchImpl: backend() }));
  const result = await actions.performProviderAction('test', candidate);
  assert.equal(result.applied, true);
  assert.deepEqual(actions.writes, ['create', 'check', 'apply']);
});
test('concurrent request scopes do not cancel each other', async () => {
  const cancelled = new AbortController(); const alive = new AbortController();
  const a = withOperationSignal(cancelled.signal, () => probeConnection(target, { fetchImpl: backend({ wait: 20 }) }));
  const b = withOperationSignal(alive.signal, () => probeConnection(target, { fetchImpl: backend() }));
  cancelled.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal((await b).ok, true);
});
