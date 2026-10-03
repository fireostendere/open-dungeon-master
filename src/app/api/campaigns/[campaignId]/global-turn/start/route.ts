import { isErrorResponse, requireLead } from "@/lib/campaign-api";
import { getGlobalTurnState } from "@/lib/db/campaigns";
import { fightOwnsTable } from "@/lib/dm/team-round";
import { startGlobalTurn } from "@/lib/dm/global-turn-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) return context;

  if (!context.campaign.gameSettings.globalTurn?.enabled) {
    return Response.json({ error: "Global-turn mode is not enabled." }, { status: 409 });
  }
  if (fightOwnsTable(campaignId)) {
    return Response.json(
      { error: "Initiative owns input while combat is active." },
      { status: 409 },
    );
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
        error: "That round is no longer current. Refresh the table before starting it.",
        globalTurnState: current,
      },
      { status: 409 },
    );
  }

  // Never let the recovery button steal a round back from the MCP narrator.
  // It starts WAITING or repairs an already ACTIVE collection window only.
  if (current.phase === "ready" || current.phase === "resolving") {
    return Response.json(
      {
        error: "The MCP Dungeon Master is already resolving this round.",
        globalTurnState: current,
      },
      { status: 409 },
    );
  }

  const started = startGlobalTurn(campaignId, "lead_recovery");
  if (
    !started ||
    started.roundNumber !== roundNumber ||
    (started.phase !== "active" && started.phase !== "quorum_delay")
  ) {
    return Response.json(
      {
        error: "The round could not be opened. Refresh the table and try again.",
        globalTurnState: getGlobalTurnState(campaignId),
      },
      { status: 409 },
    );
  }

  return Response.json({
    globalTurnState: started,
    started: current.phase === "waiting",
    reopened: current.phase === "active" || current.phase === "quorum_delay",
  });
}
