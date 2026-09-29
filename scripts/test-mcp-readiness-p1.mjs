import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { root, loadSource, sqliteFixture } from './lib/readiness-harness.mjs';

const { createMcpProxy } = await import(pathToFileURL(resolve(root, 'src/lib/mcp-proxy.mjs')));
const { createCampaignStream } = loadSource('src/lib/campaign-stream.ts');

function narration(fixture) {
  return loadSource('src/lib/dm/human-narration.ts', {
    '@/lib/db/core': fixture.core, '@/lib/db/commit-effects': fixture.effects,
    '@/lib/db/campaigns': fixture.campaigns, '@/lib/db/messages': fixture.messages,
    '@/lib/db/dm-turns': { listOpenPendingRolls: () => fixture.pendingRolls ?? [] },
    '@/lib/dm/encounter-tools': { queueSkippedCombatTurn: () => {} },
    '@/lib/dm/human-turn-lifecycle': loadSource('src/lib/dm/human-turn-lifecycle.ts', {
      '@/lib/db/campaigns': fixture.campaigns, '@/lib/db/encounters': { getActiveEncounter: () => null },
      '@/lib/db/dm-turns': { listOpenPendingRolls: () => fixture.pendingRolls ?? [], saveDmTurn() {} },
      '@/lib/db/human-adjudication-scopes': {}, '@/lib/events': fixture.events,
      '@/lib/dm/encounter-tools': { advanceAfterTurn() {}, announceCurrentTurn() {}, queueSkippedCombatTurn() {} },
    }),
    '@/lib/events': fixture.events,
    '@/lib/spatial/service': { spatialEnabled: () => false, SpatialError: class extends Error {} },
  }).persistHumanNarration;
}
const campaign = () => ({ id: 'c1', gameSettings: { holdSubmissions: true } });

test('M03: a failed persisted event rolls back narration, sequence, floor and fan-out', () => {
  const f = sqliteFixture();
  const seen = [];
  const stop = f.events.subscribe('c1', (chunk) => seen.push(chunk));
  try {
    f.db.exec("CREATE TRIGGER refuse_event BEFORE INSERT ON campaign_events BEGIN SELECT RAISE(ABORT, 'injected event failure'); END;");
    assert.throws(() => narration(f)(campaign(), 'A committed story must have its event.', 'dm'), /injected event failure/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_messages').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_events').get().n, 0);
    assert.equal(f.campaigns.latestSeq('c1'), 0);
    assert.deepEqual(f.campaigns.getFloor('c1'), { mode: 'free' });
    assert.deepEqual(seen, []);
  } finally { stop(); f.close(); }
});

test('M03: successful narration and hold are visible to subscribers only after commit', () => {
  const f = sqliteFixture();
  const observations = [];
  const stop = f.events.subscribe('c1', (chunk) => observations.push({ chunk, depth: f.depth(), floor: f.campaigns.getFloor('c1') }));
  try {
    const message = narration(f)(campaign(), 'The door opens.', 'dm');
    assert.ok(message.id);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_messages').get().n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_events').get().n, 2);
    assert.equal(observations.length, 2);
    assert.ok(observations.every((row) => row.depth === 0 && row.floor.mode === 'hold'));
  } finally { stop(); f.close(); }
});

test('M03: pending physical rolls keep an already-held combat floor closed', () => {
  const f = sqliteFixture();
  f.pendingRolls = [{ id: 'physical-roll' }];
  f.campaigns.setFloor('c1', { mode: 'hold', next: { mode: 'open' }, combat: { mechanicsResolved: true } });
  try {
    narration(f)(campaign(), 'The outcome is still pending.', 'dm');
    assert.deepEqual(f.campaigns.getFloor('c1'), { mode: 'hold', next: { mode: 'open' }, combat: { mechanicsResolved: true } });
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events WHERE type='floor_changed'").get().n, 0);
  } finally { f.close(); }
});

test('M06: real HTTP bridge forwards MCP metadata but never cookies or a caller-selected Host', async () => {
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.headers));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxy = createMcpProxy({ upstream: `http://127.0.0.1:${server.address().port}/mcp` });
  try {
    const response = await proxy(new Request('http://app.test/mcp', {
      method: 'POST', body: '{}', headers: {
        authorization: 'Bearer test-caller-only', 'content-type': 'application/json',
        'Mcp-Method': 'tools/call', 'Mcp-Name': 'odm_narrator_read',
        'Mcp-Param-campaignId': 'campaign-id', 'Mcp-Param-Unfamiliar': 'preserve-me',
        host: 'attacker.test', cookie: 'session=must-not-forward', 'x-forwarded-host': 'attacker.test',
      },
    }));
    assert.equal(response.status, 200);
    const headers = await response.json();
    assert.equal(headers['mcp-method'], 'tools/call');
    assert.equal(headers['mcp-name'], 'odm_narrator_read');
    assert.equal(headers['mcp-param-campaignid'], 'campaign-id');
    assert.equal(headers['mcp-param-unfamiliar'], 'preserve-me');
    assert.equal(headers.authorization, 'Bearer test-caller-only');
    assert.equal(headers.cookie, undefined);
    assert.equal(headers['x-forwarded-host'], undefined);
    assert.notEqual(headers.host, 'attacker.test');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

function openStream(f, afterSeq = 0, extra = {}) {
  const abort = new AbortController();
  const calls = [];
  const stream = createCampaignStream({
    afterSeq, signal: abort.signal,
    latestSeq: () => f.campaigns.latestSeq('c1'),
    listEventsSince: (cursor, limit) => { calls.push({ cursor, limit }); return f.events.listEventsSince('c1', cursor, limit); },
    subscribe: (send) => f.events.subscribe('c1', send, 'player'),
    sseChunk: f.events.sseChunk,
    ...extra,
  });
  return { abort, calls, reader: stream.getReader() };
}
function parseChunk(value) {
  const text = new TextDecoder().decode(value);
  return { text, type: /^event: (.+)$/m.exec(text)?.[1], seq: /^id: (\d+)$/m.exec(text)?.[1] };
}
async function readUntil(reader, stop) {
  const seen = [];
  for (let i = 0; i < 5000; i++) {
    const { done, value } = await reader.read();
    assert.equal(done, false, 'stream closed before the expected frame');
    const item = parseChunk(value);
    seen.push(item);
    if (stop(item)) return seen;
  }
  throw new Error('Expected frame was not delivered');
}

test('M07: replay drains 1001 rows across pages, then delivers concurrent live 1002 exactly once', async () => {
  const f = sqliteFixture();
  for (let i = 0; i < 1001; i++) f.events.publishPersisted('c1', 'test_event', { i });
  const stream = openStream(f);
  try {
    const first = parseChunk((await stream.reader.read()).value);
    f.events.publishPersisted('c1', 'test_event', { i: 1001 });
    const seen = [first, ...await readUntil(stream.reader, (frame) => frame.type === 'test_event' && frame.seq === '1002')];
    assert.deepEqual(seen.filter((frame) => frame.type === 'test_event').map((frame) => Number(frame.seq)), Array.from({ length: 1002 }, (_, i) => i + 1));
    assert.deepEqual(stream.calls.map((call) => call.cursor), [0, 500, 1000]);
    for (const type of ['ask_activity', 'whisper_activity', 'facts_updated']) assert.equal(seen.filter((frame) => frame.type === type).length, 1);
  } finally { await stream.reader.cancel(); f.close(); }
});

test('M07: every reconnect refreshes private views even when the story cursor has not changed', async () => {
  const f = sqliteFixture();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = openStream(f);
      const seen = await readUntil(stream.reader, (frame) => frame.type === 'relationships_updated');
      for (const type of ['ask_activity', 'whisper_activity', 'facts_updated']) {
        assert.equal(seen.filter((frame) => frame.type === type).length, 1);
        assert.ok(seen.find((frame) => frame.type === type).text.includes('data: {}'));
      }
      await stream.reader.cancel();
      assert.deepEqual(f.events.onlineUserIds('c1'), []);
    }
  } finally { f.close(); }
});

test('M07: a cursor ahead of a restored database requests the existing authorized snapshot refresh', async () => {
  const f = sqliteFixture();
  const stream = openStream(f, 500);
  try {
    const first = parseChunk((await stream.reader.read()).value);
    assert.equal(first.type, 'campaign_rewound');
    assert.equal(first.seq, '0');
    assert.match(first.text, /cursor_ahead/);
  } finally { await stream.reader.cancel(); f.close(); }
});

test('M07: an already aborted connection never subscribes or queries replay', async () => {
  const f = sqliteFixture();
  const abort = new AbortController();
  abort.abort();
  const stream = openStream(f, 0, { signal: abort.signal });
  try {
    assert.equal((await stream.reader.read()).done, true);
    assert.equal(stream.calls.length, 0);
    assert.deepEqual(f.events.onlineUserIds('c1'), []);
  } finally { f.close(); }
});

test('M07: overflowing a slow live consumer disconnects instead of silently dropping a persisted event', async () => {
  const f = sqliteFixture();
  const stream = openStream(f, 0, { maximumBufferedBytes: 256 });
  try {
    await readUntil(stream.reader, (frame) => frame.type === 'relationships_updated');
    f.events.publishPersisted('c1', 'test_event', { content: 'x'.repeat(1000) });
    await assert.rejects(stream.reader.read(), /fell behind/);
    assert.deepEqual(f.events.onlineUserIds('c1'), []);
    const retry = openStream(f);
    const seen = await readUntil(retry.reader, (frame) => frame.type === 'test_event');
    assert.equal(seen.at(-1).seq, '1');
    await retry.reader.cancel();
  } finally { f.close(); }
});
