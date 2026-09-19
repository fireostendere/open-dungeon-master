import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesHarness } from './lib/spatial-notes-harness.mjs';

test('R03/R04: canonical note mutation preserves personally witnessed versions on real reads', async t => {
  const f=await notesHarness(t), note=f.create();
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'V1');
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'d',false),null);
  f.move('a','street');f.notes.updateNote(note.id,{body:'V2'});
  assert.equal(f.notes.getNoteById(note.id).body,'V2');
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'V1');
  assert.equal(f.notes.listNotesVisibleTo('c','b',false)[0].body,'V2');
  f.move('d','tavern');const arrival=f.notes.getNoteVisibleTo('c',note.id,'d',false);
  assert.equal(arrival.body,'V2');assert.equal(arrival.history,undefined);
  f.move('a','tavern');assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'V2');
});

test('R04: deletion while away preserves the archived note; newcomers see no deleted prose', async t => {
  const f=await notesHarness(t), note=f.create();f.move('a','street');
  assert.equal(f.notes.deleteNote(note.id),true);assert.equal(f.notes.getNoteById(note.id),null);
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'V1');
  assert.equal(f.notes.listNotesVisibleTo('c','a',false)[0].body,'V1');
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'b',false),null);
  f.move('d','tavern');assert.equal(f.notes.getNoteVisibleTo('c',note.id,'d',false),null);
  f.move('a','tavern');assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false),null);
});

test('R03: private notes stay author-only, even for a DM in the same location', async t => {
  const f=await notesHarness(t), note=f.create({authorUserId:'a',visibility:'private',audience:undefined});
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'b',false),null);
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'V1');
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'dm',true),null);
});

test('R04: approving a local suggestion retains its publication scope, not the approver location', async t => {
  const f=await notesHarness(t), note=f.create({authorUserId:'a',status:'pending'});
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'b',false),null);
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'dm',true).status,'pending');
  f.policy.withEventScope('c',{kind:'room',roomId:'street'},()=>f.notes.updateNote(note.id,{status:'active'}));
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'b',false).roomId,'tavern');
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'d',false),null);
});

test('R03: explicitly global notes stay global; unscoped DM-generated notes do not choose the lead room', async t => {
  const f=await notesHarness(t), global=f.create({audience:{global:true},body:'GLOBAL'});
  f.notes.updateNote(global.id,{body:'GLOBAL_V2'});
  assert.equal(f.notes.getNoteVisibleTo('c',global.id,'d',false).body,'GLOBAL_V2');
  const hidden=f.create({authorUserId:'a',authorKind:'dm',audience:undefined,body:'DM_SECRET'});
  assert.equal(f.notes.getNoteVisibleTo('c',hidden.id,'a',false),null);
  assert.equal(f.notes.getNoteVisibleTo('c',hidden.id,'dm',true).body,'DM_SECRET');
});

test('R03: already-public pre-spatial note migrates without making newer local notes global', async t => {
  const f=await notesHarness(t); f.db.exec('DELETE FROM spatial_campaigns WHERE campaign_id="c"'.replace('"c"',"'c'"));
  const note=f.create({seq:1,audience:undefined});
  f.db.prepare('INSERT INTO spatial_campaigns VALUES(?,?)').run('c',10);
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'d',false).body,'V1');
  f.notes.updateNote(note.id,{body:'V2'});
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'d',false).body,'V2');
});

test('R04: invalid cross-campaign targeting rolls canonical note and its version back together', async t => {
  const f=await notesHarness(t), note=f.create();
  const before=f.db.prepare('SELECT count(*) AS n FROM spatial_object_versions').get().n;
  assert.throws(()=>f.notes.updateNote(note.id,{body:'MUST_ROLL_BACK'},{roomId:'foreign',actorUserId:'dm'}),/not found/);
  assert.equal(f.notes.getNoteById(note.id).body,'V1');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM spatial_object_versions').get().n,before);
  assert.equal(f.notes.getNoteVisibleTo('other',note.id,'d',false),null);
  f.db.prepare("DELETE FROM members WHERE user_id='b'").run();
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'b',false),null);
});

test('R01/R04: existing note_updated event uses canonical audience and retains publication-time view', async t => {
  const f=await notesHarness(t),note=f.create();
  f.events.publishPersisted('c','note_updated',{note});
  const old=f.events.listEventsSince('c',0)[0];
  f.move('a','street');const updated=f.notes.updateNote(note.id,{body:'V2'});
  f.events.publishPersisted('c','note_updated',{note:updated});
  const next=f.events.listEventsSince('c',old.seq)[0];
  assert.equal(f.policy.campaignEventProjector('c','a').projectEvent(old).payload.note.body,'V1');
  assert.equal(f.policy.campaignEventProjector('c','a').projectEvent(next).type,'stream_checkpoint');
  assert.equal(f.policy.campaignEventProjector('c','b').projectEvent(next).payload.note.body,'V2');
  f.policy.withEventScope('c',{kind:'dm'},()=>f.events.publishPersisted('c','note_updated',{note:updated}));
  const restricted=f.events.listEventsSince('c',next.seq)[0];
  assert.equal(f.policy.campaignEventProjector('c','b').projectEvent(restricted).type,'stream_checkpoint');
});

test('R03: real HTTP detail/list endpoints return the old observed note; empty PATCH cannot reveal the new body', async t => {
  const f=await notesHarness(t),note=f.create();f.move('a','street');f.notes.updateNote(note.id,{body:'V2_SECRET'});f.login('a');
  const get=await f.detailRoute.GET(new Request('http://local/notes/'+note.id),f.detail(note.id));
  assert.equal(get.status,200);assert.equal((await get.json()).note.body,'V1');assert.match(get.headers.get('cache-control'),/no-store/);
  const list=await f.listRoute.GET(new Request('http://local/notes?roomId=tavern'),{params:Promise.resolve({campaignId:'c'})});
  assert.equal((await list.json()).notes[0].body,'V1');
  const patch=await f.detailRoute.PATCH(new Request('http://local/notes/'+note.id,{method:'PATCH',body:'{}',headers:{'Content-Type':'application/json'}}),f.detail(note.id));
  assert.equal(patch.status,403);assert.equal((await patch.text()).includes('V2_SECRET'),false);
  f.login('d');assert.equal((await f.detailRoute.GET(new Request('http://local/notes/'+note.id),f.detail(note.id))).status,404);
});

test('R03: real HTTP POST preserves explicit party publication and supports a local pending suggestion', async t => {
  const f=await notesHarness(t);f.login('dm');
  const post=(body)=>f.listRoute.POST(new Request('http://local/notes',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),{params:Promise.resolve({campaignId:'c'})});
  const shared=await post({visibility:'public',title:'Global',body:'PARTY'});
  assert.equal(shared.status,200);const sharedNote=(await shared.json()).note;
  assert.equal(f.notes.getNoteVisibleTo('c',sharedNote.id,'d',false).body,'PARTY');
  f.login('a');const local=await post({visibility:'public',title:'Local',body:'ROOM',roomId:'tavern'});
  assert.equal(local.status,200);const localNote=(await local.json()).note;
  assert.equal(f.notes.getNoteVisibleTo('c',localNote.id,'b',false),null);
  f.login('dm');const approval=await f.detailRoute.PATCH(new Request('http://local/notes/'+localNote.id,{method:'PATCH',body:'{"status":"active"}',headers:{'Content-Type':'application/json'}}),f.detail(localNote.id));
  assert.equal(approval.status,200);
  assert.equal(f.notes.getNoteVisibleTo('c',localNote.id,'b',false).body,'ROOM');
  assert.equal(f.notes.getNoteVisibleTo('c',localNote.id,'d',false),null);
});
