export function createMcpProxy(options?: {
  upstream?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumBytes?: number;
}): (request: Request) => Promise<Response>;
