/** Adapt the verified wire envelope to legacy narrator scheduling fields.
 * Keep the nested encounter and enemies for role packets. Never mutate the
 * wire object: state-delta revisions/checksums belong to the original shape.
 */
export function normalizeEncounterSnapshot(snapshot) {
  const envelope = snapshot?.encounter;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      !Object.hasOwn(envelope, 'encounter')) return snapshot;
  const encounter = envelope.encounter;
  if (encounter == null) return { ...snapshot, encounter: null };
  if (typeof encounter !== 'object' || Array.isArray(encounter)) {
    throw new Error('Invalid narrator encounter envelope.');
  }
  return {
    ...snapshot,
    encounter: {
      ...envelope,
      orderReady: encounter.orderReady === true,
      status: encounter.status,
      kind: encounter.kind,
    },
  };
}
