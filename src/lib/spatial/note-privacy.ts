import { getDatabase } from "@/lib/db/core";
import { allocateSeq, listMembers } from "@/lib/db/campaigns";
import { SPATIAL_SCHEMA } from "./store.mjs";
import { createEntityVersions, type EntityScope } from "./entity-versions.mjs";
import { currentEventScope, eventActorFor, eventSpatialState } from "./event-policy";
import type { Note } from "@/lib/db/notes";

export type NoteAudience = { roomId?: string; global?: boolean; actorUserId?: string };
export class NotePrivacyError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
function store() {
  const db = getDatabase(); db.exec(SPATIAL_SCHEMA);
  return createEntityVersions(db, { nextSeq: allocateSeq });
}
function actors(campaignId: string) {
  return listMembers(campaignId).map(member => eventActorFor(campaignId, member.userId, true));
}

function scopeForNote(note: Note, target: NoteAudience | undefined, prior: EntityScope | null, legacy = false): EntityScope {
  const author = eventActorFor(note.campaignId, note.authorUserId, true);
  const inherited = !prior && !target ? currentEventScope(note.campaignId) : undefined;
  const editor = target?.actorUserId ? eventActorFor(note.campaignId, target.actorUserId, true) : author;
  if (target?.global && target.roomId) throw new NotePrivacyError("Choose a location or explicit global publication, not both.", 400);
  const explicitRoom = target?.roomId ?? (inherited?.kind === "room" ? inherited.roomId : undefined);
  const global = target?.global === true || inherited?.kind === "global";
  if (global && note.visibility === "private") throw new NotePrivacyError("A private note cannot be published globally.", 400);
  let scope: EntityScope;
  if (global || legacy && note.visibility === "public") scope = { kind: "global" };
  else if (explicitRoom) {
    const room = getDatabase().prepare("SELECT id FROM spatial_rooms WHERE campaign_id=? AND id=?").get(note.campaignId, explicitRoom);
    if (!room) throw new NotePrivacyError("Location not found.", 404);
    if (!editor.isDm && !inherited && explicitRoom !== editor.roomId) throw new NotePrivacyError("You are not in that location.", 403);
    scope = { kind: "room", roomId: explicitRoom };
  } else if (prior) scope = { ...prior };
  // DM-written notes may carry the party lead as their legacy FK author.
  // That must not silently choose the lead player's room as the DM's scene.
  else if (note.authorKind !== "dm" && author.roomId) scope = { kind: "room", roomId: author.roomId };
  else scope = { kind: "users" };
  const memberIds = new Set(listMembers(note.campaignId).map(member => member.userId));
  return { ...scope,
    userIds: note.authorKind === "dm" && note.visibility === "public" ? []
      : note.visibility === "private" || note.status === "pending" || scope.kind === "users"
        ? [note.authorUserId].filter(id => memberIds.has(id)) : [],
    dmCanRead: note.visibility === "public",
    restricted: note.visibility === "private" || note.status === "pending",
    discover: true,
  };
}

// Runs in the same transaction as the original note mutation. The source
// note remains the engine's canonical object; only its viewer DTO is frozen.
export function captureNoteVersion(note: Note, target?: NoteAudience, deleted = false): void {
  const mode = eventSpatialState(note.campaignId);
  if (!mode.enabled) return;
  const versions = store();
  const prior = versions.scope(note.campaignId, "note", note.id);
  const scope = scopeForNote(note, target, prior, !prior && note.seq < mode.startSeq);
  const payload = deleted ? { id: note.id, campaignId: note.campaignId, authorUserId: note.authorUserId,
    characterId: note.characterId, visibility: note.visibility, status: note.status, __spatialDeleted: true }
    : { ...note, roomId: scope.kind === "room" ? scope.roomId : null, audience: scope.kind };
  versions.write(note.campaignId, "note", note.id, payload, scope, actors(note.campaignId));
}

export function ensureNoteVersion(note: Note): void {
  if (!eventSpatialState(note.campaignId).enabled) return;
  const versions = store();
  if (!versions.scope(note.campaignId, "note", note.id)) captureNoteVersion(note);
}

export function projectSpatialNote(campaignId: string, noteId: string, userId: string, existing?: Note | null): Note | null {
  if (existing && existing.campaignId !== campaignId) return null;
  if (existing) ensureNoteVersion(existing);
  const actor = eventActorFor(campaignId, userId, true);
  if (!actor.member) return null;
  const version = store().read(campaignId, "note", noteId, actor);
  const note = version?.payload as (Note & { __spatialDeleted?: boolean }) | null;
  return note && !note.__spatialDeleted ? note : null;
}

export function listSpatialNotes(campaignId: string, userId: string, canonicalNotes: Note[]): Note[] {
  for (const note of canonicalNotes) ensureNoteVersion(note);
  const actor = eventActorFor(campaignId, userId, true);
  if (!actor.member) return [];
  return store().list(campaignId, "note", actor)
    .map(version => version.payload as Note & { __spatialDeleted?: boolean })
    .filter(note => !note.__spatialDeleted)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.seq - left.seq);
}

// An author's edit rights do not remotely reveal or mutate a shared local
// object after departure. Private journals and explicit global notes differ.
export function canMutateSpatialNote(campaignId: string, noteId: string, userId: string): boolean {
  if (!eventSpatialState(campaignId).enabled) return true;
  const actor = eventActorFor(campaignId, userId, true);
  if (!actor.member) return false;
  const scope = store().scope(campaignId, "note", noteId);
  if (!scope) return false;
  if (actor.isDm) return scope.dmCanRead !== false;
  if (scope.restricted) return Boolean(scope.userIds?.includes(userId));
  return scope.kind === "global" || scope.kind === "room" && scope.roomId === actor.roomId ||
    scope.kind === "users" && Boolean(scope.userIds?.includes(userId));
}
