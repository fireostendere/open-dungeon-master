import type { SqliteDatabase } from '../db/driver';
import type { SpatialActor } from './store.mjs';
import type { PublicationScope } from './publication-scope.mjs';
export type DomainType = 'note' | 'fact' | 'chapter';
export type DomainProjection = { id: string; version: number; seq: number; roomId: string | null; deleted: boolean; data: unknown };
export type DomainOptions = { scope?: PublicationScope; ownerUserId?: string | null; allowedUserIds?: string[] | null; dmVisible?: boolean; deleted?: boolean; expectedVersion?: number };
export class DomainError extends Error { status: number; constructor(message: string, status?: number); }
export const DOMAIN_FORMAT: string;
export const DOMAIN_TYPES: readonly DomainType[];
export function createDomainStore(db: SqliteDatabase, options: { nextSeq: (campaignId: string) => number; actorFor: (campaignId: string, userId: string) => SpatialActor | null }): {
  has(campaignId: string, type: DomainType, id: string): boolean;
  metadata(campaignId: string, dmUserId: string, type: DomainType, id: string): (DomainProjection & DomainOptions) | null;
  publish(campaignId: string, dmUserId: string, type: DomainType, id: string, data: unknown, options?: DomainOptions): DomainProjection;
  read(campaignId: string, userId: string, type: DomainType, id: string, options?: { observe?: boolean }): DomainProjection | null;
  list(campaignId: string, userId: string, type: DomainType, options?: { query?: string; roomId?: string | null; limit?: number }): DomainProjection[];
  observe(campaignId: string, dmUserId: string, type: DomainType, id: string, userIds: string[], expectedVersion: number): { id: string; version: number };
};
