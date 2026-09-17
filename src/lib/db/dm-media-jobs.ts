import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";

export type DmMediaIntent =
  | { kind: "image"; targetId: string }
  | { kind: "tts"; targetId: string; voice: string }
  | { kind: "map"; targetId: string; name: string; layout: string; previousImageId: string | null };
export type DmMediaJob = {
  id: string; campaignId: string; intent: DmMediaIntent; owner: string; attempts: number;
};
export const DM_MEDIA_LEASE_MS = 180_000;
export const DM_MEDIA_MAX_ATTEMPTS = 5;

type JobRow = {
  id: string; campaign_id: string; intent_json: string; owner: string | null;
  attempts: number; status: string; lease_until: number;
};
function database() {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS dm_media_jobs (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image','map','tts')),
    intent_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    owner TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    available_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT
  ); CREATE INDEX IF NOT EXISTS idx_dm_media_ready ON dm_media_jobs(status, available_at, lease_until);`);
  return db;
}

// Called inside the transaction that creates the target/changes its layout.
// No provider credentials or mutable settings are copied into the job record.
export function insertDmMediaIntent(campaignId: string, intent: DmMediaIntent, now = Date.now()): string {
  const json = JSON.stringify(intent);
  const id = createHash("sha256").update(`${campaignId}\n${json}`).digest("hex");
  database().prepare(`INSERT OR IGNORE INTO dm_media_jobs
    (id, campaign_id, kind, intent_json, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, intent.kind, json, now, now, now);
  return id;
}

export function claimDmMediaJob(lane: "gpu" | "tts", now = Date.now()): DmMediaJob | null {
  const db = database();
  return db.transaction(() => {
    // A repeatedly crashing worker must not generate unbounded paid retries.
    db.prepare(`UPDATE dm_media_jobs SET status='failed', owner=NULL, last_error='Worker lease expired too many times.', updated_at=?
      WHERE status='running' AND lease_until<=? AND attempts>=?`).run(now, now, DM_MEDIA_MAX_ATTEMPTS);
    const row = db.prepare(`SELECT * FROM dm_media_jobs
      WHERE (kind = 'tts') = ? AND attempts < ?
        AND ((status='pending' AND available_at<=?) OR (status='running' AND lease_until<=?))
      ORDER BY created_at, id LIMIT 1`).get(lane === "tts" ? 1 : 0, DM_MEDIA_MAX_ATTEMPTS, now, now) as JobRow | undefined;
    if (!row) return null;
    const owner = randomUUID();
    const changed = db.prepare(`UPDATE dm_media_jobs SET status='running', owner=?, attempts=attempts+1, lease_until=?, updated_at=?
      WHERE id=? AND ((status='pending' AND available_at<=?) OR (status='running' AND lease_until<=?))`)
      .run(owner, now + DM_MEDIA_LEASE_MS, now, row.id, now, now);
    return changed.changes === 1 ? { id: row.id, campaignId: row.campaign_id,
      intent: JSON.parse(row.intent_json) as DmMediaIntent, owner, attempts: row.attempts + 1 } : null;
  })();
}

export function renewDmMediaLease(job: DmMediaJob, now = Date.now()): boolean {
  return database().prepare(`UPDATE dm_media_jobs SET lease_until=?, updated_at=?
    WHERE id=? AND status='running' AND owner=? AND lease_until>?`)
    .run(now + DM_MEDIA_LEASE_MS, now, job.id, job.owner, now).changes === 1;
}

// The output reference, replayable SSE event and completed receipt share a
// transaction. An expired worker cannot commit over a newer claimant.
export function completeDmMediaJob(job: DmMediaJob, apply: () => void, now = Date.now()): void {
  const db = database();
  withCommittedEffects(() => db.transaction(() => {
    const row = db.prepare("SELECT * FROM dm_media_jobs WHERE id=?").get(job.id) as JobRow | undefined;
    if (row?.status === "done") return;
    if (!row || row.status !== "running" || row.owner !== job.owner || row.lease_until <= now) {
      throw new Error("Media job lease is no longer owned by this worker.");
    }
    apply();
    db.prepare("UPDATE dm_media_jobs SET status='done', owner=NULL, lease_until=0, updated_at=?, last_error=NULL WHERE id=?")
      .run(now, job.id);
  })());
}

export function failDmMediaJob(job: DmMediaJob, error: string, now = Date.now()): boolean {
  const delay = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));
  return database().prepare(`UPDATE dm_media_jobs SET status=?, owner=NULL, lease_until=0,
    available_at=?, updated_at=?, last_error=? WHERE id=? AND status='running' AND owner=?`)
    .run(job.attempts >= DM_MEDIA_MAX_ATTEMPTS ? "failed" : "pending", now + delay, now,
      error.slice(0, 500), job.id, job.owner).changes === 1;
}

export function pruneCompletedDmMediaJobs(now = Date.now()): void {
  database().prepare("DELETE FROM dm_media_jobs WHERE status='done' AND updated_at < ?")
    .run(now - 30 * 24 * 60 * 60 * 1000);
}
