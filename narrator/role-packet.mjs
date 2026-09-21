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

function compactWorldArcs(arcs) {
  if (!Array.isArray(arcs)) return [];
  return arcs
    .filter(arc => arc && arc.status !== 'resolved')
    .slice(0, 3)
    .map(arc => {
      const rung = Number.isInteger(arc.rung) ? arc.rung : -1;
      const rungs = Array.isArray(arc.rungs) ? arc.rungs : [];
      return {
        id: arc.id,
        name: arc.name,
        driver: arc.driver,
        rung,
        stance: arc.stance,
        cadence: arc.cadence,
        status: arc.status,
        ...(rung >= 0 && rungs[rung] ? { current: rungs[rung] } : {}),
        ...(rung < 0 && rungs[0] ? { firstSign: rungs[0] } : {}),
        ...(rung >= 0 && rung < rungs.length - 1 && rungs[rung + 1]
          ? { next: rungs[rung + 1] }
          : {}),
        ...(Array.isArray(arc.consequences) && arc.consequences.length
          ? { consequences: arc.consequences.slice(-2) }
          : {}),
      };
    });
}

function compactStoryArc(arc) {
  if (!arc || typeof arc !== 'object' || Array.isArray(arc)) return arc;
  const beats = Array.isArray(arc.beats) ? arc.beats : [];
  const activeIndex = beats.findIndex(beat => beat?.status === 'active');
  const currentAct = activeIndex >= 0
    ? Number(beats[activeIndex]?.act ?? 1)
    : Number(arc.acts ?? 1);
  const currentBeatNumber = activeIndex >= 0 ? activeIndex + 1 : null;

  // Preserve the current detailed act and only unresolved material ahead.
  // Settled historical acts are already represented by host memory and saga
  // milestones, so repeating every old beat on each mechanical step is pure
  // context inflation.
  const compactBeats = beats
    .map((beat, index) => ({ ...beat, number: index + 1 }))
    .filter(beat =>
      Number(beat.act ?? 1) === currentAct ||
      (Number(beat.act ?? 1) > currentAct &&
        !['done', 'skipped'].includes(String(beat.status))),
    )
    .slice(0, 12);

  const saga = arc.saga && typeof arc.saga === 'object'
    ? {
        title: arc.saga.title,
        plannedActs: arc.saga.plannedActs,
        sagaIndex: arc.saga.sagaIndex,
        currentAct,
        priorSagas: Array.isArray(arc.saga.priorSagas)
          ? arc.saga.priorSagas.slice(-2)
          : [],
        sketches: Array.isArray(arc.saga.sketches)
          ? arc.saga.sketches
              .filter(sketch => Number(sketch?.act ?? 0) >= currentAct)
              .slice(0, 3)
          : [],
        ...(arc.saga.finaleBoss ? { finaleBoss: arc.saga.finaleBoss } : {}),
      }
    : null;

  const cast = Array.isArray(arc.cast)
    ? arc.cast.filter(npc => npc?.status !== 'gone').slice(0, 6)
    : [];
  const events = Array.isArray(arc.events)
    ? [...arc.events]
        .filter(event => event?.status === 'pending')
        .sort((a, b) => Number(a?.actHint ?? currentAct) - Number(b?.actHint ?? currentAct))
        .slice(0, 4)
    : [];
  const openSubArcs = Array.isArray(arc.subArcs)
    ? arc.subArcs.filter(subArc => ['active', 'pending'].includes(String(subArc?.status))).slice(0, 4)
    : [];
  const settledSubArcs = Array.isArray(arc.subArcs)
    ? arc.subArcs
        .filter(subArc => ['resolved', 'abandoned'].includes(String(subArc?.status)))
        .slice(-3)
        .map(subArc => ({
          id: subArc.id,
          name: subArc.name,
          status: subArc.status,
          ...(subArc.resolution ? { resolution: subArc.resolution } : {}),
        }))
    : [];

  return {
    version: arc.version,
    premise: arc.premise,
    stakes: arc.stakes,
    antagonist: arc.antagonist,
    currentAct,
    currentBeatNumber,
    beats: compactBeats,
    finale: arc.finale,
    saga,
    cast,
    events,
    subArcs: openSubArcs,
    ...(settledSubArcs.length ? { settledSubArcs } : {}),
    ...(Array.isArray(arc.worldArcs) && arc.worldArcs.length
      ? { worldArcs: compactWorldArcs(arc.worldArcs) }
      : {}),
  };
}

function compactNarratorEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.type === 'roll_result') {
    return { seq: event.seq, type: event.type, payload: compactPhysicalRollEvent(event.payload) };
  }
  if (event.type === 'global_turn_ready' || event.type === 'global_turn_narrator_trigger') {
    const payload = event.payload && typeof event.payload === 'object'
      ? Object.fromEntries(
          ['roundNumber', 'kind']
            .filter(key => Object.hasOwn(event.payload, key))
            .map(key => [key, event.payload[key]]),
        )
      : {};
    return { seq: event.seq, type: event.type, payload };
  }
  return { seq: event.seq, type: event.type };
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
  if (Array.isArray(packet.rollEvents) && packet.rollEvents.length) {
    result = { ...result, rollEvents: packet.rollEvents.slice(-16).map(compactNarratorEvent) };
  }
  if (packet.campaign?.gameSettings || packet.campaign?.storyArc) {
    result = {
      ...result,
      campaign: {
        ...packet.campaign,
        ...(packet.campaign?.gameSettings
          ? { gameSettings: compactGameSettings(packet.campaign.gameSettings) }
          : {}),
        ...(packet.campaign?.storyArc
          ? { storyArc: compactStoryArc(packet.campaign.storyArc) }
          : {}),
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
