// Lab stand-in for next/headers: route handlers run outside Next, so expose the
// current lab request's headers and an empty cookie jar (players use bearer tokens).
import { AsyncLocalStorage } from 'node:async_hooks';
export const labRequest = globalThis.__odmLabRequest ??= new AsyncLocalStorage();
export async function headers() { return labRequest.getStore()?.headers ?? new Headers(); }
export async function cookies() { return { get: () => undefined, getAll: () => [], set() {}, delete() {}, has: () => false }; }
