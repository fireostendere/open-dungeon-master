// The durable event bus is unchanged. Voice live frames require a per-viewer
// projection before they enter it, just like private location HTTP responses.
export * from "@/lib/events-core";
import * as bus from "@/lib/events-core";
import type { EventScope } from "@/lib/spatial/event-privacy";
import { voiceAccess } from "@/lib/voice/location-access";
import { mayShareVoice, projectVoiceRoster } from "@/lib/voice/location-policy";
import type { VoiceRosterEntry } from "@/lib/voice/types";

export function publishEphemeral(campaignId: string, type: string, payload: unknown, scope?: EventScope) {
  if (type !== "voice_roster" && type !== "voice_speaking" && type !== "voice_audibility_changed") {
    return bus.publishEphemeral(campaignId, type, payload, scope);
  }
  const access = voiceAccess(campaignId);
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
