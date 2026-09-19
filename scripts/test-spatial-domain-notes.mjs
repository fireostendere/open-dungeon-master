import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { domainFixture } from './lib/domain-fixture.mjs';
import { domainModules } from './lib/domain-module.mjs';

function fixture(t) {
  const f=domainFixture(t);
  f.db.exec(`CREATE TABLE campaign_notes(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,character_id TEXT,
    author_user_id TEXT REFERENCES users(id),author_kind TEXT,visibility TEXT,status TEXT,pinned INTEGER,title TEXT,body TEXT,
    seq INTEGER,created_at TEXT,updated_at TEXT,embedding BLOB);
    CREATE TABLE chapters(id TEXT PRIMARY KEY,campaign_id TEXT,chapter_index INTEGER,title TEXT,summary TEXT,highlights_json TEXT,
    seq_start INTEGER,seq_end INTEGER,status TEXT,created_at TEXT,updated_at TEXT,embedding BLOB);`);
  let tick=0;
  const load=domainModules({
    '@/lib/db/core': { getDatabase:()=>f.db, nowIso:()=>new Date(1700000000000+tick++).toISOString() },
    '@/lib/db/campaigns': { getCampaignById:()=>({id:'c',dmUserId:'dm'}),
      allocateSeq:id=>f.db.prepare('UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq').get(id).seq },
    '@/lib/db/sheets': { listSheets:()=>[{id:'pc-a',userId:'a'},{id:'pc-b',userId:'b'}] },
    '@/lib/embeddings': { embed:async()=>[],vectorToBuffer:()=>null },
    '@/lib/spatial/service': {
      spatialEnabled:id=>id==='c', spatialStore:()=>({}),
      spatialContext:(campaignId,userId)=>{
        if(campaignId!=='c'||!f.members.has(userId))throw Error('not found');
        return {campaign:{id:'c',dmUserId:'dm'},actor:{campaignId,userId,isDm:userId==='dm',memberIds:[...f.members],playerIds:[...f.members].filter(id=>id!=='dm')}};
      },
    },
  });
  const notes=load('@/lib/db/notes'); const domain=load('@/lib/spatial/domain');
  const scope=load('@/lib/spatial/publication-scope.mjs'); const restore=load('@/lib/spatial/domain-restore');
  const insert=(body,options={})=>notes.insertNote({campaignId:'c',characterId:null,authorUserId:'dm',authorKind:'dm',visibility:'public',status:'active',title:'Note',body,seq:1,...options});
  return {...f,notes,domain,scope,restore,insert};
}

test('R04: canonical notes-store is an exact copy of the reviewed upstream blob',()=>{
  const source=readFileSync(new URL('../src/lib/db/notes-store.ts',import.meta.url));
  assert.equal(createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex'),'39b3979493b548c6c7ac0f96a158cab1dbbf53c9');
});

test('R04: actual note SQL create/edit/delete and observed reads form one integrated lifecycle',t=>{
  const f=fixture(t);
  const note=f.scope.withPublicationScope('c',{kind:'room',roomId:'tavern'},()=>f.insert('V1'));
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'V1');
  assert.deepEqual(f.notes.listNotesVisibleTo('c','b',false),[]);
  f.move('a','street'); f.move('b','tavern'); f.notes.updateNote(note.id,{body:'V2'});
  assert.equal(f.notes.getNoteById(note.id).body,'V2');
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'V1');
  assert.equal(f.notes.listNotesVisibleTo('c','b',false)[0].body,'V2');
  assert.throws(()=>f.domain.requireCurrentEntity('c','a','note',note.id),error=>error.status===409);
  f.notes.deleteNote(note.id); assert.equal(f.notes.getNoteById(note.id),null);
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'V1');
  assert.deepEqual(f.notes.listNotesVisibleTo('c','b',false),[]);
});

test('R04: returning observes current content without leaking it while away',t=>{
  const f=fixture(t);
  const note=f.insert('FIRST',{scope:{kind:'room',roomId:'tavern'}});
  f.move('a','street'); f.notes.updateNote(note.id,{body:'LATEST'});
  assert.equal(f.domain.visibleEntity('c','a','note',note.id).body,'FIRST');
  f.move('a','tavern'); assert.equal(f.domain.visibleEntity('c','a','note',note.id).body,'LATEST');
  assert.doesNotThrow(()=>f.domain.requireCurrentEntity('c','a','note',note.id));
});

test('R04: failed publication rolls back the actual canonical SQL insert too',t=>{
  const f=fixture(t);
  assert.throws(()=>f.insert('UNCOMMITTED',{scope:{kind:'room',roomId:'elsewhere'}}),/not found/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_notes').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM spatial_object_versions').get().n,0);
});

test('R04: user public note defaults to their current room; private notes remain author-only',t=>{
  const f=fixture(t);
  f.insert('LOCAL',{authorUserId:'a',authorKind:'user'});
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'LOCAL');
  assert.deepEqual(f.notes.listNotesVisibleTo('c','b',false),[]);
  f.insert('PERSONAL',{authorUserId:'a',authorKind:'user',visibility:'private'});
  assert.equal(f.notes.listNotesVisibleTo('c','a',false).length,2);
  assert.equal(f.notes.listNotesVisibleTo('c','dm',true).length,1);
});

test('R04: restoring domain ledger rehydrates edited/deleted canonical note SQL',t=>{
  const f=fixture(t); const note=f.insert('BOUNDARY',{scope:{kind:'room',roomId:'tavern'}});
  const tables=['spatial_object_versions','spatial_object_receipts'];
  const snapshot=Object.fromEntries(tables.map(name=>[name,f.db.prepare(`SELECT * FROM ${name}`).all()]));
  f.notes.updateNote(note.id,{body:'DISCARDED'});f.notes.deleteNote(note.id);
  f.db.transaction(()=>{
    for(const name of [...tables].reverse())f.db.exec(`DELETE FROM ${name}`);
    for(const name of tables)for(const row of snapshot[name]){
      const columns=Object.keys(row);f.db.prepare(`INSERT INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));
    }
    f.restore.restoreCanonicalDomainRows('c');
  })();
  assert.equal(f.notes.getNoteById(note.id).body,'BOUNDARY');
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'BOUNDARY');
});
