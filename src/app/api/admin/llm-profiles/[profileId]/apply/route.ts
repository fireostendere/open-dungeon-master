import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { applyLlmProfileToCampaign, applyLlmProfileToGlobal, getLlmProfile } from "@/lib/db/llm-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const applySchema = z.object({
  scope: z.enum(["global", "campaign"]),
  campaignId: z.string().optional(),
});

// POST: apply profile to global config or a campaign.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const { profileId } = await params;
  const profile = getLlmProfile(profileId);
  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid apply request." }, { status: 400 });
  }

  const { scope, campaignId } = parsed.data;
  if (scope === "global") {
    const ok = applyLlmProfileToGlobal(profileId);
    if (!ok) return Response.json({ error: "Failed to apply." }, { status: 500 });
    return Response.json({ ok: true, scope: "global" });
  } else {
    if (!campaignId) {
      return Response.json({ error: "campaignId required for campaign scope." }, { status: 400 });
    }
    const ok = applyLlmProfileToCampaign(profileId, campaignId);
    if (!ok) return Response.json({ error: "Campaign not found." }, { status: 404 });
    return Response.json({ ok: true, scope: "campaign", campaignId });
  }
}
