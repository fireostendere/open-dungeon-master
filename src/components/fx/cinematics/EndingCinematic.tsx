"use client";

// Campaign finale. Victory: a gilded d20 lands on 20 inside a laurel wreath,
// fanfare, fireworks (some burst into d20s), confetti cannons. Defeat: the
// world drains of colour, a heartbeat slows, a cursed d20 lands on 1 and
// cracks, the title splits in two, rain and ash; YOLO tables get the sad
// trombone and the mud.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";
import { Bursts, FIREWORK_COLORS, type FxCanvas } from "@/lib/fx/particles";
import * as sfx from "@/lib/fx/sound";
import { FxTitle, useDismissKeys, useFxCanvas, useFxMuted, useReducedMotion } from "../shared";
import { HeroDie, type HeroThrow } from "./HeroDie";
import {
  DEFEAT_BANNERS_EN,
  DEFEAT_BANNERS_RU,
  endingCopy,
  VICTORY_BANNERS_EN,
  VICTORY_BANNERS_RU,
  YOLO_DEFEAT_BANNERS_EN,
  YOLO_DEFEAT_BANNERS_RU,
  YOLO_VICTORY_BANNERS_EN,
  YOLO_VICTORY_BANNERS_RU,
} from "./ending-copy";

type Mode = "victory" | "defeat";
type Joke = { id: number; text: string; x: number; y: number };

const PATTERNS = ["peony", "ring", "willow", "d20", "crackle", "peony", "d20"] as const;
const PALETTES = [FIREWORK_COLORS.gold, FIREWORK_COLORS.violet, FIREWORK_COLORS.azure, FIREWORK_COLORS.crimson, FIREWORK_COLORS.emerald, FIREWORK_COLORS.ember];

function Laurel({ defeat }: { defeat: boolean }) {
  // Two branches rising from the bottom, pointed leaves in pairs along each,
  // opening at the top where the die sits.
  const leaves: { x: number; y: number; r: number; d: number }[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const a = Math.PI / 2 + side * (0.2 + t * 2.25);
      const x = 120 + Math.cos(a) * 96;
      const y = 120 + Math.sin(a) * 96;
      const tangent = (a * 180) / Math.PI + (side > 0 ? 90 : -90);
      for (const lean of [-38, 38]) {
        leaves.push({ x, y, r: tangent + lean * side + (side > 0 ? 180 : 0), d: 420 + i * 70 + (lean > 0 ? 35 : 0) });
      }
    }
  }
  const stroke = defeat ? "#7a2430" : "url(#fx-laurel)";
  const fill = defeat ? "#4a1a22" : "url(#fx-laurel)";
  const arc = (side: number) => {
    const a0 = Math.PI / 2 + side * 0.12;
    const a1 = Math.PI / 2 + side * 2.5;
    const p = (a: number) => `${120 + Math.cos(a) * 96} ${120 + Math.sin(a) * 96}`;
    return `M ${p(a0)} A 96 96 0 0 ${side > 0 ? 1 : 0} ${p(a1)}`;
  };
  return (
    <svg className="fx-emblem" viewBox="0 0 240 240" style={{ width: "min(380px, 78vw)", position: "absolute", left: "50%", top: "27vh", translate: "-50% -50%" }} aria-hidden="true">
      <defs>
        <linearGradient id="fx-laurel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.55" stopColor="#d4a13a" />
          <stop offset="1" stopColor="#7a5212" />
        </linearGradient>
      </defs>
      <path className="fx-draw" pathLength={1} d={arc(-1)} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      <path className="fx-draw" pathLength={1} d={arc(1)} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      {leaves.map((l, i) => (
        // The group places the leaf; the path pops (a CSS transform would
        // otherwise replace the SVG one).
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.r})`}>
          <path
            className="fx-pop"
            d="M0 0 C 4.5 -5, 4.5 -13, 0 -19 C -4.5 -13, -4.5 -5, 0 0 Z"
            fill={fill}
            stroke={defeat ? "#2a0a10" : "rgba(80, 50, 5, 0.6)"}
            strokeWidth="0.6"
            style={{ "--d": `${l.d}ms` } as CSSProperties}
          />
        </g>
      ))}
    </svg>
  );
}

// A wisecrack pill. It lands around x% of the screen but is shifted as far as
// needed to keep the whole phrase on screen: on a phone a long one would
// otherwise hang off the edge. Measured before paint, so it never jumps.
function FxJoke({ joke, defeat }: { joke: Joke; defeat: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const layer = el?.parentElement;
    if (!el || !layer) return;
    const half = el.offsetWidth / 2;
    const room = 12 + half * 0.06; // the pop-in overshoots to 1.06x
    const center = (joke.x / 100) * layer.clientWidth;
    el.style.left = `${Math.min(Math.max(center, room + half), layer.clientWidth - room - half)}px`;
  }, [joke.x, joke.text]);
  return (
    <div ref={ref} className={`fx-joke ${defeat ? "fx-joke--defeat" : ""}`} style={{ left: `${joke.x}%`, top: `${joke.y}%` }}>
      {joke.text}
    </div>
  );
}

export function EndingCinematic({
  active,
  onClose,
  campaignTitle,
  mode: initialMode = "victory",
  closingMessage,
  onModeChange,
  isYolo = false,
}: {
  active: boolean;
  onClose: () => void;
  campaignTitle?: string;
  mode?: Mode;
  closingMessage?: string | null;
  onModeChange?: (mode: Mode) => void;
  isYolo?: boolean;
}) {
  const { locale } = useI18n();
  const copy = endingCopy(isYolo)[locale] ?? endingCopy(isYolo).en;
  const titles = locale === "ru" ? { victory: "Победа", defeat: "Поражение" } : { victory: "Victory", defeat: "Defeat" };
  const [mode, setMode] = useState<Mode>(initialMode);
  const [showStory, setShowStory] = useState(false);
  const [jokes, setJokes] = useState<Joke[]>([]);
  const [heroKey, setHeroKey] = useState(0);
  const [heroCount, setHeroCount] = useState(1);
  const [muted, setMuted] = useFxMuted();
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useFxCanvas(canvasRef, active);
  const jokeId = useRef(0);

  // A new mode from the parent restarts the scene (state adjusted in render,
  // as React recommends for props that reset state).
  const [prevInitial, setPrevInitial] = useState(initialMode);
  if (prevInitial !== initialMode) {
    setPrevInitial(initialMode);
    setMode(initialMode);
    setHeroCount(1);
    setHeroKey(0);
  }

  useDismissKeys(active && !showStory, onClose);

  const pool =
    mode === "victory"
      ? isYolo ? (locale === "ru" ? YOLO_VICTORY_BANNERS_RU : YOLO_VICTORY_BANNERS_EN) : locale === "ru" ? VICTORY_BANNERS_RU : VICTORY_BANNERS_EN
      : isYolo ? (locale === "ru" ? YOLO_DEFEAT_BANNERS_RU : YOLO_DEFEAT_BANNERS_EN) : locale === "ru" ? DEFEAT_BANNERS_RU : DEFEAT_BANNERS_EN;
  const poolRef = useRef(pool);
  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const addJoke = useCallback(() => {
    const p = poolRef.current;
    const left = Math.random() < 0.5;
    const joke: Joke = {
      id: ++jokeId.current,
      text: p[Math.floor(Math.random() * p.length)],
      x: left ? 14 + Math.random() * 14 : 72 + Math.random() * 14,
      // Above the title block (which starts at 46-50% of the height), so a
      // wisecrack never sits on top of the big word.
      y: 14 + Math.random() * 28,
    };
    setJokes((js) => [...js.slice(-3), joke]);
    window.setTimeout(() => setJokes((js) => js.filter((j) => j.id !== joke.id)), 2700);
  }, []);

  const volley = useCallback((f: FxCanvas | null, count = 3) => {
    if (!f) return;
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        const W = f.width;
        const H = f.height;
        const tx = W * (0.18 + Math.random() * 0.64);
        f.rocket(tx + (Math.random() - 0.5) * 200, tx, H * (0.14 + Math.random() * 0.3), PATTERNS[Math.floor(Math.random() * PATTERNS.length)], PALETTES[Math.floor(Math.random() * PALETTES.length)]);
        sfx.sfxFirework(0);
      }, i * 260);
    }
  }, []);

  // --- the show ---
  useEffect(() => {
    if (!active) return;
    const f = particlesRef.current;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const stops: (() => void)[] = [];
    if (mode === "victory") {
      sfx.sfxBrassFanfare();
      f?.flash("#ffe7a3", 0.5, 0.8);
      if (f && !reducedMotion) {
        at(350, () => {
          Bursts.confettiCannon(f, 0, f.height, -Math.PI / 3, 110);
          Bursts.confettiCannon(f, f.width, f.height, (-2 * Math.PI) / 3, 110);
        });
        at(900, () => volley(f, 3));
        let next = 2600;
        for (let k = 0; k < 40; k++) {
          at(next, () => volley(f, 1 + Math.floor(Math.random() * 2)));
          next += 1100 + Math.random() * 900;
        }
        stops.push(
          f.emit((dt, fxc) => {
            if (Math.random() < dt * 14) Bursts.embersRise(fxc, fxc.width * Math.random(), fxc.height + 10, FIREWORK_COLORS.gold, 1, 20);
          }),
        );
      }
    } else {
      sfx.sfxHeartbeat(0, 0.8);
      sfx.sfxHeartbeat(1.3, 0.55);
      sfx.sfxHeartbeat(2.8, 0.3);
      sfx.sfxDoom();
      if (isYolo) at(2300, () => sfx.sfxSadTrombone());
      if (f && !reducedMotion) {
        stops.push(
          f.emit((dt, fxc) => {
            const n = dt * 110;
            for (let i = 0; i < n; i++) {
              fxc.burst(Math.random() * (fxc.width + 200) - 100, -20, { count: 1, kind: "rain", colors: ["#8a93b8", "#5b6384", "#7f1d1d"], speed: [900, 1300], angle: Math.PI / 2 + 0.12, spread: 0.05, life: [1.2, 1.6], size: [1, 1.8] });
            }
            if (Math.random() < dt * 8) {
              fxc.burst(Math.random() * fxc.width, -10, { count: 1, kind: "ash", colors: ["#6b6580", "#3a3440", "#8a2a34"], speed: [20, 60], angle: Math.PI / 2, spread: 0.6, life: [5, 8], size: [2, 5], gravity: 8, drag: 0.4 });
            }
          }),
        );
      }
    }
    at(1400, addJoke);
    for (let k = 1; k < 30; k++) at(1400 + k * 2600, addJoke);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      stops.forEach((s) => s());
      f?.clear();
      setJokes([]);
    };
  }, [active, mode, particlesRef, reducedMotion, volley, addJoke, isYolo]);

  const onHeroLanded = useCallback(
    (p: { x: number; y: number; r: number } | null) => {
      const f = particlesRef.current;
      if (!f || !p || reducedMotion) return;
      if (mode === "victory") {
        Bursts.sparks(f, p.x, p.y, FIREWORK_COLORS.gold, 110, 1.4);
        f.ring(p.x, p.y, "#ffe7a3", p.r * 6, 1, 8);
      } else {
        Bursts.shatter(f, p.x, p.y, ["#3a3440", "#6b1a22", "#ff4d5e"], 24, 1);
        if (isYolo) {
          // The mud splash of the old finale, for YOLO tables.
          f.burst(p.x, p.y + p.r * 0.6, { count: 40, kind: "shard", colors: ["#3d2314", "#5a3825", "#78350f"], speed: [120, 420], angle: -Math.PI / 2, spread: 2.2, life: [0.8, 1.4], size: [3, 7], gravity: 900, drag: 0.3 });
        }
      }
    },
    [particlesRef, mode, reducedMotion, isYolo],
  );

  const switchMode = (next: Mode) => {
    setMode(next);
    setHeroCount(1);
    setHeroKey(0);
    setShowStory(false);
    onModeChange?.(next);
  };

  if (!active) return null;
  const defeat = mode === "defeat";
  const heroThrow: HeroThrow = {
    key: heroKey,
    dice: Array.from({ length: heroCount }, () => ({ kind: "d20" as const, value: defeat ? 1 : 20, palette: defeat ? ("cursed" as const) : ("gilded" as const) })),
    outcome: defeat ? "fumble" : "crit",
    from: "top",
  };

  return (
    <div className="fx-layer" style={{ zIndex: 72 }} role="dialog" aria-modal="true" aria-label={defeat ? titles.defeat : titles.victory}>
      {defeat ? <div className="fx-desaturate" /> : null}
      <div className={`fx-backdrop ${defeat ? "fx-backdrop--defeat" : "fx-backdrop--victory"}`} />
      {defeat ? <div className="fx-vignette fx-vignette--blood" /> : <div className="fx-rays" />}
      <Laurel key={mode} defeat={defeat} />
      <HeroDie key={`${mode}-die`} throwSpec={heroThrow} box={{ x: 0.38, y: 0.12, w: 0.24, h: 0.3 }} reducedMotion={reducedMotion} onLanded={onHeroLanded} />
      <canvas ref={canvasRef} className="fx-canvas" />

      <div className="fx-center fx-center--ending">
        {defeat ? (
          <div className="fx-split" key="defeat-title">
            <FxTitle as="div" text={titles.defeat} tone="crimson" variant="drop" delayMs={500} className="fx-bigtitle fx-split__top" />
            <FxTitle as="div" text={titles.defeat} tone="crimson" variant="drop" delayMs={500} className="fx-bigtitle fx-split__bottom" />
            <svg className="fx-crack" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
              <path pathLength={1} d="M-20 66 L140 57 L220 72 L310 51 L400 69 L520 54 L610 75 L700 57 L790 66 L880 53 L1020 63" style={{ "--d": "1450ms" } as CSSProperties} />
            </svg>
          </div>
        ) : (
          <FxTitle key="victory-title" text={titles.victory} tone="gold" variant="slam" delayMs={600} className="fx-bigtitle" />
        )}
        <p className="fx-sub" style={{ animation: "fx-rise-in 700ms var(--fx-ease) 1.4s both", maxWidth: 680, lineHeight: 1.6 }}>
          {campaignTitle ? `${campaignTitle} — ` : ""}
          {defeat ? copy.defeatConcluded : copy.concluded}
        </p>
        <p className="fx-sub" style={{ animation: "fx-rise-in 700ms var(--fx-ease) 1.7s both", letterSpacing: "0.12em", textTransform: "none", fontSize: 14, color: defeat ? "#f5b5b5" : "#f4e0a6" }}>
          {defeat ? copy.defeatHeroesSalute : copy.heroesSalute}
        </p>
      </div>

      {jokes.map((j) => (
        <FxJoke key={j.id} joke={j} defeat={defeat} />
      ))}

      <div className="fx-bar">
        {defeat ? (
          <button
            type="button"
            className="fx-button fx-button--danger"
            onClick={() => {
              setHeroCount((n) => Math.min(6, n + 2));
              setHeroKey((k) => k + 1);
              sfx.sfxWhoosh(0.4, false);
            }}
          >
            {copy.dropMoreDice}
          </button>
        ) : (
          <button type="button" className="fx-button" onClick={() => volley(particlesRef.current, 5)}>
            {copy.moreFireworks}
          </button>
        )}
        {closingMessage ? (
          <button type="button" className="fx-button fx-button--ghost" onClick={() => setShowStory(true)}>
            📜 {copy.readClosing}
          </button>
        ) : null}
        <button type="button" className="fx-button fx-button--ghost" onClick={() => setMuted(!muted)} aria-label={muted ? copy.audioOff : copy.audioOn} title={muted ? copy.audioOff : copy.audioOn}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          type="button"
          className="fx-button fx-button--ghost"
          onClick={() => switchMode(defeat ? "victory" : "defeat")}
          aria-label={defeat ? copy.switchToVictory : copy.switchToDefeat}
          title={defeat ? copy.switchToVictory : copy.switchToDefeat}
        >
          {defeat ? "✨" : "💀"} <span className="fx-hide-phone">{defeat ? copy.switchToVictory : copy.switchToDefeat}</span>
        </button>
        <button type="button" className="fx-button fx-button--ghost" onClick={onClose} aria-label={copy.close} title={copy.close}>
          ✕
        </button>
      </div>

      {showStory && closingMessage ? (
        <div className="fx-scroll" onClick={() => setShowStory(false)}>
          <div className="fx-scroll__paper" onClick={(e) => e.stopPropagation()}>
            <h4>{defeat ? copy.storyTitleDefeat : copy.storyTitleVictory}</h4>
            {closingMessage}
            <div className="fx-scroll__seal" aria-hidden="true">✦</div>
            <div style={{ marginTop: 18, textAlign: "center" }}>
              <button type="button" className="fx-button fx-button--ghost" style={{ color: "#3b2512", background: "rgba(255,255,255,0.35)", borderColor: "rgba(60,30,0,0.3)" }} onClick={() => setShowStory(false)}>
                {copy.storyClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
