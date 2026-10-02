import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spatialStore } from "@/lib/spatial/service";
import { removeConditions } from "@/lib/dm/condition-logic";
import { sourceMeta } from "@/lib/dm/condition-sources";

// Ordinary Invisibility ends on an attack or spell; Greater Invisibility
// and independently sourced effects keep their own duration.
export function revealAfterAction(campaignId: string, characterId: string, attack = false) {
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.campaignId !== campaignId) return;
  const ended = sheet.conditions.filter(name => name.toLowerCase() === "invisible" &&
    !sheet.conditionMeta[name]?.concentrationSources?.length);
  if (attack) ended.push(...sheet.conditions.filter(name => name.toLowerCase() === "hidden"));
  const next = removeConditions(sheet.conditions, sheet.conditionMeta, ended);
  for (const name of sheet.conditions) {
    if (name.toLowerCase() !== "invisible") continue;
    const meta = sheet.conditionMeta[name];
    if (!meta?.concentrationSources?.length) continue;
    const kept = meta.concentrationSources.filter(source => !/^(invisibility|невидимость)$/i.test(source.spell));
    if (kept.length === meta.concentrationSources.length) continue;
    const remaining = sourceMeta(kept, meta.independent);
    if (remaining) next.meta[name] = remaining;
    else {
      next.conditions = next.conditions.filter(condition => condition !== name);
      delete next.meta[name];
    }
  }
  if (attack || !next.conditions.some(name => ["invisible", "hidden"].includes(name.toLowerCase()))) {
    spatialStore().reveal(campaignId, characterId);
  }
  if (JSON.stringify(next.conditions) === JSON.stringify(sheet.conditions) &&
    JSON.stringify(next.meta) === JSON.stringify(sheet.conditionMeta)) return;
  const updated = patchSheet(characterId, { conditions: next.conditions, conditionMeta: next.meta });
  if (updated) publishPersisted(campaignId, "sheet_updated", { sheet: updated });
}
