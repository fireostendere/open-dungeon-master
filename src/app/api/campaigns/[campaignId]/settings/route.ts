import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { updateGameSettings } from "@/lib/db/campaigns";
import { resetGlobalTurnGate } from "@/lib/dm/global-turn-logic";
import { gameSettingsPatchSchema } from "@/lib/schemas/game-settings";
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
  const parsed = gameSettingsPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid game settings." }, { status: 400 });
  }

  // Accept old clients without re-enabling the retired hosted-AI/media
  // runtime. These fields are stored in legacy schemas for database/import
  // compatibility only; changing them has no execution path.
  const rest = { ...parsed.data };
  delete rest.dmMode;
  delete rest.dmAssist;
  delete rest.aiStorySetup;
  delete rest.narrationGuard;
  delete rest.stages;
  delete rest.ttsEnabled;
  delete rest.ttsVoice;
  delete rest.mapsEnabled;

  const globalTurnWasEnabled = Boolean(context.campaign.gameSettings.globalTurn?.enabled);
  if (!Object.keys(rest).length) {
    return Response.json({ gameSettings: context.campaign.gameSettings });
  }
  const gameSettings = updateGameSettings(campaignId, rest);
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
