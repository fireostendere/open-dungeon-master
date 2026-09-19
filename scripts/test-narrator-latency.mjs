import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NarratorSnapshotCache } from '../src/lib/mcp-snapshot-cache.mjs';
import { budgetRead, assembleReadPages } from '../src/lib/mcp-read-budget.mjs';
import { attachPostWriteRead } from '../src/lib/mcp-post-write.mjs';
import { unrelatedRoomChat } from '../src/lib/spatial/narrator-concurrency.mjs';
import { subscribeSpatialChanges, notifySpatialChange, waitForPrivateUpdate } from '../src/lib/spatial/updates.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const state = () => ({ campaign: { id: 'campaign-a' }, timelineEpoch: 'e'.repeat(64), currentSeq: 80, nextCursor: 80, hasMore: false,
  messages: Array.from({ length: 20 }, (_, seq) => ({ seq, text: 'я'.repeat(700) })) });
const params = { campaignId: 'campaign-a', afterSeq: 0, paged: true, maxBytes: 4096, projection: 'live', dmUserId: 'dm' };

test('frozen pages assemble exactly despite concurrent live state changes', () => {
  const cache = new NarratorSnapshotCache(), original = state(), expected = structuredClone(original);
  const pages = [structuredClone(budgetRead(original, params))];
  assert.equal(cache.remember(original, params), true);
  original.messages[0].text = 'new secret'; original.currentSeq++;
  while (pages.at(-1).nextPage) {
    const query = { ...params, pageCursor: pages.at(-1).nextPage };
    const frozen = cache.restore('campaign-a', expected.timelineEpoch, query);
    assert.ok(frozen); pages.push(budgetRead(frozen, query));
  }
  assert.ok(pages.length > 1);
  assert.deepEqual(assembleReadPages(pages), expected);
  assert.ok(pages.every(page => Buffer.byteLength(JSON.stringify(page)) <= 4096));
});

test('page cache cannot cross campaign, timeline, principal or projection boundaries', () => {
  const cache = new NarratorSnapshotCache(), original = state(); cache.remember(original, params);
  const pageCursor = budgetRead(original, params).nextPage;
  for (const [campaign, epoch, changes] of [
    ['campaign-b', original.timelineEpoch, {}], ['campaign-a', 'f'.repeat(64), {}],
    ['campaign-a', original.timelineEpoch, { dmUserId: 'other-dm' }],
    ['campaign-a', original.timelineEpoch, { projection: 'full' }],
    ['campaign-a', original.timelineEpoch, { afterAskSeq: 1 }],
  ]) assert.equal(cache.restore(campaign, epoch, { ...params, ...changes, pageCursor }), null);
});

test('page cache expires, evicts, bounds memory and does not expose mutable references', () => {
  let now = 0; const cache = new NarratorSnapshotCache({ now: () => now, ttlMs: 10, maxEntries: 1 });
  const original = state(), pageCursor = budgetRead(original, params).nextPage;
  cache.remember(original, params);
  const first = cache.restore('campaign-a', original.timelineEpoch, { ...params, pageCursor }); first.messages.length = 0;
  assert.equal(cache.restore('campaign-a', original.timelineEpoch, { ...params, pageCursor }).messages.length, 20);
  now = 11; assert.equal(cache.restore('campaign-a', original.timelineEpoch, { ...params, pageCursor }), null); assert.equal(cache.bytes, 0);
  now = 0; cache.remember(original, params); cache.remember({ ...original, currentSeq: 81 }, params);
  assert.equal(cache.restore('campaign-a', original.timelineEpoch, { ...params, pageCursor }), null);
  assert.equal(new NarratorSnapshotCache({ maxBytes: 10 }).remember(original, params), false);
});

test('post-write read returns committed receipt and state with one read', async () => {
  let calls = 0; const receipt = { commandId: 'saved-id', committedSeq: 9, result: { total: 17 } }, query = { afterSeq: 8 };
  const result = await attachPostWriteRead(receipt, query, async value => { calls++; assert.deepEqual(value, query); return { currentSeq: 9, hasMore: false }; });
  assert.equal(calls, 1); assert.equal(result.commandId, receipt.commandId); assert.equal(result.state.currentSeq, 9); assert.equal(result.readRequired, false);
});

test('readback failure never becomes an action failure, retry or raw error disclosure', async () => {
  const receipt = { commandId: 'saved-id', committedSeq: 9, replayed: true, result: { applied: true } };
  let calls = 0;
  const result = await attachPostWriteRead(receipt, {}, async () => { calls++; throw new Error('private prompt and token'); });
  assert.equal(calls, 1); assert.equal(result.readRequired, true); assert.equal(result.replayed, true); assert.deepEqual(result.result, receipt.result);
  assert.ok(!JSON.stringify(result).includes('private prompt')); assert.ok(!('state' in result));
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE spatial_rooms(campaign_id TEXT,id TEXT);
    CREATE TABLE spatial_presence(campaign_id TEXT,room_id TEXT,user_id TEXT);
    CREATE TABLE spatial_observers(campaign_id TEXT,source_id TEXT,mode TEXT,expires_at TEXT,user_id TEXT);
    CREATE TABLE spatial_messages(campaign_id TEXT,id TEXT,seq INTEGER,room_id TEXT,kind TEXT,stealth INTEGER);
    CREATE TABLE spatial_receipts(campaign_id TEXT,message_id TEXT,user_id TEXT);
    INSERT INTO spatial_rooms VALUES('c','target'),('c','other');
    INSERT INTO spatial_presence VALUES('c','target','alice');`);
  const add = (seq, room = 'other', kind = 'say', stealth = 0) => db.prepare('INSERT INTO spatial_messages VALUES(?,?,?,?,?,?)').run('c', `m${seq}`, seq, room, kind, stealth);
  const options = { campaignId: 'c', dmUserId: 'dm', roomId: 'target', afterSeq: 10, currentSeq: 11, now: '2026-09-19T00:00:00.000Z' };
  return { db, add, options };
}

test('only fully accounted unrelated ordinary room chat can avoid a stale-cursor retry', () => {
  const { db, add, options } = fixture();
  try { add(11); assert.equal(unrelatedRoomChat(db, options), true);
    add(12, null, 'ooc'); assert.equal(unrelatedRoomChat(db, { ...options, currentSeq: 12 }), true);
    assert.equal(unrelatedRoomChat(db, { ...options, currentSeq: 13 }), false);
    assert.equal(unrelatedRoomChat(db, { ...options, roomId: 'missing' }), false);
    assert.equal(unrelatedRoomChat(db, { ...options, afterSeq: 12 }), false);
  } finally { db.close(); }
});

for (const [name, room, kind, stealth] of [['same room', 'target', 'say', 0], ['action', 'other', 'do', 0], ['stealth', 'other', 'say', 1], ['narration', 'other', 'narration', 0], ['perception', 'other', 'perception', 0]]) {
  test(`${name} still requires exact state`, () => {
    const { db, add, options } = fixture();
    try { add(11, room, kind, stealth); assert.equal(unrelatedRoomChat(db, options), false); } finally { db.close(); }
  });
}

test('speech witnessed by destination occupants or magical observers is relevant', () => {
  const { db, add, options } = fixture();
  try {
    add(11); db.exec("INSERT INTO spatial_receipts VALUES('c','m11','alice')"); assert.equal(unrelatedRoomChat(db, options), false);
    db.exec("DELETE FROM spatial_receipts; INSERT INTO spatial_receipts VALUES('c','m11','watcher'); INSERT INTO spatial_observers VALUES('c','target','scry','2027-01-01','watcher')");
    assert.equal(unrelatedRoomChat(db, options), false);
  } finally { db.close(); }
});

test('authorized projection change wakes immediately without a two-second sleep', async () => {
  let changed = false, loads = 0;
  const promise = waitForPrivateUpdate({ waitMs: 1000, recheckMs: 2000,
    subscribe: listener => subscribeSpatialChanges('visible', listener),
    load: async () => { loads++; return new Response(changed ? 'visible only' : null, { status: changed ? 200 : 304 }); } });
  await tick(); changed = true; notifySpatialChange('visible');
  const result = await promise; assert.equal(result.status, 200); assert.equal(loads, 2); assert.equal(await result.text(), 'visible only');
});

test('hidden and other-campaign wakeups do not complete or disclose an unchanged projection', async () => {
  let resolved = false, visible = false;
  const promise = waitForPrivateUpdate({ waitMs: 1000, subscribe: listener => subscribeSpatialChanges('private', listener),
    load: async () => new Response(visible ? 'allowed' : null, { status: visible ? 200 : 304 }) }).then(value => { resolved = true; return value; });
  await tick(); notifySpatialChange('other'); notifySpatialChange('private'); await tick(); assert.equal(resolved, false);
  visible = true; notifySpatialChange('private'); assert.equal((await promise).status, 200);
});

test('revoked access is rechecked and returned, not cached until connection expiry', async () => {
  let revoked = false;
  const promise = waitForPrivateUpdate({ waitMs: 1000, subscribe: listener => subscribeSpatialChanges('revoke', listener),
    load: async () => new Response(null, { status: revoked ? 403 : 304 }) });
  await tick(); revoked = true; notifySpatialChange('revoke'); assert.equal((await promise).status, 403);
});

test('aborting a long poll releases its listener and pending timer', async () => {
  const controller = new AbortController(); let listeners = 0;
  const promise = waitForPrivateUpdate({ waitMs: 1000, signal: controller.signal,
    subscribe: () => { listeners++; return () => listeners--; }, load: async () => new Response(null, { status: 304 }) });
  await tick(); controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.equal(listeners, 0);
});

test('missed process-local wakeups are recovered by bounded authoritative rechecks', async () => {
  let loads = 0;
  const result = await waitForPrivateUpdate({ waitMs: 100, recheckMs: 1, subscribe: () => () => {},
    load: async () => new Response(null, { status: ++loads === 2 ? 200 : 304 }) });
  assert.equal(result.status, 200); assert.equal(loads, 2);
});

test('notification during an asynchronous initial load cannot be lost', async () => {
  let loadCount = 0, wake;
  const result = await waitForPrivateUpdate({ waitMs: 100, subscribe: listener => { wake = listener; return () => {}; },
    load: async () => { if (++loadCount === 1) { wake(); await tick(); return new Response(null, { status: 304 }); } return new Response('current'); } });
  assert.equal(result.status, 200); assert.equal(loadCount, 2);
});

test('unchanged projection ends only at its heartbeat and always unsubscribes', async () => {
  let listeners = 0;
  const result = await waitForPrivateUpdate({ waitMs: 5, subscribe: () => { listeners++; return () => listeners--; },
    load: async () => new Response(null, { status: 304 }) });
  assert.equal(result.status, 304); assert.equal(listeners, 0);
});
