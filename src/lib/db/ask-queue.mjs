import { createHash, randomUUID } from 'node:crypto';

// Queue state is additive: the old campaign_asks CHECK constraint and rows stay
// intact. The queue row is authoritative for externally answered questions.
const ACKNOWLEDGEMENTS = [
  'Your question has been sent to the Dungeon Master…',
  'Pytanie zostało przekazane Mistrzowi Gry…',
  'Вопрос передан Мастеру стола…',
];
export class AskQueueConflict extends Error {
  status = 409;
  constructor(message = 'Ask changed or was already answered; reread its version.') {
    super(message); this.name = 'AskQueueConflict';
  }
}
export function ensureAskQueue(db) {
  const objects = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','index')
    AND name IN ('campaign_ask_queue','idx_ask_queue_pending','odm_ask_queue_migrations')`).all();
  const ready = objects.length === 3;
  // Both schema_version and the migration marker can roll back. Only prepared
  // programs are reused; schema existence and the data marker stay live reads.
  if (ready && db.prepare('SELECT version FROM odm_ask_queue_migrations WHERE version = 1').get()) return;
  db.transaction(() => {
    if (!ready) db.exec(`CREATE TABLE IF NOT EXISTS campaign_ask_queue (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ask_id TEXT NOT NULL UNIQUE REFERENCES campaign_asks(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('pending','answered','failed')),
      version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
      command_id TEXT,
      answer_digest TEXT,
      answered_by TEXT,
      answered_at TEXT,
      migrated_ack INTEGER NOT NULL DEFAULT 0,
      UNIQUE(campaign_id, command_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ask_queue_pending
      ON campaign_ask_queue(campaign_id, state, seq);
    CREATE TABLE IF NOT EXISTS odm_ask_queue_migrations (
      version INTEGER PRIMARY KEY
    );`);
    if (!db.prepare('SELECT version FROM odm_ask_queue_migrations WHERE version = 1').get()) {
      // One-time, explicit compatibility migration for the THREE exact
      // placeholders emitted by the previous human-mode route, with no citations.
      // Other existing answers are never guessed to be unanswered.
      const isPlaceholder = `(status = 'answered' AND citations_json = '[]' AND answer IN (?, ?, ?))`;
      db.prepare(`INSERT OR IGNORE INTO campaign_ask_queue
        (ask_id, campaign_id, state, version, answered_by, migrated_ack)
        SELECT id, campaign_id,
          CASE WHEN ${isPlaceholder} THEN 'pending' ELSE status END,
          CASE WHEN ${isPlaceholder} THEN 0 ELSE 1 END,
          CASE WHEN ${isPlaceholder} THEN NULL ELSE 'legacy' END,
          CASE WHEN ${isPlaceholder} THEN 1 ELSE 0 END
        FROM campaign_asks ORDER BY created_at, id`).run(
          ...ACKNOWLEDGEMENTS, ...ACKNOWLEDGEMENTS, ...ACKNOWLEDGEMENTS, ...ACKNOWLEDGEMENTS);
      db.prepare('INSERT INTO odm_ask_queue_migrations(version) VALUES (1)').run();
    }
  })();
}
export const ASK_SELECT = `SELECT a.*, q.seq AS queue_seq, q.state AS queue_state,
  q.version AS answer_version, q.answered_by, q.answered_at
  FROM campaign_asks a LEFT JOIN campaign_ask_queue q ON q.ask_id = a.id`;

export function registerAsk(db, askId, campaignId, state) {
  if (!['pending', 'answered', 'failed'].includes(state)) throw new TypeError('Invalid Ask state');
  db.prepare(`INSERT INTO campaign_ask_queue
    (ask_id, campaign_id, state, version, answered_by)
    VALUES (?, ?, ?, ?, ?)`).run(askId, campaignId, state, state === 'pending' ? 0 : 1,
      state === 'pending' ? null : 'internal_dm');
}
export function pendingAskQueueMeta(db, campaignId) {
  ensureAskQueue(db);
  const row = db.prepare(`SELECT seq FROM campaign_ask_queue
    WHERE campaign_id = ? AND state = 'pending' ORDER BY seq LIMIT 1`).get(campaignId);
  return { pending: Boolean(row) };
}
export function listPendingAsks(db, campaignId, after = 0, limit = 20) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new TypeError('Invalid Ask cursor or page size');
  ensureAskQueue(db);
  const rows = db.prepare(`${ASK_SELECT}
    WHERE a.campaign_id = ? AND q.campaign_id = ? AND q.state = 'pending' AND q.seq > ?
    ORDER BY q.seq LIMIT ?`).all(campaignId, campaignId, after, limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, hasMore, nextCursor: items.at(-1)?.queue_seq ?? after };
}
export function answerQueuedAsk(db, { campaignId, askId, answer, citations = [],
  expectedVersion = 0, commandId, author = 'external_narrator', now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
      typeof answer !== 'string' || !answer.trim() || answer.length > 4000)
    throw new TypeError('Invalid Ask answer or version');
  ensureAskQueue(db);
  const encoded = JSON.stringify(citations);
  const digest = createHash('sha256').update(JSON.stringify([askId, answer, citations])).digest('hex');
  const key = commandId || `legacy:${digest}`;
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM campaign_ask_queue WHERE campaign_id = ? AND ask_id = ?`)
      .get(campaignId, askId);
    if (!row) return null;
    const receipt = db.prepare(`SELECT * FROM campaign_ask_queue WHERE campaign_id = ? AND command_id = ?`)
      .get(campaignId, key);
    if (receipt) {
      if (receipt.ask_id !== askId || receipt.answer_digest !== digest || receipt.version !== expectedVersion + 1)
        throw new AskQueueConflict('Command ID was used for a different answer or version.');
      return { row: db.prepare(`${ASK_SELECT} WHERE a.id = ? AND a.campaign_id = ?`).get(askId, campaignId), replayed: true };
    }
    if (row.state !== 'pending' || row.version !== expectedVersion) throw new AskQueueConflict();
    const updated = db.prepare(`UPDATE campaign_ask_queue SET state = 'answered', version = version + 1,
      command_id = ?, answer_digest = ?, answered_by = ?, answered_at = ?
      WHERE ask_id = ? AND campaign_id = ? AND state = 'pending' AND version = ?`)
      .run(key, digest, author, now, askId, campaignId, expectedVersion);
    if (updated.changes !== 1) throw new AskQueueConflict();
    const info = db.prepare(`UPDATE campaign_asks SET answer = ?, citations_json = ?, status = 'answered'
      WHERE id = ? AND campaign_id = ?`).run(answer, encoded, askId, campaignId);
    if (info.changes !== 1) throw new AskQueueConflict('Ask disappeared while answering.');
    return { row: db.prepare(`${ASK_SELECT} WHERE a.id = ? AND a.campaign_id = ?`).get(askId, campaignId), replayed: false };
  })();
}

// The request UUID can be generated before entering a synchronous transaction.
export { randomUUID as newAskId };
export class AskQueueFull extends Error {
  status = 429;
  constructor() { super('Too many unanswered questions; wait for the DM.'); this.name = 'AskQueueFull'; }
}
export function checkAskCapacity(db, campaignId, userId) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM campaign_ask_queue WHERE campaign_id = ? AND state = 'pending'`).get(campaignId).n;
  const own = db.prepare(`SELECT COUNT(*) AS n FROM campaign_ask_queue q JOIN campaign_asks a ON a.id = q.ask_id
    WHERE q.campaign_id = ? AND q.state = 'pending' AND a.user_id = ?`).get(campaignId, userId).n;
  if (total >= 500 || own >= 20) throw new AskQueueFull();
}
