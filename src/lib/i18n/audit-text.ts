import type { Locale } from "./translations";

const kinds: Record<string, Record<Locale, string>> = {
  apply_damage: { en: "apply_damage", ru: "урон" },
  heal: { en: "heal", ru: "лечение" },
  award_xp: { en: "award_xp", ru: "опыт" },
  modify_gold: { en: "modify_gold", ru: "золото" },
  grant_item: { en: "grant_item", ru: "выдача предмета" },
  remove_item: { en: "remove_item", ru: "удаление предмета" },
  set_condition: { en: "set_condition", ru: "наложение состояния" },
  clear_condition: { en: "clear_condition", ru: "снятие состояния" },
  use_spell_slot: { en: "use_spell_slot", ru: "ячейка заклинания" },
  use_item: { en: "use_item", ru: "использование предмета" },
  purchase: { en: "purchase", ru: "торговля" },
  use_resource: { en: "use_resource", ru: "расход ресурса" },
  grant_temp_hp: { en: "grant_temp_hp", ru: "временные ОЗ" },
  learn_spell: { en: "learn_spell", ru: "изменение заклинаний" },
  update_sheet: { en: "update_sheet", ru: "изменение листа" },
  undo: { en: "undo", ru: "отмена" },
  lead_edit: { en: "lead_edit", ru: "правка лидера" },
  player_adjust: { en: "player_adjust", ru: "правка игрока" },
};
const fields: Record<string, Record<Locale, string>> = {
  currentHp: { en: "currentHp", ru: "текущие ОЗ" },
  maxHp: { en: "maxHp", ru: "максимальные ОЗ" },
  tempHp: { en: "tempHp", ru: "временные ОЗ" },
  xp: { en: "xp", ru: "опыт" },
  level: { en: "level", ru: "уровень" },
  gold: { en: "gold", ru: "золото" },
  inventory: { en: "inventory", ru: "инвентарь" },
  conditions: { en: "conditions", ru: "состояния" },
  conditionMeta: { en: "conditionMeta", ru: "параметры состояний" },
  spellSlots: { en: "spellSlots", ru: "ячейки заклинаний" },
  spells: { en: "spells", ru: "заклинания" },
  resources: { en: "resources", ru: "ресурсы" },
  hitDice: { en: "hitDice", ru: "кости хитов" },
  deathSaves: { en: "deathSaves", ru: "спасброски от смерти" },
  abilities: { en: "abilities", ru: "характеристики" },
  ac: { en: "ac", ru: "класс доспеха" },
  speed: { en: "speed", ru: "скорость" },
  name: { en: "name", ru: "имя" },
};
const copy = {
  ru: {
    noReason: "причина не указана",
    warning: (kind: string, reason: string, keys: string) => `Более позднее изменение «${kind}» (${reason}) затронуло те же поля: ${keys}.`,
    undone: (detail: string) => `Отменено: ${detail}`,
  },
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
  const reason = match[2] === "no reason" ? copy.ru.noReason : match[2];
  const keys = match[3].split(", ").map(key => label(fields, key, locale)).join(", ");
  return copy.ru.warning(kind, reason, keys);
}

/** Only undo creates this reason automatically; do not alter a player's prose. */
export function displayAuditReason(kind: string, value: string, locale: Locale): string {
  if (kind !== "undo" || locale === "en") return value;
  const match = /^Undid (\w+)(?: \(([\s\S]*)\))?$/.exec(value);
  if (!match) return value;
  const detail = label(kinds, match[1], locale) + (match[2] ? ` (${match[2]})` : "");
  return copy.ru.undone(detail);
}
