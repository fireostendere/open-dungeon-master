import { publishEphemeral } from "@/lib/events";

// Whether the external narrator's host is listening, per campaign. The signal
// is the narrator doorbell (GET /api/internal/mcp/events): while at least one
// such stream is open the host is up and will pick up player turns. Players
// see it as the header lamp; the transition is published as the global
// ephemeral `narrator_presence` and served in the campaign snapshot.
//
// Going offline is debounced: a doorbell that reconnects within the grace
// window (network blip, sidecar restart, plugin reload) cancels the pending
// transition and nothing is published for the flap.
//
// Known limitation: a graceful stop or a crashed host closes its socket and is
// noticed at once. A client that vanishes without closing it (network loss,
// laptop lid) is only noticed when a write to the dead socket fails, i.e. on a
// later heartbeat once TCP gives up, so the lamp can stay green that long.
//
// Lives on globalThis so dev-mode HMR cannot fork the counts, like status.ts.

export type NarratorPresence = { online: boolean; since: number | null };

export type NarratorPresenceClock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type Entry = { streams: number; online: boolean; since: number | null; offlineAt: number | null; offlineTimer: unknown };

export const NARRATOR_OFFLINE_GRACE_MS = 5_000;

declare global {
  var __odmNarratorPresence: Map<string, Entry> | undefined;
  var __odmNarratorPresenceClock: (NarratorPresenceClock & { graceMs: number }) | undefined;
}

function entries() {
  return (globalThis.__odmNarratorPresence ??= new Map<string, Entry>());
}

const systemClock = (): NarratorPresenceClock & { graceMs: number } => ({
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A pending debounce must not hold a shutting-down process open.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  graceMs: NARRATOR_OFFLINE_GRACE_MS,
});

function clock() {
  return (globalThis.__odmNarratorPresenceClock ??= systemClock());
}

/** Test hook: replace the clock/timers and grace window; no argument restores the defaults. */
export function configureNarratorPresence(options?: Partial<NarratorPresenceClock> & { graceMs?: number }) {
  globalThis.__odmNarratorPresenceClock = { ...systemClock(), ...options };
}

function publish(campaignId: string, entry: Entry) {
  // A notification failure must never break the stream that triggered it.
  try {
    publishEphemeral(campaignId, "narrator_presence", { online: entry.online, since: entry.since }, { kind: "global" });
  } catch (error) {
    console.error("[narrator-presence] publish failed", error);
  }
}

function goOffline(campaignId: string) {
  const entry = entries().get(campaignId);
  if (!entry) return;
  entry.offlineTimer = null;
  if (entry.streams > 0 || !entry.online) return;
  entry.online = false;
  // The host left when its last stream closed, not when the grace ran out.
  entry.since = entry.offlineAt ?? clock().now();
  entry.offlineAt = null;
  publish(campaignId, entry);
}

/**
 * Count one open doorbell stream. Returns its release function, which is
 * idempotent: every close path of the stream may call it, it counts once.
 */
export function acquireNarratorPresence(campaignId: string): () => void {
  const map = entries();
  let entry = map.get(campaignId);
  if (!entry) {
    entry = { streams: 0, online: false, since: null, offlineAt: null, offlineTimer: null };
    map.set(campaignId, entry);
  }
  entry.streams += 1;
  if (entry.offlineTimer !== null) {
    // Reconnected inside the grace window: still the same online stretch.
    clock().clearTimeout(entry.offlineTimer);
    entry.offlineTimer = null;
    entry.offlineAt = null;
  }
  if (!entry.online) {
    entry.online = true;
    entry.since = clock().now();
    publish(campaignId, entry);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = map.get(campaignId);
    if (!current || current.streams <= 0) return;
    current.streams -= 1;
    if (current.streams > 0 || !current.online || current.offlineTimer !== null) return;
    const { now, setTimeout: schedule, graceMs } = clock();
    current.offlineAt = now();
    current.offlineTimer = schedule(() => goOffline(campaignId), graceMs);
  };
}

export function getNarratorPresence(campaignId: string): NarratorPresence {
  const entry = entries().get(campaignId);
  return entry ? { online: entry.online, since: entry.since } : { online: false, since: null };
}
