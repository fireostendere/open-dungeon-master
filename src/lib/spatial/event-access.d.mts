import type { SqliteDatabase } from '../db/driver';
export type EventActor = { userId: string; member: boolean; isDm: boolean; ownedCharacterIds: string[]; roomId: string | null };
export type EventScope = { kind: 'global' | 'dm' } | { kind: 'room'; roomId: string } | { kind: 'users'; userIds: string[] };
export type EventView = { seq: number; type: string; payload: unknown };
export const EVENT_ACCESS_SCHEMA: string;
export function publicationView(type: string, payload: unknown, actor: EventActor, scope?: EventScope | null): unknown;
export function createEventAccess(db: SqliteDatabase): {
  capture(campaignId: string, event: EventView, actors: EventActor[], scope?: EventScope | null): void;
  project(campaignId: string, event: EventView, actor: EventActor, options?: { enabled?: boolean; startSeq?: number }): EventView;
};
export function decodeEventChunk(chunk: string): { seq?: number; type: string; payload: unknown } | null;
export function ephemeralView(type: string, payload: unknown, actor: EventActor, enabled: boolean): { type: string; payload: unknown } | null;
