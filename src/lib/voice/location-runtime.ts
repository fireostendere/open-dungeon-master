import { subscribeSpatialChanges } from "@/lib/spatial/updates.mjs";
import { voiceAccess } from "@/lib/voice/location-access";
import { revokeOutOfScope } from "@/lib/voice/location-policy";
import type { VoiceRoom } from "@/lib/voice/room";

const subscriptions = new WeakSet<VoiceRoom>();
export function enforceVoiceScope(room: VoiceRoom) {
  const access = voiceAccess(room.campaignId);
  revokeOutOfScope(access, room.peers);
  return access;
}

export function watchVoiceScope(room: VoiceRoom): void {
  if (subscriptions.has(room)) return;
  subscriptions.add(room);
  const revoke = () => {
    try { enforceVoiceScope(room); }
    catch (error) {
      // A broken authorization read must not leave a formerly allowed call
      // forwarding. Closing is synchronous and a later join can retry.
      for (const peer of room.peers.values()) {
        for (const consumer of peer.consumers.values()) consumer.close();
        peer.consumers.clear();
      }
      console.error("[voice] scope refresh failed", error instanceof Error ? error.name : "UnknownError");
    }
  };
  const unsubscribe = subscribeSpatialChanges(room.campaignId, revoke);
  // Covers membership removal and restores that bypass spatial commands.
  // Movement uses the synchronous after-commit notification, not this timer.
  const timer = setInterval(revoke, 1000);
  timer.unref();
  room.router.observer.on("close", () => { unsubscribe(); clearInterval(timer); subscriptions.delete(room); });
  revoke();
}
