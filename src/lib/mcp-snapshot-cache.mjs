import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const scopeOf = (campaignId, timelineEpoch, params) => {
  const { pageCursor: _cursor, ...query } = params;
  return hash(canonical({ campaignId, timelineEpoch, query }));
};

/** Private, bounded byte-page snapshots. Authorization and timeline validation
 * are repeated by the caller BEFORE looking up a page. Ordinary new reads are
 * never cached. Inactivity expiry/eviction requires a fresh first page.
 */
export class NarratorSnapshotCache {
  constructor({ maxBytes = 16 * 1024 * 1024, maxEntries = 32, ttlMs = 300000, now = Date.now } = {}) {
    for (const value of [maxBytes, maxEntries, ttlMs]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid snapshot cache budget.');
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.ttlMs = ttlMs; this.now = now;
    this.entries = new Map(); this.bytes = 0;
  }
  remove(key) {
    const value = this.entries.get(key);
    if (value) { this.bytes -= value.bytes; this.entries.delete(key); }
  }
  prune() {
    const now = this.now();
    for (const [key, value] of this.entries) if (value.expires <= now) this.remove(key);
  }
  remember(state, params) {
    this.prune();
    const json = JSON.stringify(state), size = Buffer.byteLength(json);
    if (size > this.maxBytes) return false;
    const campaignId = state.campaignId ?? state.campaign?.id;
    if (typeof campaignId !== 'string' || !campaignId) return false;
    const scope = scopeOf(campaignId, state.timelineEpoch, params), key = `${scope}:${hash(json)}`;
    if (this.entries.has(key)) {
      this.entries.get(key).expires = this.now() + this.ttlMs;
      return true;
    }
    while (this.entries.size >= this.maxEntries || this.bytes + size > this.maxBytes) this.remove(this.entries.keys().next().value);
    this.entries.set(key, { json, bytes: size, expires: this.now() + this.ttlMs }); this.bytes += size;
    return true;
  }
  restore(campaignId, timelineEpoch, params) {
    this.prune();
    let cursor;
    try { cursor = JSON.parse(Buffer.from(params.pageCursor, 'base64url').toString('utf8')); } catch { return null; }
    if (!/^[a-f0-9]{64}$/.test(cursor?.hash ?? '') || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) return null;
    const key = `${scopeOf(campaignId, timelineEpoch, params)}:${cursor.hash}`;
    const value = this.entries.get(key);
    if (!value) return null;
    value.expires = this.now() + this.ttlMs;
    return JSON.parse(value.json);
  }
}
export const narratorSnapshots = new NarratorSnapshotCache();
