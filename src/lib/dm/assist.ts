import type { Campaign } from "@/lib/db/campaigns";
import { bestiaryFor, resolveMonster, suggestEnemies } from "@/lib/bestiary";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { listSheets } from "@/lib/db/sheets";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import { rankAdjudications } from "@/lib/dm/assist-logic";

export type SuggestedAdjudication = {
  name: string;
  label: string;
  summary: string;
  args?: Record<string, unknown>;
  why?: string;
};

// Deterministic keyword/rules matching only. The server never asks a model to
// choose an adjudication; the external narrator or human DM makes that choice.
export async function suggestAdjudication(
  _campaign: Campaign,
  intent: string,
  options: { inEncounter: boolean; useModel?: boolean },
): Promise<{ suggestions: SuggestedAdjudication[]; picked: null }> {
  const ranked = rankAdjudications(intent, ADJUDICATIONS, {
    inEncounter: options.inEncounter,
    limit: 5,
  });
  return {
    suggestions: ranked.map(({ entry }) => ({
      name: entry.name,
      label: entry.label,
      summary: entry.summary,
    })),
    picked: null,
  };
}

export type StatblockMatch = {
  slug: string;
  name: string;
  cr: number;
  type: string;
  blurb: string;
};

export function searchStatblocks(campaign: Campaign, query: string): StatblockMatch[] {
  const setting = campaign.gameSettings;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    const levels = listSheets(campaign.id).map((sheet) => sheet.level);
    return suggestEnemies(setting, levels, 12).map((entry) => ({
      slug: entry.slug, name: entry.name, cr: entry.cr, type: entry.type, blurb: entry.blurb,
    }));
  }
  return bestiaryFor(setting)
    .filter((entry) =>
      entry.name.toLowerCase().includes(trimmed) ||
      entry.slug.includes(trimmed) ||
      entry.type === trimmed ||
      entry.blurb.toLowerCase().includes(trimmed))
    .slice(0, 12)
    .map((entry) => ({ slug: entry.slug, name: entry.name, cr: entry.cr, type: entry.type, blurb: entry.blurb }));
}

export type StatblockResult = {
  name: string;
  reskinName: string | null;
  stats: EnemyStats;
  synthesized: boolean;
};

export function quickStatblock(
  campaign: Campaign,
  input: { ref?: string; cr?: number },
): StatblockResult | null {
  const ref = (input.ref ?? "").trim();
  if (ref) {
    const resolved = resolveMonster(ref, campaign.gameSettings, { userId: campaign.ownerUserId });
    if (resolved) return {
      name: resolved.reskinName ?? resolved.baseName,
      reskinName: resolved.reskinName,
      stats: resolved.stats,
      synthesized: false,
    };
  }
  if (typeof input.cr === "number") return {
    name: ref || `CR ${input.cr} threat`,
    reskinName: null,
    stats: synthesizeStats(input.cr),
    synthesized: true,
  };
  return null;
}
