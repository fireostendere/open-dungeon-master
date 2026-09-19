/** Remove only rendering metadata, never mechanics, biographies, rules or
 * audience labels. No model is needed to perform this projection. */
export function compactRolePacket(role, packet) {
  const result = structuredClone(packet);
  if (role !== 'referee' || packet.task === 'answer_ask') return result;
  for (const sheet of result.state?.sheets ?? []) {
    if (sheet && typeof sheet === 'object') delete sheet.portrait;
  }
  // The current input has its own authoritative field, including its seq.
  if (result.public?.messages && result.input?.id) {
    result.public.messages = result.public.messages.filter(message =>
      message.id !== result.input.id || message.seq !== result.input.seq || message.content !== result.input.content);
  }
  // Full fields are already present in schemas; do not duplicate their summary
  // entries too. The schema's names remain available for decisions.
  // Keep the action catalogue intact: it is also the allowlist seen by the role.
  return result;
}
