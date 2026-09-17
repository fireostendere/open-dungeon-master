import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensureAskQueue, registerAsk, listPendingAsks, answerQueuedAsk, AskQueueConflict, checkAskCapacity, AskQueueFull } from '../src/lib/db/ask-queue.mjs';
import { consumeIngress, IngressLimit } from '../src/lib/db/ingress-budget.mjs';
import { budgetRead, assembleReadPages, ReadBudgetError } from '../src/lib/mcp-read-budget.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function dbAdapter(sql) {
  let serial = 0;
  return { exec: text => sql.exec(text), prepare: text => sql.prepare(text), transaction: work => (...args) => {
    const name = `t${++serial}`; sql.exec(`SAVEPOINT ${name}`);
    try { const result = work(...args); sql.exec(`RELEASE ${name}`); return result; }
    catch (error) { sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  } };
}
function fixture(file = ':memory:') {
  const sql = new DatabaseSync(file), db = dbAdapter(sql);
  sql.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, next_seq INTEGER NOT NULL DEFAULT 1);
    INSERT OR IGNORE INTO campaigns(id) VALUES ('c1'), ('c2');
    CREATE TABLE IF NOT EXISTS campaign_asks (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, character_id TEXT, visibility TEXT NOT NULL DEFAULT 'private',
      scope TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('answered','failed')),
      created_at TEXT NOT NULL
    );`);
  const add = (id, user = 'u1', answer = '', state = 'pending', campaign = 'c1', visibility = 'private') => {
    ensureAskQueue(db);
    db.transaction(() => {
      db.prepare(`INSERT INTO campaign_asks VALUES (?, ?, ?, NULL, ?, 'rules', ?, ?, '[]', 'answered', ?)`)
        .run(id, campaign, user, visibility, `question ${id}`, answer, new Date().toISOString());
      registerAsk(db, id, campaign, state);
    })();
  };
  return { sql, db, add, close: () => sql.close() };
}
function temp(fn) { const dir = mkdtempSync(path.join(os.tmpdir(), 'odm-p2-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } }

test('M08: 25 questions survive a real DB close/reopen and every one is answered once', () => temp(dir => {
  const file = path.join(dir, 'db.sqlite');
  let f = fixture(file);
  for (let i = 0; i < 25; i++) f.add(`a${i}`, `u${i % 2}`);
  const p1 = listPendingAsks(f.db, 'c1', 0, 20);
  assert.equal(p1.items.length, 20); assert.equal(p1.hasMore, true);
  f.close(); f = fixture(file);
  const p2 = listPendingAsks(f.db, 'c1', p1.nextCursor, 20);
  assert.equal(p2.items.length, 5); assert.equal(p2.hasMore, false);
  for (const row of [...p1.items, ...p2.items]) {
    const command = { campaignId: 'c1', askId: row.id, answer: 'yes', expectedVersion: 0, commandId: `cmd:${row.id}` };
    assert.equal(answerQueuedAsk(f.db, command).replayed, false);
    assert.equal(answerQueuedAsk(f.db, command).replayed, true);
    assert.throws(() => answerQueuedAsk(f.db, { ...command, answer: 'different' }), AskQueueConflict);
  }
  assert.equal(listPendingAsks(f.db, 'c1').items.length, 0);
  assert.equal(f.db.prepare('SELECT SUM(version) AS n FROM campaign_ask_queue').get().n, 25);
  assert.equal(f.db.prepare("SELECT next_seq FROM campaigns WHERE id='c1'").get().next_seq, 1);
  f.close();
}));
test('M08: known foreign Ask IDs cannot be read/answered and command IDs are scoped', () => {
  const f = fixture(); try {
    f.add('private', 'u2', '', 'pending', 'c2'); f.add('own');
    assert.equal(answerQueuedAsk(f.db, { campaignId: 'c1', askId: 'private', answer: 'leak' }), null);
    assert.deepEqual(listPendingAsks(f.db, 'c1').items.map(x => x.id), ['own']);
    answerQueuedAsk(f.db, { campaignId: 'c1', askId: 'own', answer: 'one', commandId: 'same' });
    answerQueuedAsk(f.db, { campaignId: 'c2', askId: 'private', answer: 'two', commandId: 'same' });
  } finally { f.close(); }
});
test('M08: a second writer cannot overwrite the winner using the same version', () => {
  const f = fixture(); try {
    f.add('a'); answerQueuedAsk(f.db, { campaignId: 'c1', askId: 'a', answer: 'first', commandId: 'c1' });
    assert.throws(() => answerQueuedAsk(f.db, { campaignId: 'c1', askId: 'a', answer: 'second', commandId: 'c2' }), AskQueueConflict);
    assert.equal(f.db.prepare('SELECT answer FROM campaign_asks').get().answer, 'first');
  } finally { f.close(); }
});
test('M08: failed answer storage rolls back queue state and receipt', () => {
  const f = fixture(); try {
    f.add('a'); f.db.exec("CREATE TRIGGER reject_answer BEFORE UPDATE ON campaign_asks BEGIN SELECT RAISE(ABORT,'disk fixture'); END;");
    assert.throws(() => answerQueuedAsk(f.db, { campaignId: 'c1', askId: 'a', answer: 'answer', commandId: 'x' }));
    const row = f.db.prepare('SELECT * FROM campaign_ask_queue').get();
    assert.equal(row.state, 'pending'); assert.equal(row.version, 0); assert.equal(row.command_id, null);
  } finally { f.close(); }
});
test('M08: only exact legacy placeholders without citations migrate, once', () => {
  const f = fixture(); try {
    const legacy = f.db.prepare("INSERT INTO campaign_asks VALUES (?, 'c1', 'u1', NULL, 'private', 'rules', 'q', ?, ?, 'answered', '2000-01-01')");
    legacy.run('legacy', 'Вопрос передан Мастеру стола…', '[]');
    legacy.run('real', 'ordinary real answer', '[]');
    legacy.run('cited', 'Вопрос передан Мастеру стола…', '[{"ref":"rule"}]');
    ensureAskQueue(f.db); ensureAskQueue(f.db);
    assert.deepEqual(listPendingAsks(f.db, 'c1').items.map(x => x.id), ['legacy']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_ask_queue').get().n, 3);
  } finally { f.close(); }
});
test('M08: pending cap is independent of per-minute request quota', () => {
  const f = fixture(); try {
    for (let i = 0; i < 20; i++) f.add(`a${i}`);
    assert.throws(() => checkAskCapacity(f.db, 'c1', 'u1'), AskQueueFull);
    assert.doesNotThrow(() => checkAskCapacity(f.db, 'c1', 'u2'));
  } finally { f.close(); }
});
test('M08: late arrivals remain visible from a fresh queue head after a page was answered', () => {
  const f = fixture(); try {
    f.add('a'); const page = listPendingAsks(f.db, 'c1'); f.add('b');
    answerQueuedAsk(f.db, { campaignId: 'c1', askId: page.items[0].id, answer: 'ok' });
    assert.deepEqual(listPendingAsks(f.db, 'c1').items.map(x => x.id), ['b']);
  } finally { f.close(); }
});
test('M11: ingress quotas survive reopening SQLite and rejected requests do not burn other buckets', () => temp(dir => {
  const file = path.join(dir, 'db.sqlite'); let f = fixture(file);
  for (let i = 0; i < 10; i++) consumeIngress(f.db, 'c1', 'u1', 'ask', 1000);
  f.close(); f = fixture(file);
  assert.throws(() => consumeIngress(f.db, 'c1', 'u1', 'ask', 2000), IngressLimit);
  const total = f.db.prepare('SELECT used FROM campaign_ingress_budget WHERE bucket = ?').get(JSON.stringify(['user', 'u1']));
  assert.equal(total.used, 10);
  assert.doesNotThrow(() => consumeIngress(f.db, 'c1', 'u1', 'ask', 61000));
  f.close();
}));
test('M11: channels share a user quota, not a loophole for multiplying requests', () => {
  const f = fixture(); try {
    for (let i = 0; i < 60; i++) consumeIngress(f.db, `campaign${i}`, 'u1', 'action', 1000);
    assert.throws(() => consumeIngress(f.db, 'other', 'u1', 'whisper', 1000), IngressLimit);
    assert.doesNotThrow(() => consumeIngress(f.db, 'other', 'u2', 'whisper', 1000));
  } finally { f.close(); }
});
test('M13: long snapshots page under a byte budget and reconstruct exactly, including non-ASCII rolls', () => {
  const state = { currentSeq: 501, nextCursor: 501, hasMore: false, campaign: { id: 'c1' },
    messages: Array.from({ length: 501 }, (_, seq) => ({ seq, content: 'секретный результат '.repeat(20) })),
    rolls: [{ total: 20, breakdown: '🎲'.repeat(100) }], empty: [] };
  assert.throws(() => budgetRead(state, { maxBytes: 4096 }), ReadBudgetError);
  const pages = []; let pageCursor;
  do { const p = budgetRead(state, { paged: true, maxBytes: 4096, pageCursor });
    assert.ok(Buffer.byteLength(JSON.stringify(p)) <= 4096); pages.push(p); pageCursor = p.nextPage;
  } while (pageCursor);
  assert.deepEqual(assembleReadPages(pages), state);
});
test('M13: mutations during paging require a fresh snapshot, not mixed timelines', () => {
  const state = { currentSeq: 1, nextCursor: 1, hasMore: false, messages: Array.from({ length: 50 }, (_, n) => ({ n, text: 'x'.repeat(300) })) };
  const page = budgetRead(state, { paged: true, maxBytes: 4096 });
  assert.ok(page.nextPage);
  assert.throws(() => budgetRead({ ...state, currentSeq: 2 }, { paged: true, pageCursor: page.nextPage, maxBytes: 4096 }), e => e.status === 409);
  assert.throws(() => assembleReadPages([page]), e => e.status === 409);
});
test('M13: individually oversized authoritative values pause rather than truncate', () => {
  assert.throws(() => budgetRead({ roll: { authoritative: 'x'.repeat(9000) } }, { paged: true, maxBytes: 4096 }), e => e.status === 413);
});
test('M09: the actual runner exposes SourceTextModule without NODE_OPTIONS', () => temp(dir => {
  copyFileSync(path.join(root, 'scripts/test-all.mjs'), path.join(dir, 'test-all.mjs'));
  writeFileSync(path.join(dir, 'test-vm.mjs'), "import vm from 'node:vm'; new vm.SourceTextModule('export const result=42');\n");
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [path.join(dir, 'test-all.mjs')], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(path.join(dir, 'test-bad.mjs'), 'process.exit(7)');
  assert.equal(spawnSync(process.execPath, [path.join(dir, 'test-all.mjs')], { env }).status, 7);
}));

// Boundary fixture only: the route is real TypeScript; Zod and Next/domain
// services are explicit substitutes. These assertions do NOT test validation,
// browser rendering, the full app or an installed MCP SDK.
function routeModule(filename, deps) {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const source = ts.transpileModule(readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', source)(module, module.exports, name => {
    if (Object.hasOwn(deps, name)) return deps[name]; throw new Error(`Unsubstituted route dependency ${name}`);
  });
  return module.exports;
}
const chain = new Proxy(function() {}, { get: () => chain, apply: () => chain });
test('M12: muted whisper POST exits through requireVoice before DB, quota or model work; GET still reads own history', async () => {
  let voice = 0, membership = 0;
  const forbidden = () => { throw new Error('muted input must not reach this dependency'); };
  const route = routeModule('src/app/api/campaigns/[campaignId]/whispers/route.ts', {
    zod: { z: chain },
    '@/lib/campaign-api': {
      requireVoice: async () => { voice++; return Response.json({ error: 'muted' }, { status: 403 }); },
      requireMember: async () => { membership++; return { user: { id: 'u1' } }; },
      isErrorResponse: value => value instanceof Response,
    },
    '@/lib/db/dm-whispers': { listWhispersForUser: (c, u) => [{ campaign: c, user: u }], countUnreadWhispers: () => 0,
      insertPlayerWhisper: forbidden, countPendingPlayerWhispers: forbidden },
    '@/lib/db/sheets': { getSheetForUser: forbidden }, '@/lib/dm/loop': { requestDmTurn: forbidden },
    '@/lib/events': { publishEphemeral: forbidden }, '@/lib/ingress-budget': { enforcePlayerIngress: forbidden },
  });
  const params = { params: Promise.resolve({ campaignId: 'c1' }) };
  assert.equal((await route.POST(new Request('http://localhost', { method: 'POST' }), params)).status, 403);
  assert.equal(voice, 1); assert.equal(membership, 0);
  const read = await (await route.GET(new Request('http://localhost'), params)).json();
  assert.equal(membership, 1); assert.equal(read.whispers[0].user, 'u1');
});
