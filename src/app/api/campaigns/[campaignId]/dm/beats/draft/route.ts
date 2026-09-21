import { isErrorResponse, requireDm } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json(
    { error: "Server-side beat drafting is not available. Draft externally or write the beat directly." },
    { status: 410 },
  );
}
