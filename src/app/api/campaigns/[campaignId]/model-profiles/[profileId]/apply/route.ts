import { applyLlmProfileToCampaign } from "@/lib/db/llm-profiles";
import { getLlmProfile } from "@/lib/db/llm-profiles";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { maskStorySettings, scrubStorySettings } from "@/lib/db/settings";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apply an LLM profile to this campaign's story settings. Writes customBaseUrl,
// customModel, customApiKey from the profile into the campaign. Returns the
// masked updated settings so the panel refreshes without a separate GET.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; profileId: string }> },
) {
  const { campaignId, profileId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const profile = getLlmProfile(profileId);
  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }
  const updated = applyLlmProfileToCampaign(profileId, campaignId);
  if (!updated) {
    return Response.json({ error: "Could not apply profile." }, { status: 500 });
  }
  // Same contract as the story-settings PATCH: the room sees the change
  // without a refetch; keys scrubbed because the snapshot goes to everyone.
  publishPersisted(campaignId, "campaign_updated", {
    settings: scrubStorySettings(updated),
  });
  return Response.json({ settings: maskStorySettings(updated) });
}
