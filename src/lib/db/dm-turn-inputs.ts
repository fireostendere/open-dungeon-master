import { getDatabase } from "@/lib/db/core";

// Separate additive table keeps old turn rows and backups readable. It is
// created on access, including in databases upgraded from pre-watermark builds.
function database() {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS dm_turn_inputs (
    turn_id TEXT PRIMARY KEY REFERENCES dm_turns(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    input_seq INTEGER NOT NULL CHECK (input_seq >= 0)
  ); CREATE INDEX IF NOT EXISTS idx_dm_turn_inputs_campaign ON dm_turn_inputs(campaign_id);`);
  return db;
}

export function rememberTurnInput(turnId: string, campaignId: string, inputSeq: number): void {
  database().prepare(`INSERT INTO dm_turn_inputs (turn_id, campaign_id, input_seq) VALUES (?, ?, ?)`)
    .run(turnId, campaignId, inputSeq);
}

export function completedInputSeq(campaignId: string): number | null {
  const row = database().prepare(`
    SELECT MAX(i.input_seq) AS seq FROM dm_turn_inputs i
    JOIN dm_turns t ON t.id = i.turn_id AND t.campaign_id = i.campaign_id
    WHERE i.campaign_id = ? AND t.status = 'done'
  `).get(campaignId) as { seq: number | null };
  return row.seq;
}
