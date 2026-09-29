// App-port bridge retained from the parallel review. The destination is fixed
// by server configuration; incoming URLs, Host, cookies and tokens cannot pick it.
const REQUEST_HEADERS = new Set(['authorization', 'accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name', 'last-event-id', 'origin']);
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'content-encoding', 'set-cookie']);
class BodyError extends Error {
  constructor(status) { super('Invalid or oversized MCP request body'); this.status = status; }
}
function failure(status, error) {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 401 ? { 'www-authenticate': 'Bearer realm="open-dungeon-master-mcp"' } : {}) } });
}
async function boundedBody(request, signal, maximum) {
  const declared = request.headers.get('content-length');
  if (declared !== null && !/^\d+$/.test(declared)) throw new BodyError(400);
  if (declared !== null && Number(declared) > maximum) throw new BodyError(413);
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let size = 0;
  const chunks = [];
  try {
    signal.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { void reader.cancel().catch(() => {}); throw new BodyError(413); }
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Dependency injection is for tests/server configuration only, never HTTP input. */
// 8 MiB target images need base64 overhead plus the JSON-RPC envelope.
export function createMcpProxy({ upstream = 'http://mcp:3006/mcp', fetchImpl = globalThis.fetch, timeoutMs = 140_000, maximumBytes = 12 * 1024 * 1024 } = {}) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/mcp' || target.search || target.hash) throw new Error('Invalid server MCP proxy destination');
  return async function proxyMcp(request) {
    if (!['GET', 'POST', 'DELETE', 'OPTIONS'].includes(request.method)) return failure(405, 'Method not allowed.');
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || !authorization.slice(7).trim()) return failure(401, 'Unauthorized.');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const headers = new Headers();
      for (const [key, value] of request.headers) if (REQUEST_HEADERS.has(key.toLowerCase()) || key.toLowerCase().startsWith('mcp-param-')) headers.set(key, value);
      // Cookies, forwarding/Host headers and the application's own credential
      // are never forwarded or substituted for the caller's bearer token.
      headers.set('accept-encoding', 'identity');
      const body = request.method === 'GET' ? undefined : await boundedBody(request, signal, maximumBytes);
      signal.throwIfAborted();
      const url = new URL(target);
      url.search = new URL(request.url).search;
      const response = await fetchImpl(url, { method: request.method, headers, body, signal, redirect: 'error', cache: 'no-store' });
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        return failure(502, 'MCP upstream redirects are disabled.');
      }
      const blocked = new Set(HOP_HEADERS);
      for (const token of (response.headers.get('connection') ?? '').split(',')) blocked.add(token.trim().toLowerCase());
      const outgoing = new Headers();
      for (const [key, value] of response.headers) if (!blocked.has(key.toLowerCase())) outgoing.set(key, value);
      outgoing.set('cache-control', 'no-store');
      outgoing.set('x-content-type-options', 'nosniff');
      // Keep SSE/JSON bytes streaming; the client can cancel this same stream.
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing });
    } catch (error) {
      if (error instanceof BodyError) return failure(error.status, error.message);
      if (request.signal.aborted) return failure(499, 'MCP request cancelled.');
      if (signal.aborted) return failure(504, 'MCP upstream timed out.');
      return failure(503, 'MCP sidecar is unavailable.');
    }
  };
}
