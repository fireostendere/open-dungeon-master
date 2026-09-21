import { isErrorResponse, requireMember } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hosted speech generation was removed from the ODM server. Keep the endpoint
// temporarily as an explicit compatibility boundary so old clients fail fast
// instead of attempting a missing media worker.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; messageId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json(
    { error: "Server-side narration audio is not available. Use a client/external speech service." },
    { status: 410 },
  );
}
