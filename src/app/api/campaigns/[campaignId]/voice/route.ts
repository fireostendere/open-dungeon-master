import { isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { announcedAddressFor, isUnroutableAddress, voiceConfig } from "@/lib/voice/config";
import { voiceAvailability } from "@/lib/voice/gate";
import { meshJoined, meshRosterFor } from "@/lib/voice/mesh";
import { roster } from "@/lib/voice/peers";
import { getRoom } from "@/lib/voice/room";
import { voiceAccess } from "@/lib/voice/location-access";
import { projectVoiceRoster, voiceChannel } from "@/lib/voice/location-policy";
import { enforceVoiceScope } from "@/lib/voice/location-runtime";
import { spatialEnabled } from "@/lib/spatial/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  const config = voiceConfig(), availability = voiceAvailability(context.campaign);
  const access = voiceAccess(campaignId);
  const room = getRoom(campaignId);
  if (room) enforceVoiceScope(room);
  const incompatible = access.scope === "location" && config.mode !== "sfu";
  return Response.json({
    available: availability.available && !incompatible,
    unavailableReason: incompatible ? "privacy" : availability.reason,
    mode: config.mode,
    scope: access.scope,
    canManageScope: isLead(context),
    privateScopeAvailable: config.mode === "sfu" && config.enabled && spatialEnabled(campaignId),
    channelId: voiceChannel(access, context.user.id),
    assignedLocation: access.scope === "location" ? Boolean(access.rooms.get(context.user.id)) : true,
    warning: incompatible ? "Private rooms require SFU voice, not browser-to-browser mesh."
      : config.mode === "sfu" && isUnroutableAddress(announcedAddressFor(config))
        ? "Voice will connect but stay silent for remote players: set an announced address or domain." : null,
    joined: config.mode === "mesh" ? meshJoined(campaignId, context.user.id) : Boolean(room?.peers.has(context.user.id)),
    peers: incompatible ? [] : config.mode === "mesh"
      ? projectVoiceRoster(access, context.user.id, meshRosterFor(campaignId)) : roster(room, context.user.id),
  }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
