import catalog from "./help-copy.json";
import type { Locale } from "./translations";

const byEnglish = new Map(Object.values(catalog).map((entry) => [entry.en, entry]));
export function helpText(text: string, locale: Locale): string {
  return byEnglish.get(text)?.[locale] ?? text;
}
