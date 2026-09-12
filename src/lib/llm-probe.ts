// LLM probe: exercises an actual chat + tool-call round trip against a user-supplied endpoint.
// Returns per-stage results and overall capabilities. Self-contained (no server config dependency),
// testable against a local mock server.
//
// Deviation from brief: does NOT use requestCustomMessage (which pulls in getGlobalConfig, serverEnv,
// retry/dropParams logic, presence_penalty). Probe is a diagnostic tool, not a production path —
// direct fetch gives full payload control and zero server-config dependency.

import { assertSafeEndpointUrl, SSRF_FETCH_OPTIONS } from "@/lib/url-guard";

export type ProbeStageResult = {
  ok: boolean;
  detail?: string;
  ms?: number;
};

export type ProbeCapabilities = {
  tools: boolean;
  streaming: boolean;
  modelListed: boolean | null; // null if /models not reachable
};

export type ProbeReport = {
  ok: boolean;
  capabilities: ProbeCapabilities;
  stages: Record<string, ProbeStageResult>;
  error?: string;
};

export type ProbeTarget = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  protocol?: "openai-compatible" | "ollama-native";
};

export type ProbeOptions = {
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
// Thinking models spend output tokens on reasoning before the visible
// answer; 256 could cut a valid tool call off mid-JSON and fail the probe
// against a perfectly capable model.
const PROBE_MAX_TOKENS = 512; // Keep probe requests small

function truncate(text: string, max = 200): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// Normalize base URL for /chat/completions endpoint.
function normalizeChatUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  if (/\/v\d+$/.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

// Normalize base URL for /models endpoint.
function normalizeModelsUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (/\/v\d+$/.test(url)) return `${url}/models`;
  return `${url}/v1/models`;
}

function mapHttpError(status: number, detail?: string): string {
  if (status === 401 || status === 403) return "Неверный ключ или нет доступа";
  if (status === 404) return "Модель не найдена на сервере";
  if (status === 429) return "Сервер перегружен (429)";
  if (status >= 300 && status < 400) return `Редирект (${status})`;
  return `Ошибка сервера (${status})${detail ? ": " + truncate(detail) : ""}`;
}

// --- SSE stream parser ---

type StreamedToolCall = {
  id?: string;
  function: { name: string; arguments: string };
};

async function parseSseStream(
  response: Response,
  timeoutMs: number,
): Promise<{ content: string; toolCalls: StreamedToolCall[]; chunks: number }> {
  const contentParts: string[] = [];
  const toolCalls: StreamedToolCall[] = [];
  let chunks = 0;

  if (!response.body) return { content: "", toolCalls: [], chunks: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ done: boolean; value: Uint8Array | undefined }>((_, reject) =>
        setTimeout(() => reject(new Error("stream_timeout")), Math.max(0, deadline - Date.now())),
      );
      let result: { done: boolean; value: Uint8Array | undefined };
      try {
        result = await Promise.race([readPromise, timeoutPromise]);
      } catch {
        break;
      }
      if (result.done) break;
      buffer += decoder.decode(result.value!, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const record = parsed as {
          choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>;
          error?: { message?: string } | string;
        };
        if (record.error) continue;
        const delta = record.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content) {
          contentParts.push(delta.content);
          chunks++;
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls as Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>) {
            if (tc.index === undefined) continue;
            while (toolCalls.length <= tc.index) {
              toolCalls.push({ function: { name: "", arguments: "" } });
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return { content: contentParts.join(""), toolCalls, chunks };
}

// --- Chat request helper ---

type ChatRequestResult = {
  status: number;
  content?: string;
  toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  chunks?: number;
  errorText?: string;
  isTimeout?: boolean;
};

async function doChatRequest(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: unknown[],
  options: {
    tools?: unknown[];
    toolChoice?: unknown;
    stream?: boolean;
    timeoutMs: number;
  },
): Promise<ChatRequestResult> {
  const url = normalizeChatUrl(baseUrl);
  const body: Record<string, unknown> = { model, messages, max_tokens: PROBE_MAX_TOKENS };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }
  if (options.stream) body.stream = true;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      ...SSRF_FETCH_OPTIONS,
    });

    if (!resp.ok) {
      if (resp.status >= 300 && resp.status < 400) {
        return { status: resp.status, errorText: "redirect" };
      }
      const text = await resp.text().catch(() => "");
      return { status: resp.status, errorText: text };
    }

    if (options.stream) {
      const parsed = await parseSseStream(resp, options.timeoutMs);
      return { status: 200, content: parsed.content, toolCalls: parsed.toolCalls, chunks: parsed.chunks };
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
    };
    const content = typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
    const toolCalls = Array.isArray(data.choices?.[0]?.message?.tool_calls) ? data.choices[0].message.tool_calls : [];
    return { status: 200, content, toolCalls };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message === "stream_timeout")) {
      return { status: 0, isTimeout: true, errorText: `Таймаут ${options.timeoutMs} мс` };
    }
    return { status: 0, errorText: err instanceof Error ? truncate(err.message) : "Network error" };
  } finally {
    // Cleared only after the body is consumed: clearing right after the
    // headers left a hung server streaming into a body read with no
    // timeout at all.
    clearTimeout(timer);
  }
}

// --- Stages ---

const PROBE_TOOL = {
  type: "function",
  function: {
    name: "probe_echo",
    description: "Эхо-инструмент проверки. Верни полученное слово.",
    parameters: {
      type: "object",
      properties: {
        word: { type: "string" },
        n: { type: "integer" },
      },
      required: ["word"],
    },
  },
};

async function stageModels(target: ProbeTarget, timeoutMs: number): Promise<ProbeStageResult & { modelListed: boolean | null }> {
  const modelsUrl = normalizeModelsUrl(target.baseUrl);
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {};
    if (target.apiKey) headers["Authorization"] = `Bearer ${target.apiKey}`;
    const resp = await fetch(modelsUrl, { headers, signal: controller.signal, ...SSRF_FETCH_OPTIONS });
    clearTimeout(timer);
    const ms = Date.now() - start;

    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, detail: mapHttpError(resp.status), ms, modelListed: null };
    }
    if (!resp.ok) {
      return { ok: true, detail: `Список моделей недоступен (${resp.status})`, ms, modelListed: null };
    }
    const data = (await resp.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(data?.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
    const modelListed = models.includes(target.model);
    return {
      ok: true,
      detail: modelListed
        ? `Модель «${target.model}» найдена`
        : `Модель не в списке (доступно: ${models.slice(0, 5).join(", ")}${models.length > 5 ? "…" : ""})`,
      ms,
      modelListed,
    };
  } catch {
    return { ok: true, detail: "Не удалось получить список моделей", ms: Date.now() - start, modelListed: null };
  }
}

async function stageChat(target: ProbeTarget, timeoutMs: number): Promise<ProbeStageResult> {
  const start = Date.now();
  const result = await doChatRequest(
    target.baseUrl,
    target.model,
    target.apiKey || "",
    [
      { role: "system", content: "Ты помощник проверки. Отвечай по-русски." },
      { role: "user", content: "Ответь одним словом: стол или стул? Слово 'стол'." },
    ],
    { timeoutMs },
  );
  const ms = Date.now() - start;

  if (result.isTimeout) return { ok: false, detail: result.errorText, ms };
  if (result.status === 0) return { ok: false, detail: result.errorText || "Ошибка соединения", ms };
  if (result.status !== 200) return { ok: false, detail: mapHttpError(result.status, result.errorText), ms };

  const content = result.content || "";
  if (!content.trim()) return { ok: false, detail: "Пустой ответ модели", ms };
  if (!content.toLowerCase().includes("стол")) {
    return { ok: false, detail: `Модель не ответила «стол». Ответ: ${truncate(content)}`, ms };
  }
  return { ok: true, detail: "Чат работает", ms };
}

async function stageStream(target: ProbeTarget, timeoutMs: number): Promise<ProbeStageResult> {
  const start = Date.now();
  const result = await doChatRequest(
    target.baseUrl,
    target.model,
    target.apiKey || "",
    [
      { role: "system", content: "Ты помощник проверки. Отвечай по-русски." },
      { role: "user", content: "Ответь одним словом: стол или стул? Слово 'стол'." },
    ],
    { stream: true, timeoutMs },
  );
  const ms = Date.now() - start;

  if (result.isTimeout) return { ok: false, detail: `Стриминг: ${result.errorText}`, ms };
  if (result.status !== 200) return { ok: false, detail: `Стриминг: ${mapHttpError(result.status, result.errorText)}`, ms };
  if (!result.chunks || result.chunks === 0) return { ok: false, detail: "Стриминг не вернул чанков", ms };
  if (!result.content?.trim()) return { ok: false, detail: "Стриминг вернул пустой текст", ms };
  return { ok: true, detail: `Стриминг: ${result.chunks} чанков`, ms };
}

async function stageToolCall(
  target: ProbeTarget,
  timeoutMs: number,
): Promise<ProbeStageResult & { toolCallId?: string }> {
  const start = Date.now();
  const result = await doChatRequest(
    target.baseUrl,
    target.model,
    target.apiKey || "",
    [
      { role: "system", content: "Ты помощник проверки. Используй инструменты." },
      { role: "user", content: "Вызови инструмент probe_echo со словом 'куб' и числом 7. Ничего больше не пиши." },
    ],
    {
      tools: [PROBE_TOOL],
      // tool_choice "auto", NOT forced: the whole point is that the model
      // itself decides to emit a real tool call. A server-coerced call
      // would pass models whose native tool calling is broken.
      toolChoice: "auto",
      timeoutMs,
    },
  );
  const ms = Date.now() - start;

  if (result.isTimeout) return { ok: false, detail: result.errorText, ms };
  if (result.status === 0) return { ok: false, detail: result.errorText || "Ошибка соединения", ms };
  if (result.status !== 200) return { ok: false, detail: mapHttpError(result.status, result.errorText), ms };

  const toolCalls = result.toolCalls;
  if (!toolCalls || toolCalls.length === 0) {
    const content = typeof result.content === "string" ? result.content : "";
    if (content.toLowerCase().includes("probe_echo")) {
      return { ok: false, detail: "Модель упомянула инструмент в тексте, но не вызвала его", ms };
    }
    return { ok: false, detail: "Модель не вызвала инструмент", ms };
  }

  const call = toolCalls[0];
  const funcName = call.function?.name;
  if (funcName !== "probe_echo") {
    return { ok: false, detail: `Неверное имя инструмента: ${funcName}`, ms };
  }

  const argsStr = call.function?.arguments || "";
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsStr);
  } catch {
    return { ok: false, detail: "Модель вернула невалидные аргументы инструмента", ms };
  }

  const word = typeof args.word === "string" ? args.word : "";
  if (word !== "куб") {
    return { ok: false, detail: `Неверное слово: ${word || "(пусто)"}`, ms };
  }
  const n = args.n;
  if (n !== 7 && n !== "7") {
    return { ok: false, detail: `Неверное число: ${n}`, ms };
  }
  return { ok: true, detail: "Инструмент вызван корректно", ms, toolCallId: call.id || "probe_call_1" };
}

async function stageToolResult(
  target: ProbeTarget,
  timeoutMs: number,
  toolCallId: string,
): Promise<ProbeStageResult> {
  const start = Date.now();
  const result = await doChatRequest(
    target.baseUrl,
    target.model,
    target.apiKey || "",
    [
      { role: "system", content: "Ты помощник проверки. Используй инструменты." },
      { role: "user", content: "Вызови инструмент probe_echo со словом 'куб' и числом 7. Ничего больше не пиши." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: { name: "probe_echo", arguments: JSON.stringify({ word: "куб", n: 7 }) },
          },
        ],
      },
      { role: "tool", content: JSON.stringify({ word: "куб", n: 7 }), tool_call_id: toolCallId },
    ],
    { timeoutMs },
  );
  const ms = Date.now() - start;

  if (result.isTimeout) return { ok: false, detail: result.errorText, ms };
  if (result.status === 0) return { ok: false, detail: result.errorText || "Ошибка соединения", ms };
  if (result.status !== 200) return { ok: false, detail: mapHttpError(result.status, result.errorText), ms };

  // Check no second tool call
  if (result.toolCalls && result.toolCalls.length > 0) {
    return { ok: false, detail: "Модель запросила повторный вызов инструмента", ms };
  }
  const content = result.content || "";
  if (!content.trim()) {
    return { ok: false, detail: "Модель не вернула финальное сообщение", ms };
  }
  return { ok: true, detail: "Результат инструмента обработан", ms };
}

// --- Main probe ---

export async function probeLlmProfile(
  target: ProbeTarget,
  opts?: ProbeOptions,
): Promise<ProbeReport> {
  // SSRF guard
  try {
    assertSafeEndpointUrl(target.baseUrl);
  } catch (err) {
    return {
      ok: false,
      capabilities: { tools: false, streaming: false, modelListed: null },
      stages: {},
      error: err instanceof Error ? err.message : "SSRF guard failed",
    };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stages: Record<string, ProbeStageResult> = {};

  // Stage 1: models (informational)
  const modelsResult = await stageModels(target, timeoutMs);
  stages.models = { ok: modelsResult.ok, detail: modelsResult.detail, ms: modelsResult.ms };

  // Stage 2: chat (required for overall ok)
  const chatResult = await stageChat(target, timeoutMs);
  stages.chat = chatResult;
  if (!chatResult.ok) {
    return {
      ok: false,
      capabilities: { tools: false, streaming: false, modelListed: modelsResult.modelListed },
      stages,
    };
  }

  // Stage 3: stream (informational)
  const streamResult = await stageStream(target, timeoutMs);
  stages.stream = streamResult;

  // Stage 4: tool_call (required)
  const toolCallResult = await stageToolCall(target, timeoutMs);
  stages.tool_call = { ok: toolCallResult.ok, detail: toolCallResult.detail, ms: toolCallResult.ms };
  if (!toolCallResult.ok) {
    return {
      ok: false,
      capabilities: { tools: false, streaming: streamResult.ok, modelListed: modelsResult.modelListed },
      stages,
    };
  }

  // Stage 5: tool_result (required)
  const toolResultStage = await stageToolResult(target, timeoutMs, toolCallResult.toolCallId || "probe_call_1");
  stages.tool_result = toolResultStage;
  if (!toolResultStage.ok) {
    return {
      ok: false,
      capabilities: { tools: false, streaming: streamResult.ok, modelListed: modelsResult.modelListed },
      stages,
    };
  }

  return {
    ok: true,
    capabilities: {
      tools: true,
      streaming: streamResult.ok,
      modelListed: modelsResult.modelListed,
    },
    stages,
  };
}

// Fetch model list (for wizard "Load models" button).
export async function fetchModelList(
  baseUrl: string,
  apiKey?: string,
): Promise<{ models: string[]; error?: string }> {
  try {
    assertSafeEndpointUrl(baseUrl);
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : "SSRF guard failed" };
  }
  const modelsUrl = normalizeModelsUrl(baseUrl);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const resp = await fetch(modelsUrl, { headers, signal: controller.signal, ...SSRF_FETCH_OPTIONS });
    clearTimeout(timer);
    if (!resp.ok) return { models: [], error: mapHttpError(resp.status) };
    const data = (await resp.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(data?.data)
      ? data.data.map((m) => m.id).filter((id): id is string => typeof id === "string")
      : [];
    return { models };
  } catch (err) {
    return { models: [], error: err instanceof Error ? truncate(err.message) : "Ошибка" };
  }
}
