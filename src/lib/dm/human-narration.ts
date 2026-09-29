import { spatialEnabled, SpatialError } from "@/lib/spatial/service";
import { allocateSeq, getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";
import { combatHandoffState, passCombatTurn } from "@/lib/dm/human-turn-lifecycle";

// The shared, synchronous part of a human narration. Callers own optional
// follow-up work (TTS and model-backed upkeep must stay out of external MCP).
// `passTurn` says whether this message may hand a resolved combat turn to the
// next actor. The DM console's single message does; the external narrator
// passes it only on the last of its messages about the turn, so the table
// stays nobody's while it writes.
export function persistHumanNarration(campaign: Campaign, content: string, userId: string, options: { passTurn?: boolean } = {}) {
  if (spatialEnabled(campaign.id)) throw new SpatialError("Choose a location before narrating in this campaign.", 409);
  return withCommittedEffects(() => getDatabase().transaction(() => {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "dm",
      userId,
      content,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message });

    // A submitted combat turn stays closed until its mechanics are resolved
    // and the handing-over message lands; only then does initiative move.
    if ((options.passTurn ?? true) && combatHandoffState(campaign.id).state === "ready") passCombatTurn(campaign);

    if (campaign.gameSettings.holdSubmissions) {
      const current = getFloor(campaign.id);
      if (current.mode !== "hold") {
        const held = { mode: "hold" as const, next: current };
        setFloor(campaign.id, held);
        publishPersisted(campaign.id, "floor_changed", { floor: held });
      }
    }
    queueSkippedCombatTurn(campaign.id);
    return message;
  })());
}
