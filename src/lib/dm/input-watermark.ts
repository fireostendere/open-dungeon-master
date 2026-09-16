import { getDatabase } from "@/lib/db/core";

type InputMessage = {
  seq: number;
  authorType: string;
};

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS dm_input_watermarks (
      campaign_id TEXT PRIMARY KEY,
      max_input_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

export function maxDmInputSeq(messages: readonly InputMessage[]): number {
  let max = 0;
  for (const message of messages) {
    // DM/system messages are outputs/bookkeeping. Everything else is an
    // inbound table action that a DM turn must cover exactly once.
    if (message.authorType === "dm" || message.authorType === "system") continue;
    if (Number.isInteger(message.seq) && message.seq > max) max = message.seq;
  }
  return max;
}

export function getDmInputWatermark(campaignId: string): number {
  ensureSchema();
  const row = getDatabase()
    .prepare("SELECT max_input_seq FROM dm_input_watermarks WHERE campaign_id = ?")
    .get(campaignId) as { max_input_seq: number } | undefined;
  return row?.max_input_seq ?? 0;
}

export function markDmInputsIncluded(campaignId: string, maxInputSeq: number): void {
  if (!Number.isInteger(maxInputSeq) || maxInputSeq <= 0) return;
  ensureSchema();
  getDatabase()
    .prepare(`
      INSERT INTO dm_input_watermarks (campaign_id, max_input_seq, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        max_input_seq = MAX(dm_input_watermarks.max_input_seq, excluded.max_input_seq),
        updated_at = excluded.updated_at
    `)
    .run(campaignId, maxInputSeq, new Date().toISOString());
}
