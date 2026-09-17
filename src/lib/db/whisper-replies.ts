import { getDatabase } from "@/lib/db/core";
import { getCampaignById } from "@/lib/db/campaigns";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { insertWhisper, type WhisperRecipient } from "@/lib/db/dm-whispers";
import { publishUserEphemeral } from "@/lib/events";

/** A reply acknowledges exactly the messages the caller read, never a moving
 * "all pending" set. Explicit replies may only go to their original authors.
 * General DM sends (no reply IDs) keep their existing multi-recipient behavior.
 */
export function deliverWhisperReply(
  campaignId: string,
  turnId: string,
  recipients: WhisperRecipient[],
  message: string,
  replyToWhisperIds: string[] = [],
): string {
  const ids = [...new Set(replyToWhisperIds)];
  if (!recipients.length || ids.length > 20) throw new Error("Invalid private reply recipients or message count.");
  const db = getDatabase();
  return withCommittedEffects(() => db.transaction(() => {
    const turn = db.prepare("SELECT campaign_id FROM dm_turns WHERE id = ?").get(turnId) as { campaign_id: string } | undefined;
    if (!turn || turn.campaign_id !== campaignId) throw new Error("Private reply turn belongs to another campaign.");
    const senders = new Set<string>();
    for (const id of ids) {
      const row = db.prepare(`SELECT user_id, character_id FROM dm_whispers
        WHERE campaign_id = ? AND id = ? AND direction = 'to_dm' AND answered_turn_id IS NULL`)
        .get(campaignId, id) as { user_id: string; character_id: string | null } | undefined;
      if (!row || !recipients.some((recipient) => recipient.userId === row.user_id && recipient.characterId === row.character_id)) {
        throw new Error("Reply IDs must be pending messages in this campaign from the selected recipients.");
      }
      senders.add(row.user_id);
    }
    if (ids.length && recipients.some((recipient) => !senders.has(recipient.userId))) {
      throw new Error("A private reply cannot add recipients who did not send these messages.");
    }
    const groupId = insertWhisper(campaignId, turnId, recipients, message);
    const acknowledge = db.prepare(`UPDATE dm_whispers SET answered_turn_id = ?
      WHERE campaign_id = ? AND id = ? AND direction = 'to_dm' AND answered_turn_id IS NULL`);
    for (const id of ids) {
      if (acknowledge.run(turnId, campaignId, id).changes !== 1) throw new Error("Private message changed before acknowledgement.");
    }
    const users = new Set(recipients.map((recipient) => recipient.userId));
    const dmUserId = getCampaignById(campaignId)?.dmUserId;
    if (dmUserId) users.add(dmUserId);
    for (const userId of users) publishUserEphemeral(campaignId, userId, "whisper_activity", {});
    return groupId;
  })());
}
