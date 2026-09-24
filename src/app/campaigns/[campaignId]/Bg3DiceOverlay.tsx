"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DiceTerm } from "@/lib/dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { cn } from "@/lib/cn";
import { playBg3Sound } from "@/lib/dice/bg3-audio";
import { useI18n } from "@/lib/i18n";

const DICE_COPY = {
  en: {
    ability: "Ability", dexterity: "Dexterity", strength: "Strength", wisdom: "Wisdom", charisma: "Charisma", intelligence: "Intelligence",
    modifier: "Modifier", proficiency: "Proficiency bonus", penalty: "Penalty / hindrance", die: "Die", primaryDie: "Primary die (d20)", damage: "DAMAGE ROLL", dieBonus: "1d4 bonus",
    guidance: "Guidance", bless: "Bless", bardic: "Bardic Inspiration", hero: "Hero",
    inspirationAction: "*{name} spends an Inspiration point and rerolls the die!*", rollAlert: "🔔 [YOUR ROLL!] Make your check...",
    dc: "DIFFICULTY CLASS", attack: "ATTACK ROLL", save: "SAVING THROW", check: "CHECK", rollTime: "Time to roll:", seconds: "sec",
    advantage: "Advantage (2d20)", disadvantage: "Disadvantage (2d20)", tapDie: "Click the die to roll",
    total: "TOTAL:", noBonus: "A straight roll without modifiers", fate: "Fate decides...", rollDie: "ROLL THE DIE", tap3d: "or click the 3D die",
    criticalSuccess: "★ CRITICAL SUCCESS! ★", criticalFailure: "☠ CRITICAL FAILURE! ☠", success: "SUCCESS!", failure: "FAILURE!",
    reroll: "REROLL WITH INSPIRATION", remaining: "Remaining:", dismiss: "Click anywhere to close", reveal: "Click to reveal the result", closeAfterReveal: "Click again to close",
  },
  ru: {
    ability: "Характеристика", dexterity: "Ловкость", strength: "Сила", wisdom: "Мудрость", charisma: "Харизма", intelligence: "Интеллект",
    modifier: "Модификатор", proficiency: "Бонус мастерства", penalty: "Штраф / помеха", die: "Кубик", primaryDie: "Основной кубик (d20)", damage: "БРОСОК УРОНА", dieBonus: "Бонус 1d4",
    guidance: "Заклинание «Наставление»", bless: "Заклинание «Благословение»", bardic: "Вдохновение барда", hero: "Герой",
    inspirationAction: "*{name} тратит очко Вдохновения и перебрасывает кубик!*", rollAlert: "🔔 [ВАШ БРОСОК!] Сделайте проверку...",
    dc: "КЛАСС СЛОЖНОСТИ", attack: "БРОСОК АТАКИ", save: "СПАСБРОСОК", check: "ПРОВЕРКА", rollTime: "Время на бросок:", seconds: "сек",
    advantage: "Преимущество (2d20)", disadvantage: "Помеха (2d20)", tapDie: "Нажмите на кубик, чтобы бросить",
    total: "ИТОГ:", noBonus: "Чистый бросок без дополнительных модификаторов", fate: "Судьба решает...", rollDie: "БРОСИТЬ КУБИК", tap3d: "или нажмите прямо на 3D кубик",
    criticalSuccess: "★ КРИТИЧЕСКИЙ УСПЕХ! ★", criticalFailure: "☠ КРИТИЧЕСКИЙ ПРОВАЛ! ☠", success: "УСПЕХ!", failure: "НЕУДАЧА!",
    reroll: "ПЕРЕБРОСИТЬ ЗА ВДОХНОВЕНИЕ", remaining: "Осталось:", dismiss: "Нажмите в любое место, чтобы закрыть", reveal: "Нажмите, чтобы показать результат", closeAfterReveal: "Нажмите ещё раз, чтобы закрыть",
  },
} as const;
type DiceCopy = { [K in keyof typeof DICE_COPY.en]: string };

const DIE_CLIP_PATH: Partial<Record<number, string>> = {
  4: "polygon(50% 2%, 98% 92%, 2% 92%)",
  8: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  10: "polygon(50% 0%, 95% 34%, 80% 100%, 20% 100%, 5% 34%)",
  12: "polygon(50% 0%, 98% 35%, 80% 95%, 20% 95%, 2% 35%)",
  100: "circle(50%)",
};

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

// Canonical BG3 orientation: Face 0 is directly in front (normal [0, 0, 1]),
// with horizontal top edge and apex pointing straight down.
const CANONICAL_ROT: [number, number, number][] = [
  [-0.3090708472753448, -0.8090248494677429, 0.4999540021923981],
  [0.7557392923695095, 0.11020644087512578, 0.6455328514943839],
  [-0.5773502691896257, 0.5773502691896257, 0.5773502691896257],
];

function getFaceValuesForRoll(targetVal: number): number[] {
  const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].filter(
    (x) => x !== targetVal
  );
  const values: number[] = [];
  values[0] = targetVal; // Central face is ALWAYS the rolled value!
  for (let i = 1; i < 20; i++) {
    const pickIdx = (i * 7 + targetVal * 3) % others.length;
    values[i] = others.splice(pickIdx, 1)[0];
  }
  return values;
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
  diceLabel?: string;
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
  faceValues: number[];
  randRx: number;
  randRy: number;
  randRz: number;
};

function extractPendingBonuses(
  expression: string,
  kind: string,
  detail: string,
  sheet: CharacterSheet | undefined,
  copy: DiceCopy,
): { bonuses: ItemizedBonus[]; flatMod: number } {
  const list: ItemizedBonus[] = [];
  let flatMod = 0;

  const detailLower = (detail || "").toLowerCase();
  let abilityName = copy.ability;
  if (detailLower.includes("stealth") || detailLower.includes("acrobatics") || detailLower.includes("sleight")) {
    abilityName = copy.dexterity;
  } else if (detailLower.includes("athletics")) {
    abilityName = copy.strength;
  } else if (detailLower.includes("perception") || detailLower.includes("insight") || detailLower.includes("survival") || detailLower.includes("medicine")) {
    abilityName = copy.wisdom;
  } else if (detailLower.includes("persuasion") || detailLower.includes("deception") || detailLower.includes("intimidation") || detailLower.includes("performance")) {
    abilityName = copy.charisma;
  } else if (detailLower.includes("arcana") || detailLower.includes("history") || detailLower.includes("investigation") || detailLower.includes("nature") || detailLower.includes("religion")) {
    abilityName = copy.intelligence;
  }

  const modMatch = /([+-]\s*\d+)$/.exec(expression.replaceAll(" ", ""));
  if (modMatch) {
    flatMod = parseInt(modMatch[1].replaceAll(" ", ""), 10);
    if (sheet && sheet.level) {
      const pb = Math.floor((sheet.level - 1) / 4) + 2;
      if (flatMod >= pb && (kind === "skill_check" || kind === "saving_throw")) {
        list.push({ name: `${copy.modifier} (${abilityName})`, val: flatMod - pb, icon: "🔹" });
        list.push({ name: copy.proficiency, val: pb, icon: "⚔" });
      } else {
        list.push({
          name: flatMod >= 0 ? `${copy.modifier} (${abilityName})` : copy.penalty,
          val: flatMod,
          icon: "🔹",
        });
      }
    } else {
      list.push({
        name: flatMod >= 0 ? `${copy.modifier} (${abilityName})` : copy.penalty,
        val: flatMod,
        icon: "🔹",
      });
    }
  }

  if (sheet?.conditions?.some((c) => c.toLowerCase().includes("guidance"))) {
    list.push({ name: copy.guidance, val: 0, icon: "🙏", diceLabel: "+1d4" });
  }
  if (sheet?.conditions?.some((c) => c.toLowerCase().includes("bless"))) {
    list.push({ name: copy.bless, val: 0, icon: "✨", diceLabel: "+1d4" });
  }
  if (sheet?.conditions?.some((c) => c.toLowerCase().includes("bardic inspiration"))) {
    list.push({ name: copy.bardic, val: 0, icon: "🎵", diceLabel: "+1d6" });
  }

  return { bonuses: list, flatMod };
}

export function Bg3DiceOverlay({
  campaignId,
  pendingRolls = [],
  meUserId = "",
  latestRoll,
  sheets = [],
  enabled = true,
  onDismiss,
}: {
  campaignId?: string;
  pendingRolls?: PendingRoll[];
  meUserId?: string;
  latestRoll: Bg3RollData | null;
  sheets?: CharacterSheet[];
  enabled?: boolean;
  onDismiss?: () => void;
}) {
  const { locale } = useI18n();
  const copy: DiceCopy = DICE_COPY[locale];
  const [activePending, setActivePending] = useState<PendingRoll | null>(null);
  const [activeRoll, setActiveRoll] = useState<Bg3RollData | null>(null);
  const [phase, setPhase] = useState<"idle" | "prompt" | "rolling" | "landed" | "verdict">("idle");
  const [bonuses, setBonuses] = useState<ItemizedBonus[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [reminderActive, setReminderActive] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRerolling, setIsRerolling] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const seenSeqRef = useRef<number>(0);
  const initializedRef = useRef(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const titleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const origTitleRef = useRef<string>("");
  const dismissedPendingIds = useRef<Set<string>>(new Set());
  const submittingRef = useRef<boolean>(false);
  const skipAnimationRef = useRef(false);
  const resultRevealClickedRef = useRef(false);

  if (!initializedRef.current) {
    initializedRef.current = true;
    let initialSeq = latestRoll?.seq ?? 0;
    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem("odm:bg3-last-dismissed-roll-seq");
      if (stored) {
        initialSeq = Number(stored);
      } else if (latestRoll) {
        const rollAgeMs = Date.now() - new Date(latestRoll.roll.createdAt).getTime();
        if (rollAgeMs < 45000) {
          initialSeq = Math.max(0, latestRoll.seq - 1);
        }
      }
    }
    seenSeqRef.current = initialSeq;
  }

  const rollQueueRef = useRef<Bg3RollData[]>([]);

  const targetCharacterId = activeRoll?.roll.characterId || activePending?.characterId;
  const character = sheets.find((s) => s.id === targetCharacterId);

  // Available inspiration points
  const rawInspiration = character?.resources?.inspiration;
  const inspirationCount = rawInspiration
    ? Math.max(0, rawInspiration.max - rawInspiration.used)
    : character?.conditions?.some((c) => c.toLowerCase().includes("inspiration") || c.toLowerCase().includes("inspired"))
      ? 1
      : 0;

  const restoreTitle = useCallback(() => {
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current);
      titleIntervalRef.current = null;
    }
    if (typeof document !== "undefined" && origTitleRef.current) {
      document.title = origTitleRef.current;
    }
  }, []);

  const extractItemizedBonuses = useCallback((roll: StoredRoll, sheet?: CharacterSheet): ItemizedBonus[] => {
    const list: ItemizedBonus[] = [];

    const detailLower = (roll.detail || "").toLowerCase();
    let abilityName: string | null = null;
    if (detailLower.includes("stealth") || detailLower.includes("acrobatics") || detailLower.includes("sleight")) {
      abilityName = copy.dexterity;
    } else if (detailLower.includes("athletics")) {
      abilityName = copy.strength;
    } else if (detailLower.includes("perception") || detailLower.includes("insight") || detailLower.includes("survival") || detailLower.includes("medicine")) {
      abilityName = copy.wisdom;
    } else if (detailLower.includes("persuasion") || detailLower.includes("deception") || detailLower.includes("intimidation") || detailLower.includes("performance")) {
      abilityName = copy.charisma;
    } else if (detailLower.includes("arcana") || detailLower.includes("history") || detailLower.includes("investigation") || detailLower.includes("nature") || detailLower.includes("religion")) {
      abilityName = copy.intelligence;
    }

    for (const term of roll.breakdown.terms) {
      if (term.kind !== "modifier") continue;
      const totalMod = term.sign * term.value;
      const pb = sheet?.level ? Math.floor((sheet.level - 1) / 4) + 2 : 0;
      if (pb > 0 && totalMod >= pb && roll.kind === "skill_check") {
        list.push({ name: abilityName ? `${copy.modifier} (${abilityName})` : copy.modifier, val: totalMod - pb, icon: "🔹" });
        list.push({ name: copy.proficiency, val: pb, icon: "⚔" });
        continue;
      }
      list.push({
        name: totalMod < 0 ? copy.penalty : abilityName && roll.kind !== "damage" ? `${copy.modifier} (${abilityName})` : copy.modifier,
        val: totalMod,
        icon: "🔹",
      });
    }

    return list;
  }, [copy]);

  // --- Start 3D Rolling Animation ---
  const startRollAnimation = useCallback((rollData: Bg3RollData) => {
    skipAnimationRef.current = false;
    resultRevealClickedRef.current = false;
    setActiveRoll(rollData);
    setPhase("rolling");

    const roll = rollData.roll;
    const hasVerdict = roll.success !== null || roll.dc !== null;
    const isSuccess = roll.success ?? (roll.dc !== null && roll.total >= roll.dc);
    const itemized = extractItemizedBonuses(roll, character);
    setBonuses(itemized);

    playBg3Sound("tumble");

    const primaryDiceTerm = roll.breakdown.terms.find((t) => t.kind === "dice" && t.sides === 20);
    const diceResults = primaryDiceTerm?.kind === "dice" ? primaryDiceTerm.dice : [];

    const isMulti = diceResults.length > 1;
    const canvasWidth = 400;
    const canvasHeight = 220;

    const diceSimList: DieSimState[] = diceResults.map((d, idx) => {
      const cx = isMulti ? (canvasWidth * (idx + 1)) / (diceResults.length + 1) : 200;
      const cy = 110;
      const radius = isMulti ? Math.min(74, 140 / diceResults.length) : 92;

      return {
        val: d.value,
        discarded: !d.kept,
        isCrit20: roll.breakdown.crit === "nat20" && d.kept && d.value === 20,
        isCrit1: roll.breakdown.crit === "nat1" && d.kept && d.value === 1,
        cx,
        cy,
        radius,
        targetRot: CANONICAL_ROT,
        faceValues: getFaceValuesForRoll(d.value),
        randRx: (Math.random() * 8 + 14) * Math.PI,
        randRy: (Math.random() * 8 + 16) * Math.PI,
        randRz: (Math.random() * 6 + 12) * Math.PI,
      };
    });

    let lastFrameTime = performance.now();
    let activeElapsed = 0;
    const duration = 2000;
    let landingSoundDone = false;
    let verdictSoundDone = false;

    const renderLoop = (now: number) => {
      if (typeof document !== "undefined" && document.hidden) {
        lastFrameTime = now;
        animFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      const dt = Math.min(100, Math.max(0, now - lastFrameTime));
      lastFrameTime = now;
      activeElapsed += dt;
      if (skipAnimationRef.current) {
        activeElapsed = duration + 3000;
        skipAnimationRef.current = false;
      }

      const progress = Math.min(1, activeElapsed / duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      for (const die of diceSimList) {
        const curRx = die.randRx * (1 - easeOut);
        const curRy = die.randRy * (1 - easeOut);
        const curRz = die.randRz * (1 - easeOut);
        const spinRot = makeEulerMatrix(curRx, curRy, curRz);
        const currentRot = multMatrix(spinRot, die.targetRot);

        let bounceScale = 1.0;
        if (progress >= 1) {
          const dtBounce = activeElapsed - duration;
          bounceScale = 1.0 + 0.12 * Math.exp(-dtBounce * 0.008) * Math.sin(dtBounce * 0.025);
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

          if (progress < 0.92) continue;

          const faceVal = die.faceValues[item.idx];
          if (norm[2] < 0.15) continue;

          const fcx = (p0.px + p1.px + p2.px) / 3;
          const fcy = (p0.py + p1.py + p2.py) / 3;

          const midX = (p0.px + p1.px) / 2;
          const midY = (p0.py + p1.py) / 2;
          const upDx = p2.px - midX;
          const upDy = p2.py - midY;
          const faceAngle = Math.atan2(upDx, -upDy);

          const triArea = Math.abs(
            (p1.px - p0.px) * (p2.py - p0.py) -
            (p2.px - p0.px) * (p1.py - p0.py)
          ) / 2;
          const edgeA = Math.hypot(p1.px - p0.px, p1.py - p0.py);
          const edgeB = Math.hypot(p2.px - p1.px, p2.py - p1.py);
          const edgeC = Math.hypot(p0.px - p2.px, p0.py - p2.py);
          const semiP = (edgeA + edgeB + edgeC) / 2;
          const inRadius = triArea / semiP;

          const isCenter = item.idx === 0 || norm[2] > 0.85;

          ctx.save();
          if (!isCenter) {
            ctx.beginPath();
            ctx.moveTo(p0.px, p0.py);
            ctx.lineTo(p1.px, p1.py);
            ctx.lineTo(p2.px, p2.py);
            ctx.closePath();
            ctx.clip();
          }

          ctx.translate(fcx, fcy);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (isCenter) {
            const fontSize = Math.round(Math.min(inRadius * 1.35, radius * 0.40));
            ctx.font = `900 ${fontSize}px 'Cinzel', serif, Georgia`;

            ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.07));
            ctx.strokeStyle = "rgba(10, 10, 20, 0.9)";
            ctx.strokeText(String(faceVal), 0, 0);

            if (die.isCrit20) {
              ctx.fillStyle = "#fffbeb";
              ctx.shadowColor = "#f59e0b";
              ctx.shadowBlur = 24;
            } else if (die.isCrit1 || (hasVerdict && !isSuccess)) {
              ctx.fillStyle = "#fb7185";
              ctx.shadowColor = "#e11d48";
              ctx.shadowBlur = 22;
            } else {
              ctx.fillStyle = "#fef08a";
              ctx.shadowColor = "#eab308";
              ctx.shadowBlur = 20;
            }
            ctx.fillText(String(faceVal), 0, 0);

            ctx.shadowBlur = 0;
            ctx.fillText(String(faceVal), 0, 0);
          } else {
            ctx.rotate(faceAngle);
            const fontSize = Math.round(Math.min(inRadius * 1.05, radius * 0.20));
            ctx.font = `900 ${fontSize}px 'Cinzel', serif, Georgia`;
            const alpha = Math.min(1.0, Math.max(0.55, (norm[2] - 0.05) * 1.8));
            ctx.fillStyle = `rgba(10, 12, 20, ${alpha.toFixed(2)})`;
            ctx.fillText(String(faceVal), 0, 0);
          }

          ctx.restore();
        }

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

      if (progress >= 1 && activeElapsed > duration + 500 && !verdictSoundDone) {
        verdictSoundDone = true;
        setPhase("verdict");
        const isCrit20 = roll.breakdown.crit === "nat20";
        const isCrit1 = roll.breakdown.crit === "nat1";

        if (isCrit20) {
          playBg3Sound("crit_success");
        } else if (isCrit1) {
          playBg3Sound("crit_fail");
        } else if (hasVerdict && isSuccess) {
          playBg3Sound("success");
        } else if (hasVerdict) {
          playBg3Sound("failure");
        }
      }

      if (activeElapsed < duration + 3000) {
        animFrameRef.current = requestAnimationFrame(renderLoop);
      }
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, [character, extractItemizedBonuses]);

  // --- Idle Floating Loop for Preparation Phase ---
  const startIdleFloatingLoop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const canvasWidth = 400;
    const canvasHeight = 220;
    const radius = 92;

    const idleLoop = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(idleLoop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const cy = 110 + Math.sin(now * 0.0025) * 6;
      const cx = 200;

      const wobbleRx = Math.sin(now * 0.001) * 0.05;
      const wobbleRy = Math.cos(now * 0.0012) * 0.05;
      const spinRot = makeEulerMatrix(wobbleRx, wobbleRy, 0);
      const currentRot = multMatrix(spinRot, CANONICAL_ROT);

      const lightDir: [number, number, number] = [-0.4, -0.6, 0.75];
      const lLen = Math.hypot(...lightDir);
      const L: [number, number, number] = [lightDir[0] / lLen, lightDir[1] / lLen, lightDir[2] / lLen];

      const transformedVerts: [number, number, number][] = D20_VERTICES.map((v) =>
        transformVec(currentRot, v)
      );

      const projected = transformedVerts.map(([x, y, z]) => {
        const pers = 380 / (380 - z * radius * 0.3);
        return {
          px: cx + x * radius * pers,
          py: cy + y * radius * pers,
          pz: z,
        };
      });

      const faceDepths = D20_FACES.map((face, idx) => {
        const avgZ = (projected[face[0]].pz + projected[face[1]].pz + projected[face[2]].pz) / 3;
        const norm = transformVec(currentRot, FACE_NORMALS[idx]);
        return { idx, face, avgZ, norm, visible: norm[2] > 0.05 };
      });

      faceDepths.sort((a, b) => a.avgZ - b.avgZ);

      const faceValues = getFaceValuesForRoll(20);

      for (const item of faceDepths) {
        if (!item.visible) continue;

        const p0 = projected[item.face[0]];
        const p1 = projected[item.face[1]];
        const p2 = projected[item.face[2]];
        const norm = item.norm;

        const dot = Math.max(0, norm[0] * L[0] + norm[1] * L[1] + norm[2] * L[2]);
        const ambient = 0.25;
        const diffuse = dot * 0.65;
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

        ctx.strokeStyle = `rgba(235, 215, 175, ${0.25 + spec * 0.6})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const isCenter = item.idx === 0 || norm[2] > 0.85;
        if (!isCenter) continue;

        const fcx = (p0.px + p1.px + p2.px) / 3;
        const fcy = (p0.py + p1.py + p2.py) / 3;

        ctx.save();
        ctx.translate(fcx, fcy);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const fontSize = Math.round(radius * 0.38);
        ctx.font = `900 ${fontSize}px 'Cinzel', serif, Georgia`;

        ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.07));
        ctx.strokeStyle = "rgba(10, 10, 20, 0.9)";
        ctx.strokeText("20", 0, 0);

        ctx.fillStyle = "#fef08a";
        ctx.shadowColor = "#eab308";
        ctx.shadowBlur = 18;
        ctx.fillText("20", 0, 0);

        ctx.shadowBlur = 0;
        ctx.fillText("20", 0, 0);

        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(idleLoop);
    };

    animFrameRef.current = requestAnimationFrame(idleLoop);
  }, []);

  // --- Dismiss Modal ---
  const dismiss = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    restoreTitle();

    if (activeRoll) {
      try {
        window.sessionStorage.setItem("odm:bg3-last-dismissed-roll-seq", String(activeRoll.seq));
      } catch {}
    }
    if (activePending) {
      dismissedPendingIds.current.add(activePending.id);
    }

    setActiveRoll(null);
    setActivePending(null);
    setPhase("idle");
    setBonuses([]);
    setTimeLeft(60);
    setReminderActive(false);
    submittingRef.current = false;
    setIsSubmitting(false);
    onDismiss?.();

    if (rollQueueRef.current.length > 0) {
      const next = rollQueueRef.current.shift()!;
      startRollAnimation(next);
    }
  }, [activeRoll, activePending, onDismiss, restoreTitle, startRollAnimation]);

  // --- Submit Digital Roll (Click or Auto 60s) ---
  const handleRollSubmit = useCallback(async () => {
    if (submittingRef.current || !activePending || !campaignId) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    restoreTitle();

    playBg3Sound("tumble");
    setPhase("rolling");

    try {
      await fetch(`/api/campaigns/${campaignId}/pending-rolls/${activePending.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallback: "digital" }),
      });
    } catch (err) {
      console.error("Failed to submit digital roll:", err);
    }
  }, [activePending, campaignId, restoreTitle]);

  // --- Reroll with Inspiration ---
  const handleInspirationReroll = useCallback(async () => {
    if (!campaignId || isRerolling) return;
    setIsRerolling(true);
    playBg3Sound("inspire_buff");

    try {
      await fetch(`/api/campaigns/${campaignId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "do",
          content: copy.inspirationAction.replace("{name}", character?.name || copy.hero),
        }),
      });

      if (character?.resources?.inspiration) {
        const updatedRes = {
          ...character.resources,
          inspiration: {
            ...character.resources.inspiration,
            used: character.resources.inspiration.used + 1,
          },
        };
        await fetch(`/api/campaigns/${campaignId}/sheet`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resources: updatedRes }),
        });
      }

      const expr = activeRoll?.roll.expression || activePending?.expression || "1d20";
      setPhase("rolling");
      playBg3Sound("tumble");

      await fetch(`/api/campaigns/${campaignId}/rolls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: expr }),
      });
    } catch (err) {
      console.error("Failed to reroll with inspiration:", err);
    } finally {
      setIsRerolling(false);
    }
  }, [campaignId, isRerolling, character, activeRoll, activePending, copy]);

  // --- Watch for Incoming Pending Rolls for Active Player ---
  useEffect(() => {
    if (!enabled || !meUserId) return;
    const myPending = pendingRolls.find((p) => p.userId === meUserId);
    if (!myPending || dismissedPendingIds.current.has(myPending.id)) return;

    if (phase === "idle" && !activeRoll) {
      setActivePending(myPending);
      setPhase("prompt");
      setTimeLeft(60);
      setReminderActive(false);
      submittingRef.current = false;
      setIsSubmitting(false);

      const targetChar = sheets.find((s) => s.id === myPending.characterId);
      const parsedBonuses = extractPendingBonuses(
        myPending.expression,
        myPending.kind,
        myPending.detail,
        targetChar,
        copy,
      );
      setBonuses(parsedBonuses.bonuses);

      playBg3Sound("bell_prompt");

      if (typeof document !== "undefined") {
        origTitleRef.current = document.title;
        let step = 0;
        titleIntervalRef.current = setInterval(() => {
          document.title = step++ % 2 === 0 ? copy.rollAlert : origTitleRef.current;
        }, 1500);
      }

      countdownIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
            void handleRollSubmit();
            return 0;
          }
          if (prev === 31) {
            playBg3Sound("bell_reminder");
            setReminderActive(true);
          }
          return prev - 1;
        });
      }, 1000);

      if (/\d+d20/i.test(myPending.expression)) startIdleFloatingLoop();
    }
  }, [pendingRolls, meUserId, enabled, phase, activeRoll, sheets, handleRollSubmit, startIdleFloatingLoop, copy]);

  // --- Watch for Passive or Resolved Rolls ---
  useEffect(() => {
    if (!latestRoll || !enabled) return;
    if (latestRoll.seq <= seenSeqRef.current) return;
    seenSeqRef.current = latestRoll.seq;

    if (typeof document !== "undefined" && document.hidden) {
      rollQueueRef.current.push(latestRoll);
      return;
    }

    if (phase === "rolling") {
      startRollAnimation(latestRoll);
    } else if (phase === "idle" && !activePending) {
      startRollAnimation(latestRoll);
    } else {
      rollQueueRef.current.push(latestRoll);
    }
  }, [latestRoll, enabled, phase, activePending, startRollAnimation]);

  // Handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === "undefined" || document.hidden) return;
      if (!activeRoll && rollQueueRef.current.length > 0) {
        const next = rollQueueRef.current.shift()!;
        startRollAnimation(next);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [activeRoll, startRollAnimation]);

  // Keybindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((phase === "verdict" || phase === "landed") && (e.key === "Escape" || e.key === " ")) {
        e.preventDefault();
        dismiss();
      } else if (phase === "prompt" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        void handleRollSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, dismiss, handleRollSubmit]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      restoreTitle();
    };
  }, [restoreTitle]);

  if (phase === "idle" && !activeRoll && !activePending) return null;

  const roll = activeRoll?.roll;
  const hasVerdict = !!roll && (roll.success !== null || roll.dc !== null);
  const isSuccess = roll ? roll.success ?? (roll.dc !== null && roll.total >= roll.dc) : false;
  const isCritSuccess = roll?.breakdown.crit === "nat20";
  const isCritFail = roll?.breakdown.crit === "nat1";

  const diceTerms = roll?.breakdown.terms.filter((term): term is DiceTerm => term.kind === "dice") ?? [];
  const primaryDiceTerm = diceTerms.find((term) => term.sides === 20);

  const activeDc = activeRoll?.roll.dc ?? activePending?.dc ?? null;
  const activeExpression = activeRoll?.roll.expression ?? activePending?.expression ?? "1d20";
  const activeDetail = activeRoll?.roll.detail ?? activePending?.detail ?? "";
  const activeKind = activeRoll?.roll.kind ?? activePending?.kind ?? "check";
  const activeAdvantage = activeRoll?.roll.advantage ?? activePending?.advantage ?? "none";
  const activeReason = activePending?.reason ?? "";

  const promptHasD20 = /\d+d20/i.test(activeExpression);
  const headerTitle = activeKind === "damage" ? copy.damage : activeDc !== null ? copy.dc : activeKind === "attack" ? copy.attack : activeKind === "saving_throw" ? copy.save : copy.check;

  const handleCardClick = (e: React.MouseEvent) => {
    if (phase === "prompt") {
      e.stopPropagation();
      return;
    }
    if ((phase === "rolling" || phase === "landed") && !resultRevealClickedRef.current) {
      resultRevealClickedRef.current = true;
      skipAnimationRef.current = true;
      return;
    }
    dismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleCardClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300 animate-fade-in select-none cursor-pointer"
    >
      <div
        onClick={(e) => {
          if (phase === "prompt") {
            e.stopPropagation();
          }
        }}
        className={cn(
          "relative w-[440px] max-w-[94vw] overflow-hidden rounded-[2.5rem] border border-[#a18146]/55 bg-gradient-to-b from-[#1c1228]/95 via-[#130d1d]/97 to-[#0b0612]/99 p-6 shadow-[0_0_80px_rgba(0,0,0,0.95),0_0_35px_rgba(168,85,247,0.2)] backdrop-blur-xl transition-all duration-400",
          phase === "verdict" && isCritSuccess && "shadow-[0_0_85px_rgba(250,204,21,0.45)] ring-2 ring-amber-400/75",
          phase === "verdict" && (isCritFail || (hasVerdict && !isSuccess)) && "shadow-[0_0_85px_rgba(225,29,72,0.4)] ring-1 ring-rose-500/65"
        )}
      >
        {/* SVG Filigree Frame */}
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
          {/* 60-Second Countdown Timer Bar (in Prompt Mode) */}
          {phase === "prompt" ? (
            <div className="mb-2 w-full px-1">
              <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-amber-200/90">
                  <span className="inline-block size-2 rounded-full bg-amber-400 animate-ping" />
                  {copy.rollTime}
                </span>
                <span className={cn("font-mono font-bold tracking-wider", timeLeft <= 30 ? "text-rose-400 animate-pulse" : "text-amber-300")}>
                  {timeLeft} {copy.seconds}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-stone-900/80 border border-amber-500/30">
                <div
                  className={cn(
                    "h-full transition-all duration-1000 ease-linear rounded-full",
                    timeLeft <= 30
                      ? "bg-gradient-to-r from-rose-500 to-amber-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]"
                      : "bg-gradient-to-r from-[#aa7c11] via-[#d4af37] to-[#f3e5ab] shadow-[0_0_10px_rgba(212,175,55,0.5)]"
                  )}
                  style={{ width: `${(timeLeft / 60) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* Character and Roll detail */}
          <div className="mb-1 text-center">
            <span className="text-xs font-bold tracking-widest text-purple-200/90 uppercase">
              {character?.name ? `${character.name} · ` : ""}
              {activeDetail ? activeDetail.replaceAll("_", " ") : ""}
            </span>
          </div>

          {activeReason ? (
            <div className="mb-1 text-center text-xs italic text-amber-100/70">
              «{activeReason}»
            </div>
          ) : null}

          {/* Advantage / Disadvantage badge */}
          {activeAdvantage === "advantage" ? (
            <span className="mb-1.5 rounded-full border border-sky-400 bg-sky-950/50 px-3 py-0.5 text-[10px] font-extrabold tracking-widest text-sky-200 uppercase">
              {copy.advantage}
            </span>
          ) : activeAdvantage === "disadvantage" ? (
            <span className="mb-1.5 rounded-full border border-orange-400 bg-orange-950/50 px-3 py-0.5 text-[10px] font-extrabold tracking-widest text-orange-200 uppercase">
              {copy.disadvantage}
            </span>
          ) : null}

          {/* DC Header */}
          <div className="text-center">
            <h3 className="font-serif text-xs font-bold tracking-[0.25em] text-[#d4af37] uppercase">
              {headerTitle}
            </h3>

            {activeDc !== null ? (
              <div className="my-0.5 font-serif text-5xl font-black tracking-tight text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.7)]">
                {activeDc}
              </div>
            ) : (
              <div className="my-0.5 font-serif text-3xl font-extrabold tracking-tight text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]">
                {activeExpression}
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
          <div
            onClick={phase === "prompt" ? handleRollSubmit : undefined}
            className={cn(
              "relative my-1 flex h-[220px] w-full items-center justify-center group",
              phase === "prompt" && "cursor-pointer"
            )}
            title={phase === "prompt" ? copy.tapDie : undefined}
          >
            <div
              className={cn(
                "absolute inset-0 rounded-full bg-purple-600/15 blur-2xl transition-all duration-300",
                phase === "prompt" && "group-hover:bg-amber-500/25 group-hover:scale-110",
                reminderActive && "bg-amber-500/30 animate-pulse"
              )}
            />
            <canvas
              ref={canvasRef}
              width={400}
              height={220}
              className={cn("relative z-10 w-full", (phase === "prompt" && !promptHasD20) || (phase !== "prompt" && roll && !primaryDiceTerm) ? "hidden" : "")}
            />
            {phase === "prompt" && !promptHasD20 ? (
              <div className="relative z-10 rounded-2xl border border-amber-500/30 bg-[#1c1228]/80 px-6 py-4 font-mono text-2xl font-bold text-amber-200">
                🎲 {activeExpression}
              </div>
            ) : phase !== "prompt" && roll && !primaryDiceTerm ? (
              <div className="no-scrollbar relative z-10 flex max-h-[205px] w-full flex-wrap items-center justify-center gap-3 overflow-y-auto px-2">
                {diceTerms.map((term, termIndex) => (
                  <div key={`${termIndex}-${term.sides}`} className="flex flex-col items-center gap-1">
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {term.dice.map((die, dieIndex) => {
                        const clipPath = DIE_CLIP_PATH[term.sides];
                        return (
                          <div
                            key={`${termIndex}-${dieIndex}`}
                            aria-label={phase === "rolling" ? `d${term.sides}` : `d${term.sides}: ${die.value}`}
                            className={cn(
                              "relative flex size-14 flex-col items-center justify-center text-slate-950 drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]",
                              clipPath ? "bg-amber-400/60" : "rounded-xl border border-amber-400/50 bg-gradient-to-b from-slate-200 to-slate-400",
                              !die.kept && "opacity-40 line-through",
                            )}
                            style={clipPath ? { clipPath } : undefined}
                          >
                            {clipPath ? <span className="absolute inset-[1px] bg-gradient-to-b from-slate-200 to-slate-400" style={{ clipPath }} /> : null}
                            <span className={cn("relative text-[10px] font-bold uppercase text-slate-700", term.sides === 4 && "translate-y-1")}>d{term.sides}</span>
                            <span className={cn("relative font-mono text-xl font-black", term.sides === 4 && "translate-y-1")}>
                              {phase === "rolling" ? "?" : die.rerolledFrom === undefined ? die.value : `${die.rerolledFrom}→${die.value}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {term.dice.length > 1 ? (
                      <span className="font-mono text-xs font-semibold text-amber-100/80">
                        {term.sign < 0 ? "−" : "+"}{term.subtotal}
                      </span>
                    ) : null}
                  </div>
                ))}
                {diceTerms.length === 0 ? <span className="font-mono text-xl text-amber-200">{activeExpression}</span> : null}
              </div>
            ) : null}
          </div>

          {/* Itemized Bonus Breakdown */}
          <div className="my-2 w-full px-2">
            {phase === "verdict" || phase === "landed" ? (
              <div className="flex flex-col gap-1.5 animate-fade-in text-xs">
                {primaryDiceTerm ? diceTerms.map((term, termIndex) => (
                  <div key={`${termIndex}-${term.sides}`} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-white/5 px-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2 text-stone-200">
                      <span className="shrink-0">{term.sides === 20 ? copy.primaryDie : `${copy.die} (d${term.sides})`}</span>
                      <span className="flex flex-wrap gap-1 font-mono text-sm font-bold text-yellow-300">
                        {term.dice.map((die, dieIndex) => (
                          <span key={dieIndex} className={cn("rounded bg-black/25 px-1.5", !die.kept && "opacity-40 line-through")}>
                            {die.rerolledFrom === undefined ? die.value : `${die.rerolledFrom}→${die.value}`}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 pl-2 font-mono text-sm font-bold text-yellow-300">
                      {term.sides === 20 && term.sign > 0 ? term.subtotal : `${term.sign < 0 ? "−" : "+"}${term.subtotal}`}
                    </span>
                  </div>
                )) : null}

                {bonuses.map((b, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-white/5 px-3 py-1.5">
                    <span className="flex items-center gap-2 text-stone-300">
                      {b.icon || "🔹"} {b.name}
                    </span>
                    <span className="font-mono text-sm font-bold text-yellow-300">
                      {b.diceLabel || (b.val >= 0 ? `+${b.val}` : b.val)}
                    </span>
                  </div>
                ))}

                <div className="flex items-center justify-between border-t border-amber-500/40 px-3 pt-2 font-bold">
                  <span className="tracking-wider text-amber-200 uppercase">{copy.total}</span>
                  <span className="font-mono text-lg text-white drop-shadow-md">
                    {roll?.total ?? "—"}
                  </span>
                </div>
              </div>
            ) : phase === "prompt" ? (
              <div className="flex flex-col gap-1.5 animate-fade-in text-xs">
                {bonuses.length > 0 ? (
                  bonuses.map((b, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-white/5 px-3 py-1.5">
                      <span className="flex items-center gap-2 text-stone-300">
                        {b.icon || "🔹"} {b.name}
                      </span>
                      <span className="font-mono text-sm font-bold text-yellow-300">
                        {b.diceLabel || (b.val >= 0 ? `+${b.val}` : b.val)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center italic text-stone-400 text-xs py-1">
                    {copy.noBonus}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-12 items-center justify-center text-xs italic text-amber-200/50 animate-pulse">
                {copy.fate}
              </div>
            )}
          </div>

          {/* Interactive CTA Button (in Prompt Phase) */}
          {phase === "prompt" ? (
            <div className="w-full px-2 mt-1">
              <button
                type="button"
                onClick={handleRollSubmit}
                disabled={isSubmitting}
                className={cn(
                  "group relative w-full overflow-hidden rounded-2xl border border-[#d4af37]/70 bg-gradient-to-b from-[#3a274e] via-[#241733] to-[#120a1d] px-6 py-3.5 font-serif text-base font-bold tracking-widest text-[#f3e5ab] uppercase shadow-[0_4px_20px_rgba(0,0,0,0.6),0_0_20px_rgba(212,175,55,0.25)] transition-all duration-300 hover:border-[#f3e5ab] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] hover:scale-[1.02] active:scale-[0.98]",
                  reminderActive && "animate-pulse ring-2 ring-amber-400 border-amber-300 shadow-[0_0_35px_rgba(245,158,11,0.8)]"
                )}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <span className="text-xl">🎲</span>
                  <span>{copy.rollDie}</span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              </button>
              <div className="mt-1.5 text-center text-[10px] text-amber-200/50 uppercase tracking-widest">
                {copy.tap3d}
              </div>
            </div>
          ) : null}

          {/* Verdict Banner */}
          <div className="min-h-[48px] flex items-center justify-center text-center">
            {phase === "verdict" && (hasVerdict || isCritSuccess || isCritFail) ? (
              <div className="animate-scale-in">
                {isCritSuccess ? (
                  <div className="font-serif text-2xl font-black tracking-widest text-amber-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.9)] uppercase">
                    {copy.criticalSuccess}
                  </div>
                ) : isCritFail ? (
                  <div className="font-serif text-2xl font-black tracking-widest text-rose-600 drop-shadow-[0_0_20px_rgba(225,29,72,0.9)] uppercase">
                    {copy.criticalFailure}
                  </div>
                ) : isSuccess ? (
                  <div className="font-serif text-3xl font-black tracking-widest text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.8)] uppercase">
                    {copy.success}
                  </div>
                ) : (
                  <div className="font-serif text-3xl font-black tracking-widest text-rose-500 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)] uppercase">
                    {copy.failure}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Inspiration Reroll Button (on Failure) */}
          {phase === "verdict" && hasVerdict && !isSuccess && !isCritSuccess && inspirationCount > 0 ? (
            <div className="w-full px-2 mt-2">
              <button
                type="button"
                onClick={handleInspirationReroll}
                disabled={isRerolling}
                className="group relative w-full overflow-hidden rounded-2xl border border-purple-400/80 bg-gradient-to-b from-purple-900/90 via-purple-950/95 to-[#120a1d] px-5 py-3 font-serif text-sm font-extrabold tracking-widest text-purple-200 uppercase shadow-[0_0_25px_rgba(168,85,247,0.4)] transition-all duration-300 hover:border-purple-300 hover:shadow-[0_0_35px_rgba(192,132,252,0.6)] hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="relative z-10 flex items-center justify-center gap-2 text-yellow-300">
                  <span>★</span>
                  <span>{copy.reroll}</span>
                  <span className="rounded-full bg-purple-800/80 px-2 py-0.5 text-xs text-purple-100 border border-purple-400/40">
                    {copy.remaining} {inspirationCount}
                  </span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-400/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              </button>
            </div>
          ) : null}

          {/* Dismiss hint */}
          {(phase === "verdict" || phase === "landed") ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCardClick(e);
              }}
              className="mt-3 text-center text-xs tracking-widest text-amber-200/60 hover:text-amber-200 uppercase transition-colors"
            >
              {phase === "landed" ? copy.reveal : resultRevealClickedRef.current ? copy.closeAfterReveal : copy.dismiss}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
