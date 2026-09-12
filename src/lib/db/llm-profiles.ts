import { nowIso } from "@/lib/db/core";
import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { saveGlobalConfig } from "@/lib/db/app-settings";
import {
  llmProfileSchema,
  type LlmProfile,
  type LlmProfileCreate,
  type MaskedLlmProfile,
  maskLlmProfile,
} from "@/lib/schemas/llm-profile";
import { updateStorySettings } from "@/lib/db/campaigns";

// Storage key in app_settings table. Value is a JSON array of profiles.
const LLM_PROFILES_KEY = "llm_profiles";

function readAllProfiles(): LlmProfile[] {
  const raw = getAppSetting<unknown>(LLM_PROFILES_KEY, []);
  if (!Array.isArray(raw)) return [];
  // Validate each profile, skip invalid ones
  return raw
    .map((item) => {
      const parsed = llmProfileSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((p): p is LlmProfile => p !== null);
}

function writeAllProfiles(profiles: LlmProfile[]) {
  setAppSetting(LLM_PROFILES_KEY, profiles);
}

// List all profiles (masked: apiKey replaced with hasApiKey boolean).
export function listLlmProfiles(): MaskedLlmProfile[] {
  return readAllProfiles().map(maskLlmProfile);
}

// Get one profile by id (full, server-side only — includes apiKey).
export function getLlmProfile(id: string): LlmProfile | null {
  const all = readAllProfiles();
  return all.find((p) => p.id === id) ?? null;
}

// Atomic upsert: read-modify-write the array. If profile.id exists, replace; otherwise append.
export function upsertLlmProfile(profile: LlmProfile): LlmProfile {
  const all = readAllProfiles();
  const idx = all.findIndex((p) => p.id === profile.id);
  const now = nowIso();
  const withTimestamps = {
    ...profile,
    updatedAt: now,
    createdAt: idx >= 0 ? all[idx].createdAt : now,
  };
  const validated = llmProfileSchema.parse(withTimestamps);
  if (idx >= 0) {
    all[idx] = validated;
  } else {
    all.push(validated);
  }
  writeAllProfiles(all);
  return validated;
}

// Create a new profile from API input. Generates id if absent.
export function createLlmProfile(input: LlmProfileCreate): LlmProfile {
  const id = input.id ?? crypto.randomUUID();
  const now = nowIso();
  const profile: LlmProfile = {
    id,
    name: input.name,
    kind: input.kind,
    preset: input.preset,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    model: input.model,
    authMode: input.authMode,
    apiKey: input.apiKey ?? "",
    contextLimit: input.contextLimit ?? null,
    contextVerified: input.contextVerified ?? false,
    maxOutputTokens: input.maxOutputTokens,
    thinking: input.thinking ?? "auto",
    timeoutMs: input.timeoutMs,
    sampling: input.sampling,
    lastCheck: null,
    createdAt: now,
    updatedAt: now,
  };
  return upsertLlmProfile(profile);
}

// Update an existing profile. apiKey: undefined=keep, ""=clear, value=set.
export function updateLlmProfile(
  id: string,
  input: Partial<LlmProfileCreate>,
): LlmProfile | null {
  const existing = getLlmProfile(id);
  if (!existing) return null;
  const merged: LlmProfile = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.preset !== undefined ? { preset: input.preset } : {}),
    ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
    // apiKey: undefined=keep existing, ""=clear, value=set
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
    ...(input.contextLimit !== undefined ? { contextLimit: input.contextLimit } : {}),
    ...(input.contextVerified !== undefined ? { contextVerified: input.contextVerified } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.sampling !== undefined ? { sampling: input.sampling } : {}),
  };
  return upsertLlmProfile(merged);
}

// Update lastCheck field after a probe.
export function updateLlmProfileCheck(
  id: string,
  lastCheck: LlmProfile["lastCheck"],
): LlmProfile | null {
  const existing = getLlmProfile(id);
  if (!existing) return null;
  return upsertLlmProfile({ ...existing, lastCheck });
}

// Delete a profile by id.
export function deleteLlmProfile(id: string): boolean {
  const all = readAllProfiles();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  writeAllProfiles(filtered);
  return true;
}

// Apply profile to global config: writes text.provider, customBaseUrl, customModel, customApiKey.
// For ollama-native (local-runtime with preset ollama), we still use custom provider with the /v1 URL
// because the global config doesn't have a separate "local" field for arbitrary Ollama URLs.
export function applyLlmProfileToGlobal(profileId: string): boolean {
  const profile = getLlmProfile(profileId);
  if (!profile) return false;
  saveGlobalConfig({
    text: {
      provider: "custom",
      customBaseUrl: profile.baseUrl,
      customModel: profile.model,
      customApiKey: profile.apiKey,
    },
  });
  return true;
}

// Apply profile to a campaign's story settings. Returns the FRESH merged
// settings (or null) so callers can respond with the post-apply state.
export function applyLlmProfileToCampaign(profileId: string, campaignId: string) {
  const profile = getLlmProfile(profileId);
  if (!profile) return null;
  return updateStorySettings(campaignId, {
    textProvider: "custom",
    customBaseUrl: profile.baseUrl,
    customModel: profile.model,
    customApiKey: profile.apiKey,
  });
}
