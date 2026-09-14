import crypto from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import {
  createPack,
  getPack,
  listAssets,
  listLinks,
  upsertJob,
  type AssetEntityType,
  type ArtKind,
  type JobDraft,
} from "@/lib/db/asset-pipeline";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function shortHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function existingPrimaryAssetIds(campaignId: string, entityType: AssetEntityType, entityId: string) {
  return listLinks({ campaignId, entityType, entityId })
    .filter((link) => link.isPrimary)
    .map((link) => link.assetId);
}

function referenceAssetIds(campaignId: string, entityType: AssetEntityType, entityId: string) {
  return listLinks({ campaignId, entityType, entityId })
    .map((link) => link.assetId)
    .slice(0, 8);
}

function promptPrefix(campaign: { title: string; theme: string; description: string }) {
  const bits = [campaign.title, campaign.theme, campaign.description].map((value) => value.trim()).filter(Boolean);
  return bits.length ? `Campaign context: ${bits.join(" — ")}.` : "";
}

function job(input: JobDraft & { dedupeKey: string }): JobDraft {
  return input;
}

export function planCampaignAssets(campaignId: string) {
  const db = getDatabase();
  const campaign = db.prepare(`
    SELECT id, title, description, theme, scene, quest_log_json, dm_outline, story_arc_json, cover_json
    FROM campaigns WHERE id = ?
  `).get(campaignId) as
    | {
        id: string;
        title: string;
        description: string;
        theme: string;
        scene: string;
        quest_log_json: string;
        dm_outline: string;
        story_arc_json: string;
        cover_json: string | null;
      }
    | undefined;
  if (!campaign) throw new Error("Campaign not found.");

  let packRow = db.prepare(`
    SELECT id FROM asset_packs
    WHERE campaign_id = ? AND pack_type = 'campaign_bootstrap' AND status <> 'cancelled'
    ORDER BY created_at ASC LIMIT 1
  `).get(campaignId) as { id: string } | undefined;

  if (!packRow) {
    const created = createPack({
      campaignId,
      title: `${campaign.title} — campaign art`,
      packType: "campaign_bootstrap",
      style: { theme: campaign.theme, profile: "campaign-default" },
      metadata: { plannerVersion: 1, deterministic: true },
    });
    packRow = { id: created.id };
  }

  const packId = packRow.id;
  const prefix = promptPrefix(campaign);
  const planned: string[] = [];
  const reused: string[] = [];

  const add = (draft: JobDraft) => {
    const before = db.prepare("SELECT id FROM asset_jobs WHERE pack_id = ? AND dedupe_key = ?").get(packId, draft.dedupeKey ?? "") as { id: string } | undefined;
    const created = upsertJob({ packId, campaignId, job: draft });
    (before ? reused : planned).push(created.id);
  };

  const campaignRefs = existingPrimaryAssetIds(campaignId, "campaign", campaignId);
  if (!campaign.cover_json && !campaignRefs.length) {
    add(job({
      kind: "campaign_cover",
      title: `Campaign cover — ${campaign.title}`,
      description: "Primary key art for the campaign before play begins.",
      suggestedPrompt: `${prefix} Create a cinematic campaign cover for ${campaign.title}. No UI chrome or readable text.`.trim(),
      aspect: "portrait",
      target: { type: "campaign", id: campaignId },
      priority: 100,
      dedupeKey: "campaign:cover",
    }));
  }

  add(job({
    kind: "party_group",
    title: `Party group — ${campaign.title}`,
    description: "Group illustration of the player party for campaign and chapter presentation.",
    suggestedPrompt: `${prefix} Create a cohesive group illustration of the player party. Preserve individual silhouettes and equipment.`.trim(),
    aspect: "landscape",
    target: { type: "campaign", id: campaignId },
    referenceAssetIds: campaignRefs,
    priority: 90,
    dedupeKey: "campaign:party-group",
  }));

  const sheets = db.prepare(`
    SELECT id, name, race, class, subclass, level, portrait_json, is_companion
    FROM character_sheets WHERE campaign_id = ? ORDER BY is_companion ASC, name COLLATE NOCASE
  `).all(campaignId) as Array<{
    id: string;
    name: string;
    race: string;
    class: string;
    subclass: string;
    level: number;
    portrait_json: string | null;
    is_companion: number | null;
  }>;
  for (const sheet of sheets) {
    const refs = referenceAssetIds(campaignId, "character", sheet.id);
    if (sheet.portrait_json || refs.length) continue;
    add(job({
      kind: "character_portrait",
      title: `${sheet.is_companion ? "Companion" : "Character"} portrait — ${sheet.name}`,
      description: `${sheet.name}, level ${sheet.level} ${sheet.race} ${sheet.subclass || sheet.class}.`,
      suggestedPrompt: `${prefix} Portrait of ${sheet.name}, level ${sheet.level} ${sheet.race} ${sheet.subclass || sheet.class}. Strong identity, game-ready portrait, neutral readable silhouette.`.trim(),
      aspect: "portrait",
      target: { type: "character", id: sheet.id },
      priority: sheet.is_companion ? 72 : 85,
      dedupeKey: `character:${sheet.id}:portrait`,
    }));
  }

  const npcs = db.prepare(`
    SELECT id, name, attitude, trait, location, role, portrait_url
    FROM npcs WHERE campaign_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE
  `).all(campaignId) as Array<{
    id: string;
    name: string;
    attitude: string;
    trait: string;
    location: string;
    role: string;
    portrait_url: string;
  }>;
  for (const npc of npcs) {
    const refs = referenceAssetIds(campaignId, "npc", npc.id);
    if (npc.portrait_url || refs.length) continue;
    const details = [npc.role, npc.trait, npc.location].filter(Boolean).join(", ");
    add(job({
      kind: "npc_portrait",
      title: `NPC portrait — ${npc.name}`,
      description: details || `Campaign NPC: ${npc.name}.`,
      suggestedPrompt: `${prefix} Portrait of ${npc.name}${details ? ` — ${details}` : ""}. Attitude: ${npc.attitude}. Keep the design reusable across later scenes.`.trim(),
      aspect: "portrait",
      target: { type: "npc", id: npc.id },
      priority: 70,
      dedupeKey: `npc:${npc.id}:portrait`,
    }));
  }

  const locations = db.prepare(`
    SELECT id, name, layout_description, visited FROM locations
    WHERE campaign_id = ? ORDER BY visited DESC, name COLLATE NOCASE
  `).all(campaignId) as Array<{ id: string; name: string; layout_description: string; visited: number }>;
  for (const location of locations) {
    if (existingPrimaryAssetIds(campaignId, "location", location.id).length) continue;
    add(job({
      kind: "location_art",
      title: `Location — ${location.name}`,
      description: location.layout_description || `Establishing art for ${location.name}.`,
      suggestedPrompt: `${prefix} Establishing environment art for ${location.name}. ${location.layout_description}`.trim(),
      aspect: "landscape",
      target: { type: "location", id: location.id },
      priority: location.visited ? 68 : 55,
      dedupeKey: `location:${location.id}:art`,
    }));
  }

  const chapters = db.prepare(`
    SELECT id, chapter_index, title, summary FROM chapters
    WHERE campaign_id = ? ORDER BY chapter_index ASC
  `).all(campaignId) as Array<{ id: string; chapter_index: number; title: string; summary: string }>;
  for (const chapter of chapters) {
    if (existingPrimaryAssetIds(campaignId, "chapter", chapter.id).length) continue;
    add(job({
      kind: "chapter_cover",
      title: `Chapter ${chapter.chapter_index} cover${chapter.title ? ` — ${chapter.title}` : ""}`,
      description: chapter.summary || "Chapter cover based on campaign continuity.",
      suggestedPrompt: `${prefix} Chapter cover${chapter.title ? ` for “${chapter.title}”` : ""}. ${chapter.summary}`.trim(),
      aspect: "landscape",
      target: { type: "chapter", id: chapter.id },
      priority: 50,
      dedupeKey: `chapter:${chapter.id}:cover`,
    }));
  }

  const maps = db.prepare(`
    SELECT id, name, notes, width, height, theme, backdrop_path FROM prepared_maps
    WHERE campaign_id = ? ORDER BY updated_at DESC
  `).all(campaignId) as Array<{
    id: string;
    name: string;
    notes: string;
    width: number;
    height: number;
    theme: string;
    backdrop_path: string;
  }>;
  for (const map of maps) {
    if (map.backdrop_path || existingPrimaryAssetIds(campaignId, "map", map.id).length) continue;
    const pixelsPerCell = 64;
    add(job({
      kind: "battlemap",
      title: `Battlemap — ${map.name}`,
      description: map.notes || `Backdrop for prepared tactical map ${map.name}.`,
      suggestedPrompt: `${prefix} Top-down tactical battlemap for ${map.name}. Theme: ${map.theme}. ${map.notes} No perspective tilt; clear traversable spaces.`.trim(),
      aspect: map.width >= map.height ? "landscape" : "portrait",
      requestedWidth: Math.min(map.width * pixelsPerCell, 4096),
      requestedHeight: Math.min(map.height * pixelsPerCell, 4096),
      target: { type: "map", id: map.id },
      priority: 76,
      metadata: {
        gridType: "square",
        gridColumns: map.width,
        gridRows: map.height,
        pixelsPerCell,
        feetPerCell: 5,
        orientation: "top-down",
        notes: map.notes,
      },
      dedupeKey: `map:${map.id}:battlemap`,
    }));
  }

  const overworld = db.prepare(`
    SELECT id, width, height, backdrop_path FROM overworld_maps WHERE campaign_id = ?
  `).get(campaignId) as { id: string; width: number; height: number; backdrop_path: string } | undefined;
  if (overworld && !overworld.backdrop_path && !existingPrimaryAssetIds(campaignId, "map", overworld.id).length) {
    add(job({
      kind: "regional_map",
      title: `Regional map — ${campaign.title}`,
      description: "Illustrated regional/world map preserving the server-authored geography.",
      suggestedPrompt: `${prefix} Illustrated regional fantasy map matching the campaign geography. Readable terrain silhouettes and routes; no invented labels unless supplied by the brief.`.trim(),
      aspect: overworld.width >= overworld.height ? "landscape" : "portrait",
      target: { type: "map", id: overworld.id },
      priority: 62,
      metadata: { gridColumns: overworld.width, gridRows: overworld.height, orientation: "top-down" },
      dedupeKey: `overworld:${overworld.id}:regional-map`,
    }));
  }

  if (campaign.scene.trim()) {
    const sceneKey = shortHash(campaign.scene.trim());
    add(job({
      kind: "scene_art",
      title: `Scene art — ${campaign.scene.trim().slice(0, 80)}`,
      description: campaign.scene.trim(),
      suggestedPrompt: `${prefix} Illustrate the current scene: ${campaign.scene.trim()}`.trim(),
      aspect: "landscape",
      target: { type: "scene", id: sceneKey },
      priority: 60,
      dedupeKey: `scene:${sceneKey}:art`,
    }));
  }

  const quests = parseJson<unknown[]>(campaign.quest_log_json, []);
  if (quests.length) {
    const questText = JSON.stringify(quests).slice(0, 2500);
    add(job({
      kind: "handout",
      title: `Quest handout — ${campaign.title}`,
      description: "Optional visual handout representing the campaign's current quest direction.",
      suggestedPrompt: `${prefix} Create an in-world visual handout inspired by these quest notes: ${questText}. Avoid modern UI.`.trim(),
      aspect: "portrait",
      target: { type: "quest", id: `questlog-${shortHash(questText)}` },
      priority: 35,
      dedupeKey: `questlog:${shortHash(questText)}:handout`,
    }));
  }

  const pack = getPack(packId)!;
  const assets = listAssets({ packId });
  return {
    pack,
    planner: { version: 1, deterministic: true },
    changes: { planned, reused },
    totals: {
      jobs: pack.jobs.length,
      ready: pack.jobs.filter((entry) => entry.status === "ready").length,
      available: pack.jobs.filter((entry) => entry.status === "available").length,
      claimed: pack.jobs.filter((entry) => entry.status === "claimed" || entry.status === "uploading").length,
      assets: assets.length,
    },
  };
}
