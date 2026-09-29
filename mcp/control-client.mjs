import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { withDmPolicy } from './dm-policy.mjs';
import { emitLatency, mcpLatencyStage, withLatencyTrace } from './latency-trace.mjs';
import { createOdmTransport } from './transport.mjs';

const operation = new AsyncLocalStorage();
const credential = new AsyncLocalStorage();
const configuredNarratorHostId = process.env.ODM_NARRATOR_HOST_ID?.trim() || '';
const narratorHostId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredNarratorHostId)
  ? configuredNarratorHostId
  : randomUUID();
export const ODM_NARRATOR_HOST_ID = narratorHostId;
/** Transport defaults never change a command ID, cursor or effect payload. */
export function narratorParams(action, params = {}) {
  const result = { ...params };
  if (!action.startsWith('narrator.')) return result;
  for (const key of ['compact', 'policyMode', 'includePolicyText']) delete result[key];
  // Host identity is transport metadata, never model-controlled tool input.
  result.narratorHostId = narratorHostId;
  if (action === 'narrator.connect') { result.projection ??= 'live'; result.maxBytes ??= 131072; }
  if (action === 'narrator.read') { result.projection ??= 'live'; result.delta ??= true; }
  if (action === 'narrator.catalog' && !result.action && !result.actionFilter && !result.name && !result.category) result.summaryOnly ??= true;
  if (['narrator.invoke', 'narrator.narrate', 'narrator.release_floor', 'narrator.delete_message', 'narrator.edit_message', 'narrator.autopilot_action', 'narrator.finish_global_round', 'narrator.end_campaign'].includes(action) && result.readAfter === undefined) {
    result.readAfter = { projection: 'live', delta: true, paged: true, maxBytes: 131072 };
  }
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
/** HTTP MCP requests may carry a scoped bearer; forward that exact bearer downstream. */
export function withMcpCredential(token, callback) {
  return credential.run(token, callback);
}
export function withMcpCancellation(callback) {
  return (...args) => {
    const ctx = args.at(-1);
    // SDK v2 moved the protocol cancellation signal under mcpReq.
    const signals = [ctx?.mcpReq?.signal, ctx?.http?.req?.signal].filter(Boolean);
    return withControlSignal(signals.length ? AbortSignal.any(signals) : undefined, () => callback(...args));
  };
}
export function createOdmClient({
  url = process.env.ODM_URL?.trim() || process.env.ODM_MCP_CONTROL_URL?.trim() || 'http://127.0.0.1:3005/api/internal/mcp',
  token = process.env.ODM_AUTH_TOKEN?.trim() || process.env.ODM_MCP_UPSTREAM_TOKEN?.trim() || process.env.ODM_MCP_TOKEN?.trim() || '',
  transport,
  timeoutMs = controlTimeout(),
  fetchImpl = globalThis.fetch,
  onTiming = null,
  ...transportOptions
} = {}) {
  const odmTransport = createOdmTransport({ ...transportOptions, transport, url, fetchImpl });
  const safeError = (value, secret) => String(value || 'ODM control request failed.')
    .replaceAll(secret || '\u0000', '[redacted]').slice(0, 500);
  const call = async function callControl(action, params = {}, { signal, timeout = timeoutMs } = {}) {
    return withLatencyTrace(async () => {
      const authToken = credential.getStore() || token;
      if (!authToken) throw new Error('ODM_AUTH_TOKEN is not configured. The control plane is disabled.');
      const signals = [operation.getStore(), signal, AbortSignal.timeout(timeout)].filter(Boolean);
      const requestSignal = AbortSignal.any(signals);
      requestSignal.throwIfAborted();
      const startedAt = performance.now();
      let status = 0, responseBytes = 0, serverMs = null;
      try {
        const response = await odmTransport.request(
          { action, params: narratorParams(action, params) },
          { signal: requestSignal, timeoutMs: timeout, retryable: odmTransport.retryable(action), headers: { authorization: `Bearer ${authToken}` } },
        );
        if (!response || typeof response.json !== 'function' || !response.headers) {
          throw Object.assign(new Error('ODM returned an invalid HTTP response.'), { code: 'ODM_MALFORMED_RESPONSE' });
        }
        status = response.status;
        const serverTiming = response.headers.get('server-timing')?.match(/(?:^|,)\s*odm;dur=([0-9.]+)/i);
        serverMs = serverTiming ? Number(serverTiming[1]) : null;
        const body = await response.json().catch(error => {
          if (requestSignal.aborted) throw error;
          throw Object.assign(new Error('ODM returned malformed JSON.'), { code: 'ODM_MALFORMED_RESPONSE', cause: error });
        });
        requestSignal.throwIfAborted();
        if (!response.ok || body?.ok === false) {
          throw Object.assign(new Error(safeError(body?.error || `ODM control API returned HTTP ${response.status}.`, authToken)), { status, code: body?.code });
        }
        if (!body || !Object.hasOwn(body, 'result')) throw Object.assign(new Error('ODM returned an invalid control response.'), { code: 'ODM_MALFORMED_RESPONSE' });
        const policyMode = params?.policyMode ?? (process.env.ODM_MCP_POLICY_MODE === 'full' ? 'full' : 'compact');
        const result = withDmPolicy(action, body.result, {
          policyMode,
          includePolicyText: params?.includePolicyText ?? (action === 'narrator.connect' && policyMode === 'compact' ? false : undefined),
        });
        if (onTiming || process.env.ODM_LATENCY_LOG === '1') responseBytes = Buffer.byteLength(JSON.stringify(result) ?? '');
        return result;
      } finally {
        const totalMs = performance.now() - startedAt;
        if (serverMs !== null) {
          emitLatency({ stage: 'odm_server', durationMs: serverMs }, { onTiming, log: !onTiming });
          emitLatency({ stage: 'odm_transport', durationMs: Math.max(0, totalMs - serverMs) }, { onTiming, log: !onTiming });
        }
        emitLatency({ stage: mcpLatencyStage(action), durationMs: totalMs, status, responseBytes, mcpCalls: 1 }, { onTiming, log: !onTiming });
      }
    });
  };
  call.connect = params => call('narrator.connect', params);
  call.read = params => call('narrator.read', params);
  call.getSnapshot = params => call('narrator.snapshot', params);
  call.getDelta = params => call('narrator.read', { ...params, delta: true });
  call.catalog = params => call('narrator.catalog', params);
  call.invoke = params => call('narrator.invoke', params);
  call.narrate = params => call('narrator.narrate', params);
  call.close = () => odmTransport.close();
  call.transport = odmTransport.kind;
  return call;
}

export const callControl = createOdmClient();
