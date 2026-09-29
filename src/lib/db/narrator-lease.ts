import { getDatabase } from "@/lib/db/core";

export class NarratorLeaseConflict extends Error {
  status = 409;
  constructor(message = "Another narrator host currently owns this campaign lease.") {
    super(message);
    this.name = "NarratorLeaseConflict";
  }
}

const configured = Number(process.env.ODM_NARRATOR_LEASE_MS ?? 15_000);
export const NARRATOR_LEASE_MS = Number.isFinite(configured)
  ? Math.min(120_000, Math.max(5_000, Math.floor(configured)))
  : 15_000;

const prepared = new WeakSet<object>();
function database() {
  const db = getDatabase();
  if (!prepared.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS narrator_host_leases (
      campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
      host_id TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );`);
    prepared.add(db);
  }
  return db;
}

/**
 * A short DB lease prevents two independent narrator processes from alternating
 * valid CAS writes in the same campaign. Same-host reads renew only in the last
 * half of the lease to avoid turning the normal poll loop into a SQLite write.
 */
export function touchNarratorLease(campaignId: string, hostId: string, now = Date.now()) {
  const db = database();
  return db.transaction(() => {
    const row = db.prepare(`SELECT host_id AS hostId, expires_at_ms AS expiresAt
      FROM narrator_host_leases WHERE campaign_id = ?`).get(campaignId) as
        { hostId: string; expiresAt: number } | undefined;
    if (row?.hostId === hostId && row.expiresAt > now + Math.floor(NARRATOR_LEASE_MS / 2)) {
      return { expiresAt: row.expiresAt, acquired: false };
    }
    if (row && row.hostId !== hostId && row.expiresAt > now) throw new NarratorLeaseConflict();
    const expiresAt = now + NARRATOR_LEASE_MS;
    db.prepare(`INSERT INTO narrator_host_leases(campaign_id, host_id, expires_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET
        host_id = excluded.host_id,
        expires_at_ms = excluded.expires_at_ms,
        updated_at_ms = excluded.updated_at_ms
      WHERE narrator_host_leases.host_id = excluded.host_id
         OR narrator_host_leases.expires_at_ms <= ?`).run(campaignId, hostId, expiresAt, now, now);
    const owner = db.prepare(`SELECT host_id AS hostId, expires_at_ms AS expiresAt
      FROM narrator_host_leases WHERE campaign_id = ?`).get(campaignId) as
        { hostId: string; expiresAt: number } | undefined;
    if (!owner || owner.hostId !== hostId || owner.expiresAt <= now) throw new NarratorLeaseConflict();
    return { expiresAt: owner.expiresAt, acquired: true };
  })();
}

export function narratorLease(campaignId: string) {
  const row = database().prepare(`SELECT host_id AS hostId, expires_at_ms AS expiresAt
    FROM narrator_host_leases WHERE campaign_id = ?`).get(campaignId) as
      { hostId: string; expiresAt: number } | undefined;
  if (!row || row.expiresAt <= Date.now()) return null;
  return row;
}
