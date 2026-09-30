// "What does this actually do?" for every game term a player meets.
//
// The app already held rules text in four places, all of it written for the
// DM model rather than for a person: guidance strings on FEATURE_EFFECTS and
// RESOURCE_DEFS, the rules text on authored subclass features, and the
// one-liners on custom genre-class features. This module resolves all of them
// behind one call, and srd-features.json fills the last gap (the 131 SRD
// feature names that had no text anywhere).
//
// Pure data and pure functions with no server imports, so client components
// can import it directly, exactly like src/lib/srd/features.ts.

import glossaryJson from "@/lib/help/glossary.json";
import raceHelpRuJson from "@/lib/help/race-help.ru.json";
import featureHelpRuJson from "@/lib/help/feature-help.ru.json";
import srdRulesRuJson from "@/lib/help/srd-rules.ru.json";
import expandedFeatureHelpRuJson from "@/lib/help/expanded-feature-help.ru.json";
import srdFeaturesJson from "@/lib/help/srd-features.json";
import starterSpellsJson from "@/lib/help/starter-spells.json";
import racesJson from "@/lib/srd/races.json";
import subclassesJson from "@/lib/srd/subclasses.json";
import skillsJson from "@/lib/srd/skills.json";
import { classFeatureDescription, spellClassFor } from "@/lib/classes";
import { matchResource } from "@/lib/srd/class-resources";
import { guidanceFor } from "@/lib/srd/feature-effects";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { findOptionByFeatureName } from "@/lib/srd/options";
import type { Locale } from "@/lib/i18n/translations";

export type GlossaryTerm = {
  id: string;
  term: string;
  short: string;
  long?: string;
};

const TERMS = (glossaryJson as { terms: GlossaryTerm[] }).terms;
const TERMS_BY_ID = new Map(TERMS.map((entry) => [entry.id, entry]));

const SRD_FEATURE_TEXT = (srdFeaturesJson as { features: Record<string, string> }).features;
const SRD_FEATURE_BY_CLASS = (
  srdFeaturesJson as { byClass: Record<string, Record<string, string>> }
).byClass;
const FEATURE_HELP_RU = featureHelpRuJson as {
  shared: Record<string, string>;
  classes: Record<string, Record<string, string>>;
  subclasses: Record<string, Record<string, string>>;
};
const RACE_HELP_RU = raceHelpRuJson as unknown as Record<
  string,
  { summary: string; traits: Record<string, string> }
>;
const SRD_RULES_RU = srdRulesRuJson as {
  spells: Record<string, { title: string; text: string }>;
  items: Record<string, { title: string; text: string }>;
  feats: Record<string, { title: string; text: string }>;
  races: Record<string, { title: string; text: string }>;
  subraces: Record<string, { title: string; text: string }>;
  raceTraits: Record<string, { title: string; text: string }>;
  classes: Record<string, Record<string, string>>;
  classFeatureNames: Record<string, Record<string, string>>;
  subclasses: Record<string, Record<string, string>>;
  subclassFeatureNames: Record<string, Record<string, string>>;
};
type ExpandedHelpEntry = {
  title: string;
  text: string;
  features: Record<string, { title: string; text: string }>;
};
const EXPANDED_FEATURE_HELP_RU = (
  expandedFeatureHelpRuJson as {
    classes: Record<string, Record<string, ExpandedHelpEntry>>;
  }
).classes;
const SUBCLASSES = (
  subclassesJson as {
    classes: Record<string, Array<{ name: string; aliases?: string[] }>>;
  }
).classes;
const RACE_PARENTS: Record<string, string> = {
  hill_dwarf: "dwarf",
  mountain_dwarf: "dwarf",
  high_elf: "elf",
  wood_elf: "elf",
  drow: "elf",
  rock_gnome: "gnome",
  forest_gnome: "gnome",
  deep_gnome: "gnome",
  lightfoot_halfling: "halfling",
  stout_halfling: "halfling",
};
const RACE_NAME_RU: Record<string, string> = {
  mountain_dwarf: "Горный дварф",
  wood_elf: "Лесной эльф",
  drow: "Дроу",
  forest_gnome: "Лесной гном",
  deep_gnome: "Подземный гном",
  stout_halfling: "Коренастый полурослик",
  variant_human: "Человек (вариант)",
  aasimar: "Аасимар",
  goliath: "Голиаф",
  firbolg: "Фирболг",
  tabaxi: "Табакси",
  kenku: "Кенку",
  tortle: "Тортл",
  fire_genasi: "Огненный генази",
  water_genasi: "Водный генази",
  air_genasi: "Воздушный генази",
  earth_genasi: "Земляной генази",
  changeling: "Перевёртыш",
  warforged: "Варфорджед",
  goblin: "Гоблин",
  bugbear: "Багбир",
  lizardfolk: "Ящеролюд",
  loxodon: "Локсодон",
};

function normalizedCatalogName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalSubclassName(classId: string, subclass: string): string | null {
  const wanted = normalizedCatalogName(subclass);
  const match = SUBCLASSES[classId.trim().toLowerCase()]?.find(({ name, aliases = [] }) =>
    [name, ...aliases].some((candidate) => normalizedCatalogName(candidate) === wanted),
  );
  return match?.name ?? null;
}

function expandedSubclassHelp(classId: string, subclass: string): ExpandedHelpEntry | null {
  const canonical = canonicalSubclassName(classId, subclass);
  return canonical ? EXPANDED_FEATURE_HELP_RU[classId.trim().toLowerCase()]?.[canonical] ?? null : null;
}

function expandedSubclassByName(subclass: string): ExpandedHelpEntry | null {
  const wanted = normalizedCatalogName(subclass);
  for (const [classId, entries] of Object.entries(SUBCLASSES)) {
    const match = entries.find(({ name, aliases = [] }) =>
      [name, ...aliases].some((candidate) => normalizedCatalogName(candidate) === wanted),
    );
    if (match) return EXPANDED_FEATURE_HELP_RU[classId]?.[match.name] ?? null;
  }
  return null;
}

export function glossaryTerms(): GlossaryTerm[] {
  return TERMS;
}

export function glossaryTerm(id: string): GlossaryTerm | null {
  return TERMS_BY_ID.get(id) ?? null;
}

// Numbered SRD variants ("Indomitable (2 uses)", "Extra Attack (2)") are
// listed in full where the count changes the meaning, and fall back to the
// bare name where it does not.
function baseName(name: string): string {
  const paren = name.indexOf(" (");
  return paren === -1 ? name : name.slice(0, paren);
}

// An entry written for this exact feature name. Checked before the resource
// and effect tables, whose matching is deliberately fuzzy: "Wild Shape
// Improvement" contains "Wild Shape" and would otherwise be explained as the
// base feature rather than as the upgrade it is.
function exactSrdText(classId: string, name: string): string | null {
  const byClass = SRD_FEATURE_BY_CLASS[classId.trim().toLowerCase()];
  return byClass?.[name] ?? SRD_FEATURE_TEXT[name] ?? null;
}

function looseSrdText(classId: string, name: string): string | null {
  const byClass = SRD_FEATURE_BY_CLASS[classId.trim().toLowerCase()];
  return byClass?.[baseName(name)] ?? SRD_FEATURE_TEXT[baseName(name)] ?? null;
}

// The guidance strings were written to be read in a tool result, where naming
// the feature first is useful. In a dialog already titled with that name it
// just stutters, so a leading "Feature name:" is trimmed off.
function stripLeadingLabel(text: string | null, name: string): string | null {
  if (!text) {
    return text;
  }
  const prefix = `${name.trim()}:`;
  return text.trim().toLowerCase().startsWith(prefix.toLowerCase())
    ? text.trim().slice(prefix.length).trim()
    : text;
}

// One line explaining a feature on a sheet. Resolution runs most specific
// first: a Life Domain cleric's Divine Strike says "radiant", a Nature
// Domain one says "cold", and only a feature with no subclass-specific
// meaning falls through to the shared SRD text.
export function describeFeature(
  classId: string,
  subclass: string,
  name: string,
  locale: Locale = "en",
): string | null {
  if (locale === "ru") {
    const key = name.trim();
    const classKey = classId.trim().toLowerCase();
    const subclassKey = `${classKey}::${subclass.trim().toLowerCase()}`;
    const expanded = expandedSubclassHelp(classKey, subclass)?.features[key]?.text;
    const translated =
      FEATURE_HELP_RU.subclasses[subclassKey]?.[key] ??
      FEATURE_HELP_RU.classes[classKey]?.[key] ??
      FEATURE_HELP_RU.shared[key] ??
      SRD_RULES_RU.subclasses[subclassKey]?.[key] ??
      SRD_RULES_RU.classes[classKey]?.[key] ??
      expanded;
    if (translated) return translated;
  }
  // An option pick ("Invocation: Agonizing Blast") explains itself from the
  // option list, before any of the feature tables are consulted.
  const option = findOptionByFeatureName(name);
  if (option) {
    return option.req ? `${option.d} (Requires ${option.req}.)` : option.d;
  }
  const found =
    subclassFeatureDescription(classId, subclass, name) ??
    classFeatureDescription(classId, name) ??
    exactSrdText(classId, name) ??
    matchResource(name)?.guidance ??
    guidanceFor({ class: classId, features: [], feature: name }) ??
    looseSrdText(classId, name);
  return stripLeadingLabel(found, name);
}

const RACES = (racesJson as { races: Array<{ id: string; name: string; traits: string[] }> }).races;

function normalizeRaceId(raceId: string) {
  return raceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

// The bundled lineage lines. Racial traits are written to describe themselves
// ("Darkvision 60 ft", "Powerful Build (count as one size larger for
// carrying)"), so the trait list IS the description.
export function describeRace(raceId: string, locale: Locale = "en"): string | null {
  const normalized = normalizeRaceId(raceId);
  if (locale === "ru" && RACE_HELP_RU[normalized]) return RACE_HELP_RU[normalized].summary;
  if (locale === "ru") {
    const parent = RACE_PARENTS[normalized] ?? normalized;
    const raceText = SRD_RULES_RU.races[parent]?.text;
    const subrace = SRD_RULES_RU.subraces[normalized];
    if (raceText && subrace) return `${raceText}\n\n### ${subrace.title}\n\n${subrace.text}`;
    if (raceText || subrace) return raceText ?? subrace?.text ?? null;
  }
  const race = RACES.find((entry) => entry.id === normalized);
  return race ? race.traits.join(". ") + "." : null;
}

export function describeRaceTrait(
  raceId: string,
  traitName: string,
  locale: Locale = "en",
): string | null {
  const race = RACE_HELP_RU[normalizeRaceId(raceId)];
  if (locale === "ru" && race?.traits[traitName]) return race.traits[traitName];
  if (locale === "ru") {
    const key = baseName(traitName).replace(/\s+\d+\s*(?:ft|feet)\.?$/i, "").trim();
    const trait = SRD_RULES_RU.raceTraits[key];
    if (trait) return trait.text;
  }
  return null;
}

export function localizedFeatureName(
  classId: string,
  subclass: string,
  featureName: string,
  locale: Locale = "en",
): string {
  if (locale !== "ru") return featureName;
  const classKey = classId.trim().toLowerCase();
  const subclassKey = `${classKey}::${subclass.trim().toLowerCase()}`;
  const exact =
    SRD_RULES_RU.subclassFeatureNames[subclassKey]?.[featureName] ??
    SRD_RULES_RU.classFeatureNames[classKey]?.[featureName] ??
    expandedSubclassHelp(classKey, subclass)?.features[featureName]?.title ??
    SRD_RULES_RU.raceTraits[
      baseName(featureName).replace(/\s+\d+\s*(?:ft|feet)\.?$/i, "").trim()
    ]?.title;
  if (exact) return exact;
  return FEATURE_NAME_RU[featureName] ?? featureName;
}

export function localizedSubclassName(
  classId: string,
  subclass: string,
  locale: Locale = "en",
): string {
  return locale === "ru" ? expandedSubclassHelp(classId, subclass)?.title ?? subclass : subclass;
}

export function describeSubclass(
  classId: string,
  subclass: string,
  locale: Locale = "en",
): string | null {
  return locale === "ru" ? expandedSubclassHelp(classId, subclass)?.text ?? null : null;
}

export function localizedRaceName(raceId: string, name: string, locale: Locale = "en"): string {
  if (locale !== "ru") return name;
  const normalized = normalizeRaceId(raceId);
  const race = RACES.find((entry) => entry.id === normalized) as
    | { nameRu?: string }
    | undefined;
  return SRD_RULES_RU.subraces[normalized]?.title ??
    RACE_NAME_RU[normalized] ??
    SRD_RULES_RU.races[normalized]?.title ??
    race?.nameRu ??
    name;
}

export function localizedRaceTraitName(traitName: string, locale: Locale = "en"): string {
  if (locale !== "ru") return traitName;
  const key = baseName(traitName).replace(/\s+\d+\s*(?:ft|feet)\.?$/i, "").trim();
  return SRD_RULES_RU.raceTraits[key]?.title ?? FEATURE_NAME_RU[key] ?? traitName;
}

const SKILLS = (skillsJson as { skills: Array<{ id: string; name: string; ability: string }> })
  .skills;

// A skill's line: which ability it uses, plus the glossary note on skills.
export function describeSkill(skillId: string): string | null {
  const skill = SKILLS.find((entry) => entry.id === skillId.trim().toLowerCase());
  if (!skill) {
    return null;
  }
  const ability = glossaryTerm(skill.ability);
  return `${skill.name} uses ${ability?.term ?? skill.ability.toUpperCase()}. ${
    ability?.short ?? ""
  }`.trim();
}

// The description carried on a content-pack or homebrew row. Pack rows keep
// the source's own field names, which differ between v1, v2 and the authored
// layer, so every spelling is tried.
export function describeContentEntry(
  data: Record<string, unknown> | undefined,
  locale: Locale = "en",
  hint?: { kind: string; name?: string; slug?: string },
): string | null {
  if (!data) {
    return null;
  }
  if (locale === "ru") {
    const kind = (hint?.kind ?? "").toLowerCase().replace(/s$/, "");
    const name = hint?.name ?? (typeof data.name === "string" ? data.name : hint?.slug ?? "");
    const contentKind =
      kind === "spell" ? "spells" :
        kind === "feat" ? "feats" :
          kind === "race" ? "races" :
            kind === "item" ? "items" : null;
    if (kind === "archetype") {
      const subclass = expandedSubclassByName(name);
      if (subclass?.text) return subclass.text;
    }
    const translated = contentKind ? SRD_RULES_RU[contentKind]?.[contentSlug(name)] : null;
    if (translated?.text) return translated.text;
    for (const key of ["desc_ru", "description_ru", "traits_ru", "benefits_ru", "descRu", "descriptionRu"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    const localizedFields = (data.translations as Record<string, Record<string, unknown>> | undefined)?.ru;
    if (localizedFields) {
      for (const key of ["desc", "description", "traits", "benefits"]) {
        const value = localizedFields[key];
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  for (const key of ["desc", "description", "traits", "benefits"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof (entry as { desc?: string })?.desc === "string"
              ? (entry as { desc: string }).desc
              : "",
        )
        .filter(Boolean)
        .join("\n\n");
      if (joined.trim()) {
        return joined;
      }
    }
  }
  return null;
}

export function localizedContentName(kind: string, name: string, locale: Locale = "en"): string {
  if (locale !== "ru") return name;
  const normalizedKind = kind.toLowerCase().replace(/s$/, "");
  if (normalizedKind === "archetype") return expandedSubclassByName(name)?.title ?? name;
  const entries = normalizedKind === "spell"
    ? SRD_RULES_RU.spells
    : normalizedKind === "feat"
      ? SRD_RULES_RU.feats
      : normalizedKind === "race"
        ? SRD_RULES_RU.races
        : normalizedKind === "item"
          ? SRD_RULES_RU.items
          : null;
  if (!entries) return name;
  const direct = entries[contentSlug(name)];
  if (direct?.title) return direct.title;
  const race = normalizedKind === "race" ? SRD_RULES_RU.races[normalizeRaceId(name)] : null;
  return race?.title ?? name;
}

const FEATURE_NAME_RU: Record<string, string> = {
  "Loxodon Serenity": "Спокойствие локсодона",
  "Natural Armor": "Природная броня",
  "Powerful Build": "Могучее телосложение",
  Trunk: "Хобот",
  "Keen Smell": "Острое обоняние",
};

export type StarterSpells = {
  why: string;
  cantrips: Array<{ n: string; d: string }>;
  spells: Array<{ n: string; d: string }>;
};

const STARTERS = (starterSpellsJson as { classes: Record<string, StarterSpells> }).classes;

// Opening spell suggestions for a class. A new player who does not know 5e
// cannot search for a spell whose name they have never heard, so the builder
// offers these as one-tap picks next to the full list. Custom genre casters
// borrow the list of whichever SRD class they cast from.
export function starterSpellsFor(classId: string): StarterSpells | null {
  return STARTERS[spellClassFor(classId)] ?? STARTERS[classId] ?? null;
}

// Sheets store spells, feats and items by name, not by slug. This is the same
// transform scripts/lib/open5e-normalize.mjs uses, so most names resolve
// straight to their pack row; InfoDialog falls back to a search by name when
// a row uses a slug of its own.
export function contentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The one-line summary shown under a spell's name in a picker: level, school
// and the flags that change how it is cast.
export function spellSummary(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return "";
  }
  const level = Number(data.level_int ?? data.level ?? 0);
  const school = String(
    (data.school as { name?: string })?.name ?? data.school ?? "",
  ).toLowerCase();
  const parts = [
    level === 0 ? `${school} cantrip` : `level ${level} ${school}`.trim(),
    String(data.casting_time ?? ""),
    String(data.range ?? ""),
    data.concentration ? "concentration" : "",
    data.ritual ? "ritual" : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
