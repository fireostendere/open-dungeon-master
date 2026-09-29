// Dice scenarios for the animations lab: real engine rolls (`rollExpression`)
// with optional forced faces, dressed as the server would send them.

import { rollExpression } from "@/lib/dice";
import type { StoredRoll } from "@/lib/db/rolls";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";

export const LAB_ME = "user-me";

export const LAB_SHEETS = [
  { id: "pc-eira", userId: LAB_ME, name: "Эйра", class: "Следопыт", level: 5, conditions: ["Inspired"] },
  { id: "pc-torin", userId: "user-2", name: "Торин", class: "Воин", level: 5 },
  { id: "pc-lis", userId: "user-3", name: "Лис", class: "Плут", level: 4 },
];

export const LAB_ENEMIES = [
  { id: "gob", name: "Гоблин-лучник", health: "bloodied", hpPercent: 38 },
  { id: "ogre", name: "Огр", health: "wounded", hpPercent: 72 },
];

type Make = {
  kind: StoredRoll["kind"];
  detail: string;
  expression: string;
  characterId?: string | null;
  dc?: number | null;
  requestedBy?: "dm" | "player";
  targetEnemyId?: string | null;
  advantage?: StoredRoll["advantage"];
  forced?: number[];
  /** Hit/miss for attacks (the lab's pretend AC). */
  ac?: number;
};

let rollCounter = 0;

export function makeRoll(m: Make): StoredRoll {
  const forced = [...(m.forced ?? [])];
  const breakdown = rollExpression(m.expression, (sides) => {
    const f = forced.shift();
    return f !== undefined ? Math.min(sides, Math.max(1, f)) : 1 + Math.floor(Math.random() * sides);
  });
  const dc = m.dc ?? null;
  let success: boolean | null = null;
  if (dc !== null) success = breakdown.total >= dc;
  if (m.ac !== undefined) success = breakdown.crit === "nat20" ? true : breakdown.crit === "nat1" ? false : breakdown.total >= m.ac;
  return {
    id: `lab-roll-${++rollCounter}`,
    campaignId: "lab",
    characterId: m.characterId ?? null,
    requestedBy: m.requestedBy ?? "dm",
    kind: m.kind,
    detail: m.detail,
    expression: m.expression,
    advantage: m.advantage ?? "none",
    dc,
    total: breakdown.total,
    success,
    breakdown,
    visibility: "public",
    messageId: null,
    targetEnemyId: m.targetEnemyId ?? null,
    applied: false,
    createdAt: new Date().toISOString(),
  };
}

export type DiceScenario = {
  id: string;
  label: string;
  hint: string;
  /** A pending roll the lab's player has to click; the roll comes on submit. */
  pending?: Omit<PendingRoll, "id" | "createdAt">;
  roll: () => StoredRoll;
};

export const DICE_SCENARIOS: DiceScenario[] = [
  {
    id: "prompt",
    label: "Мастер просит проверку",
    hint: "Ваш бросок: кубик парит, таймер 60 с, выбор цвета костей",
    pending: {
      userId: LAB_ME,
      characterId: "pc-eira",
      kind: "skill_check",
      detail: "stealth",
      expression: "1d20+7",
      advantage: "none",
      dc: 15,
      reason: "Прокрасться мимо стражи у ворот",
    },
    roll: () => makeRoll({ kind: "skill_check", detail: "stealth", expression: "1d20+7", characterId: "pc-eira", dc: 15 }),
  },
  {
    id: "attack",
    label: "Моя атака по гоблину",
    hint: "Кто → чем → в кого; кубик летит снизу, из вашей руки",
    roll: () => makeRoll({ kind: "attack", detail: "Эйра: Длинный лук vs Гоблин-лучник", expression: "1d20+7", characterId: "pc-eira", requestedBy: "player", ac: 13 }),
  },
  {
    id: "damage",
    label: "Урон → в цель",
    hint: "Число урона улетает в плашку цели",
    roll: () => makeRoll({ kind: "damage", detail: "Эйра: Длинный лук damage", expression: "1d8+2d6+4", characterId: "pc-eira", targetEnemyId: "gob" }),
  },
  {
    id: "ally-save",
    label: "Союзник: спасбросок",
    hint: "Кубики другого игрока летят слева, у него свой цвет",
    roll: () => makeRoll({ kind: "saving_throw", detail: "Торин: DEX save vs Огненный шар", expression: "1d20+2", characterId: "pc-torin", dc: 15 }),
  },
  {
    id: "enemy",
    label: "Враг атакует",
    hint: "Кубики Мастера летят сверху, «проклятые»",
    roll: () => makeRoll({ kind: "attack", detail: "Огр: Greatclub", expression: "1d20+6", characterId: null, ac: 15 }),
  },
  {
    id: "fireball",
    label: "Огненный шар 8к6",
    hint: "Много костей сразу",
    roll: () => makeRoll({ kind: "damage", detail: "Эйра: Огненный шар damage", expression: "8d6", characterId: "pc-eira", targetEnemyId: "ogre" }),
  },
  {
    id: "adv",
    label: "Преимущество",
    hint: "Два d20, худший гаснет",
    roll: () => makeRoll({ kind: "skill_check", detail: "perception", expression: "2d20kh1+5", characterId: "pc-eira", dc: 12, advantage: "advantage" }),
  },
  {
    id: "dis",
    label: "Помеха",
    hint: "Два d20, лучший гаснет",
    roll: () => makeRoll({ kind: "skill_check", detail: "acrobatics", expression: "2d20kl1+3", characterId: "pc-lis", dc: 14, advantage: "disadvantage" }),
  },
  {
    id: "nat20",
    label: "Натуральная 20",
    hint: "Кубик взлетает к камере, золото и искры",
    roll: () => makeRoll({ kind: "attack", detail: "Эйра: Длинный лук vs Огр", expression: "1d20+7", characterId: "pc-eira", requestedBy: "player", ac: 15, forced: [20] }),
  },
  {
    id: "nat1",
    label: "Натуральная 1",
    hint: "Кубик трескается, осколки",
    roll: () => makeRoll({ kind: "saving_throw", detail: "Эйра: WIS save vs Внушение", expression: "1d20+3", characterId: "pc-eira", dc: 13, forced: [1] }),
  },
  {
    id: "death",
    label: "Спасбросок от смерти",
    hint: "0 ХП, СЛ 10",
    roll: () => makeRoll({ kind: "saving_throw", detail: "death save", expression: "1d20", characterId: "pc-torin", dc: 10 }),
  },
  {
    id: "initiative",
    label: "Инициатива",
    hint: "Без СЛ, итог и барабан",
    roll: () => makeRoll({ kind: "initiative", detail: "initiative", expression: "1d20+3", characterId: "pc-lis" }),
  },
  {
    id: "d100",
    label: "к100 (дикая магия)",
    hint: "Пара к10: десятки и единицы",
    roll: () => makeRoll({ kind: "custom", detail: "Всплеск дикой магии", expression: "1d100", characterId: "pc-lis" }),
  },
  {
    id: "secret",
    label: "Тайный бросок",
    hint: "Слепой бросок Мастера: игроку приходит без чисел — только плашка",
    roll: () => ({ ...makeRoll({ kind: "skill_check", detail: "insight", expression: "1d20+4", characterId: "pc-torin", dc: 14 }), total: null, success: null, breakdown: null, dc: null, visibility: "blind", hidden: true }) as unknown as StoredRoll,
  },
  {
    id: "all",
    label: "Все кости",
    hint: "к4, к6, к8, к10, к12, к20",
    roll: () => makeRoll({ kind: "custom", detail: "Проверка всех костей", expression: "1d4+1d6+1d8+1d10+1d12+1d20", characterId: "pc-eira", requestedBy: "player" }),
  },
];
