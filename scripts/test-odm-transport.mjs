import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOdmClient, narratorParams, withMcpCredential } from '../mcp/control-client.mjs';
import { createOdmTransport, OdmTransportError, transportConfig } from '../mcp/transport.mjs';

const campaign = '11111111-1111-4111-8111-111111111111';

function fakeSsh() {
  const process = new EventEmitter();
  process.exitCode = null;
  process.kill = () => { process.exitCode = 0; process.emit('exit', 0, 'SIGTERM'); };
  return process;
}

test('one client exposes the narrator API and uses the configured HTTP transport', async () => {
  const calls = [], timings = [];
  const client = createOdmClient({
    transport: 'https', url: 'https://odm.example/api/narrator', token: 'client-secret', onTiming: event => timings.push(event),
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), authorization: init.headers.authorization, body: JSON.parse(init.body) });
      return Response.json({ ok: true, result: { currentSeq: 4 } }, { headers: { 'server-timing': 'odm;dur=2.0' } });
    },
  });
  assert.equal(client.transport, 'https');
  assert.equal((await client.connect({ campaignId: campaign })).currentSeq, 4);
  assert.equal((await client.read({ campaignId: campaign })).currentSeq, 4);
  assert.equal((await client.getSnapshot({ campaignId: campaign })).currentSeq, 4);
  assert.equal((await client.getDelta({ campaignId: campaign })).currentSeq, 4);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.authorization === 'Bearer client-secret'));
  assert.ok(calls.every(call => call.body.params.campaignId === campaign));
  assert.equal(calls[0].body.params.projection, 'live');
  assert.equal(calls[0].body.params.maxBytes, 131072);
  assert.ok(timings.some(event => event.stage === 'odm_server'));
  assert.ok(timings.some(event => event.stage === 'odm_transport'));
  await client.close();
});

test('transport selection rejects unsafe or ambiguous production configuration', () => {
  assert.equal(transportConfig({ transport: 'https', url: 'https://odm.example/mcp' }).transport, 'https');
  assert.throws(() => transportConfig({ transport: 'https', url: 'http://odm.example/mcp' }), /HTTPS transport/);
  assert.throws(() => transportConfig({ transport: 'local', url: 'https://odm.example/mcp' }), /Local transport/);
  assert.throws(() => createOdmTransport({ transport: 'ssh-tunnel', url: 'http://127.0.0.1:39005/mcp' }), OdmTransportError);
});

test('SSH fallback starts one persistent session and retries only a read after reset', async () => {
  let starts = 0, closes = 0, requests = 0;
  const client = createOdmClient({
    transport: 'ssh-tunnel', url: 'http://127.0.0.1:39005/api/internal/mcp', token: 'tunnel-secret',
    sshTarget: 'odm@example.test', spawnImpl: () => { starts++; return fakeSsh(); }, waitForReady: async () => {},
    fetchImpl: async () => { requests++; if (requests === 1) throw new Error('connection reset'); return Response.json({ ok: true, result: { currentSeq: 2 } }); },
  });
  assert.equal((await client.read({ campaignId: campaign })).currentSeq, 2);
  assert.equal(starts, 2, 'a read may restart a failed tunnel once');
  assert.equal((await client.read({ campaignId: campaign })).currentSeq, 2);
  assert.equal(starts, 2, 'the second read reuses the persistent tunnel');
  await client.close(); closes++;
  assert.equal(closes, 1);
});

test('SSH fallback never retries a mutation; receipt includes a bounded read by default', async () => {
  let starts = 0, requests = 0;
  const client = createOdmClient({
    transport: 'ssh-tunnel', url: 'http://127.0.0.1:39005/api/internal/mcp', token: 'mutation-secret',
    sshTarget: 'odm@example.test', spawnImpl: () => { starts++; return fakeSsh(); }, waitForReady: async () => {},
    fetchImpl: async () => { requests++; throw new Error('connection reset'); },
  });
  await assert.rejects(client.invoke({ campaignId: campaign, expectedSeq: 1, name: 'end_turn', args: {}, commandId: '22222222-2222-4222-8222-222222222222' }), /connection reset/);
  assert.equal(requests, 1);
  assert.equal(starts, 1);
  assert.deepEqual(narratorParams('narrator.invoke', { campaignId: campaign, expectedSeq: 1, name: 'end_turn', args: {} }).readAfter,
    { projection: 'live', delta: true, paged: true, maxBytes: 131072 });
  await client.close();
});

test('post-write defaults preserve explicit cursor/cache options, opt-out and private Ask shape', () => {
  const readAfter = { afterSeq: 7, stateDelta: true, knownStateRevision: 'a'.repeat(64) };
  for (const action of ['narrator.invoke', 'narrator.narrate', 'narrator.release_floor']) {
    assert.deepEqual(narratorParams(action, { readAfter }).readAfter, readAfter);
    assert.equal(narratorParams(action, { readAfter: false }).readAfter, false);
  }
  assert.equal(narratorParams('narrator.answer_ask', {}).readAfter, undefined);
});

test('HTTPS reads may recover one connection reset but mutations do not', async () => {
  let requests = 0;
  const client = createOdmClient({
    transport: 'https', url: 'https://odm.example/api/narrator', token: 'https-secret',
    fetchImpl: async () => { if (++requests === 1) throw new Error('socket hang up'); return Response.json({ ok: true, result: { currentSeq: 3 } }); },
  });
  assert.equal((await client.read({ campaignId: campaign })).currentSeq, 3);
  assert.equal(requests, 2);
  await client.close();
});

test('HTTP errors are structured and credentials are not copied into messages', async () => {
  const client = createOdmClient({ url: 'http://odm.example/api/narrator', token: 'top-secret', fetchImpl: async () => Response.json({ ok: false, error: 'token top-secret rejected' }, { status: 401 }) });
  await assert.rejects(client('narrator.read', { campaignId: campaign }), error => error.status === 401 && !error.message.includes('top-secret'));
  await client.close();
});

test('HTTP MCP request context forwards its scoped bearer instead of the sidecar default', async () => {
  const headers = [];
  const client = createOdmClient({ url: 'https://odm.example/api/narrator', token: 'operator-secret', fetchImpl: async (_url, init) => {
    headers.push(init.headers.authorization);
    return Response.json({ ok: true, result: { ok: true } });
  } });
  await withMcpCredential('narrator-secret', () => client('narrator.read', { campaignId: campaign }));
  assert.deepEqual(headers, ['Bearer narrator-secret']);
  await client.close();
});
