import type { SqlDatabase } from './ask-queue.mjs';
export class IngressLimit extends Error { status: number; retryAfter: number; }
export function consumeIngress(db: SqlDatabase, campaignId: string, userId: string, channel: 'ask'|'whisper'|'action', now?: number): void;
