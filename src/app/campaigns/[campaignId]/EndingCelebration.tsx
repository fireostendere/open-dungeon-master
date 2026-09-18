"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Sparkles, X, Volume2, VolumeX } from "lucide-react";
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

const FIREWORK_COLORS = [
  "#f59e0b", "#fbbf24", "#ef4444", "#f97316",
  "#a855f7", "#ec4899", "#3b82f6", "#10b981",
  "#06b6d4", "#f43f5e", "#eab308", "#ffffff",
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
};

type FloatingBanner = {
  text: string;
  x: number;
  y: number;
  vy: number;
  alpha: number;
  scale: number;
  color: string;
};

// Web Audio synthesizer for fireworks and celebrations
class CelebrationAudio {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
}

export function EndingCelebration({
  active,
  onClose,
  campaignTitle,
}: {
  active: boolean;
  onClose: () => void;
  campaignTitle?: string;
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
    },
    ru: {
      concluded: "Приключение завершено!",
      heroesSalute: "Салют легендарным героям!",
      moreFireworks: "Запустить ещё салют!",
      close: "Закрыть салют",
      audioOn: "Выключить звук",
      audioOff: "Включить звук",
    },
    pl: {
      concluded: "Przygoda zakończona!",
      heroesSalute: "Salwa dla legendarnych bohaterów!",
      moreFireworks: "Wystrzel więcej fajerwerków!",
      close: "Zamknij fajerwerki",
      audioOn: "Wycisz dźwięk",
      audioOff: "Włącz dźwięk",
    },
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<CelebrationAudio>(new CelebrationAudio());
  const [soundEnabled, setSoundEnabled] = useState(true);

  const rocketsRef = useRef<FireworkRocket[]>([]);
  const sparksRef = useRef<FireworkSpark[]>([]);
  const diceRef = useRef<CelebrationDie[]>([]);
  const bannersRef = useRef<FloatingBanner[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const nextSpawnTimeRef = useRef(0);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      audioRef.current.enabled = next;
      return next;
    });
  }, []);

  // Launch a new firework rocket
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
      const speed = Math.sqrt(2 * 0.22 * dist); // Physics: v = sqrt(2*g*h)
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

  // Spawn a celebration die
  const spawnDie = useCallback(
    (
      x: number,
      y: number,
      vx?: number,
      vy?: number,
      kind?: "d20" | "d8" | "d6",
      forcedValue?: string,
    ) => {
      const palette = DICE_PALETTES[Math.floor(Math.random() * DICE_PALETTES.length)];
      const chosenKind = kind ?? (Math.random() < 0.65 ? "d20" : Math.random() < 0.5 ? "d8" : "d6");
      let val = forcedValue;
      if (!val) {
        if (chosenKind === "d20") {
          const rand = Math.random();
          val = rand < 0.3 ? "20" : rand < 0.5 ? "NAT 20" : String(Math.floor(Math.random() * 19) + 1);
        } else if (chosenKind === "d8") {
          val = String(Math.floor(Math.random() * 8) + 1);
        } else {
          val = String(Math.floor(Math.random() * 6) + 1);
        }
      }

      diceRef.current.push({
        kind: chosenKind,
        x,
        y,
        vx: vx ?? (Math.random() - 0.5) * 8,
        vy: vy ?? -(Math.random() * 6 + 4),
        size: Math.random() * 12 + 32, // 32px to 44px radius
        rotX: Math.random() * Math.PI * 2,
        rotY: Math.random() * Math.PI * 2,
        rotZ: Math.random() * Math.PI * 2,
        vRotX: (Math.random() - 0.5) * 0.08,
        vRotY: (Math.random() - 0.5) * 0.08,
        vRotZ: (Math.random() - 0.5) * 0.08,
        palette,
        value: val,
        alpha: 1,
        sparkles: [],
      });
    },
    [],
  );

  // Detonate a rocket into sparks & dice
  const explodeRocket = useCallback(
    (rocket: FireworkRocket) => {
      audioRef.current.playExplosion();

      const particleCount = rocket.burstPayload === "grand_finale" ? 140 : 80;
      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 2;
        sparksRef.current.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: Math.random() < 0.2 ? "#ffffff" : rocket.color,
          alpha: 1,
          decay: Math.random() * 0.015 + 0.012,
          size: Math.random() * 3 + 1.5,
          gravity: 0.12,
          friction: 0.96,
          flicker: Math.random() < 0.3,
        });
      }

      // If it's a dice burst or grand finale, launch tumbling dice!
      if (rocket.burstPayload === "dice_burst" || rocket.burstPayload === "grand_finale") {
        audioRef.current.playFanfare();
        const diceCount = rocket.burstPayload === "grand_finale" ? 5 : 3;
        for (let i = 0; i < diceCount; i++) {
          const angle = ((Math.PI * 2) / diceCount) * i + (Math.random() - 0.5) * 0.5;
          const speed = Math.random() * 5 + 3;
          spawnDie(
            rocket.x,
            rocket.y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 2,
            i === 0 ? "d20" : undefined,
            i === 0 ? "20" : undefined,
          );
        }

        // Floating celebratory badge
        bannersRef.current.push({
          text: Math.random() < 0.5 ? "★ NAT 20! ★" : "⚔ VICTORY ⚔",
          x: rocket.x,
          y: rocket.y - 20,
          vy: -1.2,
          alpha: 1,
          scale: 0.7,
          color: rocket.color,
        });
      }
    },
    [spawnDie],
  );

  // Trigger a full celebration volley
  const triggerVolley = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Launch a barrage of 4-6 rockets across the screen
    const count = 5;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const x = (w / (count + 1)) * (i + 1) + (Math.random() - 0.5) * 80;
        const payload = i % 2 === 0 ? "dice_burst" : "normal";
        launchRocket(x, h * 0.2 + Math.random() * (h * 0.25), payload);
      }, i * 220);
    }

    // Also shoot up 2 ground-based celebration dice
    setTimeout(() => {
      spawnDie(w * 0.25, h, (Math.random() - 0.2) * 5, -(Math.random() * 6 + 14), "d20", "20");
      spawnDie(w * 0.75, h, -(Math.random() - 0.2) * 5, -(Math.random() * 6 + 14), "d20", "NAT 20");
    }, 400);
  }, [launchRocket, spawnDie]);

  // Initial trigger upon becoming active
  useEffect(() => {
    if (!active) return;
    triggerVolley();
    audioRef.current.playFanfare();
  }, [active, triggerVolley]);

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

      // Semi-transparent clear for subtle motion blur
      ctx.clearRect(0, 0, width, height);

      // Auto-schedule occasional celebratory fireworks while active
      if (time > nextSpawnTimeRef.current) {
        launchRocket(
          undefined,
          undefined,
          Math.random() < 0.4 ? "dice_burst" : "normal",
        );
        nextSpawnTimeRef.current = time + 1400 + Math.random() * 1600;
      }

      // 1. UPDATE & DRAW ROCKETS
      for (let i = rocketsRef.current.length - 1; i >= 0; i--) {
        const r = rocketsRef.current[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.22; // Gravity

        // Add trail
        r.trail.push({ x: r.x, y: r.y, alpha: 1, size: Math.random() * 2 + 2 });
        if (r.trail.length > 12) r.trail.shift();

        // Draw trail
        ctx.beginPath();
        for (const pt of r.trail) {
          ctx.fillStyle = r.color;
          ctx.globalAlpha = pt.alpha * 0.7;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
          pt.alpha -= 0.08;
        }

        // Draw rocket head
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Check if reached apex or target
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

      // 3. UPDATE & DRAW 3D DICE
      for (let i = diceRef.current.length - 1; i >= 0; i--) {
        const die = diceRef.current[i];
        die.x += die.vx;
        die.y += die.vy;
        die.vy += 0.28; // Gravity on dice

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

        // Draw ambient glow behind die
        const glowRad = die.size * 1.5;
        const glowGrad = ctx.createRadialGradient(0, 0, die.size * 0.3, 0, 0, glowRad);
        glowGrad.addColorStop(0, die.palette.sparkleColor + "55");
        glowGrad.addColorStop(1, "transparent");
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, glowRad, 0, Math.PI * 2);
        ctx.fill();

        // 3D Rotation matrices for vertices
        const cosX = Math.cos(die.rotX), sinX = Math.sin(die.rotX);
        const cosY = Math.cos(die.rotY), sinY = Math.sin(die.rotY);
        const cosZ = Math.cos(die.rotZ), sinZ = Math.sin(die.rotZ);

        const rotate3D = (v: [number, number, number]): [number, number, number] => {
          // Around X
          let y1 = v[1] * cosX - v[2] * sinX;
          let z1 = v[1] * sinX + v[2] * cosX;
          // Around Y
          let x2 = v[0] * cosY + z1 * sinY;
          let z2 = -v[0] * sinY + z1 * cosY;
          // Around Z
          let x3 = x2 * cosZ - y1 * sinZ;
          let y3 = x2 * sinZ + y1 * cosZ;
          return [x3, y3, z2];
        };

        const lightDir = [0.577, -0.577, 0.577]; // Normalized light vector

        if (die.kind === "d20") {
          const transformed = D20_VERTICES.map(rotate3D);

          // Render triangular faces
          let bestFaceZ = -1;
          let bestFaceCenter: [number, number] = [0, 0];

          for (const face of D20_FACES) {
            const p0 = transformed[face[0]];
            const p1 = transformed[face[1]];
            const p2 = transformed[face[2]];

            // Compute normal: (p1 - p0) x (p2 - p0)
            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;

            // Backface culling: nz > 0 means facing camera
            if (nz <= 0) continue;

            const nLen = Math.hypot(nx, ny, nz) || 1;
            const normX = nx / nLen, normY = ny / nLen, normZ = nz / nLen;
            const dot = Math.max(0.25, normX * lightDir[0] + normY * lightDir[1] + normZ * lightDir[2]);

            // Shade face
            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.8 + 0.4)));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.8 + 0.4)));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.8 + 0.4)));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = 1.2;

            ctx.beginPath();
            ctx.moveTo(p0[0] * die.size, p0[1] * die.size);
            ctx.lineTo(p1[0] * die.size, p1[1] * die.size);
            ctx.lineTo(p2[0] * die.size, p2[1] * die.size);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Track most prominent forward-facing face
            if (normZ > bestFaceZ) {
              bestFaceZ = normZ;
              bestFaceCenter = [
                ((p0[0] + p1[0] + p2[0]) / 3) * die.size,
                ((p0[1] + p1[1] + p2[1]) / 3) * die.size,
              ];
            }
          }

          // Draw die numeral on the most forward-facing face
          if (bestFaceZ > 0.65) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.44)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "#000000";
            ctx.shadowBlur = 4;
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

            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.8 + 0.4)));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.8 + 0.4)));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.8 + 0.4)));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = 1.2;

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

          if (bestFaceZ > 0.65) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.48)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(die.value, bestFaceCenter[0], bestFaceCenter[1]);
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

            const r = Math.min(255, Math.floor(die.palette.fillBase[0] * (dot * 0.8 + 0.4)));
            const g = Math.min(255, Math.floor(die.palette.fillBase[1] * (dot * 0.8 + 0.4)));
            const b = Math.min(255, Math.floor(die.palette.fillBase[2] * (dot * 0.8 + 0.4)));

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.strokeStyle = die.palette.edgeColor;
            ctx.lineWidth = 1.2;

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

          if (bestFaceZ > 0.65) {
            ctx.fillStyle = die.palette.textColor;
            ctx.font = `bold ${Math.round(die.size * 0.52)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(die.value, bestFaceCenter[0], bestFaceCenter[1]);
          }
        }

        ctx.restore();
      }

      // 4. UPDATE & DRAW FLOATING BANNERS
      for (let i = bannersRef.current.length - 1; i >= 0; i--) {
        const b = bannersRef.current[i];
        b.y += b.vy;
        b.alpha -= 0.012;
        b.scale = Math.min(1.1, b.scale + 0.02);

        if (b.alpha <= 0) {
          bannersRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(b.scale, b.scale);
        ctx.globalAlpha = b.alpha;

        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(b.text, 0, 0);
        ctx.shadowBlur = 0;

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
  }, [active, launchRocket, explodeRocket]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Canvas for fireworks and dice */}
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />

      {/* Floating Header Banner */}
      <div className="animate-fade-up pointer-events-auto absolute inset-x-0 top-6 flex justify-center px-4">
        <div className="flex max-w-lg items-center gap-3 rounded-2xl border border-amber-500/40 bg-stone-950/85 px-4 py-2.5 shadow-[0_0_35px_rgba(245,158,11,0.25)] backdrop-blur-md">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-stone-950 shadow-inner">
            <Sparkles className="size-5 animate-spin" style={{ animationDuration: "6s" }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-sm font-bold tracking-wide text-amber-100">
              {campaignTitle ? `${campaignTitle} — ` : ""}
              {copy.concluded}
            </h3>
            <p className="truncate text-xs text-amber-300/80">{copy.heroesSalute}</p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleSound}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
              title={soundEnabled ? copy.audioOn : copy.audioOff}
              aria-label={soundEnabled ? copy.audioOn : copy.audioOff}
            >
              {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>

            <button
              type="button"
              onClick={triggerVolley}
              className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-2.5 py-1 text-xs font-semibold text-amber-200 shadow-sm transition hover:bg-amber-900/60"
            >
              {copy.moreFireworks}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
              title={copy.close}
              aria-label={copy.close}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
