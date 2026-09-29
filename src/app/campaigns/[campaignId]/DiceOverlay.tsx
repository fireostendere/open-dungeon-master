"use client";

import { useMemo } from "react";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { DiceRollOverlay } from "./DiceRollOverlay";

export function DiceOverlay({
  campaignId,
  pendingRolls = [],
  meUserId = "",
  latestRoll,
  sheets = [],
  encounter = null,
  enabled = true,
}: {
  campaignId?: string;
  pendingRolls?: PendingRoll[];
  meUserId?: string;
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  sheets?: CharacterSheet[];
  encounter?: PublicEncounter | null;
  enabled: boolean;
}) {
  // Visible enemies name the target of attacks and damage on the roll plate.
  const enemies = useMemo(
    () =>
      (encounter?.enemies ?? [])
        .filter((enemy) => !enemy.hidden)
        .map((enemy) => ({ id: enemy.id, name: enemy.name, health: enemy.health, hpPercent: enemy.hpPercent })),
    [encounter?.enemies],
  );
  return (
    <DiceRollOverlay
      campaignId={campaignId}
      pendingRolls={pendingRolls}
      meUserId={meUserId}
      latestRoll={latestRoll}
      sheets={sheets}
      enemies={enemies}
      enabled={enabled}
    />
  );
}
