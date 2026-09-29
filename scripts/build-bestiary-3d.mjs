// Builds bestiary-3d.html: one self-contained page (JS, CSS and the creature
// catalog inlined) with a 3D model and idle animation for every creature in
// the Open5e content pack. Open it straight from disk, no server needed.
// Usage: npm run bestiary:3d   (needs data/content/open5e.sqlite, see scripts/fetch-content-pack.mjs)
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadCatalog } from "./lib/bestiary-catalog.mjs";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "bestiary-3d.html");

const catalog = loadCatalog().map(({ slug, name, type, size, subtype, group, speed, cr, sources }) => ({
  slug, name, type, size, subtype, group, cr, sources,
  speed: Object.fromEntries(Object.entries(speed ?? {}).filter(([, v]) => Number.isFinite(Number.parseInt(String(v), 10)))),
}));

const result = await build({
  entryPoints: [path.join(root, "src/bestiary-lab/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  tsconfig: path.join(root, "tsconfig.json"),
  outdir: path.join(root, ".bestiary-build"),
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "css" },
  logLevel: "warning",
});

const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
const data = JSON.stringify(catalog).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Бестиарий 3D · D&amp;D 5e</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="bestiary-data">${data}</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`bestiary-3d.html: ${catalog.length} creatures, ${(html.length / 1024).toFixed(0)} KB`);
