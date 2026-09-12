import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { serverEnv } from "@/lib/server-env";
import type { AspectPreset, GeneratedImage, ImageMode } from "@/lib/types";

// Alibaba Model Studio (DashScope) Qwen-Image backend. Qwen's image models do
// NOT speak the OpenAI-compatible /images/generations API (confirmed by
// Alibaba's docs), so this adapter drives the native asynchronous task API:
//
//   POST {base}/api/v1/services/aigc/text2image/image-synthesis
//        headers: Authorization Bearer, X-DashScope-Async: enable
//        body: {model, input:{prompt}, parameters:{size:"WxH", n:1, ...}}
//   -> {output:{task_id}}
//   GET  {base}/api/v1/tasks/{task_id}   (poll until SUCCEEDED/FAILED)
//   -> {output:{task_status, results:[{url}]}}   (OSS url, valid 24h)
//
// Only qwen-image-plus and qwen-image support the async API; qwen-image-plus
// is the cost-efficient default. Per-campaign fields (imageModel/imageBaseUrl/
// imageApiKey in story settings) override the environment, mirroring the
// OpenAI-images resolution so the campaign panel works the same for both.

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "qwen-image-plus";
const GENERATE_TIMEOUT_MS = 4 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;
// Documented prompt cap for the image-synthesis API.
const PROMPT_MAX_CHARS = 800;

export type DashScopeImageOverrides = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

// Accepted base forms: bare host, host + /api/v1, with or without trailing
// slashes. Stored as the bare origin; paths are appended by the caller.
function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

export function resolveDashScopeImageConfig(overrides?: DashScopeImageOverrides): {
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  const envBase = serverEnv("DASHSCOPE_IMAGE_BASE_URL") || serverEnv("DASHSCOPE_BASE_URL");
  const envModel = serverEnv("DASHSCOPE_IMAGE_MODEL");
  const envKey = serverEnv("DASHSCOPE_IMAGE_API_KEY") || serverEnv("DASHSCOPE_API_KEY");
  return {
    baseUrl: normalizeBase(overrides?.baseUrl?.trim() || envBase || DEFAULT_BASE_URL),
    model: overrides?.model?.trim() || envModel || DEFAULT_MODEL,
    apiKey: overrides?.apiKey?.trim() || envKey,
  };
}

export function dashScopeImagesConfigured(overrides?: DashScopeImageOverrides): boolean {
  return resolveDashScopeImageConfig(overrides).apiKey !== "";
}

// Documented resolutions for qwen-image-plus / qwen-image / qwen-image-max.
// n is fixed at 1 by the API; these are the only supported aspect buckets.
function sizeFor(aspect: AspectPreset): { size: string; width: number; height: number } {
  if (aspect === "portrait") {
    return { size: "1104*1472", width: 1104, height: 1472 };
  }
  if (aspect === "landscape") {
    return { size: "1472*1104", width: 1472, height: 1104 };
  }
  return { size: "1328*1328", width: 1328, height: 1328 };
}

function promptSlug(prompt: string) {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "image"
  );
}

type TaskResponse = {
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
    code?: string;
    results?: Array<{ url?: string }>;
  };
  message?: string;
  code?: string;
};

export async function generateDashScopeImage(
  options: {
    prompt: string;
    mode: ImageMode;
    aspect: AspectPreset;
    hasReferences?: boolean;
  },
  overrides?: DashScopeImageOverrides,
): Promise<GeneratedImage> {
  const { baseUrl, model, apiKey } = resolveDashScopeImageConfig(overrides);
  if (!apiKey) {
    throw new Error(
      "The Qwen-Image (DashScope) backend has no API key. Set it for the campaign or DASHSCOPE_IMAGE_API_KEY in the environment.",
    );
  }

  const startedAt = Date.now();
  const { size, width, height } = sizeFor(options.aspect);
  const deadline = startedAt + GENERATE_TIMEOUT_MS;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Step 1: create the task.
  let taskId = "";
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/services/aigc/text2image/image-synthesis`,
      {
        method: "POST",
        headers: { ...headers, "X-DashScope-Async": "enable" },
        body: JSON.stringify({
          model,
          input: { prompt: options.prompt.slice(0, PROMPT_MAX_CHARS) },
          parameters: {
            size,
            n: 1,
            // fast = keep the prompt as written (cheaper, tighter control);
            // slow = let the model rewrite/expand it for richer detail.
            prompt_extend: options.mode === "slow",
            watermark: false,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as TaskResponse;
    if (!response.ok || !payload.output?.task_id) {
      const detail = payload.message || payload.output?.message || `the API answered ${response.status}`;
      throw new Error(`Qwen-Image task creation failed: ${detail}`);
    }
    taskId = payload.output.task_id;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Qwen-Image")) {
      throw error;
    }
    throw new Error(`Could not reach the DashScope image API at ${baseUrl}.`);
  }

  // Step 2: poll the task. The docs warn against creating duplicate tasks,
  // so a stall is answered with patience, not a retry of step 1.
  let imageUrl = "";
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("Qwen-Image generation timed out waiting for the task.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    let payload: TaskResponse;
    try {
      const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      payload = (await response.json().catch(() => ({}))) as TaskResponse;
      if (!response.ok) {
        throw new Error(`task poll answered ${response.status}`);
      }
    } catch {
      // A transient poll hiccup must not kill a paid task; keep polling
      // until the deadline.
      continue;
    }
    const status = payload.output?.task_status;
    if (status === "SUCCEEDED") {
      imageUrl = payload.output?.results?.[0]?.url || "";
      if (!imageUrl) {
        throw new Error("Qwen-Image finished without returning an image URL.");
      }
      break;
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      const detail = payload.output?.message || payload.message || status;
      throw new Error(`Qwen-Image task ${status.toLowerCase()}: ${detail}`);
    }
    // PENDING / RUNNING: keep waiting.
  }

  // Step 3: download the OSS artifact (URLs expire after 24h) and store it
  // beside the other generated images.
  const download = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
  if (!download.ok) {
    throw new Error(`Downloading the Qwen-Image result failed (${download.status}).`);
  }
  const bytes = Buffer.from(await download.arrayBuffer());
  if (!bytes.length) {
    throw new Error("The Qwen-Image result was empty.");
  }

  const generatedDir = path.join(process.cwd(), "public", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const filename = `${Date.now()}-dashscope-${promptSlug(options.prompt)}.png`;
  writeFileSync(path.join(generatedDir, filename), bytes);

  return {
    id: crypto.randomUUID(),
    url: `/generated/${filename}`,
    prompt: options.prompt,
    mode: options.mode,
    backend: "dashscope",
    aspect: options.aspect,
    width,
    height,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    warnings: options.hasReferences
      ? ["Character reference images are not used by the Qwen-Image backend."]
      : undefined,
  };
}
