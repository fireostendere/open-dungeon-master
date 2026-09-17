import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { latestSeq } from "@/lib/db/campaigns";
import { createCampaignStream } from "@/lib/campaign-stream";
import { listEventsSince, sseChunk, subscribe } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;

  const url = new URL(request.url);
  const rawCursor = request.headers.get("last-event-id") ?? url.searchParams.get("lastSeq") ?? "0";
  const afterSeq = Number(rawCursor);
  if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    return Response.json({ error: "Invalid campaign stream cursor." }, { status: 400 });
  }
  const stream = createCampaignStream({
    afterSeq,
    signal: request.signal,
    latestSeq: () => latestSeq(campaignId),
    listEventsSince: (cursor, limit) => listEventsSince(campaignId, cursor, limit),
    subscribe: (send) => subscribe(campaignId, send, context.user.id),
    sseChunk,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
