import type { Locale } from "./translations";

const kinds: Record<string, Record<Locale, string>> = {
  apply_damage: { en: "apply_damage", ru: "урон", pl: "obrażenia" },
  heal: { en: "heal", ru: "лечение", pl: "leczenie" },
  award_xp: { en: "award_xp", ru: "опыт", pl: "doświadczenie" },
  modify_gold: { en: "modify_gold", ru: "золото", pl: "złoto" },
  grant_item: { en: "grant_item", ru: "выдача предмета", pl: "przyznanie przedmiotu" },
  remove_item: { en: "remove_item", ru: "удаление предмета", pl: "usunięcie przedmiotu" },
  set_condition: { en: "set_condition", ru: "наложение состояния", pl: "nałożenie stanu" },
  clear_condition: { en: "clear_condition", ru: "снятие состояния", pl: "usunięcie stanu" },
  use_spell_slot: { en: "use_spell_slot", ru: "ячейка заклинания", pl: "komórka czaru" },
  use_item: { en: "use_item", ru: "использование предмета", pl: "użycie przedmiotu" },
  purchase: { en: "purchase", ru: "торговля", pl: "handel" },
  use_resource: { en: "use_resource", ru: "расход ресурса", pl: "zużycie zasobu" },
  grant_temp_hp: { en: "grant_temp_hp", ru: "временные ОЗ", pl: "tymczasowe PŻ" },
  learn_spell: { en: "learn_spell", ru: "изменение заклинаний", pl: "zmiana czarów" },
  update_sheet: { en: "update_sheet", ru: "изменение листа", pl: "zmiana karty" },
  undo: { en: "undo", ru: "отмена", pl: "cofnięcie" },
  lead_edit: { en: "lead_edit", ru: "правка лидера", pl: "poprawka lidera" },
  player_adjust: { en: "player_adjust", ru: "правка игрока", pl: "poprawka gracza" },
};
const fields: Record<string, Record<Locale, string>> = {
  currentHp: { en: "currentHp", ru: "текущие ОЗ", pl: "obecne PŻ" },
  maxHp: { en: "maxHp", ru: "максимальные ОЗ", pl: "maksymalne PŻ" },
  tempHp: { en: "tempHp", ru: "временные ОЗ", pl: "tymczasowe PŻ" },
  xp: { en: "xp", ru: "опыт", pl: "doświadczenie" },
  level: { en: "level", ru: "уровень", pl: "poziom" },
  gold: { en: "gold", ru: "золото", pl: "złoto" },
  inventory: { en: "inventory", ru: "инвентарь", pl: "ekwipunek" },
  conditions: { en: "conditions", ru: "состояния", pl: "stany" },
  conditionMeta: { en: "conditionMeta", ru: "параметры состояний", pl: "parametry stanów" },
  spellSlots: { en: "spellSlots", ru: "ячейки заклинаний", pl: "komórki czarów" },
  spells: { en: "spells", ru: "заклинания", pl: "czary" },
  resources: { en: "resources", ru: "ресурсы", pl: "zasoby" },
  hitDice: { en: "hitDice", ru: "кости хитов", pl: "kości wytrzymałości" },
  deathSaves: { en: "deathSaves", ru: "спасброски от смерти", pl: "rzuty obronne przed śmiercią" },
  abilities: { en: "abilities", ru: "характеристики", pl: "cechy" },
  ac: { en: "ac", ru: "класс доспеха", pl: "klasa pancerza" },
  speed: { en: "speed", ru: "скорость", pl: "szybkość" },
  name: { en: "name", ru: "имя", pl: "imię" },
};
function label(catalog: Record<string, Record<Locale, string>>, key: string, locale: Locale): string {
  return catalog[key]?.[locale] ?? key;
}

/** Translate the exact server-generated warning format; authored reasons stay intact. */
export function displayAuditWarning(value: string, locale: Locale): string {
  if (locale === "en") return value;
  const match = /^A newer (\w+) change \(([\s\S]*)\) also touched: ([\w, ]+)\.$/.exec(value);
  if (!match) return value; // Unknown diagnostics are not silently discarded.
  const kind = label(kinds, match[1], locale);
  const reason = match[2] === "no reason" ? (locale === "ru" ? "причина не указана" : "bez podanej przyczyny") : match[2];
  const keys = match[3].split(", ").map(key => label(fields, key, locale)).join(", ");
  return locale === "ru" ? `Более позднее изменение «${kind}» (${reason}) затронуло те же поля: ${keys}.`
    : `Późniejsza zmiana „${kind}” (${reason}) dotyczyła tych samych pól: ${keys}.`;
}

/** Only undo creates this reason automatically; do not alter a player's prose. */
export function displayAuditReason(kind: string, value: string, locale: Locale): string {
  if (kind !== "undo" || locale === "en") return value;
  const match = /^Undid (\w+)(?: \(([\s\S]*)\))?$/.exec(value);
  if (!match) return value;
  const detail = label(kinds, match[1], locale) + (match[2] ? ` (${match[2]})` : "");
  return locale === "ru" ? `Отменено: ${detail}` : `Cofnięto: ${detail}`;
}
