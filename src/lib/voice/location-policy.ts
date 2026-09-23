// Pure authorization and synchronous revocation; no client-supplied room IDs.
export type VoiceScope = "global" | "location";
export type VoiceAccess = {
  scope: VoiceScope;
  members: ReadonlySet<string>;
  rooms: ReadonlyMap<string, string | null>;
};

export function mayShareVoice(access: VoiceAccess, a: string, b: string): boolean {
  if (!access.members.has(a) || !access.members.has(b)) return false;
  if (a === b || access.scope === "global") return true;
  const room = access.rooms.get(a);
  return typeof room === "string" && room.length > 0 && room === access.rooms.get(b);
}

export function voiceChannel(access: VoiceAccess, userId: string): string {
  if (access.scope === "global") return "table";
  const room = access.rooms.get(userId);
  return room ? `location:${room}` : `isolated:${userId}`;
}

export function projectVoiceRoster<T extends { userId: string; channelId: string }>(
  access: VoiceAccess, viewerId: string, peers: readonly T[],
): T[] {
  return peers.filter(peer => mayShareVoice(access, viewerId, peer.userId))
    .map(peer => ({ ...peer, channelId: voiceChannel(access, peer.userId) }));
}

type Closable = { closed?: boolean; close(): void };
export type ScopedPeer = {
  userId: string;
  channelId: string;
  consumers: Map<string, Closable>;
  sendTransport?: Closable | null;
  recvTransport?: Closable | null;
};

// Close, rather than client-mute, forbidden RTP subscriptions. This function
// has NO await: all revocations are queued before any new subscription opens.
export function revokeOutOfScope<P extends ScopedPeer>(access: VoiceAccess, peers: Map<string, P>): boolean {
  let changed = false;
  for (const [id, peer] of peers) {
    if (!access.members.has(id)) {
      peer.sendTransport?.close();
      peer.recvTransport?.close();
      for (const consumer of peer.consumers.values()) consumer.close();
      peer.consumers.clear();
      peers.delete(id);
      changed = true;
      continue;
    }
    const channelId = voiceChannel(access, id);
    if (peer.channelId !== channelId) { peer.channelId = channelId; changed = true; }
    for (const [speakerId, consumer] of peer.consumers) {
      if (!mayShareVoice(access, id, speakerId)) {
        if (!consumer.closed) consumer.close();
        peer.consumers.delete(speakerId);
        changed = true;
      }
    }
  }
  return changed;
}
