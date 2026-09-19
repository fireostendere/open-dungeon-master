import type { SqliteDatabase } from '../db/driver';
import type { EventActor } from './event-access.mjs';
export type EntityScope = { kind: 'room' | 'global' | 'users'; roomId?: string; userIds?: string[]; dmCanRead?: boolean; restricted?: boolean; discover?: boolean };
export type EntityVersion = { payload: unknown; version: number; seq: number; roomId: string | null };
export const ENTITY_SCOPE_SCHEMA: string;
export function createEntityVersions(db: SqliteDatabase, options: { nextSeq: (campaignId: string) => number }): {
  scope(campaignId: string, type: string, id: string): EntityScope | null;
  latestPayload(campaignId: string, type: string, id: string): unknown;
  write(campaignId: string, type: string, id: string, payload: unknown, scope: EntityScope, actors: EventActor[]): { version: number; seq: number };
  read(campaignId: string, type: string, id: string, actor: EventActor, options?: { discover?: boolean }): EntityVersion | null;
  list(campaignId: string, type: string, actor: EventActor, options?: { discover?: boolean }): EntityVersion[];
  audience(campaignId: string, type: string, id: string, actors: EventActor[]): string[];
};
