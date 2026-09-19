import { createHash } from "node:crypto";
import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { enforcePlayerIngress } from "@/lib/ingress-budget";
import { runSpatialCommand, spatialContext, spatialStore, SpatialError } from "@/lib/spatial/service";
import { subscribeSpatialChanges, waitForPrivateUpdate } from "@/lib/spatial/updates.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, X-ODM-Expected-User, X-ODM-Actor", "X-ODM-Long-Poll": "1" };
const query = z.object({ roomId: z.string().uuid().nullable(), beforeSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() });
function identityConflict(request: Request, authenticatedUserId: string): Response | null {
  // Both branch contracts are assertions, never authentication.
  const changed = ["x-odm-expected-user", "x-odm-actor"].some(name => request.headers.has(name) && request.headers.get(name) !== authenticatedUserId);
  return changed ? Response.json({ error: "The signed-in account changed. Reload before continuing.", code: "identity_changed" }, { status: 409, headers }) : null;
}
function viewResponse(request: Request, value: unknown) {
  const body = JSON.stringify(value), etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const responseHeaders = { ...headers, ETag: etag, "Content-Type": "application/json" };
  return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers: responseHeaders }) : new Response(body, { headers: responseHeaders });
}
function errorResponse(error: unknown) {
  if (error instanceof SpatialError) return Response.json({ error: error.message }, { status: error.status, headers });
  console.error("Location chat request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "Location chat request failed." }, { status: 500, headers });
}
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const search = new URL(request.url).searchParams;
  const wait = z.number().int().min(0).max(20000).safeParse(Number(search.get("waitMs") ?? 0));
  if (!wait.success) return Response.json({ error: "Invalid waitMs." }, { status: 400, headers });
  // Re-authorize on EVERY wakeup, not just when the connection was opened.
  const load = async () => {
    const context = await requireMember(campaignId);
    if (isErrorResponse(context)) return context;
    const conflict = identityConflict(request, context.user.id); if (conflict) return conflict;
    const { actor } = spatialContext(campaignId, context.user.id), store = spatialStore(), view = store.view(actor);
    if (!view.enabled || !search.has("roomId")) return viewResponse(request, view);
    const input = query.safeParse({ roomId: search.get("roomId") === "ooc" ? null : search.get("roomId"),
      ...(search.has("beforeSeq") ? { beforeSeq: Number(search.get("beforeSeq")) } : {}) });
    if (!input.success) return Response.json({ error: "Invalid history request." }, { status: 400, headers });
    return viewResponse(request, { ...view, ...store.messages(actor, input.data) });
  };
  try {
    return await waitForPrivateUpdate({ load, signal: request.signal,
      waitMs: request.headers.has("if-none-match") ? wait.data : 0,
      subscribe: (listener: () => void) => subscribeSpatialChanges(campaignId, listener) });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    return errorResponse(error);
  }
}
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SpatialError("Missing request body.");
  const decoder = new TextDecoder(); let bytes = 0, body = "";
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
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
  const conflict = identityConflict(request, context.user.id); if (conflict) return conflict;
  const limited = enforcePlayerIngress(campaignId, context.user.id, "action");
  if (limited) return limited;
  try {
    const body = await boundedJson(request);
    const current = await requireVoice(campaignId);
    if (isErrorResponse(current)) return current;
    const changed = identityConflict(request,current.user.id);
    if (changed) return changed;
    if (current.user.id !== context.user.id) return Response.json({error:"The signed-in account changed.",code:"identity_changed"},{status:409,headers});
    return Response.json(runSpatialCommand(campaignId,current.user.id,body),{headers});
  } catch (error) { return errorResponse(error); }
}
