import catalog from "./options-copy.json";
import { findOptionByFeatureName, type OptionDef } from "@/lib/srd/options";
import { optionKindLabel } from "./option-kind";
import type { Locale } from "./translations";

type OptionCopy = { title: string; text: string; requirement?: string };
const entries: Record<string, Record<Locale, OptionCopy>> = catalog;

export function optionCopy(option: OptionDef, locale: Locale): OptionCopy {
  return entries[`${option.k}.${option.n.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`][locale];
}

export function optionFeatureCopy(name: string, locale: Locale): OptionCopy | null {
  const option = findOptionByFeatureName(name);
  if (!option) return null;
  const copy = optionCopy(option, locale);
  return { ...copy, title: `${optionKindLabel(option.k, locale)}: ${copy.title}` };
}
