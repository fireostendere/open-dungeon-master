// SSRF guard: validate user-supplied URLs before fetching them.
// Allows http/https only; blocks metadata IPs (AWS 169.254.169.254, Azure fd00:ec2::254)
// and link-local ranges. Private/LAN addresses are allowed (that's the point for local servers).
// The probe fetch must use redirect: "manual" to prevent redirect-based SSRF.

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// Check if an IPv4 address is in a blocked range.
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // invalid
  }
  const [a, b] = parts;
  // 169.254.0.0/16 — link-local, includes AWS metadata 169.254.169.254
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — CGNAT, sometimes used for metadata
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// Check if an IPv6 address is in a blocked range.
function isBlockedIpv6(ip: string): boolean {
  // Normalize: lowercase, strip brackets
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // fd00:ec2::254 — AWS metadata IPv6
  if (normalized === "fd00:ec2::254" || normalized.startsWith("fd00:ec2::")) {
    return true;
  }
  // fe80::/10 — link-local
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  // fc00::/7 — unique local (private), but we allow private ranges for local servers
  // Only block specific metadata patterns
  return false;
}

// Extract hostname from a URL, handling IPv6 brackets.
function extractHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

// Check if a hostname is an IP literal (IPv4 or IPv6).
function isIpLiteral(hostname: string): boolean {
  // IPv4: digits and dots
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  // IPv6: contains colons
  if (hostname.includes(":")) {
    return true;
  }
  return false;
}

// Validate a URL for safe fetching. Throws SsrfError if blocked.
export function assertSafeEndpointUrl(raw: string): void {
  if (!raw || typeof raw !== "string") {
    throw new SsrfError("URL is required");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL format");
  }

  // Only allow http/https
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Protocol ${url.protocol} not allowed. Use http or https.`);
  }

  const hostname = extractHostname(url);
  if (!hostname) {
    throw new SsrfError("URL has no hostname");
  }

  // Block metadata IPs if hostname is an IP literal
  if (isIpLiteral(hostname)) {
    if (isBlockedIpv4(hostname)) {
      throw new SsrfError(`Blocked IP range: ${hostname} (metadata/link-local)`);
    }
    if (hostname.includes(":") && isBlockedIpv6(hostname)) {
      throw new SsrfError(`Blocked IP range: ${hostname} (metadata/link-local)`);
    }
  }

  // Block well-known metadata hostnames (defensive, in case DNS resolves to metadata IP)
  const blockedHosts = ["169.254.169.254", "metadata.google.internal", "metadata.internal"];
  if (blockedHosts.includes(hostname.toLowerCase())) {
    throw new SsrfError(`Blocked host: ${hostname}`);
  }
}

// Fetch options that prevent redirect-based SSRF.
export const SSRF_FETCH_OPTIONS: RequestInit = {
  redirect: "manual",
};
