import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import * as crypto from 'node:crypto';

// Real SQLite + real event/stream/route modules. Auth/campaign adapters are
// explicit fixtures, not a claim that the full Next server ran in this suite.
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE campaigns(id TEXT PRIMARY KEY);
    INSERT INTO campaigns VALUES('c');
    CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('A'),('B'),('DM');
    CREATE TABLE members(user_id TEXT PRIMARY KEY, role TEXT);
    INSERT INTO members VALUES('A','player'),('B','player'),('DM','dm');
    CREATE TABLE campaign_events(campaign_id TEXT, seq INTEGER, type TEXT, payload_json TEXT, created_at TEXT, PRIMARY KEY(campaign_id,seq));
    CREATE TABLE spatial_campaigns(campaign_id TEXT PRIMARY KEY,start_seq INTEGER DEFAULT 0); INSERT INTO spatial_campaigns(campaign_id) VALUES('c');
    CREATE TABLE character_sheets(id TEXT,campaign_id TEXT,user_id TEXT);
    INSERT INTO character_sheets VALUES('pcA','c','A'),('pcB','c','B');
    CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
    INSERT INTO spatial_presence VALUES('c','A','vault'),('c','B','street');`);
  let sequence = 0, authenticated = 'A', transactionId = 0;
  const db = {
    exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql),
    transaction: work => () => {
      const savepoint = `tx_${++transactionId}`; sqlite.exec(`SAVEPOINT ${savepoint}`);
      try { const result = work(); sqlite.exec(`RELEASE ${savepoint}`); return result; }
      catch (error) { sqlite.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
    },
  };
  const getCampaignForUser = (campaignId, userId) => campaignId === 'c' && sqlite.prepare('SELECT 1 FROM members WHERE user_id=?').get(userId) ? { id: 'c' } : null;
  const capsFor = (_campaign, userId) => ({ role: sqlite.prepare('SELECT role FROM members WHERE user_id=?').get(userId)?.role });
  const context = vm.createContext({ console, TextEncoder, TextDecoder, ReadableStream, Response, Request, URL, AbortController, setInterval, clearInterval });
  const stubs = {
    'node:crypto': crypto,
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => '2026-09-18T00:00:00Z', parseJson: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } } },
    '@/lib/db/campaigns': { allocateSeq: () => ++sequence, latestSeq: () => sequence, capsFor, getCampaignForUser,
      getCampaignById: campaignId => campaignId === 'c' ? { id: 'c' } : null,
      listMembers: () => sqlite.prepare('SELECT user_id AS userId FROM members').all() },
    '@/lib/campaign-api': {
      capsFor: member => capsFor(member.campaign, member.user.id), isErrorResponse: value => value instanceof Response,
      requireMember: async campaignId => getCampaignForUser(campaignId, authenticated) ? { campaign: { id: campaignId }, user: { id: authenticated } } : Response.json({ error: 'not found' }, { status: 404 }),
    },
  };
  const modules = new Map();
  async function load(name, parent) {
    let key = stubs[name] || name.startsWith('node:') ? name : name.startsWith('@/')
      ? new URL(`../src/${name.slice(2)}.ts`, import.meta.url).href : new URL(name, parent?.identifier ?? import.meta.url).href;
    if (key.startsWith('file:') && !existsSync(fileURLToPath(key)) && existsSync(fileURLToPath(key) + '.ts')) key += '.ts';
    if (modules.has(key)) return modules.get(key);
    let module;
    if (stubs[key] || key.startsWith('node:')) {
      const values = stubs[key] ?? await import(key);
      module = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    } else {
      const source = readFileSync(fileURLToPath(key), 'utf8');
      module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: key });
    }
    modules.set(key, module); await module.link(load); return module;
  }
  const events = await load('@/lib/events'); await events.evaluate();
  const timeline = await load('@/lib/spatial/timeline'); await timeline.evaluate();
  const stream = await load('@/lib/campaign-stream'); await stream.evaluate();
  const route = await load('../src/app/api/campaigns/[campaignId]/events/route.ts'); await route.evaluate();
  return { db, sqlite, timeline: timeline.namespace, events: events.namespace, stream: stream.namespace, route: route.namespace,
    authenticate: user => { authenticated = user; }, close: () => sqlite.close() };
}

async function replay(f, user, until) {
  f.authenticate(user);
  const response = await f.route.GET(new Request('http://localhost/api/campaigns/c/events'), { params: Promise.resolve({ campaignId: 'c' }) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); let text = '';
  try {
    for (let n = 0; n < 2500; n++) {
      const item = await reader.read(); if (item.done) break;
      text += new TextDecoder().decode(item.value);
      if (text.includes(until)) return text;
    }
    throw new Error('Replay never reached its positive control');
  } finally { await reader.cancel(); }
}

test('R01: actual route replay and live fan-out hide a foreign sheet, with owner and DM positive controls', async () => {
  const f = await fixture(); const received = { A: [], B: [], DM: [] };
  const releases = Object.keys(received).map(user => f.events.subscribe('c', chunk => received[user].push(chunk), user));
  try {
    f.events.publishPersisted('c', 'sheet_updated', { sheet: { id: 'pcA', userId: 'A', secret: 'SHEET_SECRET' } });
    f.events.publishPersisted('c', 'public_control', { text: 'GLOBAL_CONTROL' }, { kind: 'global' });
    for (const user of ['A', 'B', 'DM']) {
      const bytes = await replay(f, user, 'GLOBAL_CONTROL');
      assert.equal(bytes.includes('SHEET_SECRET'), user !== 'B');
      assert.equal(received[user].join('').includes('SHEET_SECRET'), user !== 'B');
      assert.ok(bytes.includes('GLOBAL_CONTROL'));
    }
    assert.match(received.B.join(''), /id: 1\nevent: stream_checkpoint/);
    f.authenticate('outsider');
    assert.equal((await f.route.GET(new Request('http://localhost/events'), { params: Promise.resolve({ campaignId: 'c' }) })).status, 404);
  } finally { for (const release of releases) release(); f.close(); }
});

test('R01: write-time room audience survives movement; entering a room does not grant its past', async () => {
  const f = await fixture();
  try {
    f.events.publishPersisted('c', 'scene', { text: 'PAST_VAULT' }, { kind: 'room', roomId: 'vault' });
    f.db.exec("UPDATE spatial_presence SET room_id=CASE user_id WHEN 'A' THEN 'street' ELSE 'vault' END");
    f.events.publishPersisted('c', 'scene', { text: 'NEW_VAULT' }, { kind: 'room', roomId: 'vault' });
    const a = JSON.stringify(f.events.listEventsSince('c', 0, 500, 'A'));
    const b = JSON.stringify(f.events.listEventsSince('c', 0, 500, 'B'));
    assert.match(a, /PAST_VAULT/); assert.doesNotMatch(a, /NEW_VAULT/);
    assert.match(b, /NEW_VAULT/); assert.doesNotMatch(b, /PAST_VAULT/);
    assert.doesNotMatch(a, /audience/);
  } finally { f.close(); }
});

test('R01: unknown legacy audiences and payload-supplied room grants fail closed', async () => {
  const f = await fixture();
  try {
    f.db.prepare('INSERT INTO campaign_events VALUES(?,?,?,?,?)').run('c', 0, 'scene', JSON.stringify({ text: 'LEGACY_SECRET' }), 'old');
    f.events.publishPersisted('c', 'scene', { text: 'FORGED_SECRET', roomId: 'street', userIds: ['B'] });
    assert.doesNotMatch(JSON.stringify(f.events.listEventsSince('c', -1, 500, 'B')), /SECRET/);
    assert.match(JSON.stringify(f.events.listEventsSince('c', -1, 500, 'DM')), /LEGACY_SECRET/);
  } finally { f.close(); }
});

test('R01: generic campaign updates redact scene/floor state but retain table metadata', async () => {
  const f = await fixture();
  try {
    f.events.publishPersisted('c', 'campaign_updated', { title: 'New title', scene: 'PRIVATE_SCENE', floor: { currentName: 'PRIVATE_NPC' } });
    const bytes = JSON.stringify(f.events.listEventsSince('c', 0, 10, 'B'));
    assert.match(bytes, /New title/); assert.doesNotMatch(bytes, /PRIVATE/);
  } finally { f.close(); }
});

test('R01: membership revocation and DM demotion are checked again on live and replay', async () => {
  const f = await fixture(); const a = [], dm = [];
  const offA = f.events.subscribe('c', chunk => a.push(chunk), 'A');
  const offDm = f.events.subscribe('c', chunk => dm.push(chunk), 'DM');
  try {
    a.length = 0; dm.length = 0;
    f.db.exec("DELETE FROM members WHERE user_id='A'; UPDATE members SET role='player' WHERE user_id='DM'");
    f.events.publishPersisted('c', 'secret', { text: 'REVOKED_SECRET' });
    assert.equal(a.length, 0); assert.doesNotMatch(dm.join(''), /REVOKED_SECRET/);
    assert.doesNotMatch(JSON.stringify(f.events.listEventsSince('c', 0, 10, 'DM')), /REVOKED_SECRET/);
  } finally { offA(); offDm(); f.close(); }
});

test('R01: more than two pages of hidden events still reach a visible tail without a replay loop', async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 1001; n++) f.events.publishPersisted('c', 'secret', { text: 'HIDDEN_MARKER' });
    f.events.publishPersisted('c', 'control', { text: 'VISIBLE_TAIL' }, { kind: 'global' });
    const bytes = await replay(f, 'B', 'VISIBLE_TAIL');
    assert.doesNotMatch(bytes, /HIDDEN_MARKER/); assert.match(bytes, /id: 1002/);
  } finally { f.close(); }
});

test('R01: audience column initialization recovers after rolled-back DDL', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.db.transaction(() => { f.events.publishPersisted('c', 'secret', {}); throw new Error('rollback'); })());
    assert.ok(!f.db.prepare('PRAGMA table_info(campaign_events)').all().some(column => column.name === 'audience_json'));
    f.events.publishPersisted('c', 'control', { text: 'AFTER_ROLLBACK' }, { kind: 'global' });
    assert.match(JSON.stringify(f.events.listEventsSince('c', 0, 10, 'B')), /AFTER_ROLLBACK/);
  } finally { f.close(); }
});

test('R01: private ephemeral notifications stay private, even from the DM, and revoked recipients get nothing', async () => {
  const f = await fixture(); const a = [], b = [], dm = [];
  const offs = [[a, 'A'], [b, 'B'], [dm, 'DM']].map(([chunks, user]) => f.events.subscribe('c', chunk => chunks.push(chunk), user));
  try {
    a.length = b.length = dm.length = 0;
    f.events.publishUserEphemeral('c', 'A', 'ask_activity', { text: 'ASK_SECRET' });
    assert.match(a.join(''), /event: ask_activity/);
    assert.doesNotMatch(a.join(''), /ASK_SECRET/, 'activity is a content-free private wakeup, not the Ask payload');
    assert.equal(b.length, 0); assert.equal(dm.length, 0);
    f.db.exec("DELETE FROM members WHERE user_id='A'"); a.length = 0;
    f.events.publishUserEphemeral('c', 'A', 'ask_activity', { text: 'AFTER_REVOKE' }); assert.equal(a.length, 0);
  } finally { for (const off of offs) off(); f.close(); }
});

test('R01: stream rejects revoked delivery before subscription or buffered output', async () => {
  const f = await fixture(); let allowed = false, subscribed = false;
  try {
    const stream = f.stream.createCampaignStream({ afterSeq: 0, signal: new AbortController().signal,
      latestSeq: () => 0, listEventsSince: () => [], subscribe: () => { subscribed = true; return () => {}; },
      canDeliver: () => allowed, sseChunk: f.events.sseChunk });
    assert.equal((await stream.getReader().read()).done, true); assert.equal(subscribed, false);
    allowed = true; let receive, released = false;
    const buffered = f.stream.createCampaignStream({ afterSeq: 0, signal: new AbortController().signal,
      latestSeq: () => 0, listEventsSince: () => [], subscribe: send => { receive = send; return () => { released = true; }; },
      canDeliver: () => allowed, sseChunk: f.events.sseChunk });
    receive(f.events.sseChunk('secret', { text: 'BUFFERED_SECRET' }, 1));
    allowed = false;
    assert.equal((await buffered.getReader().read()).done, true); assert.equal(released, true);
  } finally { f.close(); }
});


test('R06: repeated rewind at the same sequence and timestamp gets a distinct durable timeline', async () => {
  const f = await fixture();
  try {
    const initial = f.timeline.campaignTimelineEpoch('c');
    f.events.publishWithSeq('c', 1, 'campaign_rewound', { boundarySeq: 0 });
    const first = f.timeline.campaignTimelineEpoch('c');
    // The real spatial snapshot restore clears event views with the timeline.
    f.db.exec('DELETE FROM spatial_event_views; DELETE FROM campaign_events');
    f.events.publishWithSeq('c', 1, 'campaign_rewound', { boundarySeq: 0 });
    const second = f.timeline.campaignTimelineEpoch('c');
    assert.notEqual(first, initial); assert.notEqual(second, first);
    assert.equal(second, f.timeline.campaignTimelineEpoch('c'));
    assert.doesNotMatch(JSON.stringify(f.events.listEventsSince('c', 0, 10, 'A')), /timelineEpoch/);
  } finally { f.close(); }
});
