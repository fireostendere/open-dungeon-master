// Reads the Open5e content pack and returns one entry per distinct creature
// name (the same monster printed in several books collapses to one entry that
// lists every source). Used by the 3D bestiary build, its tests and its QA
// contact sheets.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

export function contentDbPath() {
  const candidates = [
    process.env.CONTENT_DB_PATH,
    path.join(root, "data/content/open5e.sqlite"),
    // Linked worktrees do not carry the (untracked) content pack: fall back to
    // the primary checkout that owns this worktree.
    path.resolve(root, "../../dungeon_master/open-dungeon-master/data/content/open5e.sqlite"),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Open5e content pack not found. Tried:\n${candidates.join("\n")}\nRun: node scripts/fetch-content-pack.mjs`);
  return found;
}

// Earlier entries win when the same name appears in several books.
const SOURCE_PRIORITY = ["wotc-srd", "blackflag", "menagerie", "tob", "tob2", "tob3", "tob-2023", "cc", "taldorei"];

const normalizeName = (name) => name.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

function parseSpeed(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") { try { return JSON.parse(raw.replace(/'/g, '"')); } catch { return {}; } }
  return {};
}

export function loadCatalog() {
  const db = new DatabaseSync(contentDbPath(), { readOnly: true });
  const documents = new Map(db.prepare("SELECT slug, title FROM documents").all().map((d) => [d.slug, d.title]));
  const rows = db.prepare("SELECT slug, name, document_slug, cr, type, data_json FROM monsters").all();
  db.close();

  const byName = new Map();
  for (const row of rows) {
    const data = JSON.parse(row.data_json);
    const key = normalizeName(row.name);
    const entry = {
      slug: row.slug,
      name: row.name.trim(),
      type: String(row.type ?? data.type ?? "").toLowerCase(),
      size: String(data.size ?? "").toLowerCase(),
      subtype: String(data.subtype ?? ""),
      group: data.group ? String(data.group) : "",
      speed: parseSpeed(data.speed),
      cr: Number(row.cr ?? 0),
      sources: [documents.get(row.document_slug) ?? row.document_slug],
      doc: row.document_slug,
    };
    const existing = byName.get(key);
    if (!existing) { byName.set(key, entry); continue; }
    if (!existing.sources.includes(entry.sources[0])) existing.sources.push(entry.sources[0]);
    const rank = (d) => { const i = SOURCE_PRIORITY.indexOf(d); return i < 0 ? 99 : i; };
    if (rank(entry.doc) < rank(existing.doc)) {
      Object.assign(existing, { ...entry, sources: existing.sources });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
