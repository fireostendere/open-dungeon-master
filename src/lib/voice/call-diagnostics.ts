// Deliberately returns numbers only: never expose ICE addresses or SDP in copied diagnostics.
export type AudioStat = { id: string; type: string; timestamp?: number; kind?: string; mediaType?: string;
  state?: string; nominated?: boolean; selected?: boolean; currentRoundTripTime?: number;
  jitter?: number; packetsLost?: number; packetsReceived?: number; bytesReceived?: number };
export type CallDiagnostics = { rttMs: number | null; jitterMs: number | null; lossPercent: number | null; receiveKbps: number | null };
export const EMPTY_DIAGNOSTICS: CallDiagnostics = { rttMs: null, jitterMs: null, lossPercent: null, receiveKbps: null };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function summarizeAudioStats(current: readonly AudioStat[], previous: readonly AudioStat[] = []): CallDiagnostics {
  const before = new Map(previous.map(row => [row.id, row]));
  const rtts: number[] = [], jitters: number[] = [];
  let lost = 0, received = 0, kbps = 0, hasRate = false;
  for (const row of current) {
    if (row.type === "candidate-pair" && row.state === "succeeded" && (row.nominated || row.selected) && finite(row.currentRoundTripTime) && row.currentRoundTripTime >= 0) rtts.push(row.currentRoundTripTime * 1000);
    if (row.type !== "inbound-rtp" || (row.kind ?? row.mediaType) !== "audio") continue;
    if (finite(row.jitter) && row.jitter >= 0) jitters.push(row.jitter * 1000);
    const old = before.get(row.id);
    if (!old || !finite(row.timestamp) || !finite(old.timestamp) || row.timestamp <= old.timestamp) continue;
    if (finite(row.packetsReceived) && finite(old.packetsReceived) && row.packetsReceived >= old.packetsReceived) {
      received += row.packetsReceived - old.packetsReceived;
      if (finite(row.packetsLost) && finite(old.packetsLost)) lost += Math.max(0, row.packetsLost - old.packetsLost);
    }
    if (finite(row.bytesReceived) && finite(old.bytesReceived) && row.bytesReceived >= old.bytesReceived) {
      kbps += (row.bytesReceived - old.bytesReceived) * 8 / (row.timestamp - old.timestamp);
      hasRate = true;
    }
  }
  return {
    rttMs: rtts.length ? Math.max(...rtts) : null,
    jitterMs: jitters.length ? Math.max(...jitters) : null,
    lossPercent: lost + received > 0 ? 100 * lost / (lost + received) : null,
    receiveKbps: hasRate ? kbps : null,
  };
}
