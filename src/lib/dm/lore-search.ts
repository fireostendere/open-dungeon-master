import { getDatabase } from "@/lib/db/core";
import { listLoreEntries } from "@/lib/db/lore";
import { searchScenes } from "@/lib/dm/memory-index";
import { computeIdf, lexicalScore } from "@/lib/dm/fusion-logic";

export const searchLoreTool = {
  type: "function",
  function: {
    name: "search_lore",
    description:
      "Search the campaign's established canon: world lore, tracked facts, party notes, and past chapters. Use before inventing details that may already be established.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "What to look up." },
        category: {
          type: "string",
          enum: ["geography","factions","history","magic","culture","religion","npc","location","promise","any"],
        },
      },
      required: ["query"],
    },
  },
} as const;

const RESULT_LIMIT = 8;
const TEXT_CLIP = 400;
const FACT_CATEGORY_MAP: Record<string, string[]> = {
  npc: ["npc"],
  location: ["location"],
  promise: ["promise"],
  geography: ["location", "world"],
  factions: ["world", "npc"],
  history: ["world", "lore"],
  magic: ["lore", "world"],
  culture: ["lore", "world"],
  religion: ["lore", "world"],
};

type LoreCandidate = {
  id: string;
  source: string;
  ref: string;
  text: string;
  haystack: string;
};

export async function handleSearchLore(
  campaignId: string,
  rawArguments: string,
): Promise<Record<string, unknown>> {
  let args: { query?: unknown; category?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); }
  catch { return { error: "Invalid arguments." }; }

  const query = String(args.query ?? "").trim();
  if (!query) return { error: "Give a query describing what to look up." };
  const category = String(args.category ?? "any");
  const candidates: LoreCandidate[] = [];
  const db = getDatabase();

  if (
    category === "any" ||
    ["geography","factions","history","magic","culture","religion"].includes(category)
  ) {
    for (const entry of listLoreEntries(campaignId)) {
      if (category !== "any" && entry.category !== category) continue;
      candidates.push({
        id: `lore:${entry.id}`,
        source: "world lore",
        ref: `${entry.category}: ${entry.title}`,
        text: entry.body.slice(0, TEXT_CLIP),
        haystack: `${entry.title} ${entry.tags.join(" ")} ${entry.body}`,
      });
    }
  }

  const factCategories = category === "any" ? null : (FACT_CATEGORY_MAP[category] ?? null);
  const facts = db.prepare(
    `SELECT id, category, subject, fact FROM world_facts
     WHERE campaign_id = ? AND status = 'active'`,
  ).all(campaignId) as Array<{id:string;category:string;subject:string;fact:string}>;
  for (const row of facts) {
    if (factCategories && !factCategories.includes(row.category)) continue;
    candidates.push({
      id: `fact:${row.id}`,
      source: "fact",
      ref: `${row.category}${row.subject ? `: ${row.subject}` : ""}`,
      text: row.fact.slice(0, TEXT_CLIP),
      haystack: `${row.subject} ${row.fact}`,
    });
  }

  const notes = db.prepare(
    `SELECT id, title, body FROM campaign_notes
     WHERE campaign_id = ? AND character_id IS NULL
       AND visibility = 'public' AND status = 'active'`,
  ).all(campaignId) as Array<{id:string;title:string;body:string}>;
  for (const row of notes) {
    candidates.push({
      id: `note:${row.id}`,
      source: "party note",
      ref: row.title || "note",
      text: row.body.slice(0, TEXT_CLIP),
      haystack: `${row.title} ${row.body}`,
    });
  }

  for (const scene of await searchScenes(campaignId, query)) {
    candidates.push({
      id: `scene:${scene.chapterIndex}:${scene.seqStart}`,
      source: "past chapter",
      ref: `chapter ${scene.chapterIndex}`,
      text: scene.text.slice(0, TEXT_CLIP),
      haystack: scene.text,
    });
  }

  const idf = computeIdf(candidates.map((candidate) => candidate.haystack));
  const results = candidates
    .map((candidate) => ({
      candidate,
      score: lexicalScore(query, candidate.haystack, idf),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map(({ candidate: { source, ref, text } }) => ({ source, ref, text }));

  if (!results.length) {
    return {
      results: [],
      note: "Nothing established matches. You may invent this detail freely; keep it consistent with what you do know.",
    };
  }
  return {
    results,
    note: "These are established canon; stay strictly consistent with them.",
  };
}
