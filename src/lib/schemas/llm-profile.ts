import { z } from "zod";

// LLM profile: saved connection + model config for text generation.
// Stored as an array under app_settings key 'llm_profiles'.
// The apiKey is server-only: never echoed to clients (masked out in list responses).

export const llmProfilePresetSchema = z.enum([
  "openrouter",
  "openai",
  "deepseek",
  "dashscope",
  "ollama",
  "llamacpp",
  "lmstudio",
  "vllm",
]);

export type LlmProfilePreset = z.infer<typeof llmProfilePresetSchema>;

export const llmProfileKindSchema = z.enum(["cloud-preset", "local-runtime", "custom"]);
export type LlmProfileKind = z.infer<typeof llmProfileKindSchema>;

export const llmProfileProtocolSchema = z.enum(["openai-compatible", "ollama-native"]);
export type LlmProfileProtocol = z.infer<typeof llmProfileProtocolSchema>;

export const llmProfileAuthModeSchema = z.enum(["none", "api-key"]);
export type LlmProfileAuthMode = z.infer<typeof llmProfileAuthModeSchema>;

export const llmProfileThinkingSchema = z.enum(["on", "off", "auto"]);
export type LlmProfileThinking = z.infer<typeof llmProfileThinkingSchema>;

export const llmProfileCheckStageSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
  ms: z.number().optional(),
});

export const llmProfileLastCheckSchema = z.object({
  at: z.string(), // ISO timestamp
  ok: z.boolean(),
  stages: z.record(z.string(), llmProfileCheckStageSchema),
});

export const llmProfileSamplingSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().min(0).max(200).optional(),
    min_p: z.number().min(0).max(1).optional(),
  })
  .optional();

export const llmProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  kind: llmProfileKindSchema,
  preset: llmProfilePresetSchema.optional(),
  protocol: llmProfileProtocolSchema,
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  authMode: llmProfileAuthModeSchema,
  apiKey: z.string().trim().max(400).default(""), // server-only
  contextLimit: z.number().int().positive().nullable().default(null),
  contextVerified: z.boolean().default(false),
  maxOutputTokens: z.number().int().positive().optional(),
  thinking: llmProfileThinkingSchema.default("auto"),
  timeoutMs: z.number().int().positive().optional(),
  sampling: llmProfileSamplingSchema,
  lastCheck: llmProfileLastCheckSchema.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LlmProfile = z.infer<typeof llmProfileSchema>;

// Masked profile: apiKey replaced with hasApiKey boolean, never sent to clients.
export type MaskedLlmProfile = Omit<LlmProfile, "apiKey"> & {
  hasApiKey: boolean;
};

export function maskLlmProfile(profile: LlmProfile): MaskedLlmProfile {
  const { apiKey, ...rest } = profile;
  return { ...rest, hasApiKey: apiKey !== "" };
}

// Zod schema for creating/updating a profile via API.
// apiKey: undefined = keep existing, "" = clear, value = set.
export const llmProfileCreateSchema = z.object({
  id: z.string().min(1).optional(), // if absent, generate new
  name: z.string().trim().min(1).max(60),
  kind: llmProfileKindSchema,
  preset: llmProfilePresetSchema.optional(),
  protocol: llmProfileProtocolSchema,
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  authMode: llmProfileAuthModeSchema,
  apiKey: z.string().trim().max(400).optional(), // undefined=keep on update
  contextLimit: z.number().int().positive().nullable().optional(),
  contextVerified: z.boolean().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  thinking: llmProfileThinkingSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  sampling: llmProfileSamplingSchema,
});

export type LlmProfileCreate = z.infer<typeof llmProfileCreateSchema>;
