import { getDatabase } from "@/lib/db/core";
import { currentFight } from "@/lib/spatial/publication-scope.mjs";

// Without rooms every fight keeps its own floor on its encounter row and the
// campaign floor is the table's (global turn, spotlight, holds). The fight a
// floor read, write or floor_changed event means: the scoped one, or with no
// scope the only fight running, so a lone fight behaves exactly as before.
// null: the table. A leaf (db/core and the scope store only), because both
// db/campaigns and the event bus ask it.
export function floorFightId(campaignId: string): string | null {
  const scoped = currentFight(campaignId);
  if (scoped !== undefined) return scoped;
  const rows = getDatabase()
    .prepare(`SELECT id FROM encounters WHERE campaign_id = ? AND status = 'active' AND kind = 'fight' AND room_id IS NULL`)
    .all(campaignId) as Array<{ id: string }>;
  return rows.length === 1 ? rows[0].id : null;
}
