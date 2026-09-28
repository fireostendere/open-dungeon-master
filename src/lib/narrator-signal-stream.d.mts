export type NarratorSignal = {
  type: string;
  seq?: number;
  authorType?: string;
  kind?: string;
  reason?: string;
};
export const NARRATOR_SIGNAL_NOISE: readonly string[];
export function narratorSignal(type: string, payload: unknown, seq?: number): NarratorSignal | null;
export function narratorSignalFrame(signal: NarratorSignal): string;
export function narratorSignalChunk(type: string, payload: unknown, id?: number): string;
export function parseSseFrame(chunk: string): { type: string; payload: unknown; seq?: number; malformedId: boolean } | null;
export function reduceNarratorLiveChunk(chunk: string): string | null;
export function parseNarratorCursor(lastEventId: string | null | undefined, afterSeq: string | null | undefined): number | null;
