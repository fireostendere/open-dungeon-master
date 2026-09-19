import { AsyncLocalStorage } from 'node:async_hooks';
import { withDmPolicy } from './dm-policy.mjs';

const operation = new AsyncLocalStorage();
const storyWrites = new Set(['narrator.invoke', 'narrator.narrate', 'narrator.release_floor']);
/** Transport defaults never change a command ID, cursor or effect payload. */
export function narratorParams(action, params = {}) {
  const result = { ...params };
  if (!action.startsWith('narrator.')) return result;
  for (const key of ['compact', 'policyMode', 'includePolicyText']) delete result[key];
  if (action === 'narrator.read') { result.projection ??= 'live'; result.delta ??= true; }
  if (action === 'narrator.catalog' && !result.action && !result.actionFilter && !result.name && !result.category) result.summaryOnly ??= true;
  if (storyWrites.has(action)) result.readAfter ??= true;
  return result;
}
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
  onTiming = null,
} = {}) {
  return async function callControl(action, params = {}, { signal, timeout = timeoutMs } = {}) {
    if (!token) throw new Error('ODM_MCP_TOKEN is not configured. The control plane is disabled.');
    const signals = [operation.getStore(), signal, AbortSignal.timeout(timeout)].filter(Boolean);
    const requestSignal = AbortSignal.any(signals);
    requestSignal.throwIfAborted();
    const startedAt = performance.now();
    let status = 0, responseBytes = 0;
    try {
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action, params: narratorParams(action, params) }), signal: requestSignal,
      });
      status = response.status;
      const body = await response.json();
      requestSignal.throwIfAborted();
      if (!response.ok || body?.ok === false) throw Object.assign(new Error(body?.error || `ODM control API returned HTTP ${response.status}.`), { status, code: body?.code });
      // The full policy remains in connect.instructions and its MCP resource.
      // A dedicated host must install it as trusted instructions once, rather
      // than paying for the same document in every read/invoke response.
      const policyMode = params?.policyMode ?? (process.env.ODM_MCP_POLICY_MODE === 'full' ? 'full' : 'compact');
      const result = withDmPolicy(action, body?.result, {
        policyMode,
        includePolicyText: params?.includePolicyText ?? (action === 'narrator.connect' && policyMode === 'compact' ? false : undefined),
      });
      if (onTiming || process.env.ODM_LATENCY_LOG === '1') responseBytes = Buffer.byteLength(JSON.stringify(result) ?? '');
      return result;
    } finally {
      // No campaign/user IDs, text, credentials, prompts or tool arguments.
      const timing = { stage: 'mcp_control', durationMs: Math.round(performance.now() - startedAt), status, responseBytes };
      try { if (onTiming) onTiming(timing); else if (process.env.ODM_LATENCY_LOG === '1') console.error('[odm-latency]', JSON.stringify(timing)); } catch {}
    }
  };
}
export const callControl = createControlClient();
