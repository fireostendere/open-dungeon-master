// Dev tool: renders a contact sheet PNG of generated creature models with
// headless Chrome, so a model change can be judged by eye.
//
//   node scripts/bestiary-contact-sheet.mjs --out sheet.png --names "Wolf,Goblin,Ancient Red Dragon"
//   node scripts/bestiary-contact-sheet.mjs --out sheet.png --plan quadruped --n 24
//   node scripts/bestiary-contact-sheet.mjs --out sheet.png --type undead --n 24 --cols 6 --cell 240
//   options: --time 1.0 (idle clock)  --yaw 0.6 (turn, radians)  --grid  --seed 3 (sampling)
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { loadCatalog } from "./lib/bestiary-catalog.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { deriveCreatureSpec } = await import("../src/lib/bestiary3d/spec.ts");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const out = path.resolve(String(args.out ?? "sheet.png"));
const cols = Number(args.cols ?? 6);
const cell = Number(args.cell ?? 260);
const catalog = loadCatalog();

let rows;
if (args.names) {
  const wanted = String(args.names).split(",").map((s) => s.trim().toLowerCase());
  rows = wanted.map((n) => catalog.find((c) => c.name.toLowerCase() === n) ?? catalog.find((c) => c.name.toLowerCase().includes(n)));
  const missing = wanted.filter((_, i) => !rows[i]);
  if (missing.length) console.warn("not found:", missing.join(", "));
  rows = rows.filter(Boolean);
} else {
  const n = Number(args.n ?? 24);
  let pool = catalog.map((c) => ({ c, spec: deriveCreatureSpec(c) }));
  if (args.plan) pool = pool.filter(({ spec }) => spec.plan === args.plan);
  if (args.type) pool = pool.filter(({ spec }) => spec.type === args.type);
  if (args.matched) pool = pool.filter(({ spec }) => spec.matchedBy === args.matched);
  // Evenly spaced sample so the sheet spans the whole alphabet.
  const seed = Number(args.seed ?? 0);
  const step = Math.max(1, pool.length / n);
  rows = Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[Math.floor(i * step + (seed % Math.max(1, Math.floor(step)))) % pool.length].c);
}

const tmp = path.join(os.tmpdir(), `bestiary-sheet-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const root = path.resolve(import.meta.dirname, "..");
const bundle = await build({
  entryPoints: [path.join(root, "src/bestiary-lab/sheet.ts")],
  bundle: true, write: false, format: "iife", platform: "browser", target: ["es2020"], minify: false,
  tsconfig: path.join(root, "tsconfig.json"), logLevel: "warning",
});
const js = bundle.outputFiles[0].text;
const opts = { cols, cell, time: Number(args.time ?? 1), yaw: Number(args.yaw ?? 0.6), grid: Boolean(args.grid) };
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1c1a24}canvas{display:block}.label{position:absolute;box-sizing:border-box;padding:4px 8px;font:12px/1.2 system-ui,sans-serif;color:#e8e2f4;text-shadow:0 1px 2px #000}</style><body><script>window.__ROWS__=${JSON.stringify(rows)};window.__OPTS__=${JSON.stringify(opts)};</script><script>${js.replace(/<\/script/g, "<\\/script")}</script>`;
const page = path.join(tmp, "sheet.html");
writeFileSync(page, html);
const nrows = Math.ceil(rows.length / cols);
execFileSync("/usr/bin/google-chrome", [
  "--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--hide-scrollbars", `--window-size=${cols * cell},${nrows * cell + 120}`, "--virtual-time-budget=6000",
  `--screenshot=${out}`, `file://${page}`,
], { stdio: ["ignore", "ignore", "pipe"] });
console.log(`wrote ${out} (${rows.length} creatures)`);
