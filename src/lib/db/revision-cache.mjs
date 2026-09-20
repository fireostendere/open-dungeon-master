import { createHash, randomBytes } from 'node:crypto';

const identifier = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid cache source');
  return `"${value}"`;
};
export const projectionDigest = value => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const sources = Object.freeze({
  character_sheets: true, homebrew_entries: false, world_facts: true,
  campaign_notes: true, npcs: true,
});
export const NARRATOR_SECTION_SOURCES = Object.freeze({
  sheets: ['character_sheets', 'homebrew_entries'], facts: ['world_facts'],
  notes: ['campaign_notes'], npcs: ['npcs', 'world_facts'],
});

/** Authoritative narrator projections only. Never use this to cache a player's
 * authorization or observed-history projection. Triggers cover every SQL writer,
 * including external connections, deletion and campaign reassignment. Random
 * revision tokens cannot suffer counter reuse after transaction rollback.
 */
export class RevisionCache {
  constructor(db, { maxEntries = 128, maxBytes = 16 * 1024 * 1024 } = {}) {
    if (![maxEntries, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid cache budget');
    this.db = db; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    this.entries = new Map(); this.bytes = 0; this.schema = null; this.schemaToken = null; this.available = new Set();
    this.stats = { hits: 0, misses: 0, loads: 0 };
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  schemaVersion() { return this.db.prepare('PRAGMA schema_version').get().schema_version; }
  ensure() {
    const version = this.schemaVersion();
    const readToken = () => this.db.prepare("SELECT token FROM odm_read_revisions WHERE source='schema' AND scope='*'").get()?.token;
    if (version === this.schema) {
      // schema_version can repeat after rolled-back DDL. The transactional
      // marker distinguishes that branch without caching an uncommitted epoch.
      try { if (readToken() === this.schemaToken) return; } catch { /* Metadata may itself have been rolled back. */ }
    }
    this.clear(); this.available.clear();
    this.db.exec('SAVEPOINT odm_read_cache_schema');
    try {
    this.db.exec(`CREATE TABLE IF NOT EXISTS odm_read_revisions (
      source TEXT NOT NULL, scope TEXT NOT NULL, token TEXT NOT NULL,
      PRIMARY KEY(source,scope)
    )`);
    for (const [table, scoped] of Object.entries(sources)) {
      const columns = this.db.prepare(`PRAGMA table_info(${identifier(table)})`).all();
      if (!columns.length || scoped && !columns.some(col => col.name === 'campaign_id')) continue;
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const refs = operation === 'UPDATE' ? ['OLD','NEW'] : [operation === 'INSERT' ? 'NEW' : 'OLD'];
        // A replacement INSERT can implicitly delete a row in another campaign
        // without firing DELETE triggers. A global insert token closes that
        // invalidation hole without invalidating all campaigns on every UPDATE.
        const globalInsert = scoped && operation === 'INSERT' ?
          `INSERT INTO odm_read_revisions(source,scope,token) VALUES('${table}','*',lower(hex(randomblob(16)))) ON CONFLICT(source,scope) DO UPDATE SET token=excluded.token;` : '';
        const changes = globalInsert + refs.map(ref => {
          const scope = scoped ? `${ref}.campaign_id` : "'*'";
          return `INSERT INTO odm_read_revisions(source,scope,token) VALUES('${table}',${scope},lower(hex(randomblob(16))))
            ON CONFLICT(source,scope) DO UPDATE SET token=excluded.token;`;
        }).join('\n');
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${identifier(`odm_cache_${table}_${operation.toLowerCase()}`)}
          AFTER ${operation} ON ${identifier(table)} BEGIN ${changes} END;`);
      }
      this.available.add(table);
    }
    this.schema = this.schemaVersion();
    const previous = readToken();
    this.schemaToken = previous?.startsWith(`${this.schema}:`) ? previous : `${this.schema}:${randomBytes(16).toString('hex')}`;
    if (this.schemaToken !== previous) this.db.prepare(`INSERT INTO odm_read_revisions(source,scope,token) VALUES('schema','*',?)
      ON CONFLICT(source,scope) DO UPDATE SET token=excluded.token`).run(this.schemaToken);
    this.db.exec('RELEASE odm_read_cache_schema');
    } catch (error) {
      try { this.db.exec('ROLLBACK TO odm_read_cache_schema; RELEASE odm_read_cache_schema'); } catch {}
      this.clear(); this.available.clear(); this.schema = null; this.schemaToken = null;
      throw error;
    }
  }
  remove(key) {
    const prior = this.entries.get(key);
    if (prior) { this.bytes -= prior.bytes; this.entries.delete(key); }
  }
  get({ campaignId, timelineEpoch, section, principal, dependencies, load, variant = '' }) {
    this.ensure();
    const ready = dependencies.every(source => this.available.has(source));
    const readTokens = () => ready ? dependencies.map(source => [source, this.db.prepare(
      'SELECT token FROM odm_read_revisions WHERE source=? AND scope=?').get(source, sources[source] ? campaignId : '*')?.token ?? 'initial',
      sources[source] ? this.db.prepare('SELECT token FROM odm_read_revisions WHERE source=? AND scope=?').get(source,'*')?.token ?? 'initial' : 'global']) : null;
    const tokens = readTokens();
    const key = JSON.stringify([campaignId,timelineEpoch,principal,section,variant,this.schema,tokens]);
    if (ready && this.entries.has(key)) {
      const hit = this.entries.get(key); this.entries.delete(key); this.entries.set(key,hit); this.stats.hits++;
      return hit;
    }
    this.stats.misses++; this.stats.loads++;
    const value = load();
    if (value?.then) throw new Error('Projection loader must be synchronous');
    const json = JSON.stringify(value), version = projectionDigest({ campaignId, timelineEpoch, section, content: value });
    const result = Object.freeze({ json, version, bytes: Buffer.byteLength(json), value: () => JSON.parse(json) });
    if (ready && result.bytes <= this.maxBytes && JSON.stringify(tokens) === JSON.stringify(readTokens())) {
      while (this.entries.size >= this.maxEntries || this.bytes + result.bytes > this.maxBytes) this.remove(this.entries.keys().next().value);
      this.entries.set(key,result); this.bytes += result.bytes;
    }
    return result;
  }
}
const caches = new WeakMap();
export function narratorSectionCache(db) {
  let cache = caches.get(db);
  if (!cache) { cache = new RevisionCache(db); caches.set(db,cache); }
  return cache;
}
