import { DatabaseSync } from 'node:sqlite';
import { createDomainStore } from '../../src/lib/spatial/domain-store.mjs';

export function domainFixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE spatial_rooms(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id));
    CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
    CREATE TABLE spatial_object_versions(campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,object_type TEXT,object_id TEXT,version INTEGER,
      room_id TEXT REFERENCES spatial_rooms(id) ON DELETE CASCADE,payload_json TEXT,seq INTEGER,PRIMARY KEY(campaign_id,object_type,object_id,version));
    CREATE TABLE spatial_object_receipts(campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      object_type TEXT,object_id TEXT,version INTEGER,observed_seq INTEGER,PRIMARY KEY(campaign_id,user_id,object_type,object_id));
    INSERT INTO campaigns(id) VALUES('c'),('foreign');
    INSERT INTO users VALUES('dm'),('a'),('b');
    INSERT INTO spatial_rooms VALUES('tavern','c'),('street','c'),('elsewhere','foreign');
    INSERT INTO spatial_presence VALUES('c','a','tavern'),('c','b','street');`);
  let transaction = 0;
  db.transaction = work => (...args) => {
    const name = `tx${++transaction}`; db.exec(`SAVEPOINT ${name}`);
    try { const value = work(...args); db.exec(`RELEASE ${name}`); return value; }
    catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  };
  const members = new Set(['dm','a','b']); let isDm = true;
  const store = createDomainStore(db, {
    nextSeq: id => db.prepare('UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq').get(id).seq,
    actorFor: (campaignId, userId) => campaignId === 'c' && members.has(userId) ? {
      campaignId, userId, isDm: userId === 'dm' && isDm, memberIds: [...members], playerIds: [...members].filter(id => id !== 'dm'),
    } : null,
  });
  const publish = (id, body, options = {}) => store.publish('c','dm','note',id,{id,campaignId:'c',body},options);
  const read = (user, id) => store.read('c',user,'note',id);
  const move = (user, room) => db.prepare('UPDATE spatial_presence SET room_id=? WHERE user_id=?').run(room,user);
  return { db, store, members, publish, read, move, demote: () => { isDm = false; } };
}
