import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { LEAD_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq, capsFor, getFloor } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Party-lead story steering. The direction is persisted in the transcript;
 // the external narrator consumes durable campaign state instead of a
 // server-hosted DM wake loop.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.status !== "active") {
    return Response.json({ error: "The campaign is not active." }, { status: 409 });
  }

  const raw = await request.json().catch(() => ({}));
  const floor = getFloor(campaignId);
  if (!capsFor(context.campaign, context.user.id).adjudicates && (getActiveEncounter(campaignId) || (floor.mode === "hold" && floor.combat))) {
    return Response.json({ error: "Use your combat action or OOC during combat." }, { status: 409 });
  }
  const content = typeof raw?.content === "string" ? raw.content.trim().slice(0, 1000) : "";
  if (!content) {
    return Response.json({ error: "Write the direction first." }, { status: 400 });
  }
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    userId: context.user.id,
    content: `${LEAD_NOTE_PREFIX}${content}`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });


  return Response.json({ message }, { status: 201 });
}
