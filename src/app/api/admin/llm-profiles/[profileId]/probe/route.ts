import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getLlmProfile, updateLlmProfileCheck } from "@/lib/db/llm-profiles";
import { probeLlmProfile } from "@/lib/llm-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: run probe for a saved profile. Updates lastCheck in the profile.
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

  const body = await request.json().catch(() => ({}));
  const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;

  const report = await probeLlmProfile(
    {
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      protocol: profile.protocol,
    },
    { timeoutMs },
  );

  // Persist lastCheck
  const now = new Date().toISOString();
  updateLlmProfileCheck(profileId, {
    at: now,
    ok: report.ok,
    stages: report.stages,
  });

  // Return masked profile + report
  const { apiKey, ...masked } = profile;
  return Response.json({
    profile: { ...masked, hasApiKey: apiKey !== "" },
    report,
  });
}
