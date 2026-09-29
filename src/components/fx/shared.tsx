"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
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
  const letters = Array.from(text);
  return (
    <span
      className={`fx-letters ${variant === "drop" ? "fx-letters--drop" : variant === "slam" ? "fx-letters--slam" : ""} ${className}`}
      aria-label={text}
      style={{ "--d": `${delayMs}ms` } as CSSProperties}
    >
      {letters.map((ch, i) => (
        <span key={i} aria-hidden="true" style={{ "--i": i } as CSSProperties}>
          {ch}
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
  const fx = useRef<FxCanvas | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas) return;
    const instance = new FxCanvas(canvas);
    fx.current = instance;
    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      instance.dispose();
      fx.current = null;
    };
  }, [ref, active]);
  return fx;
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

/** Runs `steps` in order, each after its delay; cancelled on unmount. */
export function useTimeline(active: boolean, steps: [number, () => void][], deps: unknown[] = []) {
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    if (!active) return;
    const timers = stepsRef.current.map(([ms, fn]) => window.setTimeout(fn, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}

/** Escape (and optionally a click) closes an overlay. */
export function useDismissKeys(active: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/** Mounts children, then keeps them for a short fade-out after `open` drops. */
export function usePresence(open: boolean, exitMs = 320): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, exitMs);
    return () => window.clearTimeout(t);
  }, [open, mounted, exitMs]);
  return { mounted, leaving };
}
