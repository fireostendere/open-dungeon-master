import { z } from "zod";

export const globalConfigSchema = z.object({
  signupsEnabled: z.boolean().default(true),
  signupMode: z.enum(["", "open", "invite", "closed"]).default(""),
  serverName: z.string().trim().max(100).default(""),
  accountDeletionGraceDays: z.number().int().min(0).max(90).default(14),
  publicUrl: z.string().trim().max(500).default(""),
  worldRegistryUrl: z.string().trim().max(500).default(""),
  // Kept as a compatibility shape for clients and old config rows. The
  // server no longer performs inference; the external narrator owns it.
  text: z.object({
    provider: z.enum(["", "local", "custom", "none"]).default(""),
    localTextModel: z.string().trim().max(200).default(""),
    customBaseUrl: z.string().trim().max(500).default(""),
    customModel: z.string().trim().max(200).default(""),
    customApiKey: z.string().trim().max(400).default(""),
    utilityProvider: z.enum(["", "local", "custom"]).default(""),
    utilityModel: z.string().trim().max(200).default(""),
    utilityBaseUrl: z.string().trim().max(500).default(""),
    utilityApiKey: z.string().trim().max(400).default(""),
    maxOutputTokens: z.number().int().min(0).max(1_000_000).default(0),
    timeoutMs: z.number().int().min(0).max(1_800_000).default(0),
    thinking: z.enum(["", "on", "off"]).default(""),
  }).prefault({}),
  images: z.object({
    defaultBackend: z.enum(["", "comfyui", "openai", "mflux-hs", "sdnq-hs"]).default(""),
    comfyUrl: z.string().trim().max(500).default(""),
    comfyCheckpoint: z.string().trim().max(300).default(""),
    fluxWorkerUrl: z.string().trim().max(500).default(""),
    openaiBaseUrl: z.string().trim().max(500).default(""),
    openaiModel: z.string().trim().max(200).default(""),
    openaiApiKey: z.string().trim().max(400).default(""),
  }).prefault({}),
  speech: z.object({
    kokoroUrl: z.string().trim().max(500).default(""),
    sttUrl: z.string().trim().max(500).default(""),
  }).prefault({}),
  voiceChat: z.object({
    enabled: z.enum(["", "on", "off"]).default(""),
    mode: z.enum(["", "sfu", "mesh"]).default(""),
    announcedIp: z.string().trim().max(200).default(""),
    domain: z.string().trim().max(300).default(""),
    rtcPort: z.string().trim().max(10).default(""),
  }).prefault({}),
  discord: z.object({
    clientId: z.string().trim().max(100).default(""),
    clientSecret: z.string().trim().max(200).default(""),
  }).prefault({}),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = globalConfigSchema.parse({});
export type SignupMode = "open" | "invite" | "closed";

function deviceWorldFromProcess(): boolean {
  return typeof process !== "undefined" && process.env?.ODM_DEVICE_WORLD === "1";
}

export function resolveSignupMode(
  config: GlobalConfig,
  deviceWorld: boolean = deviceWorldFromProcess(),
): SignupMode {
  if (deviceWorld) return "open";
  if (config.signupMode !== "") return config.signupMode;
  return config.signupsEnabled ? "open" : "closed";
}
