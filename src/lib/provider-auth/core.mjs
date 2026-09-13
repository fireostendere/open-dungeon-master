/** Validation for provider connections. Does not initiate login or read credentials. */
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';

export class ProviderError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'ProviderError'; this.code = code; this.status = status; }
}
export function publicError(error) {
  return error instanceof ProviderError ? error.code : 'PROVIDER_OPERATION_FAILED';
}
export function equalSecret(expected, actual) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeAuthUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new ProviderError('INVALID_AUTH_URL', 502); }
  if (u.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(u.hostname) || u.username || u.password || u.port) {
    throw new ProviderError('UNTRUSTED_AUTH_URL', 502);
  }
  return u.href;
}
export function loopbackOrigin(raw = `http://127.0.0.1:${process.env.PORT || '3000'}`) {
  let u;
  try { u = new URL(raw); } catch { throw new ProviderError('INVALID_LOCAL_ORIGIN'); }
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
    throw new ProviderError('LOCAL_ORIGIN_REQUIRED');
  }
  return u.origin;
}
export function profileFingerprint(p) {
  const keys = ['kind','preset','protocol','baseUrl','model','authMode','apiKey','contextLimit','contextVerified','maxOutputTokens','thinking','timeoutMs','sampling'];
  return createHash('sha256').update(JSON.stringify(keys.map(k => [k, p[k] ?? null]))).digest('hex');
}
export function canApplyProfile(p) {
  return !!p?.lastCheck?.ok && ['chat','tool_call','tool_result'].every(k => p.lastCheck.stages?.[k]?.ok === true);
}
export function requireVerifiedProfile(p) {
  if (!canApplyProfile(p)) throw new ProviderError('PROFILE_REQUIRES_SUCCESSFUL_TOOL_PROBE', 409);
}
export function profileHasChanged(a, b) { return profileFingerprint(a) !== profileFingerprint(b); }
export function modelId(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 200 || /[\x00-\x1f]/.test(raw)) throw new ProviderError('MODEL_ID_REQUIRED');
  return raw.trim();
}
export function validateChat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProviderError('INVALID_CHAT_REQUEST');
  modelId(body.model);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 1000) throw new ProviderError('INVALID_MESSAGES');
  for (const m of body.messages) {
    if (!m || !['system','developer','user','assistant','tool'].includes(m.role)) throw new ProviderError('INVALID_MESSAGE_ROLE');
    if (m.content !== null && m.content !== undefined && typeof m.content !== 'string') throw new ProviderError('ONLY_TEXT_MESSAGES_SUPPORTED');
    if (m.role === 'tool' && typeof m.tool_call_id !== 'string') throw new ProviderError('TOOL_CALL_ID_REQUIRED');
  }
  const tools = body.tool_choice === 'none' ? [] : (body.tools ?? []);
  if (!Array.isArray(tools) || tools.length > 256) throw new ProviderError('INVALID_TOOLS');
  const seen = new Set();
  for (const t of tools) {
    if (t?.type !== 'function' || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(t.function?.name ?? '') || seen.has(t.function.name)) throw new ProviderError('INVALID_TOOL_NAME');
    if (!t.function.parameters || typeof t.function.parameters !== 'object' || Array.isArray(t.function.parameters)) throw new ProviderError('INVALID_TOOL_SCHEMA');
    seen.add(t.function.name);
  }
  return {model: modelId(body.model), messages: body.messages, tools};
}
export function dynamicToolSpecs(tools) {
  return tools.map((t, i) => ({ name: `odm_${i}`, description: `${t.function.name}: ${t.function.description ?? ''}`.slice(0, 20000), inputSchema: t.function.parameters }));
}
export function chatEnvelope(model, message, finishReason = 'stop') {
  return {id:`chatcmpl-odm-${randomUUID()}`, object:'chat.completion', created:Math.floor(Date.now()/1000), model, choices:[{index:0, message, finish_reason:finishReason}]};
}
export function requestIsSameOrigin(request) {
  const origin = request.headers.get('origin');
  let expected;
  try {
    const target = new URL(request.url);
    if (!['http:', 'https:'].includes(target.protocol)) return false;
    if (process.env.ODM_PUBLIC_ORIGIN) {
      const configured = new URL(process.env.ODM_PUBLIC_ORIGIN);
      if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) return false;
      expected = configured.origin;
    } else {
      // Next can normalize request.url to its internal listen hostname. Host
      // is the actual HTTP destination seen by the browser. Never take the
      // expected origin from Origin itself or untrusted forwarded headers.
      const host = request.headers.get('host');
      if (host) {
        if (/[\s,\/@\\?#%]/.test(host)) return false;
        const incoming = new URL(`${target.protocol}//${host}`);
        if (incoming.username || incoming.password || incoming.pathname !== '/' || incoming.search || incoming.hash) return false;
        expected = incoming.origin;
      } else expected = target.origin;
    }
  } catch { return false; }
  return origin === expected && request.headers.get('x-odm-provider-auth') === '1' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}
