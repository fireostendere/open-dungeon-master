import { voiceConfig, type VoiceMode } from "@/lib/voice/config";

export type Capabilities = {
  story: { configured: false; reachable: false };
  utility: { configured: false };
  images: { configured: false; reachable: false; backend: "" };
  tts: { configured: false; reachable: false };
  stt: { configured: false };
  voice: { enabled: boolean; mode: VoiceMode };
};

// Kept as a compatibility shape while clients migrate away from server-AI
// capability checks. Every inference capability is deliberately false.
export async function capabilitiesSnapshot(): Promise<Capabilities> {
  const voice = voiceConfig();
  return {
    story: { configured: false, reachable: false },
    utility: { configured: false },
    images: { configured: false, reachable: false, backend: "" },
    tts: { configured: false, reachable: false },
    stt: { configured: false },
    voice: { enabled: voice.enabled, mode: voice.mode },
  };
}
