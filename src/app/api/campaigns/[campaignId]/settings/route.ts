import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { setDmMode, updateGameSettings } from "@/lib/db/campaigns";
import { resetGlobalTurnGate } from "@/lib/dm/global-turn-logic";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party-lead game settings edit (allowed in lobby and mid-campaign).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isLead(context) && !steersStory(context)) {
    return Response.json({ error: "Only the party lead or DM can change game settings." }, { status: 403 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = gameSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid game settings." }, { status: 400 });
  }

  // dmMode does not go through the generic merge: the DM seat is an invariant
  // of the mode (setDmMode keeps them in step), and a seat change is news the
  // table is owed, same as the seat route publishes it.
  const { dmMode, ...rest } = parsed.data;
  const globalTurnWasEnabled = Boolean(context.campaign.gameSettings.globalTurn?.enabled);
  let gameSettings = null;
  if (dmMode !== undefined && dmMode !== context.campaign.gameSettings.dmMode) {
    const changed = setDmMode(campaignId, dmMode, context.user.id);
    if (!changed) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    gameSettings = changed.gameSettings;
    publishPersisted(campaignId, "dm_seat_changed", { seat: "dm", userId: changed.dmUserId });
  }
  if (Object.keys(rest).length > 0 || !gameSettings) {
    gameSettings = updateGameSettings(campaignId, rest);
  }
  if (!gameSettings) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  publishPersisted(campaignId, "campaign_updated", { gameSettings });

  // Enabling global-turn mode mid-campaign must not silently open collection.
  // Arm the hard gate and wake the MCP narrator; only its committed narration
  // starts the current round and unlocks player input.
  const globalTurnIsEnabled = Boolean(gameSettings.globalTurn?.enabled);
  if (
    context.campaign.status === "active" &&
    !globalTurnWasEnabled &&
    globalTurnIsEnabled
  ) {
    const waiting = resetGlobalTurnGate(campaignId);
    publishPersisted(campaignId, "global_turn_narrator_trigger", {
      kind: "resume",
      roundNumber: waiting.roundNumber,
    });
  }

  return Response.json({ gameSettings });
}
