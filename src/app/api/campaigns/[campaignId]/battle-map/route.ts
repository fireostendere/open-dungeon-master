import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { spatialBattleMapView } from "@/lib/spatial/battle-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's fogged projection of the active battle map. In spatial mode
// the direct route is additionally room/version scoped: leaving the room
// freezes the last observed projection instead of following the live board.
// The shared stream carries only the contentless battle_map_updated ping.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(
    {
      view: spatialBattleMapView(campaignId, context.user.id, {
        fullVision: capsFor(context).fullMap,
      }),
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
      },
    },
  );
}
