import type { CharacterSheet } from "@/lib/schemas/sheet";

/**
 * Character sheets are party-visible mechanical state, but two fields have
 * narrower audiences:
 * - notes are the owning player's private scratchpad;
 * - companion personality is a DM roleplay brief.
 *
 * Project them before a sheet leaves the server. Do not rely on UI hiding.
 */
export function projectSheetForViewer(
  sheet: CharacterSheet,
  viewerUserId: string | null | undefined,
  options: { adjudicates?: boolean } = {},
): CharacterSheet {
  const own = Boolean(viewerUserId && sheet.userId === viewerUserId);
  if (own && (options.adjudicates || !sheet.isCompanion)) return sheet;
  return {
    ...sheet,
    ...(own ? {} : { notes: "" }),
    ...(!options.adjudicates && sheet.isCompanion ? { personality: "" } : {}),
  };
}

export function projectSheetsForViewer(
  sheets: CharacterSheet[],
  viewerUserId: string | null | undefined,
  options: { adjudicates?: boolean; visibleUserIds?: string[] } = {},
): CharacterSheet[] {
  return sheets.filter(sheet => options.adjudicates || !options.visibleUserIds
    || sheet.userId === viewerUserId || options.visibleUserIds.includes(sheet.userId))
    .map(sheet => projectSheetForViewer(sheet, viewerUserId, options));
}
