import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { executeMcpControl, McpControlError } from "@/lib/mcp-control";
import {
  executeMcpExtendedControl,
  extendControlResult,
  McpExtendedControlError,
} from "@/lib/mcp-external-control";
import { executeMcpNarratorControl, McpNarratorControlError } from "@/lib/mcp-narrator-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    action: z.string().trim().min(1).max(100),
    params: z.unknown().default({}),
  })
  .strict();

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(request: Request) {
  const expected = process.env.ODM_MCP_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const supplied = header.slice(prefix.length).trim();
  return supplied.length > 0 && timingSafeEqual(digest(supplied), digest(expected));
}

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
  if (!process.env.ODM_MCP_TOKEN?.trim()) {
    return json({ error: "MCP control plane is disabled." }, 503);
  }
  if (!authorized(request)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const raw = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid MCP control request." }, 400);
  }

  try {
    const narrator = await executeMcpNarratorControl(parsed.data.action, parsed.data.params);
    if (narrator.handled) {
      return json({ ok: true, result: narrator.result });
    }
    const extended = await executeMcpExtendedControl(parsed.data.action, parsed.data.params);
    if (extended.handled) {
      return json({ ok: true, result: extended.result });
    }
    const result = await executeMcpControl(parsed.data.action, parsed.data.params);
    return json({ ok: true, result: extendControlResult(parsed.data.action, result) });
  } catch (error) {
    if (error instanceof McpControlError || error instanceof McpExtendedControlError || error instanceof McpNarratorControlError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    console.error("MCP control action failed:", parsed.data.action, error);
    return json({ ok: false, error: "MCP control action failed." }, 500);
  }
}
