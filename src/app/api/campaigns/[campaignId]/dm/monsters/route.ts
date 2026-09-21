import { isErrorResponse, requireDm } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ delegated: false, ready: [] });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json(
    { error: "Server-side monster AI is not available. Run monsters manually or through the external narrator." },
    { status: 410 },
  );
}
