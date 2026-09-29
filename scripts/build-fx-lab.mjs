// Builds animations-lab.html: one self-contained page (JS and CSS inlined)
// that mounts the game's real overlays with fake data. Open it straight from
// disk, no server needed. Usage: npm run fx:lab
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "animations-lab.html");

const result = await build({
  entryPoints: [path.join(root, "src/fx-lab/lab.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  outdir: path.join(root, ".fx-lab-build"),
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "css" },
  // "use client" directives are meaningless outside Next.
  logOverride: { "unsupported-directive": "silent" },
  logLevel: "warning",
});

const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ODM — стенд анимаций</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;600;700;800&family=Source+Serif+4:ital@0;1&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js.replaceAll("</script", "<\\/script")}</script>
</body>
</html>
`;

writeFileSync(out, html);
console.log(`[fx-lab] wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
