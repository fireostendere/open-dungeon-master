// ODM restore: unpack a backup archive into a TARGET directory (never the
// live repo by default) and verify it can open the encrypted DB with the
// archived key. The spec requires a proven restore, not just an archive:
// this script opens the restored SQLite with the restored key and counts
// campaigns/users, printing them as proof.
//
//   node scripts/odm-restore.mjs <archive.tar.gz> <targetDir> [--live]
//
// --live restores over the running repo (refuses unless the server is
// stopped: it checks for a listener on the app port). Without --live the
// restore is a dry-run into targetDir and the live campaign is untouched.
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
db.close();

console.log(`restore OK into ${live ? "the live repo" : target}`);
console.log(`proof: db opened with the archived key — campaigns=${campaigns} users=${users} messages=${messages}`);
if (!live) {
  console.log("dry-run restore; the live campaign is untouched. To go live: stop the server, re-run with --live.");
}
