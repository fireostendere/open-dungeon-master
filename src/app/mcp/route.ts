import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_UPSTREAM = "http://mcp:3006/mcp";
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function forwardedHeaders(input: Headers) {
  const headers = new Headers();
  for (const [name, value] of input.entries()) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  }
  return headers;
}

async function proxyMcp(request: NextRequest) {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetch(MCP_UPSTREAM, {
      method,
      headers: forwardedHeaders(request.headers),
      body,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
    const headers = forwardedHeaders(upstream.headers);
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: "MCP sidecar is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = proxyMcp;
export const POST = proxyMcp;
export const DELETE = proxyMcp;
export const OPTIONS = proxyMcp;
