"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { cn } from "@/lib/cn";
import { playBg3Sound } from "@/lib/dice/bg3-audio";

// --- 3D D20 (Icosahedron) Math ---
const PHI = (1 + Math.sqrt(5)) / 2; // ~1.6180339887
const INV_LEN = 1 / Math.sqrt(1 + PHI * PHI);

// 12 Normalized vertices of a regular icosahedron
const D20_VERTICES: [number, number, number][] = [
  [-1 * INV_LEN, PHI * INV_LEN, 0],
  [1 * INV_LEN, PHI * INV_LEN, 0],
  [-1 * INV_LEN, -PHI * INV_LEN, 0],
  [1 * INV_LEN, -PHI * INV_LEN, 0],
  [0, -1 * INV_LEN, PHI * INV_LEN],
  [0, 1 * INV_LEN, PHI * INV_LEN],
  [0, -1 * INV_LEN, -PHI * INV_LEN],
  [0, 1 * INV_LEN, -PHI * INV_LEN],
  [PHI * INV_LEN, 0, -1 * INV_LEN],
  [PHI * INV_LEN, 0, 1 * INV_LEN],
  [-PHI * INV_LEN, 0, -1 * INV_LEN],
  [-PHI * INV_LEN, 0, 1 * INV_LEN],
];

// 20 Triangular Faces (CCW winding)
const D20_FACES: [number, number, number][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

// Face numbers in standard D20 layout (opposite faces sum to 21)
const D20_FACE_VALUES = [
  20, 9, 2, 14, 8,
  11, 18, 4, 13, 16,
  1, 12, 19, 7, 13,
  10, 3, 17, 5, 15,
];

// Precalculate face normal vectors
function calcNormal(v0: [number, number, number], v1: [number, number, number], v2: [number, number, number]): [number, number, number] {
  const ax = v1[0] - v0[0];
  const ay = v1[1] - v0[1];
  const az = v1[2] - v0[2];
  const bx = v2[0] - v0[0];
  const by = v2[1] - v0[1];
  const bz = v2[2] - v0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

const FACE_NORMALS: [number, number, number][] = D20_FACES.map((face) =>
  calcNormal(D20_VERTICES[face[0]], D20_VERTICES[face[1]], D20_VERTICES[face[2]])
);

// Map a target number (1..20) to the face index and the target rotation matrix
function getTargetFaceRotation(targetValue: number): { faceIdx: number; rot: [number, number, number][] } {
  const clamped = Math.max(1, Math.min(20, Math.round(targetValue)));
  let faceIdx = D20_FACE_VALUES.indexOf(clamped);
  if (faceIdx === -1) faceIdx = 0;

  const normal = FACE_NORMALS[faceIdx];
  // Calculate rotation that maps normal -> (0, 0, 1)
  const zAxis: [number, number, number] = [0, 0, 1];
  const dot = normal[0] * zAxis[0] + normal[1] * zAxis[1] + normal[2] * zAxis[2];

  let rot: [number, number, number][];
  if (dot > 0.9999) {
    rot = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  } else if (dot < -0.9999) {
    rot = [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ];
  } else {
    // Axis = normal x (0, 0, 1) = (normal.y, -normal.x, 0)
    const ax = normal[1];
    const ay = -normal[0];
    const az = 0;
    const axLen = Math.hypot(ax, ay) || 1;
    const u: [number, number, number] = [ax / axLen, ay / axLen, az / axLen];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;

    rot = [
      [t * u[0] * u[0] + c, t * u[0] * u[1] - s * u[2], t * u[0] * u[2] + s * u[1]],
      [t * u[0] * u[1] + s * u[2], t * u[1] * u[1] + c, t * u[1] * u[2] - s * u[0]],
      [t * u[0] * u[2] - s * u[1], t * u[1] * u[2] + s * u[0], t * u[2] * u[2] + c],
    ];
  }

  return { faceIdx, rot };
}

// Matrix multiplication: 3x3 with 3x3
function multMatrix(a: [number, number, number][], b: [number, number, number][]): [number, number, number][] {
  const r: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return r;
}

// Vector transformation: 3x3 matrix * 3x1 vector
function transformVec(m: [number, number, number][], v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Make Euler rotation matrix (X then Y then Z)
function makeEulerMatrix(rx: number, ry: number, rz: number): [number, number, number][] {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  return [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy],
  ];
}

export type Bg3RollData = {
  roll: StoredRoll;
  source?: string;
  seq: number;
};

export function Bg3DiceOverlay({
  latestRoll,
  sheets = [],
  enabled = true,
  onDismiss,
}: {
  latestRoll: Bg3RollData | null;
  sheets?: CharacterSheet[];
  enabled?: boolean;
  onDismiss?: () => void;
}) {
  const [activeRoll, setActiveRoll] = useState<Bg3RollData | null>(null);
  const [phase, setPhase] = useState<"idle" | "rolling" | "landed" | "verdict">("idle");
  const [displayedNumber, setDisplayedNumber] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const seenSeqRef = useRef<number>(latestRoll?.seq ?? 0);
  const audioInitializedRef = useRef<boolean>(false);

  // Queue of rolls
  const rollQueueRef = useRef<Bg3RollData[]>([]);

  // Find character
  const character = sheets.find((s) => s.id === activeRoll?.roll.characterId);

  // Extract the primary die value (or natural roll)
  const extractNaturalDie = useCallback((roll: StoredRoll): number => {
    // If breakdown has dice terms
    const diceTerms = roll.breakdown.terms.filter((t) => t.kind === "dice");
    if (diceTerms.length > 0) {
      const firstTerm = diceTerms[0];
      const kept = firstTerm.dice.find((d) => d.kept) ?? firstTerm.dice[0];
      if (kept) return kept.value;
    }
    // Fallback if no term: subtract modifiers from total or clamp to 1..20
    return Math.max(1, Math.min(20, roll.total));
  }, []);

  // Dismiss current roll
  const dismiss = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setActiveRoll(null);
    setPhase("idle");
    setDisplayedNumber(null);
    onDismiss?.();

    // Check if more in queue
    if (rollQueueRef.current.length > 0) {
      const next = rollQueueRef.current.shift()!;
      startRollAnimation(next);
    }
  }, [onDismiss]);

  // Start roll animation sequence
  const startRollAnimation = useCallback((rollData: Bg3RollData) => {
    setActiveRoll(rollData);
    setPhase("rolling");

    const naturalDie = extractNaturalDie(rollData.roll);
    setDisplayedNumber(null);

    // Play tumbling sound
    playBg3Sound("tumble");

    const startTime = performance.now();
    const duration = 2000; // 2 seconds of satisfying BG3 tension
    const { rot: targetRot } = getTargetFaceRotation(naturalDie);

    // Initial random angular speeds
    const randRotX = (Math.random() * 8 + 12) * Math.PI;
    const randRotY = (Math.random() * 8 + 14) * Math.PI;
    const randRotZ = (Math.random() * 6 + 10) * Math.PI;

    let landingSoundPlayed = false;
    let verdictSoundPlayed = false;

    const renderLoop = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Deceleration curve (Cubic ease out)
      const easeOut = 1 - Math.pow(1 - progress, 3);

      // Canvas setup
      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Compute current rotation
      // Remaining spin scales with (1 - easeOut)
      const curRx = randRotX * (1 - easeOut);
      const curRy = randRotY * (1 - easeOut);
      const curRz = randRotZ * (1 - easeOut);
      const spinRot = makeEulerMatrix(curRx, curRy, curRz);
      const currentRot = multMatrix(spinRot, targetRot);

      // Bounce effect on landing
      let bounceScale = 1.0;
      if (progress >= 1) {
        const landElapsed = elapsed - duration;
        bounceScale = 1.0 + 0.12 * Math.exp(-landElapsed * 0.008) * Math.sin(landElapsed * 0.025);
        if (!landingSoundPlayed) {
          landingSoundPlayed = true;
          setPhase("landed");
          setDisplayedNumber(naturalDie);
          playBg3Sound("land");
        }
      }

      // Projection parameters
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = 88 * bounceScale;
      const lightDir: [number, number, number] = [-0.4, -0.6, 0.7]; // Upper-left directional light
      const lightLen = Math.hypot(...lightDir);
      const L: [number, number, number] = [lightDir[0] / lightLen, lightDir[1] / lightLen, lightDir[2] / lightLen];

      // Transform all vertices
      const transformedVerts: [number, number, number][] = D20_VERTICES.map((v) =>
        transformVec(currentRot, v)
      );

      // Project vertices to 2D
      const projected = transformedVerts.map(([x, y, z]) => {
        const perspective = 400 / (400 - z * baseRadius * 0.3);
        return {
          px: cx + x * baseRadius * perspective,
          py: cy + y * baseRadius * perspective,
          pz: z,
        };
      });

      // Sort faces by average depth (Z-buffer / painter's algorithm)
      const faceDepths = D20_FACES.map((face, idx) => {
        const z0 = projected[face[0]].pz;
        const z1 = projected[face[1]].pz;
        const z2 = projected[face[2]].pz;
        const avgZ = (z0 + z1 + z2) / 3;

        // Normal transformed
        const norm = transformVec(currentRot, FACE_NORMALS[idx]);
        return {
          idx,
          face,
          avgZ,
          norm,
          visible: norm[2] > 0.02,
        };
      });

      faceDepths.sort((a, b) => a.avgZ - b.avgZ);

      // Draw faces
      for (const item of faceDepths) {
        if (!item.visible) continue;

        const p0 = projected[item.face[0]];
        const p1 = projected[item.face[1]];
        const p2 = projected[item.face[2]];
        const norm = item.norm;

        // Lighting calculation
        const dot = Math.max(0, norm[0] * L[0] + norm[1] * L[1] + norm[2] * L[2]);
        const ambient = 0.22;
        const diffuse = dot * 0.65;

        // Specular highlight (Blinn-Phong)
        const H: [number, number, number] = [L[0], L[1], L[2] + 1];
        const hLen = Math.hypot(H[0], H[1], H[2]) || 1;
        const specDot = Math.max(0, (norm[0] * H[0] + norm[1] * H[1] + norm[2] * H[2]) / hLen);
        const specular = Math.pow(specDot, 24) * 0.45;

        const totalLight = Math.min(1, ambient + diffuse + specular);

        // BG3 Obsidian / Steel Die Color Palette
        const r = Math.round(35 + totalLight * 165);
        const g = Math.round(38 + totalLight * 175);
        const b = Math.round(52 + totalLight * 195);

        // Draw outer face
        ctx.beginPath();
        ctx.moveTo(p0.px, p0.py);
        ctx.lineTo(p1.px, p1.py);
        ctx.lineTo(p2.px, p2.py);
        ctx.closePath();

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fill();

        // Edge stroke (Bevel highlight)
        ctx.strokeStyle = `rgba(235, 215, 175, ${0.15 + specular * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw engraved numbers on visible faces
        const faceVal = D20_FACE_VALUES[item.idx];
        const isCenterFront = norm[2] > 0.88 && progress >= 0.95;

        // Face centroid
        const fcx = (p0.px + p1.px + p2.px) / 3;
        const fcy = (p0.px + p1.px + p2.px) / 3;

        ctx.save();
        ctx.translate(fcx, fcy);

        if (isCenterFront) {
          // Front face number (glowing center)
          const isFail = rollData.roll.success === false || (rollData.roll.dc !== null && rollData.roll.total < rollData.roll.dc);
          const isCritSuccess = rollData.roll.breakdown.crit === "nat20" || naturalDie === 20;
          const isCritFail = rollData.roll.breakdown.crit === "nat1" || naturalDie === 1;

          ctx.font = "bold 32px 'Cinzel', serif, Georgia";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (isCritSuccess) {
            ctx.fillStyle = "#fffbeb";
            ctx.shadowColor = "#f59e0b";
            ctx.shadowBlur = 18;
          } else if (isCritFail || isFail) {
            ctx.fillStyle = "#fb7185";
            ctx.shadowColor = "#e11d48";
            ctx.shadowBlur = 16;
          } else {
            ctx.fillStyle = "#fef08a";
            ctx.shadowColor = "#eab308";
            ctx.shadowBlur = 14;
          }

          ctx.fillText(String(faceVal), 0, 0);
        } else if (norm[2] > 0.3) {
          // Surrounding visible faces have engraved silver/white numbers
          ctx.font = "bold 14px 'Cinzel', serif, Georgia";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = `rgba(215, 225, 240, ${Math.min(0.85, norm[2] * 0.9)})`;
          ctx.fillText(String(faceVal), 0, 0);
        }

        ctx.restore();
      }

      // Check verdict phase
      if (progress >= 1 && elapsed > duration + 500) {
        if (!verdictSoundPlayed) {
          verdictSoundPlayed = true;
          setPhase("verdict");
          const isSuccess = rollData.roll.success === true || (rollData.roll.dc !== null && rollData.roll.total >= rollData.roll.dc);
          const isCritSuccess = rollData.roll.breakdown.crit === "nat20" || naturalDie === 20;
          const isCritFail = rollData.roll.breakdown.crit === "nat1" || naturalDie === 1;

          if (isCritSuccess) {
            playBg3Sound("crit_success");
          } else if (isCritFail) {
            playBg3Sound("crit_fail");
          } else if (isSuccess) {
            playBg3Sound("success");
          } else {
            playBg3Sound("failure");
          }
        }
      }

      // Keep running until auto-dismiss or user dismiss
      if (elapsed < duration + 4200) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
      } else {
        dismiss();
      }
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, [extractNaturalDie, dismiss]);

  // Listen for latestRoll updates
  useEffect(() => {
    if (!latestRoll || !enabled) return;
    if (latestRoll.seq <= seenSeqRef.current) return;
    seenSeqRef.current = latestRoll.seq;

    if (activeRoll) {
      rollQueueRef.current.push(latestRoll);
    } else {
      startRollAnimation(latestRoll);
    }
  }, [latestRoll, enabled, activeRoll, startRollAnimation]);

  // Keyboard shortcut (Escape or Space to dismiss)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeRoll && (e.key === "Escape" || e.key === " ")) {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRoll, dismiss]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  if (!activeRoll) return null;

  const roll = activeRoll.roll;
  const naturalVal = extractNaturalDie(roll);
  const modifierVal = roll.total - naturalVal;
  const isSuccess = roll.success === true || (roll.dc !== null && roll.total >= roll.dc);
  const isCritSuccess = roll.breakdown.crit === "nat20" || naturalVal === 20;
  const isCritFail = roll.breakdown.crit === "nat1" || naturalVal === 1;

  // Header Title
  const headerTitle = roll.dc !== null ? "КЛАСС СЛОЖНОСТИ" : roll.kind === "attack" ? "БРОСОК АТАКИ" : roll.kind === "saving_throw" ? "СПАСБРОСОК" : "ПРОВЕРКА";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md transition-opacity duration-300 animate-fade-in select-none cursor-pointer"
    >
      {/* Plaque Container */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-[400px] max-w-[92vw] overflow-hidden rounded-[2.5rem] border border-[#a18146]/50 bg-gradient-to-b from-[#1c1228]/95 via-[#130d1d]/95 to-[#0b0612]/98 p-6 shadow-[0_0_60px_rgba(0,0,0,0.9),0_0_30px_rgba(168,85,247,0.15)] backdrop-blur-xl",
          phase === "verdict" && isCritSuccess && "shadow-[0_0_80px_rgba(250,204,21,0.35)] ring-2 ring-amber-400/60",
          phase === "verdict" && (isCritFail || !isSuccess) && "shadow-[0_0_70px_rgba(225,29,72,0.3)] ring-1 ring-rose-500/40"
        )}
      >
        {/* Ornate Gold Filigree SVG Border Frame */}
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 400 560"
        >
          <defs>
            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d4af37" />
              <stop offset="40%" stopColor="#aa7c11" />
              <stop offset="70%" stopColor="#f3e5ab" />
              <stop offset="100%" stopColor="#8a6208" />
            </linearGradient>
            <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#f59e0b" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* Outer filigree border */}
          <rect
            x="10"
            y="10"
            width="380"
            height="540"
            rx="32"
            fill="none"
            stroke="url(#goldGradient)"
            strokeWidth="1.5"
            filter="url(#goldGlow)"
          />
          <rect
            x="14"
            y="14"
            width="372"
            height="532"
            rx="28"
            fill="none"
            stroke="url(#goldGradient)"
            strokeWidth="0.75"
            strokeDasharray="4 2"
            opacity="0.6"
          />

          {/* Top arch flourish */}
          <path
            d="M 170 10 Q 200 2 230 10 Q 200 18 170 10 Z"
            fill="url(#goldGradient)"
          />
          {/* Bottom arch flourish */}
          <path
            d="M 170 550 Q 200 558 230 550 Q 200 542 170 550 Z"
            fill="url(#goldGradient)"
          />

          {/* Corner brackets */}
          <g stroke="url(#goldGradient)" strokeWidth="1.5" fill="none" opacity="0.8">
            <path d="M 24 45 C 24 30, 30 24, 45 24" />
            <path d="M 376 45 C 376 30, 370 24, 355 24" />
            <path d="M 24 515 C 24 530, 30 536, 45 536" />
            <path d="M 376 515 C 376 530, 370 536, 355 536" />
          </g>
        </svg>

        {/* Arcane Background Runes / Geometric Circles */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-10">
          <svg className="size-[340px] animate-[spin_120s_linear_infinite]" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" fill="none" stroke="#c084fc" strokeWidth="0.75" strokeDasharray="3 3" />
            <circle cx="100" cy="100" r="70" fill="none" stroke="#c084fc" strokeWidth="0.75" />
            <polygon points="100,10 178,145 22,145" fill="none" stroke="#c084fc" strokeWidth="0.5" />
            <polygon points="100,190 22,55 178,55" fill="none" stroke="#c084fc" strokeWidth="0.5" />
          </svg>
        </div>

        {/* Content Stack */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Character and Roll detail */}
          {character || roll.detail ? (
            <div className="mb-1 text-center">
              <span className="text-xs font-semibold tracking-wider text-amber-200/80 uppercase">
                {character?.name ? `${character.name} · ` : ""}
                {roll.detail ? roll.detail.replaceAll("_", " ") : ""}
              </span>
            </div>
          ) : null}

          {/* Difficulty Class (DC) Header */}
          <div className="text-center">
            <h3 className="font-serif text-xs font-bold tracking-[0.25em] text-[#d4af37] uppercase">
              {headerTitle}
            </h3>

            {roll.dc !== null ? (
              <div className="my-1 font-serif text-5xl font-black tracking-tight text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.6)]">
                {roll.dc}
              </div>
            ) : (
              <div className="my-1 font-serif text-3xl font-extrabold tracking-tight text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                {roll.expression}
              </div>
            )}
          </div>

          {/* Ornate Gold Filigree Horizontal Divider Bar */}
          <div className="my-2 flex w-full items-center justify-center gap-2 opacity-85">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#aa7c11] to-[#f3e5ab]" />
            <svg className="size-5 text-[#d4af37]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" />
            </svg>
            <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-[#aa7c11] to-[#f3e5ab]" />
          </div>

          {/* 3D D20 Canvas Tray */}
          <div className="relative my-2 flex size-[220px] items-center justify-center">
            {/* Ambient Purple / Nebula Glow behind die */}
            <div className="absolute inset-0 rounded-full bg-purple-600/15 blur-2xl animate-pulse" />
            <canvas
              ref={canvasRef}
              width={220}
              height={220}
              className="relative z-10 size-[220px]"
            />
          </div>

          {/* Roll Breakdown and Modifiers */}
          {phase === "verdict" || phase === "landed" ? (
            <div className="my-1 flex items-center justify-center gap-1.5 font-mono text-sm text-stone-300 animate-fade-in">
              <span className="font-semibold text-amber-200">{naturalVal}</span>
              {modifierVal !== 0 ? (
                <>
                  <span className="text-stone-500">{modifierVal > 0 ? "+" : "-"}</span>
                  <span className="text-stone-300">{Math.abs(modifierVal)}</span>
                  <span className="text-stone-500">=</span>
                  <span className="font-bold text-white text-base">{roll.total}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="my-1 h-5 text-xs text-amber-200/50 italic animate-pulse">
              Судьба решает...
            </div>
          )}

          {/* Verdict Banner (1:1 with Baldur's Gate 3) */}
          <div className="min-h-[52px] flex items-center justify-center text-center">
            {phase === "verdict" ? (
              <div className="animate-scale-in">
                {isCritSuccess ? (
                  <div className="font-serif text-2xl font-black tracking-widest text-amber-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.9)] uppercase">
                    ★ КРИТИЧЕСКИЙ УСПЕХ! ★
                  </div>
                ) : isCritFail ? (
                  <div className="font-serif text-2xl font-black tracking-widest text-rose-600 drop-shadow-[0_0_20px_rgba(225,29,72,0.9)] uppercase">
                    ☠ КРИТИЧЕСКИЙ ПРОВАЛ! ☠
                  </div>
                ) : isSuccess ? (
                  <div className="font-serif text-3xl font-black tracking-widest text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.8)] uppercase">
                    УСПЕХ!
                  </div>
                ) : (
                  <div className="font-serif text-3xl font-black tracking-widest text-rose-500 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)] uppercase">
                    НЕУДАЧА!
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Dismiss / Continue hint */}
          <button
            type="button"
            onClick={dismiss}
            className="mt-3 rounded-full border border-amber-500/30 bg-amber-950/40 px-5 py-1 text-xs text-amber-200/80 transition-colors hover:border-amber-400 hover:bg-amber-900/60 hover:text-amber-100"
          >
            Продолжить (или клик в любом месте)
          </button>
        </div>
      </div>
    </div>
  );
}
