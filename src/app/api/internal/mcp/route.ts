import { z } from "zod";
import { executeMcpControl, McpControlError } from "@/lib/mcp-control";
import {
  executeMcpExtendedControl,
  extendControlResult,
  McpExtendedControlError,
} from "@/lib/mcp-external-control";
import { executeMcpNarratorControl, McpNarratorControlError } from "@/lib/mcp-narrator-control";
import { withOperationSignal } from "@/lib/operation-scope.mjs";
import { authenticateMcp, authorizeMcpAction, narratorServiceResult, McpAccessError, type McpPrincipal } from "@/lib/mcp-access.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    action: z.string().trim().min(1).max(100),
    params: z.unknown().default({}),
  })
  .strict();

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  let principal: McpPrincipal;
  try { principal = authenticateMcp(request); }
  catch (error) {
    if (error instanceof McpAccessError) return json({ error: error.message }, error.status);
    throw error;
  }

  const raw = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid MCP control request." }, 400);
  }
  try { authorizeMcpAction(principal, parsed.data.action, parsed.data.params); }
  catch (error) {
    if (error instanceof McpAccessError) return json({ ok: false, error: error.message }, error.status);
    throw error;
  }
  // Restricted sidecar health is not a global database/counts endpoint.
  const scopedService = narratorServiceResult(principal, parsed.data.action);
  if (scopedService !== undefined) return json({ ok: true, result: scopedService });

  // This total budget is shorter than the sidecar's 135-second budget.
  // Async-local propagation keeps cancellation scoped to this request only.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
  try {
    return await withOperationSignal(signal, async () => {
      const narrator = await executeMcpNarratorControl(parsed.data.action, parsed.data.params);
      if (narrator.handled) {
        return json({ ok: true, result: narrator.result });
      }
      // Fail closed if a whitelisted action is removed from the narrator handler.
      if (principal.role === "narrator") return json({ ok: false, error: "Narrator action is unavailable." }, 403);
      signal.throwIfAborted();
      const extended = await executeMcpExtendedControl(parsed.data.action, parsed.data.params);
      if (extended.handled) {
        return json({ ok: true, result: extended.result });
      }
      signal.throwIfAborted();
      const result = await executeMcpControl(parsed.data.action, parsed.data.params);
      return json({ ok: true, result: extendControlResult(parsed.data.action, result) });
    });
  } catch (error) {
    if (signal.aborted) {
      return json({ ok: false, error: request.signal.aborted ? "MCP request cancelled." : "MCP operation timed out." }, request.signal.aborted ? 499 : 504);
    }
    if (error instanceof McpControlError || error instanceof McpExtendedControlError || error instanceof McpNarratorControlError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    console.error("MCP control action failed:", parsed.data.action, error);
    return json({ ok: false, error: "MCP control action failed." }, 500);
  }
}
