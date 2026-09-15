import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import { maybeCompactHistory } from "@/lib/dm/compaction";
import { persistHumanNarration } from "@/lib/dm/human-narration";
import { enqueueDmJob } from "@/lib/dm/queue";
import { enqueueNarrationAudio } from "@/lib/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human DM's narration. This is the counterpart to the tail of
// startDmTurn: the same message row, the same seq, the same event, the same
// read-aloud and the same chapter bookkeeping, with the model and the tool
// loop cut out. Keeping the shape identical is what lets every downstream
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

  if (campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(
      campaignId,
      message.id,
      parsed.data.content,
      campaign.gameSettings.ttsVoice,
    );
  }

  // Chapter and compaction upkeep runs on the campaign queue, off the
  // request, so a long summary never makes the DM wait to hit send.
  enqueueDmJob(campaignId, async () => {
    await maybeCloseChapter(campaignId, { beatCompleted: false });
    await maybeCompactHistory(campaignId);
  });

  return Response.json({ messageId: message.id }, { status: 201 });
}
