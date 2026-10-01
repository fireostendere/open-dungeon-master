// The painted icon set (ported from upstream) and the library that addresses
// it. The app computes an icon's path from its kind and name instead of
// loading a manifest, so the one thing that must never drift is the slug
// rule (checked on upstream's sample names). Also: the painted index matches
// the folders, names with no painting (a Russian or homebrew name) ask for
// nothing, a failed load is not asked for twice, and every glyph the code
// names literally is on disk.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { iconSlug, iconPath, familyIconPath, iconCandidates, markIconFailed, conditionIconKey } = await import("../src/lib/icons.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "public", "assets", "icons");

// Upstream's catalogue slug rule (scripts/icon-set.mjs there), kept verbatim
// so the library cannot drift from the names the files were written under.
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const folderBytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (sum, entry) => sum + (entry.isDirectory() ? folderBytes(path.join(dir, entry.name)) : statSync(path.join(dir, entry.name)).size),
    0,
  );

test("the library slugs a name exactly as the catalogue does", () => {
  for (const name of ["Fireball", "Tasha's Hideous Laughter", "Melf’s Acid Arrow", "Élan of the Fey", "Potion of Healing (Greater)", "  Bag  of Holding  ", "+1 Longsword", "Reflex Booster II"]) {
    assert.equal(iconSlug(name), slugify(name), name);
  }
});

test("paths are root relative and the fallback chain is own icon, then family", () => {
  assert.equal(iconPath("spell", "Magic Missile"), "/assets/icons/spell/magic-missile.webp");
  assert.equal(familyIconPath("spell-evocation"), "/assets/icons/family/spell-evocation.webp");
  assert.deepEqual(iconCandidates({ kind: "item", key: "Chain Mail", family: "item-armor" }), [
    "/assets/icons/item/chain-mail.webp",
    "/assets/icons/family/item-armor.webp",
  ]);
  // A name the catalogue never painted is not asked for: its family's icon
  // is the first and only try.
  assert.deepEqual(iconCandidates({ kind: "item", key: "Rope, hempen (50 feet)", family: "item-gear" }), [
    "/assets/icons/family/item-gear.webp",
  ]);
  assert.deepEqual(iconCandidates({ kind: "feat", key: "Athletic" }), ["/assets/icons/feat/athletic.webp"]);
  assert.deepEqual(iconCandidates({ kind: "feat", key: "Alert" }), [], "no painting, no family: nothing is asked for");
});

test("a Russian or homebrew name falls back to its family, then to nothing", () => {
  assert.deepEqual(iconCandidates({ kind: "item", key: "Меч предков", family: "item-gear" }), ["/assets/icons/family/item-gear.webp"]);
  assert.deepEqual(iconCandidates({ kind: "feature", key: "Ярость предков", family: "class-barbarian" }), ["/assets/icons/family/class-barbarian.webp"]);
  assert.deepEqual(iconCandidates({ kind: "feature", key: "Ярость предков", family: "class-homebrew-knight" }), []);
  assert.deepEqual(iconCandidates({ kind: "spell", key: "Огненный шар" }), []);
  assert.deepEqual(iconCandidates({ kind: "glyph", key: "tab-nowhere" }), [], "a glyph name with no file is not asked for");
});

test("a load that failed is not asked for again; the family takes over", () => {
  const ref = { kind: "spell", key: "Fireball", family: "spell-evocation" };
  assert.equal(iconCandidates(ref)[0], "/assets/icons/spell/fireball.webp");
  markIconFailed("/assets/icons/spell/fireball.webp");
  assert.deepEqual(iconCandidates(ref), ["/assets/icons/family/spell-evocation.webp"]);
});

test("free-text conditions find their painting, Russian ones by stem", () => {
  assert.equal(conditionIconKey("Poisoned"), "poisoned");
  assert.equal(conditionIconKey("exhaustion 2"), "exhaustion");
  assert.equal(conditionIconKey("poisoned by the dart"), "poisoned");
  assert.equal(conditionIconKey("Отравлена"), "poisoned");
  assert.equal(conditionIconKey("ошеломлён"), "stunned");
  assert.equal(conditionIconKey("без сознания"), "unconscious");
  assert.deepEqual(iconCandidates({ kind: "condition", key: conditionIconKey("Сломлен духом") }), [], "an unknown one draws nothing");
});

test("the painted index lists exactly the files in every folder", () => {
  const painted = JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "painted-icons.json"), "utf8"));
  for (const entry of readdirSync(ICONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = readdirSync(path.join(ICONS, entry.name)).map((name) => name.replace(/\.webp$/, "")).sort();
    assert.deepEqual([...(painted[entry.name] ?? [])].sort(), files, entry.name);
  }
});

test("every glyph and family the code names literally is on disk", () => {
  const missing = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(entry.name)) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/kind: "(glyph|family|condition)", key: "([a-z0-9-]+)"/g)) {
          if (!existsSync(path.join(ICONS, match[1], `${match[2]}.webp`))) missing.push(`${path.relative(ROOT, full)}: ${match[1]}/${match[2]}`);
        }
        // Glyph maps (tab -> "tab-party"): any glyph-shaped string in a file
        // that paints glyphs.
        if (!/GameIcon|paintedRailIcon|Glyph\b/.test(source)) continue;
        for (const match of source.matchAll(/(?<!data-tour=)"((?:tab|system|rest|die|cue|quest|coin|skill|ability|sense|daypart|attitude|pace|sky|climate|mount)-[a-z0-9-]+)"/g)) {
          if (!existsSync(path.join(ICONS, "glyph", `${match[1]}.webp`))) missing.push(`${path.relative(ROOT, full)}: glyph/${match[1]}`);
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(missing, []);
});

test("the fallback families the app names all exist", () => {
  for (const family of ["item-gear", "item-weapon", "item-armor", "item-magic-item", "class-wizard", "class-fighter", "spell-evocation", "damage-fire"]) {
    assert.ok(existsSync(path.join(ROOT, "public", familyIconPath(family))), family);
  }
});

test("the icon set fits the budget the app carries it under", () => {
  assert.ok(folderBytes(ICONS) <= 12 * 1024 * 1024, `icons are ${(folderBytes(ICONS) / 1048576).toFixed(1)} MB`);
});

console.log(`icons: ${passed} checks passed`);
