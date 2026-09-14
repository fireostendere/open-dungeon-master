import crypto from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import { getCharacter, syncProgressToLibrary } from "@/lib/db/characters";
import { getSheetById, listSheets } from "@/lib/db/sheets";

export class ProgressConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressConflictError";
  }
}

type ProgressStateRow = {
  library_character_id: string;
  revision: number;
  last_synced_at: string | null;
  last_sheet_id: string | null;
  last_sheet_updated_at: string | null;
  last_library_updated_at: string | null;
};

type ProgressEventRow = {
  id: string;
  library_character_id: string;
  campaign_character_id: string;
  campaign_id: string;
  revision: number;
  expected_version: number | null;
  source_sheet_updated_at: string;
  delta_json: string;
  snapshot_json: string;
  created_at: string;
};

export type ProgressSnapshot = {
  level: number;
  xp: number;
  milestone: { level: number; xp: number };
  hp: { current: number; max: number; temp: number };
  conditions: unknown;
  inspiration: unknown;
  exhaustion: number;
  hitDice: unknown;
  hitDicePools: unknown;
  spellSlots: unknown;
  attunement: unknown;
  deathSaves: unknown;
  wealth: { gold: number; copper: number };
  consumables: unknown;
  statuses: unknown;
  durable: unknown;
  sheetUpdatedAt: string;
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

export function ensureProgressSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS character_progress_state (
      library_character_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      last_sheet_id TEXT,
      last_sheet_updated_at TEXT,
      last_library_updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS character_progress_events (
      id TEXT PRIMARY KEY,
      library_character_id TEXT NOT NULL,
      campaign_character_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      expected_version INTEGER,
      source_sheet_updated_at TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_character_progress_revision
      ON character_progress_events(library_character_id, revision);
    CREATE INDEX IF NOT EXISTS idx_character_progress_campaign
      ON character_progress_events(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_character_progress_sheet
      ON character_progress_events(campaign_character_id, created_at DESC);
  `);
}

function durableSnapshot(sheet: NonNullable<ReturnType<typeof getSheetById>>) {
  return {
    level: sheet.level,
    xp: sheet.xp,
    subclass: sheet.subclass,
    classes: sheet.classes,
    abilities: sheet.abilities,
    maxHp: sheet.maxHp,
    ac: sheet.ac,
    equipment: sheet.equipment,
    gold: sheet.gold,
    feats: sheet.feats,
    features: sheet.features,
    spellcasting: sheet.spellcasting
      ? {
          ...sheet.spellcasting,
          slots: Object.fromEntries(
            Object.entries(sheet.spellcasting.slots).map(([slotLevel, slot]) => [
              slotLevel,
              { max: slot.max, used: 0 },
            ]),
          ),
        }
      : sheet.spellcasting,
    hitDicePools: sheet.hitDicePools?.map((pool) => ({ ...pool, spent: 0 })) ?? null,
    portrait: sheet.portrait,
    notes: sheet.notes,
    backstory: sheet.backstory,
  };
}

function progressSnapshot(sheet: NonNullable<ReturnType<typeof getSheetById>>): ProgressSnapshot {
  const equipment = sheet.equipment as unknown as Array<Record<string, unknown>>;
  const resources = sheet.resources as unknown;
  return {
    level: sheet.level,
    xp: sheet.xp,
    milestone: { level: sheet.level, xp: sheet.xp },
    hp: { current: sheet.currentHp, max: sheet.maxHp, temp: sheet.tempHp },
    conditions: sheet.conditions,
    inspiration:
      resources && typeof resources === "object" && "inspiration" in (resources as Record<string, unknown>)
        ? (resources as Record<string, unknown>).inspiration
        : null,
    exhaustion: sheet.exhaustion,
    hitDice: sheet.hitDice,
    hitDicePools: sheet.hitDicePools,
    spellSlots: sheet.spellcasting?.slots ?? null,
    attunement: equipment
      .filter((item) => Boolean(item.attuned))
      .map((item) => ({ name: item.name ?? null, id: item.id ?? null })),
    deathSaves: sheet.deathSaves,
    wealth: { gold: sheet.gold, copper: sheet.copper },
    consumables: {
      resources: sheet.resources,
      equipment: equipment
        .filter((item) => typeof item.quantity === "number" || Boolean(item.consumable))
        .map((item) => ({ id: item.id ?? null, name: item.name ?? null, quantity: item.quantity ?? null })),
    },
    statuses: {
      conditions: sheet.conditions,
      conditionMeta: sheet.conditionMeta,
      concentratingOn: sheet.concentratingOn,
      wildShape: sheet.wildShape,
      resources: sheet.resources,
    },
    durable: durableSnapshot(sheet),
    sheetUpdatedAt: sheet.updatedAt,
  };
}

function semanticDelta(before: unknown, after: unknown) {
  const left = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const right = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const delta: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const a = JSON.stringify(left[key] ?? null);
    const b = JSON.stringify(right[key] ?? null);
    if (a !== b) delta[key] = { before: left[key] ?? null, after: right[key] ?? null };
  }
  return delta;
}

function stateFor(libraryCharacterId: string): ProgressStateRow {
  ensureProgressSchema();
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM character_progress_state WHERE library_character_id = ?").get(libraryCharacterId) as
    | ProgressStateRow
    | undefined;
  if (row) return row;
  return {
    library_character_id: libraryCharacterId,
    revision: 0,
    last_synced_at: null,
    last_sheet_id: null,
    last_sheet_updated_at: null,
    last_library_updated_at: null,
  };
}

export function getProgressState(libraryCharacterId: string) {
  const state = stateFor(libraryCharacterId);
  return {
    libraryCharacterId: state.library_character_id,
    revision: state.revision,
    lastSyncedAt: state.last_synced_at,
    lastSheetId: state.last_sheet_id,
    lastSheetUpdatedAt: state.last_sheet_updated_at,
    lastLibraryUpdatedAt: state.last_library_updated_at,
  };
}

export function listProgressEvents(libraryCharacterId: string, limit = 50) {
  ensureProgressSchema();
  const rows = getDatabase()
    .prepare("SELECT * FROM character_progress_events WHERE library_character_id = ? ORDER BY revision DESC LIMIT ?")
    .all(libraryCharacterId, Math.min(Math.max(limit, 1), 200)) as ProgressEventRow[];
  return rows.map((row) => ({
    id: row.id,
    libraryCharacterId: row.library_character_id,
    campaignCharacterId: row.campaign_character_id,
    campaignId: row.campaign_id,
    revision: row.revision,
    expectedVersion: row.expected_version,
    sourceSheetUpdatedAt: row.source_sheet_updated_at,
    delta: parseJson(row.delta_json, {}),
    snapshot: parseJson(row.snapshot_json, {}),
    createdAt: row.created_at,
  }));
}

export function syncCharacterProgress(sheetId: string, expectedVersion?: number) {
  ensureProgressSchema();
  const db = getDatabase();
  const sheet = getSheetById(sheetId);
  if (!sheet) throw new Error("Campaign character sheet not found.");
  if (!sheet.libraryCharacterId) throw new Error("Campaign character is not linked to a library character.");

  return db.transaction(() => {
    const current = stateFor(sheet.libraryCharacterId!);
    if (expectedVersion != null && expectedVersion !== current.revision) {
      throw new ProgressConflictError(`Progress revision conflict: expected ${expectedVersion}, current ${current.revision}.`);
    }
    if (
      current.last_sheet_updated_at &&
      current.last_sheet_id &&
      current.last_sheet_id !== sheet.id &&
      current.last_sheet_updated_at > sheet.updatedAt
    ) {
      throw new ProgressConflictError(
        `Refusing to overwrite newer library progress from sheet ${current.last_sheet_id}; pass its current revision after resolving the conflict.`,
      );
    }

    const before = getCharacter(sheet.libraryCharacterId!);
    if (!before) throw new Error("Linked library character not found.");
    const synced = syncProgressToLibrary(sheet.id);
    if (!synced) throw new Error("Progress synchronization failed.");
    const snapshot = progressSnapshot(sheet);
    const delta = semanticDelta(
      { level: before.level, xp: before.xp, sheet: before.sheet },
      { level: synced.level, xp: synced.xp, sheet: synced.sheet },
    );
    const revision = current.revision + 1;
    const now = nowIso();

    db.prepare(`
      INSERT INTO character_progress_events (
        id, library_character_id, campaign_character_id, campaign_id, revision,
        expected_version, source_sheet_updated_at, delta_json, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sheet.libraryCharacterId,
      sheet.id,
      sheet.campaignId,
      revision,
      expectedVersion ?? null,
      sheet.updatedAt,
      JSON.stringify(delta),
      JSON.stringify(snapshot),
      now,
    );
    db.prepare(`
      INSERT INTO character_progress_state (
        library_character_id, revision, last_synced_at, last_sheet_id,
        last_sheet_updated_at, last_library_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(library_character_id) DO UPDATE SET
        revision = excluded.revision,
        last_synced_at = excluded.last_synced_at,
        last_sheet_id = excluded.last_sheet_id,
        last_sheet_updated_at = excluded.last_sheet_updated_at,
        last_library_updated_at = excluded.last_library_updated_at
    `).run(sheet.libraryCharacterId, revision, now, sheet.id, sheet.updatedAt, synced.updatedAt);

    return {
      sheetId: sheet.id,
      campaignId: sheet.campaignId,
      libraryCharacterId: sheet.libraryCharacterId,
      revision,
      previousRevision: current.revision,
      expectedVersion: expectedVersion ?? null,
      syncedAt: now,
      delta,
      snapshot,
      libraryCharacter: synced,
    };
  })();
}

export function bulkSyncCampaignProgress(campaignId: string) {
  const sheets = listSheets(campaignId).filter((sheet) => Boolean(sheet.libraryCharacterId));
  const results: Array<ReturnType<typeof syncCharacterProgress>> = [];
  const errors: Array<{ sheetId: string; error: string }> = [];
  for (const sheet of sheets) {
    try {
      results.push(syncCharacterProgress(sheet.id));
    } catch (error) {
      errors.push({ sheetId: sheet.id, error: error instanceof Error ? error.message : "Unknown progress sync error" });
    }
  }
  return { campaignId, synced: results, errors, total: sheets.length };
}
