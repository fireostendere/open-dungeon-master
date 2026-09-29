// Maps rules-engine rolls to the physical dice the stage throws.

import type { DiceTerm, RollResult } from "@/lib/dice";
import type { DicePaletteId } from "@/lib/fx/dice/atlas";
import { kindForSides, splitPercentile } from "@/lib/fx/dice/geometry";
import type { StageDie } from "@/lib/fx/dice/stage";

/** More than this many dice stop reading as dice; the rest show as chips. */
export const MAX_STAGE_DICE = 20;

export type StagedRoll = {
  dice: StageDie[];
  /** Index of the d20 that decides the roll, if any. */
  hero: number | null;
  /** Dice the table could not show (odd sizes, overflow). */
  hidden: number;
};

export function stageRoll(breakdown: RollResult, palette: DicePaletteId, damagePalette?: DicePaletteId): StagedRoll {
  const dice: StageDie[] = [];
  let hero: number | null = null;
  let hidden = 0;
  for (const term of breakdown.terms) {
    if (term.kind !== "dice") continue;
    for (const die of term.dice) {
      if (dice.length >= MAX_STAGE_DICE) {
        hidden++;
        continue;
      }
      const skin = term.sides === 20 ? palette : damagePalette ?? palette;
      if (term.sides === 100) {
        const { tens, units } = splitPercentile(die.value);
        dice.push({ kind: "d10x", value: tens, palette: skin, dropped: !die.kept });
        dice.push({ kind: "d10", value: units, palette: skin, dropped: !die.kept });
        continue;
      }
      const kind = kindForSides(term.sides);
      if (!kind) {
        hidden++;
        continue;
      }
      if (kind === "d20" && die.kept && hero === null) hero = dice.length;
      dice.push({ kind, value: die.value, palette: skin, dropped: !die.kept });
    }
  }
  return { dice, hero, hidden };
}

/** Dice to float over the table before the result is known. */
export function stageExpression(expression: string, palette: DicePaletteId): StageDie[] {
  const out: StageDie[] = [];
  const re = /(\d*)d(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) && out.length < MAX_STAGE_DICE) {
    const count = Math.min(MAX_STAGE_DICE - out.length, Math.max(1, Number(m[1] || 1)));
    const sides = Number(m[2]);
    for (let i = 0; i < count; i++) {
      if (sides === 100) {
        out.push({ kind: "d10x", value: 10, palette }, { kind: "d10", value: 10, palette });
        continue;
      }
      const kind = kindForSides(sides);
      if (kind) out.push({ kind, value: sides === 4 ? 4 : sides, palette });
    }
  }
  return out;
}

export function diceTerms(breakdown: RollResult | undefined): DiceTerm[] {
  return breakdown?.terms.filter((t): t is DiceTerm => t.kind === "dice") ?? [];
}
