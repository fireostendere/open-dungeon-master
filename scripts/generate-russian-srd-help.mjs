#!/usr/bin/env node
// Extract the Russian SRD 5.1 player rules used by ODM's detail dialogs.
// Source checkout: https://github.com/OmnisGM-App/OmnisGM-Rules
// Usage: node scripts/generate-russian-srd-help.mjs <repo>/src/dnd/srd-5.1

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metricize } from "./lib/metricize-russian-rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = process.argv[2];
if (!source) throw new Error("Pass the path to OmnisGM-Rules/src/dnd/srd-5.1");

const sourceRoot = path.resolve(source);
const revision = execFileSync("git", ["-C", path.resolve(sourceRoot, "../../../"), "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const attribution =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.';

const read = (...parts) => readFileSync(path.join(sourceRoot, ...parts), "utf8");
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const baseName = (value) => value.replace(/\s*\([^)]*\)\s*$/, "").trim();
const clean = (value) => value.trim().replace(/\s+$/g, "");

function entries(markdown, level) {
  const heading = new RegExp(`^#{${level}} (.+)$`, "gm");
  const matches = [...markdown.matchAll(heading)];
  const boundaries = [...markdown.matchAll(new RegExp(`^#{1,${level}} .+$`, "gm"))];
  return matches.map((match) => {
    const end = boundaries.find((candidate) => candidate.index > match.index)?.index ?? markdown.length;
    const titled = match[1].trim();
    const english = titled.match(/\(([^()]*)\)\s*$/)?.[1]?.trim();
    return {
      heading: titled,
      english,
      title: metricize(english ? titled.slice(0, titled.lastIndexOf("(")).trim() : titled),
      text: metricize(clean(markdown.slice(match.index + match[0].length, end))),
      index: match.index,
    };
  });
}

function addNamed(target, sourceEntries) {
  for (const entry of sourceEntries) {
    if (!entry.english || !entry.text) continue;
    target[slug(entry.english)] = { title: entry.title, text: entry.text };
  }
}

const result = {
  _source: "OmnisGM Rules / D&D SRD 5.1 Russian translation",
  _sourceUrl: "https://github.com/OmnisGM-App/OmnisGM-Rules/tree/main/src/dnd/srd-5.1/ru",
  _sourceCommit: revision,
  _license: "CC-BY-4.0; extracted Markdown sections and headings into a lookup catalog.",
  _attribution: attribution,
  spells: {},
  items: {},
  feats: {},
  races: {},
  subraces: {},
  raceTraits: {},
  classes: {},
  classFeatureNames: {},
  subclasses: {},
  subclassFeatureNames: {},
};

addNamed(result.spells, entries(read("ru", "10_Spells.md"), 3));
addNamed(result.items, entries(read("ru", "13_MagicItems.md"), 4));
addNamed(result.feats, entries(read("ru", "08_Feats.md"), 4));

const raceEnglish = entries(read("en", "04_Races.md"), 2);
const raceRussian = entries(read("ru", "04_Races.md"), 2);
const raceTranslations = new Map(
  raceRussian.filter((entry) => entry.english).map((entry) => [slug(entry.english), entry]),
);
const subraceHeadings = new Set(["Hill Dwarf", "High Elf", "Rock Gnome", "Lightfoot"]);
function withoutSubraceSections(text) {
  let skipping = false;
  return text.split("\n").filter((line) => {
    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (skipping) {
      if (!heading || heading[1].length > 3) return false;
      skipping = false;
    }
    const englishName = heading?.[2].match(/\(([^()]*)\)\s*$/)?.[1] ?? heading?.[2];
    if (heading?.[1].length === 3 && englishName && subraceHeadings.has(englishName)) {
      skipping = true;
      return false;
    }
    return true;
  }).join("\n").trim();
}
for (const entry of raceEnglish) {
  const englishName = entry.english ?? entry.title;
  const translated = raceTranslations.get(slug(englishName));
  if (translated?.text) {
    result.races[slug(englishName).replaceAll("-", "_")] = {
      title: translated.title,
      text: withoutSubraceSections(translated.text),
    };
  }
}

const englishSubraces = entries(read("en", "04_Races.md"), 3);
const russianSubraces = entries(read("ru", "04_Races.md"), 3);
const subraceTranslations = new Map(
  russianSubraces.filter((entry) => entry.english).map((entry) => [slug(entry.english), entry]),
);
const SRD_SUBRACE_IDS = {
  "hill dwarf": "hill_dwarf",
  "high elf": "high_elf",
  "rock gnome": "rock_gnome",
  lightfoot: "lightfoot_halfling",
};
for (const entry of englishSubraces) {
  const englishName = entry.english ?? entry.title;
  const translated = subraceTranslations.get(slug(englishName));
  const id = SRD_SUBRACE_IDS[englishName.toLowerCase()];
  if (id && translated?.text) {
     result.subraces[id] = {
       title: id === "lightfoot_halfling" ? "Легконогий полурослик" : translated.title,
       text: translated.text,
     };
  }
}

function raceTraitSections(markdown) {
  const markers = [...markdown.matchAll(/^\*\*_([^*]+?)_\*\*\s*/gm)];
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    const end = next?.index ?? markdown.length;
    return {
      name: marker[1].replace(/\.$/, "").trim(),
      text: metricize(clean(markdown.slice(marker.index + marker[0].length, end))),
    };
  });
}

const englishTraits = raceTraitSections(read("en", "04_Races.md"));
const russianTraits = raceTraitSections(read("ru", "04_Races.md"));
if (englishTraits.length !== russianTraits.length) {
  throw new Error(`Race trait count differs: EN ${englishTraits.length}, RU ${russianTraits.length}`);
}
for (let index = 0; index < englishTraits.length; index += 1) {
  const name = englishTraits[index].name;
  const text = russianTraits[index].text;
  if (name && text) result.raceTraits[name] = { title: russianTraits[index].name, text };
}

const featureTables = JSON.parse(readFileSync(path.join(root, "src/lib/srd/class-features.json"), "utf8"))
  .classes;
const subclassFeatureText = JSON.parse(
  readFileSync(path.join(root, "src/lib/srd/subclasses.json"), "utf8"),
).classes;

function levelFeatures(markdown, locale) {
  const re = locale === "ru" ? /^#### Уровень (\d+): (.+)$/gm : /^#### Level (\d+): (.+)$/gm;
  const matches = [...markdown.matchAll(re)];
  const sectionHeadings = [...markdown.matchAll(/^#{2,4} .+$/gm)];
  return matches.map((match) => ({
    level: Number(match[1]),
    name: match[2].trim(),
    text: metricize(clean(markdown.slice(
      match.index + match[0].length,
      sectionHeadings.find((heading) => heading.index > match.index)?.index ?? markdown.length,
    ))),
    index: match.index,
  }));
}

function equivalentName(left, right) {
  return baseName(left).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
    baseName(right).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const classFiles = [
  "01_Barbarian", "02_Bard", "03_Cleric", "04_Druid", "05_Fighter", "06_Monk",
  "07_Paladin", "08_Ranger", "09_Rogue", "10_Sorcerer", "11_Warlock", "12_Wizard",
];
for (const file of classFiles) {
  const classId = file.slice(file.indexOf("_") + 1).toLowerCase();
  const english = read("en", "06_Classes", `${file}.md`);
  const russian = read("ru", "06_Classes", `${file}.md`);
  const englishFeatures = levelFeatures(english, "en");
  const russianFeatures = levelFeatures(russian, "ru");
  if (englishFeatures.length !== russianFeatures.length) {
    throw new Error(`${classId} feature count differs: EN ${englishFeatures.length}, RU ${russianFeatures.length}`);
  }
  const englishSubclassStart = english.search(/^### .* Subclass:/m);
  const russianSubclassStart = russian.search(/^### Подкласс /m);
  const englishBase = englishFeatures.filter((entry) => entry.index < englishSubclassStart || englishSubclassStart < 0);
  const russianBase = russianFeatures.filter((entry) => entry.index < russianSubclassStart || russianSubclassStart < 0);
  const classTranslations = (result.classes[classId] = {});
  const classNames = (result.classFeatureNames[classId] = {});
  for (let index = 0; index < englishBase.length; index += 1) {
    const sourceFeature = englishBase[index];
    const translated = russianBase[index];
    classTranslations[sourceFeature.name] = translated.text;
    classNames[sourceFeature.name] = translated.name;
    for (const name of featureTables[classId]?.levels?.[String(sourceFeature.level)] ?? []) {
      if (equivalentName(name, sourceFeature.name)) {
        classTranslations[name] = translated.text;
        classNames[name] = translated.name;
      }
    }
  }

  const englishSubclass = englishFeatures.filter((entry) => entry.index >= englishSubclassStart && englishSubclassStart >= 0);
  const russianSubclass = russianFeatures.filter((entry) => entry.index >= russianSubclassStart && russianSubclassStart >= 0);
  if (englishSubclass.length !== russianSubclass.length) {
    throw new Error(`${classId} subclass feature count differs: EN ${englishSubclass.length}, RU ${russianSubclass.length}`);
  }
  const englishSubclassTitle = english.match(/^### [^\n]* Subclass: (.+)$/m)?.[1]?.trim();
  if (!englishSubclassTitle) continue;
  const subclassKey = `${classId}::${englishSubclassTitle.toLowerCase()}`;
  const translatedFeatures = (result.subclasses[subclassKey] = {});
  const translatedNames = (result.subclassFeatureNames[subclassKey] = {});
  for (let index = 0; index < englishSubclass.length; index += 1) {
    const sourceFeature = englishSubclass[index];
    const translated = russianSubclass[index];
    translatedFeatures[sourceFeature.name] = translated.text;
    translatedNames[sourceFeature.name] = translated.name;
    for (const subclass of featureTables[classId]?.subclasses ?? []) {
      for (const name of subclass.levels?.[String(sourceFeature.level)] ?? []) {
        if (equivalentName(name, sourceFeature.name)) {
          translatedFeatures[name] = translated.text;
          translatedNames[name] = translated.name;
        }
      }
    }
    // Some source features (e.g. oath tenets and always-prepared spell lists)
    // are useful in class detail dialogs even though they are not sheet grants.
    const authored = subclassFeatureText[classId]?.find(
      (subclass) => subclass.name.toLowerCase() === englishSubclassTitle.toLowerCase(),
    );
    for (const [level, features] of Object.entries(authored?.levels ?? {})) {
      if (+level !== sourceFeature.level) continue;
      for (const feature of features) {
        if (equivalentName(feature.n, sourceFeature.name)) {
          translatedFeatures[feature.n] = translated.text;
          translatedNames[feature.n] = translated.name;
        }
      }
    }
  }
}

const out = path.join(root, "src/lib/help/srd-rules.ru.json");
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${out}: ${Object.keys(result.spells).length} spells, ${Object.keys(result.items).length} items, ${Object.keys(result.feats).length} feats, ${Object.keys(result.races).length} races`);
