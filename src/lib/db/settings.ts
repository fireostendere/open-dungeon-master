import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { isLocalTextModelId, isTextProvider } from "@/lib/text-models";
import { isImageBackend, isProseSize } from "@/lib/types";
import type { StorySettings } from "@/lib/types";
import { normalizeModelRuntime } from "@/lib/model-runtime";

export function normalizeSettings(settings?: Partial<StorySettings>): StorySettings {
  const defaultSettings = configuredDefaultStorySettings();
  const merged = { ...defaultSettings, ...settings };
  const legacy = (settings ?? {}) as Record<string, unknown>;
  if (legacy.textProvider === "openrouter") {
    merged.textProvider = "custom";
    if (!merged.customBaseUrl) merged.customBaseUrl = "https://openrouter.ai/api/v1";
    if (!merged.customModel && typeof legacy.openrouterModel === "string") merged.customModel = legacy.openrouterModel;
    if (!merged.customApiKey && typeof legacy.openrouterApiKey === "string") merged.customApiKey = legacy.openrouterApiKey;
  }
  if (merged.aspect !== "square" && merged.aspect !== "portrait" && merged.aspect !== "landscape") merged.aspect = defaultSettings.aspect;
  if (!isImageBackend(merged.imageBackend)) merged.imageBackend = defaultSettings.imageBackend;
  merged.comfyUrl = typeof merged.comfyUrl === "string" ? merged.comfyUrl.trim().slice(0, 500) : "";
  merged.comfyCheckpoint = typeof merged.comfyCheckpoint === "string" ? merged.comfyCheckpoint.trim().slice(0, 300) : "";
  merged.imageModel = typeof merged.imageModel === "string" ? merged.imageModel.trim().slice(0, 200) : "";
  merged.imageBaseUrl = typeof merged.imageBaseUrl === "string" ? merged.imageBaseUrl.trim().slice(0, 500) : "";
  merged.imageApiKey = typeof merged.imageApiKey === "string" ? merged.imageApiKey.trim().slice(0, 400) : "";
  if (merged.imageMode !== "fast" && merged.imageMode !== "slow") merged.imageMode = defaultSettings.imageMode;
  if (typeof merged.imageGenerationEnabled !== "boolean") merged.imageGenerationEnabled = defaultSettings.imageGenerationEnabled;
  if (typeof merged.autoImages !== "boolean") merged.autoImages = defaultSettings.autoImages;
  if (!isProseSize(merged.proseSize)) merged.proseSize = defaultSettings.proseSize;
  if (!isTextProvider(merged.textProvider)) merged.textProvider = defaultSettings.textProvider;
  if (!isLocalTextModelId(merged.localTextModel)) merged.localTextModel = defaultSettings.localTextModel;
  merged.customBaseUrl = typeof merged.customBaseUrl === "string" ? merged.customBaseUrl.trim().slice(0, 500) : "";
  merged.customModel = typeof merged.customModel === "string" ? merged.customModel.trim().slice(0, 200) : "";
  merged.customApiKey = typeof merged.customApiKey === "string" ? merged.customApiKey.trim().slice(0, 400) : "";
  merged.modelRuntime = merged.textProvider === "custom"
    ? normalizeModelRuntime(merged.modelRuntime, merged.customBaseUrl, merged.customModel) : null;
  if (!isTextProvider(merged.utilityProvider)) merged.utilityProvider = defaultSettings.utilityProvider;
  merged.utilityModel = typeof merged.utilityModel === "string" ? merged.utilityModel.trim().slice(0, 200) : "";
  merged.utilityBaseUrl = typeof merged.utilityBaseUrl === "string" ? merged.utilityBaseUrl.trim().slice(0, 500) : "";
  merged.utilityApiKey = typeof merged.utilityApiKey === "string" ? merged.utilityApiKey.trim().slice(0, 400) : "";
  return merged;
}

// Both secrets and arbitrary fields injected into runtime metadata are stripped
// at every public projection, even when a caller skipped normalization.
export function scrubStorySettings(settings: StorySettings): StorySettings {
  return { ...settings, customApiKey: "", utilityApiKey: "", imageApiKey: "",
    modelRuntime: normalizeModelRuntime(settings.modelRuntime, settings.customBaseUrl, settings.customModel) };
}
export type MaskedStorySettings = Omit<StorySettings, "customApiKey" | "utilityApiKey" | "imageApiKey"> & {
  hasCustomApiKey: boolean; hasUtilityApiKey: boolean; hasImageApiKey: boolean;
};
export function maskStorySettings(settings: StorySettings): MaskedStorySettings {
  const { customApiKey, utilityApiKey, imageApiKey, ...rest } = settings;
  return {
    ...rest, modelRuntime: normalizeModelRuntime(settings.modelRuntime, settings.customBaseUrl, settings.customModel),
    hasCustomApiKey: customApiKey !== "", hasUtilityApiKey: utilityApiKey !== "", hasImageApiKey: imageApiKey !== "",
  };
}
