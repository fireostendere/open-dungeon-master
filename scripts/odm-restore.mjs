// ODM restore: unpack a backup archive into a TARGET directory (never the
// live repo by default) and verify it can open the encrypted DB with the
// archived key. Asset media is part of game state, so when the asset tables
// exist this verification also proves every non-deleted asset file survived
// the archive and still matches a DB row.
//
//   node scripts/odm-restore.mjs <archive.tar.gz> <targetDir> [--live]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [archive, targetArg, liveFlag] = process.argv.slice(2);
if (!archive || (!targetArg && liveFlag !== "--live")) {
  console.error("usage: node scripts/odm-restore.mjs <archive.tar.gz> <targetDir> [--live]");
  process.exit(2);
}
if (!fs.existsSync(archive)) {
  console.error(`archive not found: ${archive}`);
  process.exit(2);
}
const live = liveFlag === "--live";
const target = live ? repo : path.resolve(targetArg || "restored-odm");

if (live) {
  const portInUse = await new Promise((resolve) => {
    const probe = net.connect({ host: "127.0.0.1", port: 3005 });
    probe.on("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.on("error", () => resolve(false));
  });
  if (portInUse) {
    console.error("refusing --live restore: the server is still listening on :3005. Stop it first.");
    process.exit(1);
  }
}

fs.mkdirSync(target, { recursive: true });
execFileSync("tar", ["-xzf", archive, "-C", target]);

const envServer = path.join(target, ".env.server");
const dbPath = path.join(target, "data", "local-roleplay.sqlite");
if (!fs.existsSync(envServer) || !fs.existsSync(dbPath)) {
  console.error("restored tree is missing .env.server or data/local-roleplay.sqlite");
  process.exit(1);
}
const key = fs.readFileSync(envServer, "utf8").match(/^DB_ENCRYPTION_KEY=(\S+)$/m)?.[1];
if (!key) {
  console.error("no DB_ENCRYPTION_KEY in the restored .env.server");
  process.exit(1);
}

const Database = (await import("better-sqlite3-multiple-ciphers")).default;
const db = new Database(dbPath, { readonly: true });
db.pragma(`key='${key}'`);
const campaigns = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get().n;
const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
const messages = db.prepare("SELECT COUNT(*) AS n FROM campaign_messages").get().n;

let assets = 0;
let linkedAssets = 0;
const missingAssets = [];
const assetTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_files'").get();
if (assetTable) {
  const rows = db.prepare("SELECT id, storage_key FROM asset_files WHERE deleted_at IS NULL").all();
  assets = rows.length;
  for (const row of rows) {
    const storageKey = String(row.storage_key || "").replace(/\\/g, "/");
    if (!storageKey || storageKey.split("/").some((part) => part === ".." || part === ".")) {
      missingAssets.push(row.id);
      continue;
    }
    const file = path.resolve(target, "data", "media", ...storageKey.split("/"));
    const mediaRoot = path.resolve(target, "data", "media");
    const relative = path.relative(mediaRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      missingAssets.push(row.id);
    }
  }
  const linkTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_links'").get();
  if (linkTable) linkedAssets = db.prepare("SELECT COUNT(*) AS n FROM asset_links").get().n;
}

db.close();

if (missingAssets.length) {
  console.error(`restore verification failed: ${missingAssets.length} asset file(s) missing: ${missingAssets.slice(0, 10).join(", ")}`);
  process.exit(1);
}

console.log(`restore OK into ${live ? "the live repo" : target}`);
console.log(
  `proof: db opened with the archived key — campaigns=${campaigns} users=${users} messages=${messages} assets=${assets} asset_links=${linkedAssets}`,
);
if (!live) {
  console.log("dry-run restore; the live campaign is untouched. To go live: stop the server, re-run with --live.");
}
