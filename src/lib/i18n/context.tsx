"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Default to Russian ('ru') as requested, fallback to English if explicitly set
  const [locale, setLocaleState] = useState<Locale>("ru");
  // Default to Metric ('metric') as requested
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>("metric");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const savedLocale = localStorage.getItem(STORAGE_LOCALE_KEY) as Locale | null;
      if (savedLocale === "ru" || savedLocale === "en") {
        setLocaleState(savedLocale);
      } else {
        // Check browser language or default to Russian
        const browserLang = navigator.language.toLowerCase();
        if (browserLang.startsWith("ru") || browserLang.startsWith("be") || browserLang.startsWith("uk")) {
          setLocaleState("ru");
        } else {
          setLocaleState("ru"); // default to ru as requested by user
        }
      }

      const savedUnits = localStorage.getItem(STORAGE_UNITS_KEY) as UnitSystem | null;
      if (savedUnits === "metric" || savedUnits === "imperial") {
        setUnitSystemState(savedUnits);
      } else {
        setUnitSystemState("metric");
      }
    } catch {
      // LocalStorage unavailable in certain iframe/private contexts
    }
    setMounted(true);
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_LOCALE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {}
  };

  const toggleLocale = () => {
    setLocale(locale === "ru" ? "en" : "ru");
  };

  const setUnitSystem = (newSystem: UnitSystem) => {
    setUnitSystemState(newSystem);
    try {
      localStorage.setItem(STORAGE_UNITS_KEY, newSystem);
    } catch {}
  };

  const toggleUnitSystem = () => {
    setUnitSystem(unitSystem === "metric" ? "imperial" : "metric");
  };

  const t = useMemo(() => {
    return (path: string, params?: Record<string, string | number>): string => {
      const parts = path.split(".");
      let current: unknown = translations[locale];
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          // Fallback to English
          let fallback: unknown = translations.en;
          for (const fbPart of parts) {
            if (fallback && typeof fallback === "object" && fbPart in fallback) {
              fallback = (fallback as Record<string, unknown>)[fbPart];
            } else {
              fallback = undefined;
              break;
            }
          }
          current = fallback;
          break;
        }
      }

      if (typeof current !== "string") {
        return path;
      }

      if (params) {
        let text = current;
        for (const [key, val] of Object.entries(params)) {
          text = text.replaceAll(`{${key}}`, String(val));
        }
        return text;
      }

      return current;
    };
  }, [locale]);

  // Conversion functions
  const formatDistance = (feet: number): string => {
    if (unitSystem === "imperial") {
      return `${feet} ${locale === "ru" ? "фт" : "ft"}`;
    }
    // D&D metric conversion standard: 5 ft = 1.5 m
    const meters = Math.round(feet * 0.3 * 10) / 10;
    return `${meters} ${locale === "ru" ? "м" : "m"}`;
  };

  const formatWeight = (lbs: number): string => {
    if (unitSystem === "imperial") {
      return `${lbs} ${locale === "ru" ? "фнт" : "lb"}`;
    }
    // 1 lb = 0.453592 kg
    const kg = Math.round(lbs * 0.453592 * 10) / 10;
    return `${kg} ${locale === "ru" ? "кг" : "kg"}`;
  };

  const formatSpeed = (feet: number): string => {
    if (unitSystem === "imperial") {
      return `${feet} ${locale === "ru" ? "фт" : "ft"}`;
    }
    const meters = Math.round(feet * 0.3);
    const tiles = Math.round(feet / 5);
    const tileUnit = locale === "ru" ? "кл." : "sq.";
    const meterUnit = locale === "ru" ? "м" : "m";
    return `${meters} ${meterUnit} (${tiles} ${tileUnit})`;
  };

  const formatTile = (tiles: number): string => {
    if (unitSystem === "imperial") {
      return `${tiles * 5} ${locale === "ru" ? "фт" : "ft"}`;
    }
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

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    // Return safe fallback for components rendered outside provider
    const fallbackT = (path: string, params?: Record<string, string | number>): string => {
      const parts = path.split(".");
      let current: unknown = translations.ru;
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return path;
        }
      }
      return typeof current === "string" ? current : path;
    };

    return {
      locale: "ru" as Locale,
      setLocale: () => {},
      toggleLocale: () => {},
      unitSystem: "metric" as UnitSystem,
      setUnitSystem: () => {},
      toggleUnitSystem: () => {},
      t: fallbackT,
      formatDistance: (f: number) => `${Math.round(f * 0.3 * 10) / 10} м`,
      formatWeight: (l: number) => `${Math.round(l * 0.453592 * 10) / 10} кг`,
      formatSpeed: (f: number) => `${Math.round(f * 0.3)} м`,
      formatTile: (tiles: number) => `${tiles * 1.5} м`,
    };
  }
  return context;
}
