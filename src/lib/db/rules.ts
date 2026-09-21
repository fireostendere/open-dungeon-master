import { getDatabase, nowIso } from "@/lib/db/core";
import {
  HOUSE_RULES_MAX,
  carryChunkFlags,
  chunkHouseRules,
} from "@/lib/dm/rules-logic";

// Rules manager storage: campaigns.house_rules_text is the lead-edited
// source of truth; rule_chunks holds deterministic lexical retrieval pieces.

export type RuleChunk = {
  id: string;
  campaignId: string;
  chunkIndex: number;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
  // Words that force this chunk into the prompt when they appear.
  triggerKeywords: string;
  createdAt: string;
  updatedAt: string;
};

type RuleChunkRow = {
  id: string;
  campaign_id: string;
  chunk_index: number;
  heading: string;
  text: string;
  enabled: number;
  pinned: number;
  trigger_keywords: string;
  created_at: string;
  updated_at: string;
};

const CHUNK_COLUMNS =
  "id, campaign_id, chunk_index, heading, text, enabled, pinned, trigger_keywords, created_at, updated_at";

function mapChunk(row: RuleChunkRow): RuleChunk {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    text: row.text,
    enabled: Boolean(row.enabled),
    pinned: Boolean(row.pinned),
    triggerKeywords: row.trigger_keywords ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getHouseRulesText(campaignId: string): string {
  const row = getDatabase()
    .prepare(`SELECT house_rules_text FROM campaigns WHERE id = ?`)
    .get(campaignId) as { house_rules_text: string } | undefined;
  return row?.house_rules_text ?? "";
}

export function listRuleChunks(campaignId: string): RuleChunk[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE campaign_id = ? ORDER BY chunk_index ASC`,
    )
    .all(campaignId) as RuleChunkRow[];
  return rows.map(mapChunk);
}

// Saves the house-rules text and rebuilds its chunks; enabled/pinned flags
// survive by heading or leading-text match.
export function setHouseRules(campaignId: string, text: string): RuleChunk[] {
  const db = getDatabase();
  const clipped = text.slice(0, HOUSE_RULES_MAX);
  const previous = listRuleChunks(campaignId);
  const drafts = carryChunkFlags(chunkHouseRules(clipped), previous);
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`UPDATE campaigns SET house_rules_text = ? WHERE id = ?`).run(clipped, campaignId);
    db.prepare(`DELETE FROM rule_chunks WHERE campaign_id = ?`).run(campaignId);
    const insert = db.prepare(
      `INSERT INTO rule_chunks (id, campaign_id, chunk_index, heading, text, enabled, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    drafts.forEach((draft, index) => {
      insert.run(
        crypto.randomUUID(),
        campaignId,
        index,
        draft.heading,
        draft.text,
        draft.enabled ? 1 : 0,
        draft.pinned ? 1 : 0,
        now,
        now,
      );
    });
  })();
  return listRuleChunks(campaignId);
}

export function setRuleChunkFlags(
  chunkId: string,
  flags: { enabled?: boolean; pinned?: boolean },
): RuleChunk | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE id = ?`)
    .get(chunkId) as RuleChunkRow | undefined;
  if (!row) {
    return null;
  }
  db.prepare(`UPDATE rule_chunks SET enabled = ?, pinned = ?, updated_at = ? WHERE id = ?`).run(
    flags.enabled === undefined ? row.enabled : flags.enabled ? 1 : 0,
    flags.pinned === undefined ? row.pinned : flags.pinned ? 1 : 0,
    nowIso(),
    chunkId,
  );
  const updated = db
    .prepare(`SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE id = ?`)
    .get(chunkId) as RuleChunkRow;
  return mapChunk(updated);
}

