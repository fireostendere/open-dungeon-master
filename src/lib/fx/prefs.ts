// Per-device animation preferences: what the table's cinematic layer may do
// on this screen. One JSON key in localStorage, a change event for this tab
// and the `storage` event for the others, read through useSyncExternalStore
// so every overlay reacts the moment a switch flips, without a reload.
//
// Device-local on purpose: a phone and a desktop at the same account want
// different things (a phone wants Lite and compact rolls), unlike audio
// volumes, which sync through the profile (src/lib/audio-prefs.ts).

import { useEffect, useSyncExternalStore } from "react";

export const FX_PREFS_KEY = "odm:fx-prefs:v1";
/** Fired on window whenever the preferences change in this tab. */
export const FX_PREFS_EVENT = "odm-fx-prefs";
/** The older sound-only switch; read once as the default for `sound`. */
const LEGACY_MUTE_KEY = "odm:fx-muted";

export type FxQuality = "auto" | "full" | "lite";
export type FxOthersRolls = "auto" | "full" | "compact" | "off";
export type FxMotion = "auto" | "reduce" | "full";

export type FxPrefs = {
  /** 3D dice and the roll overlay. */
  dice: boolean;
  /** Combat start, your turn, slain, victory, fallen, loot, rest, level-up. */
  cinematics: boolean;
  /** Particles, flashes and screen shake. */
  particles: boolean;
  /** Synthesised FX sounds. */
  sound: boolean;
  quality: FxQuality;
  /** How other players' (and enemies') rolls appear. Own rolls are always full. */
  othersRolls: FxOthersRolls;
  /** "auto" follows the operating system. */
  motion: FxMotion;
};

export const FX_PREF_DEFAULTS: FxPrefs = {
  dice: true,
  cinematics: true,
  particles: true,
  sound: true,
  quality: "auto",
  othersRolls: "auto",
  motion: "auto",
};

/** The preferences resolved against this device. */
export type FxSettings = {
  dice: boolean;
  cinematics: boolean;
  particles: boolean;
  sound: boolean;
  /** Lite rendering: no full-screen blur, low DPR, no shadows, small particle budget. */
  lite: boolean;
  reducedMotion: boolean;
  othersRolls: "full" | "compact" | "off";
  /** A phone-sized or touch-first screen. */
  compact: boolean;
};

type FxEnvironment = { compact: boolean; lowEnd: boolean; osReducedMotion: boolean };

const QUALITIES: FxQuality[] = ["auto", "full", "lite"];
const OTHERS: FxOthersRolls[] = ["auto", "full", "compact", "off"];
const MOTIONS: FxMotion[] = ["auto", "reduce", "full"];

// Used when storage throws (private mode, blocked site data): the choice
// still lives for this page.
let memory: FxPrefs | null = null;
let cachedRaw: string | null | undefined;
let cachedPrefs: FxPrefs = FX_PREF_DEFAULTS;

function legacySoundDefault(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_MUTE_KEY) !== "1";
  } catch {
    return true;
  }
}

function sanitize(input: unknown): FxPrefs {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bool = (key: keyof FxPrefs, fallback: boolean) => (typeof src[key] === "boolean" ? (src[key] as boolean) : fallback);
  const pick = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
    typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;
  return {
    dice: bool("dice", FX_PREF_DEFAULTS.dice),
    cinematics: bool("cinematics", FX_PREF_DEFAULTS.cinematics),
    particles: bool("particles", FX_PREF_DEFAULTS.particles),
    sound: bool("sound", FX_PREF_DEFAULTS.sound),
    quality: pick(src.quality, QUALITIES, FX_PREF_DEFAULTS.quality),
    othersRolls: pick(src.othersRolls, OTHERS, FX_PREF_DEFAULTS.othersRolls),
    motion: pick(src.motion, MOTIONS, FX_PREF_DEFAULTS.motion),
  };
}

export function readFxPrefs(): FxPrefs {
  if (typeof window === "undefined") return FX_PREF_DEFAULTS;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FX_PREFS_KEY);
  } catch {
    return memory ?? FX_PREF_DEFAULTS;
  }
  if (raw === cachedRaw) return cachedPrefs;
  cachedRaw = raw;
  if (raw === null) {
    cachedPrefs = memory ?? { ...FX_PREF_DEFAULTS, sound: legacySoundDefault() };
    return cachedPrefs;
  }
  try {
    cachedPrefs = sanitize(JSON.parse(raw));
  } catch {
    cachedPrefs = memory ?? FX_PREF_DEFAULTS;
  }
  return cachedPrefs;
}

export function writeFxPrefs(patch: Partial<FxPrefs>): void {
  if (typeof window === "undefined") return;
  const next = sanitize({ ...readFxPrefs(), ...patch });
  memory = next;
  try {
    window.localStorage.setItem(FX_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Kept in memory; this tab still hears about it through the event.
    cachedRaw = undefined;
  }
  window.dispatchEvent(new Event(FX_PREFS_EVENT));
}

function media(query: string): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function readEnvironment(): FxEnvironment {
  if (typeof window === "undefined") return { compact: false, lowEnd: false, osReducedMotion: false };
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  // A phone in either orientation, or a touch-only screen of any size.
  const narrow = Math.min(w, h) > 0 && (w < 768 || h < 500);
  const touchOnly = media("(pointer: coarse)") && !media("(any-pointer: fine)");
  const nav = window.navigator as Navigator & { deviceMemory?: number };
  const lowEnd =
    (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 4) ||
    (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4);
  return { compact: narrow || touchOnly, lowEnd, osReducedMotion: media("(prefers-reduced-motion: reduce)") };
}

export function resolveFxSettings(prefs: FxPrefs, env: FxEnvironment): FxSettings {
  const lite = prefs.quality === "lite" || (prefs.quality === "auto" && (env.compact || env.lowEnd));
  return {
    dice: prefs.dice,
    cinematics: prefs.cinematics,
    particles: prefs.particles,
    sound: prefs.sound,
    lite,
    reducedMotion: prefs.motion === "reduce" || (prefs.motion === "auto" && env.osReducedMotion),
    othersRolls: prefs.othersRolls === "auto" ? (env.compact ? "compact" : "full") : prefs.othersRolls,
    compact: env.compact,
  };
}

const SERVER_SETTINGS: FxSettings = resolveFxSettings(FX_PREF_DEFAULTS, { compact: false, lowEnd: false, osReducedMotion: false });
let settingsKey = "";
let settingsCache: FxSettings = SERVER_SETTINGS;

/** The resolved settings; the same object until something changes. */
export function readFxSettings(): FxSettings {
  if (typeof window === "undefined") return SERVER_SETTINGS;
  const prefs = readFxPrefs();
  const env = readEnvironment();
  const key = `${JSON.stringify(prefs)}|${env.compact}|${env.lowEnd}|${env.osReducedMotion}`;
  if (key !== settingsKey) {
    settingsKey = key;
    settingsCache = resolveFxSettings(prefs, env);
  }
  return settingsCache;
}

export function subscribeFxPrefs(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === FX_PREFS_KEY || event.key === LEGACY_MUTE_KEY) callback();
  };
  window.addEventListener(FX_PREFS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener("resize", callback);
  window.addEventListener("orientationchange", callback);
  const queries: MediaQueryList[] = [];
  if (typeof window.matchMedia === "function") {
    for (const q of ["(pointer: coarse)", "(any-pointer: fine)", "(prefers-reduced-motion: reduce)"]) {
      try {
        const mq = window.matchMedia(q);
        mq.addEventListener?.("change", callback);
        queries.push(mq);
      } catch {
        // Old engines: the resize listener still catches rotations.
      }
    }
  }
  return () => {
    window.removeEventListener(FX_PREFS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resize", callback);
    window.removeEventListener("orientationchange", callback);
    queries.forEach((mq) => mq.removeEventListener?.("change", callback));
  };
}

/** The stored choices and a setter, for the settings UI. */
export function useFxPrefs(): [FxPrefs, (patch: Partial<FxPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribeFxPrefs, readFxPrefs, () => FX_PREF_DEFAULTS);
  return [prefs, writeFxPrefs];
}

/**
 * What the FX layer may do right now on this device. Also mirrors motion and
 * quality onto <html data-fx-motion data-fx-quality> so fx.css follows the
 * same choice as the scripts.
 */
export function useFxSettings(): FxSettings {
  const settings = useSyncExternalStore(subscribeFxPrefs, readFxSettings, () => SERVER_SETTINGS);
  useEffect(() => {
    applyFxDocumentAttributes(settings);
  }, [settings]);
  return settings;
}

export function applyFxDocumentAttributes(settings: FxSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.fxMotion = settings.reducedMotion ? "reduce" : "full";
  root.dataset.fxQuality = settings.lite ? "lite" : "full";
}
