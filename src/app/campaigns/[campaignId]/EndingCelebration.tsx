"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Sparkles, X, Volume2, VolumeX, Skull, Scroll, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// 3D Polyhedral geometry definitions for Canvas projection

// Icosahedron (d20) vertices and faces
const PHI = (1 + Math.sqrt(5)) / 2;
const D20_RAW_VERTICES: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

// Normalize vertices to unit sphere
const D20_VERTICES = D20_RAW_VERTICES.map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len] as [number, number, number];
});

const D20_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

// Octahedron (d8) vertices and faces
const D8_VERTICES: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const D8_FACES: [number, number, number][] = [
  [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
  [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
];

// Cube (d6) vertices and faces
const D6_VERTICES: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
].map(([x, y, z]) => {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len] as [number, number, number];
});

const D6_FACES: [number, number, number, number][] = [
  [0, 1, 2, 3], // back
  [4, 7, 6, 5], // front
  [0, 4, 5, 1], // bottom
  [2, 6, 7, 3], // top
  [0, 3, 7, 4], // left
  [1, 5, 6, 2], // right
];

// Color palettes for fireworks and dice
type DicePalette = {
  name: string;
  fillBase: [number, number, number]; // RGB
  edgeColor: string;
  textColor: string;
  sparkleColor: string;
};

// Joyful victory palettes
const DICE_PALETTES: DicePalette[] = [
  {
    name: "gold",
    fillBase: [230, 160, 20],
    edgeColor: "#fef08a",
    textColor: "#ffffff",
    sparkleColor: "#fde047",
  },
  {
    name: "ruby",
    fillBase: [200, 30, 45],
    edgeColor: "#fca5a5",
    textColor: "#ffffff",
    sparkleColor: "#ef4444",
  },
  {
    name: "amethyst",
    fillBase: [140, 45, 200],
    edgeColor: "#d8b4fe",
    textColor: "#ffffff",
    sparkleColor: "#c084fc",
  },
  {
    name: "sapphire",
    fillBase: [30, 120, 230],
    edgeColor: "#93c5fd",
    textColor: "#ffffff",
    sparkleColor: "#60a5fa",
  },
  {
    name: "emerald",
    fillBase: [25, 170, 95],
    edgeColor: "#86efac",
    textColor: "#ffffff",
    sparkleColor: "#4ade80",
  },
];

// High-contrast, dramatic sad/cursed palettes for defeat & 1s
const SAD_DICE_PALETTES: DicePalette[] = [
  {
    name: "cursed_blood",
    fillBase: [140, 22, 32],
    edgeColor: "#fca5a5",
    textColor: "#ffffff",
    sparkleColor: "#ef4444", // burning red aura
  },
  {
    name: "obsidian_crimson",
    fillBase: [42, 44, 56],
    edgeColor: "#f87171", // crisp glowing red edges outlining every facet!
    textColor: "#ef4444", // glowing red 1
    sparkleColor: "#dc2626",
  },
  {
    name: "eldritch_void",
    fillBase: [80, 28, 110],
    edgeColor: "#d8b4fe", // glowing purple edge facets
    textColor: "#ffffff",
    sparkleColor: "#c084fc",
  },
  {
    name: "cold_crypt",
    fillBase: [50, 72, 94],
    edgeColor: "#93c5fd", // cold icy edge
    textColor: "#ef4444", // stark red 1
    sparkleColor: "#38bdf8",
  },
  {
    name: "dark_verdigris",
    fillBase: [30, 85, 80],
    edgeColor: "#5eead4",
    textColor: "#fca5a5",
    sparkleColor: "#14b8a6",
  },
];

const FIREWORK_COLORS = [
  "#f59e0b", "#fbbf24", "#ef4444", "#f97316",
  "#a855f7", "#ec4899", "#3b82f6", "#10b981",
  "#06b6d4", "#f43f5e", "#eab308", "#ffffff",
];

const VICTORY_BANNERS_RU = {
  ru: [
    "★ НАТУРАЛЬНАЯ 20! ★",
    "⚔️ ВЕЛИКАЯ ПОБЕДА! ⚔️",
    "👑 ТРИУМФ ГЕРОЕВ! 👑",
    "🏆 ЛЕГЕНДА СВЕРШИЛАСЬ 🏆",
    "✨ СЛАВА ПОБЕДИТЕЛЯМ! ✨",
    "🐉 ЗЛО ПОВЕРЖЕНО 🐉",
    "🔥 КРИТИЧЕСКИЙ УСПЕХ 🔥",
  ],
}.ru;

const VICTORY_BANNERS_EN = [
  "★ NATURAL 20! ★",
  "⚔️ VICTORY ⚔️",
  "👑 CRITICAL TRIUMPH 👑",
  "🏆 LEGENDARY FINALE 🏆",
  "✨ HEROES OF THE REALM ✨",
  "🐉 EVIL VANQUISHED 🐉",
  "🔥 CRITICAL SUCCESS 🔥",
];

const DEFEAT_BANNERS_RU = {
  ru: [
    "💀 КРИТИЧЕСКИЙ ПРОВАЛ 💀",
    "🎲 НАТУРАЛЬНАЯ 1 🎲",
    "☠️ ПОЛНЫЙ ПРОЁБ ☠️",
    "⚰️ ОТРЯД ПОВЕРЖЕН (TPK) ⚰️",
    "🥀 ДА УПОКОЯТСЯ С МИРОМ... 🥀",
    "🌧️ КУБИКИ БЫЛИ НЕУМОЛИМЫ 🌧️",
    "🩸 ВАС ЗАПОМНЯТ... НО НЕ ТАК 🩸",
    "⚡ ВСЕ ПАЛИ В БОЮ ⚡",
  ],
}.ru;

const DEFEAT_BANNERS_EN = [
  "💀 TOTAL PARTY WIPE 💀",
  "🎲 NATURAL 1 🎲",
  "☠️ CRITICAL FAILURE ☠️",
  "⚰️ DEFEAT ⚰️",
  "🥀 REST IN PEACE... 🥀",
  "🌧️ THE DICE WERE MERCILESS 🌧️",
  "🩸 A TRAGIC END 🩸",
  "⚡ FATE WAS CRUEL ⚡",
];

const YOLO_VICTORY_BANNERS_RU = [
  "🔥 ЕБАЛИ И РАЗЪЕБАЛИ! 🔥",
  "👑 ВОТ ЭТО БЛЯТЬ ПОБЕДА! 👑",
  "★ НАТУРАЛЬНАЯ 20, СУКА! ★",
  "⚔️ ВРАГ В ГОВНЕ, МЫ В ШОКОЛАДЕ ⚔️",
  "🏆 РАЗМОТАЛИ ЭТИХ ПИДОРАСОВ 🏆",
  "✨ АБСОЛЮТНЫЙ РАЗЪЁБ! ✨",
  "🐉 ДРАКОН ОТСОСАЛ ПО ПОЛНОЙ 🐉",
  "🔥 СУПЕРКРИТ, НАХУЙ! 🔥",
];

const YOLO_VICTORY_BANNERS_EN = [
  "🔥 WE FUCKING DID IT! 🔥",
  "👑 ABSOLUTE BADASS VICTORY 👑",
  "★ NATURAL 20, BITCHES! ★",
  "⚔️ DESTROYED THEM COMPLETELY ⚔️",
  "🏆 LEGENDARY BADASSES 🏆",
  "✨ FUCKING GLORIOUS! ✨",
];

const YOLO_DEFEAT_BANNERS_RU = [
  "☠️ ПОЛНЫЙ ПИЗДЕЦ И ПРОЁБ ☠️",
  "💀 ОТРЯД ОБОСРАЛСЯ (TPK) 💀",
  "🎲 НАТУРАЛЬНАЯ ЕДИНИЦА, БЛЯТЬ! 🎲",
  "⚰️ ЗАКОПАЛИ НАХУЙ ВЕСЬ ОТРЯД ⚰️",
  "🩸 ВСЁ ПОШЛО ПО ПИЗДЕ 🩸",
  "💩 УТОНУЛИ В ГОВНЕ 💩",
  "⚡ ЗАРУИНИЛИ ВСЮ КАМПАНИЮ ⚡",
  "🥀 СДОХЛИ КАК ЛОХИ 🥀",
];

const YOLO_DEFEAT_BANNERS_EN = [
  "☠️ TOTAL FUCKING DISASTER ☠️",
  "💀 WE SHIT THE BED (TPK) 💀",
  "🎲 NATURAL FUCKING 1 🎲",
  "⚰️ EVERYBODY DIED LIKE MORONS ⚰️",
  "🩸 EVERYTHING WENT TO HELL 🩸",
  "💩 BURIED IN SHIT 💩",
];

type FireworkRocket = {
  x: number;
  y: number;
  targetY: number;
  vx: number;
  vy: number;
  color: string;
  trail: { x: number; y: number; alpha: number; size: number }[];
  burstPayload: "normal" | "dice_burst" | "grand_finale";
};

type FireworkSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  decay: number;
  size: number;
  gravity: number;
  friction: number;
  flicker?: boolean;
};

type CelebrationDie = {
  kind: "d20" | "d8" | "d6";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  vRotX: number;
  vRotY: number;
  vRotZ: number;
  palette: DicePalette;
  value: string;
  alpha: number;
  sparkles: { x: number; y: number; alpha: number; color: string; size: number }[];
  bounceCount: number;
  isDefeat?: boolean;
};

type FloatingBanner = {
  text: string;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  scale: number;
  color: string;
  age: number;        // ms elapsed
  fadeStart: number;  // ms until fade begins (e.g. 4500ms)
  maxAge: number;     // ms until completely gone (e.g. 7000ms)
  isDefeat?: boolean;
};

type SadParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  size: number;
  color: string;
  alpha: number;
};

type MudSplat = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  decay: number;
  gravity: number;
  isGroundPuddle?: boolean;
  radiusX?: number;
  radiusY?: number;
  maxRadius?: number;
};

// Web Audio synthesizer for fireworks, fanfare and sad trombone
class CelebrationAudio {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public playLaunch() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(650, now + 0.35);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    } catch {
      // Audio is optional and non-critical
    }
  }

  public playExplosion() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const bufferSize = ctx.sampleRate * 0.4;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(450, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.35);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start();
    } catch {
      // Audio optional
    }
  }

  public playChime(freq = 523.25) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.61);
    } catch {
      // Audio optional
    }
  }

  public playFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playChime(freq), idx * 90);
    });
  }

  // Authentic 4-note descending Sad Trombone ("wah-wah-wah-waaaah")
  // Clean, distortion-free ending with smooth linear fade to absolute 0
  public playSadTrombone() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 4 notes: D4 -> C#4 -> C4 -> B3 mournfully sliding down to E3
      const notes = [
        { freq: 293.66, start: 0, dur: 0.35 },
        { freq: 277.18, start: 0.38, dur: 0.35 },
        { freq: 261.63, start: 0.76, dur: 0.38 },
        { freq: 246.94, start: 1.18, dur: 2.1, slideTo: 164.81 },
      ];

      for (const n of notes) {
        const noteStart = now + n.start;
        const noteDur = n.dur;

        // Rich brass trombone timbre: warm triangle body + sawtooth buzz
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc.type = "sawtooth";
        osc2.type = "triangle";

        osc.frequency.setValueAtTime(n.freq, noteStart);
        osc2.frequency.setValueAtTime(n.freq, noteStart);

        // Slide down on the last note after holding pitch steady for a moment
        if (n.slideTo) {
          const slideStart = noteStart + 0.35;
          const slideEnd = noteStart + noteDur * 0.92;
          osc.frequency.setValueAtTime(n.freq, slideStart);
          osc.frequency.exponentialRampToValueAtTime(n.slideTo, slideEnd);
          osc2.frequency.setValueAtTime(n.freq, slideStart);
          osc2.frequency.exponentialRampToValueAtTime(n.slideTo, slideEnd);
        }

        // Wah-wah plunger filter envelope: opens up ("wah") then mutes down warmly
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.setValueAtTime(2.2, noteStart); // warm, gentle resonance without harsh feedback
        filter.frequency.setValueAtTime(420, noteStart);
        filter.frequency.exponentialRampToValueAtTime(1400, noteStart + 0.08);

        if (n.slideTo) {
          filter.frequency.exponentialRampToValueAtTime(280, noteStart + noteDur * 0.85);
        } else {
          filter.frequency.exponentialRampToValueAtTime(450, noteStart + noteDur * 0.75);
        }

        // Volume envelope: smooth linear ramps to absolute 0 to prevent any clicks or pops
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.linearRampToValueAtTime(0.24, noteStart + 0.05);

        if (n.slideTo) {
          gain.gain.setValueAtTime(0.24, noteStart + 0.55);
          gain.gain.linearRampToValueAtTime(0.16, noteStart + noteDur * 0.75);
          gain.gain.linearRampToValueAtTime(0, noteStart + noteDur);
        } else {
          gain.gain.setValueAtTime(0.22, noteStart + noteDur * 0.65);
          gain.gain.linearRampToValueAtTime(0, noteStart + noteDur);
        }

        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        // Oscillators stop safely AFTER gain is completely 0
        osc.start(noteStart);
        osc.stop(noteStart + noteDur + 0.05);
        osc2.start(noteStart);
        osc2.stop(noteStart + noteDur + 0.05);
      }
    } catch {
      // Audio optional
    }
  }

  // Comical wet squelch / splat ("звук с которым наступаешь в говно")
  public playSquish() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 1. Viscous low squelch impact (heavy wet drop)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.12);
      oscGain.gain.setValueAtTime(0.28, now);
      oscGain.gain.linearRampToValueAtTime(0, now + 0.12);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);

      // 2. Wet suction / squirt burst (bandpass filtered noise)
      const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.14), ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const bpFilter = ctx.createBiquadFilter();
      bpFilter.type = "bandpass";
      bpFilter.Q.setValueAtTime(5.5, now);
      bpFilter.frequency.setValueAtTime(1450, now);
      bpFilter.frequency.exponentialRampToValueAtTime(320, now + 0.13);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.linearRampToValueAtTime(0, now + 0.14);

      noise.connect(bpFilter);
      bpFilter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);

      // 3. Wet suction bubble release chirp ("shlup-pop")
      const chirp = ctx.createOscillator();
      const chirpGain = ctx.createGain();
      chirp.type = "triangle";
      const chirpStart = now + 0.02;
      chirp.frequency.setValueAtTime(480, chirpStart);
      chirp.frequency.exponentialRampToValueAtTime(85, chirpStart + 0.05);
      chirpGain.gain.setValueAtTime(0.18, chirpStart);
      chirpGain.gain.linearRampToValueAtTime(0, chirpStart + 0.05);
      chirp.connect(chirpGain);
      chirpGain.connect(ctx.destination);
      chirp.start(chirpStart);
      chirp.stop(chirpStart + 0.06);
    } catch {
      // Audio optional
    }
  }

  // Hollow dull thud when sad dice hit bottom
  public playSadThud() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch {
      // Audio optional
    }
  }
}

export function EndingCelebration({
  active,
  onClose,
  campaignTitle,
  mode: initialMode = "victory",
  closingMessage,
  onModeChange,
}: {
  active: boolean;
  onClose: () => void;
  campaignTitle?: string;
  mode?: "victory" | "defeat";
  closingMessage?: string | null;
  onModeChange?: (mode: "victory" | "defeat") => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      concluded: "Adventure Concluded!",
      heroesSalute: "Salute to the legendary heroes!",
      moreFireworks: "More fireworks!",
      close: "Close celebration",
      audioOn: "Mute sound",
      audioOff: "Enable sound",
      defeatConcluded: "Campaign Concluded: Party Defeated (TPK)",
      defeatHeroesSalute: "The dice rolled ones... Rest in peace, brave adventurers.",
      dropMoreDice: "Drop more dice!",
      switchToVictory: "Switch to victory celebration",
      switchToDefeat: "Switch to defeat & sad trombone",
      readClosing: "Read DM's closing message",
      hideClosing: "Hide message",
      defeatBadge: "DEFEAT / PARTY WIPE",
      victoryBadge: "VICTORY / TRIUMPH",
      storyTitleVictory: "Triumph of the Heroes",
      storyTitleDefeat: "Epitaph of the Fallen",
      storyClose: "Collapse text",
    },
    ru: {
      concluded: "Приключение завершено!",
      heroesSalute: "Салют легендарным героям!",
      moreFireworks: "Запустить ещё салют!",
      close: "Закрыть салют",
      audioOn: "Выключить звук",
      audioOff: "Включить звук",
      defeatConcluded: "Кампания завершена: Поражение отряда (TPK)",
      defeatHeroesSalute: "Кубики были неумолимы... На них выпали единички. Покойтесь с миром.",
      dropMoreDice: "Уронить ещё единичек!",
      switchToVictory: "Переключить на салют победы",
      switchToDefeat: "Переключить на поражение и проёб",
      readClosing: "Читать послание Мастера",
      hideClosing: "Скрыть послание",
      defeatBadge: "ПОРАЖЕНИЕ / ПРОЁБ",
      victoryBadge: "ПОБЕДА / ТРИУМФ",
      storyTitleVictory: "Триумф легендарных героев",
      storyTitleDefeat: "Посмертная эпитафия павшим",
      storyClose: "Свернуть текст",
    },
  });

  const [mode, setMode] = useState<"victory" | "defeat">(initialMode);
  const [showStory, setShowStory] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<CelebrationAudio>(new CelebrationAudio());
  const [soundEnabled, setSoundEnabled] = useState(true);

  const rocketsRef = useRef<FireworkRocket[]>([]);
  const sparksRef = useRef<FireworkSpark[]>([]);
  const diceRef = useRef<CelebrationDie[]>([]);
  const bannersRef = useRef<FloatingBanner[]>([]);
  const sadParticlesRef = useRef<SadParticle[]>([]);
  const mudSplatsRef = useRef<MudSplat[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const nextSpawnTimeRef = useRef(0);

  // Comical mud / poop splat particles ("брызги говна / грязи")
  const spawnMudSplat = useCallback((x: number, y: number) => {
    const mudColors = ["#3d2314", "#4a2e1b", "#5a3825", "#6b4423", "#2c1810", "#78350f", "#451a03"];
    const dropletCount = Math.floor(Math.random() * 8) + 14;
    for (let k = 0; k < dropletCount; k++) {
      const angle = -Math.PI * (0.15 + Math.random() * 0.7); // upward fan splash
      const speed = Math.random() * 6.5 + 2.5;
      mudSplatsRef.current.push({
        x: x + (Math.random() - 0.5) * 16,
        y: y - 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: mudColors[Math.floor(Math.random() * mudColors.length)],
        size: Math.random() * 3.5 + 2,
        alpha: 1,
        decay: Math.random() * 0.018 + 0.012,
        gravity: 0.22,
      });
    }

    // Mud puddle ring on the floor
    mudSplatsRef.current.push({
      x,
      y: y + 2,
      vx: 0,
      vy: 0,
      color: mudColors[0],
      size: 6,
      alpha: 0.85,
      decay: 0.015,
      gravity: 0,
      isGroundPuddle: true,
      radiusX: 8,
      radiusY: 3.5,
      maxRadius: Math.random() * 14 + 22,
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      audioRef.current.enabled = next;
      return next;
    });
  }, []);

  // Launch a new firework rocket (victory mode)
  const launchRocket = useCallback(
    (
      startX?: number,
      targetY?: number,
      payload: "normal" | "dice_burst" | "grand_finale" = "normal",
    ) => {
      if (typeof window === "undefined") return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = startX ?? (w * 0.15 + Math.random() * (w * 0.7));
      const tY = targetY ?? (h * 0.15 + Math.random() * (h * 0.35));
      const dist = h - tY;
      const speed = Math.sqrt(2 * 0.22 * dist);
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

      rocketsRef.current.push({
        x,
        y: h,
        targetY: tY,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -speed,
        color,
        trail: [],
        burstPayload: payload,
      });

      audioRef.current.playLaunch();
    },
    [],
  );

  // Spawn a die (victory or sad defeat)
  const spawnDie = useCallback(
    (
      x: number,
      y: number,
      vx?: number,
      vy?: number,
      kind?: "d20" | "d8" | "d6",
      forcedValue?: string,
      isDefeat?: boolean,
    ) => {
      const paletteList = isDefeat ? SAD_DICE_PALETTES : DICE_PALETTES;
      const palette = paletteList[Math.floor(Math.random() * paletteList.length)];
      const chosenKind = kind ?? (Math.random() < 0.65 ? "d20" : Math.random() < 0.5 ? "d8" : "d6");
      let val = forcedValue;
      if (!val) {
        if (isDefeat) {
          if (chosenKind === "d20") {
            const rand = Math.random();
            val = rand < 0.45 ? "1" : rand < 0.75 ? "NAT 1" : "1";
          } else {
            val = "1";
          }
        } else {
          if (chosenKind === "d20") {
            const rand = Math.random();
            val = rand < 0.3 ? "20" : rand < 0.5 ? "NAT 20" : String(Math.floor(Math.random() * 19) + 1);
          } else if (chosenKind === "d8") {
            val = String(Math.floor(Math.random() * 8) + 1);
          } else {
            val = String(Math.floor(Math.random() * 6) + 1);
          }
        }
      }

      diceRef.current.push({
        kind: chosenKind,
        x,
        y,
        vx: vx ?? (Math.random() - 0.5) * (isDefeat ? 6 : 8),
        vy: vy ?? (isDefeat ? Math.random() * 5 + 8.5 : -(Math.random() * 6 + 4)),
        size: Math.random() * 12 + 32,
        rotX: Math.random() * Math.PI * 2,
        rotY: Math.random() * Math.PI * 2,
        rotZ: Math.random() * Math.PI * 2,
        vRotX: (Math.random() - 0.5) * (isDefeat ? 0.14 : 0.08),
        vRotY: (Math.random() - 0.5) * (isDefeat ? 0.14 : 0.08),
        vRotZ: (Math.random() - 0.5) * (isDefeat ? 0.14 : 0.08),
        palette,
        value: val,
        alpha: 1,
        sparkles: [],
        bounceCount: 0,
        isDefeat: !!isDefeat,
      });
    },
    [],
  );

  // Detonate a rocket into sparks & dice
  const explodeRocket = useCallback(
    (rocket: FireworkRocket) => {
      audioRef.current.playExplosion();

      const particleCount = rocket.burstPayload === "grand_finale" ? 220 : 160;
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 9 + 2;
        sparksRef.current.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: Math.random() < 0.2 ? "#ffffff" : rocket.color,
          alpha: 1,
          decay: Math.random() * 0.014 + 0.01,
          size: Math.random() * 3.5 + 1.5,
          gravity: 0.12,
          friction: 0.96,
          flicker: Math.random() < 0.35,
        });
      }

      // If it's a dice burst or grand finale, launch tumbling dice!
      if (rocket.burstPayload === "dice_burst" || rocket.burstPayload === "grand_finale") {
        audioRef.current.playFanfare();
        const diceCount = rocket.burstPayload === "grand_finale" ? 9 : 5;
        for (let i = 0; i < diceCount; i++) {
          const angle = ((Math.PI * 2) / diceCount) * i + (Math.random() - 0.5) * 0.4;
          const speed = Math.random() * 5.5 + 3.5;
          spawnDie(
            rocket.x,
            rocket.y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 2.5,
            i === 0 ? "d20" : undefined,
            i === 0 ? "20" : undefined,
            false,
          );
        }

        // Floating celebratory badge with 7s readable duration!
        const pool = locale === "ru" ? VICTORY_BANNERS_RU : VICTORY_BANNERS_EN;
        const bannerText = pool[Math.floor(Math.random() * pool.length)];

        bannersRef.current.push({
          text: bannerText,
          x: rocket.x,
          y: rocket.y - 20,
          vy: -0.3,
          alpha: 1,
          scale: 0.85,
          color: rocket.color,
          age: 0,
          fadeStart: 1000, // 1.0 second readable duration
          maxAge: 1400,
          isDefeat: false,
        });
      }
    },
    [locale, spawnDie],
  );

  // Trigger full celebration volley
  const triggerVolley = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    rocketsRef.current = [];
    sparksRef.current = [];
    diceRef.current = [];
    bannersRef.current = [];
    sadParticlesRef.current = [];

    bannersRef.current.push({
      text: locale === "ru" ? "⚔️ ВЕЛИКАЯ ПОБЕДА! ⚔️" : "⚔️ GRAND VICTORY ⚔️",
      x: w / 2,
      y: h * 0.35,
      vy: -0.25,
      alpha: 1,
      scale: 1.1,
      color: "#f59e0b",
      age: 0,
      fadeStart: 1000,
      maxAge: 1400,
      isDefeat: false,
    });

    // Wave 1: 4 rockets across screen
    const wave1 = [
      { x: w * 0.18, targetY: h * 0.28, delay: 0, payload: "dice_burst" as const },
      { x: w * 0.42, targetY: h * 0.22, delay: 120, payload: "normal" as const },
      { x: w * 0.65, targetY: h * 0.25, delay: 240, payload: "dice_burst" as const },
      { x: w * 0.84, targetY: h * 0.30, delay: 360, payload: "normal" as const },
    ];

    // Wave 2: 5 rockets
    const wave2 = [
      { x: w * 0.28, targetY: h * 0.18, delay: 550, payload: "dice_burst" as const },
      { x: w * 0.50, targetY: h * 0.14, delay: 700, payload: "grand_finale" as const },
      { x: w * 0.72, targetY: h * 0.20, delay: 850, payload: "dice_burst" as const },
      { x: w * 0.14, targetY: h * 0.26, delay: 1000, payload: "normal" as const },
      { x: w * 0.88, targetY: h * 0.24, delay: 1150, payload: "dice_burst" as const },
    ];

    // Wave 3: 3 grand finale rockets
    const wave3 = [
      { x: w * 0.35, targetY: h * 0.15, delay: 1400, payload: "grand_finale" as const },
      { x: w * 0.65, targetY: h * 0.16, delay: 1600, payload: "grand_finale" as const },
      { x: w * 0.50, targetY: h * 0.12, delay: 1800, payload: "grand_finale" as const },
    ];

    const allRockets = [...wave1, ...wave2, ...wave3];
    for (const r of allRockets) {
      setTimeout(() => {
        launchRocket(r.x + (Math.random() - 0.5) * 40, r.targetY, r.payload);
      }, r.delay);
    }

    // Shoot up ground-based dice fountains
    setTimeout(() => {
      spawnDie(w * 0.20, h, 2 + Math.random() * 3, -(Math.random() * 5 + 15), "d20", "20", false);
      spawnDie(w * 0.80, h, -(2 + Math.random() * 3), -(Math.random() * 5 + 15), "d20", "NAT 20", false);
    }, 250);

    setTimeout(() => {
      spawnDie(w * 0.38, h, (Math.random() - 0.5) * 4, -(Math.random() * 6 + 16), "d20", "CRIT", false);
      spawnDie(w * 0.62, h, (Math.random() - 0.5) * 4, -(Math.random() * 6 + 16), "d20", "20", false);
    }, 550);

    setTimeout(() => {
      spawnDie(w * 0.10, h, 3 + Math.random() * 3, -(Math.random() * 5 + 14), "d8", "8", false);
      spawnDie(w * 0.90, h, -(3 + Math.random() * 3), -(Math.random() * 5 + 14), "d6", "6", false);
    }, 850);
  }, [locale, launchRocket, spawnDie]);

  // Trigger sad defeat volley ("грустная анимация с проёбом, падают кубики с единичками и грустный тромбон")
  const triggerDefeatVolley = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    rocketsRef.current = [];
    sparksRef.current = [];
    diceRef.current = [];
    bannersRef.current = [];
    sadParticlesRef.current = [];
    mudSplatsRef.current = [];

    // Sad Trombone Audio ("wah-wah-wah-waaaah" clean, distortion-free ending)
    audioRef.current.playSadTrombone();

    // Center defeat banner with 1s visible duration
    bannersRef.current.push({
      text: locale === "ru" ? "💀 ПОЛНЫЙ ПРОЁБ 💀" : "💀 TOTAL PARTY WIPE 💀",
      x: w / 2,
      y: h * 0.35,
      vy: -0.2,
      alpha: 1,
      scale: 1.1,
      color: "#ef4444",
      age: 0,
      fadeStart: 1000,
      maxAge: 1400,
      isDefeat: true,
    });

    // Atmospheric gloom: burst of dark embers/rain from the top
    for (let i = 0; i < 60; i++) {
      sadParticlesRef.current.push({
        x: Math.random() * w,
        y: -10 - Math.random() * 50,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 5 + 4,
        length: Math.random() * 18 + 8,
        size: Math.random() * 2 + 1,
        color: Math.random() < 0.35 ? "#991b1b" : Math.random() < 0.6 ? "#475569" : "#334155",
        alpha: Math.random() * 0.5 + 0.4,
      });
    }

    // Wave 1 (t = 0): 5 large 3D dice plummeting fast across screen
    spawnDie(w * 0.15, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.2, "d20", "1", true);
    spawnDie(w * 0.32, -60, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.8, "d20", "NAT 1", true);
    spawnDie(w * 0.50, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.2, "d20", "1", true);
    spawnDie(w * 0.68, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.4, "d8", "1", true);
    spawnDie(w * 0.85, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.9, "d6", "1", true);

    // Wave 2 (t = 280ms): 4 more tumbling 3D dice
    setTimeout(() => {
      spawnDie(w * 0.24, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.6, "d20", "NAT 1", true);
      spawnDie(w * 0.44, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.9, "d6", "1", true);
      spawnDie(w * 0.62, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.5, "d20", "1", true);
      spawnDie(w * 0.80, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.8, "d8", "1", true);
    }, 280);

    // Wave 3 (t = 600ms): 5 more falling dice + second banner
    setTimeout(() => {
      spawnDie(w * 0.12, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.1, "d20", "1", true);
      spawnDie(w * 0.36, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.6, "d20", "NAT 1", true);
      spawnDie(w * 0.52, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.3, "d20", "1", true);
      spawnDie(w * 0.72, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.7, "d6", "1", true);
      spawnDie(w * 0.90, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.9, "d20", "NAT 1", true);

      bannersRef.current.push({
        text: locale === "ru" ? "🎲 НАТУРАЛЬНАЯ 1 🎲" : "🎲 NATURAL 1 🎲",
        x: w * 0.5,
        y: h * 0.55,
        vy: -0.2,
        alpha: 1,
        scale: 1.0,
        color: "#94a3b8",
        age: 0,
        fadeStart: 1000,
        maxAge: 1400,
        isDefeat: true,
      });
    }, 600);

    // Wave 4 (t = 950ms): 4 more tumbling dice
    setTimeout(() => {
      spawnDie(w * 0.20, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.8, "d20", "1", true);
      spawnDie(w * 0.40, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.2, "d8", "1", true);
      spawnDie(w * 0.60, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.7, "d20", "NAT 1", true);
      spawnDie(w * 0.82, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.1, "d6", "1", true);
    }, 950);

    // Wave 5 (t = 1350ms): 4 more tumbling dice + third banner
    setTimeout(() => {
      spawnDie(w * 0.28, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.1, "d20", "NAT 1", true);
      spawnDie(w * 0.48, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 9.8, "d20", "1", true);
      spawnDie(w * 0.70, -50, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.3, "d8", "1", true);
      spawnDie(w * 0.88, -55, (Math.random() - 0.5) * 3, Math.random() * 4 + 10.0, "d20", "1", true);

      bannersRef.current.push({
        text: locale === "ru" ? "⚰️ ОТРЯД ПОВЕРЖЕН (TPK) ⚰️" : "⚰️ TOTAL PARTY WIPE (TPK) ⚰️",
        x: w * 0.5,
        y: h * 0.70,
        vy: -0.2,
        alpha: 1,
        scale: 0.95,
        color: "#dc2626",
        age: 0,
        fadeStart: 1000,
        maxAge: 1400,
        isDefeat: true,
      });
    }, 1350);
  }, [locale, spawnDie]);

  const switchMode = useCallback(
    (nextMode: "victory" | "defeat") => {
      setMode(nextMode);
      onModeChange?.(nextMode);
      if (nextMode === "defeat") {
        triggerDefeatVolley();
      } else {
        triggerVolley();
        audioRef.current.playFanfare();
      }
    },
    [onModeChange, triggerDefeatVolley, triggerVolley],
  );

  // Initial trigger upon becoming active
  useEffect(() => {
    if (!active) return;
    if (mode === "defeat") {
      triggerDefeatVolley();
    } else {
      triggerVolley();
      audioRef.current.playFanfare();
    }
  }, [active, mode, triggerDefeatVolley, triggerVolley]);

  // Main animation loop
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      // Defeat mode: Gloomy background vignette
      if (mode === "defeat") {
        const vigGrad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          width * 0.2,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.75,
        );
        vigGrad.addColorStop(0, "rgba(0, 0, 0, 0.1)");
        vigGrad.addColorStop(1, "rgba(25, 8, 12, 0.65)");
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Auto-schedule events while active
      if (time > nextSpawnTimeRef.current) {
        if (mode === "defeat") {
          // Drop occasional sad dice
          const w = window.innerWidth;
          spawnDie(
            w * 0.15 + Math.random() * (w * 0.7),
            -50,
            (Math.random() - 0.5) * 3,
            Math.random() * 4 + 9.5,
            Math.random() < 0.7 ? "d20" : "d6",
            Math.random() < 0.4 ? "NAT 1" : "1",
            true,
          );
          if (Math.random() < 0.4) {
            const pool = locale === "ru" ? DEFEAT_BANNERS_RU : DEFEAT_BANNERS_EN;
            bannersRef.current.push({
              text: pool[Math.floor(Math.random() * pool.length)],
              x: w * 0.2 + Math.random() * (w * 0.6),
              y: window.innerHeight * (0.35 + Math.random() * 0.3),
              vy: -0.2,
              alpha: 1,
              scale: 0.9,
              color: "#ef4444",
              age: 0,
              fadeStart: 1000,
              maxAge: 1400,
              isDefeat: true,
            });
          }
          nextSpawnTimeRef.current = time + 1800 + Math.random() * 2000;
        } else {
          // Victory rockets
          const payloadRand = Math.random();
          const payload =
            payloadRand < 0.25 ? "grand_finale" : payloadRand < 0.65 ? "dice_burst" : "normal";
          launchRocket(undefined, undefined, payload);
          nextSpawnTimeRef.current = time + 1000 + Math.random() * 1200;
        }
      }

      // 0. UPDATE & DRAW SAD PARTICLES (rain / falling ash in defeat mode)
      if (mode === "defeat") {
        while (sadParticlesRef.current.length < 80) {
          sadParticlesRef.current.push({
            x: Math.random() * width,
            y: -20 - Math.random() * 40,
            vx: (Math.random() - 0.5) * 1.5 - 0.5,
            vy: Math.random() * 6 + 5,
            length: Math.random() * 16 + 10,
            size: Math.random() * 1.8 + 0.8,
            color: Math.random() < 0.25 ? "#7f1d1d" : Math.random() < 0.5 ? "#64748b" : "#475569",
            alpha: Math.random() * 0.4 + 0.3,
          });
        }

        for (let i = sadParticlesRef.current.length - 1; i >= 0; i--) {
          const p = sadParticlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;

          if (p.y > height + 30) {
            sadParticlesRef.current.splice(i, 1);
            continue;
          }

          ctx.strokeStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.lineWidth = p.size;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 2, p.y - p.length);
          ctx.stroke();
        }
      }

      // 1. UPDATE & DRAW ROCKETS (Victory mode)
      for (let i = rocketsRef.current.length - 1; i >= 0; i--) {
        const r = rocketsRef.current[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.22;

        r.trail.push({ x: r.x, y: r.y, alpha: 1, size: Math.random() * 2 + 2 });
        if (r.trail.length > 12) r.trail.shift();

        ctx.beginPath();
        for (const pt of r.trail) {
          ctx.fillStyle = r.color;
          ctx.globalAlpha = pt.alpha * 0.7;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
          pt.alpha -= 0.08;
        }

        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fill();

        if (r.vy >= 0 || r.y <= r.targetY) {
          explodeRocket(r);
          rocketsRef.current.splice(i, 1);
        }
      }

      // 2. UPDATE & DRAW SPARKS
      for (let i = sparksRef.current.length - 1; i >= 0; i--) {
        const s = sparksRef.current[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= s.friction;
        s.vy *= s.friction;
        s.vy += s.gravity;
        s.alpha -= s.decay;

        if (s.alpha <= 0) {
          sparksRef.current.splice(i, 1);
          continue;
        }

        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.flicker && Math.random() < 0.3 ? s.alpha * 0.4 : s.alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2.5 UPDATE & DRAW MUD / SQUELCH SPLATS ("брызги говна / грязи")
      for (let i = mudSplatsRef.current.length - 1; i >= 0; i--) {
        const splat = mudSplatsRef.current[i];
        splat.x += splat.vx;
        splat.y += splat.vy;
        splat.vy += splat.gravity;
        splat.alpha -= splat.decay;

        if (splat.alpha <= 0) {
          mudSplatsRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = splat.alpha;
        ctx.fillStyle = splat.color;

        if (splat.isGroundPuddle) {
          if (splat.radiusX && splat.maxRadius && splat.radiusX < splat.maxRadius) {
            splat.radiusX += 1.2;
            splat.radiusY = (splat.radiusY || 3) + 0.4;
          }
          ctx.beginPath();
          ctx.ellipse(splat.x, splat.y, splat.radiusX || 12, splat.radiusY || 4, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(splat.x, splat.y, splat.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 3. UPDATE & DRAW 3D DICE
      for (let i = diceRef.current.length - 1; i >= 0; i--) {
        const die = diceRef.current[i];
        die.x += die.vx;
        die.y += die.vy;

        if (mode === "defeat" || die.isDefeat) {
          die.vy += 0.44; // fast, punchy gravity so dice plummet with real mass!
          const groundY = height - die.size * 0.72;

          // Single comical bounce off the bottom:
          // Triggers strictly once when die hits bottom for the first time
          if (die.y >= groundY && die.vy > 0 && die.bounceCount === 0) {
            die.bounceCount = 1;
            die.y = groundY;
            // Exactly one bounce upward:
            die.vy = -(Math.abs(die.vy) * 0.45 + 5.0);
            die.vx = (Math.random() - 0.5) * 5;
            // Increased comical spin tumble
            die.vRotX = (Math.random() - 0.5) * 0.22;
            die.vRotY = (Math.random() - 0.5) * 0.22;
            die.vRotZ = (Math.random() - 0.5) * 0.22;

            // Play the comical "stepping into shit" squelch sound!
            audioRef.current.playSquish();

            // Spawn mud & poop splat droplets and puddle ring
            spawnMudSplat(die.x, groundY + die.size * 0.3);
          }
          // After bounceCount is 1:
          // Die arcs up, gravity turns it back down, and on its second descent
          // it does NOT bounce again! It flies straight down past height + 80 and disappears!
        } else {
          die.vy += 0.28; // gravity on fireworks dice
        }

        die.rotX += die.vRotX;
        die.rotY += die.vRotY;
        die.rotZ += die.vRotZ;

        // Die sparkles
        if (Math.random() < 0.45) {
          die.sparkles.push({
            x: die.x + (Math.random() - 0.5) * die.size,
            y: die.y + (Math.random() - 0.5) * die.size,
            alpha: 1,
            color: die.palette.sparkleColor,
            size: Math.random() * 2.5 + 1,
          });
        }

        // Draw sparkle trail
        for (let j = die.sparkles.length - 1; j >= 0; j--) {
          const spk = die.sparkles[j];
          spk.alpha -= 0.05;
          if (spk.alpha <= 0) {
            die.sparkles.splice(j, 1);
            continue;
          }
          ctx.fillStyle = spk.color;
          ctx.globalAlpha = spk.alpha * die.alpha;
          ctx.beginPath();
          ctx.arc(spk.x, spk.y, spk.size, 0, Math.PI * 2);
          ctx.fill();
        }

        // Check if die went off-screen
        if (die.y > height + 80) {
          diceRef.current.splice(i, 1);
          continue;
        }

        // Render 3D polyhedral die
        ctx.save();
        ctx.translate(die.x, die.y);
        ctx.globalAlpha = die.alpha;

        // Glow behind die
        const glowRad = die.size * 1.5;
        const glowGrad = ctx.createRadialGradient(0, 0, die.size * 0.3, 0, 0, glowRad);
        glowGrad.addColorStop(0, die.palette.sparkleColor + "55");
        glowGrad.addColorStop(1, "transparent");
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, glowRad, 0, Math.PI * 2);
        ctx.fill();

        // 3D Rotation matrices
        const cosX = Math.cos(die.rotX), sinX = Math.sin(die.rotX);
        const cosY = Math.cos(die.rotY), sinY = Math.sin(die.rotY);
        const cosZ = Math.cos(die.rotZ), sinZ = Math.sin(die.rotZ);

        const rotate3D = (v: [number, number, number]): [number, number, number] => {
          let y1 = v[1] * cosX - v[2] * sinX;
          let z1 = v[1] * sinX + v[2] * cosX;
          let x2 = v[0] * cosY + z1 * sinY;
          let z2 = -v[0] * sinY + z1 * cosY;
          let x3 = x2 * cosZ - y1 * sinZ;
          let y3 = x2 * sinZ + y1 * cosZ;
          return [x3, y3, z2];
        };

        const lightDir = [0.577, -0.577, 0.577];

        if (die.kind === "d20") {
          const transformed = D20_VERTICES.map(rotate3D);
          let bestFaceZ = -1;
          let bestFaceCenter: [number, number] = [0, 0];

          for (const face of D20_FACES) {
            const p0 = transformed[face[0]];
            const p1 = transformed[face[1]];
            const p2 = transformed[face[2]];

            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;

            if (nz <= 0) continue;

            const nLen = Math.hypot(nx, ny, nz) || 1;
            const normX = nx / nLen, normY = ny / nLen, normZ = nz / nLen;
            const dot = Math.max(0.25, normX * lightDir[0] + normY * lightDir[1] + normZ * lightDir[2]);
            const spec = Math.pow(Math.max(0, dot), 5) * 55;

            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.75 + 0.35) + spec));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.75 + 0.35) + spec));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.75 + 0.35) + spec));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = die.isDefeat ? 1.6 : 1.2;

            ctx.beginPath();
            ctx.moveTo(p0[0] * die.size, p0[1] * die.size);
            ctx.lineTo(p1[0] * die.size, p1[1] * die.size);
            ctx.lineTo(p2[0] * die.size, p2[1] * die.size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (normZ > bestFaceZ) {
              bestFaceZ = normZ;
              bestFaceCenter = [
                ((p0[0] + p1[0] + p2[0]) / 3) * die.size,
                ((p0[1] + p1[1] + p2[1]) / 3) * die.size,
              ];
            }
          }

          if (bestFaceZ > 0.55) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.44)}px -apple-system, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "#000000";
            ctx.shadowBlur = 5;
            ctx.fillText(die.value, bestFaceCenter[0], bestFaceCenter[1]);
            ctx.shadowBlur = 0;
          }
        } else if (die.kind === "d8") {
          const transformed = D8_VERTICES.map(rotate3D);
          let bestFaceZ = -1;
          let bestFaceCenter: [number, number] = [0, 0];

          for (const face of D8_FACES) {
            const p0 = transformed[face[0]];
            const p1 = transformed[face[1]];
            const p2 = transformed[face[2]];

            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;

            if (nz <= 0) continue;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            const normX = nx / nLen, normY = ny / nLen, normZ = nz / nLen;
            const dot = Math.max(0.25, normX * lightDir[0] + normY * lightDir[1] + normZ * lightDir[2]);
            const spec = Math.pow(Math.max(0, dot), 5) * 55;

            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.75 + 0.35) + spec));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.75 + 0.35) + spec));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.75 + 0.35) + spec));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = die.isDefeat ? 1.6 : 1.2;

            ctx.beginPath();
            ctx.moveTo(p0[0] * die.size, p0[1] * die.size);
            ctx.lineTo(p1[0] * die.size, p1[1] * die.size);
            ctx.lineTo(p2[0] * die.size, p2[1] * die.size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (normZ > bestFaceZ) {
              bestFaceZ = normZ;
              bestFaceCenter = [
                ((p0[0] + p1[0] + p2[0]) / 3) * die.size,
                ((p0[1] + p1[1] + p2[1]) / 3) * die.size,
              ];
            }
          }

          if (bestFaceZ > 0.55) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.48)}px -apple-system, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "#000000";
            ctx.shadowBlur = 5;
            ctx.fillText(die.value, bestFaceCenter[0], bestFaceCenter[1]);
            ctx.shadowBlur = 0;
          }
        } else {
          // d6 (Cube)
          const transformed = D6_VERTICES.map(rotate3D);
          let bestFaceZ = -1;
          let bestFaceCenter: [number, number] = [0, 0];

          for (const face of D6_FACES) {
            const p0 = transformed[face[0]];
            const p1 = transformed[face[1]];
            const p2 = transformed[face[2]];
            const p3 = transformed[face[3]];

            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;

            if (nz <= 0) continue;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            const normX = nx / nLen, normY = ny / nLen, normZ = nz / nLen;
            const dot = Math.max(0.25, normX * lightDir[0] + normY * lightDir[1] + normZ * lightDir[2]);
            const spec = Math.pow(Math.max(0, dot), 5) * 55;

            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.75 + 0.35) + spec));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.75 + 0.35) + spec));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.75 + 0.35) + spec));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = die.isDefeat ? 1.6 : 1.2;

            ctx.beginPath();
            ctx.moveTo(p0[0] * die.size, p0[1] * die.size);
            ctx.lineTo(p1[0] * die.size, p1[1] * die.size);
            ctx.lineTo(p2[0] * die.size, p2[1] * die.size);
            ctx.lineTo(p3[0] * die.size, p3[1] * die.size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (normZ > bestFaceZ) {
              bestFaceZ = normZ;
              bestFaceCenter = [
                ((p0[0] + p1[0] + p2[0] + p3[0]) / 4) * die.size,
                ((p0[1] + p1[1] + p2[1] + p3[1]) / 4) * die.size,
              ];
            }
          }

          if (bestFaceZ > 0.55) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.52)}px -apple-system, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "#000000";
            ctx.shadowBlur = 5;
            ctx.fillText(die.value, bestFaceCenter[0], bestFaceCenter[1]);
            ctx.shadowBlur = 0;
          }
        }

        ctx.restore();
      }

      // 4. UPDATE & DRAW FLOATING BANNERS (With 7-second readable duration & frosted pill card!)
      for (let i = bannersRef.current.length - 1; i >= 0; i--) {
        const b = bannersRef.current[i];
        b.age += dt * 1000;
        b.y += b.vy * (dt * 60);

        if (b.age < b.fadeStart) {
          b.alpha = 1; // Stay 100% visible and readable!
        } else {
          b.alpha = Math.max(0, 1 - (b.age - b.fadeStart) / (b.maxAge - b.fadeStart));
        }

        if (b.age >= b.maxAge || b.alpha <= 0) {
          bannersRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(b.scale, b.scale);
        ctx.globalAlpha = b.alpha;

        ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const textMetrics = ctx.measureText(b.text);
        const textWidth = textMetrics.width;
        const boxWidth = textWidth + 36;
        const boxHeight = 42;

        // Draw pill backdrop
        ctx.fillStyle = b.isDefeat ? "rgba(18, 12, 16, 0.9)" : "rgba(12, 10, 8, 0.88)";
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 14;

        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 14);
        } else {
          ctx.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(b.text, 0, 0);

        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", onResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [active, mode, launchRocket, explodeRocket, spawnDie, locale]);

  if (!active) return null;

  const isDefeat = mode === "defeat";

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Canvas for fireworks, sad rain and 3D dice */}
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />

      {/* Floating Header Banner */}
      <div className="animate-fade-up pointer-events-auto absolute inset-x-0 top-3 sm:top-6 flex justify-center px-2 sm:px-4">
        <div
          className={cn(
            "flex w-full max-w-xl flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 rounded-2xl border p-2.5 sm:px-4 sm:py-2.5 backdrop-blur-md transition-all duration-300 shadow-2xl",
            isDefeat
              ? "border-red-900/60 bg-stone-950/95 shadow-[0_0_35px_rgba(239,68,68,0.25)]"
              : "border-amber-500/40 bg-stone-950/95 shadow-[0_0_35px_rgba(245,158,11,0.25)]",
          )}
        >
          {/* Top row on mobile / Left group on desktop */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={cn(
                "flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-xl shadow-inner",
                isDefeat
                  ? "bg-gradient-to-br from-red-600 to-stone-900 text-stone-100"
                  : "bg-gradient-to-br from-amber-400 to-amber-600 text-stone-950",
              )}
            >
              {isDefeat ? (
                <Skull className="size-4 sm:size-5 animate-pulse text-red-100" />
              ) : (
                <Sparkles className="size-4 sm:size-5 animate-spin" style={{ animationDuration: "6s" }} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h3
                className={cn(
                  "truncate font-display text-xs sm:text-sm font-bold tracking-wide",
                  isDefeat ? "text-red-200" : "text-amber-100",
                )}
              >
                {campaignTitle ? `${campaignTitle} — ` : ""}
                {isDefeat ? copy.defeatConcluded : copy.concluded}
              </h3>
              <p
                className={cn(
                  "truncate text-[11px] sm:text-xs",
                  isDefeat ? "text-red-400/90" : "text-amber-300/80",
                )}
              >
                {isDefeat ? copy.defeatHeroesSalute : copy.heroesSalute}
              </p>
            </div>

            {/* Mobile close button right in the top row */}
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden rounded-lg p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 shrink-0"
              title={copy.close}
              aria-label={copy.close}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-1">
            {isDefeat ? (
              <button
                type="button"
                onClick={triggerDefeatVolley}
                className="flex-1 sm:flex-initial text-center justify-center rounded-lg border border-red-800/60 bg-red-950/60 px-2.5 py-1.5 sm:py-1 text-xs font-semibold text-red-200 shadow-sm transition hover:bg-red-900/60"
              >
                {copy.dropMoreDice}
              </button>
            ) : (
              <button
                type="button"
                onClick={triggerVolley}
                className="flex-1 sm:flex-initial text-center justify-center rounded-lg border border-amber-500/40 bg-amber-950/60 px-2.5 py-1.5 sm:py-1 text-xs font-semibold text-amber-200 shadow-sm transition hover:bg-amber-900/60"
              >
                {copy.moreFireworks}
              </button>
            )}

            {closingMessage ? (
              <button
                type="button"
                onClick={() => setShowStory((prev) => !prev)}
                className={cn(
                  "rounded-lg p-1.5 transition shrink-0",
                  showStory
                    ? "bg-amber-500/20 text-amber-200"
                    : "text-stone-400 hover:bg-stone-800 hover:text-stone-200",
                )}
                title={showStory ? copy.hideClosing : copy.readClosing}
                aria-label={showStory ? copy.hideClosing : copy.readClosing}
              >
                <Scroll className="size-4" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={toggleSound}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-200 shrink-0"
              title={soundEnabled ? copy.audioOn : copy.audioOff}
              aria-label={soundEnabled ? copy.audioOn : copy.audioOff}
            >
              {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>

            {isDefeat ? (
              <button
                type="button"
                onClick={() => switchMode("victory")}
                className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-1.5 text-amber-300 transition hover:bg-amber-900/60 shrink-0"
                title={copy.switchToVictory}
                aria-label={copy.switchToVictory}
              >
                <Sparkles className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode("defeat")}
                className="rounded-lg border border-red-900/50 bg-red-950/40 p-1.5 text-red-400 transition hover:bg-red-900/60 shrink-0"
                title={copy.switchToDefeat}
                aria-label={copy.switchToDefeat}
              >
                <Skull className="size-4" />
              </button>
            )}

            {/* Desktop close button */}
            <button
              type="button"
              onClick={onClose}
              className="hidden sm:inline-flex rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-200 shrink-0"
              title={copy.close}
              aria-label={copy.close}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Center Parchment Story Card (so users never miss reading the final story) */}
      {showStory && closingMessage ? (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center p-3 sm:p-4">
          <div
            className={cn(
              "relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border p-4 sm:p-6 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200",
              isDefeat
                ? "border-red-900/70 bg-stone-950/95 text-stone-100 shadow-[0_0_50px_rgba(239,68,68,0.25)]"
                : "border-amber-500/50 bg-stone-950/95 text-stone-100 shadow-[0_0_50px_rgba(245,158,11,0.25)]",
            )}
          >
            <div className="flex items-center justify-between pb-3 border-b border-stone-800 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {isDefeat ? (
                  <Skull className="size-5 text-red-400 shrink-0" />
                ) : (
                  <Trophy className="size-5 text-amber-400 shrink-0" />
                )}
                <h4 className="font-display text-sm font-bold tracking-wide text-stone-200 truncate">
                  {isDefeat ? copy.storyTitleDefeat : copy.storyTitleVictory}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowStory(false)}
                className="rounded-lg p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition shrink-0"
                title={copy.storyClose}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="my-3 sm:my-4 flex-1 overflow-y-auto pr-2">
              <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-200 first-letter:text-2xl first-letter:font-bold first-letter:float-left first-letter:mr-1.5">
                {closingMessage}
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-800/60 shrink-0">
              <button
                type="button"
                onClick={() => setShowStory(false)}
                className="w-full sm:w-auto text-center justify-center rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-800 hover:text-white transition"
              >
                {copy.storyClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
