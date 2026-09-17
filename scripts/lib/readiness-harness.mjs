// Isolated source tests: real TypeScript modules + real temporary SQLite.
// Only dependencies explicitly listed by a test are substituted. This harness
// does not claim to boot Next, a browser, SQLCipher, or an external model.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

export const root = process.env.READINESS_SOURCE_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const nativeRequire = createRequire(import.meta.url);
export function loadSource(relative, dependencies = {}) {
  const filename = resolve(root, relative);
  const source = readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const errors = (compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const module = { exports: {} };
  const scopedRequire = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('node:')) return nativeRequire(name);
    throw new Error(`Unsubstituted dependency ${name} in ${relative}`);
  };
  new Function('module', 'exports', 'require', `${compiled.outputText}\n//# sourceURL=${filename}`)(module, module.exports, scopedRequire);
  return module.exports;
}

export function sqliteFixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE campaigns (id TEXT PRIMARY KEY, next_seq INTEGER NOT NULL DEFAULT 1, floor_json TEXT NOT NULL DEFAULT '{"mode":"free"}');
    INSERT INTO campaigns (id) VALUES ('c1'), ('c2');
    CREATE TABLE campaign_messages (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), seq INTEGER NOT NULL, content TEXT NOT NULL, user_id TEXT, UNIQUE(campaign_id, seq));
    CREATE TABLE campaign_events (campaign_id TEXT NOT NULL REFERENCES campaigns(id), seq INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(campaign_id, seq));
  `);
  let nextSavepoint = 0;
  let depth = 0;
  const db = {
    exec: (text) => sql.exec(text),
    prepare: (text) => sql.prepare(text),
    transaction: (work) => (...args) => {
      const name = `test_${++nextSavepoint}`;
      sql.exec(`SAVEPOINT ${name}`);
      depth++;
      try { const result = work(...args); sql.exec(`RELEASE ${name}`); return result; }
      catch (error) { sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
      finally { depth--; }
    },
  };
  const core = { getDatabase: () => db, nowIso: () => new Date().toISOString(), parseJson: (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } } };
  const campaigns = {
    allocateSeq: (id) => db.prepare('UPDATE campaigns SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq').get(id).seq,
    latestSeq: (id) => db.prepare('SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?').get(id).seq,
    getFloor: (id) => JSON.parse(db.prepare('SELECT floor_json FROM campaigns WHERE id = ?').get(id).floor_json),
    setFloor: (id, floor) => db.prepare('UPDATE campaigns SET floor_json = ? WHERE id = ?').run(JSON.stringify(floor), id),
  };
  const effects = loadSource('src/lib/db/commit-effects.ts');
  const events = loadSource('src/lib/events.ts', { '@/lib/db/core': core, '@/lib/db/campaigns': campaigns, '@/lib/db/commit-effects': effects });
  const transactions = loadSource('src/lib/dm/tool-transaction.ts', { '@/lib/db/core': core, '@/lib/db/commit-effects': effects });
  const messages = {
    insertCampaignMessage: (input) => {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO campaign_messages (id, campaign_id, seq, content, user_id) VALUES (?, ?, ?, ?, ?)').run(id, input.campaignId, input.seq, input.content, input.userId ?? null);
      return { id, ...input };
    },
  };
  return { db, sql, core, campaigns, effects, events, transactions, messages, depth: () => depth, close: () => sql.close() };
}
