import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  normalizeLoreVisibility,
  type LoreVisibility,
  type WorldLoreCategory,
  type WorldLoreEntry,
} from "@/lib/dm/world-lore-logic";
import { isUploadedImagePath } from "@/lib/uploads";

// World lore builder storage. Retrieval is lexical and deterministic; no
// embedding model is loaded or called by the server.

type LoreRow = {
  id: string;
  campaign_id: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags_json: string;
  pinned: number;
  visibility: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

const LORE_COLUMNS =
  "id, campaign_id, category, title, body, tags_json, pinned, visibility, image_path, created_at, updated_at";

function mapEntry(row: LoreRow): WorldLoreEntry {
  const image = row.image_path ?? "";
  return {
    id: row.id,
    campaignId: row.campaign_id,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: parseJson<string[]>(row.tags_json, []),
    pinned: Boolean(row.pinned),
    visibility: normalizeLoreVisibility(row.visibility),
    // Refused rather than trusted: a path this app did not write reads back
    // as no picture.
    imagePath: image && isUploadedImagePath(image) ? image : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listLoreEntries(campaignId: string): WorldLoreEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${LORE_COLUMNS} FROM lore_entries
       WHERE campaign_id = ? ORDER BY category ASC, created_at ASC`,
    )
    .all(campaignId) as LoreRow[];
  return rows.map(mapEntry);
}

export function getLoreEntry(entryId: string): WorldLoreEntry | null {
  const row = getDatabase()
    .prepare(`SELECT ${LORE_COLUMNS} FROM lore_entries WHERE id = ?`)
    .get(entryId) as LoreRow | undefined;
  return row ? mapEntry(row) : null;
}

export function insertLoreEntry(input: {
  campaignId: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
  visibility?: LoreVisibility;
  imagePath?: string;
}): WorldLoreEntry {
  const now = nowIso();
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, visibility, image_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.category,
      input.title,
      input.body,
      JSON.stringify(input.tags),
      normalizeLoreVisibility(input.visibility),
      input.imagePath && isUploadedImagePath(input.imagePath) ? input.imagePath : "",
      now,
      now,
    );
  return getLoreEntry(id)!;
}

export function updateLoreEntry(
  entryId: string,
  patch: {
    category?: WorldLoreCategory;
    title?: string;
    body?: string;
    tags?: string[];
    pinned?: boolean;
    visibility?: LoreVisibility;
    // "" takes the picture away.
    imagePath?: string;
  },
): WorldLoreEntry | null {
  const entry = getLoreEntry(entryId);
  if (!entry) {
    return null;
  }
  const imagePath =
    patch.imagePath === undefined
      ? entry.imagePath
      : patch.imagePath && isUploadedImagePath(patch.imagePath)
        ? patch.imagePath
        : "";
  getDatabase()
    .prepare(
      `UPDATE lore_entries
       SET category = ?, title = ?, body = ?, tags_json = ?, pinned = ?, visibility = ?, image_path = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.category ?? entry.category,
      patch.title ?? entry.title,
      patch.body ?? entry.body,
      JSON.stringify(patch.tags ?? entry.tags),
      patch.pinned === undefined ? (entry.pinned ? 1 : 0) : patch.pinned ? 1 : 0,
      patch.visibility ?? entry.visibility,
      imagePath,
      nowIso(),
      entryId,
    );
  return getLoreEntry(entryId);
}

export function deleteLoreEntry(entryId: string) {
  getDatabase().prepare(`DELETE FROM lore_entries WHERE id = ?`).run(entryId);
}

