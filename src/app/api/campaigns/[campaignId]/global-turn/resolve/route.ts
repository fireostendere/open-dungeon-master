import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { resolveGlobalTurn } from "@/lib/dm/global-turn-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // Only the party lead or the DM can force resolve the turn
  if (!isLead(context) && !steersStory(context)) {
    return Response.json({ error: "Only the party lead or DM can resolve the turn." }, { status: 403 });
  }

  const result = await resolveGlobalTurn(campaignId);
  if (!result) {
    return Response.json({ error: "Failed to resolve turn." }, { status: 400 });
  }

  return Response.json({ ok: true, state: result });
}
