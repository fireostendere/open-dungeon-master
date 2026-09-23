import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { voiceConfig } from "@/lib/voice/config";
import { setVoiceScope } from "@/lib/voice/location-access";
import { enforceVoiceScope, watchVoiceScope } from "@/lib/voice/location-runtime";
import { getRoom } from "@/lib/voice/room";
import { applyAudibility } from "@/lib/voice/apply";
import { publishRoster } from "@/lib/voice/peers";
import { hasMeshPeers } from "@/lib/voice/mesh";
import { spatialEnabled } from "@/lib/spatial/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ scope: z.enum(["global", "location"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const initial = await requireLead(campaignId);
  if (isErrorResponse(initial)) return initial;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Choose global or location voice." }, { status: 400 });
  // Body parsing is asynchronous: do not retain a transferred leader's authority.
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) return context;
  if (context.user.id !== initial.user.id) return Response.json({ error: "The signed-in account changed." }, { status: 409 });
  const config = voiceConfig();
  if (input.data.scope === "location" && (config.mode !== "sfu" || !config.enabled || !spatialEnabled(campaignId))) {
    return Response.json({ error: "Enable SFU voice on the server and location mode in the campaign before selecting private voice rooms." }, { status: 409 });
  }
  if (input.data.scope === "location" && hasMeshPeers(campaignId)) {
    return Response.json({ error: "End existing browser-to-browser calls before enabling private SFU rooms." }, { status: 409 });
  }
  setVoiceScope(campaignId, input.data.scope);
  const room = getRoom(campaignId);
  if (room) {
    watchVoiceScope(room);
    // Revoke first, before awaiting any worker commands or sending success.
    enforceVoiceScope(room);
    await applyAudibility(campaignId);
    publishRoster(campaignId);
  }
  return Response.json({ ok: true, scope: input.data.scope }, { headers: { "Cache-Control": "no-store" } });
}
