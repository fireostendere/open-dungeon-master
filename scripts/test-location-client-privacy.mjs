import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocationCommandClient } from '../src/lib/spatial/client-commands.mjs';
import { locationWebTools } from '../src/lib/spatial/web-tools.mjs';
const roomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const response = (body = {}, status = 200) => Response.json(body, { status });
const options = (fetchImpl, other = {}) => ({ campaignId: 'campaign-A', userId: 'player-A', fetchImpl, uuid: () => requestId, ...other });

test('R12: lost UI response retries the exact UUID and serialized payload', async () => {
  const sent = [];
  const client = new LocationCommandClient(options(async (_url, init) => { sent.push(init); if (sent.length === 1) throw new Error('connection lost after commit'); return response(); }));
  const input = { operation: 'send', roomId, expectedRevision: 1, kind: 'say', content: 'ONLY_ONCE' };
  await assert.rejects(client.command(input));
  input.content = 'MUTATED_BY_CALLER';
  await client.retry();
  assert.equal(sent.length, 2); assert.equal(sent[0].body, sent[1].body);
  assert.equal(JSON.parse(sent[1].body).content, 'ONLY_ONCE');
  assert.equal(sent[0].headers['X-ODM-Actor'], 'player-A');
  assert.equal(client.pending, null);
});

test('R13: disposed identity cannot retry; a new client has no inherited pending command', async () => {
  const sent = [];
  const old = new LocationCommandClient(options(async (url, init) => { sent.push([url, init.body]); throw new Error('ambiguous'); }));
  await assert.rejects(old.command({ operation: 'send', kind: 'ooc', content: 'PRIVATE_A' }));
  old.dispose();
  const next = new LocationCommandClient(options(async () => response(), { campaignId: 'campaign-B', userId: 'player-B' }));
  await assert.rejects(old.retry(), /No pending/); await assert.rejects(next.retry(), /No pending/);
  await assert.rejects(old.command({ operation: 'send', kind: 'ooc', content: 'PRIVATE_A' }), /identity changed/);
  assert.equal(sent.length, 1);
});

test('R13: an old in-flight completion cannot accept or clear a new client intent', async () => {
  let complete;
  const old = new LocationCommandClient(options(() => new Promise(resolve => { complete = resolve; })));
  const promise = old.command({ operation: 'send', kind: 'ooc', content: 'A' });
  old.dispose();
  const next = new LocationCommandClient(options(async () => { throw new Error('B ambiguous'); }, { campaignId: 'B', userId: 'B' }));
  await assert.rejects(next.command({ operation: 'send', kind: 'ooc', content: 'B' }));
  complete(response()); await assert.rejects(promise, /identity changed/);
  assert.equal(next.pending.input.content, 'B');
});

test('a different intent cannot overwrite an ambiguous one, and definite rejection can be corrected', async () => {
  let fail = true;
  const client = new LocationCommandClient(options(async () => fail ? response({ error: 'busy' }, 503) : response({ error: 'stale' }, 409)));
  await assert.rejects(client.command({ content: 'one' }));
  await assert.rejects(client.command({ content: 'two' }), /Retry the unconfirmed/);
  fail = false; await assert.rejects(client.retry(), /stale/);
  assert.equal(client.pending, null);
});

test('R12: WebMCP repeating identical arguments sends identical commands without refetching revision', async () => {
  const bodies = [], abort = new AbortController();
  const tools = locationWebTools({ ...options(async (url, init) => {
    assert.equal(init.method, 'POST'); assert.equal(init.headers['X-ODM-Actor'], 'player-A');
    bodies.push(init.body); if (bodies.length === 1) throw new Error('lost after commit'); return response();
  }), signal: abort.signal });
  const send = tools.find(tool => tool.name === 'odm_send_location_message').execute;
  const input = { requestId, kind: 'say', roomId, expectedRevision: 3, content: 'ONE_WEB_INTENT' };
  await assert.rejects(send(input)); await send(input);
  assert.equal(bodies[0], bodies[1]); assert.equal(JSON.parse(bodies[0]).requestId, requestId);
});

test('R12: WebMCP rejects incomplete IC arguments before any request; global OOC remains usable', async () => {
  let calls = 0;
  const tools = locationWebTools({ ...options(async () => { calls++; return response(); }), signal: new AbortController().signal });
  const send = tools.find(tool => tool.name === 'odm_send_location_message').execute;
  assert.throws(() => send({ requestId, kind: 'say', content: 'No room' }), /roomId/);
  assert.throws(() => send({ requestId, kind: 'say', roomId, content: 'No revision' }), /revision/);
  assert.throws(() => send({ kind: 'ooc', content: 'No stable ID' }), /Invalid/);
  assert.equal(calls, 0);
  await send({ requestId, kind: 'ooc', content: 'GLOBAL' });
  assert.equal(calls, 1);
});

test('a WebMCP tool retained after effect cleanup cannot read or send with a new login', async () => {
  let calls = 0;
  const abort = new AbortController();
  const tools = locationWebTools({ ...options(async () => { calls++; return response(); }), signal: abort.signal });
  abort.abort();
  await assert.rejects(tools[0].execute({}));
  await assert.rejects(tools[2].execute({ requestId, kind: 'ooc', content: 'OLD_DRAFT' }));
  assert.equal(calls, 0);
});
