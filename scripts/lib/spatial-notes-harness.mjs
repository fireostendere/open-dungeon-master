// Actual note DB, audience, event policy and routes on SQLite. Only framework
// authentication/schema parsing and embeddings are replaced; no network/model.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as access from '../../src/lib/spatial/event-access.mjs';
import * as versions from '../../src/lib/spatial/entity-versions.mjs';

export const VERSION_TABLES = `
CREATE TABLE IF NOT EXISTS spatial_object_versions (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 object_type TEXT NOT NULL,object_id TEXT NOT NULL,version INTEGER NOT NULL,
 room_id TEXT REFERENCES spatial_rooms(id) ON DELETE CASCADE,
 payload_json TEXT NOT NULL,seq INTEGER NOT NULL,
 PRIMARY KEY(campaign_id,object_type,object_id,version));
CREATE TABLE IF NOT EXISTS spatial_object_receipts (
 campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 object_type TEXT NOT NULL,object_id TEXT NOT NULL,version INTEGER NOT NULL,observed_seq INTEGER NOT NULL,
 PRIMARY KEY(campaign_id,user_id,object_type,object_id));`;

export async function notesHarness(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER DEFAULT 100);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE members(campaign_id TEXT,user_id TEXT,role TEXT);
    CREATE TABLE character_sheets(id TEXT,campaign_id TEXT,user_id TEXT);
    CREATE TABLE spatial_campaigns(campaign_id TEXT PRIMARY KEY,start_seq INTEGER);
    CREATE TABLE spatial_rooms(id TEXT PRIMARY KEY,campaign_id TEXT,name TEXT);
    CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
    CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,type TEXT,payload_json TEXT,created_at TEXT,PRIMARY KEY(campaign_id,seq));
    CREATE TABLE campaign_notes(id TEXT PRIMARY KEY,campaign_id TEXT,character_id TEXT,author_user_id TEXT,
      author_kind TEXT,visibility TEXT,status TEXT,pinned INTEGER,title TEXT,body TEXT,seq INTEGER,created_at TEXT,updated_at TEXT,embedding BLOB);
    INSERT INTO campaigns(id) VALUES('c'),('other');INSERT INTO users VALUES('a'),('b'),('d'),('dm');
    INSERT INTO members VALUES('c','a','player'),('c','b','player'),('c','d','player'),('c','dm','dm'),('other','d','player');
    INSERT INTO character_sheets VALUES('sheet-a','c','a'),('sheet-b','c','b');
    INSERT INTO spatial_campaigns VALUES('c',10),('other',10);
    INSERT INTO spatial_rooms VALUES('tavern','c','Tavern'),('street','c','Street'),('foreign','other','Foreign');
    INSERT INTO spatial_presence VALUES('c','a','tavern'),('c','b','tavern'),('c','d','street');
    ${VERSION_TABLES}`);
  let tx = 0, identity = 'a', muted = false;
  db.transaction = fn => (...args) => { const name = `tx${++tx}`; db.exec(`SAVEPOINT ${name}`);
    try { const result = fn(...args); db.exec(`RELEASE ${name}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; } };
  const campaigns = {
    getCampaignById: id => db.prepare('SELECT * FROM campaigns WHERE id=?').get(id),
    listMembers: id => db.prepare('SELECT user_id AS userId FROM members WHERE campaign_id=?').all(id),
    capsFor: (campaign, userId) => ({ role: db.prepare('SELECT role FROM members WHERE campaign_id=? AND user_id=?').get(campaign.id, userId)?.role }),
    allocateSeq: id => db.prepare('UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq').get(id).seq,
    latestSeq: id => db.prepare('SELECT next_seq-1 AS seq FROM campaigns WHERE id=?').get(id).seq,
  };
  const requireMember = async campaignId => campaigns.listMembers(campaignId).some(m => m.userId === identity)
    ? { user: { id: identity }, campaign: { id: campaignId } } : Response.json({ error: 'Not found' }, { status: 404 });
  const schema = new Proxy({}, { get: (_target, name) => name === 'safeParse' ? data => ({ success: true, data: { title: '', ...data } }) : () => schema });
  const values = {
    'node:async_hooks': { AsyncLocalStorage },
    '@/lib/db/core': { getDatabase: () => db, nowIso: () => new Date().toISOString(), parseJson: (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } } },
    '@/lib/db/campaigns': campaigns,
    '@/lib/db/sheets': { getSheetById: id => { const r = db.prepare('SELECT * FROM character_sheets WHERE id=?').get(id); return r ? { id:r.id,userId:r.user_id,campaignId:r.campaign_id } : null; } },
    './event-access.mjs': access,
    './entity-versions.mjs': versions,
    './store.mjs': { SPATIAL_SCHEMA: VERSION_TABLES },
    zod: { z: schema },
    '@/lib/embeddings': { embed: async () => [], vectorToBuffer: () => null },
    '@/lib/campaign-api': { isErrorResponse: value => value instanceof Response, requireMember,
      requireVoice: async id => muted ? Response.json({ error: 'Muted' }, { status: 403 }) : requireMember(id),
      steersStory: context => campaigns.capsFor(context.campaign, context.user.id).role === 'dm' },
  };
  const paths = {
    '@/lib/db/commit-effects': '../../src/lib/db/commit-effects.ts',
    '@/lib/spatial/event-policy': '../../src/lib/spatial/event-policy.ts',
    '@/lib/spatial/note-privacy': '../../src/lib/spatial/note-privacy.ts',
    '@/lib/db/notes': '../../src/lib/db/notes.ts',
    '@/lib/events': '../../src/lib/events.ts',
    listRoute: '../../src/app/api/campaigns/[campaignId]/notes/route.ts',
    detailRoute: '../../src/app/api/campaigns/[campaignId]/notes/[noteId]/route.ts',
  };
  const aliases = { './event-policy': '@/lib/spatial/event-policy' };
  const context = vm.createContext({ console, URL, Request, Response, TextEncoder, crypto: webcrypto });
  const cache = new Map();
  const make = name => {
    name = aliases[name] ?? name;
    if (cache.has(name)) return cache.get(name);
    let mod;
    if (values[name]) mod = new vm.SyntheticModule(Object.keys(values[name]), function () { for (const [k,v] of Object.entries(values[name])) this.setExport(k,v); }, { context });
    else { assert.ok(paths[name], `Unknown dependency ${name}`); mod = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(new URL(paths[name], import.meta.url), 'utf8')), { context, identifier: name }); }
    cache.set(name,mod);return mod;
  };
  const root = new vm.SourceTextModule("import * as notes from '@/lib/db/notes'; import * as events from '@/lib/events'; import * as policy from '@/lib/spatial/event-policy'; import * as listRoute from 'listRoute'; import * as detailRoute from 'detailRoute'; export {notes,events,policy,listRoute,detailRoute};", { context });
  await root.link(name => make(name));await root.evaluate();
  const modules = root.namespace;
  const create = (options = {}) => modules.notes.insertNote({ campaignId: 'c', characterId: null, authorUserId: 'dm',
    visibility: 'public', status: 'active', title: 'Note', body: 'V1', seq: campaigns.allocateSeq('c'), audience: { roomId:'tavern' }, ...options });
  return { db, ...modules, campaigns, create,
    actor: id => modules.policy.eventActorFor('c', id, true),
    move: (id,roomId) => db.prepare('UPDATE spatial_presence SET room_id=? WHERE campaign_id=? AND user_id=?').run(roomId,'c',id),
    login: id => { identity=id; }, mute: () => { muted=true; },
    detail: id => ({ params: Promise.resolve({ campaignId:'c',noteId:id }) }),
  };
}
