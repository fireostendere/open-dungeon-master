import type { SqliteDatabase } from "../db/driver";
export type SpatialActor = { campaignId: string; userId: string; isDm: boolean; memberIds: string[]; playerIds: string[] };
export type SpatialMessage = { id: string; roomId: string | null; seq: number; kind: "say" | "do" | "narration" | "perception" | "ooc"; authorUserId: string | null; content: string; createdAt: string };
export type SpatialRoom = { id: string; name: string; active: boolean; occupants: string[] };
export type SpatialPosition = { roomId: string; revision: number };
export type SpatialGrant = { id: string; userId: string; roomId: string; mode: "speech" | "scry"; expiresAt: string };
export type SpatialView = { enabled: false } | { enabled: true; startSeq: number; current: SpatialPosition | null; rooms: SpatialRoom[]; exits: { id: string; name: string }[]; grants: SpatialGrant[]; isDm: boolean };
export type SpatialPage = { messages: SpatialMessage[]; nextBefore: number | null };
export type SpatialNarratorMessage = SpatialMessage & { witnessUserIds: string[] };
export type SpatialNarratorRead = Extract<SpatialView, { enabled: true }> & { messages: SpatialNarratorMessage[]; nextCursor: number; hasMore: boolean };
export type SpatialStore = {
  enabled(campaignId: string): boolean;
  command(actor: SpatialActor, requestId: string, operation: string, input: Record<string, unknown>): Record<string, unknown>;
  view(actor: SpatialActor): SpatialView;
  messages(actor: SpatialActor, options?: { roomId?: string | null; beforeSeq?: number; limit?: number }): SpatialPage;
  narratorRead(actor: SpatialActor, options?: { afterSeq?: number; limit?: number }): SpatialNarratorRead;
};
export class SpatialError extends Error { status: number; constructor(message: string, status?: number); }
export const SPATIAL_SCHEMA: string;
export function createSpatialStore(db: SqliteDatabase, options: { nextSeq: (campaignId: string) => number; now?: () => string; uuid?: () => string }): SpatialStore;
