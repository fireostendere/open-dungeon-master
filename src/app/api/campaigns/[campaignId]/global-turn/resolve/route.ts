import { isErrorResponse, requireMember } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;

  return Response.json(
    {
      error:
        "Global rounds close automatically by quorum/deadline and are resolved by the external MCP narrator. Players and the party lead may only submit or skip their turn.",
    },
    { status: 409 },
  );
}
