import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createServer } from 'node:http';
import * as crypto from 'node:crypto';
import vm from 'node:vm';

const pause = () => new Promise(resolve => setImmediate(resolve));
const ok = () => Response.json({ ok: true });
const OOC = { operation: 'send', roomId: null, kind: 'ooc', content: 'PRIVATE_DRAFT' };
const intentId = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';
const modelInput = { intentId, roomId, expectedRevision: 1, kind: 'do', content: 'ONE_MESSAGE' };

async function loader(stubs = {}, globals = {}) {
  const context = vm.createContext({ console, fetch, Response, Request, URL, URLSearchParams, Headers, CustomEvent, TextDecoder, TextEncoder, AbortController, AbortSignal,
    crypto: crypto.webcrypto, performance, setTimeout, clearTimeout, ...globals });
  const modules = new Map();
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let vmModule;
    if (stubs[name] || name === 'node:crypto') {
      const values = stubs[name] || crypto;
      vmModule = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    } else {
      const path = name.startsWith('@/') ? `../src/${name.slice(2)}${/\.(?:ts|mjs)$/.test(name) ? '' : '.ts'}` : name;
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      vmModule = new vm.SourceTextModule(path.endsWith('.ts') || path.endsWith('.tsx') ? stripTypeScriptTypes(source) : source, { context, identifier: name });
    }
    modules.set(name, vmModule); await vmModule.link(load); return vmModule;
  }
  return async name => { const loaded = await load(name); await loaded.evaluate(); return loaded.namespace; };
}

function hookHarness() {
  const slots = []; let index = 0; const layouts = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const effect = queue => (callback, deps) => {
    const at = index++, previous = slots[at];
    if (!same(previous?.deps, deps)) queue.push(() => {
      previous?.cleanup?.(); const cleanup = callback(); slots[at] = { deps, cleanup };
    });
  };
  const react = {
    useState(initial) {
      const at = index++; if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[at].value, value => { slots[at].value = typeof value === 'function' ? value(slots[at].value) : value; }];
    },
    useMemo(factory, deps) {
      const at = index++; if (!same(slots[at]?.deps, deps)) slots[at] = { deps, value: factory() }; return slots[at].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useLayoutEffect: effect(layouts), useEffect: effect(effects),
  };
  return { react, render(fn) { index = 0; const value = fn(); for (const apply of layouts.splice(0)) apply(); for (const apply of effects.splice(0)) apply(); return value; },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); } };
}

test('R13: uncertain UI retry preserves requestId, frozen input and exact request bytes', async () => {
  const load = await loader(); const { LocationIntentSession } = await load('@/lib/spatial/client-intents');
  const calls = []; let successes = 0;
  const session = new LocationIntentSession({ campaignId: 'c', userId: 'A', uuid: () => intentId, onSuccess: () => successes++,
    fetcher: async (url, init) => { calls.push({ url, ...init }); if (calls.length === 1) throw new Error('response lost'); return ok(); } });
  session.activate(); const input = { ...OOC };
  assert.equal(await session.send(input), false); input.content = 'MUTATED'; assert.equal(session.snapshot().pending, true);
  assert.equal(await session.retry(), true); assert.equal(calls[0].body, calls[1].body); assert.match(calls[1].body, /PRIVATE_DRAFT/); assert.doesNotMatch(calls[1].body, /MUTATED/);
  assert.equal(calls[1].headers['X-ODM-Expected-User'], 'A'); assert.equal(successes, 1); assert.equal(session.snapshot().pending, false);
  session.dispose();
});

test('R13: a different command cannot replace an ambiguous pending intent', async () => {
  const load = await loader(); const { LocationIntentSession } = await load('@/lib/spatial/client-intents'); let calls = 0;
  const session = new LocationIntentSession({ campaignId: 'c', userId: 'A', fetcher: async () => { calls++; return Response.json({}, { status: 503 }); } });
  session.activate(); assert.equal(await session.send(OOC), false);
  assert.equal(await session.send({ ...OOC, content: 'DIFFERENT' }), false); assert.equal(calls, 1); assert.equal(session.snapshot().pending, true);
  session.dispose(); assert.equal(await session.retry(), false); assert.equal(await session.send(OOC), false); assert.equal(calls, 1);
});

test('R13: old completion cannot clear a new generation of the same session', async () => {
  const load = await loader(); const { LocationIntentSession } = await load('@/lib/spatial/client-intents'); const requests = [];
  const session = new LocationIntentSession({ campaignId: 'c', userId: 'A', fetcher: (_url, init) => new Promise(resolve => requests.push({ init, resolve })) });
  session.activate(); const old = session.send(OOC); session.dispose(); session.activate();
  const current = session.send({ ...OOC, content: 'NEW_DRAFT' });
  requests[0].resolve(ok()); assert.equal(await old, false); assert.equal(session.snapshot().pending, true); assert.equal(session.snapshot().busy, true);
  requests[1].resolve(Response.json({}, { status: 503 })); assert.equal(await current, false); assert.equal(session.snapshot().pending, true);
  session.dispose();
});

test('R13: actual hook, same instance, account/campaign switch never retries the previous draft', async () => {
  const hooks = hookHarness(), posts = [];
  const fetcher = async (url, init = {}) => { if (init.method !== 'POST') return Response.json({ enabled: false }); posts.push({ url, ...init }); throw new Error('ambiguous response'); };
  const load = await loader({ react: hooks.react }, { fetch: fetcher, setTimeout: () => 1, clearTimeout: () => {} });
  const { useLocationChat } = await load('../src/app/campaigns/[campaignId]/useLocationChat.ts');
  try {
    let a = hooks.render(() => useLocationChat('campaign-A', 'user-A')); await pause();
    assert.equal(await a.command(OOC), false); a = hooks.render(() => useLocationChat('campaign-A', 'user-A')); assert.equal(a.pending, true);
    const oldRetry = a.retry;
    let b = hooks.render(() => useLocationChat('campaign-B', 'user-B')); await pause();
    assert.equal(b.pending, false); assert.equal(b.selected, null); assert.equal(b.page.messages.length, 0);
    assert.equal(await b.retry(), false); assert.equal(await oldRetry(), false); assert.equal(posts.length, 1);
    assert.equal(await b.command({ ...OOC, content: 'B_ONLY_DRAFT' }), false);
    b = hooks.render(() => useLocationChat('campaign-B', 'user-B')); assert.equal(b.pending, true);
    assert.match(posts[1].url, /campaign-B/); assert.doesNotMatch(posts[1].body, /PRIVATE_DRAFT/);
    assert.equal(posts[1].headers['X-ODM-Expected-User'], 'user-B');
  } finally { hooks.cleanup(); }
});

test('R13: late completion from an old hook identity does not clear the new pending command', async () => {
  const hooks = hookHarness(), posts = [];
  const fetcher = (url, init = {}) => init.method !== 'POST' ? Promise.resolve(Response.json({ enabled: false })) : new Promise(resolve => posts.push({ url, init, resolve }));
  const load = await loader({ react: hooks.react }, { fetch: fetcher, setTimeout: () => 1, clearTimeout: () => {} });
  const { useLocationChat } = await load('../src/app/campaigns/[campaignId]/useLocationChat.ts');
  try {
    const a = hooks.render(() => useLocationChat('A', 'A')); const old = a.command(OOC);
    const b = hooks.render(() => useLocationChat('B', 'B')); const current = b.command({ ...OOC, content: 'NEW_IDENTITY' });
    posts[0].resolve(ok()); assert.equal(await old, false);
    const afterOld = hooks.render(() => useLocationChat('B', 'B')); assert.equal(afterOld.pending, true); assert.equal(afterOld.busy, true);
    posts[1].resolve(Response.json({}, { status: 503 })); assert.equal(await current, false);
    assert.equal(hooks.render(() => useLocationChat('B', 'B')).pending, true);
  } finally { hooks.cleanup(); }
});

test('disabled location mode does not poll until an enable command succeeds', async () => {
  const hooks = hookHarness(), gets = [], posts = [];
  const fetcher = async (url, init = {}) => {
    if (init.method === 'POST') {
      posts.push({ url, ...init });
      return ok();
    }
    gets.push({ url, ...init });
    return Response.json({ enabled: true, rooms: [], messages: [], current: null, nextBefore: null });
  };
  const load = await loader({ react: hooks.react }, {
    fetch: fetcher,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const { useLocationChat } = await load('../src/app/campaigns/[campaignId]/useLocationChat.ts');
  try {
    let chat = hooks.render(() => useLocationChat('c', 'A', false));
    await pause();
    assert.equal(gets.length, 0);
    assert.equal(chat.loading, false);

    assert.equal(await chat.command({ operation: 'enable', name: 'Tavern' }), true);
    chat = hooks.render(() => useLocationChat('c', 'A', false));
    await pause();
    assert.equal(posts.length, 1);
    assert.equal(gets.length, 1);
  } finally { hooks.cleanup(); }
});

test('R12: model intent schema requires stable ID, room and revision; OOC is explicit', async () => {
  const load = await loader(); const { encodeWebMcpLocationIntent: encode } = await load('@/lib/spatial/client-intents');
  const first = JSON.stringify(encode(modelInput)); assert.equal(first, JSON.stringify(encode({ ...modelInput })));
  assert.throws(() => encode({ ...modelInput, kind: 'say' }));
  assert.throws(() => encode({ ...modelInput, expectedRevision: null }));
  assert.throws(() => encode({ ...modelInput, roomId: null }));
  const ooc = encode({ ...modelInput, kind: 'ooc', roomId: null, expectedRevision: null });
  assert.equal(ooc.roomId, null); assert.equal(Object.hasOwn(ooc, 'expectedRevision'), false);
});

test('R12: actual WebMCP callback retries a lost HTTP response without creating a second intent', async () => {
  const effects = [], tools = [], bodies = [], journal = new Map(); let commits = 0, drop = true;
  // Real TCP/HTTP fault after commit. The server journal is an explicit fixture;
  // this test verifies the browser adapter's bytes, not the full Next deployment.
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    bodies.push(body); const parsed = JSON.parse(body), prior = journal.get(parsed.requestId);
    if (prior && prior !== body) { res.writeHead(409); res.end(JSON.stringify({ error: 'intent conflict' })); return; }
    if (!prior) { journal.set(parsed.requestId, body); commits++; }
    if (drop) { drop = false; res.destroy(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cleanup;
  try {
    const load = await loader({ react: { useEffect: effect => effects.push(effect) } }, {
      document: { modelContext: { registerTool: async tool => { tools.push(tool); } }, dispatchEvent: () => true },
      fetch: (url, init) => fetch(origin + url, init),
    });
    const { WebMcpLocationTools } = await load('../src/app/campaigns/[campaignId]/WebMcpLocationTools.tsx');
    WebMcpLocationTools({ campaignId: 'c', userId: 'A' }); cleanup = effects[0](); await pause();
    const send = tools.find(tool => tool.name === 'odm_send_location_message'); assert.ok(send);
    assert.ok(send.inputSchema.anyOf.some(branch => branch.required.includes('intentId')));
    assert.ok(send.inputSchema.oneOf.some(branch => branch.required?.includes('expectedRevision')));
    await assert.rejects(send.execute(modelInput)); assert.equal((await send.execute(modelInput)).ok, true);
    assert.equal(commits, 1); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
    cleanup(); await assert.rejects(send.execute(modelInput)); assert.equal(bodies.length, 2);
  } finally { cleanup?.(); server.closeAllConnections(); server.close(); server.unref(); }
});

test('R13: actual HTTP route refuses a stale expected-user header before any read or command', async () => {
  let writes = 0, reads = 0, limited = 0;
  const chain = new Proxy({}, { get: (_target, key) => key === 'safeParse' ? data => ({ success: true, data }) : () => chain });
  class SpatialError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  const load = await loader({
    zod: { z: chain },
    '@/lib/campaign-api': { isErrorResponse: value => value instanceof Response, requireMember: async () => ({ user: { id: 'B' } }), requireVoice: async () => ({ user: { id: 'B' } }) },
    '@/lib/ingress-budget': { enforcePlayerIngress: () => { limited++; return null; } },
    '@/lib/spatial/service': { SpatialError, runSpatialCommand: () => { writes++; return { ok: true }; }, spatialContext: () => ({ actor: {} }), spatialStore: () => ({ view: () => { reads++; return { enabled: false }; } }) },
  });
  const route = await load('../src/app/api/campaigns/[campaignId]/location-chat/route.ts');
  const params = { params: Promise.resolve({ campaignId: 'c' }) };
  const headers = { 'X-ODM-Expected-User': 'A', 'Content-Type': 'application/json' };
  for (const method of ['GET', 'POST']) {
    const response = await route[method](new Request('http://localhost/location-chat', { method, headers, ...(method === 'POST' ? { body: JSON.stringify(OOC) } : {}) }), params);
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'identity_changed');
  }
  assert.equal(writes, 0); assert.equal(reads, 0); assert.equal(limited, 0);
  const response = await route.POST(new Request('http://localhost/location-chat', { method: 'POST', headers: { ...headers, 'X-ODM-Expected-User': 'B' }, body: JSON.stringify(OOC) }), params);
  assert.equal(response.status, 200); assert.equal(writes, 1);
});

test('R13: identity-conflict response clears a pending draft instead of retrying under the new cookie', async () => {
  const load = await loader(); const { LocationIntentSession } = await load('@/lib/spatial/client-intents'); let calls = 0;
  const session = new LocationIntentSession({ campaignId: 'c', userId: 'A', fetcher: async () => { calls++; return Response.json({ code: 'identity_changed' }, { status: 409 }); } });
  session.activate(); assert.equal(await session.send(OOC), false);
  assert.equal(session.active, false); assert.equal(session.snapshot().pending, false); assert.equal(await session.retry(), false); assert.equal(calls, 1);
});
