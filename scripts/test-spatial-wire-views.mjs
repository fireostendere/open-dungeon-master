import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createEventAccess, publicationView, decodeEventChunk, ephemeralView } from '../src/lib/spatial/event-access.mjs';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const { createCampaignStream } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(new URL('../src/lib/campaign-stream.ts', import.meta.url), 'utf8'))).toString('base64'));

const actor = (userId, roomId, isDm = false) => ({ userId, roomId, isDm, member: true, ownedCharacterIds: [`sheet-${userId}`] });
const a = actor('a', 'tavern'), b = actor('b', 'street'), dm = actor('dm', null, true);
const state = { enabled: true, startSeq: 1 };
const sse = (type, payload, seq) => `${seq === undefined ? '' : `id: ${seq}\n`}event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE campaigns(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO campaigns VALUES('c'),('other');INSERT INTO users VALUES('a'),('b'),('dm');");
  return { db, access: createEventAccess(db) };
}

test('R01: publication-time audience survives departure, denies late arrival and preserves old versions', t => {
  const { access } = fixture(t);
  const event = { seq: 1, type: 'note_updated', payload: { note: { id: 'n', body: 'V1', visibility: 'public', status: 'active' } } };
  access.capture('c', event, [a, b, dm], { kind: 'room', roomId: 'tavern' });
  const next = { ...event, seq: 2, payload: { note: { ...event.payload.note, body: 'V2' } } };
  access.capture('c', next, [actor('a', 'street'), actor('b', 'tavern'), dm], { kind: 'room', roomId: 'tavern' });
  assert.equal(access.project('c', event, actor('a', 'street'), state).payload.note.body, 'V1');
  assert.equal(access.project('c', next, actor('a', 'tavern'), state).type, 'stream_checkpoint');
  assert.equal(access.project('c', event, actor('b', 'tavern'), state).type, 'stream_checkpoint');
  assert.equal(access.project('c', next, b, state).payload.note.body, 'V2');
});

test('R01: unscoped sheet updates remain usable by their owner, never a different room', t => {
  const { access } = fixture(t);
  const event = { seq: 1, type: 'sheet_updated', payload: { sheet: { id: 'sheet-a', userId: 'a', notes: 'PRIVATE_SHEET' } } };
  access.capture('c', event, [a, b, dm]);
  assert.deepEqual(access.project('c', event, a, state), event);
  assert.equal(access.project('c', event, b, state).type, 'stream_checkpoint');
  assert.equal(access.project('other', event, b, state).type, 'stream_checkpoint');
});

test('R01: explicit global/OOC remains shared but narration cannot assert global with a payload field', t => {
  const { access } = fixture(t);
  const ooc = { seq: 1, type: 'message_added', payload: { message: { id: 'm', content: '(ooc) Pause', roomId: 'SECRET_ROOM' } } };
  access.capture('c', ooc, [a, b, dm]);
  assert.equal(access.project('c', ooc, b, state).payload.message.content, '(ooc) Pause');
  assert.equal(JSON.stringify(access.project('c', ooc, b, state)).includes('SECRET_ROOM'), false);
  const global = { seq: 2, type: 'note_updated', payload: { note: { body: 'ANNOUNCED' } } };
  access.capture('c', global, [a, b], { kind: 'global' });
  assert.deepEqual(access.project('c', global, b, state), global);
  assert.equal(publicationView('message_added', { channel: 'global', message: { content: 'SECRET' } }, b), null);
});

test('R01: scope intersects blind/self/DM secrecy rather than granting a bypass', () => {
  const roll = { id: 'r', characterId: 'sheet-a', visibility: 'dm', total: 17, dc: 15, success: true, breakdown: { dice: [17] } };
  const scope = { kind: 'global' };
  assert.equal(publicationView('roll_result', { roll }, a, scope), null);
  assert.equal(publicationView('roll_result', { roll: { ...roll, visibility: 'self' } }, b, scope), null);
  const redacted = publicationView('roll_result', { roll: { ...roll, visibility: 'blind' } }, b, scope).roll;
  assert.deepEqual([redacted.total, redacted.dc, redacted.breakdown, redacted.success], [null, null, null, null]);
  assert.equal(publicationView('sheet_updated', { sheet: { userId: 'a' } }, a, { kind: 'dm' }), null);
});

test('R01: role revocation is evaluated on each projection; a former DM gains no permanent receipts', t => {
  const { access } = fixture(t), event = { seq: 1, type: 'private', payload: { secret: true } };
  access.capture('c', event, [a, dm], { kind: 'dm' });
  assert.equal(access.project('c', event, dm, state).payload.secret, true);
  assert.equal(access.project('c', event, actor('dm', null), state).type, 'stream_checkpoint');
  assert.throws(() => access.project('c', event, { ...a, member: false }, state), /revoked/);
});

test('R01: buffered discarded-timeline event cannot borrow a reused sequence receipt', t => {
  const { db, access } = fixture(t);
  const old = { seq: 1, type: 'message_added', payload: { message: { content: 'OLD' } } };
  access.capture('c', old, [a, b], { kind: 'room', roomId: 'tavern' });
  db.exec('DELETE FROM spatial_event_views');
  const next = { ...old, payload: { message: { content: 'NEW' } } };
  access.capture('c', next, [a, b], { kind: 'global' });
  assert.equal(access.project('c', old, b, state).type, 'stream_checkpoint');
  assert.equal(access.project('c', next, b, state).payload.message.content, 'NEW');
});

test('R01: ephemeral DM drafts and unknown fields do not leak into player notifications', () => {
  assert.equal(ephemeralView('dm_delta', { delta: 'SECRET' }, b, true), null);
  assert.deepEqual(ephemeralView('ask_activity', { askId: 'SECRET', question: 'HIDDEN' }, b, true), { type: 'ask_activity', payload: {} });
  assert.deepEqual(ephemeralView('campaign_updated', { title: 'Table', scene: 'SECRET' }, b, true), { type: 'campaign_updated', payload: { title: 'Table' } });
  assert.equal(ephemeralView('dm_delta', { delta: 'SECRET' }, dm, true).payload.delta, 'SECRET');
});

test('R01: stream drains more than one hidden page and still delivers the following authorized event', async t => {
  const { access } = fixture(t), abort = new AbortController(); t.after(() => abort.abort());
  const events = Array.from({ length: 601 }, (_, i) => ({ seq: i + 1, type: 'narration', payload: { content: `SECRET_${i}` } }));
  const last = { seq: 602, type: 'message_added', payload: { message: { content: '(ooc) PUBLIC_END' } } };
  access.capture('c', last, [a, b]); events.push(last);
  const stream = createCampaignStream({ afterSeq: 0, signal: abort.signal, latestSeq: () => 602,
    listEventsSince: (cursor, limit) => events.filter(event => event.seq > cursor).slice(0, limit),
    subscribe: () => () => {}, sseChunk: sse, assertAccess: () => {},
    projectEvent: event => access.project('c', event, b, state), heartbeatMs: 60000 });
  const reader = stream.getReader(); let body = '';
  while (!body.includes('PUBLIC_END')) { const part = await reader.read(); assert.equal(part.done, false); body += new TextDecoder().decode(part.value); }
  assert.equal(body.includes('SECRET_'), false); assert.match(body, /id: 602\nevent: message_added/);
  await reader.cancel();
});

test('R01: live payloads are projected after buffering, not with captured DM privileges', async t => {
  const { access } = fixture(t), abort = new AbortController(); t.after(() => abort.abort());
  let receive, viewer = dm;
  const event = { seq: 1, type: 'sheet_updated', payload: { sheet: { id: 'sheet-a', userId: 'a', private: 'DO_NOT_LEAK' } } };
  access.capture('c', event, [a, b, dm]);
  const stream = createCampaignStream({ afterSeq: 0, signal: abort.signal, latestSeq: () => 0, listEventsSince: () => [],
    subscribe: send => { receive = send; return () => {}; }, sseChunk: sse, heartbeatMs: 60000,
    projectLive: chunk => { const decoded = decodeEventChunk(chunk); const result = access.project('c', decoded, viewer, state); return sse(result.type, result.payload, result.seq); } });
  receive(sse(event.type, event.payload, event.seq));
  viewer = actor('dm', 'street');
  const reader = stream.getReader(); let body = '';
  for (let i = 0; i < 8; i++) { const part = await reader.read(); body += new TextDecoder().decode(part.value); }
  assert.equal(body.includes('DO_NOT_LEAK'), false); assert.match(body, /id: 1\nevent: stream_checkpoint/);
  await reader.cancel();
});

test('R01: idle access revocation closes on the next buffered chunk before emitting it', async t => {
  const abort = new AbortController(); t.after(() => abort.abort());
  let receive, allowed = true;
  const stream = createCampaignStream({ afterSeq: 0, signal: abort.signal, latestSeq: () => 0, listEventsSince: () => [],
    subscribe: send => { receive = send; return () => {}; }, sseChunk: sse, heartbeatMs: 60000,
    assertAccess: () => { if (!allowed) throw new Error('revoked'); } });
  const reader = stream.getReader();
  for (let i = 0; i < 7; i++) await reader.read();
  const waiting = reader.read(); allowed = false; receive(sse('message_added', { secret: true }, 1));
  await assert.rejects(waiting, /revoked/);
});
