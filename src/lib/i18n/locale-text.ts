import type { Locale } from "./translations";

export type LocaleText<T = string> = Record<Locale, T>;

// Small local copy that does not belong in the global navigation/session
// catalog can still be exhaustively localized without nested locale ternaries.
// Record<Locale, ...> makes TypeScript require every supported language when
// a new locale is introduced.
export function localeText<T>(locale: Locale, values: LocaleText<T>): T {
  return values[locale];
}
