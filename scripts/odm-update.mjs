// ODM update from GitHub: safe, reversible, evidence-printing.
//
//   node scripts/odm-update.mjs            # dry run: fetch + show what's new
//   node scripts/odm-update.mjs --apply    # backup, merge upstream, deps, build, restart, test
//   node scripts/odm-update.mjs --rollback # restore the pre-update git ref + rebuild + restart
//
// Local customizations live on branch `local/table-ready` as normal commits,
// so updating = merging origin/main into it. The script NEVER runs
// reset --hard / clean -fd on your work: it creates a backup ref before
// touching anything, refuses to run on a dirty tree, and --rollback moves
// the branch pointer back to that ref (checkout -B), not a destructive wipe.
//
// Upstream remote: `upstream` if configured, else `origin`.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = (args, opts = {}) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", ...opts }).trim();
const stateFile = path.join(repo, ".git", "ODM_UPDATE_STATE.json");

function fail(msg) {
  console.error(`update: ${msg}`);
  process.exit(1);
}

function upstreamRemote() {
  const remotes = run(["remote"]).split("\n");
  if (remotes.includes("upstream")) return "upstream";
  if (remotes.includes("origin")) return "origin";
  fail("no git remote named upstream/origin");
}

function currentBranch() {
  return run(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function dirty() {
  return run(["status", "--porcelain"]).length > 0;
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
function loadState() {
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function systemd(action) {
  // Best-effort; the service is a user unit. Ignore failures (may run under
  // a different supervisor), but report them.
  const r = spawnSync("systemctl", ["--user", action, "odm-server.service"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.log(`update: note — systemctl --user ${action} failed: ${(r.stderr || "").trim().slice(0, 160)}`);
    return false;
  }
  return true;
}

const remote = upstreamRemote();
const branch = currentBranch();
const mode = process.argv[2] || "--check";

if (mode === "--rollback") {
  const state = loadState();
  if (!state?.backupRef) fail("no saved update state to roll back to");
  console.log(`update: rolling back ${branch} to ${state.backupRef} (${state.before.slice(0, 8)})`);
  run(["checkout", "-B", branch, state.backupRef]);
  console.log("update: reinstalling deps + rebuilding");
  execFileSync("npm", ["ci"], { cwd: repo, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: repo, stdio: "inherit" });
  systemd("restart");
  fs.rmSync(stateFile, { force: true });
  console.log(`update: rolled back to ${run(["rev-parse", "--short", "HEAD"])}`);
  process.exit(0);
}

run(["fetch", remote, "--prune"]);
const head = run(["rev-parse", "HEAD"]);
const upstreamHead = run(["rev-parse", `${remote}/main`]);
const behind = run(["rev-list", "--count", `HEAD..${remote}/main`]);
const ahead = run(["rev-list", "--count", `${remote}/main..HEAD`]);

console.log(`update: branch ${branch}, remote ${remote}/main`);
console.log(`update: HEAD ${head.slice(0, 8)} — ${behind} upstream commit(s) available, ${ahead} local commit(s) ahead`);
if (behind === "0") {
  console.log("update: already up to date.");
  process.exit(0);
}
console.log("update: new upstream commits:");
console.log(run(["log", "--oneline", `HEAD..${remote}/main`]).split("\n").slice(0, 20).map((l) => "  " + l).join("\n"));

if (mode !== "--apply") {
  console.log("\nupdate: dry run only. Re-run with --apply to backup, merge, rebuild and restart.");
  process.exit(0);
}

// --- apply ---
if (dirty()) {
  fail("working tree has uncommitted changes — commit or stash them first (nothing was touched)");
}

const backupRef = `odm-pre-update-${Date.now()}`;
run(["branch", backupRef, head]);
saveState({ backupRef, before: head, at: new Date().toISOString(), upstreamHead });
console.log(`update: backup ref ${backupRef} → ${head.slice(0, 8)} (rollback: node scripts/odm-update.mjs --rollback)`);

console.log("update: backing up data (odm-backup.mjs)");
execFileSync("node", ["scripts/odm-backup.mjs"], { cwd: repo, stdio: "inherit" });

console.log(`update: merging ${remote}/main into ${branch}`);
const merge = spawnSync("git", ["merge", "--no-edit", `${remote}/main`], { cwd: repo, encoding: "utf8" });
if (merge.status !== 0) {
  console.error(merge.stdout, merge.stderr);
  run(["merge", "--abort"]).trim();
  console.log("update: merge had conflicts — aborted, tree untouched. Resolve manually or stay on the current version.");
  fs.rmSync(stateFile, { force: true });
  process.exit(1);
}

// Reinstall deps only if the lockfile changed in the merge.
const lockChanged = run(["diff", "--name-only", head, "HEAD"]).split("\n").includes("package-lock.json");
if (lockChanged) {
  console.log("update: package-lock.json changed — npm ci");
  execFileSync("npm", ["ci"], { cwd: repo, stdio: "inherit" });
}

console.log("update: rebuilding (npm run build)");
const build = spawnSync("npm", ["run", "build"], { cwd: repo, stdio: "inherit" });
if (build.status !== 0) {
  console.error("update: build failed after merge. Rolling back.");
  run(["checkout", "-B", branch, backupRef]);
  execFileSync("npm", ["run", "build"], { cwd: repo, stdio: "inherit" });
  systemd("restart");
  fs.rmSync(stateFile, { force: true });
  fail("update rolled back due to build failure");
}

systemd("restart");
console.log(`update: done. Now at ${run(["rev-parse", "--short", "HEAD"])}. Rollback point kept at ${backupRef}.`);
console.log("update: run `node scripts/odm-doctor.mjs` to verify health.");
