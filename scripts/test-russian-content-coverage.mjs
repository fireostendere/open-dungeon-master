import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const rules = JSON.parse(await readFile(new URL("../src/lib/help/srd-rules.ru.json", import.meta.url), "utf8"));
const expanded = JSON.parse(await readFile(new URL("../src/lib/help/expanded-feature-help.ru.json", import.meta.url), "utf8"));
const subclassCatalog = JSON.parse(await readFile(new URL("../src/lib/srd/subclasses.json", import.meta.url), "utf8"));
const help = await import("../src/lib/help/index.ts");

assert.equal(Object.keys(rules.spells).length, 319, "all SRD 5.1 spells are localized");
assert.equal(rules._sourceCommit, "aa46df41369b40ae2733b5a031f4be6d149dfa01");
assert.equal(Object.keys(rules.items).length, 240, "all SRD 5.1 magic items are localized");
assert.equal(Object.keys(rules.feats).length, 1, "the SRD 5.1 feat is localized");
assert.equal(Object.keys(rules.races).length, 9, "all SRD 5.1 races are localized");
assert.equal(Object.keys(rules.subraces).length, 4, "all subraces included in the Russian SRD are localized");
assert.equal(Object.keys(rules.classes).length, 12, "all SRD 5.1 base classes have localized features");
assert.equal(Object.keys(rules.subclasses).length, 12, "all SRD 5.1 subclasses have localized features");
assert.equal(Object.keys(expanded.classes).length, 13, "expanded rule explanations cover each ODM class");

let expandedSubclassCount = 0;
let expandedFeatureCount = 0;
for (const [classId, subclasses] of Object.entries(subclassCatalog.classes)) {
  for (const subclass of subclasses) {
    expandedSubclassCount += 1;
    const translated = expanded.classes[classId]?.[subclass.name];
    assert.ok(translated?.title && translated?.text, `${classId}/${subclass.name} has a Russian summary`);
    assert.match(translated.title + translated.text, /[А-Яа-яЁё]/, `${classId}/${subclass.name} is Russian`);
    assert.doesNotMatch(translated.title + translated.text, /\b[A-Za-z]{4,}\b/, `${classId}/${subclass.name} has no untranslated English`);
    assert.doesNotMatch(
      translated.title + translated.text,
      /(?:^|[^а-яё])(?:фут\p{L}*|фт\.?|фунт\p{L}*|фнт\.?|дюйм\p{L}*|миль\p{L}*|ярд\p{L}*|унци\p{L}*)/iu,
      `${classId}/${subclass.name} uses metric units`,
    );
    for (const feature of Object.values(subclass.levels).flat()) {
      expandedFeatureCount += 1;
      const localized = translated.features[feature.n];
      assert.ok(localized?.title && localized?.text, `${classId}/${subclass.name}/${feature.n} has a Russian explanation`);
      assert.match(localized.title + localized.text, /[А-Яа-яЁё]/, `${classId}/${subclass.name}/${feature.n} is Russian`);
      assert.doesNotMatch(localized.title + localized.text, /\b[A-Za-z]{4,}\b/, `${classId}/${subclass.name}/${feature.n} has no untranslated English`);
      assert.doesNotMatch(
        localized.title + localized.text,
        /(?:^|[^а-яё])(?:фут\p{L}*|фт\.?|фунт\p{L}*|фнт\.?|дюйм\p{L}*|миль\p{L}*|ярд\p{L}*|унци\p{L}*)/iu,
        `${classId}/${subclass.name}/${feature.n} uses metric units`,
      );
    }
  }
}
assert.equal(expandedSubclassCount, 105);
assert.equal(expandedFeatureCount, 533);
assert.doesNotMatch(rules.races.dwarf.text, /Холмовой дварф/);
assert.doesNotMatch(rules.races.elf.text, /Высший эльф/);
assert.match(rules.subraces.hill_dwarf.text, /Дварфийская выносливость/);
assert.match(rules.subraces.high_elf.text, /заговор на выбор.*списка заклинаний волшебника/i);
assert.doesNotMatch(rules.spells.prestidigitation.text, /0\s*м³/);
assert.match(rules.spells.prestidigitation.text, /28,3\s*л/);
assert.match(rules.races.dwarf.text, /от 1,2 м до 1,5 м/);
assert.match(rules.races.elf.text, /от менее 1,5 м до более 1,8 м/);
assert.match(rules.races.half_orc.text, /от 1,5 м до значительно более 1,8 м/);

for (const catalog of [rules.spells, rules.items, rules.feats]) {
  for (const [key, entry] of Object.entries(catalog)) {
    assert.ok(entry.title && entry.text, `${key} has a Russian title and description`);
    assert.match(entry.text, /[А-Яа-яЁё]/, `${key} description is Russian`);
  }
}
for (const [kind, catalog] of [["race", rules.races], ["subrace", rules.subraces]]) {
  for (const [key, entry] of Object.entries(catalog)) {
    assert.ok(entry.title && entry.text, `${kind} ${key} has Russian content`);
    assert.match(entry.text, /[А-Яа-яЁё]/, `${kind} ${key} is Russian`);
  }
}

assert.equal(help.localizedContentName("spells", "Fireball", "ru"), "Огненный шар");
assert.equal(help.localizedContentName("feats", "Grappler", "ru"), "Борец");
assert.match(
  help.describeContentEntry({ desc: "English description" }, "ru", { kind: "spell", name: "Fireball" }),
  /огня|огн/i,
);
assert.match(help.describeFeature("wizard", "School of Evocation", "Sculpt Spells", "ru") ?? "", /спасброск/);
assert.match(help.describeFeature("monk", "way-of-shadow", "Shadow Arts", "ru") ?? "", /[А-Яа-яЁё]/);
assert.match(
  help.describeFeature("barbarian", "Path of the Totem Warrior", "Totem Spirit", "ru") ?? "",
  /враги совершают с помехой провоцированные атаки/i,
);
assert.match(
  help.describeFeature("barbarian", "Path of the Totem Warrior", "Aspect of the Beast", "ru") ?? "",
  /1,6 км/,
);
assert.match(help.describeSubclass("artificer", "Alchemist", "ru") ?? "", /[А-Яа-яЁё]/);
assert.match(help.localizedSubclassName("artificer", "alchemist-artificer", "ru"), /алхим/i);
assert.match(help.localizedFeatureName("artificer", "Alchemist", "Experimental Elixir", "ru"), /эликсир/i);
assert.match(help.localizedContentName("archetypes", "Alchemist", "ru"), /алхим/i);
assert.match(help.describeContentEntry({ desc: "English" }, "ru", { kind: "archetypes", name: "Alchemist" }) ?? "", /[А-Яа-яЁё]/);
assert.match(help.describeRace("dwarf", "ru") ?? "", /дварф/i);
assert.match(help.describeRaceTrait("dwarf", "Dwarven Resilience", "ru") ?? "", /яд/i);
assert.match(help.describeRace("hill_dwarf", "ru") ?? "", /холмовой дварф/i);
assert.equal(help.localizedRaceName("hill_dwarf", "Dwarf (Hill)", "ru"), "Холмовой дварф");
assert.equal(help.localizedRaceName("lightfoot_halfling", "Halfling (Lightfoot)", "ru"), "Легконогий полурослик");
assert.equal(help.localizedRaceName("loxodon", "Loxodon", "ru"), "Локсодон");
assert.match(help.describeRaceTrait("hill_dwarf", "Darkvision 60 ft", "ru") ?? "", /тёмн|темн/i);
assert.equal(help.localizedRaceTraitName("Darkvision 60 ft", "ru"), "Тёмное зрение");

for (const [kind, catalog] of Object.entries(rules)) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) continue;
  const entries = Object.values(catalog).flatMap((value) =>
    typeof value === "string" ? [value] : Object.values(value ?? {}).filter((part) => typeof part === "string"),
  );
  for (const text of entries) {
    assert.doesNotMatch(
      text,
      /(?:^|[^а-яё])(?:фут\p{L}*|фт\.?|фунт\p{L}*|фнт\.?|дюйм\p{L}*|миль\p{L}*|ярд\p{L}*|унци\p{L}*)/iu,
      `${kind} text uses metric units`,
    );
  }
}

console.log("PASS Russian SRD coverage: spells, magic items, feats, races, class and subclass features");
