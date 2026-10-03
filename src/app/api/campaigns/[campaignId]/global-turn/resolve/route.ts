import { z } from "zod";
import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getGlobalTurnState } from "@/lib/db/campaigns";
import { fightersOwing, fightOwnsTable, teamRoundFight } from "@/lib/dm/team-round";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { sealGlobalTurnNow } from "@/lib/dm/global-turn-logic";
import { publishPersisted } from "@/lib/events";
import { enforcePlayerIngress } from "@/lib/ingress-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) return context;
  if (context.campaign.status !== "active") return Response.json({ error: "The campaign is not active." }, { status: 409 });
  // A fight only part of the party is in keeps the team round running.
  if (fightOwnsTable(campaignId) || listOpenPendingRolls(campaignId).length) {
    return Response.json({ error: "Resolve initiative and pending rolls before requesting a response." }, { status: 409 });
  }
  const parsed = z.object({ roundNumber: z.number().int().min(1).optional() }).strict().safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid response request." }, { status: 400 });
  if (!context.campaign.gameSettings.globalTurn?.enabled) {
    const limited = enforcePlayerIngress(campaignId, context.user.id, "action");
    if (limited) return limited;
    const seq = publishPersisted(campaignId, "lead_response_requested", { leadUserId: context.user.id });
    return Response.json({ requested: true, seq });
  }
  const before = getGlobalTurnState(campaignId);
  if (parsed.data.roundNumber !== before.roundNumber || !["active", "quorum_delay"].includes(before.phase)) {
    return Response.json({ error: "This round is not collecting input.", globalTurnState: before }, { status: 409 });
  }
  const limited = enforcePlayerIngress(campaignId, context.user.id, "action");
  if (limited) return limited;
  const after = sealGlobalTurnNow(campaignId, before.roundNumber);
  if (after?.phase !== "ready") {
    const fight = teamRoundFight(campaignId);
    const owing = fight && after ? fightersOwing(campaignId, fight, after).length : 0;
    return Response.json({ error: owing ? "The heroes in the fight have not had their turn this round yet." : "Could not seal this round.", globalTurnState: after }, { status: 409 });
  }
  return Response.json({ requested: true, globalTurnState: after });
}
