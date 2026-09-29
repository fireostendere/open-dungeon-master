"use client";

// Short, non-blocking moments: "Your turn", "Slain", "Combat won". Each plays
// once and calls onDone; none of them captures clicks.

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { Bursts, FIREWORK_COLORS } from "@/lib/fx/particles";
import * as sfx from "@/lib/fx/sound";
import { FxTitle, useFxCanvas, useReducedMotion } from "../shared";

// Reduced motion keeps the same hold: the calm version still has to be read.
function useAutoDone(active: boolean, ms: number, onDone: () => void) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => done.current(), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
}

/** A gilded ribbon sweeps across: "Your turn", or any short headline. */
export function TurnBanner({
  active,
  title,
  subtitle,
  tone = "gold",
  onDone,
}: {
  active: boolean;
  title?: string;
  subtitle?: string;
  tone?: "gold" | "crimson" | "emerald";
  onDone: () => void;
}) {
  const { locale } = useI18n();
  const text = title ?? (locale === "ru" ? "Ваш ход" : "Your turn");
  useAutoDone(active, 2500, onDone);
  useEffect(() => {
    if (!active) return;
    sfx.sfxWhoosh(0.35);
    const t = window.setTimeout(() => sfx.sfxBell(), 180);
    return () => window.clearTimeout(t);
  }, [active]);
  if (!active) return null;
  return (
    <div className="fx-layer" style={{ zIndex: 72 }} aria-live="polite">
      <div className="fx-ribbon">
        <FxTitle text={text} tone={tone} variant="rise" delayMs={120} />
        {subtitle ? <p className="fx-sub fx-ribbon__sub">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/** A blade streak across the screen and the fallen enemy's name. */
export function SlainBanner({ active, name, onDone }: { active: boolean; name: string; onDone: () => void }) {
  const { locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  useAutoDone(active, 2400, onDone);
  useEffect(() => {
    if (!active) return;
    sfx.sfxSlash();
    const t = window.setTimeout(() => {
      const f = particlesRef.current;
      if (!f || reduced) return;
      // Sparks along the slash line (-14°).
      for (let i = 0; i < 6; i++) {
        const x = f.width * (0.15 + i * 0.14);
        const y = f.height / 2 - (x - f.width / 2) * Math.tan((14 * Math.PI) / 180);
        Bursts.sparks(f, x, y, FIREWORK_COLORS.ember, 14, 0.7);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [active, particlesRef, reduced]);
  if (!active) return null;
  return (
    <div className="fx-layer" style={{ zIndex: 72 }} aria-live="polite">
      <div className="fx-scrim fx-scrim--slain" />
      <div className="fx-slash" />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center fx-slain">
        <p className="fx-sub" style={{ color: "#ffb3a0" }}>{locale === "ru" ? "Повержен" : "Slain"}</p>
        <FxTitle text={name} tone="crimson" variant="slam" className="fx-midtitle" />
      </div>
    </div>
  );
}
