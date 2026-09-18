import { spatialEnabled, SpatialError } from "@/lib/spatial/service";
import { allocateSeq, getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";

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

    if (campaign.gameSettings.holdSubmissions) {
      const current = getFloor(campaign.id);
      if (current.mode !== "hold") {
        const held = { mode: "hold" as const, next: current };
        setFloor(campaign.id, held);
        publishPersisted(campaign.id, "floor_changed", { floor: held });
      }
    }
    return message;
  })());
}
