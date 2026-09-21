import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { AskCitation, AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import { ASK_SELECT, checkAskCapacity, ensureAskQueue, registerAsk, listPendingAsks, pendingAskQueueMeta, answerQueuedAsk } from "@/lib/db/ask-queue.mjs";
export { AskQueueConflict, AskQueueFull } from "@/lib/db/ask-queue.mjs";

export type CampaignAsk = {
  id: string; campaignId: string; userId: string; characterId: string | null;
  visibility: AskVisibility; scope: AskScope; question: string; answer: string;
  citations: AskCitation[]; status: "pending" | "answered" | "failed";
  version: number; queueSeq: number | null; answeredBy: string | null;
  answeredAt: string | null; createdAt: string;
};
type AskRow = {
  id: string; campaign_id: string; user_id: string; character_id: string | null;
  visibility: AskVisibility; scope: AskScope; question: string; answer: string;
  citations_json: string; status: "answered" | "failed"; created_at: string;
  queue_state?: CampaignAsk["status"]; answer_version?: number; queue_seq?: number;
  answered_by?: string | null; answered_at?: string | null;
};
function mapAsk(row: AskRow): CampaignAsk {
  return { id: row.id, campaignId: row.campaign_id, userId: row.user_id,
    characterId: row.character_id, visibility: row.visibility, scope: row.scope,
    question: row.question, answer: row.answer, citations: parseJson<AskCitation[]>(row.citations_json, []),
    status: row.queue_state ?? row.status, version: row.answer_version ?? 1,
    queueSeq: row.queue_seq ?? null, answeredBy: row.answered_by ?? null,
    answeredAt: row.answered_at ?? null, createdAt: row.created_at };
}
function preparedDatabase() {
  const db = getDatabase(); ensureAskQueue(db); return db;
}
export function insertAsk(input: {
  campaignId: string; userId: string; characterId: string | null;
  visibility: AskVisibility; scope: AskScope; question: string; answer: string;
  citations: AskCitation[]; status: CampaignAsk["status"];
}): CampaignAsk {
  const db = preparedDatabase();
  return db.transaction(() => {
    if (input.status === "pending") checkAskCapacity(db, input.campaignId, input.userId);
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO campaign_asks
      (id, campaign_id, user_id, character_id, visibility, scope, question, answer, citations_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.campaignId, input.userId,
        input.characterId, input.visibility, input.scope, input.question, input.answer,
        JSON.stringify(input.citations), input.status === "pending" ? "answered" : input.status, nowIso());
    registerAsk(db, id, input.campaignId, input.status);
    return mapAsk(db.prepare(`${ASK_SELECT} WHERE a.id = ?`).get(id) as AskRow);
  })();
}
function boundedLimit(limit: number, max = 100) {
  return Number.isSafeInteger(limit) ? Math.max(1, Math.min(max, limit)) : max;
}
export function listAsksForUser(campaignId: string, userId: string, limit = 100): CampaignAsk[] {
  const rows = preparedDatabase().prepare(`${ASK_SELECT}
    WHERE a.campaign_id = ? AND (a.user_id = ? OR a.visibility = 'table')
    ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(campaignId, userId, boundedLimit(limit)) as AskRow[];
  return rows.reverse().map(mapAsk);
}
export function listRecentAsksForThread(campaignId: string, userId: string, limit = 6): CampaignAsk[] {
  const rows = preparedDatabase().prepare(`${ASK_SELECT}
    WHERE a.campaign_id = ? AND a.user_id = ? AND COALESCE(q.state, a.status) = 'answered'
    ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(campaignId, userId, boundedLimit(limit)) as AskRow[];
  return rows.reverse().map(mapAsk);
}
export function pendingAsksForCampaign(campaignId: string) {
  return pendingAskQueueMeta(getDatabase(), campaignId);
}
export function listPendingAsksForCampaign(campaignId: string, after = 0, limit = 20) {
  const page = listPendingAsks(getDatabase(), campaignId, after, limit);
  return { ...page, items: (page.items as AskRow[]).map(mapAsk) };
}
export function answerAsk(campaignId: string, askId: string, answer: string, citations: AskCitation[] = [],
  options: { expectedVersion?: number; commandId?: string; author?: string } = {}): CampaignAsk | null {
  const result = answerQueuedAsk(getDatabase(), { campaignId, askId, answer, citations, ...options, now: nowIso() });
  return result ? mapAsk(result.row as AskRow) : null;
}
// Trusted DM/operator surface only; ordinary members use listAsksForUser.
export function listAsksForCampaign(campaignId: string, limit = 20): CampaignAsk[] {
  const rows = preparedDatabase().prepare(`${ASK_SELECT}
    WHERE a.campaign_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(campaignId, boundedLimit(limit)) as AskRow[];
  return rows.reverse().map(mapAsk);
}
