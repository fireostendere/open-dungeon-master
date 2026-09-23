import type { Locale } from "./translations";

const TERMS: Record<string, Record<Locale, string>> = {
  barbarian: { en: "Barbarian", ru: "Варвар" },
  bard: { en: "Bard", ru: "Бард" },
  cleric: { en: "Cleric", ru: "Жрец" },
  druid: { en: "Druid", ru: "Друид" },
  fighter: { en: "Fighter", ru: "Воин" },
  monk: { en: "Monk", ru: "Монах" },
  paladin: { en: "Paladin", ru: "Паладин" },
  ranger: { en: "Ranger", ru: "Следопыт" },
  rogue: { en: "Rogue", ru: "Плут" },
  sorcerer: { en: "Sorcerer", ru: "Чародей" },
  warlock: { en: "Warlock", ru: "Колдун" },
  wizard: { en: "Wizard", ru: "Волшебник" },
  artificer: { en: "Artificer", ru: "Изобретатель" },
  human: { en: "Human", ru: "Человек" },
  elf: { en: "Elf", ru: "Эльф" },
  dwarf: { en: "Dwarf", ru: "Дварф" },
  halfling: { en: "Halfling", ru: "Полурослик" },
  gnome: { en: "Gnome", ru: "Гном" },
  half_elf: { en: "Half-elf", ru: "Полуэльф" },
  half_orc: { en: "Half-orc", ru: "Полуорк" },
  tiefling: { en: "Tiefling", ru: "Тифлинг" },
  dragonborn: { en: "Dragonborn", ru: "Драконорождённый" },
  kobold: { en: "Kobold", ru: "Кобольд" },
  acolyte: { en: "Acolyte", ru: "Послушник" },
  criminal: { en: "Criminal", ru: "Преступник" },
  folk_hero: { en: "Folk hero", ru: "Народный герой" },
  noble: { en: "Noble", ru: "Дворянин" },
  sage: { en: "Sage", ru: "Мудрец" },
  soldier: { en: "Soldier", ru: "Солдат" },
  strength: { en: "Strength", ru: "Сила" },
  dexterity: { en: "Dexterity", ru: "Ловкость" },
  constitution: { en: "Constitution", ru: "Телосложение" },
  intelligence: { en: "Intelligence", ru: "Интеллект" },
  wisdom: { en: "Wisdom", ru: "Мудрость" },
  charisma: { en: "Charisma", ru: "Харизма" },
};

export function characterDisplay(value: string, locale: Locale): string {
  const key = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  return Object.hasOwn(TERMS, key) ? TERMS[key][locale] : value;
}
