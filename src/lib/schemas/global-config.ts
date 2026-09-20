import { z } from "zod";

export const globalConfigSchema = z.object({
  signupsEnabled: z.boolean().default(true),
  signupMode: z.enum(["", "open", "invite", "closed"]).default(""),
  serverName: z.string().trim().max(100).default(""),
  accountDeletionGraceDays: z.number().int().min(0).max(90).default(14),
  publicUrl: z.string().trim().max(500).default(""),
  worldRegistryUrl: z.string().trim().max(500).default(""),
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
