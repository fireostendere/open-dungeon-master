export function spatialNarratorBoundary<E extends { seq: number }, M extends { seq: number }>(input: {
  afterSeq: number; currentSeq: number; limit: number; events: E[];
  spatial: { hasMore: boolean; nextCursor: number; messages: M[] } | null;
}): { nextCursor: number; hasMore: boolean; events: E[]; roomMessages: M[] };
