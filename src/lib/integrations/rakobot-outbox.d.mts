import type { SqliteDatabase } from '../db/driver';
export type ActionSource = 'legacy' | 'spatial';
export type ActionKind = 'do' | 'say';
export type OutboxRecord = { id: number; anchor: string; campaign_id: string; source: ActionSource;
  message_id: string; kind: ActionKind; public_at_creation: number; fingerprint: string };
export type FeedEvent = { campaignId: string; campaignTitle: string; messageId: string;
  playerName: string; characterName: string; kind: ActionKind; quote: string };
export type Cursor = { stream: string; id: number; anchor: string };
export class FeedConflict extends Error {}
export const OUTBOX_SCHEMA: string;
export function feedConfig(env?: NodeJS.ProcessEnv): { token: string; campaigns: Set<string> } | null;
export function authorizedFeed(header: string | null, token: string): boolean;
export function actionFingerprint(userId: string, content: string): string;
export function visibleToWholeParty(memberIds: string[], recipientIds: string[], stealth?: boolean): boolean;
export function createActionOutbox(db: Pick<SqliteDatabase, 'prepare' | 'exec'>): {
  enqueue(input: { campaignId: string; source: ActionSource; messageId: string; kind: ActionKind;
    publicAtCreation: boolean; fingerprint: string }): void;
  head(): { stream: string; cursor: { id: number; anchor: string } };
  page(cursor: Cursor, project: (row: OutboxRecord) => FeedEvent | null, limit?: number): {
    stream: string; entries: { id: number; anchor: string; event: FeedEvent | null }[];
  };
};
