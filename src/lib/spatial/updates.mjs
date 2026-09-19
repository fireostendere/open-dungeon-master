// Process-local wakeups only. No room IDs, message IDs, authors or content are
// exposed to clients. Durable state and authorization remain in the store.
const key = Symbol.for('odm.spatial.update.listeners');
const listeners = globalThis[key] ??= new Map();
export function subscribeSpatialChanges(campaignId, listener) {
  let group = listeners.get(campaignId);
  if (!group) { group = new Set(); listeners.set(campaignId, group); }
  group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(campaignId); };
}
export function notifySpatialChange(campaignId) {
  for (const listener of [...(listeners.get(campaignId) ?? [])]) listener();
}

/** Only a changed, freshly authorized projection may complete a long poll.
 * A hidden event just wakes the internal recheck; even its existence/timing is
 * not returned. Periodic rechecks cover other processes and grant expirations.
 * Subscribe before loading to close the snapshot/notification race.
 */
export async function waitForPrivateUpdate({ load, subscribe, signal, waitMs = 0, recheckMs = 2000 }) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 20000) throw new Error('Invalid long-poll deadline.');
  if (!Number.isSafeInteger(recheckMs) || recheckMs < 1) throw new Error('Invalid recheck interval.');
  const deadline = performance.now() + waitMs;
  let revision = 0, wake = null;
  const notify = () => { revision++; wake?.(); };
  const unsubscribe = subscribe(notify);
  signal?.addEventListener('abort', notify);
  try {
    for (;;) {
      signal?.throwIfAborted();
      const observed = revision;
      const response = await load();
      signal?.throwIfAborted();
      const remaining = deadline - performance.now();
      if (response.status !== 304 || remaining <= 0 || waitMs === 0) return response;
      if (revision !== observed) continue;
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); wake = null; resolve(); };
        const timer = setTimeout(finish, Math.min(recheckMs, remaining));
        wake = finish;
        if (revision !== observed || signal?.aborted) finish();
      });
    }
  } finally { unsubscribe(); signal?.removeEventListener('abort', notify); wake?.(); }
}
