/** Immutable per-recipient wire views for the old campaign event ledger.
 * Decisions happen on publication, not when someone enters a room or reconnects.
 * This module is DB-driver-neutral and contains no application imports.
 */
import { createHash } from 'node:crypto';
export const EVENT_ACCESS_SCHEMA = `
CREATE TABLE IF NOT EXISTS spatial_event_views (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_digest TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(campaign_id,seq,user_id)
);
CREATE INDEX IF NOT EXISTS spatial_event_views_user ON spatial_event_views(campaign_id,user_id,seq);
`;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const select = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object(value), key)).map(key => [key, value[key]]));
const digest = event => createHash('sha256').update(JSON.stringify([event.type, event.payload])).digest('hex');
const OWN_EVENTS = new Set(['sheet_updated', 'roll_result', 'pending_roll', 'roll_requested', 'pending_roll_updated',
  'pending_roll_resolved', 'character_event', 'level_up', 'level_up_available', 'message_added', 'message_updated']);
const ownUser = (payload, actor) => {
  const p = object(payload);
  return [p.userId, p.sheet?.userId, p.message?.userId, p.pendingRoll?.userId, p.roll?.userId].includes(actor.userId) ||
    [p.characterId, p.roll?.characterId, p.sheet?.id, p.pendingRoll?.characterId].some(id => id && actor.ownedCharacterIds.includes(id));
};
function globalView(type, payload) {
  if (type === 'campaign_updated') return select(payload, ['status', 'title', 'description', 'theme', 'cover', 'maxPlayers', 'startingLevel', 'difficulty']);
  if (type === 'presence') return { online: Array.isArray(payload?.online) ? payload.online : [] };
  if (type === 'spatial_mode_changed') return { enabled: Boolean(payload?.enabled) };
  if (type === 'member_updated' || type === 'member_joined') return { member: select(payload?.member, ['userId', 'username', 'avatar', 'role', 'ready', 'useRealDice', 'muted', 'skipTurnsCount', 'autopilot', 'joinedAt']) };
  if (type === 'member_left' || type === 'member_removed') return select(payload, ['userId']);
  if (type === 'campaign_rewound') return { reason: 'campaign_rewound' };
  if (type === 'stream_checkpoint') return {};
  if (['message_added', 'message_updated', 'ooc_message'].includes(type) && /^\s*\(ooc\)/i.test(payload?.message?.content ?? '')) {
    return { message: select(payload.message, ['id', 'campaignId', 'seq', 'authorType', 'userId', 'characterId', 'content', 'createdAt', 'kind', 'authorUserId', 'roomId']) };
  }
  return undefined;
}
function rollView(payload, actor) {
  const p = object(payload), roll = object(p.roll ?? p);
  const own = roll.characterId && actor.ownedCharacterIds.includes(roll.characterId);
  if (roll.visibility === 'dm' || (roll.visibility === 'self' && !own)) return null;
  if (roll.visibility !== 'blind') return payload;
  const redacted = { ...roll, total: null, success: null, breakdown: null, dc: null, hidden: true };
  return p.roll ? { ...p, roll: redacted } : redacted;
}

/** Scope is supplied by a trusted writer, never taken from player prose.
 * Unknown unscoped mechanics are DM-only; known owner events remain usable.
 * Scene writers must supply their adjudicated room explicitly.
 */
export function publicationView(type, payload, actor, scope = null) {
  if (!actor.member) return null;
  if (actor.isDm) return payload;
  if (scope?.kind === 'dm') return null;
  const shared = globalView(type, payload);
  if (shared !== undefined && !scope) return shared;
  const scoped = scope?.kind === 'global' ||
    (scope?.kind === 'room' && scope.roomId && scope.roomId === actor.roomId) ||
    (scope?.kind === 'users' && scope.userIds?.includes(actor.userId));
  const own = !scope && OWN_EVENTS.has(type) && ownUser(payload, actor);
  if (!scoped && !own) return null;
  // Existing secrecy restrictions are conjunctive with the spatial audience.
  if (type === 'roll_result') return rollView(payload, actor);
  if (payload?.note && (payload.note.visibility === 'private' || payload.note.status === 'pending') && payload.note.authorUserId !== actor.userId) return null;
  if (['dm_delta', 'dm_status', 'utility_call', 'utility_call_updated', 'narrator_command_completed'].includes(type)) return null;
  return payload;
}

export function createEventAccess(db) {
  db.exec(EVENT_ACCESS_SCHEMA);
  return {
    capture(campaignId, event, actors, scope = null) {
      const insert = db.prepare('INSERT INTO spatial_event_views(campaign_id,seq,user_id,event_digest,type,payload_json) VALUES(?,?,?,?,?,?)');
      const hash = digest(event);
      for (const actor of actors) {
        if (actor.isDm) continue; // DM access is a current seat, not a permanent receipt.
        const payload = publicationView(event.type, event.payload, actor, scope);
        if (payload !== null) insert.run(campaignId, event.seq, actor.userId, hash, event.type, JSON.stringify(payload));
      }
    },
    project(campaignId, event, actor, { enabled, startSeq = 0 } = {}) {
      if (!actor?.member) throw new Error('Campaign stream access revoked.');
      if (!enabled || actor.isDm) return event;
      if (event.seq < startSeq) {
        // The pre-split campaign transcript was a shared table. Retain its
        // historical contract, while still respecting private roll visibility.
        const payload = event.type === 'roll_result' ? rollView(event.payload, actor) : event.payload;
        return payload === null ? { seq: event.seq, type: 'stream_checkpoint', payload: {} } : { ...event, payload };
      }
      const row = db.prepare('SELECT event_digest,type,payload_json FROM spatial_event_views WHERE campaign_id=? AND seq=? AND user_id=?')
        .get(campaignId, event.seq, actor.userId);
      // A buffered event from a discarded timeline must not pick up a new
      // event's audience merely because sequence numbers have been reused.
      return row && row.event_digest === digest(event)
        ? { seq: event.seq, type: row.type, payload: JSON.parse(row.payload_json) }
        : { seq: event.seq, type: 'stream_checkpoint', payload: {} };
    },
  };
}

export function decodeEventChunk(chunk) {
  if (chunk.startsWith(':')) return null;
  const type = /^event: (.+)$/m.exec(chunk)?.[1];
  const data = /^data: (.*)$/m.exec(chunk)?.[1];
  const seq = /^id: (\d+)$/m.exec(chunk)?.[1];
  if (!type || data === undefined) throw new Error('Invalid campaign SSE frame.');
  return { ...(seq === undefined ? {} : { seq: Number(seq) }), type, payload: JSON.parse(data) };
}
export function ephemeralView(type, payload, actor, enabled) {
  if (!actor?.member) throw new Error('Campaign stream access revoked.');
  if (!enabled || actor.isDm) return { type, payload };
  const shared = globalView(type, payload);
  if (shared !== undefined) return { type, payload: shared };
  // These notifications carry no prose. Targeting is performed by the
  // authenticated user bus; never forward supplied text or IDs here.
  if (['ask_activity', 'whisper_activity', 'side_activity'].includes(type)) return { type, payload: {} };
  return null;
}
