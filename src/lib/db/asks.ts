import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { AskCitation, AskScope, AskVisibility } from "@/lib/dm/ask-logic";

// Ask questions are not story messages. Only permitted readers receive rows;
// notifications contain no question/answer and private notifications are targeted.
export type CampaignAsk = {
  id: string;
  campaignId: string;
  userId: string;
  characterId: string | null;
  visibility: AskVisibility;
  scope: AskScope;
  question: string;
  answer: string;
  citations: AskCitation[];
  status: "answered" | "failed";
  createdAt: string;
};
type AskRow = {
  id: string; campaign_id: string; user_id: string; character_id: string | null;
  visibility: AskVisibility; scope: AskScope; question: string; answer: string;
  citations_json: string; status: "answered" | "failed"; created_at: string;
};
function mapAsk(row: AskRow): CampaignAsk {
  return { id: row.id, campaignId: row.campaign_id, userId: row.user_id,
    characterId: row.character_id, visibility: row.visibility, scope: row.scope,
    question: row.question, answer: row.answer,
    citations: parseJson<AskCitation[]>(row.citations_json, []), status: row.status, createdAt: row.created_at };
}
export function insertAsk(input: {
  campaignId: string; userId: string; characterId: string | null;
  visibility: AskVisibility; scope: AskScope; question: string; answer: string;
  citations: AskCitation[]; status: "answered" | "failed";
}): CampaignAsk {
  const id = crypto.randomUUID();
  const db = getDatabase();
  db.prepare(`INSERT INTO campaign_asks
    (id, campaign_id, user_id, character_id, visibility, scope, question, answer, citations_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.campaignId, input.userId,
      input.characterId, input.visibility, input.scope, input.question, input.answer,
      JSON.stringify(input.citations), input.status, nowIso());
  return mapAsk(db.prepare(`SELECT * FROM campaign_asks WHERE id = ?`).get(id) as AskRow);
}
// Only the asker's own rows and table-visible rows are public to a member.
export function listAsksForUser(campaignId: string, userId: string, limit = 100): CampaignAsk[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_asks
    WHERE campaign_id = ? AND (user_id = ? OR visibility = 'table')
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(campaignId, userId, limit) as AskRow[];
  return rows.reverse().map(mapAsk);
}
export function listRecentAsksForThread(campaignId: string, userId: string, limit = 6): CampaignAsk[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_asks
    WHERE campaign_id = ? AND user_id = ? AND status = 'answered'
    ORDER BY created_at DESC, id DESC LIMIT ?`).all(campaignId, userId, limit) as AskRow[];
  return rows.reverse().map(mapAsk);
}

// Scope both the write and read to the validated campaign. A known ask UUID
// from a different campaign must never be usable as a cross-campaign write.
export function answerAsk(campaignId: string, askId: string, answer: string, citations: AskCitation[] = []): CampaignAsk | null {
  const db = getDatabase();
  return db.transaction(() => {
    const info = db.prepare(`UPDATE campaign_asks SET answer = ?, citations_json = ?, status = 'answered'
      WHERE id = ? AND campaign_id = ?`).run(answer, JSON.stringify(citations), askId, campaignId);
    if (info.changes === 0) return null;
    const row = db.prepare(`SELECT * FROM campaign_asks WHERE id = ? AND campaign_id = ?`).get(askId, campaignId) as AskRow | undefined;
    return row ? mapAsk(row) : null;
  })();
}
// Trusted DM/operator surface only, not the ordinary member GET route.
export function listAsksForCampaign(campaignId: string, limit = 20): CampaignAsk[] {
  const rows = getDatabase().prepare(`SELECT * FROM campaign_asks
    WHERE campaign_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(campaignId, limit) as AskRow[];
  return rows.reverse().map(mapAsk);
}
