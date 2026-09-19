"use client";

import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { Bg3DiceOverlay } from "./Bg3DiceOverlay";

export function DiceOverlay({
  latestRoll,
  sheets = [],
  enabled = true,
}: {
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  sheets?: CharacterSheet[];
  enabled: boolean;
}) {
  return (
    <Bg3DiceOverlay
      latestRoll={latestRoll}
      sheets={sheets}
      enabled={enabled}
    />
  );
}
