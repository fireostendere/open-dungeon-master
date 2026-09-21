import { readNarratorSnapshot } from './read-session.mjs';
import { withLatencyTrace, withNewLatencyTrace } from '../mcp/latency-trace.mjs';

/** One private Ask worker, separate from story decisions. The worker has its
 * own section cache and a fixed read scope; it never advances the story cursor.
 * Pending write UUIDs remain owned by handlePendingAsk's durable checkpoint.
 */
export function startAskWorker(host, snapshot) {
  if (host.askTask || host.stopping || !host.askResponder && !host.pendingAskCommands?.size) return host.askTask;
  const epoch = host.timelineEpoch, campaignId = host.campaignId;
  const current = () => !host.stopping && host.timelineEpoch === epoch && host.campaignId === campaignId;
  const reader = { deltaReads: host.deltaReads, sectionCache: host.sectionCache, stateCache: host.stateCache,
    readPageRetries: host.readPageRetries, readMaxBytes: host.readMaxBytes,
    callControl: host.callControl.bind(host) };
  host.askError = null;
  const work = async () => {
    let cursor = 0, handled = 0;
    let page = await readNarratorSnapshot(reader, { campaignId, afterSeq: snapshot.currentSeq,
      afterAskSeq: 0, askLimit: 20, includeAsks: true, limit: 1, projection: 'live',
      ...(epoch ? { timelineEpoch: epoch } : {}) });
    for (let count = 0; count < 1000 && current(); count++) {
      if (page.timelineEpoch && epoch && page.timelineEpoch !== epoch) throw new Error('Ask timeline changed.');
      for (const ask of page.asks ?? page.askQueue?.items ?? []) {
        if (!current()) return;
        if (!ask?.id || host.answeredAsks.has(ask.id)) continue;
        if ((host.pendingAskAttempts.get(ask.id) ?? 0) >= 2) { host.askBlocked = true; continue; }
        await host.handlePendingAsk(ask);
        if (++handled >= (host.maxAsksPerTick ?? 1)) return;
      }
      if (!page.askQueue?.hasMore) return;
      const next = page.askQueue.nextCursor;
      if (!Number.isSafeInteger(next) || next <= cursor) throw new Error('Ask cursor did not advance.');
      cursor = next;
      page = await readNarratorSnapshot(reader, { campaignId, afterSeq: snapshot.currentSeq,
        afterAskSeq: cursor, askLimit: 20, includeAsks: true, limit: 1, projection: 'live', ...(epoch ? { timelineEpoch: epoch } : {}) });
    }
    if (current()) throw new Error('Ask queue page budget exceeded.');
  };
  const task = withNewLatencyTrace(() => Promise.resolve().then(work).catch(() => { if (current()) host.askError = 'ask_failed'; })
    .finally(() => { if (host.askTask === task) host.askTask = null; }));
  host.askTask = task;
  return task;
}

export async function driveNarratorCycle(host) {
  return withLatencyTrace(async () => {
    const snapshot = await host.drainStory();
    host.askBlocked = [...host.pendingAskAttempts.values()].some(attempts => attempts >= 2);
    const askTask = startAskWorker(host, snapshot);
    // Story and Ask have separate model sessions and separate write endpoints.
    // A stalled private answer must not hold the whole table's narration.
    host.madeProgress = Boolean(host.storyController && await host.storyController.tick(host, snapshot));
    if (!host.storyController && askTask) await askTask;
  });
}
export function narratorPollDelay(host) {
  return host.madeProgress && !host.lastError ? 0 : host.pollIntervalMs;
}
