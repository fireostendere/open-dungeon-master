/** A fixed-watermark replay followed by live SSE, with bounded live buffering.
 * This is the players' web stream, not an MCP transport. Database reads stay
 * synchronous; a new page is fetched only when the consumer asks for it.
 */
type ReplayEvent = { seq: number; type: string; payload: unknown };
type StreamOptions = {
  afterSeq: number;
  signal: AbortSignal;
  latestSeq: () => number;
  listEventsSince: (afterSeq: number, limit: number) => ReplayEvent[];
  subscribe: (send: (chunk: string) => void) => () => void;
  sseChunk: (type: string, payload: unknown, id?: number) => string;
  heartbeatMs?: number;
  maximumBufferedBytes?: number;
};

const REFRESH_EVENTS = ["ask_activity", "whisper_activity", "facts_updated", "side_activity", "battle_map_updated", "relationships_updated"];
const PAGE_SIZE = 500;

export function createCampaignStream(options: StreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const maximum = options.maximumBufferedBytes ?? 2 * 1024 * 1024;
  let closed = false;
  let replaying = true;
  let cursor = options.afterSeq;
  let watermark = 0;
  let bufferedBytes = 0;
  const live: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;

  function cleanup(error?: unknown) {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    options.signal.removeEventListener("abort", abort);
    unsubscribe();
    live.length = 0;
    wake?.();
    wake = undefined;
    try { if (error) controller.error(error); else controller.close(); } catch { /* cancelled reader */ }
  }
  function abort() { cleanup(); }
  function receive(chunk: string) {
    if (closed) return;
    // Presence and private notifications have no id. Persisted events already
    // covered by the watermark must not move EventSource's cursor backwards.
    const match = /^id: (\d+)\n/.exec(chunk);
    if (match && Number(match[1]) <= watermark && !chunk.includes("\nevent: campaign_rewound\n")) return;
    const encoded = encoder.encode(chunk);
    if (bufferedBytes + encoded.byteLength > maximum) {
      // Disconnect instead of dropping events: reconnect replays from the last
      // id actually delivered to the browser and refreshes private views again.
      cleanup(new Error("Campaign stream consumer fell behind; reconnect to replay."));
      return;
    }
    live.push(encoded);
    bufferedBytes += encoded.byteLength;
    wake?.();
    wake = undefined;
  }
  function finishReplay() {
    replaying = false;
    // Sequence allocations without an event are legal. Advance the transport
    // cursor over that tail without inventing a game event in the database.
    controller.enqueue(encoder.encode(options.sseChunk("stream_checkpoint", {}, watermark)));
    // Existing clients already handle these contentless, authenticated refresh
    // nudges. They are sent on EVERY connection, including EventSource retries.
    for (const type of REFRESH_EVENTS) controller.enqueue(encoder.encode(options.sseChunk(type, {})));
  }

  return new ReadableStream<Uint8Array>({
    start(target) {
      controller = target;
      if (options.signal.aborted) { cleanup(); return; }
      watermark = options.latestSeq();
      // Subscribe before the first page. Writes arriving between later pulls
      // are buffered while replay stops at this fixed watermark.
      unsubscribe = options.subscribe(receive);
      if (closed) { unsubscribe(); return; }
      if (options.signal.aborted) { cleanup(); return; }
      options.signal.addEventListener("abort", abort, { once: true });
      heartbeat = setInterval(() => receive(": ping\n\n"), options.heartbeatMs ?? 20_000);
      if (cursor > watermark) {
        // A restored/rewound database is behind the browser. Existing clients
        // handle this control by fetching a fresh authorized snapshot.
        controller.enqueue(encoder.encode(options.sseChunk("campaign_rewound", { reason: "cursor_ahead" }, watermark)));
        finishReplay();
      }
    },
    async pull() {
      try {
        if (closed) return;
        if (replaying) {
          const page = options.listEventsSince(cursor, PAGE_SIZE).filter((event) => event.seq <= watermark);
          for (const event of page) {
            if (!Number.isSafeInteger(event.seq) || event.seq <= cursor) throw new Error("Invalid campaign replay order.");
            controller.enqueue(encoder.encode(options.sseChunk(event.type, event.payload, event.seq)));
            cursor = event.seq;
          }
          if (page.length < PAGE_SIZE || cursor >= watermark) finishReplay();
          return;
        }
        while (!closed && !live.length) await new Promise<void>((resolve) => { wake = resolve; });
        if (closed) return;
        const chunk = live.shift()!;
        bufferedBytes -= chunk.byteLength;
        controller.enqueue(chunk);
      } catch (error) { cleanup(error); }
    },
    cancel() { cleanup(); },
  });
}
