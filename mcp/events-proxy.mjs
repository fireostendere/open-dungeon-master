// GET /mcp/events: the narrator doorbell relay. The caller is authenticated by
// server.mjs exactly like /mcp; this module only picks the campaign, forwards
// the credential the MCP tools would use, and streams the application's
// contentless signal frames through as they arrive.

const SSE_HEADERS = Object.freeze({
  'content-type': 'text/event-stream',
  'cache-control': 'private, no-store, no-transform',
  'x-accel-buffering': 'no',
  connection: 'keep-alive',
  'x-content-type-options': 'nosniff',
});
// Upstream bodies are never relayed: only a fixed message per status.
const UPSTREAM_ERRORS = Object.freeze({
  400: 'Invalid event stream request.',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Campaign not found.',
  503: 'ODM event stream is unavailable.',
});

function sendJson(res, status, error, extra = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify({ error }));
}

/** `<control URL>/events`; the control URL is the /api/internal/mcp endpoint. */
export function eventsUrlFrom(controlUrl) {
  const url = new URL(String(controlUrl));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('ODM control URL must be an absolute HTTP(S) URL without credentials, query or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/events`;
  return url;
}

/** Dependency injection is for server configuration and tests, never HTTP input. */
export function createEventsProxy({ controlUrl, narratorOnly = false, narratorCampaignId = '', upstreamToken = '', fetchImpl = globalThis.fetch } = {}) {
  const base = eventsUrlFrom(controlUrl);
  return async function proxyEvents(req, res, { bearer = '', signal } = {}) {
    if (req.method !== 'GET') { sendJson(res, 405, 'Method not allowed', { allow: 'GET' }); return; }
    const query = new URL(req.url || '/', 'http://127.0.0.1').searchParams;
    let campaignId = query.get('campaignId')?.trim() || '';
    if (narratorOnly) {
      // The restricted sidecar forwards a broader upstream credential, so the
      // campaign binding is enforced here before anything leaves the sidecar.
      if (!campaignId) campaignId = narratorCampaignId;
      else if (campaignId !== narratorCampaignId) { sendJson(res, 403, 'This sidecar is restricted to its configured narrator campaign.'); return; }
    }
    if (!campaignId) { sendJson(res, 400, 'campaignId is required.'); return; }
    const credential = narratorOnly ? upstreamToken : bearer;
    if (!credential) { sendJson(res, 401, 'Unauthorized', { 'www-authenticate': 'Bearer realm="open-dungeon-master-mcp"' }); return; }

    const target = new URL(base);
    target.searchParams.set('campaignId', campaignId);
    const afterSeq = query.get('afterSeq');
    if (afterSeq !== null) target.searchParams.set('afterSeq', afterSeq);
    const headers = { accept: 'text/event-stream', 'accept-encoding': 'identity', authorization: `Bearer ${credential}` };
    const lastEventId = req.headers['last-event-id'];
    if (typeof lastEventId === 'string' && lastEventId.trim()) headers['last-event-id'] = lastEventId.trim();

    // One controller owns the upstream request: client disconnect aborts it.
    const upstreamAbort = new AbortController();
    const abort = () => upstreamAbort.abort();
    if (signal?.aborted) return;
    signal?.addEventListener('abort', abort, { once: true });
    res.once('close', abort);
    try {
      let upstream;
      try {
        upstream = await fetchImpl(target, { method: 'GET', headers, redirect: 'error', signal: upstreamAbort.signal });
      } catch {
        if (!upstreamAbort.signal.aborted) sendJson(res, 502, 'ODM event stream is unavailable.');
        return;
      }
      if (upstream.status !== 200 || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
        sendJson(res, status, UPSTREAM_ERRORS[status] ?? 'ODM event stream is unavailable.',
          status === 401 ? { 'www-authenticate': 'Bearer realm="open-dungeon-master-mcp"' } : {});
        return;
      }
      res.writeHead(200, SSE_HEADERS);
      res.flushHeaders();
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || res.destroyed) break;
          if (!value?.byteLength) continue;
          if (!res.write(value)) {
            await new Promise(resolve => {
              const settle = () => { res.off('drain', settle); res.off('close', settle); resolve(); };
              res.once('drain', settle); res.once('close', settle);
            });
          }
        }
      } catch { /* upstream error or client abort: end below */ }
      finally { await reader.cancel().catch(() => {}); }
    } finally {
      signal?.removeEventListener('abort', abort);
      res.off('close', abort);
      upstreamAbort.abort();
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  };
}
