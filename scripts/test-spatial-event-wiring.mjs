// Real event publisher, policy, transport and HTTP route with actual SQLite.
// Auth/campaign helpers are narrow doubles, not production session middleware.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import vm from 'node:vm';
import * as access from '../src/lib/spatial/event-access.mjs';

async function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER DEFAULT 1);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE members(campaign_id TEXT,user_id TEXT,role TEXT);
    CREATE TABLE character_sheets(id TEXT,campaign_id TEXT,user_id TEXT);
    CREATE TABLE spatial_campaigns(campaign_id TEXT PRIMARY KEY,start_seq INTEGER);
    CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
    CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,type TEXT,payload_json TEXT,created_at TEXT,PRIMARY KEY(campaign_id,seq));
    INSERT INTO campaigns VALUES('c',1); INSERT INTO users VALUES('a'),('b'),('dm');
    INSERT INTO members VALUES('c','a','player'),('c','b','player'),('c','dm','dm');
    INSERT INTO character_sheets VALUES('sheet-a','c','a'),('sheet-b','c','b');
    INSERT INTO spatial_campaigns VALUES('c',1);
    INSERT INTO spatial_presence VALUES('c','a','tavern'),('c','b','street');`);
  let tx = 0;
  db.transaction = fn => (...args) => { const name = `tx${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const result = fn(...args); db.exec(`RELEASE ${name}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; } };
  const helpers = {
    getCampaignById: id => db.prepare('SELECT * FROM campaigns WHERE id=?').get(id),
    listMembers: id => db.prepare('SELECT user_id AS userId FROM members WHERE campaign_id=?').all(id),
    capsFor: (campaign, userId) => ({ role: db.prepare('SELECT role FROM members WHERE campaign_id=? AND user_id=?').get(campaign.id, userId)?.role }),
    allocateSeq: id => db.prepare('UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq').get(id).seq,
    latestSeq: id => db.prepare('SELECT next_seq-1 AS seq FROM campaigns WHERE id=?').get(id).seq,
  };
  const context = vm.createContext({ console, URL, Request, Response, TextEncoder, ReadableStream, setTimeout, clearTimeout, setInterval, clearInterval });
  const modules = new Map();
  const values = {
    'node:async_hooks': { AsyncLocalStorage },
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => new Date().toISOString(), parseJson: (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } } },
    '@/lib/db/campaigns': helpers,
    './event-access.mjs': access,
    '@/lib/campaign-api': { isErrorResponse: value => value instanceof Response,
      requireMember: async () => ({ campaign: { id: 'c' }, user: { id: 'b' } }) },
  };
  const files = {
    '@/lib/db/commit-effects': '../src/lib/db/commit-effects.ts',
    '@/lib/spatial/event-policy': '../src/lib/spatial/event-policy.ts',
    '@/lib/events': '../src/lib/events.ts',
    '@/lib/campaign-stream': '../src/lib/campaign-stream.ts',
    route: '../src/app/api/campaigns/[campaignId]/events/route.ts',
  };
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let mod;
    if (values[name]) mod = new vm.SyntheticModule(Object.keys(values[name]), function () { for (const [key, value] of Object.entries(values[name])) this.setExport(key, value); }, { context });
    else { assert.ok(files[name], `Unknown dependency ${name}`);
      mod = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(new URL(files[name], import.meta.url), 'utf8')), { context, identifier: name }); }
    modules.set(name, mod);
    await mod.link(load); return mod;
  }
  const route = await load('route'); await route.evaluate();
  return { db, helpers, route: route.namespace, events: modules.get('@/lib/events').namespace,
    effects: modules.get('@/lib/db/commit-effects').namespace, policy: modules.get('@/lib/spatial/event-policy').namespace };
}

test('R01: actual publisher writes immutable audiences atomically and keeps raw internal narrator events', async t => {
  const f = await fixture(t), payload = { sheet: { id: 'sheet-a', userId: 'a', secret: 'PRIVATE_SHEET' } };
  f.events.publishPersisted('c', 'sheet_updated', payload);
  const event = f.events.listEventsSince('c', 0)[0];
  assert.equal(event.payload.sheet.secret, 'PRIVATE_SHEET');
  assert.equal(f.policy.campaignEventProjector('c', 'b').projectEvent(event).type, 'stream_checkpoint');
  assert.equal(f.policy.campaignEventProjector('c', 'a').projectEvent(event).payload.sheet.secret, 'PRIVATE_SHEET');
  const receiptCount = f.db.prepare('SELECT count(*) AS n FROM spatial_event_views').get().n;
  assert.throws(() => f.events.publishWithSeq('c', event.seq, 'message_added', { message: { content: '(ooc) FAILED' } }));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM spatial_event_views').get().n, receiptCount);
});

test('R01: actual HTTP replay uses the projector; local audience and OOC positive controls work', async t => {
  const f = await fixture(t), abort = new AbortController(); t.after(() => abort.abort());
  f.policy.withEventScope('c', { kind: 'room', roomId: 'tavern' }, () => f.events.publishPersisted('c', 'note_updated', { note: { body: 'SECRET_TAVERN' } }));
  f.policy.withEventScope('c', { kind: 'room', roomId: 'street' }, () => f.events.publishPersisted('c', 'note_updated', { note: { body: 'VISIBLE_STREET' } }));
  f.events.publishPersisted('c', 'message_added', { message: { content: '(ooc) PUBLIC_END' } });
  const response = await f.route.GET(new Request('http://local/events', { signal: abort.signal }), { params: Promise.resolve({ campaignId: 'c' }) });
  const reader = response.body.getReader(); let body = '';
  while (!body.includes('PUBLIC_END')) { const part = await reader.read(); body += new TextDecoder().decode(part.value); }
  assert.equal(body.includes('SECRET_TAVERN'), false); assert.equal(body.includes('VISIBLE_STREET'), true);
  await reader.cancel();
});

test('R01: actual HTTP live filters foreign updates and rechecks membership before delivery', async t => {
  const f = await fixture(t), abort = new AbortController(); t.after(() => abort.abort());
  const response = await f.route.GET(new Request('http://local/events', { signal: abort.signal }), { params: Promise.resolve({ campaignId: 'c' }) });
  const reader = response.body.getReader(); let body = '';
  f.events.publishPersisted('c', 'sheet_updated', { sheet: { id: 'sheet-a', userId: 'a', secret: 'FOREIGN' } });
  f.events.publishPersisted('c', 'message_added', { message: { content: '(ooc) LIVE_END' } });
  while (!body.includes('LIVE_END')) { const part = await reader.read(); body += new TextDecoder().decode(part.value); }
  assert.equal(body.includes('FOREIGN'), false);
  f.db.prepare("DELETE FROM members WHERE user_id='b'").run();
  const pending = reader.read(); f.events.publishPersisted('c', 'message_added', { message: { content: '(ooc) AFTER_KICK' } });
  await assert.rejects(pending, /revoked/);
});

test('R01: an outer rolled-back transaction emits neither live data nor saved audience', async t => {
  const f = await fixture(t); const sent = [];
  const unsubscribe = f.events.subscribe('c', chunk => sent.push(chunk)); t.after(unsubscribe);
  assert.throws(() => f.effects.withCommittedEffects(() => f.db.transaction(() => {
    f.events.publishPersisted('c', 'message_added', { message: { content: '(ooc) NEVER_COMMITTED' } });
    throw new Error('rollback');
  })()), /rollback/);
  assert.equal(sent.length, 0);
  const exists = f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_event_views'").get();
  assert.equal(exists ? f.db.prepare('SELECT count(*) AS n FROM spatial_event_views').get().n : 0, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM campaign_events').get().n, 0);
  f.events.publishPersisted('c', 'message_added', { message: { content: '(ooc) AFTER_ROLLBACK' } });
  assert.equal(sent.length, 1);
  assert.ok(f.db.prepare('SELECT count(*) AS n FROM spatial_event_views').get().n > 0);
});

test('R01: rewind to a pre-spatial database cannot expose an old buffered spatial payload', async t => {
  const f = await fixture(t);
  f.events.publishPersisted('c', 'sheet_updated', { sheet: { id: 'sheet-a', userId: 'a', secret: 'DISCARDED' } });
  const event = f.events.listEventsSince('c', 0)[0];
  f.db.exec('DELETE FROM campaign_events; DELETE FROM spatial_campaigns; DELETE FROM spatial_event_views;');
  const frame = f.policy.campaignEventProjector('c', 'b').projectLive(f.events.sseChunk(event.type, event.payload, event.seq));
  assert.equal(frame.includes('DISCARDED'), false); assert.match(frame, /stream_checkpoint/);
});
