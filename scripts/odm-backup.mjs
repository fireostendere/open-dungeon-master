// ODM backup: one tar.gz with everything needed to restore the table —
// the encrypted DB, the content pack, installed worlds, uploaded and
// generated images, the local Modelfiles and the encryption key file
// (.env.server). The key belongs in the archive: without it the DB is
// unrecoverable, and the archive itself must therefore be stored like a
// secret (the default target dir is outside the repo and chmod 700).
//
//   node scripts/odm-backup.mjs [targetDir]
//
// Prints the archive path and sha256. Safe to run while the server is up:
// SQLite is copied with the backup API semantics of `VACUUM INTO`-style
// consistent read via a plain file copy of a WAL-checkpointed DB — to be
// safe we ask SQLite for a checkpoint first through better-sqlite3.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targetDir = path.resolve(process.argv[2] || path.join(os.homedir(), "odm-backups"));
fs.mkdirSync(targetDir, { recursive: true });
fs.chmodSync(targetDir, 0o700);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "odm-backup-"));

// Checkpoint the encrypted DB so the copy is consistent even while the
// server runs (WAL frames folded back into the main file).
const envServer = path.join(repo, ".env.server");
if (fs.existsSync(envServer)) {
  const key = fs
    .readFileSync(envServer, "utf8")
    .match(/^DB_ENCRYPTION_KEY=(\S+)$/m)?.[1];
  const dbPath = path.join(repo, "data", "local-roleplay.sqlite");
  if (key && fs.existsSync(dbPath)) {
    const Database = (await import("better-sqlite3-multiple-ciphers")).default;
    const db = new Database(dbPath);
    db.pragma(`key='${key}'`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  }
}

const include = [
  "data",
  "public/uploads",
  "public/generated",
  "public/generated-audio",
  "models",
  ".env.server",
  ".env.local",
];
for (const rel of include) {
  const src = path.join(repo, rel);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  // ponytail: expiring live WAVs stay out of long-lived archives; legacy audio is still backed up.
  const options = rel === "public/generated-audio"
    ? { recursive: true, filter: source => !source.toLowerCase().endsWith(".wav") }
    : { recursive: true };
  fs.cpSync(src, dst, options);
}

const archive = path.join(targetDir, `odm-backup-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-C", stage, "."]);
fs.rmSync(stage, { recursive: true, force: true });

const sha = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const sizeMb = (fs.statSync(archive).size / 2 ** 20).toFixed(1);
console.log(`backup: ${archive} (${sizeMb} MB)`);
console.log(`sha256: ${sha}`);
console.log("WARNING: the archive contains DB_ENCRYPTION_KEY — store it as a secret.");
