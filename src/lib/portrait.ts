import { listSheetsForLibraryCharacter, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import type { SheetAttachment } from "@/lib/schemas/sheet";

// Manual portraits are uploaded through /api/upload and mirrored into campaign
// copies of a library character. The server deliberately does not render,
// queue, probe, or otherwise host an image model.
export function mirrorToCampaignSheets(
  libraryCharacterId: string,
  portrait: SheetAttachment | null,
  { overwrite = false }: { overwrite?: boolean } = {},
) {
  for (const sheet of listSheetsForLibraryCharacter(libraryCharacterId)) {
    if (!overwrite && sheet.portrait) continue;
    const updated = patchSheet(sheet.id, { portrait });
    if (updated) publishPersisted(sheet.campaignId, "sheet_updated", { sheet: updated });
  }
}

// Transitional compatibility for callers cleaned up in this branch. These
// functions intentionally do nothing; no server-side image producer exists.
export type PortraitState = never;
export function portraitStatus(_characterId: string): null { return null; }
export function queueLibraryPortrait(_character: unknown): void {}
export function queueCompanionPortrait(_sheet: unknown): void {}
export function queueNpcPortrait(_npc: unknown): void {}
