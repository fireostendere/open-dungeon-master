import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import {
  createLlmProfile,
  deleteLlmProfile,
  listLlmProfiles,
  updateLlmProfile,
} from "@/lib/db/llm-profiles";
import { llmProfileCreateSchema } from "@/lib/schemas/llm-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: list all profiles (masked: apiKey replaced with hasApiKey).
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  return Response.json({ profiles: listLlmProfiles() });
}

// POST: create or update a profile.
// If body.id is present, update; otherwise create new.
// apiKey: undefined=keep existing (on update), ""=clear, value=set.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const raw = await request.json().catch(() => ({}));
  const parsed = llmProfileCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid profile data." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  if (input.id) {
    // Update existing
    const updated = updateLlmProfile(input.id, input);
    if (!updated) {
      return Response.json({ error: "Profile not found." }, { status: 404 });
    }
    const { apiKey, ...masked } = updated;
    return Response.json({ profile: { ...masked, hasApiKey: apiKey !== "" } });
  } else {
    // Create new
    const created = createLlmProfile(input);
    const { apiKey, ...masked } = created;
    return Response.json({ profile: { ...masked, hasApiKey: apiKey !== "" } });
  }
}

// DELETE: delete a profile by id (from URL params).
export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Profile id required." }, { status: 400 });
  }

  const deleted = deleteLlmProfile(id);
  if (!deleted) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
