/** Outbound provider transport. LAN endpoints are intentional; metadata is not.
 * Validate every DNS answer and pin the connection to that answer set. Redirects
 * are never followed, so credentials cannot escape to a second destination.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export class SsrfError extends Error {
  constructor(message) { super(message); this.name = 'SsrfError'; }
}

function hostOf(url) { return url.hostname.replace(/^\[|\]$/g, '').toLowerCase(); }

function ipv6Words(address) {
  // WHATWG URL canonicalizes dotted IPv4 tails and compressed IPv6 spellings.
  const normalized = hostOf(new URL(`http://[${address}]/`));
  const parts = normalized.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].map(x => parseInt(x, 16));
}

export function assertSafeAddress(address) {
  const family = isIP(address);
  let blocked = false;
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    blocked = (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0 || a >= 224;
  } else if (family === 6) {
    const words = ipv6Words(address);
    blocked = (words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00 ||
      (words[0] === 0xfd00 && words[1] === 0x0ec2) || words.every(x => x === 0);
    // IPv4-mapped IPv6 must obey the IPv4 policy too.
    if (words.slice(0, 5).every(x => x === 0) && words[5] === 0xffff) {
      assertSafeAddress(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
    }
  } else {
    throw new SsrfError('DNS returned an invalid IP address');
  }
  if (blocked) throw new SsrfError(`Blocked IP range: ${address} (metadata/link-local)`);
  return family;
}

export function assertSafeEndpointUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new SsrfError('Invalid URL format'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SsrfError('Only http and https endpoints are supported');
  if (url.username || url.password) throw new SsrfError('Credentials in endpoint URLs are not allowed');
  const hostname = hostOf(url);
  if (!hostname) throw new SsrfError('URL has no hostname');
  if (['metadata.google.internal', 'metadata.internal'].includes(hostname.replace(/\.$/, ''))) {
    throw new SsrfError(`Blocked host: ${hostname}`);
  }
  if (isIP(hostname)) assertSafeAddress(hostname);
}

function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Factory exposes only the resolver for deterministic tests, not a policy bypass. */
export function createSafeEndpointFetch({ resolver = lookup } = {}) {
  return async function safeEndpointFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assertSafeEndpointUrl(url.href);
    request.signal.throwIfAborted();
    const hostname = hostOf(url);
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await abortable(resolver(hostname, { all: true, verbatim: true }), request.signal);
    if (!Array.isArray(addresses) || addresses.length === 0) throw new SsrfError('Endpoint DNS returned no addresses');
    for (const entry of addresses) {
      if (assertSafeAddress(entry.address) !== entry.family) throw new SsrfError('DNS address family mismatch');
    }
    request.signal.throwIfAborted();
    const hostnameHeaders = Object.fromEntries(request.headers);
    // Authority comes from the checked URL, never a second, caller-supplied Host.
    hostnameHeaders.host = url.host;
    delete hostnameHeaders.connection;
    delete hostnameHeaders['transfer-encoding'];
    if (!hostnameHeaders['accept-encoding']) hostnameHeaders['accept-encoding'] = 'gzip, deflate, br';
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      let incoming;
      let decoded;
      const cleanup = () => request.signal.removeEventListener('abort', onAbort);
      const outgoing = transport(url, {
        method: request.method,
        headers: hostnameHeaders,
        agent: false,
        // No second DNS lookup: net/TLS uses exactly the validated answers.
        lookup(_name, options, callback) {
          const family = typeof options === 'number' ? options : options?.family;
          const candidates = family ? addresses.filter(x => x.family === family) : addresses;
          queueMicrotask(() => {
            if (!candidates.length) return callback(new SsrfError('No validated address for the requested family'));
            if (typeof options === 'object' && options.all) callback(null, candidates);
            else callback(null, candidates[0].address, candidates[0].family);
          });
        },
        ...(url.protocol === 'https:' && !literalFamily ? { servername: hostname } : {}),
      }, (response) => {
        incoming = response;
        const status = response.statusCode ?? 502;
        if (status >= 300 && status <= 399 && response.headers.location && request.redirect !== 'manual') {
          response.destroy();
          cleanup();
          reject(new SsrfError('Endpoint redirects are disabled; configure the final URL explicitly'));
          return;
        }
        const responseHeaders = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        }
        if (request.method === 'HEAD' || [204, 205, 304].includes(status)) {
          response.resume();
          response.once('end', cleanup);
          response.once('close', cleanup);
          resolve(new Response(null, { status, statusText: response.statusMessage, headers: responseHeaders }));
          return;
        }
        const compression = responseHeaders.get('content-encoding')?.toLowerCase();
        const decoder = compression === 'gzip' ? createGunzip() : compression === 'deflate' ? createInflate() : compression === 'br' ? createBrotliDecompress() : null;
        decoded = decoder ? response.pipe(decoder) : response;
        if (decoder) {
          responseHeaders.delete('content-encoding');
          responseHeaders.delete('content-length');
          response.on('error', error => decoder.destroy(error));
          decoder.once('close', () => response.destroy());
        }
        decoded.once('end', cleanup);
        decoded.once('close', cleanup);
        resolve(new Response(Readable.toWeb(decoded), { status, statusText: response.statusMessage, headers: responseHeaders }));
      });
      function onAbort() {
        const reason = request.signal.reason instanceof Error ? request.signal.reason : new DOMException('Request aborted', 'AbortError');
        outgoing.destroy(reason);
        incoming?.destroy(reason);
        decoded?.destroy(reason);
        reject(request.signal.reason);
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
      outgoing.once('error', error => { cleanup(); reject(error); });
      if (request.signal.aborted) { onAbort(); return; }
      if (request.body) {
        const body = Readable.fromWeb(request.body);
        body.on('error', error => outgoing.destroy(error));
        outgoing.once('close', () => body.destroy());
        body.pipe(outgoing);
      } else outgoing.end();
    });
  };
}

export const secureEndpointFetch = createSafeEndpointFetch();
export const SSRF_FETCH_OPTIONS = Object.freeze({ redirect: 'manual' });
