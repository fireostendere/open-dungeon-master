import { getDatabase, nowIso } from "@/lib/db/core";
import { afterCommit, withCommittedEffects } from "@/lib/db/commit-effects";
import { embed, vectorToBuffer } from "@/lib/embeddings";
import { captureNoteVersion, ensureNoteVersion, listSpatialNotes, projectSpatialNote, type NoteAudience } from "@/lib/spatial/note-privacy";
import { eventSpatialState } from "@/lib/spatial/event-policy";

// Canonical note mutations are shared by the UI and the rules engine. While
// spatial mode is enabled their player-facing versions are recorded in the
// same transaction. Raw getters remain internal; HTTP uses the viewer getter.
export type NoteVisibility = "public" | "private";
export type NoteStatus = "active" | "pending";
export type NoteAuthorKind = "user" | "dm";
export type Note = {
  id: string; campaignId: string; characterId: string | null; authorUserId: string;
  authorKind: NoteAuthorKind; visibility: NoteVisibility; status: NoteStatus;
  roomId?: string | null; audience?: "room" | "global" | "users";
  pinned: boolean; title: string; body: string; seq: number; createdAt: string; updatedAt: string;
};
type NoteRow = {
  id: string; campaign_id: string; character_id: string | null; author_user_id: string;
  author_kind: NoteAuthorKind; visibility: NoteVisibility; status: NoteStatus;
  pinned: number; title: string; body: string; seq: number; created_at: string; updated_at: string;
};
function mapNote(row: NoteRow): Note {
  return { id: row.id, campaignId: row.campaign_id, characterId: row.character_id, authorUserId: row.author_user_id,
    authorKind: row.author_kind === "dm" ? "dm" : "user", visibility: row.visibility, status: row.status,
    pinned: row.pinned === 1, title: row.title, body: row.body, seq: row.seq, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function insertNote(input: {
  campaignId: string; characterId: string | null; authorUserId: string; authorKind?: NoteAuthorKind;
  visibility: NoteVisibility; status: NoteStatus; title: string; body: string; seq: number;
  audience?: NoteAudience;
}): Note {
  return withCommittedEffects(() => getDatabase().transaction(() => {
    const id = crypto.randomUUID(), now = nowIso();
    getDatabase().prepare(`INSERT INTO campaign_notes (
      id,campaign_id,character_id,author_user_id,author_kind,visibility,status,pinned,title,body,seq,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(id, input.campaignId, input.characterId, input.authorUserId,
      input.authorKind ?? "user", input.visibility, input.status, input.title.slice(0, 120), input.body.slice(0, 2000), input.seq, now, now);
    const note = getNoteById(id)!;
    captureNoteVersion(note, input.audience);
    afterCommit(() => embedNote(id));
    return note;
  })());
}

// Privileged canonical read for engine/edit validation, never a public DTO.
export function getNoteById(noteId: string): Note | null {
  const row = getDatabase().prepare(`SELECT * FROM campaign_notes WHERE id = ?`).get(noteId) as NoteRow | undefined;
  return row ? mapNote(row) : null;
}

export function getNoteVisibleTo(campaignId: string, noteId: string, userId: string, lead: boolean): Note | null {
  const note = getNoteById(noteId);
  if (note && note.campaignId !== campaignId) return null;
  if (eventSpatialState(campaignId).enabled) return projectSpatialNote(campaignId, noteId, userId, note);
  return note && (note.authorUserId === userId || note.visibility === "public" && note.status === "active" || lead && note.status === "pending") ? note : null;
}

export function updateNote(noteId: string,
  patch: { title?: string; body?: string; pinned?: boolean; status?: NoteStatus }, audience?: NoteAudience,
): Note | null {
  return withCommittedEffects(() => getDatabase().transaction(() => {
    const note = getNoteById(noteId);
    if (!note) return null;
    // Capture an older canonical row before its first post-upgrade edit.
    ensureNoteVersion(note);
    getDatabase().prepare(`UPDATE campaign_notes SET title=?,body=?,pinned=?,status=?,updated_at=? WHERE id=?`).run(
      (patch.title ?? note.title).slice(0, 120), (patch.body ?? note.body).slice(0, 2000), (patch.pinned ?? note.pinned) ? 1 : 0,
      patch.status ?? note.status, nowIso(), noteId);
    const updated = getNoteById(noteId)!;
    captureNoteVersion(updated, audience);
    if (patch.title !== undefined || patch.body !== undefined) afterCommit(() => embedNote(noteId));
    return updated;
  })());
}

async function embedNote(noteId: string) {
  try {
    const note = getNoteById(noteId);
    if (!note) return;
    const [vector] = await embed([`${note.title}\n${note.body}`]);
    if (vector) getDatabase().prepare(`UPDATE campaign_notes SET embedding=? WHERE id=?`).run(vectorToBuffer(vector), noteId);
  } catch { console.error("[notes] embedding failed"); }
}

export function deleteNote(noteId: string): boolean {
  return withCommittedEffects(() => getDatabase().transaction(() => {
    const note = getNoteById(noteId);
    if (!note) return false;
    ensureNoteVersion(note);
    getDatabase().prepare(`DELETE FROM campaign_notes WHERE id=?`).run(noteId);
    captureNoteVersion(note, undefined, true);
    return true;
  })());
}

export function listNotesVisibleTo(campaignId: string, userId: string, lead: boolean): Note[] {
  if (eventSpatialState(campaignId).enabled) {
    const rows = getDatabase().prepare(`SELECT * FROM campaign_notes WHERE campaign_id=?`).all(campaignId) as NoteRow[];
    return listSpatialNotes(campaignId, userId, rows.map(mapNote));
  }
  const rows = getDatabase().prepare(`SELECT * FROM campaign_notes WHERE campaign_id=? AND (
    (visibility='public' AND status='active') OR author_user_id=? OR (? AND status='pending')
  ) ORDER BY pinned DESC,seq DESC`).all(campaignId, userId, lead ? 1 : 0) as NoteRow[];
  return rows.map(mapNote);
}

// DM-only canonical retrieval. Player HTTP/search/export paths must use the
// viewer getter rather than treating this privileged prompt helper as public.
export function listPublicCampaignNotes(campaignId: string, limit = 20): Note[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_notes WHERE campaign_id=? AND character_id IS NULL
    AND visibility='public' AND status='active' ORDER BY pinned DESC,seq DESC LIMIT ?`).all(campaignId, limit) as NoteRow[];
  return rows.map(mapNote);
}
