import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { probeLlmProfile } from "@/lib/llm-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const probeSchema = z.object({
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  apiKey: z.string().trim().max(400).optional(),
  protocol: z.enum(["openai-compatible", "ollama-native"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

// POST: ad-hoc probe (no saved profile). Returns report without persisting.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const raw = await request.json().catch(() => ({}));
  const parsed = probeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid probe data." }, { status: 400 });
  }

  const { baseUrl, model, apiKey, protocol, timeoutMs } = parsed.data;
  const report = await probeLlmProfile({ baseUrl, model, apiKey, protocol }, { timeoutMs });
  return Response.json({ report });
}
