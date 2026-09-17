import { isOocMessage } from "@/lib/campaign-types";

/** Hide table talk from narrator-facing event feeds, including later edits. */
export function isNarratorEvent(event: { type: string; payload: unknown }): boolean {
  if (event.type !== "message_added" && event.type !== "message_updated") return true;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || !("message" in payload)) return true;
  const message = payload.message;
  return !(message && typeof message === "object" && "content" in message &&
    typeof message.content === "string" && isOocMessage({ content: message.content }));
}
