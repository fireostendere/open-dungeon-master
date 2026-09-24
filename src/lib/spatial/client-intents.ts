/** In-memory only. A pending draft is never moved to a different identity. */
export type IntentStatus = { identity: string; pending: boolean; busy: boolean; error: string };
type PendingIntent = { requestId: string; fingerprint: string; input: Record<string, unknown>; body: string };
type SessionOptions = {
  campaignId: string; userId: string;
  fetcher?: typeof fetch;
  uuid?: () => string;
  onSuccess?: () => void;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

export class LocationIntentSession {
  readonly identity: string;
  readonly endpoint: string;
  readonly userId: string;
  private fetcher: typeof fetch;
  private uuid: () => string;
  private onSuccess?: () => void;
  private controller = new AbortController();
  private generation = 0;
  private enabled = false;
  private pendingIntent: PendingIntent | null = null;
  private busy = false;
  private error = "";
  private listeners = new Set<(status: IntentStatus) => void>();

  constructor(options: SessionOptions) {
    this.identity = JSON.stringify([options.campaignId, options.userId]);
    this.endpoint = `/api/campaigns/${encodeURIComponent(options.campaignId)}/location-chat`;
    this.userId = options.userId;
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.onSuccess = options.onSuccess;
  }
  get active(): boolean { return this.enabled && !this.controller.signal.aborted; }
  snapshot(): IntentStatus { return { identity: this.identity, pending: Boolean(this.pendingIntent), busy: this.busy, error: this.error }; }
  subscribe(listener: (status: IntentStatus) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  private emit() { const state = this.snapshot(); for (const listener of this.listeners) listener(state); }
  activate(): void {
    this.controller.abort(); this.controller = new AbortController(); this.generation++;
    this.enabled = true; this.pendingIntent = null; this.busy = false; this.error = ""; this.emit();
  }
  dispose(reason = ""): void {
    this.enabled = false; this.generation++; this.controller.abort();
    this.pendingIntent = null; this.busy = false; this.error = reason; this.emit();
  }
  async send(input: Record<string, unknown>): Promise<boolean> {
    if (!this.active || this.busy) return false;
    let frozen: Record<string, unknown>, fingerprint: string;
    try {
      frozen = JSON.parse(JSON.stringify(input)); fingerprint = JSON.stringify(canonical(frozen));
    } catch { this.error = "Invalid location command."; this.emit(); return false; }
    if (this.pendingIntent && this.pendingIntent.fingerprint !== fingerprint) {
      this.error = "Retry the unconfirmed command before submitting another one."; this.emit(); return false;
    }
    if (!this.pendingIntent) {
      const requestId = this.uuid();
      this.pendingIntent = { requestId, fingerprint, input: frozen, body: JSON.stringify({ ...frozen, requestId }) };
    }
    const attempt = this.pendingIntent, generation = this.generation;
    const current = () => this.active && this.generation === generation && this.pendingIntent === attempt;
    this.busy = true; this.error = ""; this.emit();
    try {
      const response = await this.fetcher(this.endpoint, { method: "POST", signal: this.controller.signal,
        headers: { "Content-Type": "application/json", "X-ODM-Expected-User": this.userId }, body: attempt.body });
      const data = await response.json();
      if (!current()) return false;
      if (data?.code === "identity_changed") { this.dispose("Your account changed. Reload before sending another command."); return false; }
      if (!response.ok) {
        // Timeouts/rate limits and 5xx may be ambiguous; keep the exact bytes.
        if (response.status < 500 && ![408, 425, 429].includes(response.status)) this.pendingIntent = null;
        throw new Error(typeof data?.error === "string" ? data.error : "Location command failed.");
      }
      this.pendingIntent = null;
      this.onSuccess?.();
      return true;
    } catch (cause) {
      if (this.active && this.generation === generation) {
        this.error = cause instanceof Error ? cause.message : "Location command failed.";
      }
      return false;
    } finally {
      if (this.active && this.generation === generation) { this.busy = false; this.emit(); }
    }
  }
  retry(): Promise<boolean> {
    return this.active && this.pendingIntent ? this.send(this.pendingIntent.input) : Promise.resolve(false);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Pure, deterministic encoding: retries do not read a new room or revision. */
export function encodeWebMcpLocationIntent(input: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(input).some(key => !["intentId", "roomId", "expectedRevision", "kind", "content", "stealth"].includes(key))) throw new Error("Unknown message argument.");
  const { intentId, roomId, expectedRevision, kind, content, stealth } = input;
  if (typeof intentId !== "string" || !uuidPattern.test(intentId)) throw new Error("Provide one UUID intentId and reuse it unchanged on retry.");
  if (!["do", "ooc"].includes(String(kind)) || typeof content !== "string" || !content.trim() || content.length > 2000) throw new Error("Invalid location message.");
  if (kind === "ooc") {
    if (roomId !== null || expectedRevision !== null) throw new Error("OOC requires null roomId and expectedRevision.");
    return { operation: "send", requestId: intentId, roomId: null, kind, content };
  }
  if (typeof roomId !== "string" || !uuidPattern.test(roomId) || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) {
    throw new Error("Read the current location first, then provide its roomId and revision.");
  }
  return { operation: "send", requestId: intentId, roomId, kind, content, expectedRevision, ...(stealth !== undefined ? { stealth: Boolean(stealth) } : {}) };
}
