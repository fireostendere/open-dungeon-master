import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMessagesBefore } from "@/lib/db/messages";
import { spatialEnabled } from "@/lib/spatial/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  if (spatialEnabled(campaignId)) return Response.json({ messages: [], hasMore: false });
  const raw = new URL(request.url).searchParams.get("beforeSeq");
  const beforeSeq = Number(raw);
  if (!raw || !Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
    return Response.json({ error: "Invalid message cursor." }, { status: 400 });
  }
  const page = listMessagesBefore(campaignId, beforeSeq, 101);
  return Response.json({ messages: page.slice(-100), hasMore: page.length > 100 });
}
