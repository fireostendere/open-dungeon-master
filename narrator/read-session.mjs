import crypto from 'node:crypto';

const fail = (message, status = 409, code) => Object.assign(new Error(message), { status, code });
const seq = value => Number.isSafeInteger(value) && value >= 0;
const epochOf = state => typeof state?.timelineEpoch === 'string' ? state.timelineEpoch : null;

export function assembleReadPages(pages) {
  if (!Array.isArray(pages) || !pages.length || !pages.at(-1)?.complete) throw fail('Incomplete narrator read pages.');
  const first = pages[0];
  if (!first?.shape || typeof first.shape !== 'object' || Array.isArray(first.shape)) throw fail('Invalid narrator page shape.', 400);
  const state = {};
  for (const [key, kind] of Object.entries(first.shape)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !['array', 'value'].includes(kind)) throw fail('Invalid narrator page shape.', 400);
    state[key] = kind === 'array' ? [] : undefined;
  }
  let offset = 0, bytes = 0;
  const scalarKeys = new Set();
  for (const [index, page] of pages.entries()) {
    bytes += Buffer.byteLength(JSON.stringify(page));
    if (bytes > 4 * 1024 * 1024) throw fail('Narrator read exceeds the host memory budget.', 413);
    if (page.hash !== first.hash || page.offset !== offset || JSON.stringify(page.shape) !== JSON.stringify(first.shape) ||
        page.complete !== (index === pages.length - 1)) throw fail('Inconsistent narrator read pages.');
    if (!Array.isArray(page.entries)) throw fail('Invalid narrator page entries.', 400);
    for (const item of page.entries) {
      if (!item || !Object.hasOwn(first.shape, item.key) || ['__proto__', 'constructor', 'prototype'].includes(item.key)) throw fail('Invalid narrator page entry.', 400);
      if (first.shape[item.key] === 'array') {
        if (item.index !== state[item.key].length) throw fail('Narrator read page array gap.');
        state[item.key].push(item.value);
      } else {
        if (Object.hasOwn(item, 'index') || scalarKeys.has(item.key)) throw fail('Duplicate or indexed narrator scalar.', 400);
        scalarKeys.add(item.key); state[item.key] = item.value;
      }
    }
    offset += page.entries.length;
  }
  if (Object.entries(first.shape).some(([key, kind]) => kind === 'value' && !scalarKeys.has(key))) throw fail('Missing narrator scalar.');
  if (crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex') !== first.hash) throw fail('Narrator page integrity check failed.');
  return state;
}

export async function readNarratorSnapshot(host, params) {
  for (let attempt = 0; attempt <= host.readPageRetries; attempt++) {
    const pages = [], cursors = new Set(); let pageCursor, bytes = 0;
    try {
      for (let count = 0; count < 2048; count++) {
        const result = await host.callControl('narrator.read', { ...params, paged: true, maxBytes: host.readMaxBytes, ...(pageCursor ? { pageCursor } : {}) });
        if (!result?.format) {
          if (pages.length) throw fail('A paged read changed format.');
          if (Buffer.byteLength(JSON.stringify(result ?? null)) > 4 * 1024 * 1024) throw fail('Narrator read exceeds the host memory budget.', 413);
          return result;
        }
        if (result.format !== 'odm.read.page.v1') throw fail('Unsupported narrator read format.', 400);
        bytes += Buffer.byteLength(JSON.stringify(result));
        if (bytes > 4 * 1024 * 1024) throw fail('Narrator read exceeds the host memory budget.', 413);
        pages.push(result);
        if (result.complete) return assembleReadPages(pages);
        if (typeof result.nextPage !== 'string' || !result.nextPage || cursors.has(result.nextPage)) throw fail('Narrator byte-page cursor did not advance.', 400);
        cursors.add(result.nextPage); pageCursor = result.nextPage;
      }
      throw fail('Narrator byte-page safety limit exceeded.', 413);
    } catch (error) {
      if (error?.status === 409 && error.code !== 'timeline_changed' && attempt < host.readPageRetries) continue;
      throw error;
    }
  }
  throw fail('Narrator read retry budget exhausted.');
}

export function resetNarratorTimeline(host, epoch) {
  host.lastSeq = 0; host.lastAskSeq = 0; host.timelineEpoch = epoch;
  host.answeredAsks.clear(); host.pendingAskCommands.clear();
  host.pendingStoryCommands?.clear(); host.memory.reset(epoch);
  host.saveCheckpoint();
}

export async function connectNarrator(host) {
  if (!host.campaignId) throw new Error('Cannot connect narrator without campaignId.');
  const result = await host.callControl('narrator.connect', { campaignId: host.campaignId, paged: true, maxBytes: host.readMaxBytes, projection: 'live' });
  // connect's first byte/story page is not an acknowledgement of the unread tail.
  // The metadata read is itself fully assembled before inspecting its epoch.
  const metadata = await host.readSnapshot({ campaignId: host.campaignId, afterSeq: 0, limit: 1, projection: 'live' });
  if (!metadata || !seq(metadata.currentSeq)) throw fail('Narrator metadata has no valid current sequence.', 400);
  const epoch = epochOf(metadata);
  if ((host.timelineEpoch !== null && epoch !== null && host.timelineEpoch !== epoch) || host.lastSeq > metadata.currentSeq) {
    resetNarratorTimeline(host, epoch);
  } else host.timelineEpoch = epoch ?? host.timelineEpoch;
  await host.drainStory();
  return result;
}

export async function drainNarratorStory(host) {
  for (let page = 0; page < 1000; page++) {
    const cursor = host.lastSeq;
    const result = await host.readSnapshot({ campaignId: host.campaignId, afterSeq: cursor, limit: 50, projection: 'full',
      ...(host.timelineEpoch ? { timelineEpoch: host.timelineEpoch } : {}) });
    if (!result || !seq(result.currentSeq)) throw fail('Narrator snapshot has no valid current sequence.', 400);
    const epoch = epochOf(result);
    if (host.timelineEpoch !== null && epoch !== null && host.timelineEpoch !== epoch) throw fail('Narrator timeline changed.', 409, 'timeline_changed');
    if (result.currentSeq < cursor) throw fail('Narrator cursor is ahead of campaign state.');
    const next = result.nextCursor ?? (result.hasMore ? null : result.currentSeq);
    if (!seq(next) || next < cursor || next > result.currentSeq || (result.hasMore && next <= cursor)) throw fail('Story cursor did not advance safely.', 400);
    if ((result.messages || []).some(message => !seq(message.seq) || message.seq <= cursor || message.seq > next)) throw fail('Story message lies outside its acknowledged range.', 400);
    const before = host.memory.serializeState(), previousEpoch = host.timelineEpoch;
    try {
      host.memory.ingestReadSnapshot(result);
      host.timelineEpoch = epoch ?? host.timelineEpoch;
      host.lastSeq = next;
      host.saveCheckpoint();
    } catch (error) {
      host.memory.restoreState(before); host.timelineEpoch = previousEpoch; host.lastSeq = cursor;
      throw error;
    }
    if (!result.hasMore) return result;
  }
  throw fail('Story stream exceeded the page safety limit.', 413);
}
