/** Receipt recovery must not replay an effect when only its readback failed. */
export async function attachPostWriteRead(receipt, readParams, read) {
  try {
    const fresh = omitOwnMessages(await read(readParams), receipt);
    return { ...receipt, state: fresh, readAfter: readParams, readRequired: false };
  } catch {
    return { ...receipt, readAfter: readParams, readRequired: true,
      readError: 'Post-commit state unavailable; read before another write. The receipt is already committed.' };
  }
}

// The writer already holds the text it just sent; echoing a whole narration back
// into its context doubles every scene. Keep the row, drop the prose.
export function omitOwnMessages(state, receipt) {
  const own = new Set([receipt?.result?.messageId, ...(receipt?.result?.messageIds ?? [])].filter(Boolean));
  if (!own.size || !state || typeof state !== 'object') return state;
  const stub = message => own.has(message?.id) ? { id: message.id, seq: message.seq, authorType: message.authorType, content: null, ownWrite: true } : message;
  if (Array.isArray(state.entries)) return { ...state, entries: state.entries.map(entry => entry.key === 'messages' ? { ...entry, value: stub(entry.value) } : entry) };
  if (Array.isArray(state.messages)) return { ...state, messages: state.messages.map(stub) };
  return state;
}
