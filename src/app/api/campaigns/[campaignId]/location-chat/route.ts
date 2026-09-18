import { createHash } from "node:crypto";
import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { enforcePlayerIngress } from "@/lib/ingress-budget";
import { runSpatialCommand, spatialContext, spatialStore, SpatialError } from "@/lib/spatial/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const query = z.object({ roomId: z.string().uuid().nullable(), beforeSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() });
function viewResponse(request: Request, value: unknown) {
  const body = JSON.stringify(value), etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const responseHeaders = { ...headers, ETag: etag, "Content-Type": "application/json" };
  return request.headers.get("if-none-match") === etag
    ? new Response(null, { status: 304, headers: responseHeaders })
    : new Response(body, { headers: responseHeaders });
}
function errorResponse(error: unknown) {
  if (error instanceof SpatialError) return Response.json({ error: error.message }, { status: error.status, headers });
  console.error("Location chat request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "Location chat request failed." }, { status: 500, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  try {
    const { actor } = spatialContext(campaignId, context.user.id), store = spatialStore(), view = store.view(actor);
    const search = new URL(request.url).searchParams;
    if (!view.enabled || !search.has("roomId")) return viewResponse(request, view);
    const input = query.safeParse({ roomId: search.get("roomId") === "ooc" ? null : search.get("roomId"),
      ...(search.has("beforeSeq") ? { beforeSeq: Number(search.get("beforeSeq")) } : {}) });
    if (!input.success) return Response.json({ error: "Invalid history request." }, { status: 400, headers });
    return viewResponse(request, { ...view, ...store.messages(actor, input.data) });
  } catch (error) { return errorResponse(error); }
}

// Bound the actual streamed bytes, not just an optional Content-Length header.
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SpatialError("Missing request body.");
  const decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 40_000) { await reader.cancel(); throw new SpatialError("Request body is too large.", 413); }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    try { return JSON.parse(body); } catch { throw new SpatialError("Invalid JSON body."); }
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) return context;
  const limited = enforcePlayerIngress(campaignId, context.user.id, "action");
  if (limited) return limited;
  try {
    const body = await boundedJson(request);
    return Response.json(runSpatialCommand(campaignId, context.user.id, body), { headers });
  } catch (error) { return errorResponse(error); }
}
