import { AsyncLocalStorage } from 'node:async_hooks';
import { withDmPolicy } from './dm-policy.mjs';

const operation = new AsyncLocalStorage();
export function controlTimeout(value = process.env.ODM_MCP_CONTROL_TIMEOUT_MS) {
  const configured = Number(value ?? 135_000);
  // The application owns the 120 s deadline. Leave time to receive its result.
  return Number.isFinite(configured) ? Math.min(600_000, Math.max(125_000, Math.floor(configured))) : 135_000;
}
export function withControlSignal(signal, callback) {
  const signals = [operation.getStore(), signal].filter(Boolean);
  const combined = signals.length ? AbortSignal.any(signals) : undefined;
  combined?.throwIfAborted();
  return operation.run(combined, callback);
}
export function withMcpCancellation(callback) {
  return (...args) => {
    const ctx = args.at(-1);
    // SDK v2 moved the protocol cancellation signal under mcpReq.
    const signals = [ctx?.mcpReq?.signal, ctx?.http?.req?.signal].filter(Boolean);
    return withControlSignal(signals.length ? AbortSignal.any(signals) : undefined, () => callback(...args));
  };
}
export function createControlClient({
  url = process.env.ODM_MCP_CONTROL_URL?.trim() || 'http://127.0.0.1:3005/api/internal/mcp',
  token = process.env.ODM_MCP_TOKEN?.trim() || '',
  timeoutMs = controlTimeout(),
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function callControl(action, params = {}, { signal, timeout = timeoutMs } = {}) {
    if (!token) throw new Error('ODM_MCP_TOKEN is not configured. The control plane is disabled.');
    const signals = [operation.getStore(), signal, AbortSignal.timeout(timeout)].filter(Boolean);
    const requestSignal = AbortSignal.any(signals);
    requestSignal.throwIfAborted();
    const response = await fetchImpl(url, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action, params }), signal: requestSignal,
    });
    const body = await response.json();
    requestSignal.throwIfAborted();
    if (!response.ok || body?.ok === false) throw new Error(body?.error || `ODM control API returned HTTP ${response.status}.`);
    return withDmPolicy(action, body?.result, {
      policyMode: params?.policyMode,
      includePolicyText: params?.includePolicyText,
    });
  };
}
export const callControl = createControlClient();
