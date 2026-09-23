import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { voiceAccess } from "@/lib/voice/location-access";
import { voiceChannel } from "@/lib/voice/location-policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Compatibility with the existing call controls: show only the current
// channel. A client cannot use this endpoint to pick or enumerate locations.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  const access = voiceAccess(campaignId);
  return Response.json({ channels: [{ id: voiceChannel(access, context.user.id),
    name: access.scope === "global" ? "Global voice" : "Current location" }] },
  { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ error: "Voice rooms follow character locations. Only the party lead can change global/private mode through voice/scope." }, { status: 409 });
}
