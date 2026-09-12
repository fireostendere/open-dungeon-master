import { generateComfyImage } from "@/lib/comfyui";
import { generateDashScopeImage, dashScopeImagesConfigured } from "@/lib/dashscope-images";
import { generateOpenAiImage, openAiImagesConfigured } from "@/lib/openai-images";
import type { AspectPreset, GeneratedImage, ImageBackend, ImageMode, StorySettings } from "@/lib/types";

// The one producer-side door for story images, so every enqueue site
// (narration images, location maps, portraits) honors the campaign's backend
// the same way instead of each hardcoding ComfyUI.
//
// Only ComfyUI and OpenAI have a producer here. The FLUX backends (mflux-hs,
// sdnq-hs) are driven by their own worker process; for them a request is
// recorded and the placeholder tells the table a picture is coming, exactly
// as before.
export function imageProducerReady(
  backend: ImageBackend,
  settings?: { imageApiKey?: string; imageBaseUrl?: string; imageModel?: string },
): boolean {
  if (backend === "comfyui") {
    return true;
  }
  if (backend === "openai") {
    // A campaign-scoped image key counts: the producer resolves it in
    // resolveOpenAiImageConfig ahead of the global config/env key.
    return Boolean(settings?.imageApiKey?.trim()) || openAiImagesConfigured();
  }
  if (backend === "dashscope") {
    return dashScopeImagesConfigured({ apiKey: settings?.imageApiKey });
  }
  return false;
}

export function generateStoryImage(
  settings: StorySettings,
  options: {
    prompt: string;
    mode: ImageMode;
    aspect: AspectPreset;
    seed?: number;
    hasReferences?: boolean;
  },
): Promise<GeneratedImage> {
  if (settings.imageBackend === "openai") {
    // Pass per-campaign OpenAI overrides; empty strings fall through to
    // global config/env in resolveOpenAiImageConfig.
    const overrides = {
      baseUrl: settings.imageBaseUrl || undefined,
      model: settings.imageModel || undefined,
      apiKey: settings.imageApiKey || undefined,
    };
    return generateOpenAiImage(options, overrides);
  }
  if (settings.imageBackend === "dashscope") {
    // Same per-campaign override contract; env provides the server-wide
    // DASHSCOPE_IMAGE_* fallbacks inside resolveDashScopeImageConfig.
    return generateDashScopeImage(options, {
      baseUrl: settings.imageBaseUrl || undefined,
      model: settings.imageModel || undefined,
      apiKey: settings.imageApiKey || undefined,
    });
  }
  // Everything else lands on ComfyUI, which was the previous behavior for
  // every producer-side call regardless of the selected backend.
  return generateComfyImage({
    url: settings.comfyUrl || undefined,
    checkpoint: settings.comfyCheckpoint || undefined,
    ...options,
  });
}
