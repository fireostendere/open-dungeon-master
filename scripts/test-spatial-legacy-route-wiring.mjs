import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const has = (source, pattern, label) =>
  assert.match(source, pattern, `Missing spatial projection wiring: ${label}`);

test("R02-R03: player-facing legacy routes use the spatial projection boundary", () => {
  const battle = read("src/app/api/campaigns/[campaignId]/battle-map/route.ts");
  has(battle, /spatialBattleMapView/, "battle-map direct GET");

  const narrator = read("src/lib/mcp-narrator-control.ts");
  has(narrator, /scopeBattleMapInvocation/, "start_encounter room scope");
  has(narrator, /bindActiveBattleMapToRoom/, "battle-map room binding");

  const campaign = read("src/app/api/campaigns/[campaignId]/route.ts");
  for (const name of [
    "projectSpatialCampaign", "projectSpatialRolls", "projectSpatialChapters",
    "projectSpatialNotes", "projectSpatialUserRows",
  ]) has(campaign, new RegExp(name), `campaign snapshot ${name}`);
  has(campaign, /ambience:\s*legacyPolicy\.scoped\s*\?\s*null/, "campaign ambience");

  const rolls = read("src/app/api/campaigns/[campaignId]/rolls/route.ts");
  has(rolls, /projectSpatialRolls/, "roll log");
  has(rolls, /policy\.scoped\s*&&\s*!sheet/, "unscoped custom player roll");

  const facts = read("src/app/api/campaigns/[campaignId]/facts/route.ts");
  assert.ok((facts.match(/projectSpatialFacts/g) ?? []).length >= 2, "facts GET and direct-ID PATCH must project");

  const notes = read("src/app/api/campaigns/[campaignId]/notes/route.ts");
  has(notes, /projectSpatialNotes/, "notes list");
  const noteId = read("src/app/api/campaigns/[campaignId]/notes/[noteId]/route.ts");
  assert.ok((noteId.match(/projectSpatialNotes/g) ?? []).length >= 3, "note import plus PATCH and DELETE guards");

  const chapters = read("src/app/api/campaigns/[campaignId]/chapters/route.ts");
  has(chapters, /projectSpatialChapters/, "chapter history");

  const encounter = read("src/app/api/campaigns/[campaignId]/encounter/route.ts");
  has(encounter, /encounter:\s*policy\.scoped\s*\?\s*null/, "direct encounter GET");

  const relationships = read("src/app/api/campaigns/[campaignId]/relationships/route.ts");
  has(relationships, /projectSpatialOwnedRows/, "relationship history");

  const proposals = read("src/app/api/campaigns/[campaignId]/item-proposals/route.ts");
  has(proposals, /projectSpatialUserRows/, "item proposal list");
  const proposalId = read("src/app/api/campaigns/[campaignId]/item-proposals/[proposalId]/route.ts");
  has(proposalId, /projectSpatialUserRows\(policy, \[proposal\]\)/, "item proposal direct ID");
});
