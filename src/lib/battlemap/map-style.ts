// How the battle map looks on this device: which style paints it, and whether
// the table is tilted a little toward the viewer. Purely cosmetic: the
// terrain, fog and every rule come from the server projection and are the
// same either way (src/lib/battlemap/view.ts); only how they are painted
// changes, so two players at one table may each pick their own.
//
// Device-local on purpose, like the animation settings (src/lib/fx/prefs.ts):
// a phone wants the light blueprint, a desktop wants the textured stone.
// Each choice is one localStorage key, a change event for this tab and the
// `storage` event for the others, read through useSyncExternalStore.

import { useSyncExternalStore } from "react";

export const MAP_STYLES = ["classic", "flagstone", "relief", "torchlit", "parchment", "blueprint"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const DEFAULT_MAP_STYLE: MapStyle = "relief";

export const MAP_STYLE_KEY = "odm:map-style:v1";
/** Fired on window whenever the style changes in this tab. */
export const MAP_STYLE_EVENT = "odm-map-style";

export const MAP_TILT_KEY = "odm:map-tilt:v1";
/** Fired on window whenever the tilt changes in this tab. */
export const MAP_TILT_EVENT = "odm-map-tilt";

export function sanitizeMapStyle(value: unknown): MapStyle {
  return typeof value === "string" && (MAP_STYLES as readonly string[]).includes(value)
    ? (value as MapStyle)
    : DEFAULT_MAP_STYLE;
}

export function sanitizeMapTilt(value: unknown): boolean {
  return value === "1" || value === true;
}

// One stored, validated, announced value.
function deviceChoice<T>(spec: {
  key: string;
  event: string;
  fallback: T;
  parse: (raw: unknown) => T;
  format: (value: T) => string;
}) {
  // Used when storage throws (private mode, blocked site data): the choice
  // still lives for this page.
  let memory: T | null = null;

  function read(): T {
    if (typeof window === "undefined") {
      return spec.fallback;
    }
    try {
      const raw = window.localStorage.getItem(spec.key);
      if (raw !== null) {
        return spec.parse(raw);
      }
    } catch {
      return memory ?? spec.fallback;
    }
    return memory ?? spec.fallback;
  }

  function write(value: T): void {
    if (typeof window === "undefined") {
      return;
    }
    memory = spec.parse(spec.format(value));
    try {
      window.localStorage.setItem(spec.key, spec.format(memory));
    } catch {
      // Kept in memory; this tab still hears about it through the event.
    }
    window.dispatchEvent(new Event(spec.event));
  }

  function subscribe(callback: () => void): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === spec.key) {
        callback();
      }
    };
    window.addEventListener(spec.event, callback);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(spec.event, callback);
      window.removeEventListener("storage", onStorage);
    };
  }

  function use(): [T, (value: T) => void] {
    return [useSyncExternalStore(subscribe, read, () => spec.fallback), write];
  }

  return { read, write, use };
}

const styleChoice = deviceChoice<MapStyle>({
  key: MAP_STYLE_KEY,
  event: MAP_STYLE_EVENT,
  fallback: DEFAULT_MAP_STYLE,
  parse: sanitizeMapStyle,
  format: (style) => style,
});

const tiltChoice = deviceChoice<boolean>({
  key: MAP_TILT_KEY,
  event: MAP_TILT_EVENT,
  fallback: false,
  parse: sanitizeMapTilt,
  format: (tilt) => (tilt ? "1" : "0"),
});

export const readMapStyle = styleChoice.read;
export const writeMapStyle = styleChoice.write;
export const readMapTilt = tiltChoice.read;
export const writeMapTilt = tiltChoice.write;

export function useMapStyle(): [MapStyle, (style: MapStyle) => void] {
  return styleChoice.use();
}

export function useMapTilt(): [boolean, (tilt: boolean) => void] {
  return tiltChoice.use();
}

// The tilt is a CSS perspective on the whole board, about the bottom edge so
// the near side stays put and the far side recedes a little. It never leaves
// the board's own box, and the browser maps clicks through it, so tiles are
// still hit where they are drawn.
//
// Everything is measured in the board's own width (its host is a container),
// so a small board and a full-screen one lean by the same amount. Leaning
// about the bottom leaves an empty band above the far edge; the board's
// window takes it back with a negative top margin of `mapTiltBand`, so it
// does not sit under a gap.
const TILT = { degrees: 14, perspective: 1.5 } as const;

// Wrap the board's window in this so `cqw` means the board's width.
export const MAP_TILT_HOST_STYLE = { containerType: "inline-size" } as const;

// `aspect` is the window's height over its width.
export function mapTiltStyle() {
  return {
    transform: `perspective(${TILT.perspective * 100}cqw) rotateX(${TILT.degrees}deg)`,
    transformOrigin: "50% 100%",
  } as const;
}

// The empty band above the far edge, in cqw, for a window of this aspect.
export function mapTiltBand(aspect: number): number {
  const radians = (TILT.degrees * Math.PI) / 180;
  // Where the far edge lands, as a share of the window's height.
  const far = Math.cos(radians) / (1 + (Math.sin(radians) * aspect) / TILT.perspective);
  return (1 - far) * aspect * 100;
}
