"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { cn } from "@/lib/cn";
import { playBg3Sound } from "@/lib/dice/bg3-audio";

// --- 3D D20 (Icosahedron) Math ---
const PHI = (1 + Math.sqrt(5)) / 2;
const INV_LEN = 1 / Math.sqrt(1 + PHI * PHI);

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

const D20_FACE_VALUES = [
  20, 9, 2, 14, 8,
  11, 18, 4, 13, 16,
  1, 12, 19, 7, 13,
  10, 3, 17, 5, 15,
];

function calcNormal(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number]
): [number, number, number] {
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

function getTargetRotation(targetVal: number): [number, number, number][] {
  let faceIdx = D20_FACE_VALUES.indexOf(targetVal);
  if (faceIdx === -1) faceIdx = 0;
  const norm = FACE_NORMALS[faceIdx];

  const dot = norm[2];
  if (dot > 0.9999) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (dot < -0.9999) return [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];

  const ax = norm[1], ay = -norm[0], az = 0;
  const axLen = Math.hypot(ax, ay) || 1;
  const u: [number, number, number] = [ax / axLen, ay / axLen, az / axLen];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;

  return [
    [t * u[0] * u[0] + c, t * u[0] * u[1] - s * u[2], t * u[0] * u[2] + s * u[1]],
    [t * u[0] * u[1] + s * u[2], t * u[1] * u[1] + c, t * u[1] * u[2] - s * u[0]],
    [t * u[0] * u[2] - s * u[1], t * u[1] * u[2] + s * u[0], t * u[2] * u[2] + c],
  ];
}

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

function transformVec(m: [number, number, number][], v: [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

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

type ItemizedBonus = {
  name: string;
  val: number;
  icon?: string;
};

type DieSimState = {
  val: number;
  discarded: boolean;
  isCrit20: boolean;
  isCrit1: boolean;
  cx: number;
  cy: number;
  radius: number;
  targetRot: [number, number, number][];
  randRx: number;
  randRy: number;
  randRz: number;
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
  const [bonuses, setBonuses] = useState<ItemizedBonus[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const seenSeqRef = useRef<number>(latestRoll?.seq ?? 0);
  const rollQueueRef = useRef<Bg3RollData[]>([]);

  const character = sheets.find((s) => s.id === activeRoll?.roll.characterId);

  const dismiss = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setActiveRoll(null);
    setPhase("idle");
    setBonuses([]);
    onDismiss?.();

    if (rollQueueRef.current.length > 0) {
      const next = rollQueueRef.current.shift()!;
      startRollAnimation(next);
    }
  }, [onDismiss]);

  const extractItemizedBonuses = useCallback((roll: StoredRoll, sheet?: CharacterSheet): ItemizedBonus[] => {
    const list: ItemizedBonus[] = [];

    // Derive ability score name if available
    const detailLower = (roll.detail || "").toLowerCase();
    let abilityName = "Характеристика";
    if (detailLower.includes("stealth") || detailLower.includes("acrobatics") || detailLower.includes("sleight")) {
      abilityName = "Ловкость";
    } else if (detailLower.includes("athletics")) {
      abilityName = "Сила";
    } else if (detailLower.includes("perception") || detailLower.includes("insight") || detailLower.includes("survival") || detailLower.includes("medicine")) {
      abilityName = "Мудрость";
    } else if (detailLower.includes("persuasion") || detailLower.includes("deception") || detailLower.includes("intimidation") || detailLower.includes("performance")) {
      abilityName = "Харизма";
    } else if (detailLower.includes("arcana") || detailLower.includes("history") || detailLower.includes("investigation") || detailLower.includes("nature") || detailLower.includes("religion")) {
      abilityName = "Интеллект";
    }

    // Additional dice terms (e.g. 1d4 Guidance/Bless, 1d6 Bardic Inspiration)
    for (const term of roll.breakdown.terms) {
      if (term.kind === "dice" && term.sides !== 20) {
        let name = `Кубик d${term.sides}`;
        let icon = "🎲";
        if (term.sides === 4) {
          name = sheet?.conditions?.some((c) => c.toLowerCase().includes("guidance")) ? "Заклинание «Наставление»" : sheet?.conditions?.some((c) => c.toLowerCase().includes("bless")) ? "Заклинание «Благословение»" : "Бонус 1d4";
          icon = "🙏";
        } else if (term.sides === 6 || term.sides === 8 || term.sides === 10) {
          name = "Вдохновение барда";
          icon = "🎵";
        }
        list.push({ name, val: term.subtotal, icon });
      } else if (term.kind === "modifier") {
        // Break modifier into ability and proficiency if possible
        const totalMod = term.sign * term.value;
        if (sheet && sheet.level) {
          const pb = Math.floor((sheet.level - 1) / 4) + 2;
          if (totalMod >= pb && roll.kind === "skill_check") {
            list.push({ name: `Модификатор (${abilityName})`, val: totalMod - pb, icon: "🔹" });
            list.push({ name: "Бонус мастерства", val: pb, icon: "⚔" });
            continue;
          }
        }
        list.push({
          name: totalMod > 0 ? `Модификатор (${abilityName})` : "Штраф / помеха",
          val: totalMod,
          icon: "🔹",
        });
      }
    }

    return list;
  }, []);

  const startRollAnimation = useCallback((rollData: Bg3RollData) => {
    setActiveRoll(rollData);
    setPhase("rolling");

    const roll = rollData.roll;
    const itemized = extractItemizedBonuses(roll, character);
    setBonuses(itemized);

    playBg3Sound("tumble");

    // Extract dice from primary term
    const primaryDiceTerm = roll.breakdown.terms.find((t) => t.kind === "dice" && t.sides === 20);
    const diceResults = primaryDiceTerm && primaryDiceTerm.kind === "dice" ? primaryDiceTerm.dice : [{ sides: 20, value: Math.max(1, Math.min(20, roll.total)), kept: true }];

    const isMulti = diceResults.length > 1;
    const canvasWidth = 400;
    const canvasHeight = 220;

    const diceSimList: DieSimState[] = diceResults.map((d, idx) => {
      const cx = isMulti ? (idx === 0 ? 120 : 280) : 200;
      const cy = 110;
      const radius = isMulti ? 74 : 92;

      return {
        val: d.value,
        discarded: !d.kept,
        isCrit20: d.value === 20,
        isCrit1: d.value === 1,
        cx,
        cy,
        radius,
        targetRot: getTargetRotation(d.value),
        randRx: (Math.random() * 8 + 14) * Math.PI,
        randRy: (Math.random() * 8 + 16) * Math.PI,
        randRz: (Math.random() * 6 + 12) * Math.PI,
      };
    });

    const startTime = performance.now();
    const duration = 2000;
    let landingSoundDone = false;
    let verdictSoundDone = false;

    const renderLoop = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Render each die
      for (const die of diceSimList) {
        const curRx = die.randRx * (1 - easeOut);
        const curRy = die.randRy * (1 - easeOut);
        const curRz = die.randRz * (1 - easeOut);
        const spinRot = makeEulerMatrix(curRx, curRy, curRz);
        const currentRot = multMatrix(spinRot, die.targetRot);

        let bounceScale = 1.0;
        if (progress >= 1) {
          const dt = elapsed - duration;
          bounceScale = 1.0 + 0.12 * Math.exp(-dt * 0.008) * Math.sin(dt * 0.025);
        }

        const radius = die.radius * bounceScale;
        const isDimmed = progress >= 1 && die.discarded;

        ctx.save();
        if (isDimmed) {
          ctx.globalAlpha = 0.38;
        }

        const lightDir: [number, number, number] = [-0.4, -0.6, 0.75];
        const lLen = Math.hypot(...lightDir);
        const L: [number, number, number] = [lightDir[0] / lLen, lightDir[1] / lLen, lightDir[2] / lLen];

        const transformedVerts: [number, number, number][] = D20_VERTICES.map((v) =>
          transformVec(currentRot, v)
        );

        const projected = transformedVerts.map(([x, y, z]) => {
          const pers = 380 / (380 - z * radius * 0.3);
          return {
            px: die.cx + x * radius * pers,
            py: die.cy + y * radius * pers,
            pz: z,
          };
        });

        const faceDepths = D20_FACES.map((face, idx) => {
          const avgZ = (projected[face[0]].pz + projected[face[1]].pz + projected[face[2]].pz) / 3;
          const norm = transformVec(currentRot, FACE_NORMALS[idx]);
          return { idx, face, avgZ, norm, visible: norm[2] > 0.05 };
        });

        faceDepths.sort((a, b) => a.avgZ - b.avgZ);

        for (const item of faceDepths) {
          if (!item.visible) continue;

          const p0 = projected[item.face[0]];
          const p1 = projected[item.face[1]];
          const p2 = projected[item.face[2]];
          const norm = item.norm;

          const dot = Math.max(0, norm[0] * L[0] + norm[1] * L[1] + norm[2] * L[2]);
          const ambient = 0.22;
          const diffuse = dot * 0.68;
          const spec = Math.pow(Math.max(0, (norm[0] * L[0] + norm[1] * L[1] + norm[2] * (L[2] + 1)) / 1.5), 24) * 0.45;
          const light = Math.min(1, ambient + diffuse + spec);

          const r = Math.round(36 + light * 165);
          const g = Math.round(40 + light * 175);
          const b = Math.round(55 + light * 195);

          ctx.beginPath();
          ctx.moveTo(p0.px, p0.py);
          ctx.lineTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.closePath();

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fill();

          ctx.strokeStyle = `rgba(235, 215, 175, ${0.18 + spec * 0.6})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // --- Number rendering: only after die settles, properly on face ---
          if (progress < 0.92) continue; // No numbers while spinning

          const faceVal = D20_FACE_VALUES[item.idx];
          if (norm[2] < 0.15) continue; // Skip faces too edge-on

          // Correct 2D centroid
          const fcx = (p0.px + p1.px + p2.px) / 3;
          const fcy = (p0.py + p1.py + p2.py) / 3;

          // Face "up" direction in screen space for text rotation
          const midX = (p0.px + p1.px) / 2;
          const midY = (p0.py + p1.py) / 2;
          const upDx = p2.px - midX;
          const upDy = p2.py - midY;
          const faceAngle = Math.atan2(upDx, -upDy);

          // Screen-space triangle incircle radius for font scaling
          const triArea = Math.abs(
            (p1.px - p0.px) * (p2.py - p0.py) -
            (p2.px - p0.px) * (p1.py - p0.py)
          ) / 2;
          const edgeA = Math.hypot(p1.px - p0.px, p1.py - p0.py);
          const edgeB = Math.hypot(p2.px - p1.px, p2.py - p1.py);
          const edgeC = Math.hypot(p0.px - p2.px, p0.py - p2.py);
          const semiP = (edgeA + edgeB + edgeC) / 2;
          const inRadius = triArea / semiP;

          const isCenter = norm[2] > 0.85;

          // Clip to triangle
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p0.px, p0.py);
          ctx.lineTo(p1.px, p1.py);
          ctx.lineTo(p2.px, p2.py);
          ctx.closePath();
          ctx.clip();

          ctx.translate(fcx, fcy);
          ctx.rotate(faceAngle);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (isCenter) {
            const isSuccess = roll.success === true || (roll.dc !== null && roll.total >= roll.dc);
            const fontSize = Math.round(Math.min(inRadius * 1.4, radius * 0.42));
            ctx.font = `bold ${fontSize}px 'Cinzel', serif, Georgia`;

            if (die.isCrit20) {
              ctx.fillStyle = "#fffbeb";
              ctx.shadowColor = "#f59e0b";
              ctx.shadowBlur = 20;
            } else if (die.isCrit1 || !isSuccess) {
              ctx.fillStyle = "#fb7185";
              ctx.shadowColor = "#e11d48";
              ctx.shadowBlur = 18;
            } else {
              ctx.fillStyle = "#fef08a";
              ctx.shadowColor = "#eab308";
              ctx.shadowBlur = 16;
            }
            ctx.fillText(String(faceVal), 0, 0);
          } else {
            const fontSize = Math.round(Math.min(inRadius * 1.1, radius * 0.22));
            ctx.font = `bold ${fontSize}px 'Cinzel', serif, Georgia`;
            const alpha = Math.min(0.9, (norm[2] - 0.1) * 1.2);
            ctx.fillStyle = `rgba(200, 210, 230, ${alpha})`;
            ctx.fillText(String(faceVal), 0, 0);
          }

          ctx.restore();
        }

        // Draw strikethrough on discarded die
        if (isDimmed) {
          ctx.beginPath();
          ctx.moveTo(die.cx - radius * 0.6, die.cy - radius * 0.6);
          ctx.lineTo(die.cx + radius * 0.6, die.cy + radius * 0.6);
          ctx.strokeStyle = "rgba(239, 68, 68, 0.75)";
          ctx.lineWidth = 4;
          ctx.stroke();
        }

        ctx.restore();
      }

      if (progress >= 1 && !landingSoundDone) {
        landingSoundDone = true;
        setPhase("landed");
        playBg3Sound("land");
      }

      if (progress >= 1 && elapsed > duration + 500 && !verdictSoundDone) {
        verdictSoundDone = true;
        setPhase("verdict");
        const isSuccess = roll.success === true || (roll.dc !== null && roll.total >= roll.dc);
        const isCrit20 = roll.breakdown.crit === "nat20";
        const isCrit1 = roll.breakdown.crit === "nat1";

        if (isCrit20) {
          playBg3Sound("crit_success");
        } else if (isCrit1) {
          playBg3Sound("crit_fail");
        } else if (isSuccess) {
          playBg3Sound("success");
        } else {
          playBg3Sound("failure");
        }
      }

      if (elapsed < duration + 4800) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
      } else {
        dismiss();
      }
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, [character, extractItemizedBonuses, dismiss]);

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

  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  if (!activeRoll) return null;

  const roll = activeRoll.roll;
  const isSuccess = roll.success === true || (roll.dc !== null && roll.total >= roll.dc);
  const isCritSuccess = roll.breakdown.crit === "nat20";
  const isCritFail = roll.breakdown.crit === "nat1";

  const primaryDiceTerm = roll.breakdown.terms.find((t) => t.kind === "dice" && t.sides === 20);
  const winningDie = primaryDiceTerm && primaryDiceTerm.kind === "dice" ? primaryDiceTerm.dice.find((d) => d.kept) ?? primaryDiceTerm.dice[0] : null;
  const winningVal = winningDie?.value ?? roll.total;

  const headerTitle = roll.dc !== null ? "КЛАСС СЛОЖНОСТИ" : roll.kind === "attack" ? "БРОСОК АТАКИ" : roll.kind === "saving_throw" ? "СПАСБРОСОК" : "ПРОВЕРКА";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md transition-opacity duration-300 animate-fade-in select-none cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-[440px] max-w-[94vw] overflow-hidden rounded-[2.5rem] border border-[#a18146]/55 bg-gradient-to-b from-[#1c1228]/95 via-[#130d1d]/97 to-[#0b0612]/99 p-6 shadow-[0_0_80px_rgba(0,0,0,0.95),0_0_35px_rgba(168,85,247,0.2)] backdrop-blur-xl transition-all duration-400",
          phase === "verdict" && isCritSuccess && "shadow-[0_0_85px_rgba(250,204,21,0.45)] ring-2 ring-amber-400/75",
          phase === "verdict" && (isCritFail || !isSuccess) && "shadow-[0_0_85px_rgba(225,29,72,0.4)] ring-1 ring-rose-500/65"
        )}
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 440 600"
        >
          <defs>
            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f3e5ab" />
              <stop offset="35%" stopColor="#c8a45d" />
              <stop offset="70%" stopColor="#8a6208" />
              <stop offset="100%" stopColor="#d4af37" />
            </linearGradient>
            <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#f59e0b" floodOpacity="0.4" />
            </filter>
          </defs>

          <rect x="8" y="8" width="424" height="584" rx="36" fill="none" stroke="url(#goldGradient)" strokeWidth="1.8" filter="url(#goldGlow)" />
          <rect x="13" y="13" width="414" height="574" rx="31" fill="none" stroke="url(#goldGradient)" strokeWidth="0.8" strokeDasharray="5 3" opacity="0.65" />

          <path d="M 195 8 Q 220 0 245 8 Q 220 16 195 8 Z" fill="url(#goldGradient)" />
          <path d="M 195 592 Q 220 600 245 592 Q 220 584 195 592 Z" fill="url(#goldGradient)" />

          <g stroke="url(#goldGradient)" strokeWidth="1.8" fill="none" opacity="0.85">
            <path d="M 26 50 C 26 34, 34 26, 50 26" />
            <path d="M 414 50 C 414 34, 406 26, 390 26" />
            <path d="M 26 550 C 26 566, 34 574, 50 574" />
            <path d="M 414 550 C 414 566, 406 574, 390 574" />
          </g>
        </svg>

        <div className="relative z-10 flex flex-col items-center">
          {/* Character and Roll detail */}
          <div className="mb-1 text-center">
            <span className="text-xs font-bold tracking-widest text-purple-200/90 uppercase">
              {character?.name ? `${character.name} · ` : ""}
              {roll.detail ? roll.detail.replaceAll("_", " ") : ""}
            </span>
          </div>

          {/* Advantage / Disadvantage badge */}
          {roll.advantage === "advantage" ? (
            <span className="mb-1.5 rounded-full border border-sky-400 bg-sky-950/50 px-3 py-0.5 text-[10px] font-extrabold tracking-widest text-sky-200 uppercase">
              Преимущество (2d20)
            </span>
          ) : roll.advantage === "disadvantage" ? (
            <span className="mb-1.5 rounded-full border border-orange-400 bg-orange-950/50 px-3 py-0.5 text-[10px] font-extrabold tracking-widest text-orange-200 uppercase">
              Помеха (2d20)
            </span>
          ) : null}

          {/* DC Header */}
          <div className="text-center">
            <h3 className="font-serif text-xs font-bold tracking-[0.25em] text-[#d4af37] uppercase">
              {headerTitle}
            </h3>

            {roll.dc !== null ? (
              <div className="my-0.5 font-serif text-5xl font-black tracking-tight text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.7)]">
                {roll.dc}
              </div>
            ) : (
              <div className="my-0.5 font-serif text-3xl font-extrabold tracking-tight text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                {roll.expression}
              </div>
            )}
          </div>

          {/* Ornate Divider */}
          <div className="my-1.5 flex w-full items-center justify-center gap-2 opacity-85">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-[#aa7c11] to-[#f3e5ab]" />
            <svg className="size-4 text-[#d4af37]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" />
            </svg>
            <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-[#aa7c11] to-[#f3e5ab]" />
          </div>

          {/* 3D Canvas */}
          <div className="relative my-1 flex h-[220px] w-full items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-purple-600/15 blur-2xl animate-pulse" />
            <canvas
              ref={canvasRef}
              width={400}
              height={220}
              className="relative z-10 w-full"
            />
          </div>

          {/* Itemized Bonus Breakdown (BG3 Style) */}
          <div className="my-2 w-full px-2">
            {phase === "verdict" || phase === "landed" ? (
              <div className="flex flex-col gap-1.5 animate-fade-in text-xs">
                {/* Winning Die Result */}
                <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-white/5 px-3 py-1.5">
                  <span className="flex items-center gap-2 text-stone-200">
                    🎲 Результат кубика (d20)
                  </span>
                  <span className="font-mono text-sm font-bold text-yellow-300">
                    {winningVal}
                  </span>
                </div>

                {/* Explicit bonuses */}
                {bonuses.map((b, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-white/5 px-3 py-1.5">
                    <span className="flex items-center gap-2 text-stone-300">
                      {b.icon || "🔹"} {b.name}
                    </span>
                    <span className="font-mono text-sm font-bold text-yellow-300">
                      {b.val >= 0 ? `+${b.val}` : b.val}
                    </span>
                  </div>
                ))}

                {/* Total row */}
                <div className="flex items-center justify-between border-t border-amber-500/40 px-3 pt-2 font-bold">
                  <span className="tracking-wider text-amber-200 uppercase">ИТОГ:</span>
                  <span className="font-mono text-lg text-white drop-shadow-md">
                    {roll.total}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-12 items-center justify-center text-xs italic text-amber-200/50 animate-pulse">
                Судьба решает...
              </div>
            )}
          </div>

          {/* Verdict Banner */}
          <div className="min-h-[48px] flex items-center justify-center text-center">
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

          <button
            type="button"
            onClick={dismiss}
            className="mt-2 rounded-full border border-amber-500/30 bg-amber-950/40 px-5 py-1 text-xs text-amber-200/80 transition-colors hover:border-amber-400 hover:bg-amber-900/60 hover:text-amber-100"
          >
            Продолжить (или клик в любом месте)
          </button>
        </div>
      </div>
    </div>
  );
}
