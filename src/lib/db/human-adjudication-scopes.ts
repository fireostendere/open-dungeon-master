import { getDatabase } from "@/lib/db/core";
import { createDmTurn, getDmTurn, type DmTurn } from "@/lib/db/dm-turns";

// One bookkeeping turn per encounter/round/initiative position. Unlike a
// query for the "latest turn", the key survives another adjudication, a
// narration, a parked roll and a process restart without mixing combat turns.
export function scopedHumanTurn(campaignId: string, scope: string, preferred?: DmTurn): DmTurn {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS human_adjudication_scopes (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL,
    turn_id TEXT NOT NULL REFERENCES dm_turns(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, scope_key)
  )`);
  return db.transaction(() => {
    const row = db.prepare("SELECT turn_id FROM human_adjudication_scopes WHERE campaign_id = ? AND scope_key = ?")
      .get(campaignId, scope) as { turn_id: string } | undefined;
    const existing = row ? getDmTurn(row.turn_id) : null;
    if (existing?.campaignId === campaignId && existing.actor === "human_dm") return existing;
    const turn = preferred?.campaignId === campaignId && preferred.actor === "human_dm"
      ? preferred : createDmTurn(campaignId, [], "human_dm");
    db.prepare(`INSERT INTO human_adjudication_scopes (campaign_id, scope_key, turn_id) VALUES (?, ?, ?)
      ON CONFLICT (campaign_id, scope_key) DO UPDATE SET turn_id = excluded.turn_id`).run(campaignId, scope, turn.id);
    return turn;
  })();
}
