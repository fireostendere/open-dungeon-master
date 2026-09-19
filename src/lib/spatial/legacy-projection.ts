import type { Chapter } from '@/lib/db/chapters';
import type { WorldFact } from '@/lib/db/facts';
import type { Note } from '@/lib/db/notes';
import type { SpatialActor } from '@/lib/spatial/store.mjs';
import { spatialContext, spatialEnabled, spatialStore } from '@/lib/spatial/service';
import { visibleEntity } from '@/lib/spatial/domain';
import { listChaptersVisibleTo } from '@/lib/db/chapters';

export type SpatialLegacyPolicy =
  | { scoped: false; ownedCharacterIds: string[] }
  | { scoped: true; startSeq: number; actor: SpatialActor; ownedCharacterIds: string[]; userId: string };
export function spatialLegacyPolicy(input: { campaignId: string; userId: string; adjudicates: boolean; ownedCharacterIds: string[] }): SpatialLegacyPolicy {
  if (!spatialEnabled(input.campaignId)) return { scoped: false, ownedCharacterIds: input.ownedCharacterIds };
  const { actor } = spatialContext(input.campaignId, input.userId);
  const view = spatialStore().view(actor);
  if (actor.isDm || !view.enabled) return { scoped: false, ownedCharacterIds: input.ownedCharacterIds };
  return { scoped: true, startSeq: view.startSeq, actor, ownedCharacterIds: input.ownedCharacterIds, userId: input.userId };
}
export function projectSpatialCampaign<T extends {
  scene: string; questLog: string[]; floor: unknown; dmCover: unknown;
  party?: { location: string; activity: string; marchingOrder: string[] };
}>(policy: SpatialLegacyPolicy, campaign: T): T {
  if (!policy.scoped) return campaign;
  return { ...campaign, scene: '', questLog: [], floor: { mode: 'open' }, dmCover: null,
    ...(campaign.party ? { party: { ...campaign.party, location: '', activity: '', marchingOrder: [] } } : {}) } as T;
}
export function projectSpatialRolls<T extends { characterId: string | null }>(policy: SpatialLegacyPolicy, rolls: T[]): T[] {
  if (!policy.scoped) return rolls;
  const owned = new Set(policy.ownedCharacterIds);
  return rolls.filter(roll => typeof roll.characterId === 'string' && owned.has(roll.characterId));
}
export function projectSpatialFacts(policy: SpatialLegacyPolicy, facts: WorldFact[]): WorldFact[] {
  if (!policy.scoped) return facts;
  return facts.map(fact => visibleEntity<WorldFact>(policy.actor.campaignId, policy.userId, 'fact', fact.id))
    .filter((fact): fact is WorldFact => fact !== null && fact.status === 'active');
}
export function projectSpatialNotes(policy: SpatialLegacyPolicy, notes: Note[]): Note[] {
  if (!policy.scoped) return notes;
  return notes.map(note => visibleEntity<Note>(policy.actor.campaignId, policy.userId, 'note', note.id))
    .filter((note): note is Note => note !== null);
}
export function projectSpatialChapters(policy: SpatialLegacyPolicy, chapters: Chapter[]): Chapter[] {
  return policy.scoped ? listChaptersVisibleTo(policy.actor.campaignId, policy.userId) : chapters;
}
export function projectSpatialOwnedRows<T extends { characterId: string }>(policy: SpatialLegacyPolicy, rows: T[]): T[] {
  if (!policy.scoped) return rows;
  return rows.filter(row => policy.ownedCharacterIds.includes(row.characterId));
}
export function projectSpatialUserRows<T extends { userId: string }>(policy: SpatialLegacyPolicy, rows: T[]): T[] {
  return policy.scoped ? rows.filter(row => row.userId === policy.userId) : rows;
}
