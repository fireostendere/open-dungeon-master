import { z } from "zod";
import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { setMemberAutopilot } from "@/lib/db/campaigns";
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

  const isSelf = context.user.id === targetUserId;
  const canModerate = isLead(context) || steersStory(context);
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

  const member = setMemberAutopilot(campaignId, targetUserId, parsed.data.autopilot);
  if (!member) {
    return Response.json({ error: "Member not found." }, { status: 404 });
  }

  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ ok: true, member });
}
