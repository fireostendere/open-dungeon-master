import { isErrorResponse } from "@/lib/campaign-api";
import { requireVoiceMember } from "@/lib/voice/gate";
import { joinRoom, publishRoster, roster } from "@/lib/voice/peers";
import { getOrCreateRoom } from "@/lib/voice/room";
import { applyAudibility } from "@/lib/voice/apply";
import { applyVoiceFloor } from "@/lib/voice/turns";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoiceMember(campaignId);
  if (isErrorResponse(context)) return context;
  try {
    const room = await getOrCreateRoom(campaignId);
    const { send, recv } = await joinRoom(campaignId, context.user.id, context.user.username);
    await applyVoiceFloor(campaignId);
    await applyAudibility(campaignId);
    publishRoster(campaignId);
    return Response.json({ routerRtpCapabilities: room.router.rtpCapabilities,
      sendTransport: send, recvTransport: recv, peers: roster(room, context.user.id) },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[voice] join failed", error);
    return Response.json({ error: "Voice chat could not start on this server." }, { status: 500 });
  }
}
