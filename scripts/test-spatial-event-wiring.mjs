import test from 'node:test';
import assert from 'node:assert/strict';
import { astraHarness } from './lib/astra-harness.mjs';
import { migrateScopedNoteLedger } from '../src/lib/spatial/note-ledger-migration.mjs';
const request=(method,body,headers={})=>new Request('http://local/notes',{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('canonical notes and generic entity/search APIs retain the identical witnessed version',async t=>{
 const f=await astraHarness(t),n=f.create();f.move('a','street');f.notes.updateNote(n.id,{body:'UNSEEN_V2'});
 assert.equal(f.notes.getNoteVisibleTo('c',n.id,'a',false).body,'V1');assert.equal(f.notes.getNoteVisibleTo('c',n.id,'b',false).body,'UNSEEN_V2');
 assert.equal(f.domain.domainStore().read('c','a','note',n.id).data.body,'V1');assert.equal(f.domain.domainStore().list('c','a','note',{query:'UNSEEN_V2'}).length,0);
 f.move('a','tavern');assert.equal(f.notes.getNoteVisibleTo('c',n.id,'a',false).body,'UNSEEN_V2');
});
test('an author outside the scene cannot read through empty PATCH or DELETE',async t=>{
 const f=await astraHarness(t),n=f.create({authorUserId:'a'});f.move('a','street');f.notes.updateNote(n.id,{body:'SECRET'});f.login('a');
 const response=await f.detailRoute.PATCH(request('PATCH',{}),f.detail(n.id));assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/SECRET/);
 assert.equal((await f.detailRoute.DELETE(request('DELETE'),f.detail(n.id))).status,403);assert.equal(f.notes.getNoteVisibleTo('c',n.id,'a',false).body,'V1');
});
test('private journals remain author-only and unobserved deletion keeps the old public note',async t=>{
 const f=await astraHarness(t),privateNote=f.create({authorUserId:'a',visibility:'private',audience:undefined});
 assert.equal(f.notes.getNoteVisibleTo('c',privateNote.id,'dm',true),null);assert.equal(f.notes.getNoteVisibleTo('c',privateNote.id,'a',false).body,'V1');
 const n=f.create();f.move('a','street');f.notes.deleteNote(n.id);
 assert.equal(f.notes.getNoteVisibleTo('c',n.id,'a',false).body,'V1');assert.equal(f.notes.getNoteVisibleTo('c',n.id,'b',false),null);
 f.move('a','tavern');assert.equal(f.notes.getNoteVisibleTo('c',n.id,'a',false),null);
});
test('local pending approval retains scope while explicit party publication remains global',async t=>{
 const f=await astraHarness(t),n=f.create({authorUserId:'a',status:'pending'});assert.equal(f.notes.getNoteVisibleTo('c',n.id,'b',false),null);
 f.policy.withEventScope('c',{kind:'room',roomId:'street'},()=>f.notes.updateNote(n.id,{status:'active'}));
 assert.equal(f.notes.getNoteVisibleTo('c',n.id,'b',false).roomId,'tavern');assert.equal(f.notes.getNoteVisibleTo('c',n.id,'d',false),null);
 const global=f.create({audience:{global:true}});assert.equal(f.notes.getNoteVisibleTo('c',global.id,'d',false).body,'V1');
});
test('note mutation, version and embedding effects roll back together',async t=>{
 const f=await astraHarness(t),n=f.create();const count=f.db.prepare('SELECT count(*) n FROM spatial_object_versions').get().n,calls=f.embeddingCalls.length;
 assert.throws(()=>f.notes.updateNote(n.id,{body:'BAD'},{roomId:'foreign',actorUserId:'dm'}));assert.equal(f.notes.getNoteById(n.id).body,'V1');
 assert.equal(f.db.prepare('SELECT count(*) n FROM spatial_object_versions').get().n,count);assert.equal(f.embeddingCalls.length,calls);
});
test('new event receipts and old audience_json rows are both projected; no late arrival history',async t=>{
 const f=await astraHarness(t);f.move('b','street');f.policy.withEventScope('c',{kind:'room',roomId:'tavern'},()=>f.events.publishPersisted('c','message_added',{message:{content:'SECRET'}}));
 const event=f.events.listEventsSince('c',0)[0];f.move('a','street');f.move('b','tavern');
 assert.match(JSON.stringify(f.policy.campaignEventProjector('c','a').projectEvent(event)),/SECRET/);assert.doesNotMatch(JSON.stringify(f.policy.campaignEventProjector('c','b').projectEvent(event)),/SECRET/);
 const seq=f.campaigns.allocateSeq('c');f.db.prepare('INSERT INTO campaign_events VALUES(?,?,?,?,?,?)').run('c',seq,'message_added',JSON.stringify({message:{content:'LEGACY_SECRET'}}),'now',JSON.stringify({version:1,userIds:['a']}));
 assert.match(JSON.stringify(f.events.listEventsSince('c',event.seq,500,'a')),/LEGACY_SECRET/);assert.doesNotMatch(JSON.stringify(f.events.listEventsSince('c',event.seq,500,'b')),/LEGACY_SECRET/);
});
test('note event audience follows the canonical note instead of the emitter current location',async t=>{
 const f=await astraHarness(t),n=f.create();f.events.publishPersisted('c','note_updated',{note:n});f.move('a','street');const updated=f.notes.updateNote(n.id,{body:'V2'});f.events.publishPersisted('c','note_updated',{note:updated});
 const events=f.events.listEventsSince('c',0);assert.equal(f.policy.campaignEventProjector('c','a').projectEvent(events[1]).type,'stream_checkpoint');
 assert.equal(f.policy.campaignEventProjector('c','b').projectEvent(events[1]).payload.note.body,'V2');
});
test('persisted payloads are frozen before deferred publication and outer rollback emits nothing',async t=>{
 const f=await astraHarness(t),sent=[];const stop=f.events.subscribeRaw('c',chunk=>sent.push(chunk));t.after(stop);
 const payload={message:{content:'ORIGINAL'}};f.effects.withCommittedEffects(()=>f.db.transaction(()=>{f.events.publishPersisted('c','message_added',payload,{kind:'global'});payload.message.content='MUTATED';})());
 assert.match(sent[0],/ORIGINAL/);assert.doesNotMatch(sent[0],/MUTATED/);
 const count=sent.length;assert.throws(()=>f.effects.withCommittedEffects(()=>f.db.transaction(()=>{f.events.publishPersisted('c','message_added',{message:{content:'ROLLBACK'}},{kind:'global'});throw new Error('rollback');})()));
 assert.equal(sent.length,count);assert.doesNotMatch(JSON.stringify(f.events.listEventsSince('c',0)),/ROLLBACK/);
});
test('real stream replays only permitted records and rejects membership revocation',async t=>{
 const f=await astraHarness(t);f.move('b','street');f.login('b');const abort=new AbortController();t.after(()=>abort.abort());
 f.events.publishPersisted('c','sheet_updated',{sheet:{id:'sheet-a',userId:'a',secret:'PRIVATE'}});f.events.publishPersisted('c','campaign_updated',{title:'PUBLIC_END'},{kind:'global'});
 const response=await f.route.GET(new Request('http://local/events',{signal:abort.signal}),{params:Promise.resolve({campaignId:'c'})}),reader=response.body.getReader();let body='';
 while(!body.includes('PUBLIC_END')){const part=await reader.read();assert.equal(part.done,false);body+=new TextDecoder().decode(part.value);}
 assert.doesNotMatch(body,/PRIVATE/);
 // Consume the replay checkpoint and its refresh frames before testing a live wait.
 for(let i=0;i<7;i++)await reader.read();
 f.events.publishPersisted('c','campaign_updated',{title:'BEFORE_REVOKE'},{kind:'global'});
 let drained='';while(!drained.includes('BEFORE_REVOKE')){const part=await reader.read();assert.equal(part.done,false);drained+=new TextDecoder().decode(part.value);}
 const pending=reader.read();f.db.prepare("DELETE FROM members WHERE user_id='b'").run();f.events.publishPersisted('c','campaign_updated',{title:'AFTER_KICK'},{kind:'global'});
 await assert.rejects(pending,/revoked/);
});
test('both browser identity header contracts reject stale reads and writes',async t=>{
 const f=await astraHarness(t);f.login('b');const params={params:Promise.resolve({campaignId:'c'})};
 for(const name of ['X-ODM-Actor','X-ODM-Expected-User']){
 assert.equal((await f.locationRoute.GET(new Request('http://local/location-chat',{headers:{[name]:'a'}}),params)).status,409);
 assert.equal((await f.locationRoute.POST(request('POST',{}, {[name]:'a'}),params)).status,409);
 }
});
test('scoped-chat note snapshots migrate exact archived receipts into the canonical ledger',async t=>{
 const f=await astraHarness(t);f.db.exec('CREATE TABLE spatial_object_scopes(campaign_id TEXT,object_type TEXT,object_id TEXT,scope_json TEXT)');
 f.db.prepare('INSERT INTO spatial_object_scopes VALUES(?,?,?,?)').run('c','note','legacy',JSON.stringify({kind:'room',roomId:'tavern',userIds:[],dmCanRead:true}));
 for(const [version,body]of [[1,'OLD'],[2,'CURRENT']])f.db.prepare('INSERT INTO spatial_object_versions VALUES(?,?,?,?,?,?,?)').run('c','note','legacy',version,'tavern',JSON.stringify({id:'legacy',campaignId:'c',visibility:'public',status:'active',authorUserId:'dm',body}),version);
 f.db.prepare('INSERT INTO spatial_object_receipts VALUES(?,?,?,?,?,?)').run('c','a','note','legacy',1,1);f.move('a','street');
 assert.equal(migrateScopedNoteLedger(f.db,'c'),1);assert.equal(migrateScopedNoteLedger(f.db,'c'),0);
 assert.equal(f.domain.domainStore().read('c','a','note','legacy').data.body,'OLD');assert.equal(f.domain.domainStore().read('c','b','note','legacy').data.body,'CURRENT');
});
