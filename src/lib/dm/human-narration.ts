import { spatialEnabled, SpatialError } from "@/lib/spatial/service";
import { allocateSeq, getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { announceCurrentTurn, queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";

// The shared, synchronous part of a human narration. Callers own optional
// follow-up work (TTS and model-backed upkeep must stay out of external MCP).
export function persistHumanNarration(campaign: Campaign, content: string, userId: string) {
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

    // A human DM may end the mechanics before writing narration. Keep the
    // submitted turn closed until this message, then expose the already-
    // advanced initiative floor.
    const combatGate = getFloor(campaign.id);
    if (combatGate.mode === "hold" && combatGate.combat &&
      (!combatGate.combat.requiresEndTurn || combatGate.combat.mechanicsResolved) && !listOpenPendingRolls(campaign.id).length) {
      setFloor(campaign.id, combatGate.next);
      publishPersisted(campaign.id, "floor_changed", { floor: combatGate.next });
      if (combatGate.combat.requiresEndTurn) announceCurrentTurn(campaign);
    }

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
