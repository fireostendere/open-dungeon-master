import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/db/core";

/** A rewind publishes campaign_rewound after restoring rows. Its persisted
 * receipt distinguishes timelines even if their sequence counters coincide.
 * This is deliberately read from the authoritative DB, never process memory.
 */
export function campaignTimelineEpoch(campaignId: string): string {
  const row = getDatabase().prepare(`SELECT seq, created_at, payload_json FROM campaign_events
    WHERE campaign_id=? AND type='campaign_rewound' ORDER BY seq DESC LIMIT 1`).get(campaignId) as
    { seq: number; created_at: string; payload_json: string } | undefined;
  return createHash("sha256").update(JSON.stringify([campaignId, row ?? "initial"])).digest("hex");
}
