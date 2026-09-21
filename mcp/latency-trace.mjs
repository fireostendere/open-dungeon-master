import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const traceStorage = new AsyncLocalStorage();
export const LATENCY_STAGES = new Set(['mcp_read', 'mcp_engine', 'mcp_narration', 'mcp_ask', 'mcp_control', 'odm_transport', 'odm_server', 'packet', 'read_sections', 'post_write_read', 'checkpoint_serialize', 'checkpoint_file_fsync', 'checkpoint_directory_fsync', 'checkpoint_write', 'adapter_session', 'adapter_policy', 'adapter_model', 'adapter_cleanup', 'narrator_model', 'narrator_write']);
const durations = new Set(['durationMs', 'queueMs']);
const counts = ['bytes', 'inputBytes', 'outputBytes', 'responseBytes', 'modelCalls', 'mcpCalls', 'hits', 'loads', 'writeCount', 'attemptCount', 'errorCount', 'status'];

export const latencyEnabled = () => process.env.ODM_LATENCY_LOG === '1';
export const mcpLatencyStage = action => action === 'narrator.read' ? 'mcp_read' : action === 'narrator.invoke' ? 'mcp_engine' :
  ['narrator.narrate', 'narrator.release_floor'].includes(action) ? 'mcp_narration' : action === 'narrator.answer_ask' ? 'mcp_ask' : 'mcp_control';
export function withLatencyTrace(callback) {
  if (!latencyEnabled() || traceStorage.getStore()) return callback();
  return traceStorage.run({ traceId: crypto.randomBytes(16).toString('hex') }, callback);
}
export function withNewLatencyTrace(callback) {
  if (!latencyEnabled()) return callback();
  return traceStorage.run({ traceId: crypto.randomBytes(16).toString('hex') }, callback);
}
export function emitLatency(value, { onTiming = null, log = true } = {}) {
  if (!onTiming && (!log || !latencyEnabled())) return;
  if (!LATENCY_STAGES.has(value?.stage)) return;
  const event = { stage: value.stage };
  for (const key of durations) if (Number.isFinite(value[key]) && value[key] >= 0) event[key] = Math.round(value[key] * 1000) / 1000;
  for (const key of counts) if (Number.isFinite(value[key]) && value[key] >= 0) event[key] = Math.round(value[key]);
  if (typeof value.role === 'string' && ['referee', 'writer'].includes(value.role)) event.role = value.role;
  for (const key of ['skipped', 'ok', 'replayed']) if (typeof value[key] === 'boolean') event[key] = value[key];
  event.traceId = traceStorage.getStore()?.traceId ?? crypto.randomBytes(16).toString('hex');
  Object.freeze(event);
  try { onTiming?.(event); } catch {}
  if (log && latencyEnabled()) {
    try { console.error('[odm-latency]', JSON.stringify(event)); } catch {}
  }
}
