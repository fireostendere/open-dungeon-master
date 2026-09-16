"use client";

import { Dices } from "lucide-react";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { abilityMod, formatModifier } from "@/lib/srd";
import {
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  pointBuyRemaining,
} from "@/lib/srd/point-buy";
import type { Ability } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export type AbilityMethod = "standard" | "pointbuy" | "roll";

export const ABILITY_LABELS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const ABILITY_KEYS = Object.keys(ABILITY_LABELS) as Ability[];

export type AbilityState = Record<Ability, number | null>;

export function rollFourDropLowest() {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6));
  dice.sort((a, b) => b - a);
  return dice[0] + dice[1] + dice[2];
}

// Method-aware ability score editor: standard array assignment, 27-point
// buy, or 4d6-drop-lowest rolls. Racial bonuses are displayed but applied
// by the parent.
export default function AbilityEditor({
  method,
  onMethodChange,
  scores,
  onScoresChange,
  racialBonus,
  asiCount = 0,
}: {
  method: AbilityMethod;
  onMethodChange: (method: AbilityMethod) => void;
  scores: AbilityState;
  onScoresChange: (scores: AbilityState) => void;
  racialBonus: Partial<Record<Ability, number>>;
  // Ability score improvements the chosen level has earned; > 0 adds a hint
  // that base scores are level-1 rules and the bonuses are picked below.
  asiCount?: number;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { abilityScores: "Ability scores", standard: "Standard array", standardInfo: "Everyone starts with the same six numbers: {scores}. You decide which ability gets which. Nothing is left to luck, and no character is accidentally weaker than the rest of the party. This is the safe choice if you are new.", pointBuy: "Point buy", pointBuyInfo: "You spend 27 points raising each score from 8. The higher a score climbs the more each step costs, so a character with one towering ability pays for it with weak ones. Fair like the standard array, but you choose the shape.", roll: "Roll 4d6", rollInfo: "Roll four six-sided dice for each ability and drop the lowest. It can hand you a hero far above the standard array, or well below it. Some tables love the swing; ask yours before choosing it.", pointsLeft: "points left", rollAll: "Roll all", base: "These are your base scores, the same at every level. Your level has earned", improvement: "ability score improvement", improvements: "ability score improvements", pickBelow: "on top of them; pick those in the section below.", racial: "racial", final: "Final" },
    ru: { abilityScores: "Характеристики", standard: "Стандартный набор", standardInfo: "Все начинают с одних и тех же шести чисел: {scores}. Вы решаете, какому параметру достанется каждое. Здесь нет удачи, и персонаж случайно не окажется слабее остальной группы. Безопасный выбор для новичка.", pointBuy: "Покупка очками", pointBuyInfo: "Вы тратите 27 очков, повышая каждый параметр от 8. Чем выше параметр, тем дороже каждый шаг, поэтому герой с одним выдающимся параметром платит за него слабыми. Так же честно, как стандартный набор, но форму выбираете вы.", roll: "Бросок 4d6", rollInfo: "Бросьте четыре шестигранника для каждого параметра и отбросьте наименьший. Можно получить героя намного сильнее стандартного набора или намного слабее. Некоторые столы любят риск — спросите свой, прежде чем выбирать.", pointsLeft: "очков осталось", rollAll: "Бросить всё", base: "Это базовые параметры, одинаковые на каждом уровне. На вашем уровне получено", improvement: "улучшение характеристики", improvements: "улучшений характеристик", pickBelow: "сверх них; выберите их в разделе ниже.", racial: "расовое", final: "Итог" },
    pl: { abilityScores: "Cechy", standard: "Zestaw standardowy", standardInfo: "Wszyscy zaczynają z tymi samymi sześcioma liczbami: {scores}. Decydujesz, która cecha dostanie którą. Nie ma tu losowości, więc postać przypadkiem nie będzie słabsza od reszty drużyny. To bezpieczny wybór dla nowych graczy.", pointBuy: "Kupno punktowe", pointBuyInfo: "Wydajesz 27 punktów, podnosząc każdą cechę od 8. Im wyższa cecha, tym więcej kosztuje każdy krok, więc postać z jedną potężną cechą płaci za nią słabymi. Równie uczciwe jak zestaw standardowy, ale sam wybierasz kształt.", roll: "Rzut 4k6", rollInfo: "Rzuć czterema kośćmi sześciennymi za każdą cechę i odrzuć najniższą. Możesz dostać bohatera znacznie silniejszego lub słabszego od zestawu standardowego. Niektóre stoły lubią tę losowość — zapytaj swój przed wyborem.", pointsLeft: "punktów pozostało", rollAll: "Rzuć wszystkimi", base: "To są twoje bazowe cechy, takie same na każdym poziomie. Twój poziom daje", improvement: "ulepszenie cechy", improvements: "ulepszeń cech", pickBelow: "ponad nimi; wybierz je w sekcji poniżej.", racial: "rasowe", final: "Wynik" },
  });
  const abilityNames = localeText(locale, { en: ABILITY_LABELS, ru: { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" }, pl: { str: "Siła", dex: "Zręczność", con: "Kondycja", int: "Inteligencja", wis: "Mądrość", cha: "Charyzma" } });
  const methods = [
    { id: "standard" as const, label: copy.standard, info: copy.standardInfo.replace("{scores}", STANDARD_ARRAY.join(", ")) },
    { id: "pointbuy" as const, label: copy.pointBuy, info: copy.pointBuyInfo },
    { id: "roll" as const, label: copy.roll, info: copy.rollInfo },
  ];
  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";
  const usedValues = ABILITY_KEYS.map((key) => scores[key]).filter(
    (value): value is number => value !== null,
  );
  const pointBuyScores = ABILITY_KEYS.map((key) => scores[key] ?? POINT_BUY_MIN);
  const remaining = method === "pointbuy" ? pointBuyRemaining(pointBuyScores) : 0;
  const activeMethod = methods.find((entry) => entry.id === method) ?? methods[0];

  function setScore(ability: Ability, value: number | null) {
    const next = { ...scores };
    if (method === "standard" && value !== null) {
      for (const key of ABILITY_KEYS) {
        if (next[key] === value) {
          next[key] = null;
        }
      }
    }
    next[ability] = value;
    onScoresChange(next);
  }

  function switchMethod(next: AbilityMethod) {
    onMethodChange(next);
    onScoresChange(
      next === "pointbuy"
        ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
        : { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    );
  }

  function rollAll() {
    const next = { ...scores };
    for (const key of ABILITY_KEYS) {
      next[key] = rollFourDropLowest();
    }
    onScoresChange(next);
  }

  return (
    <section className="panel rounded-xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow text-xs text-amber-200/90">
          <GameTerm id="ability_score">{copy.abilityScores}</GameTerm>
        </h2>
        <div className="flex items-center rounded-md border border-stone-700 p-0.5 text-xs">
           {methods.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => switchMethod(entry.id)}
              className={cn(
                "rounded px-2.5 py-1",
                method === entry.id
                  ? "bg-amber-900/60 text-amber-200"
                  : "text-stone-400 hover:text-stone-200",
              )}
            >
              {entry.label}
            </button>
          ))}
          {/* Which of the three to use is the question a first character
              actually gets stuck on, so the answer sits on the control. */}
          <InfoButton
            label={activeMethod.label}
            text={activeMethod.info}
            className="mx-1"
          />
        </div>
        {method === "pointbuy" ? (
          <span
            className={cn(
              "text-xs",
              remaining < 0 ? "text-red-400" : "text-stone-400",
            )}
          >
             {remaining} {copy.pointsLeft}
          </span>
        ) : null}
        {method === "roll" ? (
          <button
            type="button"
            onClick={rollAll}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-900"
          >
             <Dices className="size-3.5" /> {copy.rollAll}
          </button>
        ) : null}
      </div>
      {asiCount > 0 ? (
        <p className="mb-3 text-xs text-stone-500">
           {copy.base}{" "}
          <span className="text-amber-200">
             {asiCount} {asiCount === 1 ? copy.improvement : copy.improvements}
          </span>{" "}
           {" "}{copy.pickBelow}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ABILITY_KEYS.map((ability) => {
          const bonus = racialBonus[ability] ?? 0;
          const assigned = scores[ability];
          const finalScore = assigned !== null ? assigned + bonus : null;
          return (
            <label
              key={ability}
              className="block rounded-lg border border-stone-800 bg-stone-950/60 p-3"
            >
              <span className="mb-1 flex items-baseline justify-between">
                <span className="text-stone-300">
                   <GameTerm id={ability}>{abilityNames[ability]}</GameTerm>
                </span>
                 {bonus ? <span className="text-xs text-amber-200">+{bonus} {copy.racial}</span> : null}
              </span>
              {method === "standard" ? (
                <select
                  value={assigned ?? ""}
                  onChange={(event) =>
                    setScore(ability, event.target.value ? Number(event.target.value) : null)
                  }
                  className={inputClass}
                >
                  <option value="">--</option>
                  {STANDARD_ARRAY.map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={usedValues.includes(value) && scores[ability] !== value}
                    >
                      {value}
                    </option>
                  ))}
                </select>
              ) : method === "pointbuy" ? (
                <select
                  value={assigned ?? POINT_BUY_MIN}
                  onChange={(event) => setScore(ability, Number(event.target.value))}
                  className={inputClass}
                >
                  {Array.from(
                    { length: POINT_BUY_MAX - POINT_BUY_MIN + 1 },
                    (_, index) => POINT_BUY_MIN + index,
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={3}
                  max={18}
                  value={assigned ?? ""}
                  onChange={(event) =>
                    setScore(ability, event.target.value ? Number(event.target.value) : null)
                  }
                  className={inputClass}
                />
              )}
              {finalScore !== null ? (
                <span className="mt-1 block text-xs text-stone-400">
                   {copy.final} {finalScore} ({formatModifier(abilityMod(finalScore))})
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
