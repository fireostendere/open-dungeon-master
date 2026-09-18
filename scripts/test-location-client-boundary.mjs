// Execute the actual TS route and hook with narrow dependency doubles.
// This is a lifecycle/API regression, not a real-browser acceptance result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { LocationCommandClient } from '../src/lib/spatial/client-commands.mjs';

async function load(path, dependencies, extras = {}) {
  const context = vm.createContext({ console, URL, Request, Response, TextEncoder, TextDecoder, AbortController, Uint8Array, ...extras });
  const module = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8')), { context });
  await module.link(name => {
    const values = dependencies[name]; assert.ok(values, `Missing test dependency ${name}`);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate(); return module.namespace;
}

test('R13: actual hook refuses old pending at a new identity before and after effect cleanup', async () => {
  const cells = []; let cursor = 0; let effects = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial;
      return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useCallback: callback => callback,
    useEffect(callback, deps) { const index = cursor++; const previous = cells[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.(); cells[index] = { deps, cleanup: callback() };
      }); },
  };
  const sent = [];
  const fetchImpl = async (url, options = {}) => {
    if (options.method !== 'POST') return Response.json({ enabled: false });
    sent.push({ url, body: JSON.parse(options.body) }); throw new Error('Lost response after commit');
  };
  class TestClient extends LocationCommandClient { constructor(options) { super({ ...options, fetchImpl, uuid: () => 'stable-test-id' }); } }
  const module = await load('../src/app/campaigns/[campaignId]/useLocationChat.ts', {
    react: hooks, '@/lib/spatial/client-commands.mjs': { LocationCommandClient: TestClient },
  }, { fetch: fetchImpl, setTimeout: () => 1, clearTimeout: () => {} });
  const render = (campaign, user, commit = true) => {
    cursor = 0; const hook = module.useLocationChat(campaign, user);
    if (commit) { for (const apply of effects) apply(); effects = []; }
    return hook;
  };
  const first = render('A', 'A');
  assert.equal(await first.command({ operation: 'send', kind: 'ooc', content: 'ONLY_A' }), false);
  assert.equal(render('A', 'A').pending, true);
  const second = render('B', 'B', false);
  assert.equal(second.pending, false); assert.equal(await second.retry(), false);
  for (const apply of effects) apply(); effects = [];
  assert.equal(await second.retry(), false); assert.equal(await first.retry(), false);
  assert.equal(sent.length, 1); assert.match(sent[0].url, /campaigns\/A/);
});

test('R13: actual location API rejects a stale actor header before reading or writing private data', async () => {
  let reads = 0, writes = 0;
  const schema = new Proxy({}, { get: (_target, name) => name === 'safeParse' ? data => ({ success: true, data }) : () => schema });
  class SpatialError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const context = { user: { id: 'B' }, campaign: { id: 'campaign' } };
  const route = await load('../src/app/api/campaigns/[campaignId]/location-chat/route.ts', {
    'node:crypto': { createHash }, zod: { z: schema },
    '@/lib/campaign-api': { requireMember: async () => context, requireVoice: async () => context, isErrorResponse: value => value instanceof Response },
    '@/lib/ingress-budget': { enforcePlayerIngress: () => null },
    '@/lib/spatial/service': { SpatialError, spatialContext: () => ({ actor: {} }),
      spatialStore: () => ({ view: () => { reads++; return { enabled: false }; } }),
      runSpatialCommand: () => { writes++; return { ok: true }; } },
  });
  const params = { params: Promise.resolve({ campaignId: 'campaign' }) };
  const headers = { 'X-ODM-Actor': 'A', 'Content-Type': 'application/json' };
  assert.equal((await route.GET(new Request('http://local/location-chat', { headers }), params)).status, 409);
  assert.equal((await route.POST(new Request('http://local/location-chat', { method: 'POST', headers, body: '{}' }), params)).status, 409);
  assert.equal(reads, 0); assert.equal(writes, 0);
  assert.equal((await route.GET(new Request('http://local/location-chat', { headers: { 'X-ODM-Actor': 'B' } }), params)).status, 200);
  assert.equal(reads, 1);
});
