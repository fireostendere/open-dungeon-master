import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notesHarness } from './lib/spatial-notes-harness.mjs';

test('R03/R04: authorship is not a remote update subscription or an empty-PATCH bypass', async t => {
  const f=await notesHarness(t),note=f.create({authorUserId:'a'});
  f.move('a','street');f.notes.updateNote(note.id,{body:'UNSEEN_V2'});f.login('a');
  assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'V1');
  const response=await f.detailRoute.PATCH(new Request('http://local/notes/'+note.id,{method:'PATCH',body:'{}',headers:{'Content-Type':'application/json'}}),f.detail(note.id));
  assert.equal(response.status,403);assert.equal((await response.text()).includes('UNSEEN_V2'),false);
  const deletion=await f.detailRoute.DELETE(new Request('http://local/notes/'+note.id,{method:'DELETE'}),f.detail(note.id));
  assert.equal(deletion.status,403);assert.equal(f.notes.getNoteById(note.id).body,'UNSEEN_V2');
  f.move('a','tavern');assert.equal(f.notes.getNoteVisibleTo('c',note.id,'a',false).body,'UNSEEN_V2');
});
