import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getCampaignById, getGlobalTurnState, kickCampaignPlayer } from "@/lib/db/campaigns";
import { afterCommit, withCommittedEffects } from "@/lib/db/commit-effects";
import { getDatabase } from "@/lib/db/core";
import { publishPersisted } from "@/lib/events";
import { refreshGlobalTurnReadiness, sealGlobalTurnNow } from "@/lib/dm/global-turn-logic";
import { applyAudibility } from "@/lib/voice/apply";
import { meshLeave } from "@/lib/voice/mesh";
import { leaveRoom, publishRoster } from "@/lib/voice/peers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; userId: string }> },
) {
  const { campaignId, userId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  if (!userId || userId.length > 80) {
    return Response.json({ error: "Invalid player id." }, { status: 400 });
  }
  const result = withCommittedEffects(() => getDatabase().transaction(() => {
    const kicked = kickCampaignPlayer(campaignId, context.user.id, userId);
    if ("error" in kicked) return kicked;
    publishPersisted(campaignId, "member_removed", { userId, kickedBy: context.user.id }, { kind: "global" });
    const campaign = getCampaignById(campaignId);
    const round = getGlobalTurnState(campaignId);
    if (campaign?.status === "active" && campaign.gameSettings.globalTurn.enabled && round.firstActionAt
      && (round.phase === "active" || round.phase === "quorum_delay")) {
      const readiness = refreshGlobalTurnReadiness(campaignId);
      if (readiness.shouldResolve) sealGlobalTurnNow(campaignId, round.roundNumber);
    }
    afterCommit(async () => {
      meshLeave(campaignId, userId);
      if (leaveRoom(campaignId, userId)) {
        await applyAudibility(campaignId);
        publishRoster(campaignId);
      }
    });
    return kicked;
  })());
  return "error" in result
    ? Response.json({ error: result.error }, { status: result.status })
    : Response.json({ ok: true });
}
