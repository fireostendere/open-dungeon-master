"use client";

// "To arms!": letterbox bars, a crimson edge flash, two swords clash in the
// middle with sparks and a war drum, then the initiative order is dealt out
// like cards. Plays by itself and clears in about three seconds.

import { useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";
import { Bursts, FIREWORK_COLORS } from "@/lib/fx/particles";
import * as sfx from "@/lib/fx/sound";
import { FxTitle, useFxCanvas, useReducedMotion } from "../shared";

export type InitiativeEntry = { id: string; name: string; kind: "pc" | "enemy" | "npc"; initiative?: number };

function Sword({ className }: { className: string }) {
  return (
    <svg className={`fx-sword ${className}`} viewBox="0 0 300 40" aria-hidden="true">
      <defs>
        <linearGradient id="fx-blade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#c9c3d6" />
          <stop offset="1" stopColor="#6b6580" />
        </linearGradient>
        <linearGradient id="fx-hilt" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7a5212" />
          <stop offset="0.5" stopColor="#f3d27a" />
          <stop offset="1" stopColor="#7a5212" />
        </linearGradient>
      </defs>
      <path d="M92 16 L280 16 L298 20 L280 24 L92 24 Z" fill="url(#fx-blade)" />
      <path d="M100 20 L285 20" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
      <rect x="80" y="4" width="10" height="32" rx="3" fill="url(#fx-hilt)" />
      <rect x="30" y="16" width="50" height="8" rx="3" fill="#3b2512" />
      <circle cx="24" cy="20" r="8" fill="url(#fx-hilt)" />
    </svg>
  );
}

export function CombatStart({
  active,
  round = 1,
  order = [],
  onDone,
}: {
  active: boolean;
  round?: number;
  order?: InitiativeEntry[];
  onDone: () => void;
}) {
  const { locale } = useI18n();
  const copy = locale === "ru" ? { title: "К оружию!", sub: "Бой начинается", round: "Раунд {n}", rolling: "Бросок инициативы" } : { title: "To arms!", sub: "Combat begins", round: "Round {n}", rolling: "Roll initiative" };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!active) return;
    sfx.sfxWarDrum(0);
    sfx.sfxWarDrum(0.32);
    const timers = [
      window.setTimeout(() => {
        sfx.sfxSwordClash();
        const f = particlesRef.current;
        if (f && !reduced) {
          Bursts.sparks(f, f.width / 2, f.height * 0.42, FIREWORK_COLORS.ember, 90, 1.3);
          f.flash("#ffd0a0", 0.35, 0.35, f.width / 2, f.height * 0.42);
          f.ring(f.width / 2, f.height * 0.42, "#ffcf9a", 260, 0.6, 5);
        }
      }, 620),
      window.setTimeout(() => sfx.sfxWarDrum(0), 1100),
      // The same hold with reduced motion: the calm version still has to be read.
      window.setTimeout(() => done.current(), 2950),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, particlesRef, reduced]);

  if (!active) return null;
  // Players only get the order; the DM also sees the initiative numbers.
  const hasNumbers = order.some((e) => typeof e.initiative === "number");
  const sorted = (hasNumbers ? [...order].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)) : order).slice(0, 10);
  return (
    <div className="fx-layer" style={{ zIndex: 72 }} aria-live="polite">
      <div className="fx-scrim fx-scrim--combat" />
      <div className="fx-edge-flash" />
      <div className="fx-letterbox fx-letterbox--top" />
      <div className="fx-letterbox fx-letterbox--bottom" />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center fx-combat-center fx-combat-out">
        <div className="fx-swords">
          <Sword className="fx-sword--left" />
          <Sword className="fx-sword--right" />
        </div>
        <FxTitle text={copy.title} tone="crimson" variant="slam" delayMs={560} className="fx-bigtitle" />
        <p className="fx-sub" style={{ animation: "fx-rise-in 500ms var(--fx-ease) 0.8s both" }}>
          {copy.sub} · {sorted.length ? copy.round.replace("{n}", String(round)) : copy.rolling}
        </p>
        {sorted.length ? (
          <div className="fx-initiative">
            {sorted.map((e, i) => (
              <div key={e.id} className={`fx-init-card ${e.kind === "enemy" ? "fx-init-card--enemy" : ""}`} style={{ "--i": i } as CSSProperties}>
                <b>{typeof e.initiative === "number" ? e.initiative : i + 1}</b>
                <span>{e.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
