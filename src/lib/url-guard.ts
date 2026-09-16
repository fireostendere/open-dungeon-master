// SSRF guard for user-supplied model endpoints.
// Private/LAN addresses are intentionally allowed: local model servers are a
// supported feature. Metadata, link-local and the existing CGNAT deny range
// are blocked for literals AND for DNS results. Network calls use a pinned
// lookup so DNS cannot change between validation and connect.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const blocked = new BlockList();
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("fe80::", 10, "ipv6");
// Cloud metadata address family used by AWS-style metadata endpoints. Keep
// the historical policy of rejecting the whole provider-reserved prefix.
blocked.addSubnet("fd00:ec2::", 32, "ipv6");

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.internal",
]);

function extractHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function mappedIpv4FromIpv6(address: string): string | null {
  const value = address.toLowerCase();
  if (!value.startsWith("::ffff:")) return null;
  const tail = value.slice("::ffff:".length);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail;
  const words = tail.split(":");
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const hi = Number.parseInt(words[0], 16);
  const lo = Number.parseInt(words[1], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function assertAllowedAddress(address: string): void {
  const family = isIP(address);
  if (!family) throw new SsrfError(`Invalid resolved IP address: ${address}`);

  if (family === 6) {
    const mapped = mappedIpv4FromIpv6(address);
    if (mapped && blocked.check(mapped, "ipv4")) {
      throw new SsrfError(`Blocked IP range: ${address} (metadata/link-local)`);
    }
    if (blocked.check(address, "ipv6")) {
      throw new SsrfError(`Blocked IP range: ${address} (metadata/link-local)`);
    }
    return;
  }

  if (blocked.check(address, "ipv4")) {
    throw new SsrfError(`Blocked IP range: ${address} (metadata/link-local)`);
  }
}

function parsedEndpoint(raw: string): URL {
  if (!raw || typeof raw !== "string") throw new SsrfError("URL is required");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL format");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Protocol ${url.protocol} not allowed. Use http or https.`);
  }
  if (url.username || url.password) {
    throw new SsrfError("Credentials are not allowed in endpoint URLs");
  }

  const hostname = extractHostname(url);
  if (!hostname) throw new SsrfError("URL has no hostname");
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    throw new SsrfError(`Blocked host: ${hostname}`);
  }
  return url;
}

// Fast synchronous validation for forms/profile storage. DNS validation is
// deliberately performed again immediately before the actual network call.
export function assertSafeEndpointUrl(raw: string): void {
  const url = parsedEndpoint(raw);
  const hostname = extractHostname(url);
  if (isIP(hostname)) assertAllowedAddress(hostname);
}

export async function resolveSafeEndpointUrl(
  raw: string,
  lookupImpl: typeof dnsLookup = dnsLookup,
): Promise<{ url: URL; addresses: Array<{ address: string; family: 4 | 6 }> }> {
  const url = parsedEndpoint(raw);
  const hostname = extractHostname(url);
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    assertAllowedAddress(hostname);
    return { url, addresses: [{ address: hostname, family: literalFamily as 4 | 6 }] };
  }

  let answers: Awaited<ReturnType<typeof dnsLookup>>;
  try {
    answers = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`Could not resolve endpoint host: ${hostname}`);
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new SsrfError(`Endpoint host has no addresses: ${hostname}`);
  }
  const addresses = answers.map((answer) => ({
    address: answer.address,
    family: answer.family as 4 | 6,
  }));
  // Reject the hostname if ANY advertised address violates policy. This avoids
  // a dual-stack/round-robin hostname smuggling a forbidden destination next
  // to an allowed one.
  for (const answer of addresses) assertAllowedAddress(answer.address);
  return { url, addresses };
}

function responseHeaders(raw: import("node:http").IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

// Fetch-like helper that validates DNS and pins the actual socket lookup to
// one of the validated addresses while retaining the original hostname for
// HTTP Host and HTTPS SNI/certificate verification. Redirects are never
// followed; callers can reject a 3xx response according to their contract.
export async function secureEndpointFetch(
  raw: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const target = await resolveSafeEndpointUrl(String(raw));
  const selected = target.addresses[0];
  const requestImpl = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = Object.fromEntries(new Headers(init.headers).entries());

  const body = init.body;
  if (
    body != null &&
    typeof body !== "string" &&
    !Buffer.isBuffer(body) &&
    !(body instanceof Uint8Array)
  ) {
    throw new TypeError("secureEndpointFetch supports string or byte request bodies only");
  }

  return await new Promise<Response>((resolve, reject) => {
    const req = requestImpl(
      target.url,
      {
        method: init.method ?? "GET",
        headers,
        signal: init.signal ?? undefined,
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage,
              headers: responseHeaders(res.headers),
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// Kept for callers that only need policy options with a different transport.
export const SSRF_FETCH_OPTIONS: RequestInit = {
  redirect: "manual",
};
