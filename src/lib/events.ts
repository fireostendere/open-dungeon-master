import { afterCommit } from "@/lib/db/commit-effects";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { allocateSeq } from "@/lib/db/campaigns";
import { captureEventAudience, decodeEventAudience, ensureEventAudienceColumn, projectEventForUser, type EventScope, type PrivateEvent } from "@/lib/spatial/event-privacy";

type Subscriber = (chunk: string) => void;

// Keep the bus and per-tab presence across Next development HMR evaluations.
declare global {
  var __odmEventBus: Map<string, Set<Subscriber>> | undefined;
  var __odmEventSubscriberUsers: Map<string, WeakMap<Subscriber, string>> | undefined;
  var __odmPresenceCounts: Map<string, Map<string, number>> | undefined;
  var __odmVoiceEventHook: ((campaignId: string, type: string) => void) | undefined;
}
function bus() { return (globalThis.__odmEventBus ??= new Map<string, Set<Subscriber>>()); }
function subscriberUsers(campaignId: string) {
  const campaigns = (globalThis.__odmEventSubscriberUsers ??= new Map<string, WeakMap<Subscriber, string>>());
  let users = campaigns.get(campaignId);
  if (!users) { users = new WeakMap<Subscriber, string>(); campaigns.set(campaignId, users); }
  return users;
}
function presenceCounts() { return (globalThis.__odmPresenceCounts ??= new Map<string, Map<string, number>>()); }
export function onlineUserIds(campaignId: string): string[] { return Array.from(presenceCounts().get(campaignId)?.keys() ?? []); }

function freezeEvent(campaignId: string, type: string, payload: unknown, seq?: number, scope?: EventScope): PrivateEvent {
  // Deferred after-commit callbacks must not observe a subsequently mutated object.
  const frozen = JSON.parse(JSON.stringify(payload ?? null)) as unknown;
  return { seq, type, payload: frozen, audience: captureEventAudience(campaignId, type, frozen, scope) };
}
function announcePresence(campaignId: string) {
  fanOut(campaignId, freezeEvent(campaignId, "presence", { online: onlineUserIds(campaignId) }));
}

export function subscribe(campaignId: string, subscriber: Subscriber, userId?: string): () => void {
  let subscribers = bus().get(campaignId);
  if (!subscribers) { subscribers = new Set(); bus().set(campaignId, subscribers); }
  subscribers.add(subscriber);
  if (!userId) subscriberUsers(campaignId).delete(subscriber);
  if (userId) {
    subscriberUsers(campaignId).set(subscriber, userId);
    let counts = presenceCounts().get(campaignId);
    if (!counts) { counts = new Map(); presenceCounts().set(campaignId, counts); }
    const next = (counts.get(userId) ?? 0) + 1;
    counts.set(userId, next);
    if (next === 1) announcePresence(campaignId);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers.delete(subscriber);
    subscriberUsers(campaignId).delete(subscriber);
    if (!subscribers.size) { bus().delete(campaignId); globalThis.__odmEventSubscriberUsers?.delete(campaignId); }
    if (userId) {
      const counts = presenceCounts().get(campaignId);
      if (counts) {
        const left = (counts.get(userId) ?? 0) - 1;
        if (left <= 0) counts.delete(userId); else counts.set(userId, left);
        if (!counts.size) presenceCounts().delete(campaignId);
        if (left <= 0) announcePresence(campaignId);
      }
    }
  };
}

export function sseChunk(type: string, payload: unknown, id?: number) {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
function fanOut(campaignId: string, event: PrivateEvent, onlyUserId?: string) {
  const subscribers = bus().get(campaignId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    const userId = subscriberUsers(campaignId).get(subscriber);
    if (onlyUserId && userId !== onlyUserId) continue;
    // Anonymous process-local subscribers are not a spatial audience.
    const projected = userId ? projectEventForUser(campaignId, userId, event) : event.audience ? null : event;
    if (!projected) continue;
    try { subscriber(sseChunk(projected.type, projected.payload, projected.seq)); }
    catch { subscribers.delete(subscriber); }
  }
}

export function publishWithSeq(campaignId: string, seq: number, type: string, payload: unknown, scope?: EventScope) {
  const db = getDatabase();
  const event = freezeEvent(campaignId, type, payload, seq, scope);
  db.transaction(() => {
    ensureEventAudienceColumn();
    db.prepare("INSERT INTO campaign_events (campaign_id, seq, type, payload_json, created_at, audience_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(campaignId, seq, type, JSON.stringify(event.payload), nowIso(), event.audience ? JSON.stringify(event.audience) : null);
  })();
  afterCommit(() => { fanOut(campaignId, event); globalThis.__odmVoiceEventHook?.(campaignId, type); });
  return seq;
}
export function publishPersisted(campaignId: string, type: string, payload: unknown, scope?: EventScope) {
  return publishWithSeq(campaignId, allocateSeq(campaignId), type, payload, scope);
}
export function publishEphemeral(campaignId: string, type: string, payload: unknown, scope?: EventScope) {
  const event = freezeEvent(campaignId, type, payload, undefined, scope);
  afterCommit(() => { fanOut(campaignId, event); globalThis.__odmVoiceEventHook?.(campaignId, type); });
}
export function publishUserEphemeral(campaignId: string, userId: string, type: string, payload: unknown) {
  const event = freezeEvent(campaignId, type, payload, undefined, { kind: "users", userIds: [userId] });
  afterCommit(() => fanOut(campaignId, event, userId));
}

export type StoredEvent = { seq: number; type: string; payload: unknown };
export function listEventsSince(campaignId: string, afterSeq: number, limit = 500, viewerUserId?: string): StoredEvent[] {
  ensureEventAudienceColumn();
  const rows = getDatabase().prepare(`SELECT seq, type, payload_json, audience_json FROM campaign_events
    WHERE campaign_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`)
    .all(campaignId, afterSeq, limit) as Array<{ seq: number; type: string; payload_json: string; audience_json: string | null }>;
  return rows.map(row => {
    const event: PrivateEvent = { seq: row.seq, type: row.type, payload: parseJson<unknown>(row.payload_json, null), audience: decodeEventAudience(row.audience_json) };
    const visible = viewerUserId ? projectEventForUser(campaignId, viewerUserId, event) : event;
    // One output per scanned sequence, even for a hidden event or revoked reader.
    // The route closes revoked streams; these checkpoints also keep paging finite.
    return visible ? { seq: row.seq, type: visible.type, payload: visible.payload } : { seq: row.seq, type: "stream_checkpoint", payload: {} };
  });
}
