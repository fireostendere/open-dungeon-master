"use client";

import { useI18n } from "./context";
import { uiCopy, type UiTextKey } from "./inline-copy";

export function useInlineText() {
  const { locale } = useI18n();
  return (key: UiTextKey, params?: Record<string, string | number>) => uiCopy(locale, key, params);
}
