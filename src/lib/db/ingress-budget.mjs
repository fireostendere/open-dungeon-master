// Durable, shared across workers and restarts. Quotas contain IDs and counters,
// never player text. Consume before any model call or persisted player input.
export class IngressLimit extends Error {
  status = 429;
  retryAfter = 60;
  constructor() { super('Too many requests; retry after the current minute.'); this.name = 'IngressLimit'; }
}
export function consumeIngress(db, campaignId, userId, channel, now = Date.now()) {
  const channelLimits = { ask: 10, whisper: 20, action: 30 };
  if (!(channel in channelLimits) || !campaignId || !userId || !Number.isFinite(now)) throw new TypeError('Invalid ingress bucket');
  const minute = Math.floor(now / 60000);
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS campaign_ingress_budget (
      bucket TEXT NOT NULL, minute INTEGER NOT NULL, used INTEGER NOT NULL,
      PRIMARY KEY(bucket, minute)
    );`);
    const buckets = [
      [JSON.stringify(['user', userId]), 60],
      [JSON.stringify(['campaign', campaignId]), 300],
      [JSON.stringify([campaignId, userId, channel]), channelLimits[channel]],
    ];
    for (const [bucket, limit] of buckets) {
      const row = db.prepare('SELECT used FROM campaign_ingress_budget WHERE bucket = ? AND minute = ?').get(bucket, minute);
      if (row && row.used >= limit) throw new IngressLimit();
      db.prepare(`INSERT INTO campaign_ingress_budget(bucket, minute, used) VALUES (?, ?, 1)
        ON CONFLICT(bucket, minute) DO UPDATE SET used = used + 1`).run(bucket, minute);
    }
    db.prepare('DELETE FROM campaign_ingress_budget WHERE minute < ?').run(minute - 1440);
  })();
}
