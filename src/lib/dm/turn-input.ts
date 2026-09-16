/** Pure input/call bookkeeping shared by the turn loop and its regressions. */
export type InputMessage = { seq: number; authorType: string };

export function latestInputSeq(history: readonly InputMessage[]): number {
  return history.reduce((seq, message) => message.authorType === "dm" ? seq : Math.max(seq, message.seq), 0);
}

export function needsDmTurn(
  history: readonly InputMessage[],
  completedSeq: number | null,
  hasPendingWhispers: boolean,
): boolean {
  if (hasPendingWhispers) return true;
  if (!history.length) return completedSeq === null;
  // Existing databases do not have input checkpoints. Use the last DM
  // message as their migration baseline, never for newly tracked turns.
  const baseline = completedSeq ?? history.reduce(
    (seq, message) => message.authorType === "dm" ? Math.max(seq, message.seq) : seq, -1,
  );
  return latestInputSeq(history) > baseline;
}

export function normalizeTurnToolCalls<T extends { id?: string; name: string; rawArguments: string }>(
  calls: readonly T[],
  batchId: string,
  previousIds: readonly string[] = [],
): (T & { id: string })[] {
  const seen = new Set<string>(previousIds);
  return calls.map((call, index) => {
    let id = call.id || `odm_${batchId}_${index}`;
    // Providers occasionally omit or repeat IDs. Each invocation still
    // needs its own unambiguous assistant/tool pairing.
    while (seen.has(id)) id = `odm_${batchId}_${index}_${id}`;
    seen.add(id);
    return { ...call, id };
  });
}

/** Read only IDs from untrusted/legacy payloads; preserve all opaque metadata. */
export function collectTurnToolCallIds(history: readonly { tool_calls?: unknown; tool_call_id?: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const entry of history) {
    if (typeof entry.tool_call_id === "string" && entry.tool_call_id) ids.add(entry.tool_call_id);
    if (!Array.isArray(entry.tool_calls)) continue;
    for (const call of entry.tool_calls as unknown[]) {
      if (!call || typeof call !== "object" || !("id" in call)) continue;
      if (typeof call.id === "string" && call.id) ids.add(call.id);
    }
  }
  return [...ids];
}
