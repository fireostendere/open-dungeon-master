import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { comfyStatus, generateComfyImage } from "@/lib/comfyui";
import { assertSafeEndpointUrl } from "@/lib/url-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageProbeSchema = z.object({
  url: z.string().trim().max(500).optional(),
  checkpoint: z.string().trim().max(300).optional(),
  prompt: z.string().trim().max(500).optional(),
});

// POST: probe ComfyUI — check status, optionally generate a test image.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;

  const raw = await request.json().catch(() => ({}));
  const parsed = imageProbeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid data." }, { status: 400 });
  }

  const { url, checkpoint, prompt } = parsed.data;

  // SSRF guard on URL
  if (url) {
    try {
      assertSafeEndpointUrl(url);
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "Invalid URL" }, { status: 400 });
    }
  }

  const startedAt = Date.now();

  // Step 1: check status + list checkpoints
  const status = await comfyStatus(url);
  if (!status.ok) {
    return Response.json({
      ok: false,
      error: status.error,
      checkpoints: status.checkpoints,
      ms: Date.now() - startedAt,
    });
  }

  // If a specific checkpoint was requested but not found, report with installed list
  if (checkpoint && !status.checkpoints.includes(checkpoint)) {
    return Response.json({
      ok: false,
      error: `Checkpoint «${checkpoint}» not found. Installed: ${status.checkpoints.join(", ") || "(none)"}`,
      checkpoints: status.checkpoints,
      ms: Date.now() - startedAt,
    });
  }

  // If no generate requested, just return status
  if (!prompt) {
    return Response.json({
      ok: true,
      checkpoints: status.checkpoints,
      ms: Date.now() - startedAt,
    });
  }

  // Step 2: generate a test image
  try {
    const image = await generateComfyImage({
      url,
      checkpoint,
      prompt: prompt || "test image, simple shapes",
      mode: "fast",
      aspect: "square",
      seed: 42,
    });
    return Response.json({
      ok: true,
      checkpoints: status.checkpoints,
      imagePath: image.url,
      elapsedSeconds: image.elapsedSeconds,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : "Generation failed",
      checkpoints: status.checkpoints,
      ms: Date.now() - startedAt,
    });
  }
}
