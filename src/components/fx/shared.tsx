"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { FxCanvas } from "@/lib/fx/particles";
import { useFxPrefs, useFxSettings } from "@/lib/fx/prefs";
import "./fx.css";

export { useFxPrefs, useFxSettings };

/** Splits a title into per-letter spans so CSS can stagger them. */
export function FxLetters({
  text,
  variant = "rise",
  delayMs = 0,
  className = "",
}: {
  text: string;
  variant?: "rise" | "drop" | "slam";
  delayMs?: number;
  className?: string;
}) {
  // Letters animate one by one, but words stay whole when the title wraps.
  const words = text.split(" ");
  let index = 0;
  return (
    <span
      className={`fx-letters ${variant === "drop" ? "fx-letters--drop" : variant === "slam" ? "fx-letters--slam" : ""} ${className}`}
      aria-label={text}
      style={{ "--d": `${delayMs}ms` } as CSSProperties}
    >
      {words.map((word, wi) => (
        <span key={wi} className="fx-word" aria-hidden="true">
          {Array.from(word).map((ch, ci) => (
            <span key={ci} style={{ "--i": index++ } as CSSProperties}>
              {ch}
            </span>
          ))}
          {wi < words.length - 1 ? <span style={{ "--i": index++ } as CSSProperties}>{" "}</span> : null}
        </span>
      ))}
    </span>
  );
}

/** Metallic title with staggered letters and a sweeping shine. */
export function FxTitle({
  text,
  tone = "gold",
  variant = "rise",
  delayMs = 0,
  className = "",
  as: Tag = "h2",
}: {
  text: string;
  tone?: "gold" | "crimson" | "emerald" | "steel" | "frost";
  variant?: "rise" | "drop" | "slam";
  delayMs?: number;
  className?: string;
  as?: "h1" | "h2" | "h3" | "div";
}) {
  return (
    <Tag className={`fx-title fx-title--letters fx-shine ${tone === "gold" ? "" : `fx-title--${tone}`} ${className}`} data-text={text}>
      <FxLetters text={text} variant={variant} delayMs={delayMs} />
    </Tag>
  );
}

/**
 * A full-screen particle canvas bound to the component's lifetime. Null while
 * the player has particles switched off; Lite quality gets a small budget and
 * a 1x canvas.
 */
export function useFxCanvas(ref: RefObject<HTMLCanvasElement | null>, active = true): RefObject<FxCanvas | null> {
  const particlesRef = useRef<FxCanvas | null>(null);
  const { particles, lite } = useFxSettings();
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas || !particles) return;
    const instance = new FxCanvas(canvas, lite ? { maxParticles: 300, density: 0.35, maxDpr: 1 } : {});
    particlesRef.current = instance;
    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      instance.dispose();
      particlesRef.current = null;
    };
  }, [ref, active, particles, lite]);
  return particlesRef;
}

/** Reduced motion: the player's choice, or the system's when set to Auto. */
export function useReducedMotion(): boolean {
  return useFxSettings().reducedMotion;
}

/** Shared mute switch for every cinematic sound effect. */
export function useFxMuted(): [boolean, (muted: boolean) => void] {
  const [prefs, setPrefs] = useFxPrefs();
  return [!prefs.sound, (muted: boolean) => setPrefs({ sound: !muted })];
}

/**
 * How long a moment stays up: its full hold, or a shorter one in Lite.
 * Reduced motion keeps the full hold: calm is not the same as brief.
 */
export function useFxHold(full: number, lite: number): number {
  return useFxSettings().lite ? lite : full;
}

/**
 * On a phone a non-essential moment must not trap the table: it lets taps
 * through to the page and any tap (which still reaches whatever is under
 * the finger) ends it early.
 */
export function useTapThrough(active: boolean, onDone: () => void): boolean {
  const { compact } = useFxSettings();
  const cb = useRef(onDone);
  useEffect(() => {
    cb.current = onDone;
  });
  useEffect(() => {
    if (!active || !compact) return;
    // Arm on the next frame so the tap that caused the moment does not end it.
    let armed = false;
    const raf = requestAnimationFrame(() => {
      armed = true;
    });
    const onTap = () => {
      if (armed) cb.current();
    };
    window.addEventListener("pointerdown", onTap, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onTap, true);
    };
  }, [active, compact]);
  return compact;
}

/** Escape (and optionally a click) closes an overlay. */
export function useDismissKeys(active: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);
  useEffect(() => {
    cb.current = onDismiss;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
