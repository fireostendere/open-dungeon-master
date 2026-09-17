import { getAppSetting, getGlobalConfig } from "@/lib/db/app-settings";
import { describeEndpoint, profileById, resolveSampling, unsupportedParamFromError } from "@/lib/dm/sampling-logic";
import { buildPropsUrl, contextCacheKey, readContextWindow } from "@/lib/dm/context-probe-logic";
import { serverEnv } from "@/lib/server-env";
import { localModelContextWindow } from "@/lib/text-models";
import { secureEndpointFetch } from "@/lib/url-guard";
import {
  GLOBAL_MODEL_RUNTIME_KEY, ModelContextError, normalizeModelRuntime, requestBudget,
  resolveContextLimit, type ModelRuntime,
} from "@/lib/model-runtime";

// Shared compatible SSE / native Ollama NDJSON client. The runtime snapshot
// used for prompt construction is also passed to the actual request budget.
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MAX_CONFIGURABLE_OUTPUT_TOKENS = 65_536;
const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_CUSTOM_TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_LOCAL_TEXT_TIMEOUT_MS = 6 * 60 * 1000;
const MIN_TEXT_TIMEOUT_MS = 30 * 1000;
const MAX_TEXT_TIMEOUT_MS = 30 * 60 * 1000;
const WINDOWS_DEFAULT_LOCAL_CONTEXT_TOKENS = 65_536;

export type TextContentPart = { type: "text"; text: string };
export type ImageContentPart = { type: "image_url"; image_url: { url: string } };
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<TextContentPart | ImageContentPart>;
  tool_calls?: unknown;
  tool_call_id?: string;
};
export type StreamDeltaHandler = (text: string) => void;
export type StreamedToolCall = {
  id?: string; type?: "function"; function: { name: string; arguments: string };
};
export type UpstreamChatMessage = { content?: unknown; tool_calls?: unknown };
export type UpstreamResult = { message?: UpstreamChatMessage; error?: Response };
export type ChatRequestOptions = {
  tools?: readonly unknown[];
  toolChoice?: "auto" | "none";
  temperature?: number;
  onDelta?: StreamDeltaHandler;
  timeoutMs?: number;
  thinking?: boolean;
  contextTokens?: number;
  maxOutputTokens?: number;
  // Internal, bounded unsupported-parameter retry bookkeeping.
  dropParams?: readonly string[];
};

export function configuredMaxOutputTokens() {
  const parsed = Number.parseInt(serverEnv("OPENROUTER_MAX_TOKENS"), 10);
  return Number.isFinite(parsed) ? Math.max(512, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS)) : DEFAULT_MAX_OUTPUT_TOKENS;
}
export function dmThinkingEnabled(): boolean {
  const cfg = getGlobalConfig().text.thinking;
  if (cfg === "on") return true;
  if (cfg === "off") return false;
  return process.env.DM_THINKING !== "0";
}
export function localMaxOutputTokens() {
  const parsed = Number.parseInt(serverEnv("LOCAL_TEXT_MAX_TOKENS"), 10);
  return Number.isFinite(parsed) ? Math.max(256, Math.min(parsed, MAX_CONFIGURABLE_OUTPUT_TOKENS)) : DEFAULT_LOCAL_MAX_OUTPUT_TOKENS;
}
export function localContextTokens(model: string) {
  const native = localModelContextWindow(model);
  const parsed = Number.parseInt(serverEnv("LOCAL_TEXT_CONTEXT"), 10);
  if (!Number.isFinite(parsed)) return process.platform === "win32" ? Math.min(native, WINDOWS_DEFAULT_LOCAL_CONTEXT_TOKENS) : native;
  return Math.max(2_048, Math.min(parsed, native));
}
export const DEFAULT_CUSTOM_CONTEXT_TOKENS = 16_384;
const probedContextWindows = new Map<string, number>();
export function storyContextTokens(settings: {
  textProvider: string; localTextModel: string; customBaseUrl?: string; customModel?: string;
  modelRuntime?: ModelRuntime | null;
}): number {
  if (settings.textProvider === "local") return localContextTokens(settings.localTextModel);
  const base = settings.customBaseUrl ?? "";
  const model = settings.customModel ?? "";
  const runtime = normalizeModelRuntime(settings.modelRuntime, base, model);
  const override = Number.parseInt(serverEnv("OPENAI_COMPAT_CONTEXT"), 10);
  return resolveContextLimit(runtime?.contextLimit, override, probedContextWindows.get(contextCacheKey(base, model)), DEFAULT_CUSTOM_CONTEXT_TOKENS);
}
export async function probeCustomContextWindow(baseUrl: string, apiKey: string, model: string): Promise<number | null> {
  const url = buildPropsUrl(baseUrl, model);
  if (!url) return null;
  const cacheKey = contextCacheKey(baseUrl, model);
  const cached = probedContextWindows.get(cacheKey);
  if (cached !== undefined) return cached || null;
  try {
    const response = await secureEndpointFetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined, signal: AbortSignal.timeout(2_000) });
    if (!response.ok) { probedContextWindows.set(cacheKey, 0); return null; }
    const window = readContextWindow(await response.json()) ?? 0;
    probedContextWindows.set(cacheKey, window);
    return window || null;
  } catch { probedContextWindows.set(cacheKey, 0); return null; }
}
export function resolveTextTimeoutMs(explicit: number | undefined, envKey: string, fallback: number) {
  const raw = explicit ?? Number.parseInt(serverEnv(envKey), 10);
  return Number.isFinite(raw) ? Math.max(MIN_TEXT_TIMEOUT_MS, Math.min(raw, MAX_TEXT_TIMEOUT_MS)) : fallback;
}
export function arcTextTimeoutMs() { return resolveTextTimeoutMs(undefined, "ARC_TEXT_TIMEOUT_MS", 8 * 60 * 1000); }
function formatTimeout(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60) { const minutes = Math.round(seconds / 60); return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`; }
  return `${seconds} seconds`;
}
function createRequestTimeout(ms: number) {
  const controller = new AbortController(); let timedOut = false;
  const abortNow = () => { timedOut = true; controller.abort(); };
  const timeoutId = setTimeout(abortNow, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId), timedOut: () => timedOut, abortNow };
}
async function forEachStreamLine(upstream: Response, idleMs: number, onIdleAbort: () => void, onLine: (line: string) => void) {
  const reader = upstream.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(onIdleAbort, idleMs); };
  resetIdle();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      resetIdle(); buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode(); if (buffer.trim()) onLine(buffer.trim());
  } finally { clearTimeout(idleTimer); reader.releaseLock(); }
}
type OllamaChatMessage = { role: ChatMessage["role"]; content: string; images?: string[]; tool_calls?: unknown };
function toOllamaMessages(messages: ChatMessage[]): OllamaChatMessage[] {
  return messages.map(message => {
    if (typeof message.content === "string") return { role: message.role, content: message.content, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) };
    const texts: string[] = []; const images: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") { texts.push(part.text); continue; }
      const base64 = part.image_url.url.split(",")[1]; if (base64) images.push(base64);
    }
    return { role: message.role, content: texts.join("\n\n"), ...(images.length ? { images } : {}) };
  });
}
function hasImageParts(messages: ChatMessage[]) {
  return messages.some(message => typeof message.content !== "string" && message.content.some(part => part.type === "image_url"));
}
function stripImageParts(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => typeof message.content === "string" ? message : {
    ...message, content: message.content.filter((part): part is TextContentPart => part.type === "text").map(part => part.text).join("\n\n"),
  });
}
export function customChatEndpoint(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  return /\/v\d+$/.test(url) ? `${url}/chat/completions` : `${url}/v1/chat/completions`;
}
function contextFailure(error: ModelContextError): UpstreamResult {
  return { error: Response.json({ error: error.message, ...error.budget }, { status: 400 }) };
}

export async function requestCustomMessage(baseUrl: string, model: string, apiKey: string, messages: ChatMessage[], options: ChatRequestOptions = {}): Promise<UpstreamResult> {
  const { tools, toolChoice, temperature, onDelta } = options;
  const trimmedBase = (baseUrl || "").trim();
  if (!trimmedBase) {
    const configuredProvider = getGlobalConfig().text.provider || serverEnv("DEFAULT_TEXT_PROVIDER");
    return { error: Response.json({ error: configuredProvider === "none" ? "This world has no AI storyteller configured." :
      "No backend URL set. Add your server's URL (for example http://127.0.0.1:8080/v1) in Text Model settings." }, { status: 400 }) };
  }
  const globalText = getGlobalConfig().text; const globalSampling = getGlobalConfig().sampling;
  const caps = describeEndpoint(trimmedBase); const dropped = new Set(options.dropParams ?? []);
  let isOpenRouter = false;
  try { const hostname = new URL(trimmedBase).hostname; isOpenRouter = hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai"); } catch { /* Transport rejects invalid URLs. */ }
  const resolvedModel = (model || "").trim() || globalText.customModel || serverEnv("OPENAI_COMPAT_MODEL") || (isOpenRouter ? serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash") : "");
  if (!resolvedModel) return { error: Response.json({ error: "No model name set. Enter the model your server serves in Text Model settings." }, { status: 400 }) };
  const endpoint = customChatEndpoint(trimmedBase);
  const globalBase = (globalText.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL") || "").trim();
  const isGlobalBackend = Boolean(globalBase) && customChatEndpoint(globalBase) === endpoint;
  const utilityBase = (globalText.utilityBaseUrl || serverEnv("UTILITY_TEXT_BASE_URL") || "").trim();
  const isUtilityBackend = Boolean(utilityBase) && customChatEndpoint(utilityBase) === endpoint;
  const resolvedKey = (apiKey || "").trim() || (isGlobalBackend ? globalText.customApiKey : "") || (isUtilityBackend ? globalText.utilityApiKey : "") ||
    (isOpenRouter ? serverEnv("OPENROUTER_API_KEY") : "") || (isGlobalBackend ? serverEnv("OPENAI_COMPAT_API_KEY") : "") || (isUtilityBackend ? serverEnv("UTILITY_TEXT_API_KEY") : "");
  const runtime = normalizeModelRuntime(getAppSetting(GLOBAL_MODEL_RUNTIME_KEY, null), trimmedBase, resolvedModel);
  const contextTokens = options.contextTokens ?? storyContextTokens({ textProvider: "custom", localTextModel: "", customBaseUrl: trimmedBase, customModel: resolvedModel, modelRuntime: runtime });
  let outputTokens: number;
  try { outputTokens = requestBudget(messages, tools, contextTokens, options.maxOutputTokens ?? (globalText.maxOutputTokens || configuredMaxOutputTokens())).maxOutputTokens; }
  catch (error) { if (error instanceof ModelContextError) return contextFailure(error); throw error; }
  const requestPayload: Record<string, unknown> = {
    model: resolvedModel, messages,
    ...resolveSampling({ role: isUtilityBackend ? "utility" : "story",
      configured: { ...(isUtilityBackend ? globalSampling.utility : globalSampling.story), ...(temperature !== undefined ? { temperature } : {}) },
      profile: profileById(globalSampling.profile || "default"), allowLocalOnly: caps.allowLocalOnlySamplers, thinking: options.thinking }),
    ...(caps.sendZeroPresencePenalty ? { presence_penalty: 0 } : {}),
    ...(caps.allowTemplateKwargs && options.thinking ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    stream: true,
  };
  const maxTokensField = caps.maxTokensField === "max_completion_tokens" || dropped.has("max_tokens") ? "max_completion_tokens" : "max_tokens";
  if (dropped.has(maxTokensField)) return { error: Response.json({ error: "The backend rejected every supported output-limit field." }, { status: 502 }) };
  requestPayload[maxTokensField] = outputTokens;
  for (const field of dropped) delete requestPayload[field];
  if (tools?.length) { requestPayload.tools = tools; requestPayload.tool_choice = toolChoice ?? "auto"; }
  const timeoutMs = resolveTextTimeoutMs(options.timeoutMs || globalText.timeoutMs || undefined, "CUSTOM_TEXT_TIMEOUT_MS", DEFAULT_CUSTOM_TEXT_TIMEOUT_MS);
  const requestTimeout = createRequestTimeout(timeoutMs);
  let upstream: Response;
  try {
    upstream = await secureEndpointFetch(endpoint, { method: "POST",
      headers: { "Content-Type": "application/json", ...(resolvedKey ? { Authorization: `Bearer ${resolvedKey}` } : {}),
        ...(isOpenRouter ? { "HTTP-Referer": serverEnv("OPENROUTER_APP_URL", "http://localhost:3000"), "X-Title": serverEnv("OPENROUTER_APP_TITLE", "Open Dungeon Master") } : {}) },
      body: JSON.stringify(requestPayload), signal: requestTimeout.signal });
  } catch {
    return { error: Response.json({ error: requestTimeout.timedOut()
      ? `${isOpenRouter ? "OpenRouter" : "Backend"} request timed out after ${formatTimeout(timeoutMs)}.`
      : `Could not reach the backend at ${endpoint}. Check the URL and that your server is running.` }, { status: requestTimeout.timedOut() ? 504 : 502 }) };
  } finally { requestTimeout.clear(); }
  if (!upstream.ok) {
    const text = await upstream.text();
    if (hasImageParts(messages) && /image input|mmproj|image_url|vision/i.test(text)) return requestCustomMessage(trimmedBase, resolvedModel, apiKey, stripImageParts(messages), options);
    const offending = unsupportedParamFromError(text);
    if (offending && !dropped.has(offending) && dropped.size < 3) {
      console.warn(`[model] ${endpoint} rejected "${offending}"; retrying without it`);
      return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, { ...options, dropParams: [...dropped, offending] });
    }
    if (tools?.length && /tool|function|not support/i.test(text)) return requestCustomMessage(trimmedBase, resolvedModel, apiKey, messages, { ...options, tools: undefined, toolChoice: undefined });
    return { error: Response.json({ error: `${isOpenRouter ? "OpenRouter" : "Backend"} request failed (${upstream.status}).`, detail: text.slice(0, 300) }, { status: upstream.status }) };
  }
  if (upstream.body) {
    const contentParts: string[] = []; const toolCalls: Array<StreamedToolCall | undefined> = [];
    let upstreamError = ""; let rawAll = "";
    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, line => {
        if (!line.startsWith("data:")) { rawAll += line; return; }
        const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") return;
        let parsed: unknown; try { parsed = JSON.parse(payload); } catch { return; }
        const record = parsed as { choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>; error?: { message?: string } | string };
        if (record.error) { upstreamError = typeof record.error === "string" ? record.error : record.error.message || "The backend reported a stream error."; return; }
        const delta = record.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) { contentParts.push(delta.content); onDelta?.(delta.content); }
        if (Array.isArray(delta?.tool_calls)) {
          for (const call of delta.tool_calls) {
            const raw = call as { index?: number; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
            const index = typeof raw.index === "number" ? raw.index : 0;
            if (!Number.isInteger(index) || index < 0 || index >= 256) { upstreamError = "Invalid tool-call index."; continue; }
            const target = (toolCalls[index] ??= { type: "function", function: { name: "", arguments: "" } });
            if (typeof raw.id === "string" && raw.id) target.id = raw.id;
            if (typeof raw.function?.name === "string") target.function.name += raw.function.name;
            if (typeof raw.function?.arguments === "string") target.function.arguments += raw.function.arguments;
          }
        }
      });
    } catch {
      return { error: Response.json({ error: requestTimeout.timedOut()
        ? `${isOpenRouter ? "OpenRouter" : "Backend"} stream stalled for ${formatTimeout(timeoutMs)}.`
        : `The ${isOpenRouter ? "OpenRouter" : "backend"} stream was interrupted. Check the server and retry.` }, { status: requestTimeout.timedOut() ? 504 : 502 }) };
    }
    if (upstreamError) return { error: Response.json({ error: `${isOpenRouter ? "OpenRouter" : "Backend"} stream failed.`, detail: upstreamError.slice(0, 300) }, { status: 502 }) };
    const completedToolCalls = toolCalls.filter(Boolean) as StreamedToolCall[];
    if (!contentParts.length && !completedToolCalls.length && rawAll) {
      try { const data = JSON.parse(rawAll) as { choices?: Array<{ message?: UpstreamChatMessage }> }; if (data.choices?.[0]?.message) return { message: data.choices[0].message }; }
      catch { /* Preserve the empty assembled result for an unreadable fallback. */ }
    }
    return { message: { content: contentParts.join(""), ...(completedToolCalls.length ? { tool_calls: completedToolCalls } : {}) } };
  }
  try { const data = await upstream.json() as { choices?: Array<{ message?: UpstreamChatMessage }> }; return { message: data?.choices?.[0]?.message }; }
  catch { return { error: Response.json({ error: "The backend returned an unreadable response." }, { status: 502 }) }; }
}

export async function requestLocalMessage(model: string, messages: ChatMessage[], options: ChatRequestOptions & { disableThinking?: boolean } = {}): Promise<UpstreamResult> {
  const { tools, temperature, onDelta } = options; const disableThinking = options.disableThinking ?? true;
  const baseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
  const contextTokens = Math.min(options.contextTokens ?? localContextTokens(model), localContextTokens(model));
  let outputTokens: number;
  try { outputTokens = requestBudget(messages, tools, contextTokens, options.maxOutputTokens ?? localMaxOutputTokens()).maxOutputTokens; }
  catch (error) { if (error instanceof ModelContextError) return contextFailure(error); throw error; }
  const requestPayload: Record<string, unknown> = {
    model, messages: toOllamaMessages(messages), stream: Boolean(onDelta), keep_alive: "30m",
    options: { temperature: temperature ?? 0.9, num_predict: outputTokens, num_ctx: contextTokens },
  };
  if (disableThinking) requestPayload.think = false;
  if (tools?.length) requestPayload.tools = tools;
  const timeoutMs = resolveTextTimeoutMs(options.timeoutMs, "LOCAL_TEXT_TIMEOUT_MS", DEFAULT_LOCAL_TEXT_TIMEOUT_MS);
  const requestTimeout = createRequestTimeout(timeoutMs); let upstream: Response;
  try { upstream = await secureEndpointFetch(`${baseUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestPayload), signal: requestTimeout.signal }); }
  catch {
    return { error: Response.json({ error: requestTimeout.timedOut()
      ? `The local model took longer than ${formatTimeout(timeoutMs)} to answer.`
      : `Could not reach Ollama at ${baseUrl}. Start the server and pull ${model}, or select a custom backend.` }, { status: requestTimeout.timedOut() ? 504 : 502 }) };
  } finally { requestTimeout.clear(); }
  if (!upstream.ok) {
    const text = await upstream.text();
    if (tools?.length && /does not support tools/i.test(text)) return requestLocalMessage(model, messages, { ...options, tools: undefined });
    if (disableThinking && /does not support think/i.test(text)) return requestLocalMessage(model, messages, { ...options, disableThinking: false });
    const hint = /not found/i.test(text) ? ` The model is not installed — run \`ollama pull ${model}\`.` : "";
    return { error: Response.json({ error: `Local model request failed (${upstream.status}).${hint}`, detail: text.slice(0, 300) }, { status: 502 }) };
  }
  if (onDelta && upstream.body) {
    const contentParts: string[] = []; const toolCalls: unknown[] = []; let upstreamError = "";
    try {
      await forEachStreamLine(upstream, timeoutMs, requestTimeout.abortNow, line => {
        let parsed: unknown; try { parsed = JSON.parse(line); } catch { return; }
        const record = parsed as { message?: { content?: unknown; tool_calls?: unknown }; error?: unknown };
        if (record.error) { upstreamError = String(record.error); return; }
        if (typeof record.message?.content === "string" && record.message.content) { contentParts.push(record.message.content); onDelta(record.message.content); }
        if (Array.isArray(record.message?.tool_calls)) toolCalls.push(...record.message.tool_calls);
      });
    } catch {
      return { error: Response.json({ error: requestTimeout.timedOut() ? `The local model stalled for ${formatTimeout(timeoutMs)} mid-passage.` : "The local model stream was interrupted. Check that Ollama is still running and retry." }, { status: requestTimeout.timedOut() ? 504 : 502 }) };
    }
    if (upstreamError) return { error: Response.json({ error: "Local model stream failed.", detail: upstreamError.slice(0, 300) }, { status: 502 }) };
    return { message: { content: contentParts.join(""), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
  }
  try { const data = await upstream.json() as { message?: UpstreamChatMessage }; return { message: data?.message }; }
  catch { return { error: Response.json({ error: "The backend returned an unreadable response." }, { status: 502 }) }; }
}
