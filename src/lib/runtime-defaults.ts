import { getAppSetting, getGlobalConfig } from "@/lib/db/app-settings";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import { serverEnv } from "@/lib/server-env";
import { isLocalTextModelId, isTextProvider } from "@/lib/text-models";
import { isImageBackend } from "@/lib/types";
import type { StorySettings } from "@/lib/types";
import { GLOBAL_MODEL_RUNTIME_KEY, normalizeModelRuntime } from "@/lib/model-runtime";

function clean(value: string) { return value.trim(); }

// New campaign defaults: admin panel > environment > built-in settings.
export function configuredDefaultStorySettings(): StorySettings {
  const cfg = getGlobalConfig();
  const customBaseUrl = cfg.text.customBaseUrl || clean(serverEnv("OPENAI_COMPAT_BASE_URL"));
  const openRouterDefaultModel = /(^|\.)openrouter\.ai/i.test(customBaseUrl)
    ? clean(serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash")) : "";
  const customModel = cfg.text.customModel || clean(serverEnv("OPENAI_COMPAT_MODEL")) || openRouterDefaultModel;
  const requestedProvider = cfg.text.provider || clean(serverEnv("DEFAULT_TEXT_PROVIDER"));
  const textProvider = isTextProvider(requestedProvider) ? requestedProvider : customBaseUrl ? "custom" : DEFAULT_STORY_SETTINGS.textProvider;
  const requestedLocalModel = cfg.text.localTextModel || clean(serverEnv("LOCAL_TEXT_MODEL"));
  const localTextModel = isLocalTextModelId(requestedLocalModel) ? requestedLocalModel : DEFAULT_STORY_SETTINGS.localTextModel;
  const requestedUtilityProvider = cfg.text.utilityProvider || clean(serverEnv("UTILITY_TEXT_PROVIDER"));
  const utilityProvider = isTextProvider(requestedUtilityProvider) ? requestedUtilityProvider : DEFAULT_STORY_SETTINGS.utilityProvider;
  const requestedImageBackend = cfg.images.defaultBackend || clean(serverEnv("DEFAULT_IMAGE_BACKEND"));
  const imageBackend = isImageBackend(requestedImageBackend) ? requestedImageBackend : DEFAULT_STORY_SETTINGS.imageBackend;
  const resolvedBase = textProvider === "none" ? "" : customBaseUrl || DEFAULT_STORY_SETTINGS.customBaseUrl;
  const resolvedModel = textProvider === "none" ? "" : customModel || DEFAULT_STORY_SETTINGS.customModel;
  return {
    ...DEFAULT_STORY_SETTINGS,
    textProvider, localTextModel, imageBackend, utilityProvider,
    utilityModel: cfg.text.utilityModel || clean(serverEnv("UTILITY_TEXT_MODEL")),
    utilityBaseUrl: cfg.text.utilityBaseUrl || clean(serverEnv("UTILITY_TEXT_BASE_URL")),
    utilityApiKey: "",
    customBaseUrl: resolvedBase,
    customModel: resolvedModel,
    customApiKey: "",
    modelRuntime: textProvider === "custom"
      ? normalizeModelRuntime(getAppSetting(GLOBAL_MODEL_RUNTIME_KEY, null), resolvedBase, resolvedModel) : null,
    comfyUrl: cfg.images.comfyUrl || DEFAULT_STORY_SETTINGS.comfyUrl,
    comfyCheckpoint: cfg.images.comfyCheckpoint || DEFAULT_STORY_SETTINGS.comfyCheckpoint,
  };
}
