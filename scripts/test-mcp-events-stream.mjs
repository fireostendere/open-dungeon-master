// Narrator doorbell: contentless signal reduction, the real internal SSE route
// over real event/stream modules and SQLite, and the real MCP sidecar relay
// against a fake upstream. No Next server or production credential is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import {
  NARRATOR_SIGNAL_NOISE, narratorSignal, narratorSignalChunk, parseNarratorCursor, reduceNarratorLiveChunk,
} from '../src/lib/narrator-signal-stream.mjs';
import * as access from '../src/lib/mcp-access.mjs';
import { createEventsProxy, eventsUrlFrom } from '../mcp/events-proxy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OP = 'operator-test-credential-000000000000000000000';
const NARRATOR = 'narrator-test-credential-000000000000000000000';
const frames = text => text.split('\n\n').filter(Boolean);
const data = frame => JSON.parse(/^data: (.*)$/m.exec(frame)[1]);

// ---------------------------------------------------------------- reduction
test('message_added keeps only type, seq, authorType and kind', () => {
  const payload = { message: {
    id: 'm1', seq: 12, authorType: 'player', kind: 'do', userId: 'user-secret', characterId: 'pc-secret',
    content: 'SECRET_PLAYER_PROSE', combatTurn: { summary: 'SECRET_TURN' }, narrationAudioUrl: '/SECRET.mp3',
  }, beat: true };
  const chunk = narratorSignalChunk('message_added', payload, 12);
  assert.equal(chunk, 'id: 12\nevent: message_added\ndata: {"type":"message_added","seq":12,"authorType":"player","kind":"do"}\n\n');
  assert.doesNotMatch(chunk, /SECRET|user-secret|pc-secret|content|beat/);
  const live = reduceNarratorLiveChunk(`id: 13\nevent: message_updated\ndata: ${JSON.stringify(payload)}\n\n`);
  assert.deepEqual(data(live), { type: 'message_updated', seq: 13, authorType: 'player', kind: 'do' });
  assert.doesNotMatch(live, /SECRET/);
  // Only enum-like strings survive; free text or non-strings are dropped.
  assert.deepEqual(narratorSignal('message_added', { message: { authorType: 42, kind: 'a sentence with spaces', content: 'x' } }, 3), { type: 'message_added', seq: 3 });
  assert.deepEqual(narratorSignal('message_added', { message: 'SECRET' }, 4), { type: 'message_added', seq: 4 });
});

test('other persisted events carry only type and seq', () => {
  const chunk = narratorSignalChunk('sheet_updated', { sheet: { userId: 'A', notes: 'SECRET_SHEET' } }, 7);
  assert.equal(chunk, 'id: 7\nevent: sheet_updated\ndata: {"type":"sheet_updated","seq":7}\n\n');
  assert.equal(reduceNarratorLiveChunk('id: 8\nevent: roll_result\ndata: {"roll":{"total":17,"label":"SECRET"}}\n\n'),
    'id: 8\nevent: roll_result\ndata: {"type":"roll_result","seq":8}\n\n');
});

test('noise frames are dropped in both live and replay form', () => {
  assert.deepEqual([...NARRATOR_SIGNAL_NOISE].sort(), ['ambience_changed', 'ambience_sting', 'map_ping', 'narrator_presence', 'presence', 'voice_audibility_changed', 'voice_mesh_signal', 'voice_roster', 'voice_speaking']);
  for (const type of NARRATOR_SIGNAL_NOISE) {
    assert.equal(reduceNarratorLiveChunk(`event: ${type}\ndata: {"online":["A"]}\n\n`), null, type);
    assert.equal(reduceNarratorLiveChunk(`id: 5\nevent: ${type}\ndata: {}\n\n`), null, type);
    assert.equal(narratorSignalChunk(type, {}, 5), '', type);
  }
});

test('ephemeral frames have no id; comment pings pass through unchanged', () => {
  assert.equal(reduceNarratorLiveChunk('event: ask_activity\ndata: {"question":"SECRET_ASK"}\n\n'), 'event: ask_activity\ndata: {"type":"ask_activity"}\n\n');
  assert.equal(narratorSignalChunk('whisper_activity', {}), 'event: whisper_activity\ndata: {"type":"whisper_activity"}\n\n');
  assert.equal(reduceNarratorLiveChunk(': ping\n\n'), ': ping\n\n');
});

test('stream_checkpoint and campaign_rewound are kept; rewound keeps only a reason token', () => {
  assert.equal(narratorSignalChunk('stream_checkpoint', {}, 9), 'id: 9\nevent: stream_checkpoint\ndata: {"type":"stream_checkpoint","seq":9}\n\n');
  assert.equal(reduceNarratorLiveChunk('id: 9\nevent: stream_checkpoint\ndata: {}\n\n'), 'id: 9\nevent: stream_checkpoint\ndata: {"type":"stream_checkpoint","seq":9}\n\n');
  const rewound = narratorSignalChunk('campaign_rewound', { reason: 'cursor_ahead', chapterIndex: 2, boundarySeq: 4, timelineEpoch: 'SECRET_EPOCH' }, 10);
  assert.equal(rewound, 'id: 10\nevent: campaign_rewound\ndata: {"type":"campaign_rewound","seq":10,"reason":"cursor_ahead"}\n\n');
  assert.ok(rewound.includes('\nevent: campaign_rewound\n'), 'campaign-stream closes on this marker');
  assert.deepEqual(narratorSignal('campaign_rewound', { reason: 'The DM said SECRET things' }, 11), { type: 'campaign_rewound', seq: 11 });
});

test('table talk (OOC) never wakes the narrator, matching the narrator-facing feed filter', () => {
  assert.equal(narratorSignalChunk('message_added', { message: { authorType: 'player', content: '  (OOC) brb SECRET' } }, 3), '');
  assert.equal(reduceNarratorLiveChunk('id: 4\nevent: message_updated\ndata: {"message":{"content":"(ooc) SECRET"}}\n\n'), null);
  assert.equal(reduceNarratorLiveChunk('event: ooc_message\ndata: {"message":{"content":"(ooc) SECRET"}}\n\n'), null);
});

test('malformed frames and unsafe event types are refused, not escaped', () => {
  assert.equal(reduceNarratorLiveChunk('data: {}\n\n'), null);
  assert.equal(reduceNarratorLiveChunk('id: x1\nevent: roll_result\ndata: {}\n\n'), null);
  assert.equal(narratorSignalChunk('bad type\ndata: {"x":1}', {}, 1), '');
  assert.deepEqual(data(reduceNarratorLiveChunk('id: 2\nevent: floor_changed\ndata: not-json\n\n')), { type: 'floor_changed', seq: 2 });
});

test('cursor: Last-Event-ID overrides afterSeq; only non-negative safe integers', () => {
  assert.equal(parseNarratorCursor(null, null), 0);
  assert.equal(parseNarratorCursor(null, '15'), 15);
  assert.equal(parseNarratorCursor('20', '15'), 20);
  assert.equal(parseNarratorCursor('  ', '15'), 15);
  for (const bad of ['-1', '1.5', 'abc', '', '1e3', '9007199254740993', ' 1']) assert.equal(parseNarratorCursor(null, bad), null, bad);
  assert.equal(parseNarratorCursor('abc', '15'), null);
});

// ------------------------------------------------- internal route (real modules)
// Deterministic clock for the offline debounce: timers fire only on advance().
function fakeClock(presence, graceMs = 5000) {
  const clock = { now: 1_000, timers: new Map(), id: 0 };
  clock.advance = ms => {
    clock.now += ms;
    for (const [id, timer] of [...clock.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= clock.now) { clock.timers.delete(id); timer.callback(); }
    }
  };
  presence.configureNarratorPresence({
    now: () => clock.now, graceMs,
    setTimeout: (callback, ms) => { const id = ++clock.id; clock.timers.set(id, { callback, at: clock.now + ms }); return id; },
    clearTimeout: id => { clock.timers.delete(id); },
  });
  return clock;
}
async function routeFixture({ spatial = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE campaigns(id TEXT PRIMARY KEY); INSERT INTO campaigns VALUES('${CAMPAIGN}');
    CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('A'),('B'),('DM');
    CREATE TABLE members(user_id TEXT PRIMARY KEY, role TEXT);
    INSERT INTO members VALUES('A','player'),('B','player'),('DM','dm');
    CREATE TABLE campaign_events(campaign_id TEXT, seq INTEGER, type TEXT, payload_json TEXT, created_at TEXT, PRIMARY KEY(campaign_id,seq));
    CREATE TABLE character_sheets(id TEXT,campaign_id TEXT,user_id TEXT);
    INSERT INTO character_sheets VALUES('pcA','${CAMPAIGN}','A'),('pcB','${CAMPAIGN}','B');`);
  if (spatial) sqlite.exec(`CREATE TABLE spatial_campaigns(campaign_id TEXT PRIMARY KEY,start_seq INTEGER DEFAULT 0);
    INSERT INTO spatial_campaigns(campaign_id) VALUES('${CAMPAIGN}');
    CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
    INSERT INTO spatial_presence VALUES('${CAMPAIGN}','A','vault'),('${CAMPAIGN}','B','street');`);
  let sequence = 0, transactionId = 0;
  const state = { exists: true, dmUserId: 'DM' };
  const db = {
    exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql),
    transaction: work => () => {
      const savepoint = `tx_${++transactionId}`; sqlite.exec(`SAVEPOINT ${savepoint}`);
      try { const result = work(); sqlite.exec(`RELEASE ${savepoint}`); return result; }
      catch (error) { sqlite.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
    },
  };
  const member = userId => sqlite.prepare('SELECT role FROM members WHERE user_id=?').get(userId);
  const env = { ODM_MCP_TOKEN: OP, ODM_MCP_NARRATOR_TOKEN: NARRATOR, ODM_MCP_NARRATOR_CAMPAIGN_ID: CAMPAIGN };
  const context = vm.createContext({ console, TextEncoder, TextDecoder, ReadableStream, Response, Request, URL, AbortController, setInterval, clearInterval, setTimeout, clearTimeout });
  const stubs = {
    'node:crypto': crypto,
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => '2026-09-29T00:00:00Z', parseJson: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } } },
    '@/lib/db/campaigns': {
      allocateSeq: () => ++sequence, latestSeq: () => sequence,
      capsFor: (_campaign, userId) => ({ role: member(userId)?.role }),
      getCampaignForUser: (campaignId, userId) => campaignId === CAMPAIGN && state.exists && member(userId) ? { id: CAMPAIGN } : null,
      getCampaignById: campaignId => campaignId === CAMPAIGN && state.exists ? { id: CAMPAIGN, dmUserId: state.dmUserId } : null,
      listMembers: () => sqlite.prepare('SELECT user_id AS userId FROM members').all(),
    },
    // The real access gate, reading this fixture's environment.
    '@/lib/mcp-access.mjs': { ...access, authenticateMcp: request => access.authenticateMcp(request, env) },
    '@/lib/integrations/rakobot': { queueLegacyPlayerEvent() {}, queuePlayerAction() {} },
    '@/lib/voice/location-access': { voiceAccess: () => ({ members: new Set(['A', 'B']) }) },
    '@/lib/voice/location-policy': { mayShareVoice: () => true, projectVoiceRoster: () => [] },
    '@/lib/voice/types': {},
  };
  const modules = new Map();
  async function load(name, parent) {
    let key;
    if (stubs[name] || name.startsWith('node:')) key = name;
    else if (name.startsWith('@/')) key = new URL(`../src/${name.slice(2)}${/\.(m?js|ts)$/.test(name) ? '' : '.ts'}`, import.meta.url).href;
    else key = new URL(name, parent?.identifier ?? import.meta.url).href;
    if (key.startsWith('file:') && !existsSync(fileURLToPath(key)) && existsSync(fileURLToPath(key) + '.ts')) key += '.ts';
    if (modules.has(key)) return modules.get(key);
    let vmModule;
    if (stubs[key] || key.startsWith('node:')) {
      const values = stubs[key] ?? await import(key);
      vmModule = new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context });
    } else {
      vmModule = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(fileURLToPath(key), 'utf8')), { context, identifier: key });
    }
    modules.set(key, vmModule); await vmModule.link(load); return vmModule;
  }
  const evaluate = async name => { const m = await load(name); await m.evaluate(); return m.namespace; };
  const events = await evaluate('@/lib/events');
  const updates = await evaluate('@/lib/spatial/updates.mjs');
  const route = await evaluate('../src/app/api/internal/mcp/events/route.ts');
  // Same module instance the route imported (keyed by resolved URL).
  const presence = await evaluate('@/lib/dm/narrator-presence');
  // Debounce timers only fire on clock.advance(), never after close().
  const clock = fakeClock(presence);
  const readers = new Set();
  return { sqlite, state, events, updates, route, presence, clock, readers,
    close: async () => { for (const reader of readers) await reader.cancel().catch(() => {}); sqlite.close(); } };
}

function get(f, { token = NARRATOR, query = `campaignId=${CAMPAIGN}`, headers = {} } = {}) {
  const controller = new AbortController();
  const request = new Request(`http://app/api/internal/mcp/events?${query}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, signal: controller.signal,
  });
  return f.route.GET(request).then(response => {
    const getReader = response.body?.getReader.bind(response.body);
    if (getReader) response.reader = () => { const reader = getReader(); f.readers.add(reader); return reader; };
    return response;
  });
}

async function readUntil(reader, state, done, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!done(state.text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`stream never satisfied its condition; got:\n${state.text}`);
    let timer;
    const item = await Promise.race([reader.read(), new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), remaining); })]);
    clearTimeout(timer);
    if (item.timeout) continue;
    if (item.done) { state.ended = true; break; }
    state.text += new TextDecoder().decode(item.value);
  }
  return state.text;
}

test('route: auth, campaign scope, parameter validation and existence', async () => {
  const f = await routeFixture();
  try {
    const expect = async (options, status, pattern) => {
      const response = await get(f, options);
      assert.equal(response.status, status, JSON.stringify(options));
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.match((await response.json()).error, pattern);
    };
    await expect({ token: '' }, 401, /Unauthorized/);
    await expect({ token: 'wrong-token' }, 401, /Unauthorized/);
    await expect({ query: `campaignId=${OTHER}` }, 403, /different campaign/);
    await expect({ token: OP, query: 'campaignId=not-a-uuid' }, 400, /campaignId/);
    await expect({ token: OP, query: '' }, 400, /campaignId/);
    await expect({ token: OP, query: `campaignId=${OTHER}` }, 404, /not found/);
    await expect({ query: `campaignId=${CAMPAIGN}&afterSeq=-1` }, 400, /cursor/);
    await expect({ query: `campaignId=${CAMPAIGN}&afterSeq=1.5` }, 400, /cursor/);
    await expect({ headers: { 'last-event-id': 'abc' } }, 400, /cursor/);
    for (const token of [NARRATOR, OP]) {
      const response = await get(f, { token });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.equal(response.headers.get('cache-control'), 'private, no-store, no-transform');
      assert.equal(response.headers.get('x-accel-buffering'), 'no');
      assert.equal(response.headers.get('connection'), 'keep-alive');
      await response.body.cancel();
    }
  } finally { await f.close(); }
});

test('route: replay and live frames are contentless signals; narrator never joins presence', async () => {
  const f = await routeFixture(); const { events } = f;
  const playerFrames = [];
  const releasePlayer = events.subscribe(CAMPAIGN, chunk => playerFrames.push(chunk), 'A');
  try {
    events.publishPersisted(CAMPAIGN, 'message_added', { message: { id: 'm1', authorType: 'player', userId: 'A', content: 'SECRET_PLAYER_PROSE' } });
    events.publishPersisted(CAMPAIGN, 'message_added', { message: { id: 'm2', authorType: 'player', content: '(ooc) SECRET_TABLE_TALK' } });
    events.publishPersisted(CAMPAIGN, 'sheet_updated', { sheet: { id: 'pcA', userId: 'A', notes: 'SECRET_SHEET' } });
    events.publishPersisted(CAMPAIGN, 'ambience_changed', { cue: 'tavern' });
    const response = await get(f);
    assert.equal(response.status, 200);
    const reader = response.reader(), state = { text: '' };
    await readUntil(reader, state, text => text.includes('event: relationships_updated'));
    const replay = frames(state.text);
    assert.equal(replay[0], 'id: 1\nevent: message_added\ndata: {"type":"message_added","seq":1,"authorType":"player"}');
    assert.equal(replay[1], 'id: 3\nevent: sheet_updated\ndata: {"type":"sheet_updated","seq":3}');
    assert.equal(replay[2], 'id: 4\nevent: stream_checkpoint\ndata: {"type":"stream_checkpoint","seq":4}');
    assert.deepEqual(replay.slice(3).map(data), ['ask_activity', 'whisper_activity', 'facts_updated', 'side_activity', 'battle_map_updated', 'relationships_updated'].map(type => ({ type })));
    assert.ok(replay.slice(3).every(frame => !frame.startsWith('id:')));

    assert.deepEqual([...events.onlineUserIds(CAMPAIGN)], ['A'], 'the narrator stream is not a presence subscriber');
    state.text = '';
    events.publishPersisted(CAMPAIGN, 'message_added', { message: { id: 'm3', authorType: 'dm', content: 'SECRET_DM_PROSE' } });
    events.publishUserEphemeral(CAMPAIGN, 'DM', 'ask_activity', { question: 'SECRET_PRIVATE_ASK' });
    events.publishUserEphemeral(CAMPAIGN, 'A', 'whisper_activity', { text: 'SECRET_FOR_A' });
    events.publishEphemeral(CAMPAIGN, 'map_ping', { x: 1 });
    events.publishEphemeral(CAMPAIGN, 'ooc_message', { message: { content: '(ooc) SECRET_OOC' } });
    events.publishEphemeral(CAMPAIGN, 'dm_status', { state: 'thinking' });
    f.updates.notifySpatialChange(CAMPAIGN);
    events.publishPersisted(CAMPAIGN, 'floor_changed', { floor: { mode: 'open', secret: 'SECRET_FLOOR' } });
    await readUntil(reader, state, text => text.includes('id: 6\n'));
    assert.deepEqual(frames(state.text), [
      'id: 5\nevent: message_added\ndata: {"type":"message_added","seq":5,"authorType":"dm"}',
      'event: ask_activity\ndata: {"type":"ask_activity"}',
      'event: dm_status\ndata: {"type":"dm_status"}',
      'event: spatial_activity\ndata: {"type":"spatial_activity"}',
      'id: 6\nevent: floor_changed\ndata: {"type":"floor_changed","seq":6}',
    ]);
    await reader.cancel();
    assert.ok(!playerFrames.join('').includes('"DM"'), 'no presence frame ever lists the narrator seat');
  } finally { releasePlayer(); await f.close(); }
});

test('route: Last-Event-ID overrides afterSeq', async () => {
  const f = await routeFixture();
  try {
    for (let n = 0; n < 3; n++) f.events.publishPersisted(CAMPAIGN, 'roll_result', { roll: { total: n } });
    const response = await get(f, { query: `campaignId=${CAMPAIGN}&afterSeq=0`, headers: { 'last-event-id': '2' } });
    const reader = response.reader(), state = { text: '' };
    await readUntil(reader, state, text => text.includes('stream_checkpoint'));
    assert.equal(frames(state.text)[0], 'id: 3\nevent: roll_result\ndata: {"type":"roll_result","seq":3}');
    assert.doesNotMatch(state.text, /id: [12]\n/);
    await reader.cancel();
  } finally { await f.close(); }
});

test('route: a changed DM seat or deleted campaign ends the stream', async () => {
  const f = await routeFixture();
  try {
    for (const change of [() => { f.state.dmUserId = 'B'; }, () => { f.state.exists = false; }]) {
      f.state.dmUserId = 'DM'; f.state.exists = true;
      const response = await get(f);
      const reader = response.reader(), state = { text: '' };
      await readUntil(reader, state, text => text.includes('stream_checkpoint'));
      change();
      f.events.publishPersisted(CAMPAIGN, 'floor_changed', { floor: {} });
      await readUntil(reader, state, () => state.ended);
      assert.ok(state.ended);
    }
  } finally { await f.close(); }
});

test('route: in spatial campaigns the narrator still hears table ephemerals via the DM seat', async () => {
  const f = await routeFixture({ spatial: true });
  try {
    const response = await get(f);
    const reader = response.reader(), state = { text: '' };
    await readUntil(reader, state, text => text.includes('event: relationships_updated'));
    state.text = '';
    const anonymous = [];
    const releaseAnonymous = f.events.subscribeRaw(CAMPAIGN, chunk => anonymous.push(chunk));
    f.events.publishEphemeral(CAMPAIGN, 'whisper_activity', {});
    f.events.publishPersisted(CAMPAIGN, 'floor_changed', { floor: {} });
    await readUntil(reader, state, text => text.includes('event: floor_changed'));
    releaseAnonymous();
    assert.deepEqual(frames(state.text), [
      'event: whisper_activity\ndata: {"type":"whisper_activity"}',
      'id: 1\nevent: floor_changed\ndata: {"type":"floor_changed","seq":1}',
    ]);
    assert.ok(!anonymous.join('').includes('whisper_activity'), 'a userless subscriber would have missed it');
    await reader.cancel();
  } finally { await f.close(); }
});

const presenceFrames = chunks => chunks.filter(chunk => chunk.includes('event: narrator_presence\n')).map(data);

test('route: open doorbells are narrator presence; offline is debounced and a quick reconnect is silent', async () => {
  const f = await routeFixture(); const { events, presence, clock } = f;
  const playerFrames = [];
  const releasePlayer = events.subscribe(CAMPAIGN, chunk => playerFrames.push(chunk), 'A');
  try {
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: false, since: null });
    const first = await get(f);
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: true, since: 1000 });
    assert.deepEqual(presenceFrames(playerFrames), [{ online: true, since: 1000 }], 'players hear 0 -> 1');

    clock.now = 2000;
    const second = await get(f, { token: OP });
    await first.body.cancel();
    assert.equal(presenceFrames(playerFrames).length, 1, 'a second stream and closing one of two publish nothing');
    assert.equal(clock.timers.size, 0);

    clock.now = 3000;
    await second.body.cancel();
    assert.equal(clock.timers.size, 1, 'last close arms the offline debounce');
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: true, since: 1000 }, 'still online inside the grace window');
    clock.advance(4000);
    const third = await get(f);
    assert.equal(clock.timers.size, 0, 'a reconnect inside the window cancels it');
    clock.advance(10_000);
    assert.equal(presenceFrames(playerFrames).length, 1, 'no events for the flap');
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: true, since: 1000 });

    clock.now = 20_000;
    await third.body.cancel();
    clock.advance(4999);
    assert.equal(presenceFrames(playerFrames).length, 1);
    clock.advance(1);
    assert.deepEqual(presenceFrames(playerFrames), [{ online: true, since: 1000 }, { online: false, since: 20_000 }],
      '1 -> 0 after the grace; since is when the last stream closed');
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: false, since: 20_000 });

    // Every close path of one stream releases once: cancel then abort of the
    // same request cannot drive the count negative or hide a live stream.
    clock.now = 30_000;
    const controller = new AbortController();
    const doubled = await f.route.GET(new Request(`http://app/api/internal/mcp/events?campaignId=${CAMPAIGN}`,
      { headers: { authorization: `Bearer ${NARRATOR}` }, signal: controller.signal }));
    const live = await get(f);
    await doubled.body.cancel(); controller.abort();
    clock.advance(60_000);
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: true, since: 30_000 }, 'the other stream still counts');
    await live.body.cancel();
    clock.advance(5000);
    assert.deepEqual({ ...presence.getNarratorPresence(CAMPAIGN) }, { online: false, since: 90_000 });
  } finally { releasePlayer(); await f.close(); }
});

test('route: the doorbell never rings the narrator for its own presence', async () => {
  const f = await routeFixture();
  try {
    const response = await get(f);
    const reader = response.reader(), state = { text: '' };
    await readUntil(reader, state, text => text.includes('event: relationships_updated'));
    // Its own 0 -> 1 frame was already dropped above; so is any later transition.
    f.events.publishEphemeral(CAMPAIGN, 'narrator_presence', { online: false, since: 1 }, { kind: 'global' });
    f.events.publishPersisted(CAMPAIGN, 'floor_changed', { floor: {} });
    await readUntil(reader, state, text => text.includes('event: floor_changed'));
    assert.doesNotMatch(state.text, /narrator_presence/);
    await reader.cancel();
  } finally { await f.close(); }
});

test('route source: access gate runs before the stream and never subscribes as a presence user', () => {
  const source = readFileSync(new URL('../src/app/api/internal/mcp/events/route.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('authenticateMcp(') < source.indexOf('createCampaignStream('));
  assert.ok(source.indexOf('authorizeMcpAction(principal, "narrator.read"') < source.indexOf('createCampaignStream('));
  assert.ok(source.includes('subscribeRawObserver(campaignId, send, observer)'));
  // Presence is counted inside subscribe and released by its return value,
  // the one cleanup every close path of createCampaignStream runs.
  assert.match(source, /subscribe: send => \{[\s\S]*const releasePresence = acquireNarratorPresence\(campaignId\);[\s\S]*return \(\) => \{ releasePresence\(\);/);
  assert.ok(!/subscribe(Raw)?\(campaignId, send, /.test(source));
  assert.ok(source.includes('sseChunk: narratorSignalChunk') && source.includes('projectLive: reduceNarratorLiveChunk'));
  assert.ok(!source.includes('viewerUserId') && !/listEventsSince\(campaignId, cursor, limit, /.test(source));
});

// ------------------------------------------------------------ sidecar relay
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeUpstream(t) {
  const upstream = { requests: [], hold: [], respond: null };
  upstream.urlPromise = listen(t, (req, res) => {
    const url = new URL(req.url, 'http://x');
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, closed: false };
    entry.closedPromise = new Promise(resolve => req.socket.once('close', () => { entry.closed = true; resolve(); }));
    upstream.requests.push(entry);
    (upstream.respond ?? ((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('id: 1\nevent: floor_changed\ndata: {"type":"floor_changed","seq":1}\n\n'); }))(req, res, entry);
  });
  return upstream;
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startSidecar(t, env) {
  const port = await freePort();
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ODM_')));
  const child = spawn(process.execPath, ['--import', './mcp/external-tools-preload.mjs', 'mcp/server.mjs'], {
    cwd: root, env: { ...clean, ODM_MCP_HOST: '127.0.0.1', ODM_MCP_PORT: String(port), ...env }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sidecar did not start:\n${log}`)), 15_000);
    child.stderr.on('data', chunk => { log += chunk; if (log.includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`sidecar exited ${code}:\n${log}`)); });
  });
  return `http://127.0.0.1:${port}`;
}

test('sidecar: /mcp/events requires the same origin and bearer checks as /mcp', async t => {
  const upstream = fakeUpstream(t); const upstreamUrl = await upstream.urlPromise;
  const base = await startSidecar(t, { ODM_MCP_TOKEN: OP, ODM_MCP_NARRATOR_TOKEN: NARRATOR, ODM_MCP_CONTROL_URL: `${upstreamUrl}/api/internal/mcp` });
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: OP }]) {
    const response = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`, { headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="open-dungeon-master-mcp"');
    await response.text();
  }
  const foreign = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`, { headers: { authorization: `Bearer ${OP}`, origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403); await foreign.text();
  const post = await fetch(`${base}/mcp/events`, { method: 'POST', headers: { authorization: `Bearer ${OP}` } });
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET'); await post.text();
  assert.equal(upstream.requests.length, 0, 'rejected requests never reach the application');
  // /mcp itself is unchanged.
  const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(mcp.status, 401); await mcp.text();
  const missing = await fetch(`${base}/mcp/other`, { headers: { authorization: `Bearer ${OP}` } });
  assert.equal(missing.status, 404); await missing.text();

  for (const token of [OP, NARRATOR]) {
    const response = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}&afterSeq=4`, { headers: { authorization: `Bearer ${token}`, 'last-event-id': '7' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.headers.get('cache-control'), 'private, no-store, no-transform');
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.equal(await response.text(), 'id: 1\nevent: floor_changed\ndata: {"type":"floor_changed","seq":1}\n\n');
    const seen = upstream.requests.at(-1);
    assert.equal(seen.method, 'GET');
    assert.equal(seen.path, '/api/internal/mcp/events');
    assert.deepEqual(seen.query, { campaignId: CAMPAIGN, afterSeq: '4' });
    assert.equal(seen.headers.authorization, `Bearer ${token}`, 'the caller bearer is forwarded unchanged');
    assert.equal(seen.headers['last-event-id'], '7');
  }
});

test('sidecar: narrator-only mode forces its campaign and uses the upstream credential', async t => {
  const upstream = fakeUpstream(t); const upstreamUrl = await upstream.urlPromise;
  const UPSTREAM = 'upstream-control-credential-00000000000000000';
  const base = await startSidecar(t, {
    ODM_MCP_NARRATOR_ONLY: '1', ODM_MCP_TOKEN: OP, ODM_MCP_UPSTREAM_TOKEN: UPSTREAM, ODM_MCP_NARRATOR_TOKEN: NARRATOR,
    ODM_MCP_NARRATOR_CAMPAIGN_ID: CAMPAIGN, ODM_MCP_CONTROL_URL: `${upstreamUrl}/api/internal/mcp/`,
  });
  const operator = await fetch(`${base}/mcp/events`, { headers: { authorization: `Bearer ${OP}` } });
  assert.equal(operator.status, 401, 'only the narrator credential is accepted'); await operator.text();
  const foreign = await fetch(`${base}/mcp/events?campaignId=${OTHER}`, { headers: { authorization: `Bearer ${NARRATOR}` } });
  assert.equal(foreign.status, 403); assert.match((await foreign.json()).error, /restricted/);
  assert.equal(upstream.requests.length, 0);

  const forced = await fetch(`${base}/mcp/events`, { headers: { authorization: `Bearer ${NARRATOR}` } });
  assert.equal(forced.status, 200); await forced.text();
  assert.deepEqual(upstream.requests.at(-1).query, { campaignId: CAMPAIGN });
  assert.equal(upstream.requests.at(-1).path, '/api/internal/mcp/events');
  assert.equal(upstream.requests.at(-1).headers.authorization, `Bearer ${UPSTREAM}`);
  assert.equal(upstream.requests.at(-1).headers['last-event-id'], undefined);

  const explicit = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}&afterSeq=3`, { headers: { authorization: `Bearer ${NARRATOR}`, 'last-event-id': '9' } });
  assert.equal(explicit.status, 200); await explicit.text();
  assert.deepEqual(upstream.requests.at(-1).query, { campaignId: CAMPAIGN, afterSeq: '3' });
  assert.equal(upstream.requests.at(-1).headers['last-event-id'], '9');
  assert.equal(upstream.requests.at(-1).headers.authorization, `Bearer ${UPSTREAM}`);
});

test('sidecar: streams frames as they arrive, aborts upstream on disconnect, relays upstream errors', async t => {
  const upstream = fakeUpstream(t); const upstreamUrl = await upstream.urlPromise;
  const base = await startSidecar(t, { ODM_MCP_TOKEN: OP, ODM_MCP_CONTROL_URL: `${upstreamUrl}/api/internal/mcp` });
  const auth = { authorization: `Bearer ${OP}` };

  // Streaming: the first frame is readable while upstream still holds the second.
  let release;
  const released = new Promise(resolve => { release = resolve; });
  upstream.respond = async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('id: 1\nevent: message_added\ndata: {"type":"message_added","seq":1}\n\n');
    await released;
    res.write(': ping\n\n');
    res.end('id: 2\nevent: floor_changed\ndata: {"type":"floor_changed","seq":2}\n\n');
  };
  const streamed = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`, { headers: auth });
  assert.equal(streamed.status, 200);
  const reader = streamed.body.getReader(), state = { text: '' };
  await readUntil(reader, state, text => text.includes('id: 1\n'));
  assert.doesNotMatch(state.text, /id: 2/);
  release();
  await readUntil(reader, state, () => state.ended, 5000);
  assert.equal(state.text, 'id: 1\nevent: message_added\ndata: {"type":"message_added","seq":1}\n\n: ping\n\nid: 2\nevent: floor_changed\ndata: {"type":"floor_changed","seq":2}\n\n');

  // Disconnect: the client aborting closes the upstream request.
  upstream.respond = (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': ping\n\n'); };
  const controller = new AbortController();
  const held = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`, { headers: auth, signal: controller.signal });
  const heldReader = held.body.getReader();
  await readUntil(heldReader, { text: '' }, text => text.includes(': ping'));
  const entry = upstream.requests.at(-1);
  assert.equal(entry.closed, false);
  controller.abort();
  await Promise.race([entry.closedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream was not aborted')), 3000))]);
  assert.equal(entry.closed, true);

  // Upstream errors: status relayed, body replaced by a fixed message.
  for (const [status, expected] of [[404, 'Campaign not found.'], [403, 'Forbidden'], [400, 'Invalid event stream request.'], [500, 'ODM event stream is unavailable.']]) {
    upstream.respond = (_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"INTERNAL_DETAIL /opt/odm stack"}'); };
    const response = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`, { headers: auth });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: expected });
    assert.doesNotMatch(body, /INTERNAL_DETAIL/);
  }
});

test('events proxy module: URL derivation, method guard and unreachable upstream', async t => {
  assert.equal(eventsUrlFrom('http://app:3005/api/internal/mcp').href, 'http://app:3005/api/internal/mcp/events');
  assert.equal(eventsUrlFrom('http://app:3005/api/internal/mcp/').href, 'http://app:3005/api/internal/mcp/events');
  for (const bad of ['ftp://app/x', 'http://user:pw@app/x', 'http://app/x?y=1', 'http://app/x#y', 'not a url']) assert.throws(() => eventsUrlFrom(bad), bad);
  const proxy = createEventsProxy({ controlUrl: 'http://127.0.0.1:9/api/internal/mcp', fetchImpl: async () => { throw new Error('connect ECONNREFUSED secret-host'); } });
  const base = await listen(t, (req, res) => void proxy(req, res, { bearer: 'caller-token' }));
  const refused = await fetch(`${base}/mcp/events?campaignId=${CAMPAIGN}`);
  assert.equal(refused.status, 502);
  assert.deepEqual(await refused.json(), { error: 'ODM event stream is unavailable.' });
  const put = await fetch(`${base}/mcp/events`, { method: 'PUT' });
  assert.equal(put.status, 405); await put.text();
  const noCampaign = await fetch(`${base}/mcp/events`);
  assert.equal(noCampaign.status, 400); await noCampaign.text();
});
