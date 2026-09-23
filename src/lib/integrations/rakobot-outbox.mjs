import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

// Metadata only. No action text or Telegram credentials are duplicated here.
// Call enqueue inside the transaction which accepts the action. Do not cache
// DDL initialization: that transaction can still roll back.
export const OUTBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS rakobot_stream (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), stream_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rakobot_action_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('legacy','spatial')),
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('do','say')),
  public_at_creation INTEGER NOT NULL CHECK(public_at_creation IN (0,1)),
  fingerprint TEXT NOT NULL,
  UNIQUE(campaign_id,source,message_id)
);`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FeedConflict extends Error {}
export function feedConfig(env = process.env) {
  const token = env.RAKOBOT_FEED_TOKEN ?? '';
  const raw = env.RAKOBOT_CAMPAIGN_IDS ?? '';
  if (!token && !raw) return null;
  const campaigns = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || !campaigns.length || campaigns.length > 50 || campaigns.some(id => !uuid.test(id))) {
    throw new Error('Invalid RAKOBOT_FEED_TOKEN / RAKOBOT_CAMPAIGN_IDS configuration.');
  }
  return { token, campaigns: new Set(campaigns) };
}
export function authorizedFeed(header, token) {
  if (typeof header !== 'string' || header.length > 300 || typeof token !== 'string' || token.length < 32) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(header), hash(`Bearer ${token}`));
}
export function actionFingerprint(userId, content) {
  return createHash('sha256').update(JSON.stringify([userId, content])).digest('hex');
}
// Compare canonical write-time projections, not current room membership. A
// private action must never become exportable when other members leave later.
export function visibleToWholeParty(memberIds, recipientIds, stealth = false) {
  return !stealth && memberIds.length > 0 && memberIds.every(id => recipientIds.includes(id));
}
export function createActionOutbox(db) {
  const ensure = () => {
    db.exec(OUTBOX_SCHEMA);
    db.prepare('INSERT OR IGNORE INTO rakobot_stream(singleton,stream_id) VALUES(1,?)').run(randomUUID());
  };
  const stream = () => db.prepare('SELECT stream_id FROM rakobot_stream WHERE singleton=1').get().stream_id;
  function head() {
    ensure();
    const last = db.prepare('SELECT id,anchor FROM rakobot_action_outbox ORDER BY id DESC LIMIT 1').get();
    return { stream: stream(), cursor: last ? { id: last.id, anchor: last.anchor } : { id: 0, anchor: '' } };
  }
  return {
    enqueue(input) {
      if (!['legacy', 'spatial'].includes(input.source) || !['do', 'say'].includes(input.kind) ||
          !uuid.test(input.campaignId) || typeof input.messageId !== 'string' || !input.messageId ||
          typeof input.publicAtCreation !== 'boolean' || !/^[0-9a-f]{64}$/.test(input.fingerprint)) {
        throw new Error('Invalid action outbox record.');
      }
      ensure();
      db.prepare(`INSERT OR IGNORE INTO rakobot_action_outbox
        (anchor,campaign_id,source,message_id,kind,public_at_creation,fingerprint) VALUES(?,?,?,?,?,?,?)`)
        .run(randomUUID(), input.campaignId, input.source, input.messageId, input.kind,
          Number(input.publicAtCreation), input.fingerprint);
    },
    head,
    page(cursor, project, limit = 25) {
      ensure();
      if (!cursor || !Number.isSafeInteger(cursor.id) || cursor.id < 0 || typeof cursor.anchor !== 'string' ||
          cursor.stream !== stream() || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new FeedConflict('Invalid feed cursor.');
      const row = cursor.id ? db.prepare('SELECT anchor FROM rakobot_action_outbox WHERE id=?').get(cursor.id) : null;
      // The anchor also catches restoration of an older DB whose integer IDs
      // were subsequently reused. Never silently skip/replay a different log.
      if (cursor.id ? row?.anchor !== cursor.anchor : cursor.anchor !== '') throw new FeedConflict('Feed cursor no longer exists.');
      const rows = db.prepare('SELECT * FROM rakobot_action_outbox WHERE id>? ORDER BY id LIMIT ?').all(cursor.id, limit);
      const entries = rows.map(row => ({ id: row.id, anchor: row.anchor, event: row.public_at_creation ? project(row) : null }));
      return { stream: cursor.stream, entries };
    },
  };
}
