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
  } else if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.(ts|tsx|json|mjs|js)$/.test(spec) && context.parentURL) {
    try {
      const parentPath = new URL(context.parentURL).pathname;
      const bare = path.resolve(path.dirname(parentPath), spec);
      if (fs.existsSync(`${bare}.ts`)) {
        spec = pathToFileURL(`${bare}.ts`).href;
      } else if (fs.existsSync(`${bare}.tsx`)) {
        spec = pathToFileURL(`${bare}.tsx`).href;
      } else if (fs.existsSync(path.join(bare, "index.ts"))) {
        spec = pathToFileURL(path.join(bare, "index.ts")).href;
      }
    } catch {}
  }
  return nextResolve(spec, context);
}
export function load(url, context, nextLoad) {
  if (url.endsWith(".json")) return nextLoad(url, { ...context, importAttributes: { type: "json" } });
  return nextLoad(url, context);
}
