import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { uiCopy, UI_COPY } = await import("../src/lib/i18n/inline-copy.ts");
const { optionsOfKind, optionFeatureName } = await import("../src/lib/srd/options.ts");
const { optionCopy } = await import("../src/lib/i18n/option-copy.ts");
const { FIGHTING_STYLES } = await import("../src/lib/srd/feature-effects.ts");
const { helpText } = await import("../src/lib/i18n/help-copy.ts");
const { equipmentCopy } = await import("../src/lib/i18n/equipment-copy.ts");
const { glossaryTerms, describeSkill, localizedContentName, localizedFeatureName, describeFeature, spellSummary } = await import("../src/lib/help/index.ts");
const read = (name) => JSON.parse(readFileSync(new URL(`../src/lib/i18n/${name}`, import.meta.url), "utf8"));
for (const [key, value] of Object.entries(UI_COPY)) {
  for (const locale of ["en", "ru"]) {
    const params = Object.fromEntries([...value[locale].matchAll(/\{(\w+)\}/g)].map((m) => [m[1], "$& Пример"]));
    assert.equal(uiCopy(locale, key, params), value[locale].replace(/\{(\w+)\}/g, () => "$& Пример"));
  }
}
const choices = read("options-copy.json");
assert.equal(Object.keys(choices).length, 124);
let optionCount = 0;
for (const kind of ["invocation", "maneuver", "metamagic", "pact_boon", "infusion", "rune", "discipline"]) {
  for (const option of optionsOfKind(kind)) {
    optionCount++;
    const en = optionCopy(option, "en"), ru = optionCopy(option, "ru");
    assert.equal(en.title, option.n);
    assert.equal(en.text, option.d);
    assert.equal(en.requirement ?? "", option.req ?? "");
    assert.match(ru.title, /[а-яё]/i, option.n);
    assert.match(ru.text, /[а-яё]/i, option.n);
    assert.equal(Boolean(ru.requirement), Boolean(option.req));
    const canonical = optionFeatureName(kind, option.n);
    assert.equal(localizedFeatureName("warlock", "", canonical, "en"), canonical);
    assert.notEqual(localizedFeatureName("warlock", "", canonical, "ru"), canonical);
    assert.ok(describeFeature("warlock", "", canonical, "ru").startsWith(ru.text));
  }
}
assert.equal(optionCount, 124);
for (const style of FIGHTING_STYLES) {
  assert.notEqual(helpText(style.description, "ru"), style.description);
  assert.equal(helpText(style.description, "en"), style.description);
  assert.equal(describeFeature("fighter", "", `Fighting Style: ${style.name}`, "ru"), helpText(style.description, "ru"));
}
const gear = read("equipment-copy.json");
for (const copies of Object.values(gear)) {
  assert.ok(equipmentCopy(copies.en.title, "ru")?.title, copies.en.title);
  assert.match(copies.ru.title, /[а-яё]/i, copies.en.title);
}
assert.equal(localizedContentName("items", "Longsword +1", "ru"), "Длинный меч +1");
assert.equal(localizedContentName("items", "My handwritten treasure", "ru"), "My handwritten treasure");
assert.equal(localizedContentName("spells", "Fireball", "en"), "Fireball");
assert.notEqual(localizedContentName("spells", "Fireball", "ru"), "Fireball");
assert.notEqual(localizedContentName("items", "Explorer's Pack", "ru"), "Explorer's Pack");
for (const term of glossaryTerms("ru")) assert.match(term.short, /[а-яё]/i, term.id);
assert.match(describeSkill("acrobatics", "ru"), /Акробатика/);
assert.match(describeSkill("acrobatics", "en"), /Acrobatics uses Dexterity/);
assert.match(spellSummary({ name: "Fireball", level: 3, school: "evocation", casting_time: "1 action", range: "150 feet" }, "ru"), /Воплощение 3-го уровня · Действие · 45 м/);
assert.equal(localizedContentName("background", "Acolyte", "ru"), "Прислужник");
assert.equal(localizedFeatureName("fighter", "", "City Secrets (Urchin)", "ru"), "Городские тайны (Беспризорник)");
assert.match(describeFeature("fighter", "", "City Secrets (Urchin)", "ru"), /городской/);
console.log(`PASS content localization: ${Object.keys(UI_COPY).length} UI keys, 124 choices, ${Object.keys(gear).length} equipment entries, 43 glossary terms, 6 fighting styles; canonical and custom names preserved`);
