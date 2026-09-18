import type { Chapter } from "@/lib/db/chapters";
import type { WorldFact } from "@/lib/db/facts";
import type { Note } from "@/lib/db/notes";
import type { SpatialActor } from "@/lib/spatial/store.mjs";
import { spatialContext, spatialEnabled, spatialStore } from "@/lib/spatial/service";

export type SpatialLegacyPolicy =
  | { scoped: false; ownedCharacterIds: string[] }
  | { scoped: true; startSeq: number; actor: SpatialActor; ownedCharacterIds: string[]; userId: string };

export function spatialLegacyPolicy(input: {
  campaignId: string; userId: string; adjudicates: boolean; ownedCharacterIds: string[];
}): SpatialLegacyPolicy {
  if (input.adjudicates || !spatialEnabled(input.campaignId)) return { scoped: false, ownedCharacterIds: input.ownedCharacterIds };
  const { actor } = spatialContext(input.campaignId, input.userId);
  const view = spatialStore().view(actor);
  if (!view.enabled) return { scoped: false, ownedCharacterIds: input.ownedCharacterIds };
  return { scoped: true, startSeq: view.startSeq, actor, ownedCharacterIds: input.ownedCharacterIds, userId: input.userId };
}

export function projectSpatialCampaign<T extends {
  scene: string; questLog: string[]; floor: unknown; dmCover: unknown;
  party?: { location: string; activity: string; marchingOrder: string[] };
}>(policy: SpatialLegacyPolicy, campaign: T): T {
  if (!policy.scoped) return campaign;
  return {
    ...campaign, scene: "", questLog: [], floor: { mode: "open" }, dmCover: null,
    ...(campaign.party ? { party: { ...campaign.party, location: "", activity: "", marchingOrder: [] } } : {}),
  } as T;
}

export function projectSpatialRolls<T extends { characterId: string | null }>(policy: SpatialLegacyPolicy, rolls: T[]): T[] {
  if (!policy.scoped) return rolls;
  const owned = new Set(policy.ownedCharacterIds);
  return rolls.filter((roll) => typeof roll.characterId === "string" && owned.has(roll.characterId));
}

export function projectSpatialFacts(policy: SpatialLegacyPolicy, facts: WorldFact[]): WorldFact[] {
  if (!policy.scoped) return facts;
  const owned = new Set(policy.ownedCharacterIds);
  return facts.filter((fact) => {
    if (fact.knownBy === "dm") return false;
    if (Array.isArray(fact.knownBy)) return fact.knownBy.some((characterId) => owned.has(characterId));
    if (fact.source === "manual") return true;
    if (fact.sourceSeq !== null && fact.sourceSeq < policy.startSeq) return true;
    if (fact.sourceSeq === null) return false;
    return spatialStore().canReadSeq(policy.actor, fact.sourceSeq) === true;
  });
}

export function projectSpatialNotes(policy: SpatialLegacyPolicy, notes: Note[]): Note[] {
  if (!policy.scoped) return notes;
  return notes.filter((note) => {
    if (note.authorUserId === policy.userId) return true;
    if (note.seq < policy.startSeq) return true;
    return note.authorKind === "user" && note.characterId === null && note.visibility === "public";
  });
}

export function projectSpatialChapters(policy: SpatialLegacyPolicy, chapters: Chapter[]): Chapter[] {
  if (!policy.scoped) return chapters;
  return chapters.filter((chapter) => chapter.seqEnd !== null && chapter.seqEnd < policy.startSeq);
}

export function projectSpatialOwnedRows<T extends { characterId: string }>(policy: SpatialLegacyPolicy, rows: T[]): T[] {
  if (!policy.scoped) return rows;
  const owned = new Set(policy.ownedCharacterIds);
  return rows.filter((row) => owned.has(row.characterId));
}

export function projectSpatialUserRows<T extends { userId: string }>(policy: SpatialLegacyPolicy, rows: T[]): T[] {
  if (!policy.scoped) return rows;
  return rows.filter((row) => row.userId === policy.userId);
}
