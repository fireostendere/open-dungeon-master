import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { fetchModelList } from "@/lib/llm-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const modelsSchema = z.object({
  baseUrl: z.string().trim().max(500),
  apiKey: z.string().trim().max(400).optional(),
  protocol: z.enum(["openai-compatible", "ollama-native"]).optional(),
});

// POST: fetch model list from an endpoint.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const raw = await request.json().catch(() => ({}));
  const parsed = modelsSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid data." }, { status: 400 });
  }

  const { baseUrl, apiKey } = parsed.data;
  const result = await fetchModelList(baseUrl, apiKey);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ models: result.models });
}
