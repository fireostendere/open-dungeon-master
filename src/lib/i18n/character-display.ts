import type { Locale } from "./translations";

const TERMS: Record<string, Record<Locale, string>> = {
  barbarian: { en: "Barbarian", ru: "Варвар", pl: "Barbarzyńca" },
  bard: { en: "Bard", ru: "Бард", pl: "Bard" },
  cleric: { en: "Cleric", ru: "Жрец", pl: "Kleryk" },
  druid: { en: "Druid", ru: "Друид", pl: "Druid" },
  fighter: { en: "Fighter", ru: "Воин", pl: "Wojownik" },
  monk: { en: "Monk", ru: "Монах", pl: "Mnich" },
  paladin: { en: "Paladin", ru: "Паладин", pl: "Paladyn" },
  ranger: { en: "Ranger", ru: "Следопыт", pl: "Łowca" },
  rogue: { en: "Rogue", ru: "Плут", pl: "Łotrzyk" },
  sorcerer: { en: "Sorcerer", ru: "Чародей", pl: "Czarownik" },
  warlock: { en: "Warlock", ru: "Колдун", pl: "Czarnoksiężnik" },
  wizard: { en: "Wizard", ru: "Волшебник", pl: "Czarodziej" },
  artificer: { en: "Artificer", ru: "Изобретатель", pl: "Artificer" },
  human: { en: "Human", ru: "Человек", pl: "Człowiek" },
  elf: { en: "Elf", ru: "Эльф", pl: "Elf" },
  dwarf: { en: "Dwarf", ru: "Дварф", pl: "Krasnolud" },
  halfling: { en: "Halfling", ru: "Полурослик", pl: "Niziołek" },
  gnome: { en: "Gnome", ru: "Гном", pl: "Gnom" },
  half_elf: { en: "Half-elf", ru: "Полуэльф", pl: "Półelf" },
  half_orc: { en: "Half-orc", ru: "Полуорк", pl: "Półork" },
  tiefling: { en: "Tiefling", ru: "Тифлинг", pl: "Diabelstwo" },
  dragonborn: { en: "Dragonborn", ru: "Драконорождённый", pl: "Smokorodny" },
  kobold: { en: "Kobold", ru: "Кобольд", pl: "Kobold" },
  acolyte: { en: "Acolyte", ru: "Послушник", pl: "Akolita" },
  criminal: { en: "Criminal", ru: "Преступник", pl: "Przestępca" },
  folk_hero: { en: "Folk hero", ru: "Народный герой", pl: "Bohater ludowy" },
  noble: { en: "Noble", ru: "Дворянин", pl: "Szlachcic" },
  sage: { en: "Sage", ru: "Мудрец", pl: "Mędrzec" },
  soldier: { en: "Soldier", ru: "Солдат", pl: "Żołnierz" },
  strength: { en: "Strength", ru: "Сила", pl: "Siła" },
  dexterity: { en: "Dexterity", ru: "Ловкость", pl: "Zręczność" },
  constitution: { en: "Constitution", ru: "Телосложение", pl: "Kondycja" },
  intelligence: { en: "Intelligence", ru: "Интеллект", pl: "Inteligencja" },
  wisdom: { en: "Wisdom", ru: "Мудрость", pl: "Mądrość" },
  charisma: { en: "Charisma", ru: "Харизма", pl: "Charyzma" },
};

export function characterDisplay(value: string, locale: Locale): string {
  const key = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  return Object.hasOwn(TERMS, key) ? TERMS[key][locale] : value;
}
