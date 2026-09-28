// Narrator "doorbell" frames: wake signals for the external narrator, never
// content. A frame carries the event type, its durable seq when it has one and,
// for chat messages, the author type/kind tokens. Message text, payload bodies,
// sheets, whisper/ask content and player prose never reach this wire; the
// narrator reads real state through narrator.read after it wakes.

/** Live frames that carry no story activity for the narrator. */
export const NARRATOR_SIGNAL_NOISE = Object.freeze([
  'presence', 'voice_roster', 'voice_speaking', 'voice_audibility_changed', 'voice_mesh_signal',
  'map_ping', 'ambience_changed', 'ambience_sting',
]);
const NOISE = new Set(NARRATOR_SIGNAL_NOISE);
const MESSAGE_TYPES = new Set(['message_added', 'message_updated']);
// Types are server constants; anything else is refused rather than escaped.
const TYPE = /^[A-Za-z0-9_.:-]{1,64}$/;
// authorType/kind/reason are enum-like tokens. A free-text value is dropped.
const TOKEN = /^[A-Za-z0-9_-]{1,32}$/;
// Mirrors isOocMessage (src/lib/campaign-types.ts) and the narrator-facing
// isNarratorEvent filter: table talk is hidden from the narrator's feeds.
const OOC = /^\s*\(ooc\)/i;

const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const token = value => (typeof value === 'string' && TOKEN.test(value) ? value : undefined);
const validSeq = value => Number.isSafeInteger(value) && value >= 0;

/**
 * Reduce one event to its signal object, or null when the frame is dropped.
 * `seq` is the durable cursor (SSE id); ephemeral frames have none.
 */
export function narratorSignal(type, payload, seq) {
  if (typeof type !== 'string' || !TYPE.test(type) || NOISE.has(type)) return null;
  // Table talk: persisted OOC chat and its live ephemeral twin.
  if (type === 'ooc_message') return null;
  const message = MESSAGE_TYPES.has(type) ? record(record(payload)?.message) : null;
  if (message && typeof message.content === 'string' && OOC.test(message.content)) return null;
  const signal = { type };
  if (validSeq(seq)) signal.seq = seq;
  if (message) {
    const authorType = token(message.authorType), kind = token(message.kind);
    if (authorType !== undefined) signal.authorType = authorType;
    if (kind !== undefined) signal.kind = kind;
  }
  if (type === 'campaign_rewound') {
    const reason = token(record(payload)?.reason);
    if (reason !== undefined) signal.reason = reason;
  }
  return signal;
}

/** Serialize a signal. The SSE id is kept only for durable (seq) frames. */
export function narratorSignalFrame(signal) {
  return `${signal.seq === undefined ? '' : `id: ${signal.seq}\n`}event: ${signal.type}\ndata: ${JSON.stringify(signal)}\n\n`;
}

/**
 * Drop-in for sseChunk(type, payload, id): replayed events, the replay
 * checkpoint and post-replay refresh frames. Returns '' for a dropped frame.
 */
export function narratorSignalChunk(type, payload, id) {
  const signal = narratorSignal(type, payload, id);
  return signal ? narratorSignalFrame(signal) : '';
}

/** Parse one frame produced by sseChunk. Unknown or malformed frames yield null. */
export function parseSseFrame(chunk) {
  if (typeof chunk !== 'string') return null;
  let id, type, data;
  for (const line of chunk.split('\n')) {
    if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('event: ')) type = line.slice(7);
    else if (line.startsWith('data: ')) data = line.slice(6);
  }
  if (type === undefined) return null;
  let payload = null;
  if (data !== undefined) { try { payload = JSON.parse(data); } catch { payload = null; } }
  const seq = id !== undefined && /^\d{1,16}$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : undefined;
  return { type, payload, seq, malformedId: id !== undefined && seq === undefined };
}

/**
 * projectLive for the narrator stream: comment pings pass through unchanged,
 * every other live frame is reduced to its signal (null drops it).
 */
export function reduceNarratorLiveChunk(chunk) {
  if (typeof chunk !== 'string') return null;
  if (chunk.startsWith(':')) return chunk;
  const frame = parseSseFrame(chunk);
  if (!frame || frame.malformedId) return null;
  return narratorSignalChunk(frame.type, frame.payload, frame.seq) || null;
}

/**
 * Stream cursor: a non-blank Last-Event-ID overrides afterSeq; absent means 0.
 * Returns null for anything that is not a non-negative safe integer.
 */
export function parseNarratorCursor(lastEventId, afterSeq) {
  const raw = typeof lastEventId === 'string' && lastEventId.trim() ? lastEventId.trim() : (afterSeq ?? '0');
  if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
