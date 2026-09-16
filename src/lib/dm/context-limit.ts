import { listLlmProfiles } from "@/lib/db/llm-profiles";
import { storyContextTokens } from "@/lib/model-client";
import type { StorySettings } from "@/lib/types";

function normalizedEndpoint(value: string) {
  return value.trim().replace(/\/+$/, "");
}

// Resolve the prompt budget from the same saved profile that supplied the
// campaign's custom endpoint/model. Explicit OPENAI_COMPAT_CONTEXT remains an
// operator-level override and therefore wins over per-profile limits.
export function resolvedStoryContextTokens(settings: StorySettings): number {
  const configured = Number.parseInt(process.env.OPENAI_COMPAT_CONTEXT ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return storyContextTokens(settings);
  }
  if (settings.textProvider !== "custom") {
    return storyContextTokens(settings);
  }

  const baseUrl = normalizedEndpoint(settings.customBaseUrl ?? "");
  const model = (settings.customModel ?? "").trim();
  const matching = listLlmProfiles()
    .filter(
      (profile) =>
        profile.contextLimit &&
        profile.contextLimit > 0 &&
        profile.model === model &&
        normalizedEndpoint(profile.baseUrl) === baseUrl,
    )
    // Prefer a verified capability when several historical profiles point at
    // the same backend/model; otherwise the newest explicit limit still beats
    // the unrelated generic 16k fallback.
    .sort((a, b) => Number(b.contextVerified) - Number(a.contextVerified))[0];

  return matching?.contextLimit
    ? Math.max(2_048, matching.contextLimit)
    : storyContextTokens(settings);
}
