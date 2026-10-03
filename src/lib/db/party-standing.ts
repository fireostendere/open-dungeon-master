import { getDatabase, parseJson } from "@/lib/db/core";
import { getCurrentLocation } from "@/lib/db/locations";
import { listSheets } from "@/lib/db/sheets";

// Where each hero stands in location mode: the split positions when part of
// the party stayed behind, otherwise everyone at the current location. A
// leaf, so the turn and round logic can ask without pulling in the overworld
// and the spatial service behind it (src/lib/db/overworld.ts re-exports it).
export function partyStanding(campaignId: string, sheets = listSheets(campaignId)): Record<string, string> {
  const row = getDatabase()
    .prepare(`SELECT party_locations_json FROM overworld_maps WHERE campaign_id = ?`)
    .get(campaignId) as { party_locations_json: string | null } | undefined;
  const split = parseJson<Record<string, string>>(row?.party_locations_json ?? "{}", {});
  if (Object.keys(split).length) return split;
  const current = getCurrentLocation(campaignId);
  return current ? Object.fromEntries(sheets.map(sheet => [sheet.id, current.id])) : {};
}
