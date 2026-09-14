import crypto from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import { assetStorage } from "@/lib/assets/storage";
import { ASSET_MIME_TYPES, type AssetMimeType, type InspectedImage } from "@/lib/assets/image";

export const ASSET_PROTOCOL_VERSION = 1;
export const DEFAULT_ASSET_MAX_BYTES = 32 * 1024 * 1024;
export const HARD_ASSET_MAX_BYTES = 64 * 1024 * 1024;

export const ART_KINDS = [
  "campaign_cover",
  "party_group",
  "character_portrait",
  "npc_portrait",
  "character_fullbody",
  "npc_fullbody",
  "location_art",
  "scene_art",
  "world_map",
  "regional_map",
  "dungeon_map",
  "battlemap",
  "item_art",
  "item_card",
  "handout",
  "token",
  "chapter_cover",
  "session_recap",
  "generic",
] as const;
export type ArtKind = (typeof ART_KINDS)[number];

export type PackStatus = "planned" | "active" | "ready" | "failed" | "cancelled";
export type JobStatus = "planned" | "available" | "claimed" | "uploading" | "ready" | "failed" | "cancelled";
export type AssetEntityType =
  | "campaign"
  | "character"
  | "npc"
  | "scene"
  | "location"
  | "map"
  | "chapter"
  | "item"
  | "session"
  | "encounter"
  | "quest"
  | "handout"
  | "generic";

type PackRow = {
  id: string;
  campaign_id: string;
  title: string;
  pack_type: string;
  status: PackStatus;
  style_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  pack_id: string;
  campaign_id: string;
  kind: ArtKind;
  title: string;
  description: string;
  suggested_prompt: string;
  negative_prompt: string;
  aspect: string;
  requested_width: number | null;
  requested_height: number | null;
  target_type: AssetEntityType;
  target_id: string;
  references_json: string;
  priority: number;
  status: JobStatus;
  claimed_by: string | null;
  claim_expires_at: string | null;
  attempts: number;
  error: string | null;
  dedupe_key: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
};

type AssetRow = {
  id: string;
  pack_id: string;
  job_id: string;
  campaign_id: string;
  kind: ArtKind;
  filename: string;
  mime_type: AssetMimeType;
  storage_key: string;
  byte_size: number;
  sha256: string;
  width: number;
  height: number;
  provider: string;
  model: string;
  prompt_used: string;
  revised_prompt: string;
  seed: string | null;
  variant_label: string;
  is_primary: number;
  metadata_json: string;
  created_at: string;
  deleted_at: string | null;
};

type LinkRow = {
  asset_id: string;
  campaign_id: string;
  entity_type: AssetEntityType;
  entity_id: string;
  role: string;
  is_primary: number;
  created_at: string;
};

type GrantRow = {
  id: string;
  operation: "upload" | "download";
  campaign_id: string;
  job_id: string | null;
  asset_id: string | null;
  token_hash: string;
  expected_mime_type: AssetMimeType | null;
  max_bytes: number | null;
  status: "granted" | "receiving" | "uploaded" | "consumed" | "failed" | "expired";
  expires_at: string;
  staging_key: string | null;
  byte_size: number | null;
  mime_type: AssetMimeType | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  created_at: string;
  consumed_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringify(value: unknown) {
  return JSON.stringify(value ?? {});
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(token: string, expectedHex: string) {
  const supplied = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function generatedToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function configuredAssetMaxBytes() {
  const value = Number(process.env.ODM_ASSET_MAX_BYTES ?? DEFAULT_ASSET_MAX_BYTES);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_ASSET_MAX_BYTES;
  return Math.min(Math.floor(value), HARD_ASSET_MAX_BYTES);
}

export function ensureAssetPipelineSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS asset_packs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      pack_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','active','ready','failed','cancelled')),
      style_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_asset_packs_campaign
      ON asset_packs(campaign_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS asset_jobs (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES asset_packs(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      suggested_prompt TEXT NOT NULL DEFAULT '',
      negative_prompt TEXT NOT NULL DEFAULT '',
      aspect TEXT NOT NULL DEFAULT 'square',
      requested_width INTEGER,
      requested_height INTEGER,
      target_type TEXT NOT NULL DEFAULT 'generic',
      target_id TEXT NOT NULL DEFAULT '',
      references_json TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('planned','available','claimed','uploading','ready','failed','cancelled')),
      claimed_by TEXT,
      claim_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      dedupe_key TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ready_at TEXT,
      UNIQUE (pack_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_campaign_status
      ON asset_jobs(campaign_id, status, priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_jobs_pack_status
      ON asset_jobs(pack_id, status, priority DESC, created_at ASC);

    CREATE TABLE IF NOT EXISTS asset_files (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL REFERENCES asset_packs(id) ON DELETE RESTRICT,
      job_id TEXT NOT NULL REFERENCES asset_jobs(id) ON DELETE RESTRICT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      prompt_used TEXT NOT NULL DEFAULT '',
      revised_prompt TEXT NOT NULL DEFAULT '',
      seed TEXT,
      variant_label TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE (job_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_files_campaign
      ON asset_files(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_files_job
      ON asset_files(job_id, is_primary DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_files_sha256
      ON asset_files(sha256);

    CREATE TABLE IF NOT EXISTS asset_links (
      asset_id TEXT NOT NULL REFERENCES asset_files(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, entity_type, entity_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_asset_links_target
      ON asset_links(campaign_id, entity_type, entity_id, role, is_primary DESC);

    CREATE TABLE IF NOT EXISTS asset_access_grants (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK (operation IN ('upload','download')),
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES asset_jobs(id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES asset_files(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expected_mime_type TEXT,
      max_bytes INTEGER,
      status TEXT NOT NULL DEFAULT 'granted'
        CHECK (status IN ('granted','receiving','uploaded','consumed','failed','expired')),
      expires_at TEXT NOT NULL,
      staging_key TEXT,
      byte_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      sha256 TEXT,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_asset_grants_job
      ON asset_access_grants(job_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_asset_grants_asset
      ON asset_access_grants(asset_id, status, expires_at);
  `);
}

function packFromRow(row: PackRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    packType: row.pack_type,
    status: row.status,
    style: parseJson(row.style_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobFromRow(row: JobRow) {
  return {
    id: row.id,
    packId: row.pack_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    suggestedPrompt: row.suggested_prompt,
    negativePrompt: row.negative_prompt,
    aspect: row.aspect,
    requestedWidth: row.requested_width,
    requestedHeight: row.requested_height,
    target: { type: row.target_type, id: row.target_id },
    referenceAssetIds: parseJson<string[]>(row.references_json, []),
    priority: row.priority,
    status: row.status,
    claimedBy: row.claimed_by,
    claimExpiresAt: row.claim_expires_at,
    attempts: row.attempts,
    error: row.error,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readyAt: row.ready_at,
  };
}

function assetFromRow(row: AssetRow) {
  return {
    id: row.id,
    packId: row.pack_id,
    jobId: row.job_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    byteSize: row.byte_size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    provider: row.provider,
    model: row.model,
    promptUsed: row.prompt_used,
    revisedPrompt: row.revised_prompt,
    seed: row.seed,
    variantLabel: row.variant_label,
    isPrimary: row.is_primary === 1,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function linkFromRow(row: LinkRow) {
  return {
    assetId: row.asset_id,
    campaignId: row.campaign_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    role: row.role,
    isPrimary: row.is_primary === 1,
    createdAt: row.created_at,
  };
}

function grantFromRow(row: GrantRow) {
  return {
    id: row.id,
    operation: row.operation,
    campaignId: row.campaign_id,
    jobId: row.job_id,
    assetId: row.asset_id,
    expectedMimeType: row.expected_mime_type,
    maxBytes: row.max_bytes,
    status: row.status,
    expiresAt: row.expires_at,
    stagingKey: row.staging_key,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  };
}

function requirePack(packId: string): PackRow {
  ensureAssetPipelineSchema();
  const row = getDatabase().prepare("SELECT * FROM asset_packs WHERE id = ?").get(packId) as PackRow | undefined;
  if (!row) throw new Error("Asset pack not found.");
  return row;
}

function requireJob(jobId: string): JobRow {
  ensureAssetPipelineSchema();
  expireClaims();
  const row = getDatabase().prepare("SELECT * FROM asset_jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  if (!row) throw new Error("Asset job not found.");
  return row;
}

function requireAsset(assetId: string): AssetRow {
  ensureAssetPipelineSchema();
  const row = getDatabase().prepare("SELECT * FROM asset_files WHERE id = ? AND deleted_at IS NULL").get(assetId) as AssetRow | undefined;
  if (!row) throw new Error("Asset not found.");
  return row;
}

export type JobDraft = {
  kind: ArtKind;
  title: string;
  description?: string;
  suggestedPrompt?: string;
  negativePrompt?: string;
  aspect?: string;
  requestedWidth?: number | null;
  requestedHeight?: number | null;
  target?: { type: AssetEntityType; id: string };
  referenceAssetIds?: string[];
  priority?: number;
  metadata?: unknown;
  dedupeKey?: string;
};

function defaultDedupeKey(job: JobDraft) {
  const value = JSON.stringify({
    kind: job.kind,
    target: job.target ?? { type: "generic", id: "" },
    title: job.title.trim().toLowerCase(),
  });
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createPack(input: {
  campaignId: string;
  title: string;
  packType: string;
  style?: unknown;
  metadata?: unknown;
  jobs?: JobDraft[];
}) {
  ensureAssetPipelineSchema();
  const db = getDatabase();
  const campaign = db.prepare("SELECT id FROM campaigns WHERE id = ?").get(input.campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  const id = crypto.randomUUID();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO asset_packs (id, campaign_id, title, pack_type, status, style_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(id, input.campaignId, input.title.trim(), input.packType.trim(), stringify(input.style), stringify(input.metadata), now, now);
    for (const job of input.jobs ?? []) upsertJob({ packId: id, campaignId: input.campaignId, job });
  })();
  return getPack(id)!;
}

export function upsertJob(input: { packId: string; campaignId: string; job: JobDraft }) {
  ensureAssetPipelineSchema();
  if (!(ART_KINDS as readonly string[]).includes(input.job.kind)) throw new Error("Unsupported asset kind.");
  const pack = requirePack(input.packId);
  if (pack.campaign_id !== input.campaignId) throw new Error("Pack does not belong to campaign.");
  if (pack.status === "cancelled") throw new Error("Cancelled pack cannot receive jobs.");
  const db = getDatabase();
  const dedupeKey = input.job.dedupeKey || defaultDedupeKey(input.job);
  const existing = db.prepare("SELECT * FROM asset_jobs WHERE pack_id = ? AND dedupe_key = ?").get(input.packId, dedupeKey) as JobRow | undefined;
  if (existing) {
    if (["planned", "available", "failed"].includes(existing.status)) {
      db.prepare(`
        UPDATE asset_jobs SET title = ?, description = ?, suggested_prompt = ?, negative_prompt = ?, aspect = ?,
          requested_width = ?, requested_height = ?, references_json = ?, priority = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.job.title.trim(),
        input.job.description?.trim() || "",
        input.job.suggestedPrompt?.trim() || "",
        input.job.negativePrompt?.trim() || "",
        input.job.aspect?.trim() || "square",
        input.job.requestedWidth ?? null,
        input.job.requestedHeight ?? null,
        JSON.stringify(input.job.referenceAssetIds ?? []),
        input.job.priority ?? 0,
        stringify(input.job.metadata),
        nowIso(),
        existing.id,
      );
    }
    return getJob(existing.id)!;
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO asset_jobs (
      id, pack_id, campaign_id, kind, title, description, suggested_prompt, negative_prompt, aspect,
      requested_width, requested_height, target_type, target_id, references_json, priority, status,
      dedupe_key, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)
  `).run(
    id,
    input.packId,
    input.campaignId,
    input.job.kind,
    input.job.title.trim(),
    input.job.description?.trim() || "",
    input.job.suggestedPrompt?.trim() || "",
    input.job.negativePrompt?.trim() || "",
    input.job.aspect?.trim() || "square",
    input.job.requestedWidth ?? null,
    input.job.requestedHeight ?? null,
    input.job.target?.type ?? "generic",
    input.job.target?.id ?? "",
    JSON.stringify(input.job.referenceAssetIds ?? []),
    input.job.priority ?? 0,
    dedupeKey,
    stringify(input.job.metadata),
    now,
    now,
  );
  recomputePack(input.packId);
  return getJob(id)!;
}

export function getPack(packId: string) {
  ensureAssetPipelineSchema();
  const row = getDatabase().prepare("SELECT * FROM asset_packs WHERE id = ?").get(packId) as PackRow | undefined;
  if (!row) return null;
  return {
    ...packFromRow(row),
    jobs: listJobs({ packId }),
    assets: listAssets({ packId }),
  };
}

export function listPacks(input: { campaignId?: string; status?: PackStatus } = {}) {
  ensureAssetPipelineSchema();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.campaignId) {
    clauses.push("campaign_id = ?");
    params.push(input.campaignId);
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  const sql = `SELECT * FROM asset_packs${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
  return (getDatabase().prepare(sql).all(...params) as PackRow[]).map(packFromRow);
}

function expireClaims() {
  ensureAssetPipelineSchema();
  const now = nowIso();
  getDatabase().prepare(`
    UPDATE asset_jobs
    SET status = 'available', claimed_by = NULL, claim_expires_at = NULL, updated_at = ?
    WHERE status IN ('claimed','uploading') AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?
  `).run(now, now);
  getDatabase().prepare(`
    UPDATE asset_access_grants SET status = 'expired'
    WHERE status IN ('granted','receiving') AND expires_at <= ?
  `).run(now);
}

export function listJobs(input: {
  campaignId?: string;
  packId?: string;
  status?: JobStatus;
  kind?: ArtKind;
} = {}) {
  ensureAssetPipelineSchema();
  expireClaims();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.campaignId) {
    clauses.push("campaign_id = ?");
    params.push(input.campaignId);
  }
  if (input.packId) {
    clauses.push("pack_id = ?");
    params.push(input.packId);
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  if (input.kind) {
    clauses.push("kind = ?");
    params.push(input.kind);
  }
  const sql = `SELECT * FROM asset_jobs${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY priority DESC, created_at ASC`;
  return (getDatabase().prepare(sql).all(...params) as JobRow[]).map(jobFromRow);
}

function campaignContext(campaignId: string) {
  const db = getDatabase();
  const campaign = db.prepare(`
    SELECT id, title, description, theme, scene, quest_log_json, dm_outline, story_arc_json
    FROM campaigns WHERE id = ?
  `).get(campaignId) as
    | { id: string; title: string; description: string; theme: string; scene: string; quest_log_json: string; dm_outline: string; story_arc_json: string }
    | undefined;
  if (!campaign) return null;
  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description,
    theme: campaign.theme,
    scene: campaign.scene,
    quests: parseJson(campaign.quest_log_json, []),
    outline: campaign.dm_outline,
    storyArc: parseJson(campaign.story_arc_json || "null", null),
  };
}

function targetContext(job: JobRow) {
  const db = getDatabase();
  switch (job.target_type) {
    case "character":
      return db.prepare(`SELECT id, name, race, class, subclass, level, portrait_json FROM character_sheets WHERE id = ?`).get(job.target_id) ?? null;
    case "npc":
      return db.prepare(`SELECT id, name, attitude, trait, location, role, portrait_url FROM npcs WHERE id = ?`).get(job.target_id) ?? null;
    case "location":
      return db.prepare(`SELECT id, name, layout_description, visited, map_image_json FROM locations WHERE id = ?`).get(job.target_id) ?? null;
    case "map":
      return db.prepare(`SELECT id, name, notes, width, height, theme, backdrop_path FROM prepared_maps WHERE id = ?`).get(job.target_id) ?? null;
    case "chapter":
      return db.prepare(`SELECT id, chapter_index, title, summary, highlights_json FROM chapters WHERE id = ?`).get(job.target_id) ?? null;
    case "campaign":
      return campaignContext(job.campaign_id);
    default:
      return null;
  }
}

export function getJob(jobId: string) {
  ensureAssetPipelineSchema();
  expireClaims();
  const row = getDatabase().prepare("SELECT * FROM asset_jobs WHERE id = ?").get(jobId) as JobRow | undefined;
  if (!row) return null;
  const referenceIds = parseJson<string[]>(row.references_json, []);
  const references = referenceIds
    .map((assetId) => getAsset(assetId))
    .filter((asset): asset is NonNullable<ReturnType<typeof getAsset>> => Boolean(asset));
  return {
    ...jobFromRow(row),
    campaignContext: campaignContext(row.campaign_id),
    entityContext: targetContext(row),
    references,
    assets: listAssets({ jobId: row.id }),
  };
}

export function claimJob(jobId: string, workerId: string, leaseSeconds = 900) {
  ensureAssetPipelineSchema();
  expireClaims();
  const lease = Math.min(Math.max(Math.floor(leaseSeconds), 30), 86_400);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + lease * 1000).toISOString();
  const result = getDatabase().prepare(`
    UPDATE asset_jobs
    SET status = 'claimed', claimed_by = ?, claim_expires_at = ?, attempts = attempts + 1,
        error = NULL, updated_at = ?
    WHERE id = ? AND status IN ('available','failed')
  `).run(workerId.trim(), expiresAt, now, jobId);
  if (!result.changes) {
    const current = requireJob(jobId);
    throw new Error(`Asset job is not claimable; current status is ${current.status}.`);
  }
  const job = getJob(jobId)!;
  recomputePack(job.packId);
  return job;
}

function assertWorkerLease(job: JobRow, workerId: string) {
  if (!job.claimed_by || job.claimed_by !== workerId) throw new Error("Asset job is claimed by another worker.");
  if (!job.claim_expires_at || job.claim_expires_at <= nowIso()) throw new Error("Asset job claim has expired.");
}

export function releaseJob(jobId: string, workerId: string) {
  const job = requireJob(jobId);
  assertWorkerLease(job, workerId);
  const nextStatus = job.status === "ready" ? "ready" : "available";
  getDatabase().prepare(`
    UPDATE asset_jobs SET status = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?
  `).run(nextStatus, nowIso(), jobId);
  recomputePack(job.pack_id);
  return getJob(jobId)!;
}

export function failJob(jobId: string, workerId: string, error: string) {
  const job = requireJob(jobId);
  assertWorkerLease(job, workerId);
  getDatabase().prepare(`
    UPDATE asset_jobs SET status = 'failed', error = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?
  `).run(error.trim().slice(0, 4000), nowIso(), jobId);
  recomputePack(job.pack_id);
  return getJob(jobId)!;
}

export function createUploadGrant(input: {
  jobId: string;
  workerId: string;
  expectedMimeType?: AssetMimeType | null;
  expectedMaxBytes?: number | null;
  expiresInSeconds?: number;
}) {
  ensureAssetPipelineSchema();
  expireClaims();
  const job = requireJob(input.jobId);
  if (!["claimed", "uploading", "ready"].includes(job.status)) throw new Error("Job must be claimed before requesting an upload.");
  assertWorkerLease(job, input.workerId);
  if (input.expectedMimeType && !ASSET_MIME_TYPES.includes(input.expectedMimeType)) throw new Error("Unsupported expected MIME type.");
  const maxBytes = Math.min(
    Math.max(Math.floor(input.expectedMaxBytes ?? configuredAssetMaxBytes()), 1),
    configuredAssetMaxBytes(),
  );
  const active = getDatabase().prepare(`
    SELECT COUNT(*) AS n FROM asset_access_grants
    WHERE job_id = ? AND operation = 'upload' AND status IN ('granted','receiving','uploaded') AND expires_at > ?
  `).get(job.id, nowIso()) as { n: number };
  if (active.n >= 8) throw new Error("Too many active upload grants for this job.");
  const expiresIn = Math.min(Math.max(Math.floor(input.expiresInSeconds ?? 600), 60), 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const token = generatedToken();
  const uploadId = crypto.randomUUID();
  getDatabase().transaction(() => {
    getDatabase().prepare(`
      INSERT INTO asset_access_grants (
        id, operation, campaign_id, job_id, asset_id, token_hash, expected_mime_type,
        max_bytes, status, expires_at, created_at
      ) VALUES (?, 'upload', ?, ?, NULL, ?, ?, ?, 'granted', ?, ?)
    `).run(uploadId, job.campaign_id, job.id, hashToken(token), input.expectedMimeType ?? null, maxBytes, expiresAt, nowIso());
    if (job.status !== "ready") {
      getDatabase().prepare("UPDATE asset_jobs SET status = 'uploading', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
    }
  })();
  return {
    uploadId,
    token,
    expiresAt,
    maxBytes,
    acceptedMimeTypes: [...ASSET_MIME_TYPES],
  };
}

export function beginUploadGrant(uploadId: string, token: string) {
  ensureAssetPipelineSchema();
  expireClaims();
  const db = getDatabase();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM asset_access_grants WHERE id = ? AND operation = 'upload'").get(uploadId) as GrantRow | undefined;
    if (!row || !tokenMatches(token, row.token_hash)) throw new Error("Invalid upload grant.");
    if (row.status !== "granted") throw new Error("Upload grant has already been used.");
    if (row.expires_at <= nowIso()) {
      db.prepare("UPDATE asset_access_grants SET status = 'expired' WHERE id = ?").run(uploadId);
      throw new Error("Upload grant has expired.");
    }
    const result = db.prepare("UPDATE asset_access_grants SET status = 'receiving' WHERE id = ? AND status = 'granted'").run(uploadId);
    if (!result.changes) throw new Error("Upload grant has already been used.");
    return grantFromRow({ ...row, status: "receiving" });
  })();
}

export function finishUploadGrant(uploadId: string, inspected: InspectedImage, bytes: Buffer) {
  ensureAssetPipelineSchema();
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM asset_access_grants WHERE id = ? AND operation = 'upload'").get(uploadId) as GrantRow | undefined;
  if (!row || row.status !== "receiving") throw new Error("Upload grant is not receiving data.");
  if (row.max_bytes != null && inspected.byteSize > row.max_bytes) throw new Error("Asset exceeds upload grant size limit.");
  if (row.expected_mime_type && row.expected_mime_type !== inspected.mimeType) throw new Error("Uploaded image MIME does not match the grant.");
  const stagingKey = assetStorage().writeStaged(uploadId, bytes, inspected.extension);
  db.prepare(`
    UPDATE asset_access_grants
    SET status = 'uploaded', staging_key = ?, byte_size = ?, mime_type = ?, width = ?, height = ?, sha256 = ?
    WHERE id = ? AND status = 'receiving'
  `).run(stagingKey, inspected.byteSize, inspected.mimeType, inspected.width, inspected.height, inspected.sha256, uploadId);
  return grantFromRow({ ...row, status: "uploaded", staging_key: stagingKey, byte_size: inspected.byteSize, mime_type: inspected.mimeType, width: inspected.width, height: inspected.height, sha256: inspected.sha256 });
}

export function failUploadGrant(uploadId: string) {
  ensureAssetPipelineSchema();
  getDatabase().prepare("UPDATE asset_access_grants SET status = 'failed', consumed_at = ? WHERE id = ? AND status = 'receiving'").run(nowIso(), uploadId);
}

export function submitResult(input: {
  jobId: string;
  uploadId: string;
  workerId: string;
  provider?: string;
  model?: string;
  promptUsed?: string;
  revisedPrompt?: string;
  seed?: string | number | null;
  metadata?: unknown;
  setPrimary?: boolean;
  variantLabel?: string;
}) {
  ensureAssetPipelineSchema();
  expireClaims();
  const db = getDatabase();
  const job = requireJob(input.jobId);
  assertWorkerLease(job, input.workerId);
  const grant = db.prepare("SELECT * FROM asset_access_grants WHERE id = ? AND operation = 'upload' AND job_id = ?").get(input.uploadId, input.jobId) as GrantRow | undefined;
  if (!grant || grant.status !== "uploaded" || !grant.staging_key || !grant.mime_type || !grant.sha256 || !grant.width || !grant.height || !grant.byte_size) {
    throw new Error("Upload is not ready for submission.");
  }
  const duplicate = db.prepare("SELECT * FROM asset_files WHERE job_id = ? AND sha256 = ? AND deleted_at IS NULL").get(job.id, grant.sha256) as AssetRow | undefined;
  if (duplicate) {
    assetStorage().delete(grant.staging_key);
    db.prepare("UPDATE asset_access_grants SET status = 'consumed', consumed_at = ? WHERE id = ?").run(nowIso(), grant.id);
    return { asset: assetFromRow(duplicate), duplicate: true, job: getJob(job.id)! };
  }
  const assetId = crypto.randomUUID();
  const extension = grant.mime_type === "image/png" ? "png" : grant.mime_type === "image/webp" ? "webp" : "jpg";
  const written = assetStorage().finalizeStaged({
    stagingKey: grant.staging_key,
    campaignId: job.campaign_id,
    packId: job.pack_id,
    assetId,
    extension,
  });
  try {
    db.transaction(() => {
      if (input.setPrimary !== false) db.prepare("UPDATE asset_files SET is_primary = 0 WHERE job_id = ?").run(job.id);
      db.prepare(`
        INSERT INTO asset_files (
          id, pack_id, job_id, campaign_id, kind, filename, mime_type, storage_key, byte_size,
          sha256, width, height, provider, model, prompt_used, revised_prompt, seed, variant_label,
          is_primary, metadata_json, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        assetId,
        job.pack_id,
        job.id,
        job.campaign_id,
        job.kind,
        written.filename,
        grant.mime_type,
        written.storageKey,
        grant.byte_size,
        grant.sha256,
        grant.width,
        grant.height,
        input.provider?.trim() || "external",
        input.model?.trim() || "",
        input.promptUsed?.trim() || job.suggested_prompt,
        input.revisedPrompt?.trim() || "",
        input.seed == null ? null : String(input.seed),
        input.variantLabel?.trim() || "",
        input.setPrimary === false ? 0 : 1,
        stringify(input.metadata),
        nowIso(),
      );
      db.prepare("UPDATE asset_access_grants SET status = 'consumed', consumed_at = ? WHERE id = ?").run(nowIso(), grant.id);
      db.prepare("UPDATE asset_jobs SET status = 'ready', error = NULL, ready_at = COALESCE(ready_at, ?), updated_at = ? WHERE id = ?")
        .run(nowIso(), nowIso(), job.id);
      if (job.target_id) {
        if (input.setPrimary !== false) {
          db.prepare(`UPDATE asset_links SET is_primary = 0 WHERE campaign_id = ? AND entity_type = ? AND entity_id = ? AND role = 'primary'`)
            .run(job.campaign_id, job.target_type, job.target_id);
        }
        db.prepare(`
          INSERT OR REPLACE INTO asset_links (asset_id, campaign_id, entity_type, entity_id, role, is_primary, created_at)
          VALUES (?, ?, ?, ?, 'primary', ?, ?)
        `).run(assetId, job.campaign_id, job.target_type, job.target_id, input.setPrimary === false ? 0 : 1, nowIso());
      }
    })();
  } catch (error) {
    assetStorage().delete(written.storageKey);
    throw error;
  }
  recomputePack(job.pack_id);
  return { asset: getAsset(assetId)!, duplicate: false, job: getJob(job.id)! };
}

export function listAssets(input: {
  campaignId?: string;
  packId?: string;
  jobId?: string;
  kind?: ArtKind;
  includeDeleted?: boolean;
} = {}) {
  ensureAssetPipelineSchema();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!input.includeDeleted) clauses.push("deleted_at IS NULL");
  if (input.campaignId) {
    clauses.push("campaign_id = ?");
    params.push(input.campaignId);
  }
  if (input.packId) {
    clauses.push("pack_id = ?");
    params.push(input.packId);
  }
  if (input.jobId) {
    clauses.push("job_id = ?");
    params.push(input.jobId);
  }
  if (input.kind) {
    clauses.push("kind = ?");
    params.push(input.kind);
  }
  const sql = `SELECT * FROM asset_files${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY is_primary DESC, created_at DESC`;
  return (getDatabase().prepare(sql).all(...params) as AssetRow[]).map(assetFromRow);
}

export function getAsset(assetId: string) {
  ensureAssetPipelineSchema();
  const row = getDatabase().prepare("SELECT * FROM asset_files WHERE id = ? AND deleted_at IS NULL").get(assetId) as AssetRow | undefined;
  if (!row) return null;
  return {
    ...assetFromRow(row),
    links: listLinks({ assetId }),
  };
}

export function listLinks(input: { assetId?: string; campaignId?: string; entityType?: AssetEntityType; entityId?: string } = {}) {
  ensureAssetPipelineSchema();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.assetId) {
    clauses.push("asset_id = ?");
    params.push(input.assetId);
  }
  if (input.campaignId) {
    clauses.push("campaign_id = ?");
    params.push(input.campaignId);
  }
  if (input.entityType) {
    clauses.push("entity_type = ?");
    params.push(input.entityType);
  }
  if (input.entityId) {
    clauses.push("entity_id = ?");
    params.push(input.entityId);
  }
  const sql = `SELECT * FROM asset_links${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY is_primary DESC, created_at ASC`;
  return (getDatabase().prepare(sql).all(...params) as LinkRow[]).map(linkFromRow);
}

export function attachAsset(input: { assetId: string; entityType: AssetEntityType; entityId: string; role?: string; setPrimary?: boolean }) {
  const asset = requireAsset(input.assetId);
  const role = input.role?.trim() || "primary";
  const db = getDatabase();
  db.transaction(() => {
    if (input.setPrimary) {
      db.prepare("UPDATE asset_links SET is_primary = 0 WHERE campaign_id = ? AND entity_type = ? AND entity_id = ? AND role = ?")
        .run(asset.campaign_id, input.entityType, input.entityId, role);
    }
    db.prepare(`
      INSERT OR REPLACE INTO asset_links (asset_id, campaign_id, entity_type, entity_id, role, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(asset.id, asset.campaign_id, input.entityType, input.entityId, role, input.setPrimary ? 1 : 0, nowIso());
  })();
  return listLinks({ assetId: asset.id });
}

export function detachAsset(input: { assetId: string; entityType: AssetEntityType; entityId: string; role?: string }) {
  requireAsset(input.assetId);
  getDatabase().prepare("DELETE FROM asset_links WHERE asset_id = ? AND entity_type = ? AND entity_id = ? AND role = ?")
    .run(input.assetId, input.entityType, input.entityId, input.role?.trim() || "primary");
  return listLinks({ assetId: input.assetId });
}

export function setPrimaryAsset(input: { assetId: string; entityType?: AssetEntityType; entityId?: string; role?: string }) {
  const asset = requireAsset(input.assetId);
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("UPDATE asset_files SET is_primary = 0 WHERE job_id = ?").run(asset.job_id);
    db.prepare("UPDATE asset_files SET is_primary = 1 WHERE id = ?").run(asset.id);
    if (input.entityType && input.entityId) {
      const role = input.role?.trim() || "primary";
      db.prepare("UPDATE asset_links SET is_primary = 0 WHERE campaign_id = ? AND entity_type = ? AND entity_id = ? AND role = ?")
        .run(asset.campaign_id, input.entityType, input.entityId, role);
      db.prepare(`
        INSERT OR REPLACE INTO asset_links (asset_id, campaign_id, entity_type, entity_id, role, is_primary, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(asset.id, asset.campaign_id, input.entityType, input.entityId, role, nowIso());
    }
  })();
  return getAsset(asset.id)!;
}

export function deleteAsset(assetId: string, confirm: boolean, force = false) {
  if (!confirm) throw new Error("delete_asset requires confirm=true.");
  const asset = requireAsset(assetId);
  const links = listLinks({ assetId });
  if (links.length && !force) throw new Error("Asset is still linked; detach it first or pass force=true.");
  const db = getDatabase();
  db.transaction(() => {
    if (force) db.prepare("DELETE FROM asset_links WHERE asset_id = ?").run(asset.id);
    db.prepare("UPDATE asset_files SET deleted_at = ?, is_primary = 0 WHERE id = ?").run(nowIso(), asset.id);
  })();
  assetStorage().delete(asset.storage_key);
  return { deleted: true, assetId: asset.id, removedLinks: force ? links.length : 0 };
}

export function deletePack(packId: string, confirm: boolean, deleteAssets = false) {
  if (!confirm) throw new Error("delete_pack requires confirm=true.");
  const pack = requirePack(packId);
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("UPDATE asset_packs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), pack.id);
    db.prepare("UPDATE asset_jobs SET status = 'cancelled', claimed_by = NULL, claim_expires_at = NULL, updated_at = ? WHERE pack_id = ? AND status <> 'ready'")
      .run(nowIso(), pack.id);
  })();
  const retained: string[] = [];
  const deleted: string[] = [];
  if (deleteAssets) {
    for (const asset of listAssets({ packId: pack.id })) {
      if (listLinks({ assetId: asset.id }).length) {
        retained.push(asset.id);
      } else {
        deleteAsset(asset.id, true, false);
        deleted.push(asset.id);
      }
    }
  }
  return { pack: getPack(pack.id), deletedAssets: deleted, retainedLinkedAssets: retained };
}

function recomputePack(packId: string) {
  ensureAssetPipelineSchema();
  const db = getDatabase();
  const pack = db.prepare("SELECT * FROM asset_packs WHERE id = ?").get(packId) as PackRow | undefined;
  if (!pack || pack.status === "cancelled") return;
  const rows = db.prepare("SELECT status FROM asset_jobs WHERE pack_id = ?").all(packId) as Array<{ status: JobStatus }>;
  let status: PackStatus = "active";
  if (!rows.length) status = "planned";
  else if (rows.every((row) => row.status === "ready" || row.status === "cancelled")) status = "ready";
  else if (rows.every((row) => row.status === "failed" || row.status === "cancelled")) status = "failed";
  db.prepare("UPDATE asset_packs SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), packId);
}

export function createDownloadGrant(assetId: string, expiresInSeconds = 600) {
  ensureAssetPipelineSchema();
  expireClaims();
  const asset = requireAsset(assetId);
  if (!assetStorage().exists(asset.storage_key)) throw new Error("Asset file is unavailable.");
  const token = generatedToken();
  const id = crypto.randomUUID();
  const expiresIn = Math.min(Math.max(Math.floor(expiresInSeconds), 60), 3600);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  getDatabase().prepare(`
    INSERT INTO asset_access_grants (
      id, operation, campaign_id, job_id, asset_id, token_hash, status, expires_at, created_at
    ) VALUES (?, 'download', ?, ?, ?, ?, 'granted', ?, ?)
  `).run(id, asset.campaign_id, asset.job_id, asset.id, hashToken(token), expiresAt, nowIso());
  return { downloadId: id, token, expiresAt, mimeType: asset.mime_type, byteSize: asset.byte_size, filename: asset.filename };
}

export function consumeDownloadGrant(downloadId: string, token: string) {
  ensureAssetPipelineSchema();
  expireClaims();
  const db = getDatabase();
  return db.transaction(() => {
    const grant = db.prepare("SELECT * FROM asset_access_grants WHERE id = ? AND operation = 'download'").get(downloadId) as GrantRow | undefined;
    if (!grant || !tokenMatches(token, grant.token_hash)) throw new Error("Invalid download grant.");
    if (grant.status !== "granted") throw new Error("Download grant has already been used.");
    if (grant.expires_at <= nowIso()) {
      db.prepare("UPDATE asset_access_grants SET status = 'expired' WHERE id = ?").run(downloadId);
      throw new Error("Download grant has expired.");
    }
    if (!grant.asset_id) throw new Error("Download grant has no asset.");
    const asset = requireAsset(grant.asset_id);
    const result = db.prepare("UPDATE asset_access_grants SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'granted'").run(nowIso(), downloadId);
    if (!result.changes) throw new Error("Download grant has already been used.");
    return assetFromRow(asset);
  })();
}

export function assetHealth(campaignId?: string) {
  ensureAssetPipelineSchema();
  expireClaims();
  const assets = listAssets({ campaignId });
  const missingFiles = assets.filter((asset) => !assetStorage().exists(asset.storageKey)).map((asset) => asset.id);
  const brokenLinks = (getDatabase().prepare(`
    SELECT l.* FROM asset_links l
    LEFT JOIN asset_files a ON a.id = l.asset_id
    WHERE (a.id IS NULL OR a.deleted_at IS NOT NULL)${campaignId ? " AND l.campaign_id = ?" : ""}
  `).all(...(campaignId ? [campaignId] : [])) as LinkRow[]).map(linkFromRow);
  const staleUploads = (getDatabase().prepare(`
    SELECT id FROM asset_access_grants WHERE operation = 'upload' AND status IN ('failed','expired') AND staging_key IS NOT NULL
    ${campaignId ? "AND campaign_id = ?" : ""}
  `).all(...(campaignId ? [campaignId] : [])) as Array<{ id: string }>).map((row) => row.id);
  return {
    ok: missingFiles.length === 0 && brokenLinks.length === 0 && staleUploads.length === 0,
    storage: { kind: assetStorage().kind, root: assetStorage().root },
    assets: assets.length,
    missingFiles,
    brokenLinks,
    staleUploads,
  };
}
