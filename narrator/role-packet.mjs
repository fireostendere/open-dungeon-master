const MODEL_GAME_SETTING_KEYS = Object.freeze([
  'language', 'unitSystem', 'combatMode',
  'genre', 'customGenreText', 'worldPack',
  'dicePolicy', 'dmDifficulty', 'multiclassingEnabled',
  'worldSimulation', 'holdSubmissions', 'globalTurn',
  'companions', 'maxCompanions', 'maxGuests',
  'relationships', 'romance', 'inventoryApprovals', 'variantRules',
]);

function compactGameSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  return Object.fromEntries(
    MODEL_GAME_SETTING_KEYS
      .filter(key => Object.hasOwn(settings, key))
      .map(key => [key, settings[key]]),
  );
}

function compactRoll(roll) {
  if (!roll || typeof roll !== 'object') return roll;
  return Object.fromEntries(
    ['id', 'characterId', 'kind', 'expression', 'total', 'dc', 'success', 'visibility']
      .filter(key => Object.hasOwn(roll, key))
      .map(key => [key, roll[key]]),
  );
}

function compactPhysicalRollEvent(event) {
  if (!event || typeof event !== 'object') return event;
  return {
    ...(event.pendingRollId ? { pendingRollId: event.pendingRollId } : {}),
    ...(event.roll ? { roll: compactRoll(event.roll) } : {}),
  };
}

function compactOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object') return outcome;
  if (Array.isArray(outcome.physicalRolls)) {
    return { physicalRolls: outcome.physicalRolls.map(compactPhysicalRollEvent) };
  }
  const { commandId: _commandId, committedSeq: _committedSeq, ...semantic } = outcome;
  return semantic;
}

function compactActorPacket(packet) {
  const publicMessages = Array.isArray(packet.public?.messages)
    ? packet.public.messages.slice(-8)
    : packet.public?.messages;
  const publicIds = new Set(
    (publicMessages ?? []).flatMap(message => [
      typeof message?.id === 'string' ? `id:${message.id}` : null,
      Number.isSafeInteger(message?.seq) ? `seq:${message.seq}` : null,
    ]).filter(Boolean),
  );
  const privateMessages = Array.isArray(packet.context?.recentMessages)
    ? packet.context.recentMessages
        .filter(message => !publicIds.has(`id:${message?.id}`) && !publicIds.has(`seq:${message?.seq}`))
        .slice(-8)
    : [];
  const context = packet.context && typeof packet.context === 'object'
    ? {
        summary: packet.context.summary ?? '',
        ...(privateMessages.length ? { recentMessages: privateMessages } : {}),
        ...(Array.isArray(packet.context.recentRolls) && packet.context.recentRolls.length
          ? { recentRolls: packet.context.recentRolls.slice(-4).map(compactRoll) }
          : {}),
        ...(Array.isArray(packet.context.milestones) && packet.context.milestones.length
          ? { milestones: packet.context.milestones.slice(-6) }
          : {}),
        ...(packet.context.activeEncounter ? { activeEncounter: packet.context.activeEncounter } : {}),
      }
    : packet.context;
  return {
    ...packet,
    ...(packet.public ? { public: { ...packet.public, messages: publicMessages } } : {}),
    ...(packet.campaign?.gameSettings
      ? { campaign: { ...packet.campaign, gameSettings: compactGameSettings(packet.campaign.gameSettings) } }
      : {}),
    context,
  };
}

/**
 * Serializer-only projection: unchanged nested values can be shared because
 * callers synchronously JSON.stringify the returned packet. This is not a
 * general deep-immutable copy contract.
 */
export function compactRolePacket(role, packet) {
  const input = packet.input;
  const roundSeqs = new Set(
    input?.kind === 'global_round' && Array.isArray(input.messages)
      ? input.messages.map(message => message?.seq).filter(Number.isSafeInteger)
      : [],
  );
  const isCurrentInput = message => {
    if (message && roundSeqs.has(message.seq)) return true;
    return message && typeof input?.id === 'string' && input.id &&
      Number.isSafeInteger(input.seq) && input.seq >= 0 &&
      ['id', 'seq', 'authorType', 'userId', 'characterId', 'content'].every(key =>
        message[key] === input[key]);
  };
  const withoutCurrentInput = messages => {
    if (!Array.isArray(messages)) return messages;
    const compact = messages.filter(message => !isCurrentInput(message));
    return compact.length === messages.length ? messages : compact;
  };

  if (packet.task === 'answer_ask') return packet;
  if (role === 'actor') return compactActorPacket(packet);
  if (role === 'writer') {
    const messages = withoutCurrentInput(packet.messages);
    return messages === packet.messages ? packet : { ...packet, messages };
  }
  if (role !== 'referee') return packet;

  let result = packet;
  if (Array.isArray(packet.outcomes) && packet.outcomes.length) {
    result = { ...result, outcomes: packet.outcomes.map(compactOutcome) };
  }
  if (packet.campaign?.gameSettings) {
    result = {
      ...result,
      campaign: {
        ...packet.campaign,
        gameSettings: compactGameSettings(packet.campaign.gameSettings),
      },
    };
  }
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
