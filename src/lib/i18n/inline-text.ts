"use client";

import { useI18n } from "./context";
import { INLINE_COPY_ALLOWLIST, INLINE_COPY_RU } from "./inline-copy";

export function useInlineText() {
  const { locale } = useI18n();
  return (source: string, params?: Record<string, string | number>) => {
    if (locale !== "ru" || INLINE_COPY_ALLOWLIST.has(source.trim())) return source;
    const leading = source.match(/^\s/) ? " " : "";
    const trailing = source.match(/\s$/) ? " " : "";
    const key = source.trim().replace(/\s+/g, " ");
    let translated = INLINE_COPY_RU[key] ?? source.trim();
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        translated = translated.replaceAll(`{${name}}`, () => String(value));
      }
    }
    return `${leading}${translated}${trailing}`;
  };
}
