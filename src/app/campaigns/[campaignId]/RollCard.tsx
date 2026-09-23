"use client";

import { Dices } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StoredRoll } from "@/lib/db/rolls";
import type { DiceTerm } from "@/lib/dice";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

export function RollCard({
  roll,
  characterName,
  standalone = false,
}: {
  roll: StoredRoll;
  characterName?: string;
  standalone?: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { skill_check: "Skill check", saving_throw: "Saving throw", ability_check: "Ability check", attack: "Attack roll", damage: "Damage", initiative: "Initiative", custom: "Roll", result: "Dice result", hidden: "rolled behind the screen", success: "success", failure: "failure", natural20: "Natural 20!", natural1: "Natural 1", advantage: "Advantage", disadvantage: "Disadvantage", modifier: "Modifier" }, ru: { skill_check: "Проверка навыка", saving_throw: "Спасбросок", ability_check: "Проверка характеристики", attack: "Бросок атаки", damage: "Урон", initiative: "Инициатива", custom: "Бросок", result: "Результат броска", hidden: "брошено за ширмой", success: "успех", failure: "провал", natural20: "Натуральные 20!", natural1: "Натуральная 1", advantage: "Преимущество", disadvantage: "Помеха", modifier: "Модификатор" } });
  const label = copy[roll.kind as keyof typeof copy] ?? copy.custom;
  const detail = roll.detail ? roll.detail.replaceAll("_", " ") : "";

  // A blind roll: the table sees that the dice went, and what for, and not
  // how they landed. The server stripped the number before it ever reached
  // this browser (src/lib/dm/viewer.ts).
  if ((roll as { hidden?: boolean }).hidden) {
    return (
      <div className={cn(
        standalone ? "flex w-full max-w-2xl animate-fade-up flex-wrap items-center gap-2 rounded-xl border border-stone-700/70 bg-stone-900/70 px-4 py-3 text-sm text-stone-400 shadow-elev-1" : "inline-flex animate-fade-up items-center gap-2 rounded-lg border border-stone-700/70 bg-stone-900/70 px-3 py-2 text-sm text-stone-400 shadow-elev-1",
      )}>
        <Dices className="size-4 text-stone-500" />
        {standalone ? <span className="eyebrow text-[10px] text-stone-500">{copy.result}</span> : null}
        <span>
          {characterName ? `${characterName} · ` : ""}
          {label}
          {detail ? ` (${detail})` : ""}
        </span>
         <span className="text-xs text-stone-600">{copy.hidden}</span>
      </div>
    );
  }

  const diceTerms = roll.breakdown.terms.filter(
    (term): term is DiceTerm => term.kind === "dice",
  );
  const modifierTerms = roll.breakdown.terms
    .filter((term) => term.kind === "modifier")
    .map((term) => `${term.sign < 0 ? "-" : "+"}${term.value}`)
    .join(" ");
  const rollMode = roll.advantage === "advantage" ? copy.advantage : roll.advantage === "disadvantage" ? copy.disadvantage : "";

  return (
    <div
      className={cn(
        standalone ? "flex w-full max-w-2xl animate-fade-up flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm shadow-elev-1" : "inline-flex animate-fade-up flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm shadow-elev-1",
        roll.breakdown.crit === "nat20" &&
          "border-amber-500/60 bg-amber-950/40 shadow-glow-gold-strong",
        roll.breakdown.crit === "nat1" && "border-ember-500/60 bg-red-950/40 shadow-glow-ember",
        !roll.breakdown.crit && "border-stone-700/70 bg-stone-900/70",
      )}
    >
      {standalone ? <span className="eyebrow basis-full text-[10px] text-amber-300/80">{copy.result}</span> : null}
      <span className="flex items-center gap-1.5 text-stone-300">
        <Dices className="size-4 text-amber-300" />
        {characterName ? `${characterName} · ` : ""}
        {label}
        {detail ? ` (${detail})` : ""}
      </span>
      <span className="font-mono text-stone-400">{roll.expression}</span>
      <span className="font-mono text-xs text-stone-500">
        {diceTerms
          .map((term) =>
            term.dice
              .map((die) => {
                const value = die.rerolledFrom === undefined ? String(die.value) : `${die.rerolledFrom}→${die.value}`;
                return die.kept ? value : `(${value})`;
              })
              .join(" "),
          )
          .join(" | ")}
      </span>
      {modifierTerms ? <span className="text-xs text-stone-400">{copy.modifier} {modifierTerms}</span> : null}
      {rollMode ? <span className="rounded-full bg-stone-800/80 px-2 py-0.5 text-xs text-stone-300">{rollMode}</span> : null}
      <span
        className={cn(
          "font-mono text-base font-semibold",
          roll.breakdown.crit === "nat20" && "text-amber-200",
          roll.breakdown.crit === "nat1" && "text-ember-300",
        )}
      >
        = {roll.total}
      </span>
      {roll.dc !== null ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            roll.success ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300",
          )}
        >
           DC {roll.dc} · {roll.success ? copy.success : copy.failure}
        </span>
      ) : null}
      {roll.breakdown.crit === "nat20" ? (
         <span className="animate-twinkle text-xs font-semibold text-amber-200">{copy.natural20}</span>
      ) : roll.breakdown.crit === "nat1" ? (
         <span className="text-xs font-medium text-ember-300">{copy.natural1}</span>
      ) : null}
    </div>
  );
}
