import { z } from "zod";
import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { getMember, getGlobalTurnState, setMemberAutopilot } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { publishPersisted } from "@/lib/events";
import { mayChangeAutopilot } from "@/lib/autopilot-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const autopilotSchema = z.object({
  autopilot: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; userId: string }> },
) {
  const { campaignId, userId: targetUserId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // State-only opt-in. The server never runs a model here; the external
  // narrator host generates an actor intent and writes it through MCP.
  const raw = await request.json().catch(() => ({}));
  const parsed = autopilotSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid autopilot request." }, { status: 400 });
  }

  // Enabling means consenting to let an isolated actor model author this
  // character's turn. That consent is personal. Lead/DM may still disable an
  // already enabled autopilot to keep the table moving or stop automation.
  if (!mayChangeAutopilot({
    actorUserId: context.user.id,
    targetUserId,
    enable: parsed.data.autopilot,
    isLead: isLead(context),
    isDm: steersStory(context),
  })) {
    return Response.json(
      { error: parsed.data.autopilot
        ? "Only the player can enable autopilot for their own character."
        : "Only the player, party lead, or DM can disable autopilot." },
      { status: 403 },
    );
  }

  const previous = getMember(campaignId, targetUserId);
  if (!previous) {
    return Response.json({ error: "Member not found." }, { status: 404 });
  }
  const sheet = listSheets(campaignId).find(s => s.userId === targetUserId && !s.isCompanion);
  if (parsed.data.autopilot && (!sheet || targetUserId === context.campaign.dmUserId)) {
    return Response.json({ error: "Autopilot requires a player character." }, { status: 409 });
  }
  if (previous.autopilot === parsed.data.autopilot) {
    return Response.json({ ok: true, member: previous });
  }

  const member = withCommittedEffects(() => getDatabase().transaction(() => {
    const updated = setMemberAutopilot(campaignId, targetUserId, parsed.data.autopilot)!;
    publishPersisted(campaignId, "member_updated", { member: updated });
    if (updated.autopilot && sheet) {
      // Handoff wakes existing MCP/OpenCode/CLI listeners in every phase.
      // The narrator rereads the floor/initiative before acting; this signal
      // does not unlock input, roll dice or grant an out-of-turn action.
      publishPersisted(campaignId, "autopilot_action_requested", {
        characterId: sheet.id,
        userId: targetUserId,
        controller: "narrator",
        reason: "autopilot_enabled",
        ...(context.campaign.gameSettings?.globalTurn?.enabled
          ? { roundNumber: getGlobalTurnState(campaignId).roundNumber } : {}),
      });
    }
    return updated;
  })());

  return Response.json({ ok: true, member });
}
