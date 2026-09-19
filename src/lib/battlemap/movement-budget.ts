import { exhaustionSpeed, effectiveSpeed } from "@/lib/dm/condition-logic";
import { speedFor } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { speedToTiles } from "@/lib/battlemap/movement";

// DB-free movement allowance shared by the authoritative move route and its
// player projection, so highlights cannot advertise a move the route rejects.
export function movementBudget(input: {
  sheet: CharacterSheet;
  encumbrance?: boolean;
  movedThisRound: number;
  dashed?: boolean;
  sceneBudget?: number;
}): { speed: number; remaining: number } {
  const base = speedFor(input.sheet, { encumbrance: input.encumbrance });
  const speed = exhaustionSpeed(input.sheet.exhaustion ?? 0, effectiveSpeed(input.sheet.conditions, base));
  if (speed <= 0) return { speed, remaining: 0 };
  if (input.sceneBudget !== undefined) return { speed, remaining: input.sceneBudget };
  return {
    speed,
    remaining: Math.max(0, speedToTiles(speed) * (input.dashed ? 2 : 1) - input.movedThisRound),
  };
}
