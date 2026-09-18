/** Browser-side intent ownership. Authentication remains server-side; the
 * expected-actor header only prevents a stale tab using a new login's cookies.
 * A lost response retains the exact UUID and payload, never a reconstructed move.
 */
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const fingerprint = value => JSON.stringify(canonical(value));
export class LocationCommandClient {
  constructor({ campaignId, userId, fetchImpl = globalThis.fetch, uuid = () => crypto.randomUUID() }) {
    this.identity = `${campaignId}:${userId}`;
    this.userId = userId;
    this.endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/location-chat`;
    this.fetchImpl = fetchImpl;
    this.uuid = uuid;
    this.pending = null;
    this.busy = false;
    this.closed = false;
    this.abort = new AbortController();
  }
  dispose() { this.closed = true; this.abort.abort(); this.pending = null; }
  async command(input) {
    if (this.closed) throw new Error('Location identity changed. This command cannot be retried here.');
    if (this.busy) throw new Error('A location command is already in progress.');
    const key = fingerprint(input);
    if (this.pending && this.pending.key !== key) throw new Error('Retry the unconfirmed command before submitting another one.');
    // Serialize ONCE. Caller mutation of input cannot change a pending intent.
    const attempt = this.pending ?? { key, input: JSON.parse(JSON.stringify(input)), requestId: this.uuid() };
    this.pending = attempt;
    this.busy = true;
    try {
      const response = await this.fetchImpl(this.endpoint, { method: 'POST', signal: this.abort.signal,
        headers: { 'Content-Type': 'application/json', 'X-ODM-Actor': this.userId },
        body: JSON.stringify({ ...attempt.input, requestId: attempt.requestId }) });
      const data = await response.json();
      if (this.closed) throw new Error('Location identity changed.');
      if (!response.ok) {
        // Timeouts and rate limiting retain the UUID too. Repeating a rejected
        // command with its original UUID is harmless; repeating a committed one
        // with a fresh UUID is not.
        if (response.status >= 400 && response.status < 500 && ![408, 429, 499].includes(response.status)) this.pending = null;
        throw new Error(data.error || 'Location command failed.');
      }
      this.pending = null;
      return data;
    } finally { this.busy = false; }
  }
  retry() {
    if (this.closed || !this.pending) return Promise.reject(new Error('No pending command for this location identity.'));
    return this.command(this.pending.input);
  }
}
