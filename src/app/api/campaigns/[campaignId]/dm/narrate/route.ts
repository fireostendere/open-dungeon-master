import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { persistHumanNarration } from "@/lib/dm/human-narration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's narration. This is the counterpart to the tail of
// startDmTurn: the same message row, the same seq, the same event, the same
// chapter bookkeeping, with inference and media generation kept out of the server. Keeping the shape identical is what lets every downstream
// engine (chapters, compaction, retrieval, export, recap) keep working
// without knowing who wrote the words.
const narrateSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const parsed = narrateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Write something to narrate." }, { status: 400 });
  }

  const message = persistHumanNarration(campaign, parsed.data.content, user.id);

  return Response.json({ messageId: message.id }, { status: 201 });
}
