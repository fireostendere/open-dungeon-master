import { createCampaignStream } from "@/lib/campaign-stream";
import { getCampaignById, latestSeq } from "@/lib/db/campaigns";
import { listEventsSince, subscribeRawObserver } from "@/lib/events";
import { authenticateMcp, authorizeMcpAction, McpAccessError, type McpPrincipal } from "@/lib/mcp-access.mjs";
import { narratorSignalChunk, parseNarratorCursor, reduceNarratorLiveChunk } from "@/lib/narrator-signal-stream.mjs";
import { subscribeSpatialChanges } from "@/lib/spatial/updates.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Private room activity never enters the shared event bus; the narrator only
// learns that something changed and reads the rooms through narrator.read.
const SPATIAL_ACTIVITY = "event: spatial_activity\ndata: {}\n\n";

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

/**
 * Narrator doorbell: a contentless wake stream for the external narrator.
 * Every frame is reduced to {type, seq, authorType?, kind?}; the narrator then
 * reads real state through narrator.read with the same credential.
 */
export async function GET(request: Request) {
  let principal: McpPrincipal;
  try { principal = authenticateMcp(request); }
  catch (error) {
    if (error instanceof McpAccessError) return json({ error: error.message }, error.status);
    throw error;
  }
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId")?.trim() ?? "";
  if (!UUID.test(campaignId)) return json({ error: "Invalid campaignId." }, 400);
  // Exactly the gate of a narrator.read of this campaign: operator credentials
  // pass; the narrator credential only for its configured campaign.
  try { authorizeMcpAction(principal, "narrator.read", { campaignId }); }
  catch (error) {
    if (error instanceof McpAccessError) return json({ error: error.message }, error.status);
    throw error;
  }
  const afterSeq = parseNarratorCursor(request.headers.get("last-event-id"), url.searchParams.get("afterSeq"));
  if (afterSeq === null) return json({ error: "Invalid event stream cursor." }, 400);
  const campaign = getCampaignById(campaignId);
  if (!campaign) return json({ error: "Campaign not found." }, 404);

  // The narrator acts from the DM seat: it receives the DM's ephemeral frames
  // (private asks, whisper replies) without ever appearing in presence.
  const observer = campaign.dmUserId ?? null;
  const stream = createCampaignStream({
    afterSeq, signal: request.signal,
    // A deleted campaign or a changed DM seat ends the stream; reconnecting
    // re-runs every check above.
    canDeliver: () => {
      const current = getCampaignById(campaignId);
      return Boolean(current) && (current?.dmUserId ?? null) === observer;
    },
    latestSeq: () => latestSeq(campaignId),
    listEventsSince: (cursor, limit) => listEventsSince(campaignId, cursor, limit),
    subscribe: send => {
      const releaseEvents = subscribeRawObserver(campaignId, send, observer);
      const releaseSpatial = subscribeSpatialChanges(campaignId, () => { try { send(SPATIAL_ACTIVITY); } catch { /* stream closed */ } });
      return () => { releaseSpatial(); releaseEvents(); };
    },
    // Replay, checkpoint and refresh frames are serialized as signals; live
    // frames are reduced at dequeue. Neither path can emit a payload body.
    sseChunk: narratorSignalChunk,
    projectLive: reduceNarratorLiveChunk,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff",
    },
  });
}
