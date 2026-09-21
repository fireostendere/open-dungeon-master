export type SqlDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number | bigint };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): () => T;
};
export class AskQueueConflict extends Error { status: number; }
export class AskQueueFull extends Error { status: number; }
export const ASK_SELECT: string;
export function ensureAskQueue(db: SqlDatabase): void;
export function registerAsk(db: SqlDatabase, askId: string, campaignId: string, state: 'pending'|'answered'|'failed'): void;
export function pendingAskQueueMeta(db: SqlDatabase, campaignId: string): { pending: boolean };
export function listPendingAsks(db: SqlDatabase, campaignId: string, after?: number, limit?: number): { items: unknown[]; nextCursor: number; hasMore: boolean };
export function checkAskCapacity(db: SqlDatabase, campaignId: string, userId: string): void;
export function answerQueuedAsk(db: SqlDatabase, input: { campaignId: string; askId: string; answer: string; citations?: unknown[]; expectedVersion?: number; commandId?: string; author?: string; now?: string }): { row: unknown; replayed: boolean } | null;
export function newAskId(): string;
