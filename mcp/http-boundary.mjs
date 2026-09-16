import { withControlSignal } from './control-client.mjs';

export class BadRequestError extends Error {}
export function requestPath(target, host) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(target)) {
    throw new BadRequestError('Invalid request target');
  }
  if (host !== undefined) {
    if (typeof host !== 'string' || !host || /[\s,\/@\\?#%]/.test(host)) throw new BadRequestError('Invalid Host header');
    try { new URL(`http://${host}`); } catch { throw new BadRequestError('Invalid Host header'); }
  }
  // Host is validated above but never participates in URL resolution.
  return new URL(target, 'http://127.0.0.1').pathname;
}

/** A synchronous EventEmitter listener with a catch around the entire request. */
export function createSafeHttpListener(handle, { onError = () => {} } = {}) {
  return (req, res) => {
    const cancelled = new AbortController();
    const abort = () => { if (!res.writableEnded) cancelled.abort(); };
    const cleanup = () => {
      req.off('aborted', abort); res.off('close', abort); res.off('finish', cleanup);
    };
    req.once('aborted', abort);
    res.once('close', abort);
    res.once('close', cleanup);
    res.once('finish', cleanup);
    if (req.aborted || res.destroyed) cancelled.abort();
    void Promise.resolve().then(() => {
      const pathname = requestPath(req.url || '/', req.headers.host);
      return withControlSignal(cancelled.signal, () => handle(req, res, pathname, cancelled.signal));
    }).catch(error => {
      if (cancelled.signal.aborted || res.destroyed || res.writableEnded) return;
      const badRequest = error instanceof BadRequestError;
      if (!badRequest) { try { onError(error); } catch { /* Logging cannot crash HTTP handling. */ } }
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(badRequest ? 400 : 500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: badRequest ? 'Bad request' : 'MCP request failed' }));
    });
  };
}
