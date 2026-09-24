"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { asPercent, forecastAttack, roundsToDrop } from "@/lib/srd/odds";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The consequence preview: hit chance, expected damage, and how long a target
// lasts. Pure arithmetic from src/lib/srd/odds.ts, so it is instant, always
// available, and needs nothing from the server.

// The only two table rules that change what a crit is worth. Named here so
// the same shape threads down from the panel without dragging the whole
// GameSettings type through three components.
export type CritRules = { powerfulCritical: boolean; criticalDamageMods: boolean };

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Calculator;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <Icon className="size-3.5" />
        {title}
      </p>
      {children}
    </section>
  );
}

// Hit chance, expected damage, and how long a target lasts. Pure arithmetic
// from src/lib/srd/odds.ts, so it is instant and always available.
export function OddsCalculator({
  variantRules,
}: {
  // The table's optional crit rules. The forecast runs them through the
  // engine's own critDamageExpression, so what it predicts is what the
  // server would actually roll.
  variantRules: CritRules;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "What is this likely to do?", attack: "Attack bonus", ac: "Target AC", damage: "Damage", roll: "Roll", straight: "Straight", advantage: "Advantage", disadvantage: "Disadvantage", hp: "Target hit points", attacks: "Attacks per round", extra: "Extra dice on a crit", invalid: "That damage expression cannot be averaged, so only the odds below are real. The chance to hit never depended on it.", chance: "Chance to hit", crit: "crit", hit: "Damage on a hit", onCrit: "on a crit", average: "Average per round", rounds: "Rounds to drop", unknown: "unknown", never: "never" },
    ru: { title: "Что это, вероятно, сделает?", attack: "Бонус атаки", ac: "КД цели", damage: "Урон", roll: "Бросок", straight: "Обычный", advantage: "Преимущество", disadvantage: "Помеха", hp: "Хиты цели", attacks: "Атак за раунд", extra: "Доп. кости при крите", invalid: "Это выражение урона нельзя усреднить, поэтому точны только шансы ниже. Шанс попадания от него не зависит.", chance: "Шанс попасть", crit: "крит", hit: "Урон при попадании", onCrit: "при крите", average: "Среднее за раунд", rounds: "Раундов до падения", unknown: "неизвестно", never: "никогда" },
  });
  const [attackBonus, setAttackBonus] = useState(5);
  const [ac, setAc] = useState(15);
  const [damage, setDamage] = useState("1d8+3");
  const [advantage, setAdvantage] = useState<"none" | "advantage" | "disadvantage">("none");
  const [hitPoints, setHitPoints] = useState(30);
  const [attacksPerRound, setAttacksPerRound] = useState(1);
  const [extraCritDice, setExtraCritDice] = useState(0);

  const forecast = useMemo(
    () =>
      forecastAttack({
        attackBonus,
        ac,
        damage,
        advantage,
        extraCritDice,
        variantRules: {
          powerfulCritical: variantRules.powerfulCritical,
          multiplyNumeric: variantRules.criticalDamageMods,
        },
      }),
    [attackBonus, ac, damage, advantage, extraCritDice, variantRules],
  );
  const perRound = forecast.perAttack * Math.max(1, attacksPerRound);
  const rounds = roundsToDrop(hitPoints, perRound);

  return (
    <Section icon={Calculator} title={copy.title}>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[11px] text-stone-500">
          {copy.attack}
          <input
            type="number"
            value={attackBonus}
            onChange={(event) => setAttackBonus(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          {copy.ac}
          <input
            type="number"
            value={ac}
            onChange={(event) => setAc(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          {copy.damage}
          <input
            value={damage}
            onChange={(event) => setDamage(event.target.value)}
            placeholder="2d6+4"
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          {copy.roll}
          <select
            value={advantage}
            onChange={(event) =>
              setAdvantage(event.target.value as "none" | "advantage" | "disadvantage")
            }
            className={inputClass}
          >
            <option value="none">{copy.straight}</option>
            <option value="advantage">{copy.advantage}</option>
            <option value="disadvantage">{copy.disadvantage}</option>
          </select>
        </label>
        <label className="text-[11px] text-stone-500">
          {copy.hp}
          <input
            type="number"
            value={hitPoints}
            onChange={(event) => setHitPoints(Number(event.target.value) || 0)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500">
          {copy.attacks}
          <input
            type="number"
            min={1}
            value={attacksPerRound}
            onChange={(event) => setAttacksPerRound(Number(event.target.value) || 1)}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500" title={uiText("Brutal Critical, Savage Attacks.")}>
          {copy.extra}
          <input
            type="number"
            min={0}
            max={4}
            value={extraCritDice}
            onChange={(event) => setExtraCritDice(Math.max(0, Number(event.target.value) || 0))}
            className={inputClass}
          />
        </label>
      </div>
      {forecast.exact ? null : (
        <p className="mt-2 text-xs text-amber-300/90">
          {copy.invalid}
        </p>
      )}
      <dl className="mt-2 space-y-0.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-stone-500">{copy.chance}</dt>
          <dd className="text-stone-200">
            {asPercent(forecast.odds.hit)}
            <span className="text-stone-500"> ({asPercent(forecast.odds.crit)} {copy.crit})</span>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{copy.hit}</dt>
          <dd className="text-stone-200">
            {forecast.exact ? (
              <>
                {forecast.onHit.toFixed(1)}
                <span className="text-stone-500"> ({forecast.onCrit.toFixed(1)} {copy.onCrit})</span>
              </>
            ) : (
              copy.unknown
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{copy.average}</dt>
          <dd className="text-stone-200">{forecast.exact ? perRound.toFixed(1) : copy.unknown}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{copy.rounds}</dt>
          <dd className="text-stone-200">
            {!forecast.exact ? copy.unknown : rounds === null ? copy.never : rounds}
          </dd>
        </div>
      </dl>
    </Section>
  );
}
