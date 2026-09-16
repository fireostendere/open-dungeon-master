"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  isLocale,
  nextLocale,
  translations,
  type Locale,
  type UnitSystem,
} from "./translations";

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
    // The cookie still lets server-rendered UI inherit the selected language.
  }
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
    result = result.replaceAll(`{${key}}`, () => String(value));
  }
  return result;
}

function unit(locale: Locale, name: "meters" | "feet" | "kilograms" | "pounds" | "tiles") {
  return lookup(locale, `units.${name}`) ?? lookup("en", `units.${name}`) ?? name;
}

export function I18nProvider({
  children,
  initialLocale = "ru",
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // The server supplies the cookie-backed UI locale so SSR and hydration
  // render the same language. This is a personal display preference only;
  // campaign narrationLanguage is changed by its own authorized setting.
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>("metric");

  useEffect(() => {
    let next: Locale = initialLocale;
    let nextUnits: UnitSystem = "metric";
    try {
      const savedLocale = localStorage.getItem(STORAGE_LOCALE_KEY);
      if (isLocale(savedLocale)) next = savedLocale;

      const savedUnits = localStorage.getItem(STORAGE_UNITS_KEY);
      if (savedUnits === "metric" || savedUnits === "imperial") nextUnits = savedUnits;
    } catch {
      // Storage can be unavailable in private/embedded contexts; server locale stays usable.
    }

    const applyStoredPreferences = window.setTimeout(() => {
      setLocaleState(next);
      setUnitSystemState(nextUnits);
    }, 0);
    persistLocale(next);
    return () => window.clearTimeout(applyStoredPreferences);
  }, [initialLocale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
  };

  // The original two-language switch was a toggle. Keep the same API for all
  // callers, but cycle through the complete supported locale list.
  const toggleLocale = () => setLocale(nextLocale(locale));

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
        // English is the canonical fallback. A missing localized string must
        // never expose a raw key to players.
        const source = lookup(locale, path) ?? lookup("en", path);
        return source ? interpolate(source, params) : path;
      },
    [locale],
  );

  const formatDistance = (feet: number): string => {
    if (unitSystem === "imperial") return `${feet} ${unit(locale, "feet")}`;
    const meters = Math.round(feet * 0.3 * 10) / 10;
    return `${meters} ${unit(locale, "meters")}`;
  };

  const formatWeight = (lbs: number): string => {
    if (unitSystem === "imperial") return `${lbs} ${unit(locale, "pounds")}`;
    const kg = Math.round(lbs * 0.453592 * 10) / 10;
    return `${kg} ${unit(locale, "kilograms")}`;
  };

  const formatSpeed = (feet: number): string => {
    if (unitSystem === "imperial") return `${feet} ${unit(locale, "feet")}`;
    const meters = Math.round(feet * 0.3);
    const tiles = Math.round(feet / 5);
    return `${meters} ${unit(locale, "meters")} (${tiles} ${unit(locale, "tiles")})`;
  };

  const formatTile = (tiles: number): string => {
    if (unitSystem === "imperial") return `${tiles * 5} ${unit(locale, "feet")}`;
    return `${tiles * 1.5} ${unit(locale, "meters")}`;
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
