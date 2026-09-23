// Real SQLite transactions and real integration/route code. Existing game-domain
// lookups are controlled fixtures; no production server or Telegram is contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as outboxModule from '../src/lib/integrations/rakobot-outbox.mjs';
const { createActionOutbox, actionFingerprint, feedConfig, authorizedFeed, FeedConflict, visibleToWholeParty } = outboxModule;
const root = new URL('../', import.meta.url);
const campaignId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const token = 'x'.repeat(64);
let count = 0;
const savedEnv = { token: process.env.RAKOBOT_FEED_TOKEN, ids: process.env.RAKOBOT_CAMPAIGN_IDS };
function configured() { process.env.RAKOBOT_FEED_TOKEN = token; process.env.RAKOBOT_CAMPAIGN_IDS = campaignId; }
function database() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY);
    CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,type TEXT,payload_json TEXT,created_at TEXT,audience_json TEXT);
    CREATE TABLE spatial_messages(id TEXT PRIMARY KEY,campaign_id TEXT,kind TEXT,author_user_id TEXT,content TEXT,stealth INTEGER,stealth_status TEXT);
    CREATE TABLE spatial_receipts(campaign_id TEXT,message_id TEXT,user_id TEXT);`);
  raw.prepare('INSERT INTO campaigns VALUES(?)').run(campaignId);
  raw.prepare('INSERT INTO campaigns VALUES(?)').run(otherId);
  let depth = 0;
  return { prepare: sql => raw.prepare(sql), exec: sql => raw.exec(sql), close: () => raw.close(),
    transaction: fn => (...args) => {
      const name = `s${depth}`, nested = depth > 0;
      raw.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN'); depth++;
      try { const value = fn(...args); raw.exec(nested ? `RELEASE ${name}` : 'COMMIT'); return value; }
      catch (error) { raw.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK'); throw error; }
      finally { depth--; }
    },
  };
}
function fixture() {
  configured();
  const db = database();
  const members = [{ userId: 'p1', username: 'Alice' }, { userId: 'p2', username: 'Bob' }, { userId: 'dm', username: 'DM' }];
  const campaign = { id: campaignId, title: 'Кампания <&>', kind: 'campaign' };
  const messages = new Map(), audiences = new Map(), sheets = new Map([['p1', { name: 'Арагорн' }], ['p2', { name: 'Гимли' }]]);
  const outbox = createActionOutbox(db);
  return { db, members, campaign, messages, audiences, sheets, outbox,
    legacy(id = randomUUID(), recipients = members.map(m => m.userId), author = 'p1') {
      const message = { id, campaignId, seq: messages.size + 1, authorType: 'player', userId: author, content: 'Осматриваю дверь.' };
      messages.set(id, message); audiences.set(id, recipients);
      db.prepare('INSERT INTO campaign_events(campaign_id,seq,type,payload_json) VALUES(?,?,?,?)').run(campaignId, message.seq, 'message_added', JSON.stringify({ message }));
      return message;
    },
    spatial(id = randomUUID(), recipients = ['p1', 'p2'], stealth = 0, status = 'none', kind = 'do') {
      db.prepare('INSERT INTO spatial_messages VALUES(?,?,?,?,?,?,?)').run(id, campaignId, kind, 'p1', 'Открываю дверь.', stealth, status);
      for (const user of recipients) db.prepare('INSERT INTO spatial_receipts VALUES(?,?,?)').run(campaignId, id, user);
      return id;
    },
  };
}
function record(id = randomUUID(), extra = {}) {
  return { campaignId, source: 'legacy', messageId: id, kind: 'do', publicAtCreation: true,
    fingerprint: actionFingerprint('p1', 'quote'), ...extra };
}
function cursor(head) { return { stream: head.stream, ...head.cursor }; }
function scalar(f, sql) { return f.db.prepare(sql).get(); }
async function modules(f) {
  const context = vm.createContext({ console, process, Response, Request, URL, Set, Map, JSON, Error, crypto: { randomUUID } });
  const cache = new Map();
  function synthetic(name, values) {
    const mod = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context, identifier: name });
    cache.set(name, mod); return mod;
  }
  synthetic('node:crypto', { randomUUID });
  synthetic('@/lib/db/core', { getDatabase: () => f.db, nowIso: () => new Date().toISOString(), parseJson: (value, fallback) => value ? JSON.parse(value) : fallback });
  synthetic('@/lib/db/commit-effects', { withCommittedEffects: fn => fn(), afterCommit: () => {} });
  synthetic('@/lib/campaign-types', { isOocMessage: message => /^\s*\(ooc\)/i.test(message.content) });
  synthetic('@/lib/spatial/event-privacy', { captureEventAudience: () => null, ensureEventAudienceColumn: () => {}, projectEventForUser: (_, __, event) => event });
  synthetic('@/lib/db/campaigns', {
    allocateSeq: () => f.messages.size + 1,
    getCampaignById: id => id === campaignId ? f.campaign : null,
    listMembers: () => f.members,
    capsFor: (_, id) => ({ role: id === 'dm' ? 'dm' : 'player' }),
  });
  synthetic('@/lib/db/messages', { getCampaignMessage: id => f.messages.get(id) ?? null });
  synthetic('@/lib/db/sheets', { getSheetForUser: (_, id) => f.sheets.get(id) ?? null });
  synthetic('@/lib/spatial/event-policy', { captureEventAudience: () => {}, eventSpatialState: () => ({ enabled: false }), campaignEventProjector: (_, id) => ({
    projectEvent: event => f.audiences.get(event.payload.message.id)?.includes(id)
      ? event : { seq: event.seq, type: 'stream_checkpoint', payload: {} },
  }) });
  synthetic('@/lib/integrations/rakobot-outbox.mjs', outboxModule);
  async function load(name, file) {
    const source = readFileSync(new URL(file, root), 'utf8');
    const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const mod = new vm.SourceTextModule(result.outputText, { context, identifier: name });
    cache.set(name, mod);
    await mod.link(specifier => {
      if (specifier === './rakobot-outbox.mjs') specifier = '@/lib/integrations/rakobot-outbox.mjs';
      if (!cache.has(specifier)) throw new Error(`Missing test dependency: ${specifier}`);
      return cache.get(specifier);
    });
    await mod.evaluate(); return mod.namespace;
  }
  synthetic('@/lib/voice/location-access', { voiceAccess: () => ({ members: [] }) });
  synthetic('@/lib/voice/location-policy', { mayShareVoice: () => true, projectVoiceRoster: () => [] });
  synthetic('@/lib/voice/types', {});
  await load('@/lib/player-message', 'src/lib/player-message.ts');
  const integration = await load('@/lib/integrations/rakobot', 'src/lib/integrations/rakobot.ts');
  const route = await load('route', 'src/app/api/internal/rakobot/actions/route.ts');
  await load('@/lib/events-core', 'src/lib/events-core.ts');
  const events = await load('@/lib/events', 'src/lib/events.ts');
  return { integration, route, events };
}
async function test(name, run) {
  const f = fixture();
  try { await run(f); console.log(`ok ${++count} - ${name}`); }
  finally { f.db.close(); }
}
try {
  await test('configuration is disabled by default, exact and campaign-scoped', () => {
    assert.equal(feedConfig({}), null);
    assert.equal(feedConfig({ RAKOBOT_FEED_TOKEN: token, RAKOBOT_CAMPAIGN_IDS: campaignId }).campaigns.size, 1);
    for (const env of [{ RAKOBOT_FEED_TOKEN: token }, { RAKOBOT_CAMPAIGN_IDS: campaignId },
      { RAKOBOT_FEED_TOKEN: 'short', RAKOBOT_CAMPAIGN_IDS: campaignId },
      { RAKOBOT_FEED_TOKEN: token, RAKOBOT_CAMPAIGN_IDS: '*' }]) assert.throws(() => feedConfig(env));
  });
  await test('authorization requires the dedicated exact bearer', () => {
    assert(authorizedFeed(`Bearer ${token}`, token));
    for (const header of [null, '', token, `Bearer ${token} `, `bearer ${token}`, `Bearer ${'y'.repeat(64)}`]) assert(!authorizedFeed(header, token));
  });
  await test('whole-party privacy is not empty, partial or stealth', () => {
    assert(visibleToWholeParty(['a', 'b'], ['b', 'a']));
    assert(!visibleToWholeParty([], []));
    assert(!visibleToWholeParty(['a', 'b'], ['a']));
    assert(!visibleToWholeParty(['a'], ['a'], true));
  });
  await test('schema and queue roll back together and can be initialized again', f => {
    assert.throws(f.db.transaction(() => { f.outbox.enqueue(record()); throw new Error('rejected turn'); }));
    assert.equal(scalar(f, "SELECT count(*) n FROM sqlite_master WHERE name='rakobot_action_outbox'").n, 0);
    f.db.transaction(() => f.outbox.enqueue(record()))();
    assert.equal(scalar(f, 'SELECT count(*) n FROM rakobot_action_outbox').n, 1);
  });
  await test('outer rollback undoes a nested accepted action', f => {
    f.outbox.head();
    assert.throws(f.db.transaction(() => { f.db.transaction(() => f.outbox.enqueue(record()))(); throw new Error('outer rejected'); }));
    assert.equal(scalar(f, 'SELECT count(*) n FROM rakobot_action_outbox').n, 0);
  });
  await test('same message is enqueued once; rejected visibility is immutable', f => {
    const head = f.outbox.head(), value = record('same', { publicAtCreation: false });
    f.outbox.enqueue(value); f.outbox.enqueue({ ...value, publicAtCreation: true });
    const page = f.outbox.page(cursor(head), () => { throw new Error('private record must not be projected'); });
    assert.equal(page.entries.length, 1); assert.equal(page.entries[0].event, null);
  });
  await test('ordered bounded pages with private gaps and restart', f => {
    const head = f.outbox.head();
    for (let i = 0; i < 29; i++) f.outbox.enqueue(record(`${i}`, { publicAtCreation: i % 2 === 0 }));
    const first = f.outbox.page(cursor(head), row => row.message_id);
    assert.equal(first.entries.length, 25); assert.equal(first.entries[1].event, null);
    const last = first.entries.at(-1);
    const next = createActionOutbox(f.db).page({ stream: head.stream, id: last.id, anchor: last.anchor }, row => row.message_id);
    assert.equal(next.entries.length, 4); assert(next.entries[0].id > last.id);
    assert.equal(f.outbox.head().cursor.id, next.entries.at(-1).id);
  });
  await test('invalid, foreign and restored cursors fail closed', f => {
    f.outbox.enqueue(record()); const head = f.outbox.head();
    for (const value of [null, { ...cursor(head), id: -1 }, { ...cursor(head), id: 0.5 },
      { ...cursor(head), stream: randomUUID() }, { ...cursor(head), anchor: randomUUID() },
      { ...cursor(head), id: 0, anchor: head.cursor.anchor }]) assert.throws(() => f.outbox.page(value, () => null), FeedConflict);
    f.db.prepare('UPDATE rakobot_action_outbox SET anchor=? WHERE id=?').run(randomUUID(), head.cursor.id);
    assert.throws(() => f.outbox.page(cursor(head), () => null), FeedConflict);
  });
  await test('deleted campaign cascades queue; stale cursor is not silently reset', f => {
    f.outbox.enqueue(record()); const head = f.outbox.head();
    f.db.prepare('DELETE FROM campaigns WHERE id=?').run(campaignId);
    assert.equal(scalar(f, 'SELECT count(*) n FROM rakobot_action_outbox').n, 0);
    assert.throws(() => f.outbox.page(cursor(head), () => null), FeedConflict);
  });
  await test('queue stores no copy of the quoted action', f => {
    f.outbox.enqueue(record());
    const fields = f.db.prepare('PRAGMA table_info(rakobot_action_outbox)').all().map(row => row.name);
    for (const name of ['content', 'quote', 'payload', 'token']) assert(!fields.includes(name));
  });
  await test('public legacy action exports exact campaign/player/character/quote', async f => {
    const { integration: api } = await modules(f), head = f.outbox.head(), message = f.legacy();
    api.queuePlayerAction(campaignId, 'legacy', message.id, 'do');
    const page = f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId])));
    assert.equal(page.entries[0].event.quote, message.content);
    assert.equal(page.entries[0].event.campaignTitle, f.campaign.title);
    assert.equal(page.entries[0].event.playerName, 'Alice');
    assert.equal(page.entries[0].event.characterName, 'Арагорн');
    assert.equal(page.entries[0].event.kind, 'do');
  });
  await test('OOC, narration, DM, nonallowlisted and disabled exports are absent', async f => {
    const { integration: api } = await modules(f); f.outbox.head(); const m = f.legacy(), dm = f.legacy(randomUUID(), ['p1', 'p2', 'dm'], 'dm');
    for (const kind of ['ooc', 'narration', 'lead']) api.queuePlayerAction(campaignId, 'legacy', m.id, kind);
    api.queuePlayerAction(otherId, 'legacy', m.id, 'do'); api.queuePlayerAction(campaignId, 'legacy', dm.id, 'do');
    delete process.env.RAKOBOT_FEED_TOKEN; delete process.env.RAKOBOT_CAMPAIGN_IDS;
    api.queuePlayerAction(campaignId, 'legacy', m.id, 'do');
    process.env.RAKOBOT_FEED_TOKEN = 'short'; api.queuePlayerAction(campaignId, 'legacy', m.id, 'do');
    assert.equal(scalar(f, 'SELECT count(*) n FROM rakobot_action_outbox').n, 0);
  });
  await test('legacy private action never becomes public after the excluded player leaves', async f => {
    const { integration: api } = await modules(f), head = f.outbox.head(), m = f.legacy(randomUUID(), ['p1', 'dm']);
    api.queuePlayerAction(campaignId, 'legacy', m.id, 'do');
    f.members.splice(f.members.findIndex(m => m.userId === 'p2'), 1);
    api.queuePlayerAction(campaignId, 'legacy', m.id, 'do');
    assert.equal(f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId]))).entries[0].event, null);
  });
  for (const mutation of ['delete', 'edit', 'revoke', 'new-member', 'no-sheet', 'disable-campaign']) {
    await test(`queued legacy action is suppressed after ${mutation}`, async f => {
      const { integration: api } = await modules(f), head = f.outbox.head(), m = f.legacy();
      api.queuePlayerAction(campaignId, 'legacy', m.id, 'do');
      const allowed = new Set([campaignId]);
      if (mutation === 'delete') f.messages.delete(m.id);
      if (mutation === 'edit') m.content = 'Changed';
      if (mutation === 'revoke') f.audiences.set(m.id, ['p1', 'dm']);
      if (mutation === 'new-member') f.members.push({ userId: 'p3', username: 'Charlie' });
      if (mutation === 'no-sheet') f.sheets.clear();
      if (mutation === 'disable-campaign') allowed.clear();
      assert.equal(f.outbox.page(cursor(head), row => api.projectQueuedAction(row, allowed)).entries[0].event, null);
    });
  }
  for (const kind of ['do', 'say']) {
    await test(`public spatial ${kind} works without a DM receipt`, async f => {
      const { integration: api } = await modules(f), head = f.outbox.head(), id = f.spatial(randomUUID(), ['p1', 'p2'], 0, 'none', kind);
      api.queuePlayerAction(campaignId, 'spatial', id, kind);
      const event = f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId]))).entries[0].event;
      assert.equal(event.kind, kind); assert.equal(event.quote, 'Открываю дверь.');
    });
  }
  for (const [recipients, stealth, status] of [[['p1'], 0, 'none'], [['p1', 'p2'], 1, 'pending'],
    [['p1', 'p2'], 1, 'confirmed'], [['p1', 'p2'], 0, 'revealed'], [['p1', 'p2'], 0, 'failed']]) {
    await test(`private/stealth spatial action stays suppressed (${recipients.length}/${stealth}/${status})`, async f => {
      const { integration: api } = await modules(f), head = f.outbox.head(), id = f.spatial(randomUUID(), recipients, stealth, status);
      api.queuePlayerAction(campaignId, 'spatial', id, 'do');
      f.members.splice(f.members.findIndex(m => m.userId === 'p2'), 1);
      f.db.prepare("UPDATE spatial_messages SET stealth=0,stealth_status='none' WHERE id=?").run(id);
      api.queuePlayerAction(campaignId, 'spatial', id, 'do');
      assert.equal(f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId]))).entries[0].event, null);
    });
  }
  await test('spatial edit/deletion cannot publish a stale quote', async f => {
    const { integration: api } = await modules(f), head = f.outbox.head(), first = f.spatial(), second = f.spatial();
    api.queuePlayerAction(campaignId, 'spatial', first, 'do'); api.queuePlayerAction(campaignId, 'spatial', second, 'do');
    f.db.prepare('UPDATE spatial_messages SET content=? WHERE id=?').run('Edited', first);
    f.db.prepare('DELETE FROM spatial_messages WHERE id=?').run(second);
    assert(f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId]))).entries.every(e => e.event === null));
  });
  await test('GET has exact authorization, no-store headers and independent bootstrap', async f => {
    const { route } = await modules(f);
    const request = (auth, query = '') => new Request(`http://127.0.0.1:3005/api/internal/rakobot/actions${query}`, { headers: auth ? { authorization: auth } : {} });
    assert.equal((await route.GET(request(null))).status, 401);
    assert.equal((await route.GET(request(`Bearer ${'y'.repeat(64)}`))).status, 401);
    const result = await route.GET(request(`Bearer ${token}`));
    assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal((await result.json()).cursor.id, 0);
    assert.equal((await route.GET(request(`Bearer ${token}`, '?unknown=1'))).status, 400);
    assert.equal((await route.GET(request(`Bearer ${token}`, '?after=1&after=2'))).status, 400);
    assert.equal((await route.GET(request(`Bearer ${token}`, '?after=1'))).status, 409);
    delete process.env.RAKOBOT_FEED_TOKEN; delete process.env.RAKOBOT_CAMPAIGN_IDS;
    assert.equal((await route.GET(request(null))).status, 404);
    process.env.RAKOBOT_FEED_TOKEN = 'short'; assert.equal((await route.GET(request(null))).status, 503);
  });
  await test('GET returns only newly accepted public actions with exact cursors', async f => {
    const { route, integration: api } = await modules(f);
    const get = query => route.GET(new Request(`http://127.0.0.1:3005/api/internal/rakobot/actions${query}`, { headers: { authorization: `Bearer ${token}` } }));
    const before = f.legacy(); api.queuePlayerAction(campaignId, 'legacy', before.id, 'do');
    const head = await (await get('')).json();
    const message = f.legacy(); api.queuePlayerAction(campaignId, 'legacy', message.id, 'do');
    const query = new URLSearchParams({ stream: head.stream, after: String(head.cursor.id), anchor: head.cursor.anchor });
    const result = await get(`?${query}`); assert.equal(result.status, 200);
    const page = await result.json(); assert.equal(page.entries.length, 1); assert.equal(page.entries[0].event.messageId, message.id);
    query.set('anchor', randomUUID()); assert.equal((await get(`?${query}`)).status, 409);
  });
  await test('new hooks remain inside message transactions and skip spatial request replays', () => {
    const legacy = readFileSync(new URL('src/app/api/campaigns/[campaignId]/actions/route.ts', root), 'utf8');
    const spatial = readFileSync(new URL('src/lib/spatial/service.ts', root), 'utf8');
    assert.match(legacy, /withCommittedEffects\(\(\) => getDatabase\(\)\.transaction\(\(\) => \{[\s\S]*publishWithSeq/);
    assert.match(spatial, /!alreadyProcessed && !actor\.isDm && operation === "send"/);
    assert.match(spatial, /queuePlayerAction\(campaignId, "spatial", message\.id, command\.kind\)/);
    for (const [name, source] of [['actions.ts', legacy], ['service.ts', spatial]]) {
      const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    }
  });
  for (const [content, kind] of [['Ищу дверь.', 'do'], ['"Откройте дверь!"', 'say'], ['(ooc) перерыв', null]]) {
    await test(`actual shared event publisher routes ${kind ?? 'no OOC'} (also MCP writers)`, async f => {
      const { events, integration: api } = await modules(f), head = f.outbox.head();
      const message = { id: randomUUID(), campaignId, seq: 1, authorType: 'player', userId: 'p1', content };
      f.messages.set(message.id, message); f.audiences.set(message.id, ['p1', 'p2', 'dm']);
      events.publishWithSeq(campaignId, 1, 'message_added', { message });
      const entries = f.outbox.page(cursor(head), row => api.projectQueuedAction(row, new Set([campaignId]))).entries;
      assert.equal(entries.length, kind ? 1 : 0);
      if (kind) { assert.equal(entries[0].event.kind, kind); assert.equal(entries[0].event.quote, content); }
    });
  }
  await test('actual event publisher queue rolls back with outer narrator transaction', async f => {
    const { events } = await modules(f); f.outbox.head();
    const message = { id: randomUUID(), campaignId, seq: 1, authorType: 'player', userId: 'p1', content: 'Открываю.' };
    f.messages.set(message.id, message); f.audiences.set(message.id, ['p1', 'p2', 'dm']);
    assert.throws(f.db.transaction(() => { events.publishWithSeq(campaignId, 1, 'message_added', { message }); throw new Error('narrator rejected'); }));
    assert.equal(scalar(f, 'SELECT count(*) n FROM rakobot_action_outbox').n, 0);
    assert.equal(scalar(f, 'SELECT count(*) n FROM campaign_events').n, 0);
  });
  console.log(`\n${count} RakoBot integration checks passed.`);
} finally {
  if (savedEnv.token === undefined) delete process.env.RAKOBOT_FEED_TOKEN; else process.env.RAKOBOT_FEED_TOKEN = savedEnv.token;
  if (savedEnv.ids === undefined) delete process.env.RAKOBOT_CAMPAIGN_IDS; else process.env.RAKOBOT_CAMPAIGN_IDS = savedEnv.ids;
}
