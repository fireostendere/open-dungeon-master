import { isErrorResponse, requireMember } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Turn completion is authoritative narrator/engine work. Players may submit
// their declared combat intent or use the skip-turn control, but cannot advance
// initiative directly.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json(
    { error: "Players cannot end initiative directly. Submit your action or use Skip." },
    { status: 410 },
  );
}
