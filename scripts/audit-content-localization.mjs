// Dynamic catalogs require a separate audit: JSX scans cannot see their prose.
// Prints unresolved built-in entries; user-authored content is not in scope.
import { register } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
register("./lib/register-alias.mjs", import.meta.url);
const { localizedFeatureName, describeFeature, localizedContentName, describeContentEntry } = await import("../src/lib/help/index.ts");
const root = new URL("../src/lib/", import.meta.url);
const missing = [];
for (const file of readdirSync(new URL("classes/", root)).filter((name) => name.endsWith("-features.json"))) {
  const data = JSON.parse(readFileSync(new URL(`classes/${file}`, root), "utf8"));
  for (const [classId, table] of Object.entries(data.classes)) {
    for (const [subclass, levels] of [["", table.levels], [table.subclass.name, table.subclass.levels]]) {
      for (const [level, features] of Object.entries(levels)) {
        for (const feature of features) {
          const title = localizedFeatureName(classId, subclass, feature.n, "ru");
          const text = describeFeature(classId, subclass, feature.n, "ru");
          if (title === feature.n || !text || !/[а-яё]/i.test(text)) missing.push({ file: `src/lib/classes/${file}`, classId, subclass, level, name: feature.n, titleMissing: title === feature.n, descriptionMissing: !text || !/[а-яё]/i.test(text) });
        }
      }
    }
  }
}
for (const path of ["backgrounds/catalog.json", "srd/backgrounds.json"]) {
  const data = JSON.parse(readFileSync(new URL(path, root), "utf8"));
  for (const entry of data.backgrounds) {
    const title = localizedContentName("background", entry.name, "ru");
    const text = describeContentEntry(entry, "ru", { kind: "background", name: entry.name });
    if (title === entry.name || !text || !/[а-яё]/i.test(text)) missing.push({ file: `src/lib/${path}`, name: entry.name, titleMissing: title === entry.name, descriptionMissing: !text || !/[а-яё]/i.test(text) });
  }
}
console.log(JSON.stringify({ unresolvedCount: missing.length, entries: missing }, null, 2));
if (process.argv.includes("--strict") && missing.length) process.exitCode = 1;
