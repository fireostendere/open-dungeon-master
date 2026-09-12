import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { deleteLlmProfile, getLlmProfile } from "@/lib/db/llm-profiles";
import { maskLlmProfile } from "@/lib/schemas/llm-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: get one profile (masked: apiKey → hasApiKey).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const { profileId } = await params;
  const profile = getLlmProfile(profileId);
  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }
  return Response.json({ profile: maskLlmProfile(profile) });
}

// DELETE: delete a profile.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const { profileId } = await params;
  const deleted = deleteLlmProfile(profileId);
  if (!deleted) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
