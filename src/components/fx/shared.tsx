"use client";

import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { FxCanvas } from "@/lib/fx/particles";
import { FX_PREFS_EVENT, fxMuted, setFxMuted } from "@/lib/fx/sound";
import "./fx.css";

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
    <Tag className={`fx-title fx-shine ${tone === "gold" ? "" : `fx-title--${tone}`} ${className}`} data-text={text}>
      <FxLetters text={text} variant={variant} delayMs={delayMs} />
    </Tag>
  );
}

/** A full-screen particle canvas bound to the component's lifetime. */
export function useFxCanvas(ref: RefObject<HTMLCanvasElement | null>, active = true): RefObject<FxCanvas | null> {
  const particlesRef = useRef<FxCanvas | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas) return;
    const instance = new FxCanvas(canvas);
    particlesRef.current = instance;
    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      instance.dispose();
      particlesRef.current = null;
    };
  }, [ref, active]);
  return particlesRef;
}

function subscribeReducedMotion(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false),
    () => false,
  );
}

function subscribeFxPrefs(cb: () => void) {
  window.addEventListener(FX_PREFS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FX_PREFS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Shared mute switch for every cinematic sound effect. */
export function useFxMuted(): [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(subscribeFxPrefs, fxMuted, () => false);
  return [muted, setFxMuted];
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
