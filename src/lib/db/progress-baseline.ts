import { getDatabase } from "@/lib/db/core";

export class ProgressConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressConflictError";
  }
}

export function ensureProgressBaselineSchema(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS library_progress_heads (
      library_character_id TEXT PRIMARY KEY REFERENCES library_characters(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sheet_progress_baselines (
      sheet_id TEXT PRIMARY KEY REFERENCES character_sheets(id) ON DELETE CASCADE,
      library_character_id TEXT NOT NULL REFERENCES library_characters(id) ON DELETE CASCADE,
      library_revision INTEGER NOT NULL,
      scaled_copy INTEGER NOT NULL DEFAULT 0 CHECK (scaled_copy IN (0,1))
    );
    CREATE TRIGGER IF NOT EXISTS library_progress_revision_update
    AFTER UPDATE OF level, xp, subclass, sheet_json ON library_characters
    WHEN OLD.level IS NOT NEW.level OR OLD.xp IS NOT NEW.xp
      OR OLD.subclass IS NOT NEW.subclass OR OLD.sheet_json IS NOT NEW.sheet_json
    BEGIN
      INSERT INTO library_progress_heads (library_character_id, revision) VALUES (NEW.id, 1)
      ON CONFLICT(library_character_id) DO UPDATE SET revision = revision + 1;
    END;
  `);
}

export function libraryProgressRevision(libraryCharacterId: string): number {
  ensureProgressBaselineSchema();
  const row = getDatabase().prepare("SELECT revision FROM library_progress_heads WHERE library_character_id = ?")
    .get(libraryCharacterId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

export function rememberProgressBaseline(sheetId: string, libraryCharacterId: string, scaledCopy: boolean): void {
  const revision = libraryProgressRevision(libraryCharacterId);
  getDatabase().prepare(`INSERT INTO sheet_progress_baselines
    (sheet_id, library_character_id, library_revision, scaled_copy) VALUES (?, ?, ?, ?)`)
    .run(sheetId, libraryCharacterId, revision, scaledCopy ? 1 : 0);
}

export function assertProgressBaseline(sheetId: string, libraryCharacterId: string): number {
  ensureProgressBaselineSchema();
  const baseline = getDatabase().prepare("SELECT * FROM sheet_progress_baselines WHERE sheet_id = ?")
    .get(sheetId) as { library_character_id: string; library_revision: number; scaled_copy: number } | undefined;
  if (!baseline || baseline.library_character_id !== libraryCharacterId) {
    throw new ProgressConflictError("This older campaign copy has no verified library baseline. Reconcile its progress explicitly before syncing; no library data was changed.");
  }
  if (baseline.scaled_copy) {
    throw new ProgressConflictError("This character was scaled to a different campaign level and starts with campaign-only XP. Explicitly reconcile the scaled copy before writing it back to the library.");
  }
  const current = libraryProgressRevision(libraryCharacterId);
  if (baseline.library_revision !== current) {
    throw new ProgressConflictError(`Library progress changed since this copy was created or last synced (baseline ${baseline.library_revision}, current ${current}). Reconcile the two versions; editing this sheet's notes does not resolve the conflict.`);
  }
  return current;
}

export function advanceProgressBaseline(sheetId: string, libraryCharacterId: string, expectedRevision: number): void {
  const revision = libraryProgressRevision(libraryCharacterId);
  const updated = getDatabase().prepare(`UPDATE sheet_progress_baselines SET library_revision = ?
    WHERE sheet_id = ? AND library_character_id = ? AND library_revision = ? AND scaled_copy = 0`)
    .run(revision, sheetId, libraryCharacterId, expectedRevision);
  if (updated.changes !== 1) throw new ProgressConflictError("The campaign copy's baseline changed during synchronization.");
}

// Operator-only reconciliation primitive. No automatic sync calls this.
// The operator must inspect both versions and explicitly authorize replacing
// the current library version from the selected campaign copy. The two CAS
// values bind that authorization to the versions actually inspected.
export function adoptProgressBaseline(input: {
  sheetId: string;
  expectedLibraryRevision: number;
  expectedSheetUpdatedAt: string;
  confirmOverwriteFromCampaign: boolean;
}): void {
  if (!input.confirmOverwriteFromCampaign) throw new ProgressConflictError("Explicit confirmation of the campaign-to-library overwrite is required.");
  ensureProgressBaselineSchema();
  const db = getDatabase();
  db.transaction(() => {
    const sheet = db.prepare("SELECT library_character_id, updated_at FROM character_sheets WHERE id = ?")
      .get(input.sheetId) as { library_character_id: string | null; updated_at: string } | undefined;
    if (!sheet?.library_character_id) throw new ProgressConflictError("Linked campaign character not found.");
    if (sheet.updated_at !== input.expectedSheetUpdatedAt || libraryProgressRevision(sheet.library_character_id) !== input.expectedLibraryRevision) {
      throw new ProgressConflictError("A version changed after the reconciliation preview; inspect it again.");
    }
    db.prepare(`INSERT INTO sheet_progress_baselines (sheet_id, library_character_id, library_revision, scaled_copy)
      VALUES (?, ?, ?, 0) ON CONFLICT(sheet_id) DO UPDATE SET
      library_character_id = excluded.library_character_id, library_revision = excluded.library_revision, scaled_copy = 0`)
      .run(input.sheetId, sheet.library_character_id, input.expectedLibraryRevision);
  })();
}
