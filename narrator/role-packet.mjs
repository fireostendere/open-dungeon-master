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

function compactFacts(facts) {
  if (!Array.isArray(facts)) return facts;
  const selected = [];
  const seen = new Set();
  const perCategory = new Map();
  let budget = 2000;

  const add = fact => {
    if (!fact || typeof fact !== 'object') return;
    const category = String(fact.category ?? '');
    const semanticChars = String(fact.subject ?? '').length + String(fact.fact ?? '').length + 8;
    if (!fact.pinned) {
      const used = perCategory.get(category) ?? 0;
      if (used >= 6 || semanticChars > budget) return;
      perCategory.set(category, used + 1);
      budget -= semanticChars;
    }
    const key = String(fact.id ?? `${category}:${fact.subject}:${fact.fact}`);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push({
      ...(fact.id ? { id: fact.id } : {}),
      category: fact.category,
      subject: fact.subject,
      fact: fact.fact,
      knownBy: fact.knownBy,
      pinned: Boolean(fact.pinned),
      ...(Array.isArray(fact.witnessedBy) && fact.witnessedBy.length
        ? { witnessedBy: fact.witnessedBy.slice(0, 12) }
        : {}),
    });
  };

  for (const fact of facts) if (fact?.pinned) add(fact);
  for (const fact of facts) if (!fact?.pinned) add(fact);
  return selected;
}

function compactNotes(notes) {
  if (!Array.isArray(notes)) return notes;
  const selected = [];
  let budget = 6000;
  const ordered = [
    ...notes.filter(note => note?.pinned).slice(0, 8),
    ...notes.filter(note => !note?.pinned),
  ];
  for (const note of ordered) {
    if (selected.length >= 12 || budget <= 80 || !note || typeof note !== 'object') break;
    const title = String(note.title ?? '').slice(0, 120);
    const overhead = title.length + 32;
    const bodyBudget = Math.max(0, Math.min(1200, budget - overhead));
    if (bodyBudget < 80 && !note.pinned) continue;
    const body = String(note.body ?? '').slice(0, bodyBudget);
    selected.push({
      id: note.id,
      title,
      body,
      pinned: Boolean(note.pinned),
      visibility: note.visibility,
      status: note.status,
    });
    budget -= overhead + body.length;
  }
  return selected;
}

function compactNpcs(npcs) {
  if (!Array.isArray(npcs)) return npcs;
  return npcs.slice(0, 24).map(npc => {
    if (!npc || typeof npc !== 'object') return npc;
    return {
      name: npc.name,
      attitude: npc.attitude,
      trait: npc.trait,
      location: npc.location,
      agency: npc.agency,
      ...(Array.isArray(npc.aliases) && npc.aliases.length ? { aliases: npc.aliases.slice(0, 6) } : {}),
      ...(npc.witnessNote ? { witnessNote: npc.witnessNote } : {}),
    };
  });
}

function compactEquipment(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map(item => {
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      ['name', 'qty', 'slug', 'equipped', 'attuned', 'identified', 'gear']
        .filter(key => Object.hasOwn(item, key))
        .map(key => [key, item[key]]),
    );
  });
}

function compactFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.slice(0, 60).map(feature => {
    if (!feature || typeof feature !== 'object') return feature;
    return Object.fromEntries(
      ['name', 'source', 'level', 'classId']
        .filter(key => Object.hasOwn(feature, key))
        .map(key => [key, feature[key]]),
    );
  });
}

function compactRefereeSheet(sheet, rich) {
  if (!sheet || typeof sheet !== 'object') return sheet;
  const status = {
    id: sheet.id,
    userId: sheet.userId,
    name: sheet.name,
    race: sheet.race,
    class: sheet.class,
    subclass: sheet.subclass,
    classes: sheet.classes,
    level: sheet.level,
    currentHp: sheet.currentHp,
    maxHp: sheet.maxHp,
    tempHp: sheet.tempHp,
    ac: sheet.ac,
    speed: sheet.speed,
    conditions: sheet.conditions,
    conditionMeta: sheet.conditionMeta,
    exhaustion: sheet.exhaustion,
    deathSaves: sheet.deathSaves,
    concentratingOn: sheet.concentratingOn,
    resources: sheet.resources,
    isCompanion: sheet.isCompanion,
    companionKind: sheet.companionKind,
    ...(sheet.isCompanion && sheet.personality
      ? { personality: String(sheet.personality).slice(0, 600) }
      : {}),
  };
  if (!rich) return status;
  return {
    ...status,
    background: sheet.background,
    alignment: sheet.alignment,
    gender: sheet.gender,
    xp: sheet.xp,
    abilities: sheet.abilities,
    hitDice: sheet.hitDice,
    hitDicePools: sheet.hitDicePools,
    proficiencies: sheet.proficiencies,
    equipment: compactEquipment(sheet.equipment),
    gold: sheet.gold,
    copper: sheet.copper,
    feats: Array.isArray(sheet.feats) ? sheet.feats.slice(0, 30) : sheet.feats,
    features: compactFeatures(sheet.features),
    spellcasting: sheet.spellcasting,
    wildShape: sheet.wildShape,
    pets: Array.isArray(sheet.pets) ? sheet.pets.slice(0, 3) : sheet.pets,
    ...(sheet.backstory ? { backstory: String(sheet.backstory).slice(0, 1200) } : {}),
  };
}

function focusedCharacterIds(packet) {
  const ids = new Set();
  const input = packet.input;
  if (typeof input?.characterId === 'string' && input.characterId) ids.add(input.characterId);
  if (Array.isArray(input?.messages)) {
    for (const message of input.messages) {
      if (typeof message?.characterId === 'string' && message.characterId) ids.add(message.characterId);
    }
  }
  const encounter = packet.state?.encounter?.encounter ?? packet.state?.encounter;
  if (typeof encounter?.currentActorId === 'string' && encounter.currentActorId) ids.add(encounter.currentActorId);
  for (const pending of Array.isArray(packet.state?.pendingRolls) ? packet.state.pendingRolls : []) {
    if (typeof pending?.characterId === 'string' && pending.characterId) ids.add(pending.characterId);
  }
  return ids;
}

function spatialFocusRoomIds(packet) {
  const ids = new Set();
  const input = packet.input;
  if (typeof input?.roomId === 'string' && input.roomId) ids.add(input.roomId);
  if (Array.isArray(input?.roomIds)) {
    for (const roomId of input.roomIds) if (typeof roomId === 'string' && roomId) ids.add(roomId);
  }
  if (Array.isArray(input?.messages)) {
    for (const message of input.messages) {
      if (typeof message?.roomId === 'string' && message.roomId) ids.add(message.roomId);
    }
  }
  return ids;
}

function compactSpatialState(packet) {
  const focus = spatialFocusRoomIds(packet);
  const rooms = Array.isArray(packet.state?.spatialRooms)
    ? packet.state.spatialRooms.map(room => ({
        id: room.id,
        name: room.name,
        ...(room.active ? { active: true } : {}),
        ...(focus.has(room.id) && Array.isArray(room.occupants) && room.occupants.length
          ? { occupants: room.occupants }
          : {}),
      }))
    : packet.state?.spatialRooms;
  const grants = Array.isArray(packet.state?.spatialGrants)
    ? packet.state.spatialGrants.map(grant => ({
        id: grant.id,
        userId: grant.userId,
        roomId: grant.roomId,
        mode: grant.mode,
      }))
    : packet.state?.spatialGrants;
  return { rooms, grants };
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
  if (packet.campaign?.gameSettings || packet.campaign?.storyArc || packet.campaign?.dmOutline) {
    const campaign = {
      ...packet.campaign,
      ...(packet.campaign?.gameSettings
        ? { gameSettings: compactGameSettings(packet.campaign.gameSettings) }
        : {}),
      ...(packet.campaign?.storyArc
        ? { storyArc: compactStoryArc(packet.campaign.storyArc) }
        : {}),
    };
    if (packet.campaign?.storyArc) delete campaign.dmOutline;
    else if (typeof campaign.dmOutline === 'string') campaign.dmOutline = campaign.dmOutline.slice(0, 4000);
    result = { ...result, campaign };
  }
  const sheets = packet.state?.sheets;
  if (Array.isArray(sheets)) {
    const focus = focusedCharacterIds(packet);
    const allRich =
      packet.input?.kind === 'global_turn_trigger' ||
      packet.input?.kind === 'global_round' && focus.size >= sheets.length;
    const compactSheets = sheets.map(sheet =>
      compactRefereeSheet(sheet, allRich || focus.has(sheet?.id)),
    );
    result = { ...result, state: { ...result.state, sheets: compactSheets } };
  }
  if (Array.isArray(packet.state?.facts)) {
    result = { ...result, state: { ...result.state, facts: compactFacts(packet.state.facts) } };
  }
  if (Array.isArray(packet.state?.notes)) {
    result = { ...result, state: { ...result.state, notes: compactNotes(packet.state.notes) } };
  }
  if (Array.isArray(packet.state?.npcs)) {
    result = { ...result, state: { ...result.state, npcs: compactNpcs(packet.state.npcs) } };
  }
  if (Array.isArray(packet.state?.spatialRooms) || Array.isArray(packet.state?.spatialGrants)) {
    const spatial = compactSpatialState(packet);
    result = {
      ...result,
      state: {
        ...result.state,
        ...(spatial.rooms === undefined ? {} : { spatialRooms: spatial.rooms }),
        ...(spatial.grants === undefined ? {} : { spatialGrants: spatial.grants }),
      },
    };
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
