// Isolated SERVER SQLite benchmark: no provider/network/local external RAG.
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--worker")) {
  const baseline = fs.mkdtempSync(path.join(os.tmpdir(), "odm-db-baseline-"));
  try {
    const archive = execFileSync("git", ["archive", "7aa73c4", "src", "mcp", "scripts/lib", "package.json"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-xf", "-", "-C", baseline], { input: archive });
    fs.symlinkSync(fs.realpathSync(path.join(root, "node_modules")), path.join(baseline, "node_modules"), "dir");
    const beforeScript = path.join(baseline, "scripts", path.basename(import.meta.filename));
    fs.copyFileSync(import.meta.filename, beforeScript);
    const run = file => JSON.parse(execFileSync(process.execPath, [file, "--worker"], { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }));
    const report = { kind: "local-integration-isolated-server-sqlite", baseline: "7aa73c4", node: process.version,
      before: run(beforeScript), after: run(import.meta.filename) };
    const json = JSON.stringify(report, null, 2) + "\n";
    if (process.argv.includes("--write")) fs.writeFileSync(path.join(root, "docs/performance/narrator-db.json"), json);
    console.log(json);
  } finally { fs.rmSync(baseline, { recursive: true, force: true }); }
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-narrator-db-bench-"));
const contentPath = path.join(dir, "content.sqlite");
const content = new DatabaseSync(contentPath);
content.exec("CREATE TABLE spells(slug TEXT, name TEXT, document_slug TEXT, level INTEGER, school TEXT, classes_csv TEXT, ritual INTEGER, concentration INTEGER, aliases_csv TEXT, data_json TEXT)");
content.prepare("INSERT INTO spells VALUES(?,?,?,?,?,?,?,?,?,?)").run("acid-arrow", "Acid Arrow", "srd-2014", 2, "evocation", "wizard", 0, 0, "melf's acid arrow", JSON.stringify({ source: "SRD 5.1" }));
content.close();
process.env.SQLITE_DB_PATH = path.join(dir, "game.sqlite");
process.env.CONTENT_DB_PATH = contentPath;
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createCharacter, instantiateIntoCampaign } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { upsertNpc } = await import("../src/lib/db/npcs.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { executeMcpNarratorControl } = await import("../src/lib/mcp-narrator-control.ts");
const { findSpellByName } = await import("../src/lib/content/index.ts");
const { narratorSectionCache } = await import("../src/lib/db/revision-cache.mjs");
const dm = createUser("bench_dm", "hash");
const campaign = createCampaign(dm.id, { title: "Bench", description: "", theme: "", maxPlayers: 1, startingLevel: 1, difficulty: "normal", gameSettings: { dmMode: "human", ttsEnabled: false, mapsEnabled: false } });
setCampaignStatus(campaign.id, "active");
const db = getDatabase();
const character = createCharacter(dm.id, 1, createSheetSchema.parse({ name: "Bench Hero", race: "human", class: "fighter", subclass: "", background: "soldier", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, maxHp: 12, ac: 16, speed: 30, hitDice: { die: "d10", total: 1, spent: 0 }, proficiencies: { saves: [], skills: [], languages: [], tools: [], armor: [], weapons: [] }, equipment: [], gold: 0, copper: 0 }));
instantiateIntoCampaign(character.id, campaign.id, dm.id, 1);
for (let index = 0; index < 125; index += 1) upsertNpc({ campaignId: campaign.id, name: `NPC ${String(index).padStart(3, "0")}`, attitude: "indifferent", trait: "", location: "" });
for (let index = 0; index < 30; index += 1) db.prepare("INSERT INTO world_facts (id,campaign_id,category,subject,fact,known_by,pinned,status,source,created_at,updated_at) VALUES (?,?,?,?,?,'party',0,'active','manual',?,?)").run(randomUUID(), campaign.id, "npc", `NPC ${String(index).padStart(3, "0")}`, `Fact ${index}`, new Date().toISOString(), new Date().toISOString());

const stats = { prepareRequests: 0, distinctStatementHandles: 0, exec: 0, sqlReads: 0, npcRows: 0 };
let seenStatements = new WeakSet();
const prepare = db.prepare.bind(db), exec = db.exec.bind(db);
db.prepare = (sql) => {
  stats.prepareRequests += 1;
  const statement = prepare(sql);
  if (!seenStatements.has(statement)) { seenStatements.add(statement); stats.distinctStatementHandles++; }
  return { run: (...args) => statement.run(...args), get: (...args) => { stats.sqlReads += 1; return statement.get(...args); }, all: (...args) => {
    stats.sqlReads += 1; const rows = statement.all(...args); if (/SELECT \* FROM npcs WHERE/.test(sql)) stats.npcRows += rows.length; return rows;
  } };
};
db.exec = (sql) => { stats.exec += 1; return exec(sql); };
const reset = () => { for (const key of Object.keys(stats)) stats[key] = 0; seenStatements = new WeakSet(); };
const percentile = (values, ratio) => values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
async function measure(name, mutate) {
  const samples = [], outputs = [];
  reset();
  const cache = narratorSectionCache(db), before = { ...cache.stats };
  for (let index = 0; index < 25; index += 1) {
    if (mutate) mutate(index);
    const started = performance.now();
    const result = await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 100, projection: "live", maxBytes: 131072 });
    samples.push(performance.now() - started);
    outputs.push(JSON.stringify(result.result));
  }
  samples.sort((left, right) => left - right);
  return { name, reads: samples.length, wallMs: { p50: +percentile(samples, .5).toFixed(3), p95: +percentile(samples, .95).toFixed(3) }, bytes: Buffer.byteLength(outputs[0]), identicalWithinScenario: outputs.every((output) => output === outputs[0]), db: { ...stats },
    projectionLoads: cache.stats.loads - before.loads, projectionHits: cache.stats.hits - before.hits };
}

// Prime the real MCP and revision schemas; measured warm reads exclude setup DDL.
for (let i = 0; i < 5; i++) await executeMcpNarratorControl("narrator.read", { campaignId: campaign.id, afterSeq: 0, limit: 100, projection: "live", maxBytes: 131072 });
const warm = await measure("warm_full_mcp_read");
const changedSheet = await measure("changed_sheet", () => db.prepare("UPDATE character_sheets SET updated_at=? WHERE campaign_id=?").run(new Date().toISOString(), campaign.id));
const changedFactNpc = await measure("changed_fact_npc", (index) => {
  const factId = db.prepare("SELECT id FROM world_facts WHERE campaign_id=? LIMIT 1").get(campaign.id).id;
  const npcId = db.prepare("SELECT id FROM npcs WHERE campaign_id=? LIMIT 1").get(campaign.id).id;
  db.prepare("UPDATE world_facts SET fact=?,updated_at=? WHERE id=?").run(`Changed fact ${index}`, new Date().toISOString(), factId);
  db.prepare("UPDATE npcs SET trait=?,updated_at=? WHERE id=?").run(`Changed NPC ${index}`, new Date().toISOString(), npcId);
});
const spell = findSpellByName("Melf's Acid Arrow");
if (!spell || spell.documentSlug !== "srd-2014") throw new Error("exact alias-aware server content lookup failed");
const exactSamples = [];
for (let i = 0; i < 100; i++) { const started = performance.now(); findSpellByName("Melf's Acid Arrow"); exactSamples.push(performance.now() - started); }
exactSamples.sort((a, b) => a - b);
console.log(JSON.stringify({ kind: "isolated-server-sqlite", node: process.version, fixture: { npcs: 125, facts: 30, sheets: 1 }, scenarios: [warm, changedSheet, changedFactNpc],
  exactContent: { label: "SERVER EXACT CONTENT path, NOT local external D&D RAG", samples: 100,
    p50Ms: +percentile(exactSamples, .5).toFixed(3), p95Ms: +percentile(exactSamples, .95).toFixed(3), bytes: Buffer.byteLength(JSON.stringify(spell)),
    sourceCitation: spell.data.source, documentSlug: spell.documentSlug, ragCalls: 0, modelCalls: 0, rerankerCalls: 0 } }, null, 2));
db.close();
removeTempDir(dir);
