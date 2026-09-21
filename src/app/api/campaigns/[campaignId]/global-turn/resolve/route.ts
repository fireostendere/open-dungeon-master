import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { getGlobalTurnState } from "@/lib/db/campaigns";
import { resolveGlobalTurn } from "@/lib/dm/global-turn-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;

  if (!isLead(context) && !steersStory(context)) {
    return Response.json(
      { error: "Only the party lead or Dungeon Master can force-end a global turn." },
      { status: 403 },
    );
  }

  if (!context.campaign.gameSettings.globalTurn?.enabled) {
    return Response.json({ error: "Global-turn mode is not enabled." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const roundNumber = Number(raw?.roundNumber);
  if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) {
    return Response.json({ error: "A valid roundNumber is required." }, { status: 400 });
  }

  const current = getGlobalTurnState(campaignId);
  if (current.roundNumber !== roundNumber) {
    return Response.json(
      {
        error: "That round is no longer current. Refresh the table before forcing completion.",
        globalTurnState: current,
      },
      { status: 409 },
    );
  }

  if (current.phase === "waiting") {
    return Response.json(
      { error: "The round has not been opened for player input yet.", globalTurnState: current },
      { status: 409 },
    );
  }

  // Idempotent retry: if the automatic quorum/deadline path won the race,
  // report success instead of turning a harmless second click into an error.
  if (current.phase === "ready" || current.phase === "resolving") {
    return Response.json({ globalTurnState: current, alreadySealed: true });
  }

  // This is the same authoritative barrier used by quorum/deadline closure.
  // It persists global_turn_ready, which wakes the external narrator host;
  // no model/provider call happens inside this web request.
  const sealed = await resolveGlobalTurn(campaignId, roundNumber);
  if (
    !sealed ||
    sealed.roundNumber !== roundNumber ||
    (sealed.phase !== "ready" && sealed.phase !== "resolving")
  ) {
    return Response.json(
      {
        error: "The round could not be sealed. Refresh the table and try again.",
        globalTurnState: getGlobalTurnState(campaignId),
      },
      { status: 409 },
    );
  }

  return Response.json({ globalTurnState: sealed, forced: true });
}
