export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown[];
  tool_calls?: unknown;
  tool_call_id?: string;
};

// Compatibility value for retired server-side model callers.
export function arcTextTimeoutMs(): number {
  return 30_000;
}
