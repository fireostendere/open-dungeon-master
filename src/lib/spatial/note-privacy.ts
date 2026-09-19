/** The consolidation has ONE canonical note ledger: domain:note. The note UI,
 * generic entity API, export and engine therefore observe the same versions.
 */
import { getDatabase } from '@/lib/db/core';
import { spatialContext, spatialEnabled } from '@/lib/spatial/service';
import { domainStore, publishEntity, authorizePublication, DomainError } from '@/lib/spatial/domain';
import { currentPublicationScope, type PublicationScope } from './publication-scope.mjs';
import { currentEventScope } from './event-policy';
import { migrateScopedNoteLedger } from './note-ledger-migration.mjs';
import type { Note } from '@/lib/db/notes-store';
export type NoteAudience = { roomId?: string; global?: boolean; actorUserId?: string; scope?: PublicationScope };
export class NotePrivacyError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
type StoredNote = Note & { roomId?: string | null; audience?: string };
type Envelope = { format: string; scope: PublicationScope; ownerUserId?: string | null; allowedUserIds?: string[] | null; dmVisible?: boolean; deleted?: boolean; data: StoredNote };
function latest(campaignId: string, id: string): Envelope | null {
  const row = getDatabase().prepare("SELECT payload_json FROM spatial_object_versions WHERE campaign_id=? AND object_type='domain:note' AND object_id=? ORDER BY version DESC LIMIT 1")
    .get(campaignId,id) as { payload_json:string } | undefined;
  if (!row) return null;
  const envelope = JSON.parse(row.payload_json) as Envelope;
  if (envelope.format !== 'odm.domain.v1') throw new NotePrivacyError('Invalid note ledger.',500);
  return envelope;
}
function resolveScope(note: Note, target?: NoteAudience): PublicationScope | undefined {
  if (target?.global && target.roomId) throw new NotePrivacyError('Choose a location or explicit global publication, not both.',400);
  if (target?.scope && (target.roomId !== undefined || target.global !== undefined)) throw new NotePrivacyError('Use one publication scope format.',400);
  const scope = target?.scope ?? (target?.roomId ? {kind:'room' as const,roomId:target.roomId} : target?.global ? {kind:'global' as const} : undefined);
  if (scope?.kind==='global' && note.visibility==='private') throw new NotePrivacyError('A private note cannot be published globally.',400);
  if (scope) {
    if(scope.kind==='room' && !getDatabase().prepare('SELECT 1 FROM spatial_rooms WHERE campaign_id=? AND id=?').get(note.campaignId,scope.roomId)) throw new NotePrivacyError('Location not found.',404);
    try { return authorizePublication(note.campaignId,target?.actorUserId ?? note.authorUserId,scope); }
    catch(error) { if(error instanceof DomainError) throw new NotePrivacyError(error.message,error.status); throw error; }
  }
  // Updates keep their established binding, including pending approval.
  if (domainStore().has(note.campaignId,'note',note.id)) return undefined;
  const inherited=currentPublicationScope(note.campaignId) ?? currentEventScope(note.campaignId);
  if(inherited) return inherited;
  const mode=getDatabase().prepare('SELECT start_seq FROM spatial_campaigns WHERE campaign_id=?').get(note.campaignId) as {start_seq:number}|undefined;
  if(mode && note.seq<mode.start_seq && note.visibility==='public') return {kind:'global'};
  return undefined;
}
export function captureNoteVersion(note: Note, target?: NoteAudience, deleted=false): void {
  if(!spatialEnabled(note.campaignId)) return;
  try {
    const scope=resolveScope(note,target);
    const prior=latest(note.campaignId,note.id);
    const intended=scope ?? prior?.scope;
    const data:StoredNote={...note,
      ...(intended ? {roomId:intended.kind==='room'?intended.roomId:null,audience:intended.kind} : {})};
    publishEntity('note',data,{...(scope?{scope}:{}),deleted});
  } catch(error) { if(error instanceof DomainError) throw new NotePrivacyError(error.message,error.status); throw error; }
}
export function ensureNoteVersion(note: Note): void {
  if(!spatialEnabled(note.campaignId)) return;
  domainStore(); migrateScopedNoteLedger(getDatabase(),note.campaignId);
  if(!domainStore().has(note.campaignId,'note',note.id)) captureNoteVersion(note);
}
export function projectSpatialNote(campaignId:string,noteId:string,userId:string,existing?:Note|null): StoredNote|null {
  if(existing && existing.campaignId!==campaignId) return null;
  domainStore(); migrateScopedNoteLedger(getDatabase(),campaignId);
  if(existing) ensureNoteVersion(existing);
  try {
    const row=domainStore().read(campaignId,userId,'note',noteId);
    return row && !row.deleted ? {...row.data as Note,roomId:row.roomId} : null;
  } catch(error) { if(error instanceof DomainError && error.status===404) return null; throw error; }
}
export function listSpatialNotes(campaignId:string,userId:string,canonicalNotes:Note[]):StoredNote[] {
  domainStore(); migrateScopedNoteLedger(getDatabase(),campaignId);
  for(const note of canonicalNotes) ensureNoteVersion(note);
  try {
    return domainStore().list(campaignId,userId,'note',{limit:1000})
      .map(row=>({...row.data as Note,roomId:row.roomId}))
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.seq-a.seq);
  } catch(error) { if(error instanceof DomainError && error.status===404) return []; throw error; }
}
export function canMutateSpatialNote(campaignId:string,noteId:string,userId:string):boolean {
  if(!spatialEnabled(campaignId)) return true;
  let actor;
  try { actor=spatialContext(campaignId,userId).actor; } catch { return false; }
  const value=latest(campaignId,noteId);
  if(!value || value.deleted) return false;
  if(value.data.visibility==='private') return value.data.authorUserId===userId;
  if(actor.isDm) return value.dmVisible!==false;
  if(value.data.status==='pending') return value.data.authorKind!=='dm' && value.data.authorUserId===userId;
  if(value.allowedUserIds && !value.allowedUserIds.includes(userId)) return false;
  if(value.scope.kind==='global') return true;
  if(value.scope.kind==='users') return value.scope.userIds.includes(userId);
  if(value.scope.kind!=='room') return false;
  return Boolean(getDatabase().prepare('SELECT 1 FROM spatial_presence WHERE campaign_id=? AND user_id=? AND room_id=?')
    .get(campaignId,userId,value.scope.roomId));
}
