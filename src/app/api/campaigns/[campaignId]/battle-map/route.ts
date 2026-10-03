import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { spatialBattleMapView } from "@/lib/spatial/battle-map";
import { viewerFights } from "@/lib/dm/team-round";
import { withFight } from "@/lib/spatial/publication-scope.mjs";
import { spatialEnabled } from "@/lib/spatial/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's fogged projection of the active battle map. In spatial mode
// the direct route is additionally room/version scoped: leaving the room
// freezes the last observed projection instead of following the live board.
// The shared stream carries only the contentless battle_map_updated ping.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const view = () => spatialBattleMapView(campaignId, context.user.id, {
    fullVision: capsFor(context).fullMap,
  });
  // Without rooms every fight's board is watchable: the one asked for, else
  // the viewer's own, else the first running (src/lib/dm/team-round.ts).
  const shown = spatialEnabled(campaignId) ? undefined
    : viewerFights(campaignId, context.user.id, new URL(request.url).searchParams.get("encounterId")).shown?.id ?? null;
  return Response.json(
    {
      view: shown === undefined ? view() : withFight(campaignId, shown, view),
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
      },
    },
  );
}
