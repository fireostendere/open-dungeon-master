import type { LookupAddress } from 'node:dns';
export class SsrfError extends Error { constructor(message: string); }
export function assertSafeEndpointUrl(raw: string): void;
export function assertSafeAddress(address: string): 4 | 6;
export function createSafeEndpointFetch(options?: {
  resolver?: (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
}): typeof globalThis.fetch;
export const secureEndpointFetch: typeof globalThis.fetch;
export const SSRF_FETCH_OPTIONS: Readonly<RequestInit>;
