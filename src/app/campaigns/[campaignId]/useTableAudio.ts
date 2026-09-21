"use client";

import { useAmbienceAudio } from "@/app/campaigns/[campaignId]/useAmbienceAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

// Hosted narration/TTS was retired. Table audio now owns only persisted
// ambience/music; external/local speech can be integrated independently
// without reviving a server-side speech runtime.
export function useTableAudio(state: CampaignState) {
  const ambience = useAmbienceAudio(
    state.ambience,
    state.ambienceSting,
    Boolean(state.campaign?.gameSettings?.ambienceEnabled),
  );
  return { ambience };
}
