import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoots = ["src", "narrator", "mcp", "shared"];
const extensions = new Set([".ts", ".tsx", ".mjs", ".mts", ".js"]);

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...filesUnder(full));
    else if (extensions.has(path.extname(name))) out.push(full);
  }
  return out;
}

const removedModules = [
  "@/lib/dm/loop",
  "@/lib/dm/delegate",
  "@/lib/model-client",
  "@/lib/story-prompt",
  "../story-prompt.ts",
  "@/lib/dm/maps",
  "@/lib/image-generate",
  "@/lib/dm/media-jobs",
  "@/lib/tts",
  "@/lib/tts-voices",
];

const removedClientEndpoints = [
  "/dm/beats/draft",
  "/dm/monsters",
  "/dm/cover",
  "/encounter/end-turn",
  "/tts/preview",
  "/image-options",
];

const violations = [];
for (const rootName of runtimeRoots) {
  const base = path.join(root, rootName);
  for (const file of filesUnder(base)) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    const text = readFileSync(file, "utf8");

    for (const token of removedModules) {
      if (text.includes(token)) violations.push(`${rel}: imports/references removed module ${token}`);
    }

    // Compatibility API routes may describe their own retired endpoint in
    // comments/paths. What must never come back is a browser caller.
    if (/^src\/app\/campaigns\/.*\.(?:ts|tsx)$/.test(rel) &&
        !rel.includes("/api/")) {
      for (const endpoint of removedClientEndpoints) {
        if (text.includes(endpoint)) violations.push(`${rel}: calls retired hosted endpoint ${endpoint}`);
      }
    }
  }
}

assert.deepEqual(violations, [], `Hosted-runtime remnants found:\n${violations.join("\n")}`);
console.log("Hosted-runtime boundary: OK");
