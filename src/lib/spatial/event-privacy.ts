import { getDatabase, parseJson } from "@/lib/db/core";
import { capsFor, getCampaignForUser, listMembers } from "@/lib/db/campaigns";

export type EventScope =
  | { kind: "dm" }
  | { kind: "global" }
  | { kind: "users"; userIds: string[] }
  | { kind: "room"; roomId: string };
export type EventAudience = { version: 1; userIds: string[] };
export type PrivateEvent = { seq?: number; type: string; payload: unknown; audience?: EventAudience | null };

function spatialActive(campaignId: string): boolean {
  const db = getDatabase();
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_campaigns'").get() &&
    db.prepare("SELECT 1 FROM spatial_campaigns WHERE campaign_id=?").get(campaignId));
}

/** Kept on the event row: rollback, rewind and backup cannot detach its audience. */
export function ensureEventAudienceColumn(): void {
  const db = getDatabase();
  // Do not memoize DDL that may be rolled back by an enclosing engine command.
  const columns = db.prepare("PRAGMA table_info(campaign_events)").all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === "audience_json")) db.exec("ALTER TABLE campaign_events ADD COLUMN audience_json TEXT");
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only server code supplies scope. Payload.roomId/userIds never grant access. */
export function captureEventAudience(campaignId: string, type: string, payload: unknown, scope?: EventScope): EventAudience | null {
  if (!spatialActive(campaignId) && !scope) return null;
  const members = listMembers(campaignId).map(member => member.userId);
  let recipients: string[] = [];
  if (scope?.kind === "global" || (!scope && ["presence", "campaign_updated", "campaign_rewound"].includes(type))) recipients = members;
  else if (scope?.kind === "users") recipients = scope.userIds;
  else if (scope?.kind === "room") {
    const rows = getDatabase().prepare("SELECT user_id FROM spatial_presence WHERE campaign_id=? AND room_id=?").all(campaignId, scope.roomId) as Array<{ user_id: string }>;
    recipients = rows.map(row => row.user_id);
  } else if (!scope && type === "sheet_updated") {
    // The sheet belongs to its owner; proximity is not permission to read a full sheet.
    const userId = record(record(payload).sheet).userId;
    if (typeof userId === "string") recipients = [userId];
  }
  return { version: 1, userIds: [...new Set(recipients)].filter(id => members.includes(id)).sort() };
}

export function decodeEventAudience(raw: string | null): EventAudience | null {
  const value = parseJson<unknown>(raw || "null", null);
  const candidate = record(value);
  if (candidate.version !== 1 || !Array.isArray(candidate.userIds) || candidate.userIds.some(id => typeof id !== "string")) return null;
  return { version: 1, userIds: candidate.userIds as string[] };
}

/** Shared by live fan-out and replay, before any public serialization. */
export function projectEventForUser(campaignId: string, userId: string, event: PrivateEvent): PrivateEvent | null {
  const campaign = getCampaignForUser(campaignId, userId);
  if (!campaign) return null;
  const visible = { seq: event.seq, type: event.type, payload: event.payload };
  if (capsFor(campaign, userId).role === "dm") return visible;
  const spatial = spatialActive(campaignId);
  if (!spatial && !event.audience) return visible;
  // No receipt means no retrospective grant, even after entering the source room.
  if (!event.audience?.userIds.includes(userId)) {
    return event.seq === undefined ? null : { seq: event.seq, type: "stream_checkpoint", payload: {} };
  }
  if (spatial && event.type === "campaign_updated") {
    // This event is also used by legacy scene/floor mutations. Only table metadata
    // is global; never smuggle scene state through a generic campaign envelope.
    const source = record(event.payload);
    const payload: Record<string, unknown> = {};
    for (const key of ["title", "description", "theme", "status", "maxPlayers", "startingLevel", "difficulty"]) {
      if (Object.hasOwn(source, key)) payload[key] = source[key];
    }
    return { ...visible, payload };
  }
  if (spatial && event.type === "campaign_rewound") return { ...visible, payload: { reason: "timeline_changed" } };
  if (spatial && event.type === "presence") {
    const members = new Set(listMembers(campaignId).map(member => member.userId));
    const online = record(event.payload).online;
    return { ...visible, payload: { online: Array.isArray(online) ? online.filter(id => members.has(id)) : [] } };
  }
  return visible;
}
