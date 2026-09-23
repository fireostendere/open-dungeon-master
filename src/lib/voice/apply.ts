import { getActiveBattleMap } from "@/lib/battlemap/view";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { listTokens } from "@/lib/db/battle-maps";
import { capsFor, getCampaignById } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { computeAudibility, diffAudibility, type AudibilitySeat } from "@/lib/voice/audibility";
import { voiceAccess } from "@/lib/voice/location-access";
import { mayShareVoice, voiceChannel } from "@/lib/voice/location-policy";
import { enforceVoiceScope } from "@/lib/voice/location-runtime";
import { getRoom } from "@/lib/voice/room";

export type SeatPeer = { userId: string; channelId: string; sayRange: "whisper" | "normal" | "shout" };
export function buildSeats(campaignId: string, peers: SeatPeer[]): {
  seats: AudibilitySeat[];
  blocked?: (ax: number, ay: number, bx: number, by: number) => boolean;
} {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { seats: [] };
  const access = voiceAccess(campaignId);
  const sheets = listSheets(campaignId);
  const map = getActiveBattleMap(campaignId);
  const tokens = map ? listTokens(map.id) : [];
  const seats = peers.filter(peer => access.members.has(peer.userId)).map(peer => {
    const sheet = sheets.find(entry => entry.userId === peer.userId && !entry.isCompanion);
    const token = sheet ? tokens.find(entry => entry.refId === sheet.id) : undefined;
    return {
      userId: peer.userId,
      channelId: voiceChannel(access, peer.userId),
      // Private rooms never inherit the old omniscient-DM audio exception.
      adjudicates: access.scope === "global" && capsFor(campaign, peer.userId).adjudicates,
      position: token ? { x: token.x, y: token.y } : null,
      sayRange: peer.sayRange,
      downed: Boolean(sheet && sheet.currentHp <= 0),
    };
  });
  const blocked = map ? (ax: number, ay: number, bx: number, by: number) =>
    !hasLineOfSight(map.terrain, map.width, map.height, ax, ay, bx, by) : undefined;
  return { seats, blocked };
}

// Serialize async worker commands per room. A move still revokes synchronously
// through location-runtime, including while an earlier resume is awaiting IPC.
const applying = new Map<string, Promise<void>>();
export function applyAudibility(campaignId: string): Promise<void> {
  const room = getRoom(campaignId);
  if (room) enforceVoiceScope(room);
  const operation = (applying.get(campaignId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const current = getRoom(campaignId);
    const campaign = getCampaignById(campaignId);
    if (!current || !campaign) return;
    enforceVoiceScope(current);
    const { seats, blocked } = buildSeats(campaignId, [...current.peers.values()]);
    const next = computeAudibility(seats, campaign.gameSettings.voice.rules, { blocked });
    const diff = diffAudibility(current.audibility, next);
    // Reconcile actual consumers too: a newly rebuilt subscription need not
    // appear in a diff against an earlier cached authorization matrix.
    for (const listener of current.peers.values()) {
      for (const [speakerId, consumer] of listener.consumers) {
        if (consumer.closed) continue;
        try {
          if (!mayHear(campaignId, listener.userId, speakerId)) {
            if (!consumer.paused) await consumer.pause();
          }
          // Newly created consumers are resumed only by the client's resume
          // acknowledgement; otherwise early speech can be lost.
          else if (consumer.appData.odmReady && consumer.paused) {
            await consumer.resume();
          }
        } catch (error) {
          if (!consumer.closed) throw error;
        }
      }
    }
    enforceVoiceScope(current);
    current.audibility = next;
    if (diff.pause.size || diff.resume.size || diff.gains.size) {
      publishEphemeral(campaignId, "voice_audibility_changed", {});
    }
  });
  applying.set(campaignId, operation);
  void operation.finally(() => { if (applying.get(campaignId) === operation) applying.delete(campaignId); }).catch(() => {});
  return operation;
}

// Compute the current row instead of trusting a grant cached before movement.
export function gainsFor(campaignId: string, userId: string): Record<string, number> {
  const room = getRoom(campaignId);
  const campaign = getCampaignById(campaignId);
  if (!room || !campaign) return {};
  const { seats, blocked } = buildSeats(campaignId, [...room.peers.values()]);
  return Object.fromEntries(computeAudibility(seats, campaign.gameSettings.voice.rules, { blocked }).get(userId) ?? []);
}
export function mayHear(campaignId: string, listenerId: string, speakerId: string): boolean {
  const room = getRoom(campaignId);
  if (!room?.peers.has(listenerId) || !room.peers.has(speakerId)) return false;
  if (!mayShareVoice(voiceAccess(campaignId), listenerId, speakerId)) return false;
  return Object.hasOwn(gainsFor(campaignId, listenerId), speakerId);
}
