import type { Locale } from "./translations";

const kinds: Record<string, [string, string]> = {
  apply_damage: ["урон", "obrażenia"], heal: ["лечение", "leczenie"], award_xp: ["опыт", "doświadczenie"],
  modify_gold: ["золото", "złoto"], grant_item: ["выдача предмета", "przyznanie przedmiotu"],
  remove_item: ["удаление предмета", "usunięcie przedmiotu"], set_condition: ["наложение состояния", "nałożenie stanu"],
  clear_condition: ["снятие состояния", "usunięcie stanu"], use_spell_slot: ["ячейка заклинания", "komórka czaru"],
  use_item: ["использование предмета", "użycie przedmiotu"], purchase: ["торговля", "handel"],
  use_resource: ["расход ресурса", "zużycie zasobu"], grant_temp_hp: ["временные ОЗ", "tymczasowe PŻ"],
  learn_spell: ["изменение заклинаний", "zmiana czarów"], update_sheet: ["изменение листа", "zmiana karty"],
  undo: ["отмена", "cofnięcie"], lead_edit: ["правка лидера", "poprawka lidera"],
  player_adjust: ["правка игрока", "poprawka gracza"],
};
const fields: Record<string, [string, string]> = {
  currentHp: ["текущие ОЗ", "obecne PŻ"], maxHp: ["максимальные ОЗ", "maksymalne PŻ"],
  tempHp: ["временные ОЗ", "tymczasowe PŻ"], xp: ["опыт", "doświadczenie"], level: ["уровень", "poziom"],
  gold: ["золото", "złoto"], inventory: ["инвентарь", "ekwipunek"], conditions: ["состояния", "stany"],
  conditionMeta: ["параметры состояний", "parametry stanów"], spellSlots: ["ячейки заклинаний", "komórki czarów"],
  spells: ["заклинания", "czary"], resources: ["ресурсы", "zasoby"], hitDice: ["кости хитов", "kości wytrzymałości"],
  deathSaves: ["спасброски от смерти", "rzuty obronne przed śmiercią"], abilities: ["характеристики", "cechy"],
  ac: ["класс доспеха", "klasa pancerza"], speed: ["скорость", "szybkość"], name: ["имя", "imię"],
};
function label(catalog: Record<string, [string, string]>, key: string, locale: Locale): string {
  return locale === "en" ? key : catalog[key]?.[locale === "ru" ? 0 : 1] ?? key;
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
