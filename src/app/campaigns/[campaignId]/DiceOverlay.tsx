"use client";

import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { Bg3DiceOverlay } from "./Bg3DiceOverlay";

export function DiceOverlay({
  campaignId,
  pendingRolls = [],
  meUserId = "",
  latestRoll,
  sheets = [],
  enabled = true,
}: {
  campaignId?: string;
  pendingRolls?: PendingRoll[];
  meUserId?: string;
  latestRoll: { roll: StoredRoll; source: string; seq: number } | null;
  sheets?: CharacterSheet[];
  enabled: boolean;
}) {
  return (
    <Bg3DiceOverlay
      campaignId={campaignId}
      pendingRolls={pendingRolls}
      meUserId={meUserId}
      latestRoll={latestRoll}
      sheets={sheets}
      enabled={enabled}
    />
  );
}

