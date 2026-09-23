import { isErrorResponse } from "@/lib/campaign-api";
import { requireMeshVoiceMember } from "@/lib/voice/gate";
import { MESH_HEARTBEAT_MS } from "@/lib/voice/mesh-logic";
import { meshIceServers, meshJoin } from "@/lib/voice/mesh";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  // Resolve ICE before the final authorization check: a mode change while
  // awaiting the broker must not return a roster captured in global mode.
  const initial = await requireMeshVoiceMember(campaignId);
  if (isErrorResponse(initial)) return initial;
  const iceServers = await meshIceServers();
  const context = await requireMeshVoiceMember(campaignId);
  if (isErrorResponse(context)) return context;
  if (context.user.id !== initial.user.id) return Response.json({ error: "The signed-in account changed." }, { status: 409 });
  const peers = meshJoin(campaignId, context.user.id, context.user.username);
  return Response.json({ peers, iceServers, heartbeatMs: MESH_HEARTBEAT_MS },
    { headers: { "Cache-Control": "private, no-store" } });
}
