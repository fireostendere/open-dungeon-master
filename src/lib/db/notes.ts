// The SQL implementation is retained; the mutation, audience and observed
// domain version commit together. No secondary note ledger is introduced.
export * from '@/lib/db/notes-store';
import * as raw from '@/lib/db/notes-store';
import { getDatabase } from '@/lib/db/core';
import { withCommittedEffects } from '@/lib/db/commit-effects';
import { domainStore } from '@/lib/spatial/domain';
import { migrateScopedNoteLedger } from '@/lib/spatial/note-ledger-migration.mjs';
import { spatialEnabled } from '@/lib/spatial/service';
import { captureNoteVersion, ensureNoteVersion, projectSpatialNote, listSpatialNotes, type NoteAudience } from '@/lib/spatial/note-privacy';
import type { PublicationScope } from '@/lib/spatial/publication-scope.mjs';
export type Note=raw.Note & {roomId?:string|null;audience?:string};
export function insertNote(input:Parameters<typeof raw.insertNote>[0] & {scope?:PublicationScope;audience?:NoteAudience}):Note {
  return withCommittedEffects(()=>getDatabase().transaction(()=>{
    const {scope,audience,...data}=input;
    const note=raw.insertNote(data);
    captureNoteVersion(note,scope?{...audience,scope}:audience);
    return note;
  })());
}
export function updateNote(noteId:string,patch:Parameters<typeof raw.updateNote>[1],audience?:NoteAudience):Note|null {
  return withCommittedEffects(()=>getDatabase().transaction(()=>{
    const previous=raw.getNoteById(noteId);
    if(!previous) return null;
    ensureNoteVersion(previous);
    const result=raw.updateNote(noteId,patch);
    if(result) captureNoteVersion(result,audience);
    return result;
  })());
}
export function deleteNote(noteId:string):boolean {
  return withCommittedEffects(()=>getDatabase().transaction(()=>{
    const previous=raw.getNoteById(noteId);
    if(!previous) return false;
    ensureNoteVersion(previous);
    if(!raw.deleteNote(noteId)) return false;
    captureNoteVersion(previous,undefined,true);
    return true;
  })());
}
export function registerUnversionedNotes(campaignId:string):void {
  if(!spatialEnabled(campaignId)) return;
  domainStore(); migrateScopedNoteLedger(getDatabase(),campaignId);
  const rows=getDatabase().prepare('SELECT id FROM campaign_notes WHERE campaign_id=?').all(campaignId) as {id:string}[];
  for(const {id} of rows) {const note=raw.getNoteById(id);if(note) ensureNoteVersion(note);}
}
export function getNoteVisibleTo(campaignId:string,noteId:string,userId:string,lead:boolean):Note|null {
  const note=raw.getNoteById(noteId);
  if(note && note.campaignId!==campaignId) return null;
  if(spatialEnabled(campaignId)) return projectSpatialNote(campaignId,noteId,userId,note);
  return note && (note.authorUserId===userId || note.visibility==='public' && (note.status==='active' || lead && note.status==='pending')) ? note : null;
}
export function listNotesVisibleTo(campaignId:string,userId:string,lead:boolean):Note[] {
  if(!spatialEnabled(campaignId)) return raw.listNotesVisibleTo(campaignId,userId,lead);
  const rows=getDatabase().prepare('SELECT id FROM campaign_notes WHERE campaign_id=?').all(campaignId) as {id:string}[];
  const notes=rows.map(({id})=>raw.getNoteById(id)).filter((note):note is raw.Note=>note!==null);
  return listSpatialNotes(campaignId,userId,notes);
}
