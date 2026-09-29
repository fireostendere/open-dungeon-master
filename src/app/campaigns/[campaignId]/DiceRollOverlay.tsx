"use client";

// Full-screen dice roll: who throws, at what, against what — then real 3D
// dice land on the server's result, the bonuses add up, and the verdict hits.
//
// Flow: prompt (my pending roll: dice hover, 60s timer) → rolling (dice in
// the air; the stage lands them on the server's faces) → landed (chips and
// the total count up) → verdict (success / crit / fumble / damage effects).

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DiceTerm } from "@/lib/dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { DICE_PALETTES, type DicePaletteId } from "@/lib/fx/dice/atlas";
import type { DiceStage, StageDie } from "@/lib/fx/dice/stage";
import { Bursts, FIREWORK_COLORS } from "@/lib/fx/particles";
import * as sfx from "@/lib/fx/sound";
import { FxIcon } from "@/components/fx/icons";
import { describeRoll, type ContextEnemy, type RollContext, type RollIcon } from "@/components/fx/roll-context";
import { diceTerms, stageExpression, stageRoll, type StagedRoll } from "@/components/fx/roll-dice";
import { FxTitle, useFxCanvas, useReducedMotion } from "@/components/fx/shared";

const COPY = {
  en: {
    kinds: { attack: "Attack roll", damage: "Damage", skill: "Skill check", save: "Saving throw", ability: "Ability check", initiative: "Initiative", death: "Death save", custom: "Roll" } as Record<RollIcon, string>,
    you: "Your roll",
    ally: "Ally",
    enemy: "Enemy",
    dm: "Dungeon Master",
    hero: "Hero",
    asks: "The DM asks",
    dcLabel: "Difficulty",
    dcHint: "Roll {dc} or higher to succeed",
    acLabel: "Target's armour",
    acHidden: "Hits if the total reaches the target's armour class",
    acKnown: "Hits on {ac} or higher",
    acHit: "{total} got through the armour",
    acMiss: "{total} did not get through the armour",
    acCrit: "A natural 20 always hits",
    acFumble: "A natural 1 always misses",
    acTooltip: "Armour class (AC): how hard the target is to hit. Only the DM knows it; the roll shows whether your total reached it.",
    need: "need {n}",
    armor: "target's armor",
    total: "Total",
    die: "d{n}",
    more: "+{n} more",
    rollDie: "Roll the dice",
    orTap: "or tap the dice",
    timeLeft: "{n}s",
    reroll: "Reroll with Inspiration",
    remaining: "left: {n}",
    reveal: "Tap to reveal",
    dismiss: "Tap anywhere to close",
    skin: "Dice skin",
    modifier: "Modifier",
    penalty: "Penalty",
    advantage: "Advantage",
    disadvantage: "Disadvantage",
    damageTo: "damage",
    health: { healthy: "unhurt", wounded: "wounded", bloodied: "bloodied", "near death": "near death", dead: "dead" } as Record<string, string>,
    verdict: {
      success: "Success", fail: "Failure", crit: "Critical success", fumble: "Critical failure",
      hit: "Hit!", miss: "Miss", critHit: "Critical hit!", critMiss: "Critical miss",
      deathOk: "Holding on", deathFail: "Slipping away", deathCrit: "Back on their feet!", deathFumble: "Two failures",
      initiative: "Initiative {n}",
    },
    inspirationAction: "*{name} spends Inspiration and rerolls the die!*",
    rollAlert: "🔔 [YOUR ROLL!] Make your check...",
  },
  ru: {
    kinds: { attack: "Бросок атаки", damage: "Урон", skill: "Проверка навыка", save: "Спасбросок", ability: "Проверка характеристики", initiative: "Инициатива", death: "Спасбросок от смерти", custom: "Бросок" } as Record<RollIcon, string>,
    you: "Ваш бросок",
    ally: "Союзник",
    enemy: "Враг",
    dm: "Мастер",
    hero: "Герой",
    asks: "Мастер просит",
    dcLabel: "Сложность",
    dcHint: "Нужно выбросить {dc} или больше",
    acLabel: "Доспех цели",
    acHidden: "Попадание, если итог не ниже доспеха цели",
    acKnown: "Попадание при {ac} или больше",
    acHit: "Итог {total} пробил доспех",
    acMiss: "Итог {total} не пробил доспех",
    acCrit: "Натуральная 20 попадает всегда",
    acFumble: "Натуральная 1 всегда мимо",
    acTooltip: "Класс доспеха (КД): насколько трудно попасть по цели. Его знает только Мастер; бросок показывает, дотянул ли ваш итог.",
    need: "нужно {n}",
    armor: "доспеха цели",
    total: "Итог",
    die: "к{n}",
    more: "+{n} ещё",
    rollDie: "Бросить кости",
    orTap: "или нажмите на кубик",
    timeLeft: "{n} с",
    reroll: "Перебросить за вдохновение",
    remaining: "осталось: {n}",
    reveal: "Нажмите, чтобы показать",
    dismiss: "Нажмите, чтобы закрыть",
    skin: "Цвет костей",
    modifier: "Модификатор",
    penalty: "Штраф",
    advantage: "Преимущество",
    disadvantage: "Помеха",
    damageTo: "урона",
    health: { healthy: "цел", wounded: "ранен", bloodied: "в крови", "near death": "при смерти", dead: "мёртв" } as Record<string, string>,
    verdict: {
      success: "Успех", fail: "Провал", crit: "Критический успех", fumble: "Критический провал",
      hit: "Попадание!", miss: "Промах", critHit: "Критическое попадание!", critMiss: "Критический промах",
      deathOk: "Держится", deathFail: "Жизнь ускользает", deathCrit: "Встаёт на ноги!", deathFumble: "Два провала",
      initiative: "Инициатива {n}",
    },
    inspirationAction: "*{name} тратит очко Вдохновения и перебрасывает кубик!*",
    rollAlert: "🔔 [ВАШ БРОСОК!] Сделайте проверку...",
  },
};
type Copy = (typeof COPY)["en"];

const ABILITY_NAMES: Record<string, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

const SKIN_KEY = "odm:dice-skin";
const DISMISSED_KEY = "odm:bg3-last-dismissed-roll-seq";
const SKINS: DicePaletteId[] = ["arcane", "crimson", "frost", "verdant", "bone", "gilded"];

export type DiceRollData = { roll: StoredRoll; source?: string; seq: number };

type Phase = "idle" | "rolling" | "landed" | "verdict";
type View = { active: DiceRollData | null; phase: Phase };
type ViewAction =
  | { type: "start"; roll: DiceRollData }
  | { type: "phase"; phase: Phase }
  | { type: "await" }
  | { type: "dismiss" };

function viewReducer(state: View, action: ViewAction): View {
  switch (action.type) {
    case "start":
      return { active: action.roll, phase: "rolling" };
    case "phase":
      return { ...state, phase: action.phase };
    case "await":
      // Dice in the air, waiting for the server's next roll_result.
      return { active: null, phase: "rolling" };
    case "dismiss":
      return { active: null, phase: "idle" };
  }
}

type Chip = { key: string; label: string; value: string; dropped?: boolean; negative?: boolean; die?: boolean; add: number };

type Verdict = "success" | "fail" | "crit" | "fumble" | "damage" | "initiative" | "neutral";

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

function verdictFor(roll: StoredRoll, icon: RollIcon): Verdict {
  const crit = roll.breakdown.crit;
  const hasVerdict = roll.success !== null || roll.dc !== null;
  const ok = roll.success ?? (roll.dc !== null && roll.total >= roll.dc);
  if (crit === "nat20" && roll.success !== false) return "crit";
  if (crit === "nat1" && roll.success !== true) return "fumble";
  if (icon === "damage") return "damage";
  if (icon === "initiative") return "initiative";
  if (!hasVerdict) return "neutral";
  return ok ? "success" : "fail";
}

function verdictText(v: Verdict, icon: RollIcon, total: number, copy: Copy): string {
  const t = copy.verdict;
  if (icon === "attack") return v === "crit" ? t.critHit : v === "fumble" ? t.critMiss : v === "success" ? t.hit : t.miss;
  if (icon === "death") return v === "crit" ? t.deathCrit : v === "fumble" ? t.deathFumble : v === "success" ? t.deathOk : t.deathFail;
  if (v === "initiative") return fmt(t.initiative, { n: total });
  return v === "crit" ? t.crit : v === "fumble" ? t.fumble : v === "success" ? t.success : t.fail;
}

function buildChips(roll: StoredRoll, copy: Copy, hidden: number): Chip[] {
  const chips: Chip[] = [];
  diceTerms(roll.breakdown).forEach((term: DiceTerm, ti) => {
    // Kept dice add up in one chip; dice dropped by advantage get their own,
    // struck-through chip right after it.
    const kept = term.dice.filter((d) => d.kept);
    const label = kept.length > 1 ? `${kept.length}${fmt(copy.die, { n: term.sides })}` : fmt(copy.die, { n: term.sides });
    const value = kept
      .map((d) => (d.rerolledFrom === undefined ? String(d.value) : `${d.rerolledFrom}→${d.value}`))
      .join(kept.length > 3 ? "+" : " · ");
    const sum = kept.reduce((a, d) => a + d.value, 0) * term.sign;
    chips.push({ key: `d${ti}`, label, value, die: true, add: sum, negative: term.sign < 0 });
    term.dice.forEach((d, di) => {
      if (!d.kept) chips.push({ key: `x${ti}-${di}`, label: fmt(copy.die, { n: term.sides }), value: String(d.value), dropped: true, die: true, add: 0 });
    });
  });
  if (hidden > 0) chips.push({ key: "hidden", label: fmt(copy.more, { n: hidden }), value: "", add: 0 });
  // One chip per modifier term: the engine does not say which part is the
  // ability and which is proficiency, so the overlay does not guess.
  roll.breakdown.terms.forEach((term, i) => {
    if (term.kind !== "modifier") return;
    const v = term.sign * term.value;
    chips.push({ key: `m${i}`, label: v < 0 ? copy.penalty : copy.modifier, value: v < 0 ? String(v) : `+${v}`, negative: v < 0, add: v });
  });
  return chips;
}

function readSkin(): DicePaletteId {
  if (typeof window === "undefined") return "arcane";
  try {
    const v = window.localStorage.getItem(SKIN_KEY);
    if (v && v in DICE_PALETTES) return v as DicePaletteId;
  } catch {
    // Default skin.
  }
  return "arcane";
}

async function defaultSubmit(campaignId: string, pending: PendingRoll) {
  await fetch(`/api/campaigns/${campaignId}/pending-rolls/${pending.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fallback: "digital" }),
  });
}

async function defaultReroll(campaignId: string, sheet: CharacterSheet | undefined, expression: string, action: string) {
  await fetch(`/api/campaigns/${campaignId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "do", content: action }),
  });
  if (sheet?.resources?.inspiration) {
    await fetch(`/api/campaigns/${campaignId}/sheet`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resources: { ...sheet.resources, inspiration: { ...sheet.resources.inspiration, used: sheet.resources.inspiration.used + 1 } },
      }),
    });
  }
  await fetch(`/api/campaigns/${campaignId}/rolls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
  });
}

export function DiceRollOverlay({
  campaignId,
  pendingRolls = [],
  meUserId = "",
  latestRoll,
  sheets = [],
  enemies = [],
  enabled = true,
  onDismiss,
  submitPending,
  rerollWithInspiration,
  persistDismissed = true,
}: {
  campaignId?: string;
  pendingRolls?: PendingRoll[];
  meUserId?: string;
  latestRoll: DiceRollData | null;
  sheets?: CharacterSheet[];
  enemies?: ContextEnemy[];
  enabled?: boolean;
  onDismiss?: () => void;
  /** Seams for the animations lab; the game talks to the campaign API. */
  submitPending?: (pending: PendingRoll) => Promise<void>;
  rerollWithInspiration?: (expression: string, action: string) => Promise<void>;
  persistDismissed?: boolean;
}) {
  const { locale, t } = useI18n();
  const copy: Copy = COPY[locale] ?? COPY.en;
  const reducedMotion = useReducedMotion();
  const [view, dispatch] = useReducer(viewReducer, { active: null, phase: "idle" });
  const [submitted, setSubmitted] = useState<PendingRoll | null>(null);
  const [dismissedPending, setDismissedPending] = useState<Set<string>>(() => new Set());
  const [countdown, setCountdown] = useState<{ id: string; seconds: number } | null>(null);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [rerolling, setRerolling] = useState(false);
  const [skin, setSkinState] = useState<DicePaletteId>(readSkin);
  const [chipsShown, setChipsShown] = useState(0);
  const [shownTotal, setShownTotal] = useState<number | null>(null);
  const [tickKey, setTickKey] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [stageState, setStageState] = useState<"none" | "loading" | "ready" | "failed">("none");
  const [targetHit, setTargetHit] = useState(0);
  const [hiddenDice, setHiddenDice] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const medalRef = useRef<HTMLDivElement | null>(null);
  const totalRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<DiceStage | null>(null);
  const stagedRef = useRef<StagedRoll | null>(null);
  const queueRef = useRef<DiceRollData[]>([]);
  const seenSeqRef = useRef(0);
  const initRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const submittingRef = useRef(false);
  const skipRef = useRef(false);
  const pendingThrowRef = useRef<(() => void) | null>(null);
  const titleTimerRef = useRef<number | null>(null);
  const origTitleRef = useRef("");

  const particlesRef = useFxCanvas(particleCanvasRef);

  const pendingPrompt =
    view.phase === "idle" && !view.active && enabled && meUserId
      ? pendingRolls.find((p) => p.userId === meUserId && !dismissedPending.has(p.id)) ?? null
      : null;
  const activePending = submitted ?? pendingPrompt;
  const phase: Phase | "prompt" = view.phase === "idle" && pendingPrompt ? "prompt" : view.phase;
  const visible = phase !== "idle";
  const roll = view.active?.roll ?? null;

  const characterId = roll?.characterId ?? activePending?.characterId ?? null;
  const sheet = sheets.find((s) => s.id === characterId);

  const context: RollContext | null = useMemo(() => {
    const src = roll
      ? { kind: roll.kind, detail: roll.detail, dc: roll.dc, characterId: roll.characterId, requestedBy: roll.requestedBy, targetEnemyId: roll.targetEnemyId, reason: activePending?.reason ?? null }
      : activePending
        ? { kind: activePending.kind, detail: activePending.detail, dc: activePending.dc, characterId: activePending.characterId, requestedBy: "dm" as const, reason: activePending.reason }
        : null;
    if (!src) return null;
    return describeRoll(src, {
      sheets,
      enemies,
      meUserId,
      mySkin: skin,
      locale: {
        skill: (id) => {
          const v = t(`sheet.skills.${id}`);
          return v === `sheet.skills.${id}` ? undefined : v;
        },
        ability: (id) => {
          // Full names ("Dexterity"), not the sheet's three-letter tags.
          const full = ABILITY_NAMES[id] ?? id;
          const v = t(`sheet.abilities.${full}`);
          return v === `sheet.abilities.${full}` ? undefined : v;
        },
        dm: copy.dm,
        unknownHero: copy.hero,
      },
    });
  }, [roll, activePending, sheets, enemies, meUserId, skin, t, copy.dm, copy.hero]);

  const inspiration = sheet?.resources?.inspiration
    ? Math.max(0, sheet.resources.inspiration.max - sheet.resources.inspiration.used)
    : sheet?.conditions?.some((c) => /inspir/i.test(c))
      ? 1
      : 0;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, reducedMotion ? Math.min(ms, 60) : ms));
  }, [reducedMotion]);

  // ---------------------------------------------------------------- stage

  useEffect(() => {
    if (!visible || stageState !== "none" || !glRef.current) return;
    setStageState("loading");
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@/lib/fx/dice/stage");
        if (cancelled || !glRef.current) return;
        if (!mod.webglAvailable()) throw new Error("no webgl");
        const stage = await mod.DiceStage.create(glRef.current, {
          reducedMotion,
          onImpact: (strength, x, y) => {
            sfx.sfxDieClack(strength);
            if (particlesRef.current && !reducedMotion) Bursts.dust(particlesRef.current, x, y, strength);
          },
        });
        if (cancelled) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        setStageState("ready");
      } catch {
        if (!cancelled) setStageState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, stageState, reducedMotion, particlesRef]);

  useEffect(() => () => stageRef.current?.dispose(), []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (visible) {
      stage.resize();
      stage.resume();
    } else {
      stage.clear();
      stage.pause();
    }
  }, [visible, stageState]);

  // Keep the table framed inside the free space between header and footer.
  useEffect(() => {
    const slot = slotRef.current;
    const stage = stageRef.current;
    if (!visible || !slot || !stage) return;
    const apply = () => {
      const r = slot.getBoundingClientRect();
      stage.resize();
      stage.setLayout({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(slot);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [visible, stageState]);

  // Run a throw queued while three.js was still loading.
  useEffect(() => {
    if (stageState === "ready" || stageState === "failed") {
      const run = pendingThrowRef.current;
      pendingThrowRef.current = null;
      run?.();
    }
  }, [stageState]);

  // ---------------------------------------------------------------- verdict

  const runVerdict = useCallback(
    (data: DiceRollData, ctx: RollContext | null) => {
      const r = data.roll;
      const icon = ctx?.icon ?? "custom";
      const v = verdictFor(r, icon);
      setVerdict(v);
      dispatch({ type: "phase", phase: "verdict" });
      const stage = stageRef.current;
      const staged = stagedRef.current;
      const hero = staged?.hero ?? null;
      staged?.dice.forEach((d, i) => {
        if (d.dropped) stage?.setOutcome(i, "dropped");
        else if (i === hero && (v === "success" || v === "fail" || v === "crit" || v === "fumble")) stage?.setOutcome(i, v);
        else stage?.setOutcome(i, "kept");
      });
      const f = particlesRef.current;
      const shake = () => {
        if (reducedMotion) return;
        rootRef.current?.animate(
          [
            { transform: "none" },
            { transform: "translate(-7px, 4px)" },
            { transform: "translate(6px, -5px)" },
            { transform: "translate(-4px, 2px)" },
            { transform: "translate(2px, -1px)" },
            { transform: "none" },
          ],
          { duration: 420, easing: "ease-out" },
        );
      };
      const at = (hero !== null ? stage?.project(hero) : stage?.project(0)) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2, r: 60 };
      const medal = medalRef.current?.getBoundingClientRect();
      const mx = medal ? medal.left + medal.width / 2 : at.x;
      const my = medal ? medal.top + medal.height / 2 : at.y;
      switch (v) {
        case "crit":
          sfx.sfxCrit();
          shake();
          if (f && !reducedMotion) {
            f.flash("#ffd76b", 0.45, 0.7, at.x, at.y);
            Bursts.sparks(f, at.x, at.y, FIREWORK_COLORS.gold, 120, 1.5);
            Bursts.embersRise(f, at.x, at.y + at.r, FIREWORK_COLORS.gold, 60, at.r * 3);
            f.ring(at.x, at.y, "#ffe7a3", at.r * 5, 0.9, 8);
            window.setTimeout(() => f.ring(mx, my, "#ffe7a3", 180, 0.8, 5), 150);
          }
          break;
        case "fumble":
          sfx.sfxFumble();
          shake();
          if (f && !reducedMotion) {
            f.flash("#ff2a2a", 0.35, 0.6, at.x, at.y);
            Bursts.shatter(f, at.x, at.y, ["#3a3440", "#6b1a22", "#ff4d5e"], 30, 1.2);
            f.burst(at.x, at.y, { count: 14, kind: "smoke", colors: ["#2a1a22"], speed: [20, 80], life: [1.2, 2], size: [30, 60], drag: 1.5, jitter: 30 });
          }
          break;
        case "success":
          sfx.sfxSuccess();
          if (f && !reducedMotion) {
            Bursts.sparks(f, at.x, at.y, FIREWORK_COLORS.gold, 70);
            f.ring(mx, my, "#ffe7a3", 150, 0.8, 5);
          }
          break;
        case "fail":
          sfx.sfxFail();
          if (f && !reducedMotion) {
            f.burst(at.x, at.y, { count: 30, kind: "ash", colors: ["#6b6580", "#3a3440", "#8a2a34"], speed: [20, 90], angle: -Math.PI / 2, spread: 2, life: [1.4, 2.4], size: [2, 5], gravity: 40, drag: 1 });
          }
          break;
        case "damage": {
          sfx.sfxImpact(r.total >= 20);
          if (f && !reducedMotion) {
            staged?.dice.forEach((_, i) => {
              const p = stage?.project(i);
              if (p) Bursts.embersRise(f, p.x, p.y, FIREWORK_COLORS.ember, 10, p.r);
            });
          }
          const target = targetRef.current?.getBoundingClientRect();
          const from = totalRef.current?.getBoundingClientRect();
          if (target && from && rootRef.current && !reducedMotion) {
            // The damage number flies into whoever it was dealt to.
            const el = document.createElement("div");
            el.className = "fx-fly";
            el.textContent = `−${r.total}`;
            rootRef.current.appendChild(el);
            const x0 = from.left + from.width / 2;
            const y0 = from.top + from.height / 2;
            const x1 = target.left + target.width / 2;
            const y1 = target.top + target.height / 2;
            const anim = el.animate(
              [
                { left: `${x0}px`, top: `${y0}px`, transform: "scale(1)", opacity: 1 },
                { left: `${(x0 + x1) / 2}px`, top: `${Math.min(y0, y1) - 80}px`, transform: "scale(1.3)", opacity: 1, offset: 0.45 },
                { left: `${x1}px`, top: `${y1}px`, transform: "scale(0.6)", opacity: 0.9 },
              ],
              { duration: 720, easing: "cubic-bezier(0.5, 0, 0.3, 1)", fill: "forwards" },
            );
            anim.onfinish = () => {
              el.remove();
              setTargetHit((n) => n + 1);
              sfx.sfxSlash();
              if (f) Bursts.sparks(f, x1, y1, FIREWORK_COLORS.ember, 40, 0.8);
            };
          }
          if (r.total >= 20) shake();
          break;
        }
        case "initiative":
          sfx.sfxWarDrum();
          break;
        default:
          sfx.sfxBell();
      }
    },
    [particlesRef, reducedMotion],
  );

  // ---------------------------------------------------------------- tally

  const runTally = useCallback(
    (data: DiceRollData, ctx: RollContext | null) => {
      dispatch({ type: "phase", phase: "landed" });
      const staged = stagedRef.current;
      const chips = buildChips(data.roll, copy, staged?.hidden ?? 0);
      const skip = skipRef.current || reducedMotion;
      if (skip) {
        setChipsShown(chips.length);
        setShownTotal(data.roll.total);
        runVerdict(data, ctx);
        return;
      }
      let running = 0;
      const step = Math.max(110, Math.min(240, 1300 / Math.max(1, chips.length)));
      chips.forEach((chip, i) => {
        later(160 + i * step, () => {
          if (skipRef.current) return;
          running += chip.add;
          setChipsShown(i + 1);
          setShownTotal(running);
          setTickKey((k) => k + 1);
          if (!chip.dropped) sfx.sfxCountUp(i);
        });
      });
      later(160 + chips.length * step + 120, () => {
        setShownTotal(data.roll.total);
        runVerdict(data, ctx);
      });
    },
    [copy, reducedMotion, later, runVerdict],
  );

  // ---------------------------------------------------------------- start

  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // The context for a roll that is about to become active: who throws and
  // from which side, before the memoised display context catches up.
  const describeFor = useCallback(
    (data: DiceRollData): RollContext | null => {
      const r = data.roll;
      return describeRoll(
        { kind: r.kind, detail: r.detail, dc: r.dc, characterId: r.characterId, requestedBy: r.requestedBy, targetEnemyId: r.targetEnemyId },
        { sheets, enemies, meUserId, mySkin: skin, locale: { skill: () => undefined, ability: () => undefined, dm: copy.dm, unknownHero: copy.hero } },
      );
    },
    [sheets, enemies, meUserId, skin, copy.dm, copy.hero],
  );

  const startRoll = useCallback(
    (data: DiceRollData, resolves?: PendingRoll) => {
      if (resolves) setSubmitted(resolves);
      clearTimers();
      skipRef.current = false;
      setChipsShown(0);
      setShownTotal(null);
      setVerdict(null);
      dispatch({ type: "start", roll: data });
      const r = data.roll;
      const ctx = describeFor(data);
      const palette = ctx?.palette ?? "arcane";
      const staged = stageRoll(r.breakdown, palette);
      stagedRef.current = staged;
      setHiddenDice(staged.hidden);
      sfx.sfxWhoosh(0.5);
      const land = () => {
        const stage = stageRef.current;
        if (stage && staged.dice.length) {
          void stage.throw(staged.dice, { from: ctx?.throwFrom ?? "bottom" }).then(() => runTally(data, ctx));
        } else {
          later(reducedMotion ? 0 : 900, () => runTally(data, ctx));
        }
      };
      if (stageRef.current || stageState === "failed") land();
      else pendingThrowRef.current = land;
    },
    [clearTimers, runTally, later, reducedMotion, stageState, describeFor],
  );

  // ---------------------------------------------------------------- dismiss

  const restoreTitle = useCallback(() => {
    if (titleTimerRef.current) window.clearInterval(titleTimerRef.current);
    titleTimerRef.current = null;
    if (origTitleRef.current) document.title = origTitleRef.current;
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    restoreTitle();
    if (view.active && persistDismissed) {
      try {
        window.sessionStorage.setItem(DISMISSED_KEY, String(view.active.seq));
      } catch {
        // Session storage is optional.
      }
    }
    if (activePending) setDismissedPending((prev) => new Set(prev).add(activePending.id));
    stageRef.current?.clear();
    particlesRef.current?.clear();
    dispatch({ type: "dismiss" });
    setSubmitted(null);
    setCountdown(null);
    setReminderId(null);
    setVerdict(null);
    submittingRef.current = false;
    onDismiss?.();
    const next = queueRef.current.shift();
    if (next) window.setTimeout(() => startRoll(next), 60);
  }, [clearTimers, restoreTitle, view.active, persistDismissed, activePending, particlesRef, onDismiss, startRoll]);

  // ---------------------------------------------------------------- prompt

  const submit = useCallback(async () => {
    if (submittingRef.current || !activePending) return;
    submittingRef.current = true;
    setSubmitted(activePending);
    restoreTitle();
    sfx.sfxShake();
    stageRef.current?.toss();
    dispatch({ type: "phase", phase: "rolling" });
    try {
      if (submitPending) await submitPending(activePending);
      else if (campaignId) await defaultSubmit(campaignId, activePending);
    } catch (err) {
      console.error("Failed to submit roll:", err);
    }
  }, [activePending, campaignId, submitPending, restoreTitle]);

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  const pendingPromptId = pendingPrompt?.id ?? null;

  useEffect(() => {
    if (!pendingPromptId) return;
    sfx.sfxBell();
    origTitleRef.current = document.title;
    let flip = 0;
    titleTimerRef.current = window.setInterval(() => {
      document.title = flip++ % 2 === 0 ? copy.rollAlert : origTitleRef.current;
    }, 1500);
    let seconds = 60;
    const timer = window.setInterval(() => {
      seconds -= 1;
      setCountdown({ id: pendingPromptId, seconds: Math.max(0, seconds) });
      if (seconds === 30) {
        sfx.sfxBell();
        setReminderId(pendingPromptId);
      }
      if (seconds <= 0) {
        window.clearInterval(timer);
        void submitRef.current();
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      restoreTitle();
    };
  }, [pendingPromptId, copy.rollAlert, restoreTitle]);

  // Float the dice while the player decides.
  useEffect(() => {
    if (phase !== "prompt" || !pendingPrompt || stageState !== "ready") return;
    const dice = stageExpression(pendingPrompt.expression, skin);
    if (dice.length) stageRef.current?.hover(dice);
  }, [phase, pendingPrompt, stageState, skin]);

  // ---------------------------------------------------------------- incoming rolls

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let seq = latestRoll?.seq ?? 0;
    try {
      const stored = persistDismissed ? window.sessionStorage.getItem(DISMISSED_KEY) : null;
      const storedSeq = stored === null ? null : Number(stored);
      if (storedSeq !== null && Number.isSafeInteger(storedSeq) && storedSeq >= 0) seq = storedSeq;
      else if (latestRoll && Date.now() - new Date(latestRoll.roll.createdAt).getTime() < 45000) seq = Math.max(0, latestRoll.seq - 1);
    } catch {
      // Keep the stream cursor.
    }
    seenSeqRef.current = seq;
  }, [latestRoll, persistDismissed]);

  // A new roll_result: play it now if the table is free (or it is the roll
  // the dice are already in the air for), otherwise queue it.
  const onIncomingRoll = useEffectEvent((data: DiceRollData) => {
    if (document.hidden) {
      queueRef.current.push(data);
      return;
    }
    const resolvesPrompt = phase === "prompt" && pendingPrompt && data.roll.characterId === pendingPrompt.characterId;
    if (phase === "rolling" && !view.active) startRoll(data);
    else if (phase === "idle" || resolvesPrompt) startRoll(data, resolvesPrompt ? pendingPrompt : undefined);
    else queueRef.current.push(data);
  });

  useEffect(() => {
    if (!latestRoll || !enabled || latestRoll.seq <= seenSeqRef.current) return;
    seenSeqRef.current = latestRoll.seq;
    onIncomingRoll(latestRoll);
  }, [latestRoll, enabled]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || view.active || phase === "prompt") return;
      const next = queueRef.current.shift();
      if (next) startRoll(next);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [view.active, phase, startRoll]);

  // ---------------------------------------------------------------- input

  const reveal = useCallback(() => {
    skipRef.current = true;
    stageRef.current?.finish();
    if (view.phase === "landed" && view.active) {
      clearTimers();
      setShownTotal(view.active.roll.total);
      setChipsShown(99);
      runVerdict(view.active, contextRef.current);
    }
  }, [view.phase, view.active, clearTimers, runVerdict]);

  const onRootClick = () => {
    if (phase === "prompt") return;
    if (phase === "rolling" || phase === "landed") reveal();
    else if (phase === "verdict") dismiss();
  };

  const keyState = useRef({ phase, reveal, dismiss });
  useEffect(() => {
    keyState.current = { phase, reveal, dismiss };
  }, [phase, reveal, dismiss]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyState.current;
      if (s.phase === "idle") return;
      if (s.phase === "prompt" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        void submitRef.current();
      } else if ((s.phase === "rolling" || s.phase === "landed") && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        s.reveal();
      } else if (s.phase === "verdict" && (e.key === "Escape" || e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        s.dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const reroll = async () => {
    if (rerolling) return;
    setRerolling(true);
    sfx.sfxChoir();
    const expression = roll?.expression || activePending?.expression || "1d20";
    const action = copy.inspirationAction.replace("{name}", sheet?.name || copy.hero);
    try {
      if (rerollWithInspiration) await rerollWithInspiration(expression, action);
      else if (campaignId) await defaultReroll(campaignId, sheet, expression, action);
      clearTimers();
      setVerdict(null);
      setChipsShown(0);
      setShownTotal(null);
      // Pick the same dice back up and keep them spinning until the new
      // roll_result lands them again.
      const again = stagedRef.current?.dice.map((d) => ({ ...d, dropped: false })) ?? [];
      if (again.length) {
        stageRef.current?.hover(again);
        stageRef.current?.toss();
      }
      dispatch({ type: "await" });
    } catch (err) {
      console.error("Failed to reroll with inspiration:", err);
    } finally {
      setRerolling(false);
    }
  };

  const chooseSkin = (id: DicePaletteId) => {
    setSkinState(id);
    try {
      window.localStorage.setItem(SKIN_KEY, id);
    } catch {
      // Remembered for this page only.
    }
  };

  // ---------------------------------------------------------------- render

  const timeLeft = countdown && countdown.id === activePending?.id ? countdown.seconds : 60;
  const reminder = reminderId === activePending?.id;
  const expression = roll?.expression ?? activePending?.expression ?? "1d20";
  const advantage = roll?.advantage ?? activePending?.advantage ?? "none";
  const chips = roll ? buildChips(roll, copy, hiddenDice) : [];
  const icon = context?.icon ?? "custom";
  const dc = roll?.dc ?? activePending?.dc ?? null;
  // The target's AC: known to the DM; for players "?" until the verdict,
  // which reveals a bound (a hit means AC <= total, a miss AC > total).
  const acKnown = context?.stakes.kind === "ac" ? context.stakes.value : null;
  const acText =
    acKnown !== null
      ? String(acKnown)
      : roll && verdict === "success"
        ? `≤${roll.total}`
        : roll && verdict === "fail"
          ? `>${roll.total}`
          : "?";
  const stakesHint =
    context?.stakes.kind === "dc"
      ? fmt(copy.dcHint, { dc: context.stakes.value })
      : acKnown !== null
        ? fmt(copy.acKnown, { ac: acKnown })
        : roll && verdict === "crit"
          ? copy.acCrit
          : roll && verdict === "fumble"
            ? copy.acFumble
            : roll && verdict === "success"
              ? fmt(copy.acHit, { total: roll.total })
              : roll && verdict === "fail"
                ? fmt(copy.acMiss, { total: roll.total })
                : copy.acHidden;
  const verdictTone =
    verdict === "crit" || verdict === "success" || verdict === "initiative" ? "gold"
    : verdict === "fumble" || verdict === "fail" || verdict === "damage" ? "crimson"
    : "steel";
  const actor = context?.actor;
  const ownerLabel = actor?.kind === "me" ? copy.you : actor?.kind === "ally" ? copy.ally : actor?.kind === "enemy" ? copy.enemy : copy.dm;
  const R = 50;
  const C = 2 * Math.PI * R;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={context ? `${actor?.name ?? ""}: ${copy.kinds[icon]}` : copy.kinds.custom}
      className="fx-layer fx-roll"
      style={visible ? undefined : { display: "none" }}
      onClick={onRootClick}
    >
      <div className="fx-backdrop" />
      <canvas ref={glRef} className="fx-canvas" />
      {stageState === "failed" && roll ? (
        <div className="fx-flat-dice" style={{ position: "absolute", inset: "30% 0" }}>
          {diceTerms(roll.breakdown).flatMap((term, ti) =>
            term.dice.map((d, di) => (
              <div key={`${ti}-${di}`} className="fx-flat-die" style={{ "--i": ti * 4 + di, opacity: d.kept ? 1 : 0.4 } as CSSProperties}>
                <small>{fmt(copy.die, { n: term.sides })}</small>
                {phase === "rolling" ? "?" : d.value}
              </div>
            )),
          )}
        </div>
      ) : null}
      <canvas ref={particleCanvasRef} className="fx-canvas" />

      <div className="fx-roll__hud">
        <header className="fx-roll__head">
          {context && actor ? (
            <div className={cn("fx-plate", `fx-plate--${actor.kind}`)}>
              <div className="fx-plate__actor">
                <div className="fx-avatar">
                  {actor.portraitUrl ? (
                    // Portraits are local /uploads files; next/image adds nothing here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={actor.portraitUrl} alt="" />
                  ) : actor.kind === "enemy" || actor.kind === "dm" ? <FxIcon name={actor.kind === "dm" ? "crown" : "skull"} size={22} /> : actor.name.slice(0, 1)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="fx-plate__name">{actor.name}</div>
                  <div className="fx-plate__sub">
                    <span className={cn("fx-owner", actor.kind === "enemy" || actor.kind === "dm" ? "fx-owner--enemy" : actor.kind === "ally" && "fx-owner--ally")}>{ownerLabel}</span>
                    {actor.subtitle ? <span>{actor.subtitle}</span> : null}
                  </div>
                </div>
              </div>
              <div className="fx-plate__action">
                <FxIcon name={icon} size={22} />
                <div>
                  <span className="fx-plate__kind">{copy.kinds[icon]}</span>
                  {context.action ? <span className="fx-plate__what">{context.action}</span> : null}
                </div>
              </div>
              {context.target ? (
                <>
                  <div className="fx-plate__arrow">
                    <FxIcon name="arrow" size={26} />
                  </div>
                  <div key={targetHit} ref={targetRef} className={cn("fx-plate__target", context.target.kind === "effect" && "fx-plate__target--effect", targetHit > 0 && "fx-plate__target--hit")}>
                    <div className={cn("fx-avatar", context.target.kind === "enemy" && "fx-avatar--enemy")}>
                      <FxIcon name={context.target.kind === "enemy" ? "skull" : context.target.kind === "effect" ? "initiative" : "shield"} size={20} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="fx-plate__name">{context.target.name}</div>
                      {typeof context.target.hpPercent === "number" ? (
                        <div className="fx-hp">
                          <i style={{ width: `${Math.max(0, Math.min(100, context.target.hpPercent))}%` }} />
                        </div>
                      ) : context.target.health ? (
                        <div className="fx-plate__sub">{copy.health[context.target.health] ?? context.target.health}</div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {context?.reason && (phase === "prompt" || context.requestedBy === "dm") ? (
            <div className="fx-request">
              <b>{copy.asks}</b>«{context.reason}»
            </div>
          ) : null}

          {advantage === "advantage" || advantage === "disadvantage" ? (
            <span className={cn("fx-badge", advantage === "advantage" ? "fx-badge--adv" : "fx-badge--dis")}>
              {advantage === "advantage" ? copy.advantage : copy.disadvantage}
            </span>
          ) : null}

          {context?.stakes.kind === "none" ? (
            <span className="fx-badge fx-badge--expr">{expression}</span>
          ) : null}

          {context?.stakes.kind !== "none" ? (
            <div
              ref={medalRef}
              title={context?.stakes.kind === "ac" ? copy.acTooltip : undefined}
              className={cn(
                "fx-medal",
                verdict === "success" || verdict === "crit"
                  ? context?.stakes.kind === "ac" ? "fx-medal--revealed" : "fx-medal--beaten"
                  : verdict === "fail" || verdict === "fumble" ? "fx-medal--held" : "",
              )}
            >
              <svg viewBox="0 0 116 116">
                <defs>
                  <linearGradient id="fx-medal-gold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#fff3c4" />
                    <stop offset="0.5" stopColor="#d4a13a" />
                    <stop offset="1" stopColor="#7a5212" />
                  </linearGradient>
                  <radialGradient id="fx-medal-face">
                    <stop offset="0" stopColor="#2c1f55" />
                    <stop offset="1" stopColor="#100a22" />
                  </radialGradient>
                </defs>
                <circle cx="58" cy="58" r="44" fill="url(#fx-medal-face)" stroke="url(#fx-medal-gold)" strokeWidth="3" />
                <g className="fx-medal__ring">
                  <circle cx="58" cy="58" r="50" fill="none" stroke="url(#fx-medal-gold)" strokeWidth="1.2" strokeDasharray="2 5" opacity="0.8" />
                </g>
                {phase === "prompt" ? (
                  <circle
                    className="fx-medal__timer"
                    cx="58"
                    cy="58"
                    r={R}
                    fill="none"
                    stroke={timeLeft <= 30 ? "#ff6b6b" : "#f3d27a"}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - timeLeft / 60)}
                    transform="rotate(-90 58 58)"
                  />
                ) : null}
              </svg>
              {context?.stakes.kind === "dc" ? (
                <span className="fx-medal__value">{dc}</span>
              ) : context?.stakes.kind === "ac" ? (
                <span className={cn("fx-medal__value", acText.length > 2 && "fx-medal__value--sm")}>{acText}</span>
              ) : null}
              {verdict === "success" || verdict === "crit" ? <span className="fx-medal__shock" /> : null}
            </div>
          ) : null}

          {context && context.stakes.kind !== "none" ? (
            <div className="fx-stakes" title={context.stakes.kind === "ac" ? copy.acTooltip : undefined}>
              <span className="fx-stakes__label">{context.stakes.kind === "dc" ? copy.dcLabel : copy.acLabel}</span>
              <span className="fx-stakes__hint">
                {stakesHint}
                {phase === "prompt" ? (
                  <b className={cn("fx-stakes__timer", timeLeft <= 30 && "fx-stakes__timer--urgent")}> · {fmt(copy.timeLeft, { n: timeLeft })}</b>
                ) : null}
              </span>
            </div>
          ) : null}
        </header>

        <div
          ref={slotRef}
          style={{ width: "100%", pointerEvents: phase === "prompt" ? "auto" : "none", cursor: phase === "prompt" ? "pointer" : undefined }}
          onClick={(e) => {
            if (phase !== "prompt") return;
            e.stopPropagation();
            void submit();
          }}
        />

        <footer className="fx-roll__foot">
          {phase === "prompt" ? (
            <div className="fx-actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className={cn("fx-button fx-button--big", reminder && "fx-button--pulse")} onClick={() => void submit()}>
                <FxIcon name="custom" size={20} />
                {copy.rollDie}
              </button>
              <span className="fx-hint">{copy.orTap}</span>
            </div>
          ) : null}

          {roll && (phase === "landed" || phase === "verdict") ? (
            <>
              <div className="fx-tally">
                {chips.slice(0, chipsShown).map((chip, i) => (
                  <span
                    key={chip.key}
                    className={cn("fx-chip", chip.die && "fx-chip--die", chip.dropped && "fx-chip--dropped", chip.negative && "fx-chip--neg")}
                    style={{ "--i": 0 } as CSSProperties}
                    data-index={i}
                  >
                    {chip.label}
                    {chip.value ? <b>{chip.value}</b> : null}
                  </span>
                ))}
              </div>
              <div className="fx-total" ref={totalRef}>
                <span className="fx-total__label">{icon === "damage" ? copy.kinds.damage : copy.total}</span>
                <span key={tickKey} className="fx-total__value fx-total__value--tick">
                  {shownTotal ?? "…"}
                </span>
                {dc !== null ? (
                  <span className="fx-total__vs">{fmt(copy.need, { n: dc })}</span>
                ) : null}
              </div>
            </>
          ) : null}

          {phase === "verdict" && verdict && verdict !== "neutral" && roll ? (
            <div className={cn("fx-verdict", `fx-verdict--${verdict}`)}>
              {verdict === "crit" ? <div className="fx-verdict__rays" /> : null}
              {verdict === "damage" ? (
                <FxTitle text={`${roll.total} ${copy.damageTo}`} tone="crimson" variant="slam" />
              ) : (
                <FxTitle
                  text={verdictText(verdict, icon, roll.total, copy)}
                  tone={verdictTone}
                  variant={verdict === "fail" || verdict === "fumble" ? "drop" : verdict === "crit" ? "slam" : "rise"}
                />
              )}
            </div>
          ) : null}

          {phase === "verdict" && (verdict === "fail" || verdict === "fumble") && inspiration > 0 && actor?.kind === "me" ? (
            <div className="fx-actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="fx-button fx-button--violet" disabled={rerolling} onClick={() => void reroll()}>
                ★ {copy.reroll} · {fmt(copy.remaining, { n: inspiration })}
              </button>
            </div>
          ) : null}

          {phase === "rolling" || phase === "landed" ? <span className="fx-hint">{copy.reveal}</span> : null}
          {phase === "verdict" ? <span className="fx-hint">{copy.dismiss}</span> : null}
        </footer>
      </div>

      {phase === "prompt" ? (
        <div className="fx-skins" role="group" aria-label={copy.skin} onClick={(e) => e.stopPropagation()}>
          {SKINS.map((id) => (
            <button
              key={id}
              type="button"
              className="fx-skin"
              aria-pressed={skin === id}
              title={id}
              onClick={() => chooseSkin(id)}
              style={{ background: `radial-gradient(circle at 35% 30%, ${DICE_PALETTES[id].face[0]}, ${DICE_PALETTES[id].face[1]})` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type { StageDie };
