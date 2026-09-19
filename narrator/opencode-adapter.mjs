import path from 'node:path';
import { trustedInstruction } from './role-profiles.mjs';

export class OpenCodeAdapter {
  constructor(options = {}) {
    this.endpoint = new URL(options.endpoint ?? process.env.ODM_OPENCODE_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname);
    if (!(this.endpoint.protocol === 'https:' || this.endpoint.protocol === 'http:' && local) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) throw new Error('Use HTTPS or loopback HTTP without URL credentials.');
    this.token = (options.token ?? process.env.ODM_OPENCODE_TOKEN ?? '').trim();
    this.model = options.model ?? { providerID: process.env.ODM_OPENCODE_PROVIDER, id: process.env.ODM_OPENCODE_MODEL,
      ...(process.env.ODM_OPENCODE_VARIANT ? { variant: process.env.ODM_OPENCODE_VARIANT } : {}) };
    if (!this.model || Object.keys(this.model).some(key => !['providerID', 'id', 'variant'].includes(key)) ||
        !['providerID', 'id'].every(key => typeof this.model[key] === 'string' && this.model[key].trim()) ||
        this.model.variant !== undefined && typeof this.model.variant !== 'string') throw new Error('Select an explicit provider/model/variant.');
    this.model = { ...this.model };
    this.workspace = options.workspace ?? process.env.ODM_OPENCODE_WORKSPACE;
    if (typeof this.workspace !== 'string' || !path.isAbsolute(this.workspace)) throw new Error('Select an absolute isolated OpenCode workspace.');
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }
  async request(route, { method = 'POST', body } = {}) {
    const response = await this.fetch(new URL(route, this.endpoint), { method, redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
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
    const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return json?.data ?? json;
  }
  async generate(role, prompt) {
    const instruction = trustedInstruction(role);
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 262144) throw new Error('Role input exceeds the byte budget; no facts were clipped.');
    const agent = `narrator-${role}`;
    const session = await this.request('/api/session', { body: { agent, model: this.model,
      location: { directory: this.workspace }, permissions: [{ action: '*', resource: '*', effect: 'deny' }], title: `ODM ${role}` } });
    if (typeof session?.id !== 'string' || !/^ses[a-zA-Z0-9_-]+$/.test(session.id)) throw new Error('Invalid OpenCode session.');
    const route = `/api/session/${encodeURIComponent(session.id)}`;
    try {
      if (session.agent !== agent || ['providerID', 'id', 'variant'].some(key => session.model?.[key] !== this.model[key])) throw new Error('OpenCode did not preserve the selected role/model.');
      await this.request(`/api/experimental/session/${encodeURIComponent(session.id)}/instructions/entries/odm-policy`, { method: 'PUT', body: { value: instruction } });
      const reply = await this.request(`${route}/generate`, { body: { prompt } });
      if (typeof reply?.text !== 'string' || !reply.text.trim() || Buffer.byteLength(reply.text) > 32768) throw new Error('Malformed or oversized model output.');
      return reply.text;
    } finally {
      // Only this adapter's own transient session is eligible for cleanup.
      await this.request(route, { method: 'DELETE' }).catch(() => {});
    }
  }
}

export function createOpenCodeAdapter(options) { return new OpenCodeAdapter(options); }
