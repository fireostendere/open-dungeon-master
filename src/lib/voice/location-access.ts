import { getDatabase } from "@/lib/db/core";
import { listMembers } from "@/lib/db/campaigns";
import { spatialStore } from "@/lib/spatial/service";
import type { VoiceAccess, VoiceScope } from "@/lib/voice/location-policy";

// A durable table-level preference, not a browser preference or a volatile
// breakout room. Lazy DDL matches the spatial store; ordinary DB backups keep it.
function database() {
  const db = getDatabase();
  db.prepare(`CREATE TABLE IF NOT EXISTS voice_chat_scopes (
    campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'location'))
  )`).run();
  return db;
}

export function getVoiceScope(campaignId: string): VoiceScope {
  const row = database().prepare("SELECT scope FROM voice_chat_scopes WHERE campaign_id = ?")
    .get(campaignId) as { scope: VoiceScope } | undefined;
  return row?.scope ?? "global";
}

// Call only after requireLead and transport validation in the scope route.
export function setVoiceScope(campaignId: string, scope: VoiceScope): void {
  database().prepare(`INSERT INTO voice_chat_scopes(campaign_id, scope) VALUES (?, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET scope = excluded.scope`).run(campaignId, scope);
}

export function voiceAccess(campaignId: string): VoiceAccess {
  const scope = getVoiceScope(campaignId);
  const members = new Set(listMembers(campaignId).map(member => member.userId));
  const rooms = new Map<string, string | null>();
  if (scope === "location") {
    const store = spatialStore();
    // Disabled/missing spatial state never falls back to a shared channel.
    if (store.enabled(campaignId)) {
      for (const userId of members) rooms.set(userId, store.getUserRoom(campaignId, userId));
    }
  }
  return { scope, members, rooms };
}
