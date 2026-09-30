// Builds battlemap-lab.html: one self-contained page (JS and CSS inlined)
// that draws the real battle-map renderer in every style over a generated
// battle. Open it straight from
// disk, no server needed. Usage: npm run map:lab
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "battlemap-lab.html");

const result = await build({
  entryPoints: [path.join(root, "src/battlemap-lab/lab.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  outdir: path.join(root, ".battlemap-lab-build"),
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "css" },
  // "use client" directives are meaningless outside Next.
  logOverride: { "unsupported-directive": "silent" },
  logLevel: "warning",
});

const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";

const safeJs = js.replaceAll("</script", "<\\/script");

// --fragment=FILE writes the page body only (title, style, root, script), for
// hosts that wrap the page in their own document, such as a published artifact.
const fragment = process.argv.find((arg) => arg.startsWith("--fragment="))?.slice("--fragment=".length);
if (fragment) {
  const body = `<title>Стили карты боя</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
<script>${safeJs}</script>
`;
  writeFileSync(fragment, body);
  console.log(`[battlemap-lab] wrote fragment ${fragment} (${(body.length / 1024).toFixed(0)} KB)`);
  process.exit(0);
}

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ODM — карта боя, варианты</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;600;700;800&family=Source+Serif+4:ital@0;1&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${safeJs}</script>
</body>
</html>
`;

writeFileSync(out, html);
console.log(`[battlemap-lab] wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
