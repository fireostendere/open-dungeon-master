import fs from 'node:fs';
import path from 'node:path';
import { trustedInstruction } from './role-profiles.mjs';
import { emitLatency, latencyEnabled, withLatencyTrace } from '../mcp/latency-trace.mjs';

const nonNegativeInteger = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function validModel(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => ['providerID', 'id', 'variant'].includes(key)) &&
    ['providerID', 'id'].every(key => typeof value[key] === 'string' && value[key].trim()) &&
    (value.variant === undefined || typeof value.variant === 'string');
}
function modelUsage(reply) {
  const source = reply?.usage ?? reply?.metadata?.usage ?? reply?.info?.usage ?? null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const promptTokens = [
    source.promptTokens, source.prompt_tokens, source.inputTokens, source.input_tokens, source.input,
  ].map(nonNegativeInteger).find(value => value !== null);
  const completionTokens = [
    source.completionTokens, source.completion_tokens, source.outputTokens, source.output_tokens, source.output,
  ].map(nonNegativeInteger).find(value => value !== null);
  if (promptTokens === undefined || completionTokens === undefined) return null;
  const cost = Number(source.costUsd ?? source.cost_usd ?? source.cost);
  return {
    promptTokens,
    completionTokens,
    ...(Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
  };
}

export class OpenCodeAdapter {
  constructor(options = {}) {
    // Trusted source marker used by the shared play-mode router. This is set by
    // the in-repo adapter itself, not inferred from a client-supplied header.
    this.runtimeSource = "custom-opencode";
    this.endpoint = new URL(options.endpoint ?? process.env.ODM_OPENCODE_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname);
    if (!(this.endpoint.protocol === 'https:' || this.endpoint.protocol === 'http:' && local) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) throw new Error('Use HTTPS or loopback HTTP without URL credentials.');
    this.token = (options.token ?? process.env.ODM_OPENCODE_TOKEN ?? '').trim();
    this.model = options.model ?? { providerID: process.env.ODM_OPENCODE_PROVIDER, id: process.env.ODM_OPENCODE_MODEL,
      ...(process.env.ODM_OPENCODE_VARIANT ? { variant: process.env.ODM_OPENCODE_VARIANT } : {}) };
    if (!validModel(this.model)) throw new Error('Select an explicit provider/model/variant.');
    this.model = { ...this.model };
    this.roleModels = {};
    for (const role of ['referee', 'writer', 'ask', 'actor']) {
      const explicit = options.roleModels?.[role];
      const prefix = `ODM_OPENCODE_${role.toUpperCase()}_`;
      const hasEnvOverride = process.env[`${prefix}PROVIDER`] || process.env[`${prefix}MODEL`] || process.env[`${prefix}VARIANT`];
      const candidate = explicit ?? (hasEnvOverride ? {
        providerID: process.env[`${prefix}PROVIDER`] || this.model.providerID,
        id: process.env[`${prefix}MODEL`] || this.model.id,
        ...(process.env[`${prefix}VARIANT`] !== undefined
          ? { variant: process.env[`${prefix}VARIANT`] }
          : this.model.variant !== undefined ? { variant: this.model.variant } : {}),
      } : this.model);
      if (!validModel(candidate)) throw new Error(`Invalid ${role} provider/model/variant.`);
      this.roleModels[role] = { ...candidate };
    }
    this.workspace = options.workspace ?? process.env.ODM_OPENCODE_WORKSPACE;
    if (typeof this.workspace !== 'string' || !path.isAbsolute(this.workspace)) throw new Error('Select an absolute isolated OpenCode workspace.');
    // export-opencode-workspace installs the exact trusted role instruction as
    // the agent system prompt. When it still matches byte-for-byte, installing
    // the same text again through the session instruction API only duplicates
    // model context and adds an HTTP round-trip. A stale/missing/custom
    // workspace fails closed to the API-managed instruction path below.
    this.workspacePolicyRoles = new Set();
    try {
      const config = JSON.parse(fs.readFileSync(path.join(this.workspace, 'opencode.json'), 'utf8'));
      for (const role of ['referee', 'writer', 'ask', 'actor']) {
        if (config?.agents?.[`narrator-${role}`]?.system === trustedInstruction(role)) {
          this.workspacePolicyRoles.add(role);
        }
      }
    } catch {}
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 2000;
    if (!Number.isSafeInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1 || this.cleanupTimeoutMs > 10000) throw new Error('Invalid cleanup timeout.');
    this.pendingCleanups = new Set();
    this.onTiming = typeof options.onTiming === 'function' ? options.onTiming : null;
  }
  timing(stage, startedAt, fields = {}) {
    // Telemetry is deliberately content-free and must never break a response.
    emitLatency({ stage: `adapter_${stage}`, durationMs: Math.max(0, performance.now() - startedAt), ...fields }, { onTiming: this.onTiming, log: !this.onTiming });
  }
  async request(route, { method = 'POST', body, timeoutMs = this.timeoutMs, stage = 'request' } = {}) {
    const timing = latencyEnabled() || this.onTiming, startedAt = timing ? performance.now() : 0;
    let responseBytes = 0;
    try {
      const response = await this.fetch(new URL(route, this.endpoint), { method, redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenCode HTTP ${response.status}`); }
      if (response.status === 204) return null;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty OpenCode response.');
      const chunks = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 262144) { await reader.cancel(); throw new Error('OpenCode response exceeds the byte budget.'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      responseBytes = bytes; const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return json?.data ?? json;
    } finally { if (timing) this.timing(stage, startedAt, { responseBytes }); }
  }
  cleanup(route) {
    // Delete only this call's isolated session. Awaiting DELETE in generate's
    // finally used to hold a completed answer for the full model timeout.
    const task = this.request(route, { method: 'DELETE', timeoutMs: this.cleanupTimeoutMs, stage: 'cleanup' }).catch(() => {});
    this.pendingCleanups.add(task);
    void task.finally(() => this.pendingCleanups.delete(task));
  }
  async close() { await Promise.allSettled([...this.pendingCleanups]); }
  modelFor(role) {
    return this.roleModels[role] ?? this.model;
  }
  instructionBytes(role) {
    return Buffer.byteLength(trustedInstruction(role));
  }
  async generateWithUsage(role, prompt) {
    return withLatencyTrace(async () => {
      const instruction = trustedInstruction(role);
      if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 262144) throw new Error('Role input exceeds the byte budget; no facts were clipped.');
      if (this.pendingCleanups.size >= 32) throw new Error('OpenCode cleanup capacity exhausted.');
      const agent = `narrator-${role}`;
      const roleModel = this.modelFor(role);
      const session = await this.request('/api/session', { stage: 'session', body: { agent, model: roleModel,
        location: { directory: this.workspace }, permissions: [{ action: '*', resource: '*', effect: 'deny' }], title: `ODM ${role}` } });
      if (typeof session?.id !== 'string' || !/^ses[a-zA-Z0-9_-]+$/.test(session.id)) throw new Error('Invalid OpenCode session.');
      const route = `/api/session/${encodeURIComponent(session.id)}`;
      try {
        if (session.agent !== agent || ['providerID', 'id', 'variant'].some(key => session.model?.[key] !== roleModel[key])) throw new Error('OpenCode did not preserve the selected role/model.');
        if (!this.workspacePolicyRoles.has(role)) {
          await this.request(`/api/experimental/session/${encodeURIComponent(session.id)}/instructions/entries/odm-policy`, { method: 'PUT', stage: 'policy', body: { value: instruction } });
        }
        const reply = await this.request(`${route}/generate`, { stage: 'model', body: { prompt } });
        if (typeof reply?.text !== 'string' || !reply.text.trim() || Buffer.byteLength(reply.text) > 32768) throw new Error('Malformed or oversized model output.');
        return { text: reply.text, usage: modelUsage(reply) };
      } finally { this.cleanup(route); }
    });
  }
  async generate(role, prompt) {
    const result = await this.generateWithUsage(role, prompt);
    return result.text;
  }
}

export function createOpenCodeAdapter(options) { return new OpenCodeAdapter(options); }
