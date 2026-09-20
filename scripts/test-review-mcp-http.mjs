import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createSafeHttpListener, requestPath, BadRequestError } from '../mcp/http-boundary.mjs';
import { createControlClient, withControlSignal, withMcpCancellation, controlTimeout } from '../mcp/control-client.mjs';

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}
async function raw(port, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); let response = '';
    socket.on('error', reject); socket.on('data', chunk => response += chunk);
    socket.on('end', () => resolve(response));
    socket.on('connect', () => socket.write(text));
  });
}
test('request target never uses Host as its URL base', () => {
  assert.equal(requestPath('/mcp?session=x', '[::1]:3006'), '/mcp');
  assert.equal(requestPath('/healthz', 'localhost'), '/healthz');
  for (const host of ['[', 'localhost:999999', 'bad@host', 'bad/host', 'a b', 'a,b', 'a?x', '']) {
    assert.throws(() => requestPath('/mcp', host), BadRequestError);
  }
  for (const target of ['http://host/mcp', '//host/mcp', '/\\host', '/mcp#x', '/mcp\n']) {
    assert.throws(() => requestPath(target, 'localhost'), BadRequestError);
  }
});
test('malformed Host and rejected async handlers do not kill the HTTP server', async t => {
  let errors = 0;
  const { port, url } = await listen(t, createSafeHttpListener(async (_req, res, path) => {
    if (path === '/reject') { await delay(1); throw new Error('fixture'); }
    res.end('healthy');
  }, { onError: () => errors++ }));
  const bad = await raw(port, 'GET /mcp HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n');
  assert.match(bad, /^HTTP\/1\.1 400/);
  const rejected = await fetch(url + '/reject'); assert.equal(rejected.status, 500); await rejected.text();
  assert.equal(await (await fetch(url + '/healthz')).text(), 'healthy');
  assert.equal(errors, 1);
});
test('exception after headers terminates only that response', async t => {
  const { url } = await listen(t, createSafeHttpListener(async (_req, res, path) => {
    if (path === '/broken') { res.write('prefix'); await delay(5); throw new Error('fixture'); }
    res.end('ok');
  }));
  await assert.rejects(async () => (await fetch(url + '/broken')).text());
  assert.equal(await (await fetch(url + '/healthz')).text(), 'ok');
});
test('control hop has a budget longer than the application deadline', () => {
  assert.equal(controlTimeout(undefined), 135_000);
  for (const value of ['0', '-1', '30000', '120000', 'NaN', 'Infinity']) assert.ok(controlTimeout(value) >= 125_000);
  assert.equal(controlTimeout('9999999'), 600_000);
});
test('normal completed request body does not cancel a long response', async t => {
  const { url } = await listen(t, createSafeHttpListener(async (req, res, _path, signal) => {
    for await (const _chunk of req) { /* consume the complete request */ }
    await delay(20, undefined, { signal }); res.end('completed');
  }));
  assert.equal(await (await fetch(url, { method: 'POST', body: '{}' })).text(), 'completed');
});
test('disconnect cancels the downstream HTTP request without a later mutation', async t => {
  let aborted = false, mutations = 0, began;
  const started = new Promise(resolve => began = resolve);
  const backend = await listen(t, createSafeHttpListener(async (req, res, _path, signal) => {
    for await (const _chunk of req) {}
    began();
    try { await delay(100, undefined, { signal }); mutations++; res.end('{"ok":true}'); }
    catch { aborted = signal.aborted; }
  }));
  const control = createControlClient({ url: backend.url, token: 'test-only-token' });
  const front = await listen(t, createSafeHttpListener(async (_req, res) => {
    const result = await control('models.test_and_connect', {}); res.end(JSON.stringify(result));
  }));
  const cancelled = new AbortController();
  const pending = fetch(front.url, { signal: cancelled.signal });
  await started; cancelled.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  for (let i = 0; i < 30 && !aborted; i++) await delay(5);
  assert.equal(aborted, true); assert.equal(mutations, 0);
});
test('SDK v2 protocol cancellation reaches a stdio tool callback', async () => {
  const cancelled = new AbortController(); let calls = 0;
  const client = createControlClient({ token: 'test', fetchImpl: async (_url, init) => {
    calls++; await delay(100, undefined, { signal: init.signal }); return Response.json({ ok: true, result: {} });
  } });
  const tool = withMcpCancellation(() => client('test'));
  const pending = tool({}, { mcpReq: { signal: cancelled.signal } });
  cancelled.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1);
});
test('control budget cancels body consumption and never follows redirects', async t => {
  const { url } = await listen(t, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  const client = createControlClient({ url, token: 'test', timeoutMs: 30 });
  await assert.rejects(client('test'), { name: 'TimeoutError' });
  const redirected = createControlClient({ token: 'test', fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, 'error'); return Response.json({ ok: true, result: 'ok' });
  } });
  assert.equal(await redirected('test'), 'ok');
});
test('a cancelled operation cannot start another control request', async () => {
  let called = false;
  const client = createControlClient({ token: 'test', fetchImpl: async () => { called = true; } });
  assert.throws(() => withControlSignal(AbortSignal.abort(), () => client('test')), { name: 'AbortError' });
  assert.equal(called, false);
});

test('presentation options stay in the sidecar and do not break strict narrator schemas', async () => {
  const params = { campaignId: 'c', afterSeq: 7, compact: true, policyMode: 'compact', includePolicyText: false };
  const client = createControlClient({ token: 'test', fetchImpl: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { action: 'narrator.read', params: { campaignId: 'c', afterSeq: 7, projection: 'live', delta: true } });
    return Response.json({ ok: true, result: { currentSeq: 7, messages: [] } });
  } });
  const result = await client('narrator.read', params);
  assert.equal(result.currentSeq, 7);
  assert.equal(result.dmPolicy.text, undefined);
  assert.equal(params.compact, true, 'caller options must not be mutated');
});
