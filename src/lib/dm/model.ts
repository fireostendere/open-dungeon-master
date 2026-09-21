import type { StorySettings } from "@/lib/types";
import type { ChatMessage } from "@/lib/model-client";

export type UpstreamResult = { message?: { content?: unknown }; error?: Response };

// The server no longer performs inference. External narrator clients own it.
export async function requestUtilityMessage(
  _settings: StorySettings,
  _messages: ChatMessage[],
  _options: { timeoutMs?: number },
): Promise<UpstreamResult> {
  return { error: new Response(null, { status: 503 }) };
}
