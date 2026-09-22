import {
  NARRATOR_STATE_DELTA_FORMAT,
  NARRATOR_STATE_PATCH_FORMAT,
  createNarratorStatePatch,
  extractNarratorState,
  narratorStateRevision,
  narratorStateScope,
} from '../../shared/narrator-state-delta.mjs';

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

export class NarratorStateDeltaCache {
  constructor({ maxEntries = 128, maxBytes = 24 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.bytes = 0;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  remove(revision) {
    const entry = this.entries.get(revision);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(revision); }
  }
  remember(scope, state) {
    const revision = narratorStateRevision(scope, state);
    const existing = this.entries.get(revision);
    if (existing) {
      this.entries.delete(revision);
      this.entries.set(revision, existing);
      return revision;
    }
    const stored = structuredClone(state), size = bytes(stored);
    if (size > this.maxBytes) return revision;
    while (this.entries.size >= this.maxEntries || this.bytes + size > this.maxBytes) this.remove(this.entries.keys().next().value);
    this.entries.set(revision, { scope, state: stored, bytes: size });
    this.bytes += size;
    return revision;
  }
  restore(scope, revision) {
    const entry = this.entries.get(revision);
    if (!entry || entry.scope !== scope) return null;
    this.entries.delete(revision);
    this.entries.set(revision, entry);
    return structuredClone(entry.state);
  }
}

export const narratorStateDeltaCache = new NarratorStateDeltaCache();

export function projectNarratorStateDelta(state, {
  campaignId,
  timelineEpoch,
  principal,
  projection = 'live',
  knownStateRevision,
  cache = narratorStateDeltaCache,
}) {
  const scope = narratorStateScope({ campaignId, timelineEpoch, principal, projection });
  const current = extractNarratorState(state);
  const base = knownStateRevision ? cache.restore(scope, knownStateRevision) : null;
  const revision = cache.remember(scope, current);
  const response = { ...state };
  delete response.sectionVersions;
  delete response.omittedSections;
  delete response.deltaState;

  if (!knownStateRevision || !base) {
    response.stateDelta = {
      format: NARRATOR_STATE_DELTA_FORMAT,
      revision,
      checksum: revision,
      full: true,
      resyncRequired: Boolean(knownStateRevision),
      ...(knownStateRevision ? { baseRevision: knownStateRevision } : {}),
    };
    return response;
  }

  const patch = createNarratorStatePatch(base, current);
  for (const key of Object.keys(current)) delete response[key];
  delete response.sectionVersions;
  delete response.omittedSections;
  response.stateDelta = {
    format: NARRATOR_STATE_DELTA_FORMAT,
    baseRevision: knownStateRevision,
    revision,
    checksum: revision,
    full: false,
    resyncRequired: false,
    patch,
  };
  return response;
}

export function unchangedNarratorStateDelta({
  campaignId,
  timelineEpoch,
  principal,
  projection = 'live',
  knownStateRevision,
  cache = narratorStateDeltaCache,
}) {
  if (typeof knownStateRevision !== 'string' || !knownStateRevision) return null;
  const scope = narratorStateScope({ campaignId, timelineEpoch, principal, projection });
  const base = cache.restore(scope, knownStateRevision);
  if (!base) return null;
  if (narratorStateRevision(scope, base) !== knownStateRevision) return null;
  return {
    stateDelta: {
      format: NARRATOR_STATE_DELTA_FORMAT,
      baseRevision: knownStateRevision,
      revision: knownStateRevision,
      checksum: knownStateRevision,
      full: false,
      resyncRequired: false,
      patch: { format: NARRATOR_STATE_PATCH_FORMAT },
    },
  };
}
