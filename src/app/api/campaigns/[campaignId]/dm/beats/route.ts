import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { listDmBeats } from "@/lib/db/dm-beats";
import { recordBeat, storyCutoffAt } from "@/lib/dm/beats";
import {
  BEAT_KINDS,
  BEAT_MAX_CHARS,
  BEAT_SOURCES,
} from "@/lib/dm/beat-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DM's story capture. A beat is a summary of play that happened out loud
// and was never typed, and it lands in the transcript as an ordinary DM
// passage so every memory engine downstream keeps working without knowing
// what a beat is (src/lib/dm/beats.ts).
const beatSchema = z.object({
  body: z.string().trim().min(1).max(BEAT_MAX_CHARS),
  kind: z.enum(BEAT_KINDS).default("scene"),
  // Provenance, not permission: 'drafted' means the DM accepted a model's
  // draft, and they always edited it in a box before it got here.
  source: z.enum(BEAT_SOURCES).default("typed"),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({
    beats: listDmBeats(campaignId, 20),
    // When the uncaptured stretch begins, so the console can say what a
    // draft would be summarizing.
    since: storyCutoffAt(campaignId),
  });
}

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

  const parsed = beatSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Write a sentence or two first." }, { status: 400 });
  }

  const { beat } = recordBeat(campaign, user.id, parsed.data);


  return Response.json({ beat }, { status: 201 });
}
