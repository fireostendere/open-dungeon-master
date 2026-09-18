// Bound both ordered ledgers before advancing their shared campaign cursor.
// A busy room cannot be skipped just because it has no public SSE events.
export function spatialNarratorBoundary({ afterSeq, currentSeq, limit, events, spatial }) {
  const eventEnd = events.length > limit ? events[limit - 1].seq : currentSeq;
  const roomEnd = spatial?.hasMore ? spatial.nextCursor : currentSeq;
  const nextCursor = Math.max(afterSeq, Math.min(eventEnd, roomEnd));
  return { nextCursor, hasMore: nextCursor < currentSeq,
    events: events.slice(0, limit).filter(event => event.seq <= nextCursor),
    roomMessages: (spatial?.messages ?? []).filter(message => message.seq <= nextCursor) };
}
