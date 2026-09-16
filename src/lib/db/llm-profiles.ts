import { getDatabase, nowIso } from "@/lib/db/core";
import { getAppSetting, setAppSetting, saveGlobalConfig } from "@/lib/db/app-settings";
import { llmProfileSchema, type LlmProfile, type LlmProfileCreate, type MaskedLlmProfile, maskLlmProfile } from "@/lib/schemas/llm-profile";
import { DEFAULT_GLOBAL_CONFIG } from "@/lib/schemas/global-config";
import { updateStorySettings } from "@/lib/db/campaigns";
import { profileHasChanged } from "@/lib/provider-auth/core.mjs";
import { GLOBAL_MODEL_RUNTIME_KEY, modelRuntimeSnapshot } from "@/lib/model-runtime";
const LLM_PROFILES_KEY = "llm_profiles";
function readAllProfiles(): LlmProfile[] {
  const raw = getAppSetting<unknown>(LLM_PROFILES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(item => { const parsed = llmProfileSchema.safeParse(item); return parsed.success ? parsed.data : null; }).filter((p): p is LlmProfile => p !== null);
}
function writeAllProfiles(profiles: LlmProfile[]) { setAppSetting(LLM_PROFILES_KEY, profiles); }
export function listLlmProfiles(): MaskedLlmProfile[] { return readAllProfiles().map(maskLlmProfile); }
export function getLlmProfile(id: string): LlmProfile | null { return readAllProfiles().find(p => p.id === id) ?? null; }
// Connection edits invalidate their previous probe. Applied campaign snapshots
// remain immutable until the operator explicitly reapplies that profile.
export function upsertLlmProfile(profile: LlmProfile): LlmProfile {
  const all = readAllProfiles(), idx = all.findIndex(p => p.id === profile.id), now = nowIso();
  const validated = llmProfileSchema.parse({ ...profile, updatedAt: now, createdAt: idx >= 0 ? all[idx].createdAt : now,
    lastCheck: idx >= 0 && profileHasChanged(all[idx], profile) ? null : profile.lastCheck });
  if (idx >= 0) all[idx] = validated; else all.push(validated);
  writeAllProfiles(all); return validated;
}
export function createLlmProfile(input: LlmProfileCreate): LlmProfile {
  const now = nowIso();
  return upsertLlmProfile({ id: input.id ?? crypto.randomUUID(), name: input.name, kind: input.kind, preset: input.preset,
    protocol: input.protocol, baseUrl: input.baseUrl, model: input.model, authMode: input.authMode, apiKey: input.apiKey ?? "",
    contextLimit: input.contextLimit ?? null, contextVerified: input.contextVerified ?? false,
    maxOutputTokens: input.maxOutputTokens, thinking: input.thinking ?? "auto", timeoutMs: input.timeoutMs,
    sampling: input.sampling, lastCheck: null, createdAt: now, updatedAt: now });
}
export function updateLlmProfile(id: string, input: Partial<LlmProfileCreate>): LlmProfile | null {
  const existing = getLlmProfile(id); if (!existing) return null;
  const allowed = ["name","kind","preset","protocol","baseUrl","model","authMode","apiKey","contextLimit","contextVerified","maxOutputTokens","thinking","timeoutMs","sampling"] as const;
  const patch = Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key,input[key]]));
  return upsertLlmProfile({ ...existing, ...patch });
}
export function updateLlmProfileCheck(id: string, lastCheck: LlmProfile["lastCheck"], expected?: LlmProfile): LlmProfile | null {
  const existing = getLlmProfile(id);
  if (!existing || (expected && profileHasChanged(existing, expected))) return null;
  return upsertLlmProfile({ ...existing, lastCheck });
}
export function deleteLlmProfile(id: string): boolean {
  const all = readAllProfiles(), filtered = all.filter(p => p.id !== id);
  if (filtered.length === all.length) return false;
  writeAllProfiles(filtered); return true;
}
// HTTP callers verify the tool-probe state before entering this low-level API.
export function applyLlmProfileToGlobal(profileId: string): boolean {
  const p = getLlmProfile(profileId); if (!p) return false;
  const runtime = modelRuntimeSnapshot(p);
  getDatabase().transaction(() => {
    saveGlobalConfig({ text: { provider: "custom", customBaseUrl: p.baseUrl, customModel: p.model, customApiKey: p.apiKey,
      maxOutputTokens: p.maxOutputTokens ?? 0, timeoutMs: p.timeoutMs ?? 0, thinking: p.thinking === "auto" ? "" : p.thinking },
      sampling: { story: { ...DEFAULT_GLOBAL_CONFIG.sampling.story, ...p.sampling } } });
    setAppSetting(GLOBAL_MODEL_RUNTIME_KEY, runtime);
  })();
  return true;
}
export function applyLlmProfileToCampaign(profileId: string, campaignId: string) {
  const p = getLlmProfile(profileId); if (!p) return null;
  return updateStorySettings(campaignId, { textProvider: "custom", customBaseUrl: p.baseUrl, customModel: p.model,
    customApiKey: p.apiKey, modelRuntime: modelRuntimeSnapshot(p) });
}
