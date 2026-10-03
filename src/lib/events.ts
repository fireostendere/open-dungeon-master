// The durable event bus is unchanged. Voice live frames require a per-viewer
// projection before they enter it, just like private location HTTP responses.
export * from "@/lib/events-core";
import * as bus from "@/lib/events-core";
import type { EventScope } from "@/lib/spatial/event-privacy";
import { voiceAccess } from "@/lib/voice/location-access";
import { mayShareVoice, projectVoiceRoster } from "@/lib/voice/location-policy";
import type { VoiceRosterEntry } from "@/lib/voice/types";
import { floorFightId } from "@/lib/db/fight-scope";

// A fight's floor change names its fight, so every client applies only the
// floor that is theirs: fights at two places run side by side and the table
// keeps its own floor (src/lib/db/fight-scope.ts).
function tagFloor(campaignId: string, type: string, payload: unknown): unknown {
  if (type !== "floor_changed" || !payload || typeof payload !== "object" || "encounterId" in payload) return payload;
  const fightId = floorFightId(campaignId);
  return fightId ? { ...payload, encounterId: fightId } : payload;
}
export function publishPersisted(campaignId: string, type: string, payload: unknown, scope?: EventScope) {
  return bus.publishPersisted(campaignId, type, tagFloor(campaignId, type, payload), scope);
}
export function publishWithSeq(campaignId: string, seq: number, type: string, payload: unknown, scope?: EventScope) {
  return bus.publishWithSeq(campaignId, seq, type, tagFloor(campaignId, type, payload), scope);
}

export function publishEphemeral(campaignId: string, type: string, payload: unknown, scope?: EventScope) {
  if (type !== "voice_roster" && type !== "voice_speaking" && type !== "voice_audibility_changed") {
    return bus.publishEphemeral(campaignId, type, payload, scope);
  }
  const access = voiceAccess(campaignId);
  if (access.scope !== "location") {
    return bus.publishEphemeral(campaignId, type, payload, scope);
  }
  const body = payload as { peers?: VoiceRosterEntry[]; userId?: string } | null;
  for (const userId of access.members) {
    if (type === "voice_roster") {
      bus.publishUserEphemeral(campaignId, userId, type, {
        peers: projectVoiceRoster(access, userId, Array.isArray(body?.peers) ? body.peers : []),
      });
    } else if (type === "voice_speaking") {
      const speakerId = typeof body?.userId === "string" ? body.userId : "";
      if (!speakerId || mayShareVoice(access, userId, speakerId)) {
        bus.publishUserEphemeral(campaignId, userId, type, { userId: speakerId });
      }
    } else {
      bus.publishUserEphemeral(campaignId, userId, type, {});
    }
  }
}

export function publishOocMessage(campaignId: string, message: Record<string, unknown>) {
  publishEphemeral(campaignId, "ooc_message", { message }, { kind: "global" });
}
