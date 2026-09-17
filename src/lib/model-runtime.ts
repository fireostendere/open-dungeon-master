/** A non-secret snapshot of the profile explicitly applied to a model target. */
export type ModelRuntime = {
  profileId: string;
  baseUrl: string;
  model: string;
  contextLimit: number | null;
  contextVerified: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  thinking: "auto" | "on" | "off";
};
export const GLOBAL_MODEL_RUNTIME_KEY = "llm_runtime_default_v1";

function endpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch { return null; }
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Never borrow a capability from an unrelated or merely historical profile. */
export function normalizeModelRuntime(raw: unknown, baseUrl: string, model: string): ModelRuntime | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const target = endpoint(baseUrl);
  if (!target || typeof source.baseUrl !== "string" || endpoint(source.baseUrl) !== target || source.model !== model.trim()) return null;
  if (typeof source.profileId !== "string" || !source.profileId || source.profileId.length > 256) return null;
  if (source.contextLimit != null && !positiveInteger(source.contextLimit)) return null;
  if (source.maxOutputTokens !== undefined && !positiveInteger(source.maxOutputTokens)) return null;
  if (source.timeoutMs !== undefined && !positiveInteger(source.timeoutMs)) return null;
  if (typeof source.thinking !== "string" || !["auto", "on", "off"].includes(source.thinking)) return null;
  return {
    profileId: source.profileId, baseUrl: source.baseUrl, model: model.trim(),
    contextLimit: positiveInteger(source.contextLimit) ? source.contextLimit : null,
    contextVerified: source.contextVerified === true,
    ...(positiveInteger(source.maxOutputTokens) ? { maxOutputTokens: source.maxOutputTokens } : {}),
    ...(positiveInteger(source.timeoutMs) ? { timeoutMs: source.timeoutMs } : {}),
    thinking: source.thinking as ModelRuntime["thinking"],
  };
}

export function modelRuntimeSnapshot(profile: {
  id: string; baseUrl: string; model: string; contextLimit: number | null;
  contextVerified: boolean; maxOutputTokens?: number; timeoutMs?: number;
  thinking: "auto" | "on" | "off";
}): ModelRuntime {
  const result = normalizeModelRuntime({ ...profile, profileId: profile.id }, profile.baseUrl, profile.model);
  if (!result) throw new Error("Invalid applied model runtime");
  return result;
}

/** Explicit limits and measured backend limits are caps, never a reason to enlarge a smaller window. */
export function resolveContextLimit(declared: number | null | undefined, override: number | undefined, probed: number | undefined, fallback: number): number {
  const limits = [declared, override, probed].filter(positiveInteger);
  return limits.length ? Math.min(...limits) : fallback;
}

export type RequestBudget = { contextTokens: number; estimatedInputTokens: number; maxOutputTokens: number };
export class ModelContextError extends Error {
  constructor(readonly budget: Omit<RequestBudget, "maxOutputTokens">) {
    super("MODEL_CONTEXT_EXCEEDED");
    this.name = "ModelContextError";
  }
}

/**
 * UTF-8 text estimate, not a provider tokenizer or a guaranteed upper bound. Do not count a base64
 * image URL as prose; reserve an image allowance instead. The caller exposes
 * these as estimates and preserves authoritative input rather than truncating it.
 */
export function requestBudget(messages: readonly { content?: unknown; tool_calls?: unknown; role?: unknown; tool_call_id?: unknown }[],
  tools: readonly unknown[] | undefined, contextTokens: number, requestedOutputTokens: number): RequestBudget {
  let bytes = 0;
  let images = 0;
  const encoder = new TextEncoder();
  for (const message of messages) {
    bytes += encoder.encode(JSON.stringify({ role: message.role, tool_calls: message.tool_calls, tool_call_id: message.tool_call_id })).length;
    if (typeof message.content === "string") bytes += encoder.encode(message.content).length;
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") bytes += encoder.encode(part.text).length;
        else if (part && typeof part === "object" && part.type === "image_url") images++;
      }
    }
  }
  if (tools?.length) bytes += encoder.encode(JSON.stringify(tools)).length;
  const estimatedInputTokens = Math.ceil(bytes / 3) + messages.length * 8 + images * 2048 + 256;
  const limit = positiveInteger(contextTokens) ? contextTokens : 16384;
  const available = limit - estimatedInputTokens;
  if (available < 1) throw new ModelContextError({ contextTokens: limit, estimatedInputTokens });
  const requested = positiveInteger(requestedOutputTokens) ? requestedOutputTokens : 16384;
  return { contextTokens: limit, estimatedInputTokens, maxOutputTokens: Math.min(requested, available) };
}
