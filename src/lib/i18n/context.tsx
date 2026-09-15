"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { translations, type Locale, type UnitSystem } from "./translations";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  unitSystem: UnitSystem;
  setUnitSystem: (system: UnitSystem) => void;
  toggleUnitSystem: () => void;
  t: (path: string, params?: Record<string, string | number>) => string;
  formatDistance: (feet: number) => string;
  formatWeight: (lbs: number) => string;
  formatSpeed: (feet: number) => string;
  formatTile: (tiles: number) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_LOCALE_KEY = "odm_locale";
const STORAGE_UNITS_KEY = "odm_unit_system";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function persistLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.cookie = `${STORAGE_LOCALE_KEY}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
  try {
    localStorage.setItem(STORAGE_LOCALE_KEY, locale);
  } catch {
    // The cookie still lets server routes inherit the selected language.
  }
}

function persistCampaignLanguage(locale: Locale) {
  const match = window.location.pathname.match(/^\/campaigns\/([^/?#]+)/);
  if (!match) return;
  void fetch(`/api/campaigns/${encodeURIComponent(match[1])}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: locale }),
  }).catch(() => undefined);
}

function lookup(locale: Locale, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = translations[locale];
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  let result = text;
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Russian remains the product default. A saved English selection is restored on mount.
  const [locale, setLocaleState] = useState<Locale>("ru");
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>("metric");

  useEffect(() => {
    let nextLocale: Locale = "ru";
    let nextUnits: UnitSystem = "metric";
    try {
      const savedLocale = localStorage.getItem(STORAGE_LOCALE_KEY);
      if (savedLocale === "ru" || savedLocale === "en") nextLocale = savedLocale;

      const savedUnits = localStorage.getItem(STORAGE_UNITS_KEY);
      if (savedUnits === "metric" || savedUnits === "imperial") nextUnits = savedUnits;
    } catch {
      // Storage can be unavailable in private/embedded contexts; defaults remain usable.
    }

    setLocaleState(nextLocale);
    setUnitSystemState(nextUnits);
    persistLocale(nextLocale);
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
    persistCampaignLanguage(newLocale);
  };

  const toggleLocale = () => setLocale(locale === "ru" ? "en" : "ru");

  const setUnitSystem = (newSystem: UnitSystem) => {
    setUnitSystemState(newSystem);
    try {
      localStorage.setItem(STORAGE_UNITS_KEY, newSystem);
    } catch {
      // The in-memory selection still works when storage is unavailable.
    }
  };

  const toggleUnitSystem = () => setUnitSystem(unitSystem === "metric" ? "imperial" : "metric");

  const t = useMemo(
    () =>
      (path: string, params?: Record<string, string | number>): string => {
        // English is the canonical fallback. Missing Russian copy must never make the
        // English UI display a key or Cyrillic text.
        const source = lookup(locale, path) ?? lookup("en", path);
        return source ? interpolate(source, params) : path;
      },
    [locale],
  );

  const formatDistance = (feet: number): string => {
    if (unitSystem === "imperial") return `${feet} ${locale === "ru" ? "фт" : "ft"}`;
    const meters = Math.round(feet * 0.3 * 10) / 10;
    return `${meters} ${locale === "ru" ? "м" : "m"}`;
  };

  const formatWeight = (lbs: number): string => {
    if (unitSystem === "imperial") return `${lbs} ${locale === "ru" ? "фнт" : "lb"}`;
    const kg = Math.round(lbs * 0.453592 * 10) / 10;
    return `${kg} ${locale === "ru" ? "кг" : "kg"}`;
  };

  const formatSpeed = (feet: number): string => {
    if (unitSystem === "imperial") return `${feet} ${locale === "ru" ? "фт" : "ft"}`;
    const meters = Math.round(feet * 0.3);
    const tiles = Math.round(feet / 5);
    return `${meters} ${locale === "ru" ? "м" : "m"} (${tiles} ${locale === "ru" ? "кл." : "sq."})`;
  };

  const formatTile = (tiles: number): string => {
    if (unitSystem === "imperial") return `${tiles * 5} ${locale === "ru" ? "фт" : "ft"}`;
    return `${tiles * 1.5} ${locale === "ru" ? "м" : "m"}`;
  };

  const value: I18nContextType = {
    locale,
    setLocale,
    toggleLocale,
    unitSystem,
    setUnitSystem,
    toggleUnitSystem,
    t,
    formatDistance,
    formatWeight,
    formatSpeed,
    formatTile,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (context) return context;

  // Components rendered outside the provider get a deterministic English fallback.
  // This makes English the safe baseline even in tests, error boundaries and isolated UI.
  const fallbackT = (path: string, params?: Record<string, string | number>): string => {
    const source = lookup("en", path);
    return source ? interpolate(source, params) : path;
  };

  return {
    locale: "en" as Locale,
    setLocale: () => {},
    toggleLocale: () => {},
    unitSystem: "metric" as UnitSystem,
    setUnitSystem: () => {},
    toggleUnitSystem: () => {},
    t: fallbackT,
    formatDistance: (feet: number) => `${Math.round(feet * 0.3 * 10) / 10} m`,
    formatWeight: (lbs: number) => `${Math.round(lbs * 0.453592 * 10) / 10} kg`,
    formatSpeed: (feet: number) => `${Math.round(feet * 0.3)} m`,
    formatTile: (tiles: number) => `${tiles * 1.5} m`,
  };
}
