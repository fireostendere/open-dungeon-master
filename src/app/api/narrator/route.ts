import { z } from "zod";
import { executeMcpNarratorControl, McpNarratorControlError } from "@/lib/mcp-narrator-control";
import { withOperationSignal } from "@/lib/operation-scope.mjs";
import {
  authenticateMcp,
  authorizeMcpAction,
  narratorServiceResult,
  McpAccessError,
  type McpPrincipal,
} from "@/lib/mcp-access.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: z.string().trim().min(1).max(100),
  params: z.unknown().default({}),
}).strict();

function json(body: unknown, status = 200, startedAt = 0) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (startedAt) headers["Server-Timing"] = `odm;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`;
  return Response.json(body, { status, headers });
}

/** Campaign-scoped HTTPS control gateway; the broad internal API stays private. */
export async function POST(request: Request) {
  const startedAt = performance.now();
  let principal: McpPrincipal;
  try {
    principal = authenticateMcp(request);
    if (principal.role !== "narrator") throw new McpAccessError("Narrator credential required.", 403);
  } catch (error) {
    if (error instanceof McpAccessError) return json({ error: error.message }, error.status, startedAt);
    throw error;
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid narrator control request." }, 400, startedAt);
  try {
    authorizeMcpAction(principal, parsed.data.action, parsed.data.params);
    const health = narratorServiceResult(principal, parsed.data.action);
    if (health !== undefined) return json({ ok: true, result: health }, 200, startedAt);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
    return await withOperationSignal(signal, async () => {
      const narrator = await executeMcpNarratorControl(parsed.data.action, parsed.data.params);
      if (!narrator.handled) return json({ ok: false, error: "Narrator action is unavailable." }, 403, startedAt);
      return json({ ok: true, result: narrator.result }, 200, startedAt);
    });
  } catch (error) {
    if (error instanceof McpAccessError || error instanceof McpNarratorControlError) {
      return json({ ok: false, error: error.message }, error.status, startedAt);
    }
    return json({ ok: false, error: "Narrator control action failed." }, 500, startedAt);
  }
}

