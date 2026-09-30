// Which look the battle map wears on this device. Purely cosmetic: the
// terrain, fog and every rule come from the server projection and are the
// same in each style (src/lib/battlemap/view.ts); only how they are painted
// changes, so two players at one table may each pick their own.
//
// Device-local on purpose, like the animation settings (src/lib/fx/prefs.ts):
// a phone wants the light blueprint, a desktop wants the textured stone.
// One localStorage key, a change event for this tab and the `storage` event
// for the others, read through useSyncExternalStore.

import { useSyncExternalStore } from "react";

export const MAP_STYLES = ["classic", "flagstone", "torchlit", "parchment", "blueprint"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const DEFAULT_MAP_STYLE: MapStyle = "flagstone";

export const MAP_STYLE_KEY = "odm:map-style:v1";
/** Fired on window whenever the style changes in this tab. */
export const MAP_STYLE_EVENT = "odm-map-style";

export function sanitizeMapStyle(value: unknown): MapStyle {
  return typeof value === "string" && (MAP_STYLES as readonly string[]).includes(value)
    ? (value as MapStyle)
    : DEFAULT_MAP_STYLE;
}

// Used when storage throws (private mode, blocked site data): the choice
// still lives for this page.
let memory: MapStyle | null = null;

export function readMapStyle(): MapStyle {
  if (typeof window === "undefined") {
    return DEFAULT_MAP_STYLE;
  }
  try {
    const raw = window.localStorage.getItem(MAP_STYLE_KEY);
    if (raw !== null) {
      return sanitizeMapStyle(raw);
    }
  } catch {
    return memory ?? DEFAULT_MAP_STYLE;
  }
  return memory ?? DEFAULT_MAP_STYLE;
}

export function writeMapStyle(style: MapStyle): void {
  if (typeof window === "undefined") {
    return;
  }
  memory = sanitizeMapStyle(style);
  try {
    window.localStorage.setItem(MAP_STYLE_KEY, memory);
  } catch {
    // Kept in memory; this tab still hears about it through the event.
  }
  window.dispatchEvent(new Event(MAP_STYLE_EVENT));
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === MAP_STYLE_KEY) {
      callback();
    }
  };
  window.addEventListener(MAP_STYLE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MAP_STYLE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMapStyle(): [MapStyle, (style: MapStyle) => void] {
  const style = useSyncExternalStore(subscribe, readMapStyle, () => DEFAULT_MAP_STYLE);
  return [style, writeMapStyle];
}
