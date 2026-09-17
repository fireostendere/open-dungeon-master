// Public library boundary. Low-level library CRUD remains in characters-store;
// every campaign-to-library write goes through the same baseline/CAS guard.
export * from "@/lib/db/characters-store";
import {
  getCharacter,
  instantiateIntoCampaign as instantiateStoredCharacter,
  syncProgressToLibrary as syncStoredProgress,
  type LibraryCharacter,
} from "@/lib/db/characters-store";
import { getSheetById } from "@/lib/db/sheets";
import { getDatabase } from "@/lib/db/core";
import {
  advanceProgressBaseline, assertProgressBaseline, ensureProgressBaselineSchema,
} from "@/lib/db/progress-baseline";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function instantiateIntoCampaign(
  characterId: string, campaignId: string, userId: string, targetLevel: number,
): CharacterSheet | { error: string } {
  ensureProgressBaselineSchema();
  // Includes the original library read and adaptation: another writer cannot
  // change the origin between that read and the new copy's baseline capture.
  return getDatabase().transaction(() =>
    instantiateStoredCharacter(characterId, campaignId, userId, targetLevel))();
}

export function syncProgressToLibrary(sheetId: string): LibraryCharacter | null {
  ensureProgressBaselineSchema();
  const db = getDatabase();
  return db.transaction(() => {
    const sheet = getSheetById(sheetId);
    if (!sheet?.libraryCharacterId) return null;
    const before = getCharacter(sheet.libraryCharacterId);
    if (!before || before.userId !== sheet.userId) return null;
    const revision = assertProgressBaseline(sheet.id, before.id);
    const synced = syncStoredProgress(sheet.id);
    if (!synced) throw new Error("Progress synchronization failed.");
    // Keep the durable merge identical for the legacy/manual and the audited
    // progress-service paths. Transient HP, conditions and spent pools do not
    // become the next campaign's starting state.
    const stored = {
      ...synced.sheet,
      copper: sheet.copper,
      hitDice: { ...sheet.hitDice, spent: 0 },
      hitDicePools: sheet.hitDicePools?.map((pool) => ({ ...pool, spent: 0 })) ?? null,
    };
    db.prepare("UPDATE library_characters SET sheet_json = ? WHERE id = ?")
      .run(JSON.stringify(stored), before.id);
    advanceProgressBaseline(sheet.id, before.id, revision);
    return getCharacter(before.id);
  })();
}
