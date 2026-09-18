import { getDatabase } from "@/lib/db/core";
import { consumeIngress, IngressLimit } from "@/lib/db/ingress-budget.mjs";
export function enforcePlayerIngress(campaignId: string, userId: string, channel: "ask" | "whisper" | "action"): Response | null {
  try { consumeIngress(getDatabase(), campaignId, userId, channel); return null; }
  catch (error) {
    if (!(error instanceof IngressLimit)) throw error;
    return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
  }
}
