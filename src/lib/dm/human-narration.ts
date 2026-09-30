import { spatialEnabled, SpatialError } from "@/lib/spatial/service";
import { allocateSeq, getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { insertCampaignMessage, latestMessage, updateMessageContent } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";
import { combatHandoffState, passCombatTurn } from "@/lib/dm/human-turn-lifecycle";

// The shared, synchronous part of a human narration. Callers own optional
// follow-up work (TTS and model-backed upkeep must stay out of external MCP).
// `passTurn` says whether this message may hand a resolved combat turn to the
// next actor. The DM console's single message does; the external narrator
// passes it only on the last of its messages about the turn, so the table
// stays nobody's while it writes.
const SCENE_JOIN_MS = 5 * 60_000;
const SCENE_MAX_CHARS = 8000;

// `continueScene`: a narration written before anyone else has spoken extends the
// narrator's previous scene message instead of stacking a second DM post (the
// usual case: resolve the declarations, start the fight, describe the first clash).
export function persistHumanNarration(campaign: Campaign, content: string, userId: string, options: { passTurn?: boolean; continueScene?: boolean } = {}) {
  if (spatialEnabled(campaign.id)) throw new SpatialError("Choose a location before narrating in this campaign.", 409);
  return withCommittedEffects(() => getDatabase().transaction(() => {
    const last = options.continueScene ? latestMessage(campaign.id) : null;
    const joined = last && last.authorType === "dm" && last.userId === userId &&
      Date.now() - Date.parse(last.createdAt) < SCENE_JOIN_MS &&
      last.content.length + content.length + 2 <= SCENE_MAX_CHARS
      ? updateMessageContent(last.id, `${last.content}\n\n${content}`)
      : null;
    let message: ReturnType<typeof insertCampaignMessage> & { appended?: true };
    if (joined) {
      message = Object.assign(joined, { appended: true as const });
      publishPersisted(campaign.id, "message_updated", { message: joined });
    } else {
      const seq = allocateSeq(campaign.id);
      message = insertCampaignMessage({
        campaignId: campaign.id,
        seq,
        authorType: "dm",
        userId,
        content,
      });
      publishWithSeq(campaign.id, seq, "message_added", { message });
    }

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
