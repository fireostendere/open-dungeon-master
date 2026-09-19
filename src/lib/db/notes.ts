// Canonical SQL/embedding implementation stays in notes-store. Every domain
// mutation and its observed version commit together, including deletions.
export * from '@/lib/db/notes-store';
import * as raw from '@/lib/db/notes-store';
import type { Note } from '@/lib/db/notes-store';
import { getDatabase } from '@/lib/db/core';
import { spatialEnabled } from '@/lib/spatial/service';
import { domainStore, publishEntity, tombstoneEntity, visibleEntities, authorizePublication } from '@/lib/spatial/domain';
import { currentPublicationScope, type PublicationScope } from '@/lib/spatial/publication-scope.mjs';

export function insertNote(input: Parameters<typeof raw.insertNote>[0] & { scope?: PublicationScope }): Note {
  return getDatabase().transaction(() => {
    const { scope, ...data } = input;
    const intended = scope ?? currentPublicationScope(input.campaignId);
    if (spatialEnabled(input.campaignId) && intended && input.authorKind !== 'dm') authorizePublication(input.campaignId, input.authorUserId, intended);
    return publishEntity('note', raw.insertNote(data), scope ? { scope } : {});
  })();
}
export function updateNote(noteId: string, patch: Parameters<typeof raw.updateNote>[1]): Note | null {
  return getDatabase().transaction(() => {
    const result = raw.updateNote(noteId, patch);
    return result ? publishEntity('note', result) : null;
  })();
}
export function deleteNote(noteId: string): boolean {
  return getDatabase().transaction(() => {
    const previous = raw.getNoteById(noteId);
    if (!previous) return false;
    tombstoneEntity('note', previous);
    return raw.deleteNote(noteId);
  })();
}
export function registerUnversionedNotes(campaignId: string) {
  if (!spatialEnabled(campaignId)) return;
  const store = domainStore();
  const ids = getDatabase().prepare('SELECT id FROM campaign_notes WHERE campaign_id=?').all(campaignId) as { id: string }[];
  for (const { id } of ids) if (!store.has(campaignId, 'note', id)) {
    const value = raw.getNoteById(id);
    if (value) publishEntity('note', value, { scope: { kind: 'dm' } });
  }
}
export function listNotesVisibleTo(campaignId: string, userId: string, lead: boolean): Note[] {
  if (!spatialEnabled(campaignId)) return raw.listNotesVisibleTo(campaignId, userId, lead);
  registerUnversionedNotes(campaignId);
  return visibleEntities<Note>(campaignId, userId, 'note', { limit: 1000 })
    .filter(note => (note.visibility === 'public' && note.status === 'active') || note.authorUserId === userId || (lead && note.status === 'pending'))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.seq - a.seq);
}
