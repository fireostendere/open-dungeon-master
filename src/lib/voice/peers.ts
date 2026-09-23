// Preserve the existing transport/microphone lifecycle. Authorization wraps
// its public boundary; the unchanged implementation lives in peers-core.ts.
export * from "@/lib/voice/peers-core";
import * as core from "@/lib/voice/peers-core";
import type { RtpCapabilities } from "mediasoup/types";
import { getRoom, type VoicePeer, type VoiceRoom } from "@/lib/voice/room";
import { voiceAccess } from "@/lib/voice/location-access";
import { mayShareVoice, projectVoiceRoster } from "@/lib/voice/location-policy";
import { enforceVoiceScope, watchVoiceScope } from "@/lib/voice/location-runtime";
import { mayHear } from "@/lib/voice/apply";

export function roster(room: VoiceRoom | null, viewerId?: string) {
  if (!room) return [];
  const access = voiceAccess(room.campaignId);
  // Call sites without an authenticated viewer must never expose a private roster.
  if (!viewerId) return access.scope === "global" ? core.roster(room) : [];
  return projectVoiceRoster(access, viewerId, core.roster(room));
}
export async function joinRoom(campaignId: string, userId: string, username: string) {
  const result = await core.joinRoom(campaignId, userId, username);
  const room = getRoom(campaignId);
  if (room) { watchVoiceScope(room); enforceVoiceScope(room); }
  return result;
}

const consuming = new WeakMap<VoicePeer, Promise<core.ConsumerParams[]>>();
export function consumeOthers(campaignId: string, peer: VoicePeer, rtpCapabilities: RtpCapabilities): Promise<core.ConsumerParams[]> {
  // Serialize calls but do not return another request's consumer descriptions:
  // they must be installed by exactly one client acknowledgement.
  const operation = (consuming.get(peer) ?? Promise.resolve([])).catch(() => []).then(async () => {
    const room = getRoom(campaignId);
    if (!room || room.peers.get(peer.userId) !== peer || !peer.recvTransport) return [];
    enforceVoiceScope(room);
    const created: core.ConsumerParams[] = [];
    for (const other of room.peers.values()) {
      if (other === peer || !other.producer || other.producer.closed) continue;
      if (!mayShareVoice(voiceAccess(campaignId), peer.userId, other.userId)) continue;
      const existing = peer.consumers.get(other.userId);
      if (existing && !existing.closed) continue;
      if (!room.router.canConsume({ producerId: other.producer.id, rtpCapabilities })) continue;
      const consumer = await peer.recvTransport.consume({ producerId: other.producer.id, rtpCapabilities, paused: true });
      // Permission may have changed during worker IPC. Never return even the
      // producer identity for a now-forbidden subscription.
      if (consumer.closed || other.producer?.id !== consumer.producerId ||
          room.peers.get(peer.userId) !== peer || room.peers.get(other.userId) !== other ||
          !mayShareVoice(voiceAccess(campaignId), peer.userId, other.userId)) {
        consumer.close(); continue;
      }
      consumer.on("producerclose", () => {
        if (peer.consumers.get(other.userId) === consumer) peer.consumers.delete(other.userId);
      });
      peer.consumers.set(other.userId, consumer);
      created.push({ id: consumer.id, producerId: consumer.producerId, producerUserId: other.userId,
        kind: consumer.kind, rtpParameters: consumer.rtpParameters });
    }
    // A move can occur while creating the last entry; filter the complete response.
    enforceVoiceScope(room);
    return created.filter(item => peer.consumers.get(item.producerUserId)?.id === item.id);
  });
  consuming.set(peer, operation);
  void operation.finally(() => { if (consuming.get(peer) === operation) consuming.delete(peer); }).catch(() => {});
  return operation;
}
export async function resumeConsumers(campaignId: string, peer: VoicePeer, consumerIds: string[]) {
  const wanted = new Set(consumerIds);
  for (const [speakerId, consumer] of peer.consumers) {
    if (!wanted.has(consumer.id) || consumer.closed) continue;
    // Remember readiness even when proximity currently pauses this speaker.
    consumer.appData.odmReady = true;
    if (!mayHear(campaignId, peer.userId, speakerId)) continue;
    try { await consumer.resume(); }
    catch (error) { if (!consumer.closed) throw error; }
    const room = getRoom(campaignId);
    if (room) enforceVoiceScope(room);
  }
}
