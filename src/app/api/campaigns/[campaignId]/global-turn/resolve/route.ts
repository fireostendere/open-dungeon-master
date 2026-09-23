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
        "Global rounds end automatically by quorum/deadline and are resolved by the MCP Dungeon Master. The party lead may only start/re-open a round.",
    },
    { status: 409 },
  );
}
