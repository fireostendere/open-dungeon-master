import crypto from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/core";

export type AssetState = "planned" | "running" | "ready" | "failed" | "rejected" | "deleted";
export type AssetRefType =
  | "campaign"
  | "session"
  | "character"
  | "location"
  | "item"
  | "encounter"
  | "quest"
  | "journal_entry";

export type AssetRecord = {
  id: string;
  campaignId: string;
  kind: string;
  query: string;
  requestKey: string;
  entityId: string | null;
  reason: string | null;
  constraints: unknown;
  seed: string | null;
  sourceHint: string | null;
  providerHint: string | null;
  state: AssetState;
  relativePath: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  metadata: unknown;
  pinned: boolean;
  expiresAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  deletedAt: string | null;
};

export type AssetRef = {
  assetId: string;
  refType: AssetRefType;
  refId: string;
  role: string;
  createdAt: string;
};

type AssetRow = {
  id: string;
  campaign_id: string;
  kind: string;
  query: string;
  request_key: string;
  entity_id: string | null;
  reason: string | null;
  constraints_json: string;
  seed: string | null;
  source_hint: string | null;
  provider_hint: string | null;
  state: AssetState;
  relative_path: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  metadata_json: string;
  pinned: number;
  expires_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  deleted_at: string | null;
};

type RefRow = {
  asset_id: string;
  ref_type: AssetRefType;
  ref_id: string;
  role: string;
  created_at: string;
};

const DEFAULT_PENDING_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const HARD_MAX_BYTES = 64 * 1024 * 1024;
const ALLOWED_REF_TYPES = new Set<AssetRefType>([
  "campaign",
  "session",
  "character",
  "location",
  "item",
  "encounter",
  "quest",
  "journal_entry",
]);

function nowIso() {
  return new Date().toISOString();
}

function jsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rowToAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    query: row.query,
    requestKey: row.request_key,
    entityId: row.entity_id,
    reason: row.reason,
    constraints: jsonParse(row.constraints_json),
    seed: row.seed,
    sourceHint: row.source_hint,
    providerHint: row.provider_hint,
    state: row.state,
    relativePath: row.relative_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    metadata: jsonParse(row.metadata_json),
    pinned: row.pinned === 1,
    expiresAt: row.expires_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    deletedAt: row.deleted_at,
  };
}

function rowToRef(row: RefRow): AssetRef {
  return {
    assetId: row.asset_id,
    refType: row.ref_type,
    refId: row.ref_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function ensureAssetSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS odm_assets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      query TEXT NOT NULL,
      request_key TEXT NOT NULL,
      entity_id TEXT,
      reason TEXT,
      constraints_json TEXT NOT NULL DEFAULT '{}',
      seed TEXT,
      source_hint TEXT,
      provider_hint TEXT,
      state TEXT NOT NULL DEFAULT 'planned'
        CHECK (state IN ('planned','running','ready','failed','rejected','deleted')),
      relative_path TEXT,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
      expires_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accepted_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_odm_assets_campaign_state
      ON odm_assets(campaign_id, state, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_odm_assets_active_request
      ON odm_assets(request_key)
      WHERE state IN ('planned','running','ready');

    CREATE TABLE IF NOT EXISTS odm_asset_refs (
      asset_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, ref_type, ref_id, role),
      FOREIGN KEY (asset_id) REFERENCES odm_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_odm_asset_refs_target
      ON odm_asset_refs(ref_type, ref_id);
  `);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

export function buildAssetRequestKey(input: {
  campaignId: string;
  kind: string;
  query: string;
  entityId?: string | null;
  constraints?: unknown;
  seed?: string | number | null;
  sourceHint?: string | null;
  providerHint?: string | null;
}) {
  const canonical = JSON.stringify(
    stable({
      campaignId: input.campaignId,
      kind: input.kind.trim().toLowerCase(),
      query: input.query.trim(),
      entityId: input.entityId ?? null,
      constraints: input.constraints ?? {},
      seed: input.seed == null ? null : String(input.seed),
      sourceHint: input.sourceHint ?? null,
      providerHint: input.providerHint ?? null,
    }),
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function getAsset(assetId: string): AssetRecord | null {
  ensureAssetSchema();
  const row = getDatabase().prepare("SELECT * FROM odm_assets WHERE id = ?").get(assetId) as AssetRow | undefined;
  return row ? rowToAsset(row) : null;
}

export function planAsset(input: {
  campaignId: string;
  kind: string;
  query: string;
  entityId?: string | null;
  reason?: string | null;
  constraints?: unknown;
  seed?: string | number | null;
  sourceHint?: string | null;
  providerHint?: string | null;
  pendingTtlMs?: number;
}): { asset: AssetRecord; reused: boolean } {
  ensureAssetSchema();
  const db = getDatabase();
  const kind = input.kind.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(kind)) throw new Error("Invalid asset kind.");
  const query = input.query.trim();
  if (!query) throw new Error("Asset query is required.");
  const requestKey = buildAssetRequestKey({ ...input, kind, query });
  const ttl = Math.min(Math.max(input.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS, 60_000), 24 * 60 * 60 * 1000);

  return db.transaction(() => {
    const now = nowIso();
    const existing = db
      .prepare("SELECT * FROM odm_assets WHERE request_key = ? AND state IN ('planned','running','ready') ORDER BY created_at DESC LIMIT 1")
      .get(requestKey) as AssetRow | undefined;
    if (existing) {
      if (existing.state === "ready" || !existing.expires_at || existing.expires_at > now) {
        return { asset: rowToAsset(existing), reused: true };
      }
      db.prepare("UPDATE odm_assets SET state = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run("pending request expired", now, existing.id);
    }

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    db.prepare(`
      INSERT INTO odm_assets (
        id, campaign_id, kind, query, request_key, entity_id, reason, constraints_json,
        seed, source_hint, provider_hint, state, metadata_json, pinned, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', '{}', 0, ?, ?, ?)
    `).run(
      id,
      input.campaignId,
      kind,
      query,
      requestKey,
      input.entityId ?? null,
      input.reason ?? null,
      JSON.stringify(input.constraints ?? {}),
      input.seed == null ? null : String(input.seed),
      input.sourceHint ?? null,
      input.providerHint ?? null,
      expiresAt,
      now,
      now,
    );
    const created = db.prepare("SELECT * FROM odm_assets WHERE id = ?").get(id) as AssetRow;
    return { asset: rowToAsset(created), reused: false };
  })();
}

export function listAssets(input: { assetId?: string; campaignId?: string; state?: AssetState }) {
  ensureAssetSchema();
  if (input.assetId) {
    const asset = getAsset(input.assetId);
    return asset ? [asset] : [];
  }
  if (!input.campaignId) throw new Error("assetId or campaignId is required.");
  const rows = input.state
    ? getDatabase().prepare("SELECT * FROM odm_assets WHERE campaign_id = ? AND state = ? ORDER BY created_at DESC").all(input.campaignId, input.state)
    : getDatabase().prepare("SELECT * FROM odm_assets WHERE campaign_id = ? ORDER BY created_at DESC").all(input.campaignId);
  return (rows as AssetRow[]).map(rowToAsset);
}

export function rejectAsset(assetId: string, reason?: string | null) {
  ensureAssetSchema();
  const now = nowIso();
  const result = getDatabase()
    .prepare("UPDATE odm_assets SET state = 'rejected', error = ?, updated_at = ? WHERE id = ? AND state IN ('planned','running')")
    .run(reason?.trim() || "rejected", now, assetId);
  if (!result.changes) {
    const current = getAsset(assetId);
    if (!current) throw new Error("Asset not found.");
    if (current.state !== "rejected") throw new Error(`Asset cannot be rejected from state ${current.state}.`);
  }
  return getAsset(assetId)!;
}

function configuredMaxBytes() {
  const parsed = Number(process.env.ODM_ASSET_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(parsed), HARD_MAX_BYTES);
}

function uploadRoot() {
  return path.resolve(process.cwd(), "public", "uploads");
}

function mediaRoot() {
  return path.resolve(process.env.ODM_MEDIA_ROOT?.trim() || path.join(process.cwd(), "data", "media"));
}

function tempRoots() {
  const configured = (process.env.ODM_ASSET_TEMP_DIRS ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  return Array.from(new Set([...configured, uploadRoot()]));
}

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourceFromUploadId(uploadedFileId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uploadedFileId)) throw new Error("Invalid uploaded_file_id.");
  const root = uploadRoot();
  if (!existsSync(root)) throw new Error("Upload store is unavailable.");
  const matches = readdirSync(root).filter((name) => path.parse(name).name === uploadedFileId);
  if (matches.length !== 1) throw new Error(matches.length ? "uploaded_file_id is ambiguous." : "Uploaded file not found.");
  return path.join(root, matches[0]!);
}

function resolveSafeSource(input: { tempPath?: string | null; uploadedFileId?: string | null }) {
  if (Boolean(input.tempPath) === Boolean(input.uploadedFileId)) {
    throw new Error("Provide exactly one of temp_path or uploaded_file_id.");
  }
  const supplied = input.uploadedFileId ? sourceFromUploadId(input.uploadedFileId) : path.resolve(input.tempPath!);
  if (!existsSync(supplied)) throw new Error("Source file not found.");
  const lst = lstatSync(supplied);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new Error("Source must be a regular non-symlink file.");
  const real = realpathSync(supplied);
  if (path.resolve(supplied) !== real) throw new Error("Symlinked source paths are not allowed.");
  const allowed = tempRoots().some((root) => {
    if (!existsSync(root)) return false;
    const rootReal = realpathSync(root);
    return within(rootReal, real);
  });
  if (!allowed) throw new Error("Source path is outside ODM_ASSET_TEMP_DIRS.");
  return real;
}

function inspectImage(file: string) {
  const size = statSync(file).size;
  if (size <= 0 || size > configuredMaxBytes()) throw new Error("Asset file exceeds the configured size limit or is empty.");
  const bytes = readFileSync(file);
  let mimeType: string;
  let extension: string;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mimeType = "image/png";
    extension = ".png";
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = "image/jpeg";
    extension = ".jpg";
  } else if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    mimeType = "image/webp";
    extension = ".webp";
  } else {
    throw new Error("Unsupported or invalid image signature. Only PNG, JPEG and WebP are accepted.");
  }
  const sourceExt = path.extname(file).toLowerCase();
  const allowedForMime = mimeType === "image/jpeg" ? new Set([".jpg", ".jpeg"]) : new Set([extension]);
  if (!allowedForMime.has(sourceExt)) throw new Error("File extension does not match image signature.");
  return {
    bytes,
    size,
    mimeType,
    extension,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function acceptAsset(input: {
  assetId: string;
  tempPath?: string | null;
  uploadedFileId?: string | null;
  metadata?: unknown;
}) {
  ensureAssetSchema();
  const db = getDatabase();
  const source = resolveSafeSource(input);
  const inspected = inspectImage(source);
  const asset = getAsset(input.assetId);
  if (!asset) throw new Error("Asset not found.");
  if (asset.state === "ready") {
    if (asset.sha256 === inspected.sha256) return asset;
    throw new Error("Asset is already ready with different content.");
  }
  if (asset.state !== "planned" && asset.state !== "running") {
    throw new Error(`Asset cannot be accepted from state ${asset.state}.`);
  }

  const locked = db.transaction(() => {
    const row = db.prepare("SELECT * FROM odm_assets WHERE id = ?").get(input.assetId) as AssetRow | undefined;
    if (!row) throw new Error("Asset not found.");
    if (row.state === "ready") return rowToAsset(row);
    if (row.state !== "planned") throw new Error(`Asset cannot be accepted from state ${row.state}.`);
    db.prepare("UPDATE odm_assets SET state = 'running', updated_at = ? WHERE id = ?").run(nowIso(), input.assetId);
    return null;
  })();
  if (locked) return locked;

  const safeKind = asset.kind.replace(/[^a-z0-9_-]/g, "_");
  const dir = path.join(mediaRoot(), "campaigns", asset.campaignId, safeKind, asset.id);
  const filename = `asset${inspected.extension}`;
  const destination = path.join(dir, filename);
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(source, destination);
    const relativePath = path.relative(mediaRoot(), destination).split(path.sep).join("/");
    const now = nowIso();
    db.prepare(`
      UPDATE odm_assets
      SET state = 'ready', relative_path = ?, filename = ?, mime_type = ?, size_bytes = ?,
          sha256 = ?, metadata_json = ?, error = NULL, accepted_at = ?, updated_at = ?, expires_at = NULL
      WHERE id = ? AND state = 'running'
    `).run(
      relativePath,
      filename,
      inspected.mimeType,
      inspected.size,
      inspected.sha256,
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
      input.assetId,
    );
  } catch (error) {
    db.prepare("UPDATE odm_assets SET state = 'failed', error = ?, updated_at = ? WHERE id = ? AND state = 'running'")
      .run(error instanceof Error ? error.message : "asset ingest failed", nowIso(), input.assetId);
    throw error;
  }
  return getAsset(input.assetId)!;
}

export function pinAsset(assetId: string, pinned: boolean) {
  ensureAssetSchema();
  const result = getDatabase().prepare("UPDATE odm_assets SET pinned = ?, updated_at = ? WHERE id = ? AND state <> 'deleted'")
    .run(pinned ? 1 : 0, nowIso(), assetId);
  if (!result.changes) throw new Error("Asset not found or deleted.");
  return getAsset(assetId)!;
}

export function listAssetRefs(assetId: string) {
  ensureAssetSchema();
  return (getDatabase().prepare("SELECT * FROM odm_asset_refs WHERE asset_id = ? ORDER BY created_at ASC").all(assetId) as RefRow[]).map(rowToRef);
}

export function addAssetRef(input: { assetId: string; refType: AssetRefType; refId: string; role?: string }) {
  ensureAssetSchema();
  if (!ALLOWED_REF_TYPES.has(input.refType)) throw new Error("Unsupported asset ref type.");
  const asset = getAsset(input.assetId);
  if (!asset || asset.state !== "ready") throw new Error("Only ready assets can be referenced.");
  getDatabase().prepare("INSERT OR IGNORE INTO odm_asset_refs (asset_id, ref_type, ref_id, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.assetId, input.refType, input.refId, input.role?.trim() || "primary", nowIso());
  return listAssetRefs(input.assetId);
}

export function removeAssetRef(input: { assetId: string; refType: AssetRefType; refId: string; role?: string }) {
  ensureAssetSchema();
  const role = input.role?.trim() || "primary";
  getDatabase().prepare("DELETE FROM odm_asset_refs WHERE asset_id = ? AND ref_type = ? AND ref_id = ? AND role = ?")
    .run(input.assetId, input.refType, input.refId, role);
  return listAssetRefs(input.assetId);
}

export function deleteAsset(assetId: string, force = false) {
  ensureAssetSchema();
  const db = getDatabase();
  const asset = getAsset(assetId);
  if (!asset) throw new Error("Asset not found.");
  if (asset.state === "deleted") return asset;
  if (asset.pinned && !force) throw new Error("Pinned asset cannot be deleted without force=true.");
  const refs = listAssetRefs(assetId);
  if (refs.length && !force) throw new Error("Referenced asset cannot be deleted without force=true.");

  db.transaction(() => {
    if (force) db.prepare("DELETE FROM odm_asset_refs WHERE asset_id = ?").run(assetId);
    const now = nowIso();
    db.prepare("UPDATE odm_assets SET state = 'deleted', pinned = 0, deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, assetId);
  })();

  if (asset.relativePath) {
    const target = path.resolve(mediaRoot(), asset.relativePath);
    if (within(mediaRoot(), target)) {
      try {
        rmSync(path.dirname(target), { recursive: true, force: true });
      } catch {
        // DB state is authoritative; healthAssetStore reports leftover/missing files for repair.
      }
    }
  }
  return getAsset(assetId)!;
}

export function healthAssetStore(campaignId?: string) {
  ensureAssetSchema();
  const db = getDatabase();
  const readyRows = (campaignId
    ? db.prepare("SELECT * FROM odm_assets WHERE campaign_id = ? AND state = 'ready'").all(campaignId)
    : db.prepare("SELECT * FROM odm_assets WHERE state = 'ready'").all()) as AssetRow[];
  const missingFiles: string[] = [];
  for (const row of readyRows) {
    if (!row.relative_path || !existsSync(path.resolve(mediaRoot(), row.relative_path))) missingFiles.push(row.id);
  }
  const brokenRefs = db.prepare(`
    SELECT r.asset_id AS asset_id, r.ref_type AS ref_type, r.ref_id AS ref_id, r.role AS role, r.created_at AS created_at
    FROM odm_asset_refs r LEFT JOIN odm_assets a ON a.id = r.asset_id
    WHERE a.id IS NULL OR a.state = 'deleted'
  `).all() as RefRow[];
  return {
    ok: missingFiles.length === 0 && brokenRefs.length === 0,
    mediaRoot: mediaRoot(),
    readyAssets: readyRows.length,
    missingFiles,
    brokenRefs: brokenRefs.map(rowToRef),
  };
}
