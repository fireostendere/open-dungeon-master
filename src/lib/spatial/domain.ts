import { getDatabase } from '@/lib/db/core';
import { allocateSeq, getCampaignById, listMembers } from '@/lib/db/campaigns';
import { listSheets } from '@/lib/db/sheets';
import { spatialContext, spatialEnabled, spatialStore } from '@/lib/spatial/service';
import { createDomainStore, DomainError, type DomainType, type DomainOptions } from '@/lib/spatial/domain-store.mjs';
import { currentPublicationScope, type PublicationScope } from '@/lib/spatial/publication-scope.mjs';

export { DomainError } from '@/lib/spatial/domain-store.mjs';
export type { DomainType } from '@/lib/spatial/domain-store.mjs';
export function domainStore() {
  spatialStore();
  return createDomainStore(getDatabase(), {
    nextSeq: allocateSeq,
    actorFor: (campaignId, userId) => {
      try { return spatialContext(campaignId, userId).actor; } catch { return null; }
    },
  });
}
function dmId(campaignId: string): string {
  const id = getCampaignById(campaignId)?.dmUserId;
  if (!id) throw new DomainError('This campaign has no DM seat.', 409);
  return id;
}
function ownerRoom(campaignId: string, userId: string): string | null {
  const row = getDatabase().prepare('SELECT room_id FROM spatial_presence WHERE campaign_id=? AND user_id=?')
    .get(campaignId, userId) as { room_id: string } | undefined;
  return row?.room_id ?? null;
}
function defaults(campaignId: string, type: DomainType, value: Record<string, unknown>): DomainOptions {
  const context = currentPublicationScope(campaignId);
  if (type === 'note') {
    const author = typeof value.authorUserId === 'string' ? value.authorUserId : null;
    if (value.visibility === 'private') return { scope: { kind: 'dm' }, ownerUserId: author, dmVisible: false };
    const roomId = author && value.authorKind !== 'dm' ? ownerRoom(campaignId, author) : null;
    // Authorship is not a subscription to future shared-room edits.
    return { scope: context ?? (roomId ? { kind: 'room', roomId } : { kind: 'dm' }), ownerUserId: null };
  }
  if (type === 'fact') {
    if (value.knownBy === 'dm') return { scope: { kind: 'dm' }, allowedUserIds: [] };
    if (Array.isArray(value.knownBy)) {
      const characterIds = new Set(value.knownBy);
      const userIds = [...new Set(listSheets(campaignId).filter(sheet => characterIds.has(sheet.id)).map(sheet => sheet.userId))];
      return { scope: context ?? { kind: 'users', userIds }, allowedUserIds: userIds };
    }
    return { scope: context ?? { kind: 'dm' } };
  }
  return { scope: { kind: 'dm' } };
}
export function publishEntity<T extends { id: string; campaignId: string }>(type: DomainType, value: T, options: DomainOptions = {}): T {
  if (!spatialEnabled(value.campaignId)) return value;
  const store = domainStore();
  const fresh = !store.has(value.campaignId, type, value.id);
  const base = fresh ? defaults(value.campaignId, type, value as T & Record<string, unknown>) : {};
  const raw = value as T & Record<string, unknown>;
  const access: DomainOptions = {};
  if (type === 'note') {
    const author = typeof raw.authorUserId === 'string' ? raw.authorUserId : null;
    const member = author ? listMembers(value.campaignId).some(member => member.userId === author) : false;
    const personal = raw.visibility === 'private' || raw.status === 'pending' && raw.authorKind !== 'dm';
    access.ownerUserId = personal && member ? author : null;
    if (raw.visibility === 'private') {
      access.scope = { kind: 'dm' }; access.dmVisible = false; access.allowedUserIds = [];
    } else {
      access.dmVisible = true;
      access.allowedUserIds = raw.status === 'pending' ? (personal && member && author ? [author] : []) : null;
    }
  }
  if (type === 'fact') {
    if (raw.knownBy === 'dm') access.allowedUserIds = [];
    else if (Array.isArray(raw.knownBy)) {
      const ids = new Set(raw.knownBy);
      access.allowedUserIds = [...new Set(listSheets(value.campaignId).filter(sheet => ids.has(sheet.id)).map(sheet => sheet.userId))];
    }
  }
  store.publish(value.campaignId, dmId(value.campaignId), type, value.id, value, { ...base, ...options, ...access });
  return value;
}
export function tombstoneEntity<T extends { id: string; campaignId: string }>(type: DomainType, value: T) { return publishEntity(type, value, { deleted: true }); }
export function visibleEntity<T>(campaignId: string, userId: string, type: DomainType, id: string): T | null {
  const row = domainStore().read(campaignId, userId, type, id);
  return row && !row.deleted ? row.data as T : null;
}
export function visibleEntities<T>(campaignId: string, userId: string, type: DomainType,
  options: { query?: string; roomId?: string | null; limit?: number } = {}): T[] {
  return domainStore().list(campaignId, userId, type, options).map(row => row.data as T);
}
export function requireCurrentEntity(campaignId: string, userId: string, type: DomainType, id: string) {
  if (!spatialEnabled(campaignId)) return;
  const store = domainStore();
  const mine = store.read(campaignId, userId, type, id);
  if (!mine || mine.deleted) throw new DomainError('Entity not found.', 404);
  const latest = store.metadata(campaignId, dmId(campaignId), type, id);
  if (!latest) {
    const value = mine.data as { authorUserId?: string };
    if (type === 'note' && value.authorUserId === userId) return;
    throw new DomainError('Entity not found.', 404);
  }
  if (latest.version !== mine.version) throw new DomainError('Only a remembered version is available. Observe the entity again before editing.', 409);
}
export function authorizePublication(campaignId: string, userId: string, scope: PublicationScope): PublicationScope {
  const { actor } = spatialContext(campaignId, userId);
  if (scope.kind === 'global') return scope;
  if (scope.kind === 'room') {
    const view = spatialStore().view(actor);
    if (!view.enabled || !view.rooms.some(room => room.id === scope.roomId) || (!actor.isDm && view.current?.roomId !== scope.roomId)) {
      throw new DomainError('You cannot publish into that location.', 403);
    }
    return scope;
  }
  if (scope.kind === 'users') {
    if (scope.userIds.some(id => !actor.playerIds.includes(id)) || (!actor.isDm && scope.userIds.some(id => id !== userId))) throw new DomainError('Invalid private recipients.', 403);
    return scope;
  }
  if (!actor.isDm) throw new DomainError('Only the DM can publish a DM-only entity.', 403);
  return scope;
}
