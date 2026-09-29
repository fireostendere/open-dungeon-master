"use client";

// Character moments: level up, falling at 0 HP, loot, rest.

import { useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";
import { Bursts, FIREWORK_COLORS } from "@/lib/fx/particles";
import * as sfx from "@/lib/fx/sound";
import { FxTitle, useDismissKeys, useFxCanvas, useReducedMotion } from "../shared";

function useDoneRef(onDone: () => void) {
  const ref = useRef(onDone);
  useEffect(() => {
    ref.current = onDone;
  });
  return ref;
}

function RuneCircle() {
  const glyphs = Array.from({ length: 24 }, (_, i) => i);
  return (
    <svg className="fx-runes" viewBox="0 0 200 200" aria-hidden="true">
      <g className="fx-runes__outer" fill="none" stroke="#f3d27a" strokeOpacity="0.75">
        <circle cx="100" cy="100" r="96" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="88" strokeWidth="0.6" strokeDasharray="2 3" />
        {glyphs.map((i) => (
          <path key={i} d="M100 8 l-2 5 h4 z M99 14 v3" transform={`rotate(${i * 15} 100 100)`} strokeWidth="0.9" />
        ))}
      </g>
      <g className="fx-runes__inner" fill="none" stroke="#fff1c4" strokeOpacity="0.6">
        <circle cx="100" cy="100" r="62" strokeWidth="0.9" />
        <path d="M100 38 L154 131 L46 131 Z M100 162 L46 69 L154 69 Z" strokeWidth="0.8" />
      </g>
    </svg>
  );
}

/** Golden pillar, rune circle, the old level shatters into the new one. */
export function LevelUpCinematic({
  active,
  name,
  className,
  fromLevel,
  toLevel,
  onContinue,
}: {
  active: boolean;
  name: string;
  className?: string;
  fromLevel: number;
  toLevel: number;
  onContinue: () => void;
}) {
  const { locale } = useI18n();
  const copy = locale === "ru" ? { title: "Новый уровень", cta: "Выбрать улучшения" } : { title: "Level up", cta: "Choose improvements" };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  const done = useDoneRef(onContinue);
  useDismissKeys(active, () => done.current());

  useEffect(() => {
    if (!active) return;
    sfx.sfxChoir();
    const f = particlesRef.current;
    const stops: (() => void)[] = [];
    const timers: number[] = [];
    if (f && !reduced) {
      f.flash("#fff1c4", 0.4, 0.9, f.width / 2, 0);
      stops.push(
        f.emit((dt, c) => {
          // Motes spiral up the pillar.
          if (Math.random() < dt * 40) {
            const x = c.width / 2 + (Math.random() - 0.5) * Math.min(300, c.width * 0.4);
            c.burst(x, c.height * 0.85, { count: 1, kind: "glow", colors: [...FIREWORK_COLORS.gold], speed: [60, 160], angle: -Math.PI / 2, spread: 0.4, life: [1.4, 2.4], size: [1.2, 2.6], gravity: -20, drag: 0.4 });
          }
        }),
      );
      timers.push(
        window.setTimeout(() => {
          const cx = f.width / 2;
          const cy = f.height * 0.46;
          Bursts.sparks(f, cx, cy, FIREWORK_COLORS.gold, 140, 1.4);
          f.ring(cx, cy, "#ffe7a3", Math.min(f.width, f.height) * 0.45, 1, 8);
          sfx.sfxImpact(false);
        }, 1500),
      );
    }
    return () => {
      stops.forEach((s) => s());
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [active, particlesRef, reduced]);

  if (!active) return null;
  return (
    <div className="fx-layer fx-interactive" style={{ zIndex: 72 }} role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="fx-backdrop" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(90, 60, 10, 0.35), rgba(6, 4, 16, 0.9) 70%)" }} />
      <div className="fx-pillar" />
      <RuneCircle />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center">
        <p className="fx-sub" style={{ animation: "fx-fade-in 600ms ease-out 0.4s both" }}>
          {name}
          {className ? ` · ${className}` : ""}
        </p>
        <div className="fx-level">
          <span className="fx-level__old">{fromLevel}</span>
          <span className="fx-level__arrow">➜</span>
          <span className="fx-title fx-level__new" data-text={String(toLevel)}>
            {toLevel}
          </span>
        </div>
        <FxTitle text={copy.title} tone="gold" variant="rise" delayMs={1700} className="fx-midtitle" />
        <div className="fx-actions" style={{ animationDelay: "2.3s", marginTop: 10 }}>
          <button type="button" className="fx-button fx-button--big" onClick={() => done.current()}>
            {copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Heartbeat, drained colour, death-save sockets. `dead` for the final one. */
export function FallenCinematic({
  active,
  name,
  mine,
  dead = false,
  successes = 0,
  failures = 0,
  onDone,
}: {
  active: boolean;
  name: string;
  mine: boolean;
  dead?: boolean;
  successes?: number;
  failures?: number;
  onDone: () => void;
}) {
  const { locale } = useI18n();
  const copy =
    locale === "ru"
      ? { fallen: mine ? "Вы пали" : `${name} пал`, dead: mine ? "Вы погибли" : `${name} погиб`, sub: "0 ХП · спасброски от смерти", deadSub: "Три провала. Покойся с миром.", ok: "Успехи", bad: "Провалы" }
      : { fallen: mine ? "You have fallen" : `${name} falls`, dead: mine ? "You died" : `${name} died`, sub: "0 HP · death saving throws", deadSub: "Three failures. Rest in peace.", ok: "Successes", bad: "Failures" };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  const done = useDoneRef(onDone);

  useEffect(() => {
    if (!active) return;
    sfx.sfxHeartbeat(0, 0.8);
    sfx.sfxHeartbeat(1.2, 0.5);
    if (dead) sfx.sfxDoom();
    const f = particlesRef.current;
    if (f && !reduced) {
      window.setTimeout(() => {
        f.burst(f.width / 2, f.height * 0.5, { count: 40, kind: "ash", colors: ["#6b6580", "#3a3440", "#8a2a34"], speed: [30, 120], angle: -Math.PI / 2, spread: 2.4, life: [2, 3.5], size: [2, 5], gravity: 20, drag: 0.8, jitter: 300 });
      }, 700);
    }
    const t = window.setTimeout(() => done.current(), reduced ? 2000 : dead ? 5200 : 4200);
    return () => window.clearTimeout(t);
  }, [active, dead, particlesRef, reduced, done]);

  if (!active) return null;
  return (
    <div className="fx-layer fx-interactive" style={{ zIndex: 72, cursor: "pointer" }} onClick={() => done.current()} aria-live="assertive">
      <div className="fx-desaturate" />
      <div className="fx-vignette fx-vignette--blood" />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center">
        <FxTitle text={dead ? copy.dead : copy.fallen} tone={dead ? "steel" : "crimson"} variant="drop" delayMs={300} className="fx-midtitle" />
        <p className="fx-sub" style={{ animation: "fx-fade-in 600ms ease-out 1.1s both", color: "#f5b5b5" }}>
          {dead ? copy.deadSub : copy.sub}
        </p>
        {dead ? null : (
          <div className="fx-saves">
            {[
              { label: copy.ok, n: successes, cls: "fx-save--ok" },
              { label: copy.bad, n: failures, cls: "fx-save--bad" },
            ].map((row) => (
              <div key={row.label} className="fx-saves__row">
                {row.label}
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`fx-save ${i < row.n ? row.cls : ""}`} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const RARITY: Record<string, { color: string; glow: string; ru: string; en: string }> = {
  common: { color: "#c9c3d6", glow: "rgba(200, 195, 214, 0.35)", ru: "Обычный", en: "Common" },
  uncommon: { color: "#6ee7b7", glow: "rgba(80, 230, 160, 0.45)", ru: "Необычный", en: "Uncommon" },
  rare: { color: "#7dd3fc", glow: "rgba(90, 190, 255, 0.5)", ru: "Редкий", en: "Rare" },
  "very rare": { color: "#c084fc", glow: "rgba(190, 120, 255, 0.55)", ru: "Очень редкий", en: "Very rare" },
  legendary: { color: "#ffb067", glow: "rgba(255, 170, 80, 0.6)", ru: "Легендарный", en: "Legendary" },
  artifact: { color: "#ff7a8a", glow: "rgba(255, 100, 120, 0.6)", ru: "Артефакт", en: "Artifact" },
};

/** A card flips from its ornate back to the item, coins spill out. */
export function LootReveal({
  active,
  item,
  qty = 1,
  rarity = "common",
  icon = "🎁",
  onDone,
}: {
  active: boolean;
  item: string;
  qty?: number;
  rarity?: string;
  icon?: string;
  onDone: () => void;
}) {
  const { locale } = useI18n();
  const r = RARITY[rarity.toLowerCase()] ?? RARITY.common;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  const done = useDoneRef(onDone);
  useDismissKeys(active, () => done.current());

  useEffect(() => {
    if (!active) return;
    sfx.sfxWhoosh(0.5);
    const timers = [
      window.setTimeout(() => {
        sfx.sfxCoins();
        const f = particlesRef.current;
        if (f && !reduced) {
          Bursts.coins(f, f.width / 2, f.height * 0.55, 26);
          Bursts.sparks(f, f.width / 2, f.height * 0.45, [r.color, "#fff4c2"], 60, 1);
        }
      }, 1250),
      window.setTimeout(() => done.current(), reduced ? 2500 : 5200),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, particlesRef, reduced, r.color, done]);

  if (!active) return null;
  return (
    <div className="fx-layer fx-interactive" style={{ zIndex: 72, cursor: "pointer" }} onClick={() => done.current()} role="dialog" aria-label={item}>
      <div className="fx-backdrop" />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center">
        <p className="fx-sub">{locale === "ru" ? "Добыча" : "Loot"}</p>
        <div className="fx-card" style={{ "--rarity": r.color, "--rarity-glow": r.glow } as CSSProperties}>
          <div className="fx-card__inner">
            <div className="fx-card__face fx-card__back">
              <span style={{ fontSize: 54, opacity: 0.7 }}>✦</span>
            </div>
            <div className="fx-card__face fx-card__front">
              {rarity !== "common" ? <div className="fx-card__beams" /> : null}
              <div className="fx-card__icon">{icon}</div>
              <div className="fx-card__name">
                {item}
                {qty > 1 ? ` ×${qty}` : ""}
              </div>
              <div className="fx-card__rarity">{locale === "ru" ? r.ru : r.en}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Long rest: night sky turns to dawn over a campfire. Short rest: the fire. */
export function RestCinematic({ active, kind, onDone }: { active: boolean; kind: "long" | "short"; onDone: () => void }) {
  const { locale } = useI18n();
  const copy =
    locale === "ru"
      ? { long: "Долгий отдых", short: "Короткий отдых", longSub: "Рассвет. Силы и ячейки восстановлены", shortSub: "Перевязали раны у костра" }
      : { long: "Long rest", short: "Short rest", longSub: "Dawn breaks. Strength and slots restored", shortSub: "Wounds bound by the fire" };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const reduced = useReducedMotion();
  const done = useDoneRef(onDone);

  useEffect(() => {
    if (!active) return;
    if (kind === "long") sfx.sfxDawn();
    else sfx.sfxBell();
    const f = particlesRef.current;
    let stop: (() => void) | null = null;
    if (f && !reduced) {
      stop = f.emit((dt, c) => {
        if (Math.random() < dt * 30) Bursts.embersRise(c, c.width / 2, c.height * 0.84, FIREWORK_COLORS.ember, 1, 30);
      });
    }
    const t = window.setTimeout(() => done.current(), reduced ? 2400 : kind === "long" ? 6000 : 3800);
    return () => {
      stop?.();
      window.clearTimeout(t);
    };
  }, [active, kind, particlesRef, reduced, done]);

  if (!active) return null;
  const long = kind === "long";
  return (
    <div className="fx-layer fx-interactive" style={{ zIndex: 72, cursor: "pointer" }} onClick={() => done.current()} aria-live="polite">
      <div className="fx-sky" style={long ? undefined : { animation: "fx-fade-in 800ms ease-out both" }} />
      {long ? <div className="fx-sky__stars" /> : null}
      {long ? <div className="fx-dawn" /> : null}
      {long ? (
        <div className="fx-orbit">
          <div className="fx-moon" />
          <div className="fx-sun" />
        </div>
      ) : null}
      <div className="fx-horizon" />
      <div className="fx-campfire" />
      <canvas ref={canvasRef} className="fx-canvas" />
      <div className="fx-center" style={{ justifyContent: "flex-start", paddingTop: long ? "40vh" : "30vh" }}>
        <FxTitle text={long ? copy.long : copy.short} tone={long ? "gold" : "frost"} variant="rise" delayMs={long ? 2600 : 300} className="fx-midtitle" />
        <p className="fx-sub" style={{ animation: `fx-fade-in 700ms ease-out ${long ? 3.2 : 0.9}s both` }}>
          {long ? copy.longSub : copy.shortSub}
        </p>
      </div>
    </div>
  );
}
