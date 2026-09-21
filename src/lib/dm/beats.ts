import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertDmBeat, type DmBeat } from "@/lib/db/dm-beats";
import { getLatestDmMessage, insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { normalizeBeatBody, type BeatKind, type BeatSource } from "@/lib/dm/beat-logic";

export function recordBeat(
  campaign: Campaign,
  authorUserId: string,
  input: { body: string; kind: BeatKind; source: BeatSource },
): { beat: DmBeat; messageId: string } {
  const body = normalizeBeatBody(input.body);
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "dm",
    userId: authorUserId,
    content: body,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message, beat: true });
  const beat = insertDmBeat({
    campaignId: campaign.id,
    seq,
    messageId: message.id,
    authorUserId,
    kind: input.kind,
    source: input.source,
    body,
  });
  publishPersisted(campaign.id, "beat_recorded", { beat });
  return { beat, messageId: message.id };
}

export function storyCutoffAt(campaignId: string): string {
  return getLatestDmMessage(campaignId)?.createdAt ?? "";
}
