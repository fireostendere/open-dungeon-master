// Local operator tool, never invoked by automatic gameplay. Preview first;
// applying explicitly replaces library progression from this campaign copy.
import { existsSync } from "node:fs";
import { register } from "node:module";
import { parseArgs } from "node:util";
register("./lib/register-alias.mjs", import.meta.url);
const { values } = parseArgs({ options: {
  sheet: { type: "string" }, apply: { type: "boolean", default: false },
  "confirm-overwrite-library": { type: "boolean", default: false },
  "library-revision": { type: "string" }, "sheet-updated-at": { type: "string" },
} });
if (!values.sheet || !process.env.SQLITE_DB_PATH || !existsSync(process.env.SQLITE_DB_PATH)) {
  throw Error("Provide --sheet and an existing SQLITE_DB_PATH in the application's normal database/encryption environment.");
}
const { getSheetById } = await import("../src/lib/db/sheets.ts");
const { getCharacter } = await import("../src/lib/db/characters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { withCommittedEffects } = await import("../src/lib/db/commit-effects.ts");
const { libraryProgressRevision, adoptProgressBaseline } = await import("../src/lib/db/progress-baseline.ts");
const { syncCharacterProgress } = await import("../src/lib/db/progress-sync.ts");
const sheet = getSheetById(values.sheet);
const library = sheet?.libraryCharacterId ? getCharacter(sheet.libraryCharacterId) : null;
if (!sheet || !library || sheet.userId !== library.userId) throw Error("An owned library-linked campaign character is required.");
if (!values.apply) {
  console.log(JSON.stringify({
    warning: "Applying overwrites the current library with this campaign's durable progression. Inspect both versions first; this is not an automatic merge.",
    libraryRevision: libraryProgressRevision(library.id), sheetUpdatedAt: sheet.updatedAt,
    library, campaignCopy: sheet,
  }, null, 2));
} else {
  const revision = Number(values["library-revision"]);
  if (!values["confirm-overwrite-library"] || !values["sheet-updated-at"] || values["library-revision"] == null || !Number.isSafeInteger(revision) || revision < 0) {
    throw Error("Apply requires --confirm-overwrite-library, --library-revision and --sheet-updated-at from the inspected preview.");
  }
  const result = withCommittedEffects(() => getDatabase().transaction(() => {
    adoptProgressBaseline({ sheetId: sheet.id, expectedLibraryRevision: revision,
      expectedSheetUpdatedAt: values["sheet-updated-at"], confirmOverwriteFromCampaign: true });
    return syncCharacterProgress(sheet.id);
  })());
  console.log(JSON.stringify(result, null, 2));
}
