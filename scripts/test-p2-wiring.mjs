// Production Ask mapper, narrator handler, HTTP routes and paging utilities.
// SQLite is real. Schema parsing and unrelated domain services are explicit
// doubles: this suite does not claim Zod validation, Next, SDK or browser E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as queue from '../src/lib/db/ask-queue.mjs';
import * as budget from '../src/lib/mcp-read-budget.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const forbidden = () => { throw new Error('Unexpected domain write or model request'); };
function load(relative, deps) {
  const output = ts.transpileModule(readFileSync(new URL(relative, root), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports, name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    throw new Error(`Unsubstituted dependency: ${name}`);
  });
  return module.exports;
}
// Deliberately does not validate. Test only trusted, already-shaped inputs.
function schemaDouble(defaults = {}) {
  const shape = new Proxy({}, { get: (_, key) => key === 'safeParse'
    ? raw => ({ success: true, data: { ...defaults, ...raw } }) : () => shape });
  return new Proxy({}, { get: () => () => shape });
}
function fixture() {
  const sql = new DatabaseSync(':memory:'); let serial = 0;
  const db = { exec: text => sql.exec(text), prepare: text => sql.prepare(text), transaction: work => () => {
    const name = `test_${++serial}`; sql.exec(`SAVEPOINT ${name}`);
    try { const result = work(); sql.exec(`RELEASE ${name}`); return result; }
    catch (error) { sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  } };
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY);
    INSERT INTO campaigns VALUES('c1'),('c2');
    CREATE TABLE campaign_asks(id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id),
      user_id TEXT, character_id TEXT, visibility TEXT, scope TEXT, question TEXT, answer TEXT,
      citations_json TEXT, status TEXT CHECK(status IN ('answered','failed')), created_at TEXT);`);
  const asks = load('src/lib/db/asks.ts', {
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => new Date().toISOString(), parseJson: (text, fallback) => {
      try { return JSON.parse(text); } catch { return fallback; }
    } }, '@/lib/db/ask-queue.mjs': queue,
  });
  const campaign = { id: 'c1', kind: 'campaign', status: 'active', dmUserId: 'dm',
    dmOutline: '', gameSettings: { dmMode: 'human', mapsEnabled: false, ttsEnabled: false }, floor: { mode: 'open' } };
  const notices = [], history = [], facts = [], events = [], rolls = [];
  let seq = 12;
  class CommandError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  const control = load('src/lib/mcp-narrator-control.ts', {
    zod: { z: schemaDouble({ afterSeq: 0, limit: 50, afterAskSeq: 0, askLimit: 20, paged: false, maxBytes: 65536,
      projection: 'full', expectedVersion: 0, citations: [] }) },
    '@/lib/campaign-types': { isOocMessage: m => m.content.startsWith('(ooc)') },
    '@/lib/mcp-event-filter': { isNarratorEvent: e => e.type !== 'ooc' },
    '@/lib/db/campaigns': { getCampaignById: id => id === 'c1' ? campaign : null,
      getCampaignSummaryState: () => null, latestSeq: () => seq, listMembers: () => [], setFloor: forbidden },
    '@/lib/db/chapters': { listChapters: () => [] },
    '@/lib/db/dm-turns': { getDmTurn: () => null, listOpenPendingRolls: () => [] },
    '@/lib/db/dm-whispers': { listRecentWhispersForPrompt: () => [], listPendingPlayerWhispers: () => [] },
    '@/lib/db/encounters': { getActiveEncounter: () => null, listEnemies: () => [] },
    '@/lib/db/facts': { listActiveFacts: () => facts },
    '@/lib/db/locations': { getCurrentLocation: () => null },
    '@/lib/db/messages': { listMessagesInSeqRange: (_id, start, end) => history.filter(m => m.seq >= start && m.seq <= end), listRecentMessages: () => history },
    '@/lib/db/notes': { listPublicCampaignNotes: () => [] },
    '@/lib/db/rolls': { listRecentRolls: () => rolls },
    '@/lib/db/scene-tracker': { getSceneTracker: () => null }, '@/lib/db/sheets': { listSheets: () => [] },
    '@/lib/dm/invoke-catalog': { consoleAdjudications: () => [] },
    '@/lib/dm/invoke': { invokeEngineSynchronous: forbidden }, '@/lib/dm/human-narration': { persistHumanNarration: forbidden },
    '@/lib/dm/narrator-command': { executeNarratorCommand: forbidden, NarratorCommandError: CommandError },
    '@/lib/db/narrator-commands': { listNarratorReceipts: () => [] },
    '@/lib/dm/delegation': { coverInEffect: () => false }, '@/lib/dm/social-tools': { npcRosterForPrompt: () => [] },
    '@/lib/db/asks': asks, '@/lib/mcp-read-budget.mjs': budget,
    '@/lib/events': { listEventsSince: (_id, cursor, limit) => events.filter(e => e.seq > cursor).slice(0, limit),
      publishPersisted: forbidden, publishEphemeral: (...a) => notices.push(['table', ...a]),
      publishUserEphemeral: (...a) => notices.push(['user', ...a]) },
  });
  return { asks, notices, history, facts, events, rolls, campaign,
    call: async (op, params = {}) => (await control.executeMcpNarratorControl(`narrator.${op}`, { campaignId: 'c1', ...params })).result,
    add: (userId = 'u1', visibility = 'private', campaignId = 'c1', status = 'pending') => asks.insertAsk({
      campaignId, userId, characterId: null, visibility, scope: 'rules', question: 'Rules question',
      answer: status === 'pending' ? 'Awaiting DM' : 'Prior answer', citations: [], status }),
    seq: () => seq, setSeq: value => { seq = value; }, close: () => sql.close() };
}

test('wiring: connect preserves the small legacy state; explicit paging is opt-in', async () => {
  const f = fixture(); try {
    const ordinary = await f.call('connect');
    assert.equal(ordinary.state.campaign.id, 'c1'); assert.equal(ordinary.state.format, undefined);
    const paged = await f.call('connect', { paged: true });
    assert.equal(paged.contractVersion, 2);
    assert.deepEqual(budget.assembleReadPages([paged.state]), ordinary.state);
  } finally { f.close(); }
});
test('wiring: read exposes 25 pending Asks through independent queue pages', async () => {
  const f = fixture(); try {
    for (let i = 0; i < 25; i++) f.add(`u${i % 2}`);
    f.add('u1', 'private', 'c1', 'answered');
    const first = await f.call('read');
    assert.equal(first.asks.length, 20); assert.equal(first.askQueue.hasMore, true);
    const second = await f.call('read', { afterAskSeq: first.askQueue.nextCursor });
    assert.equal(second.asks.length, 5); assert.equal(second.askQueue.hasMore, false);
    assert.equal(new Set([...first.asks, ...second.asks].map(a => a.id)).size, 25);
    assert.equal(first.currentSeq, second.currentSeq);
  } finally { f.close(); }
});
test('wiring: private answer is versioned, replayable and never publishes a story event', async () => {
  const f = fixture(); try {
    const a = f.add(); const before = f.seq();
    const params = { askId: a.id, commandId: crypto.randomUUID(), expectedVersion: a.version, answer: 'A valid answer', citations: [] };
    assert.equal((await f.call('answer_ask', params)).ask.version, 1);
    f.setSeq(13);
    assert.equal((await f.call('answer_ask', params)).ask.version, 1);
    assert.equal(f.seq(), before + 1);
    assert.ok(f.notices.every(n => n[0] === 'user' && n[2] === 'u1' && n[3] === 'ask_activity' && Object.keys(n[4]).length === 0));
    assert.equal((await f.call('read')).asks.length, 0);
    await assert.rejects(() => f.call('answer_ask', { ...params, commandId: crypto.randomUUID(), answer: 'Overwrite' }), e => e.status === 409);
  } finally { f.close(); }
});
test('wiring: foreign campaign Ask is not answered; member reads never include another private row', async () => {
  const f = fixture(); try {
    const foreign = f.add('u2', 'private', 'c2');
    f.add('u2'); const own = f.add('u1'); const table = f.add('u2', 'table');
    await assert.rejects(() => f.call('answer_ask', { askId: foreign.id, answer: 'No' }), e => e.status === 404);
    assert.deepEqual(new Set(f.asks.listAsksForUser('c1', 'u1').map(a => a.id)), new Set([own.id, table.id]));
    assert.equal(f.notices.length, 0);
  } finally { f.close(); }
});
test('wiring: pending acknowledgements never enter answered Ask conversation context', () => {
  const f = fixture(); try {
    f.add(); const real = f.add('u1', 'private', 'c1', 'answered');
    assert.deepEqual(f.asks.listRecentAsksForThread('c1', 'u1').map(a => a.id), [real.id]);
  } finally { f.close(); }
});
test('wiring: oversized reads fail closed and every bounded page preserves exact mechanics', async () => {
  const f = fixture(); try {
    for (let i = 0; i < 30; i++) f.facts.push({ id: `f${i}`, fact: 'длинный текст '.repeat(30) });
    const roll = { id: 'r1', total: 17, breakdown: { die: 20 } }; f.rolls.push(roll);
    f.events.push({ seq: 12, type: 'roll_result', payload: { roll } });
    await assert.rejects(() => f.call('read', { maxBytes: 4096 }), e => e.status === 413);
    const pages = []; let cursor;
    do { const page = await f.call('read', { paged: true, maxBytes: 4096, ...(cursor ? { pageCursor: cursor } : {}) });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 4096); pages.push(page); cursor = page.nextPage;
    } while (cursor);
    const state = budget.assembleReadPages(pages);
    assert.equal(state.facts.length, 30); assert.deepEqual(state.recentRolls[0], roll);
    assert.deepEqual(state.events[0].payload.roll, roll);
  } finally { f.close(); }
});
test('wiring: an independently answered Ask invalidates an in-flight snapshot cursor', async () => {
  const f = fixture(); try {
    const ask = f.add();
    for (let i = 0; i < 20; i++) f.facts.push({ id: i, fact: 'x'.repeat(600) });
    const page = await f.call('read', { paged: true, maxBytes: 4096 }); assert.ok(page.nextPage);
    await f.call('answer_ask', { askId: ask.id, answer: 'Done' });
    await assert.rejects(() => f.call('read', { paged: true, maxBytes: 4096, pageCursor: page.nextPage }), e => e.status === 409);
  } finally { f.close(); }
});

function route(kind, muted, limited, calls) {
  const context = { campaign: { status: 'active', gameSettings: { dmMode: 'human' } }, user: { id: 'u1' } };
  const domains = new Proxy({}, { get: () => forbidden });
  return load(`src/app/api/campaigns/[campaignId]/${kind}/route.ts`, {
    zod: { z: schemaDouble() },
    '@/lib/campaign-api': { requireVoice: async () => { calls.voice++; return muted ? Response.json({}, { status: 403 }) : context; },
      requireMember: forbidden, isErrorResponse: v => v instanceof Response },
    '@/lib/db/campaigns': domains, '@/lib/db/messages': domains, '@/lib/db/dm-whispers': domains,
    '@/lib/db/sheets': { getSheetForUser: () => ({ id: 's1' }), listSheets: forbidden },
    '@/lib/db/asks': { ...domains, AskQueueFull: queue.AskQueueFull },
    '@/lib/dm/loop': { requestDmTurn: forbidden }, '@/lib/events': domains,
    '@/lib/dm/delegation': domains, '@/lib/dm/viewer': domains, '@/lib/dm/queue': domains, '@/lib/dm/recap': domains,
    '@/lib/dm/ask': { runAsk: forbidden }, '@/lib/dm/ask-logic': {
      ASK_SCOPES: ['story', 'rules', 'sheet'], ASK_VISIBILITIES: ['private', 'table'], QUESTION_MAX_CHARS: 4000,
      clampQuestion: forbidden, inferScope: forbidden,
    },
    '@/lib/ingress-budget': { enforcePlayerIngress: () => { calls.quota++; return limited ? Response.json({}, { status: 429 }) : null; } },
  });
}
for (const kind of ['ask', 'actions', 'whispers']) {
  test(`wiring: ${kind} rejects a muted participant before quota or domain work`, async () => {
    const calls = { voice: 0, quota: 0 }; const module = route(kind, true, false, calls);
    const result = await module.POST(new Request('http://localhost', { method: 'POST', body: '{}' }), { params: Promise.resolve({ campaignId: 'c1' }) });
    assert.equal(result.status, 403); assert.equal(calls.voice, 1); assert.equal(calls.quota, 0);
  });
  test(`wiring: ${kind} stops at the ingress quota before persistence or model invocation`, async () => {
    const calls = { voice: 0, quota: 0 }; const module = route(kind, false, true, calls);
    const result = await module.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ question: 'Q', scope: 'rules', kind: 'do', content: 'A', message: 'W' }) }), { params: Promise.resolve({ campaignId: 'c1' }) });
    assert.equal(result.status, 429); assert.equal(calls.quota, 1);
  });
}
