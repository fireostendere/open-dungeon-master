import { isErrorResponse, requireMember, type MemberContext } from "@/lib/campaign-api";
import { voiceConfig } from "@/lib/voice/config";
import { getVoiceScope } from "@/lib/voice/location-access";

export function voiceAvailability(campaign: { gameSettings: { voice: { enabled: boolean } } }): {
  available: boolean; reason: "" | "server" | "campaign";
} {
  if (!voiceConfig().enabled) return { available: false, reason: "server" };
  if (!campaign.gameSettings.voice.enabled) return { available: false, reason: "campaign" };
  return { available: true, reason: "" };
}
export async function requireVoiceMember(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  const availability = voiceAvailability(context.campaign);
  if (!availability.available) return Response.json({ error: availability.reason === "server"
    ? "Voice chat is switched off on this server." : "Voice chat is switched off for this campaign." }, { status: 403 });
  if (getVoiceScope(campaignId) === "location" && voiceConfig().mode !== "sfu") {
    return Response.json({ error: "Private location voice requires server-relayed SFU audio. Switch the server to SFU or ask the party lead to select global voice." }, { status: 409 });
  }
  return context;
}

export async function requireMeshVoiceMember(campaignId: string): Promise<MemberContext | Response> {
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) return context;
  if (voiceConfig().mode !== "mesh" || getVoiceScope(campaignId) !== "global") {
    return Response.json({ error: "Browser-to-browser voice is only available in global mesh mode." }, { status: 409 });
  }
  return context;
}
