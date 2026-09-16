// Public persistence boundary. The existing sheet mapper and mechanics stay
// in sheets-store; creation additionally captures the library copy's origin.
export * from "@/lib/db/sheets-store";
import { createSheet as createStoredSheet, getSheetById } from "@/lib/db/sheets-store";
import { getDatabase } from "@/lib/db/core";
import { ensureProgressBaselineSchema, rememberProgressBaseline } from "@/lib/db/progress-baseline";
import type { CharacterSheet, CreateSheetInput } from "@/lib/schemas/sheet";

export function createSheet(
  campaignId: string,
  userId: string,
  level: number,
  input: CreateSheetInput,
  libraryCharacterId?: string | null,
  options: { initialXp?: number } = {},
): CharacterSheet {
  ensureProgressBaselineSchema();
  const db = getDatabase();
  return db.transaction(() => {
    const source = libraryCharacterId
      ? db.prepare("SELECT level, xp FROM library_characters WHERE id = ?").get(libraryCharacterId) as { level: number; xp: number } | undefined
      : undefined;
    if (libraryCharacterId && !source) throw new Error("Linked library character not found.");
    const scaled = Boolean(source && source.level !== level);
    // A continuation preserves accumulated XP. A deliberately scaled copy
    // follows the application's fresh-campaign policy (0 XP), but is barred
    // from automatic write-back so scaling cannot erase library progression.
    const xp = options.initialXp ?? (source && !scaled ? source.xp : 0);
    if (!Number.isSafeInteger(xp) || xp < 0) throw new Error("Initial XP must be a non-negative safe integer.");
    const sheet = createStoredSheet(campaignId, userId, level, input, libraryCharacterId);
    db.prepare("UPDATE character_sheets SET xp = ? WHERE id = ?").run(xp, sheet.id);
    if (libraryCharacterId) rememberProgressBaseline(sheet.id, libraryCharacterId, scaled);
    const created = getSheetById(sheet.id);
    if (!created) throw new Error("Created character sheet disappeared.");
    return created;
  })();
}
