import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig, saveGlobalConfig } from "@/lib/db/app-settings";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";
import { resolveSignupMode, type GlobalConfig } from "@/lib/schemas/global-config";
import { announcedAddressFor, isUnroutableAddress, voiceConfig } from "@/lib/voice/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskedConfig(config: GlobalConfig) {
  return {
    signupsEnabled: config.signupsEnabled,
    signupMode: resolveSignupMode(config, isDeviceWorld()),
    signupModeForced: isDeviceWorld(),
    serverName: config.serverName,
    accountDeletionGraceDays: config.accountDeletionGraceDays,
    publicUrl: config.publicUrl,
    worldRegistryUrl: config.worldRegistryUrl,
    voiceChat: config.voiceChat,
    discord: {
      clientId: config.discord.clientId,
      hasClientSecret: config.discord.clientSecret !== "",
    },
  };
}

function envDefaults() {
  return {
    discordClientId: serverEnv("DISCORD_CLIENT_ID"),
    hasDiscordClientSecret: serverEnv("DISCORD_CLIENT_SECRET") !== "",
    publicUrl: serverEnv("APP_PUBLIC_URL"),
    voiceEnabled: serverEnv("VOICE_ENABLED", "0") === "1",
    voiceAnnouncedIp: serverEnv("VOICE_ANNOUNCED_IP"),
    voiceDomain: serverEnv("VOICE_DOMAIN"),
    voiceRtcPort: serverEnv("VOICE_RTC_PORT", "44444"),
    worldRegistryUrl: serverEnv("WORLD_REGISTRY_URL"),
  };
}

function voiceAnnounceUnroutable(): boolean {
  const voice = voiceConfig();
  return voice.mode === "sfu" && isUnroutableAddress(announcedAddressFor(voice));
}

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  return Response.json({
    config: maskedConfig(getGlobalConfig()),
    envDefaults: envDefaults(),
    voiceAnnounceUnroutable: voiceAnnounceUnroutable(),
    deviceWorld: isDeviceWorld(),
  });
}

const patchSchema = z.object({
  signupsEnabled: z.boolean().optional(),
  signupMode: z.enum(["open", "invite", "closed"]).optional(),
  serverName: z.string().trim().max(100).optional(),
  accountDeletionGraceDays: z.number().int().min(0).max(90).optional(),
  publicUrl: z.string().trim().max(500).optional(),
  worldRegistryUrl: z.string().trim().max(500).optional(),
  voiceChat: z.object({
    enabled: z.enum(["", "on", "off"]).optional(),
    mode: z.enum(["", "sfu", "mesh"]).optional(),
    announcedIp: z.string().trim().max(200).optional(),
    domain: z.string().trim().max(300).optional(),
    rtcPort: z.string().trim().max(10).optional(),
  }).optional(),
  discord: z.object({
    clientId: z.string().trim().max(100).optional(),
    clientSecret: z.string().trim().max(200).optional(),
  }).optional(),
});

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) return admin;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid settings." }, { status: 400 });
  }
  const patch = { ...parsed.data };
  if (isDeviceWorld()) {
    delete patch.signupsEnabled;
    delete patch.signupMode;
    delete patch.voiceChat;
    delete patch.discord;
  }
  const config = saveGlobalConfig(patch);
  return Response.json({
    config: maskedConfig(config),
    envDefaults: envDefaults(),
    voiceAnnounceUnroutable: voiceAnnounceUnroutable(),
    deviceWorld: isDeviceWorld(),
  });
}
