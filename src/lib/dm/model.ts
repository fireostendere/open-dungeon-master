import type { StorySettings } from "@/lib/types";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown[];
  tool_calls?: unknown;
  tool_call_id?: string;
};
export type UpstreamResult = { message?: { content?: unknown }; error?: Response };

// The server no longer performs inference. External narrator clients own it.
export async function requestUtilityMessage(
  _settings: StorySettings,
  _messages: ChatMessage[],
  _options: { timeoutMs?: number },
): Promise<UpstreamResult> {
  return { error: new Response(null, { status: 503 }) };
}
