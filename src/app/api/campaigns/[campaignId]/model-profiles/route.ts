import { listLlmProfiles } from "@/lib/db/llm-profiles";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List available LLM profiles for the story authority to apply to this campaign.
// Returns masked profiles (no API keys exposed).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const profiles = listLlmProfiles();
  return Response.json({ profiles });
}
