import { getDatabase, nowIso } from "@/lib/db/core";

export type NarratorReceipt = {
  commandId: string;
  receiptId: string;
  fingerprint: string;
  operation: string;
  result: unknown;
  committedSeq: number;
};
type ReceiptRow = {
  command_id: string; receipt_id: string; fingerprint: string; operation: string;
  result_json: string; committed_seq: number;
};
function database() {
  const db = getDatabase();
  // Read schema objects, not a memoized schema_version that can repeat after rollback.
  const objects = db.prepare(`SELECT name FROM sqlite_master
    WHERE type IN ('table', 'index') AND name IN ('narrator_commands', 'narrator_commands_recent')`).all() as Array<{ name: string }>;
  const names = new Set(objects.map(({ name }) => name));
  if (!names.has("narrator_commands") || !names.has("narrator_commands_recent")) {
    db.exec(`CREATE TABLE IF NOT EXISTS narrator_commands (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    command_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    operation TEXT NOT NULL,
    result_json TEXT NOT NULL,
    committed_seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, command_id)
  ); CREATE INDEX IF NOT EXISTS narrator_commands_recent ON narrator_commands(campaign_id, committed_seq DESC);`);
  }
  return db;
}
export function getNarratorReceipt(campaignId: string, commandId: string): NarratorReceipt | null {
  const row = database().prepare("SELECT * FROM narrator_commands WHERE campaign_id = ? AND command_id = ?")
    .get(campaignId, commandId) as ReceiptRow | undefined;
  return row ? { commandId: row.command_id, receiptId: row.receipt_id, fingerprint: row.fingerprint,
    operation: row.operation, result: JSON.parse(row.result_json) as unknown, committedSeq: row.committed_seq } : null;
}
export function saveNarratorReceipt(campaignId: string, receipt: NarratorReceipt): void {
  database().prepare(`INSERT INTO narrator_commands
    (campaign_id, command_id, receipt_id, fingerprint, operation, result_json, committed_seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(campaignId, receipt.commandId, receipt.receiptId,
      receipt.fingerprint, receipt.operation, JSON.stringify(receipt.result), receipt.committedSeq, nowIso());
}
// Rewinds can delete/reuse a sequence. Never replay a historical receipt into
// a different timeline simply because its numeric sequence happens to match.
export function narratorReceiptInTimeline(campaignId: string, receipt: NarratorReceipt): boolean {
  const row = getDatabase().prepare("SELECT type, payload_json FROM campaign_events WHERE campaign_id = ? AND seq = ?")
    .get(campaignId, receipt.committedSeq) as { type: string; payload_json: string } | undefined;
  if (row?.type !== "narrator_command_completed") return false;
  const payload = JSON.parse(row.payload_json) as { receiptId?: unknown };
  return payload?.receiptId === receipt.receiptId;
}
export function listNarratorReceipts(campaignId: string, limit = 10) {
  return database().prepare(`SELECT command_id AS commandId, receipt_id AS receiptId,
    operation, committed_seq AS committedSeq FROM narrator_commands
    WHERE campaign_id = ? ORDER BY committed_seq DESC LIMIT ?`).all(campaignId, Math.min(20, Math.max(1, limit))) as
      Array<{ commandId: string; receiptId: string; operation: string; committedSeq: number }>;
}
