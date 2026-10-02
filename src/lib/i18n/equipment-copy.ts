import data from "./equipment-copy.json";
import type { Locale } from "./translations";

type EquipmentCopy = { title: string; text?: string };
const catalog: Record<string, Record<Locale, EquipmentCopy>> = data;
const key = (name: string) => name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function equipmentCopy(name: string, locale: Locale): EquipmentCopy | null {
  const direct = catalog[key(name)]?.[locale];
  if (direct) return direct;
  const bonus = /\s*\+([1-3])$/.exec(name);
  if (bonus) {
    const base = equipmentCopy(name.slice(0, bonus.index), locale);
    if (base) return { ...base, title: `${base.title} +${bonus[1]}` };
  }
  return null;
}
