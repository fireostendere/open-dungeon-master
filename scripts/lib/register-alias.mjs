// Resolve the tsconfig alias when dependency-free Node tests import TS.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const srcDir = path.resolve(import.meta.dirname, "../../src");
export function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) {
    const bare = path.join(srcDir, spec.slice(2));
    let target = bare;
    if (!/\.(ts|tsx|json|mjs)$/.test(bare)) target = fs.existsSync(path.join(bare, "index.ts")) ? path.join(bare, "index.ts") : `${bare}.ts`;
    spec = pathToFileURL(target).href;
  }
  return nextResolve(spec, context);
}
export function load(url, context, nextLoad) {
  if (url.endsWith(".json")) return nextLoad(url, { ...context, importAttributes: { type: "json" } });
  return nextLoad(url, context);
}
