import { createMcpProxy } from "@/lib/mcp-proxy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-only setting, never derived from the incoming Host, query or cookies.
// Managed Caddy normally routes /mcp straight to the sidecar; this bridge also
// supports installations exposing the application port without managed Caddy.
const proxyMcp = createMcpProxy({ upstream: process.env.ODM_MCP_PROXY_URL || "http://mcp:3006/mcp" });
export const GET = proxyMcp;
export const POST = proxyMcp;
export const DELETE = proxyMcp;
export const OPTIONS = proxyMcp;
