import { capsFor, isErrorResponse, requireStoryAuthority, requireMember } from "@/lib/campaign-api";
import { closeChapterRow, ensureOpenChapter, listChapters } from "@/lib/db/chapters";
import { captureBoundarySnapshot, listRewindableChapters } from "@/lib/db/snapshots-store";
import { countMessagesUpToSeq } from "@/lib/db/messages";
import { latestSeq } from "@/lib/db/campaigns";
import { projectSpatialChapters, spatialLegacyPolicy } from "@/lib/spatial/legacy-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Story so far: every chapter plus how far the open one has progressed.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const policy = spatialLegacyPolicy({
    campaignId, userId: context.user.id, adjudicates: capsFor(context).adjudicates, ownedCharacterIds: [],
  });
  const visibleChapters = projectSpatialChapters(policy, listChapters(campaignId));
  if (policy.scoped) {
    return Response.json({ chapters: visibleChapters, openMessageCount: 0, rewindableChapters: [] });
  }
  const open = ensureOpenChapter(campaignId);
  const openMessageCount =
    countMessagesUpToSeq(campaignId, latestSeq(campaignId)) -
    (open.seqStart > 0 ? countMessagesUpToSeq(campaignId, open.seqStart - 1) : 0);
  return Response.json({
    chapters: visibleChapters,
    openMessageCount,
    // Chapters the lead may rewind to (a boundary snapshot exists).
    rewindableChapters: listRewindableChapters(campaignId),
  });
}

// Party lead: close the current chapter now. No model is involved; title,
 // summary and highlights remain editable through the chapter PATCH route.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) return context;
  const chapter = ensureOpenChapter(campaignId);
  const seqEnd = latestSeq(campaignId);
  const result = closeChapterRow(chapter.id, {
    title: chapter.title || `Chapter ${chapter.index}`,
    summary: chapter.summary,
    highlights: chapter.highlights,
    seqEnd,
  });
  if (!result) return Response.json({ error: "Chapter is no longer open." }, { status: 409 });
  captureBoundarySnapshot(campaignId, result.opened.index, seqEnd);
  return Response.json({ ok: true, closed: result.closed, opened: result.opened });
}
