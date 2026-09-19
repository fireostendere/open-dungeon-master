import test from 'node:test';
import assert from 'node:assert/strict';

import { domainFixture as fixture } from './lib/domain-fixture.mjs';

test('R04: edit, leave, return preserves v1 and discloses only the currently observable v3', t => {
  const f = fixture(t); f.publish('n','V1',{scope:{kind:'room',roomId:'tavern'}});
  assert.equal(f.read('a','n').data.body,'V1'); assert.equal(f.read('b','n'),null);
  f.move('a','street'); f.move('b','tavern');
  f.publish('n','SECRET_V2'); f.publish('n','V3');
  assert.equal(f.read('a','n').data.body,'V1'); assert.equal(f.read('b','n').data.body,'V3');
  f.move('a','tavern'); assert.equal(f.read('a','n').data.body,'V3');
  assert.equal(f.read('a','n').version,3);
  assert.doesNotMatch(JSON.stringify(f.read('a','n')),/SECRET_V2|allowedUserIds|ownerUserId/);
});

test('R04: remote deletion keeps remembered content; witnessed deletion becomes a tombstone', t => {
  const f = fixture(t); f.publish('n','REMEMBER',{scope:{kind:'room',roomId:'tavern'}});
  f.move('a','street'); f.publish('n','REMEMBER',{deleted:true});
  assert.equal(f.store.list('c','a','note')[0].data.body,'REMEMBER');
  f.move('a','tavern'); assert.equal(f.read('a','n').deleted,true);
  assert.deepEqual(f.store.list('c','a','note'),[]);
});

test('R04: search and sorting use witnessed versions, not latest hidden text or edit time', t => {
  const f = fixture(t); f.publish('old','KNOWN_OLD',{scope:{kind:'room',roomId:'tavern'}});
  f.publish('new','KNOWN_NEW',{scope:{kind:'room',roomId:'tavern'}});
  f.move('a','street'); f.publish('old','SECRET_MARKER');
  assert.deepEqual(f.store.list('c','a','note').map(x=>x.id),['new','old']);
  assert.deepEqual(f.store.list('c','a','note',{query:'SECRET_MARKER'}),[]);
  assert.equal(f.store.list('c','a','note',{query:'KNOWN_OLD'})[0].version,1);
});

test('R04: deliberate global disclosure works but personal private notes remain private even from DM', t => {
  const f = fixture(t); f.publish('global','PUBLIC',{scope:{kind:'global'}});
  assert.equal(f.read('b','global').data.body,'PUBLIC');
  f.publish('private','PERSONAL',{scope:{kind:'dm'},ownerUserId:'a',allowedUserIds:[],dmVisible:false});
  assert.equal(f.read('a','private').data.body,'PERSONAL');
  assert.equal(f.read('b','private'),null); assert.equal(f.read('dm','private'),null);
  assert.equal(f.store.metadata('c','dm','note','private'),null);
  assert.throws(()=>f.store.observe('c','dm','note','private',['b'],1),/not found/);
});

test('R04: unchanged reads/publications do not advance the narrative cursor', t => {
  const f = fixture(t); f.publish('n','SAME',{scope:{kind:'room',roomId:'tavern'}});
  const before = f.db.prepare('SELECT next_seq FROM campaigns WHERE id=?').get('c').next_seq;
  for(let i=0;i<20;i++){ f.read('a','n'); f.publish('n','SAME'); f.store.list('c','a','note'); }
  assert.equal(f.db.prepare('SELECT next_seq FROM campaigns WHERE id=?').get('c').next_seq,before);
});

test('R04: explicit observation is pinned to a version, not a subscription to later edits', t => {
  const f = fixture(t); f.publish('n','ONE',{scope:{kind:'room',roomId:'tavern'}});
  f.store.observe('c','dm','note','n',['b'],1); assert.equal(f.read('b','n').data.body,'ONE');
  f.publish('n','TWO'); assert.equal(f.read('b','n').data.body,'ONE');
  assert.throws(()=>f.store.observe('c','dm','note','n',['b'],1),/version changed/);
});

test('R04: current authorization, room campaign binding, and transactional version CAS', t => {
  const f = fixture(t);
  assert.throws(()=>f.publish('n','X',{scope:{kind:'room',roomId:'elsewhere'}}),/not found/);
  f.publish('n','ONE',{scope:{kind:'global'},expectedVersion:0});
  assert.throws(()=>f.publish('n','BAD',{expectedVersion:0}),/version changed/);
  assert.throws(()=>f.db.transaction(()=>{f.publish('n','ROLLED_BACK');throw Error('abort');})(),/abort/);
  assert.equal(f.read('a','n').data.body,'ONE');
  f.members.delete('a'); assert.throws(()=>f.read('a','n'),/not found/);
  f.demote(); assert.throws(()=>f.publish('n','FORBIDDEN'),/Only the Dungeon Master/);
});

test('R04: restoring the existing object tables restores both versions and audiences', t => {
  const f = fixture(t); f.publish('n','BOUNDARY',{scope:{kind:'room',roomId:'tavern'}});
  const tables = ['spatial_object_versions','spatial_object_receipts'];
  const snapshot = Object.fromEntries(tables.map(name=>[name,f.db.prepare(`SELECT * FROM ${name}`).all()]));
  f.move('a','street'); f.move('b','tavern'); f.publish('n','DISCARDED');
  f.db.transaction(()=>{
    for(const name of [...tables].reverse())f.db.exec(`DELETE FROM ${name}`);
    for(const name of tables)for(const row of snapshot[name]){
      const cols=Object.keys(row); f.db.prepare(`INSERT INTO ${name}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));
    }
  })();
  assert.equal(f.read('a','n').data.body,'BOUNDARY');
  f.move('b','street'); assert.equal(f.read('b','n'),null);
});
