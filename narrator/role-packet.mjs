/**
 * Serializer-only projection: unchanged nested values can be shared because
 * callers synchronously JSON.stringify the returned packet. This is not a
 * general deep-immutable copy contract.
 */
export function compactRolePacket(role, packet) {
  const input = packet.input;
  const isCurrentInput = message => message && typeof input?.id === 'string' && input.id &&
    Number.isSafeInteger(input.seq) && input.seq >= 0 &&
    ['id', 'seq', 'authorType', 'userId', 'characterId', 'content'].every(key =>
      message[key] === input[key]);
  const withoutCurrentInput = messages => {
    if (!Array.isArray(messages)) return messages;
    const compact = messages.filter(message => !isCurrentInput(message));
    return compact.length === messages.length ? messages : compact;
  };

  if (packet.task === 'answer_ask') return packet;
  if (role === 'writer') {
    const messages = withoutCurrentInput(packet.messages);
    return messages === packet.messages ? packet : { ...packet, messages };
  }
  if (role !== 'referee') return packet;

  let result = packet;
  const sheets = packet.state?.sheets;
  if (Array.isArray(sheets)) {
    let changed = false;
    const compactSheets = sheets.map(sheet => {
      if (!sheet || typeof sheet !== 'object' || !Object.hasOwn(sheet, 'portrait')) return sheet;
      changed = true;
      const { portrait: _portrait, ...compact } = sheet;
      return compact;
    });
    if (changed) result = { ...result, state: { ...packet.state, sheets: compactSheets } };
  }

  const publicState = packet.public;
  if (publicState && typeof publicState === 'object') {
    const messages = withoutCurrentInput(publicState.messages);
    const removeScene = Object.hasOwn(publicState, 'scene') && publicState.scene === packet.campaign?.scene;
    if (messages !== publicState.messages || removeScene) {
      const compactPublic = { ...publicState, ...(messages !== publicState.messages ? { messages } : {}) };
      if (removeScene) delete compactPublic.scene;
      result = { ...result, public: compactPublic };
    }
  }
  return result;
}
