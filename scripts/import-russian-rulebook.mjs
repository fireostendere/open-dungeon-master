// node scripts/import-russian-rulebook.mjs <OmnisGM-Rules>/src/dnd/srd-5.1
// Source revision must match the existing Russian help catalog (CC-BY-4.0).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { metricize } from "./lib/metricize-russian-rules.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = process.argv[2];
assert.ok(source, "Pass the path to OmnisGM-Rules/src/dnd/srd-5.1");
const book = JSON.parse(readFileSync(path.join(root, "src/lib/rulebook/srd-5.1.json"), "utf8"));
const help = JSON.parse(readFileSync(path.join(root, "src/lib/help/srd-rules.ru.json"), "utf8"));
const cleanTitle = (text) => text.replace(/\s*\([^()]*[a-zA-Z][^()]*\)\s*$/, "").trim();
const key = (text) => cleanTitle(text).toLowerCase();
const slug = (text) => text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const documents = new Map();
function load(relative) {
  const en = readFileSync(path.join(source, "en", relative), "utf8");
  const ru = readFileSync(path.join(source, "ru", relative), "utf8");
  const headings = (text) => [...text.matchAll(/^(#{1,6}) (.+)$/gm)];
  const english = headings(en), russian = headings(ru);
  assert.equal(english.length, russian.length, `Heading count: ${relative}`);
  const entries = english.map((heading, i) => {
    assert.equal(heading[1], russian[i][1], `Heading level: ${relative}: ${heading[2]}`);
    return { name: heading[2], title: cleanTitle(russian[i][2]), level: heading[1].length, start: russian[i].index, body: russian[i].index + russian[i][0].length };
  });
  documents.set(relative, { ru, entries });
}
for (const file of readdirSync(path.join(source, "en"))) {
  if (file.endsWith(".md")) load(file);
}
for (const file of readdirSync(path.join(source, "en/06_Classes"))) load(`06_Classes/${file}`);

// A section includes all its child headings. Broad SRD chapters sometimes
// use siblings rather than nested headings, so their end is named explicitly.
function section(file, name, end) {
  const { ru, entries } = documents.get(file);
  const at = entries.findIndex((entry) => key(entry.name) === key(name));
  assert.ok(at >= 0, `${file}: missing ${name}`);
  const entry = entries[at];
  const next = end === null ? undefined : entries.slice(at + 1).find((candidate) => end ? candidate.name.toLowerCase() === end.toLowerCase() : candidate.level <= entry.level);
  const stop = next?.start ?? ru.length;
  let md = ru.slice(entry.body, stop).trim();
  // Explicit English anchors keep shared links and the existing quick links
  // valid in both languages; displayed headings remain Russian.
  const children = entries.filter((candidate) => candidate.start >= entry.body && candidate.start < stop);
  let heading = 0;
  md = md.replace(/^(#{1,6}) (.+)$/gm, (_, hashes) => {
    const child = children[heading++];
    return `${hashes} ${child.title} {#${slug(child.name)}}`;
  });
  md = metricize(md)
    .replace(/\*\*_([^_\n]+)_\*\*/g, "***$1***")
    .replace(/_\*\*([^*\n]+)\*\*_/g, "***$1***")
    .replace(/^Таблица:\s*(.+)$/gm, "**$1**");
  if (file === "01_Abilities.md") md = md.replace("> **Сокрытие**", "> ### Сокрытие {#hiding}");
  return { title: entry.title, md };
}
const rules = {
  "racial-traits": ["04_Races.md", "Racial Traits"],
  "beyond-1st-level": ["05_CharacterDetails.md", "Beyond 1st Level"],
  multiclassing: ["07_Multiclassing.md", "Multiclassing", null],
  alignment: ["05_CharacterDetails.md", "Alignment", "Backgrounds"],
  languages: ["05_CharacterDetails.md", "Languages"],
  inspiration: ["05_CharacterDetails.md", "Inspiration", "Languages"],
  backgrounds: ["05_CharacterDetails.md", "Backgrounds", "Inspiration"],
  feats: ["08_Feats.md", "Feats", null],
  "using-ability-scores": ["01_Abilities.md", "Abilities", null],
  adventuring: ["02_Adventuring.md", "Adventuring", null],
  combat: ["03_Combat.md", "Combat", null],
  spellcasting: ["10_Spells.md", "Spellcasting", "Cantrips (Level 0)"],
  "magic-items": ["13_MagicItems.md", "Magic Items", "Sentient Magic"],
  "sentient-magic-items": ["13_MagicItems.md", "Sentient Magic", "Artifacts"],
  artifacts: ["13_MagicItems.md", "Artifacts", "Avatar of Death"],
  "monster-statistics": ["14_Monsters.md", "Monsters", null],
  "nonplayer-characters": ["15_MonstersA-Z.md", "Customizing NPCs"],
  conditions: ["11_Conditions.md", "Conditions", null],
  "gods-of-the-multiverse": ["12_GamemasteringToolbox.md", "Pantheons", "Planes"],
  "the-planes-of-existence": ["12_GamemasteringToolbox.md", "Planes", null],
  "legal-information": ["00_Legal.md", "Legal Information", null],
};
for (const page of book.pages) {
  if (page.chapter === "equipment") rules[page.id] = ["09_Equipment.md", page.title];
  if (page.chapter === "running-the-game") rules[page.id] = ["12_GamemasteringToolbox.md", page.title];
}
const families = { Animated_Object: "Оживлённый предмет", Giant: "Великан", Chromatic: "Цветной дракон", Metallic: "Металлический дракон", Demon: "Демон", Devil: "Дьявол", Angel: "Ангел", Genie: "Джинн", Ooze: "Слизь", Ghoul: "Упырь", Sphinx: "Сфинкс", Svirfneblin: "Свирфнеблин", Fungi: "Гриб", Dinosaur: "Динозавр", Lycanthrope: "Ликантроп" };
const pages = book.pages.map((page) => {
  if (page.id === "spell-lists") return { ...page, title: "Списки заклинаний" };
  let translated;
  if (rules[page.id]) translated = section(...rules[page.id]);
  else {
    const file = page.kind === "spell" ? "10_Spells.md" : page.kind === "item" ? "13_MagicItems.md" : page.kind === "race" ? "04_Races.md" : page.kind === "monster" ? "15_MonstersA-Z.md" : [...documents.keys()].find((name) => name.startsWith("06_Classes/") && name.toLowerCase().includes(page.id));
    assert.ok(file, `No source file: ${page.id}`);
    translated = section(file, page.title, page.kind === "class" ? null : undefined);
  }
  const out = { ...page, ...translated };
  if (page.meta) out.meta = /^\*([^*\n]+)\*\s*$/m.exec(out.md)?.[1] ?? "";
  if (page.group) out.group = page.kind === "spell" ? page.group === "Cantrips" ? "Заговоры" : `${parseInt(page.group)}-й уровень` : out.title[0].toUpperCase();
  if (page.family) { assert.ok(families[page.family], page.family); out.family = families[page.family]; }
  assert.match(out.title, /[А-Яа-яЁё]/, `Untranslated title: ${page.id}`);
  assert.match(out.md, /[А-Яа-яЁё]/, `Untranslated text: ${page.id}`);
  return out;
});
const names = new Map(book.pages.map((page, i) => [page.title, pages[i].title]));
// This source presents spells by level; retain the original SRD class lists
// and translate every name using the same catalog as their linked pages.
const list = pages.find((page) => page.id === "spell-lists");
const namePattern = new RegExp([...names.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
list.md = list.md.replace(namePattern, (name) => names.get(name)).replace(/Spells/g, "— заклинания").replace(/Cantrips \(0 Level\)/g, "Заговоры (0-й уровень)").replace(/(\d)(?:st|nd|rd|th) Level/g, "$1-й уровень");

const listHeadings = [...book.pages.find((page) => page.id === "spell-lists").md.matchAll(/^#{1,6} (.+)$/gm)];
let listHeading = 0;
list.md = list.md.replace(/^(#{1,6}) (.+)$/gm, (_, hashes, title) => `${hashes} ${title} {#${slug(listHeadings[listHeading++][1])}}`);

const chapterCopy = [
  ["Расы", "Народы мира и расовые особенности персонажей."],
  ["Классы", "Двенадцать классов, их умения по уровням и архетипы."],
  ["Развитие персонажа", "Опыт, повышение уровня и мультиклассирование."],
  ["Личность и предыстория", "Мировоззрение, языки, вдохновение и происхождение героя."],
  ["Снаряжение", "Монеты, доспехи, оружие, инструменты, транспорт и расходы."],
  ["Черты", "Дополнительные таланты вместо повышения характеристик."],
  ["Использование характеристик", "Проверки, навыки, спасброски, преимущество и помеха."],
  ["Приключения", "Время, путешествия, окружающая среда и отдых."],
  ["Бой", "Инициатива, действия, перемещение, атаки, укрытие, урон и смерть."],
  ["Использование заклинаний", "Ячейки, компоненты, области воздействия и списки заклинаний."],
  ["Заклинания", "Все заклинания SRD, от заговоров до 9-го уровня."],
  ["Проведение игры", "Ловушки, болезни, безумие, объекты и яды."],
  ["Магические предметы", "Настройка, разумные предметы, артефакты и полный каталог."],
  ["Монстры", "Характеристики и описания чудовищ."],
  ["Существа", "Звери и другие обычные существа."],
  ["Неигровые персонажи", "От простолюдинов до архимагов."],
  ["Приложения", "Состояния, божества, планы существования и правовая информация."],
];
book.chapters = book.chapters.map((chapter, i) => ({ ...chapter, title: chapterCopy[i][0], blurb: chapterCopy[i][1] }));
book.pages = pages;
book.source = { ...book.source, title: "Системный справочный документ 5.1", conversion: `https://github.com/OmnisGM-App/OmnisGM-Rules/tree/${help._sourceCommit}/src/dnd/srd-5.1/ru` };
book.pages.at(-1).md += `\n\n${help._attribution}\n\nРусский перевод: OmnisGM Rules, редакция ${help._sourceCommit}. Для книги переведены оглавление и списки заклинаний, сохранены адреса страниц, расстояния и вес приведены к метрической системе.`;
writeFileSync(path.join(root, "src/lib/rulebook/srd-5.1.ru.json"), `${JSON.stringify(book)}\n`);
console.log(`Imported ${pages.length} Russian pages.`);
