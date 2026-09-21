import { z } from "zod";
import { isErrorResponse, isLead, requireMember, steersStory } from "@/lib/campaign-api";
import { setMemberAutopilot } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

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

  // This endpoint only stores the opt-in flag. It never calls a model.
  // Generation is owned by the trusted external narrator host over MCP.
  const isSelf = context.user.id === targetUserId;
  const isLeader = isLead(context);
  const isDm = steersStory(context);
  if (!isSelf && !isLeader && !isDm) {
    return Response.json(
      { error: "Only the player, party lead, or DM can change autopilot settings." },
      { status: 403 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = autopilotSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid autopilot request." }, { status: 400 });
  }

  const member = setMemberAutopilot(campaignId, targetUserId, parsed.data.autopilot);
  if (!member) {
    return Response.json({ error: "Member not found." }, { status: 404 });
  }

  publishPersisted(campaignId, "member_updated", { member });
  return Response.json({ ok: true, member });
}
