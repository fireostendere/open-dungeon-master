import { createHash } from "node:crypto";

export const ORCHESTRATION_SECTIONS = Object.freeze([
  "party", "combat", "location", "recent", "memory", "npcs",
]);

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = value => Array.isArray(value) ? value : [];
const clip = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const number = value => Number.isFinite(value) ? Number(value) : undefined;
const boolean = value => typeof value === "boolean" ? value : undefined;

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function compactFloor(value) {
  const floor = object(value);
  if (!floor.mode) return { mode: "open" };
  const base = withoutUndefined({
    mode: clip(floor.mode, 20),
    encounterId: clip(floor.encounterId, 80),
    currentName: clip(floor.currentName, 80),
    round: number(floor.round),
    prompt: clip(floor.prompt, 240),
  });
  if (Array.isArray(floor.userIds)) base.userIds = floor.userIds.slice(0, 12).map(String);
  if (Array.isArray(floor.respondedUserIds)) base.respondedUserIds = floor.respondedUserIds.slice(0, 12).map(String);
  const combat = object(floor.combat);
  if (Object.keys(combat).length) {
    base.combat = withoutUndefined({
      encounterId: clip(combat.encounterId, 80),
      characterId: clip(combat.characterId, 80),
      round: number(combat.round),
      turnIndex: number(combat.turnIndex),
      requiresEndTurn: boolean(combat.requiresEndTurn),
      mechanicsResolved: boolean(combat.mechanicsResolved),
    });
  }
  return base;
}

function compactSettings(value) {
  const settings = object(value);
  return withoutUndefined({
    language: clip(settings.language, 16),
    unitSystem: settings.unitSystem === "imperial" ? "imperial" : "metric",
    combatMode: settings.combatMode === "jrpg" ? "jrpg" : "classical",
    dmMode: clip(settings.dmMode, 16),
    friendlyFire: Boolean(settings.friendlyFire),
    relationships: clip(settings.relationships, 16),
    globalTurn: Boolean(object(settings.globalTurn).enabled),
  });
}

function compactGlobalTurn(value) {
  const turn = object(value);
  return withoutUndefined({
    roundNumber: number(turn.roundNumber),
    phase: clip(turn.phase, 24),
    startedAt: clip(turn.startedAt, 50),
    firstActionAt: clip(turn.firstActionAt, 50),
    deadlineAt: clip(turn.deadlineAt, 50),
    quorumReachedAt: clip(turn.quorumReachedAt, 50),
  });
}

function compactClock(value) {
  const clock = object(value);
  return withoutUndefined({
    day: number(clock.day),
    hour: number(clock.hour),
    minute: number(clock.minute),
    date: clip(clock.date, 80),
    time: clip(clock.time, 40),
    label: clip(clock.label, 100),
  });
}

function compactCampaign(value) {
  const campaign = object(value);
  return withoutUndefined({
    id: clip(campaign.id, 80),
    title: clip(campaign.title, 120),
    description: clip(campaign.description, 320),
    status: clip(campaign.status, 20),
    outcome: campaign.outcome ? clip(campaign.outcome, 20) : undefined,
    kind: clip(campaign.kind, 20),
    theme: clip(campaign.theme, 120),
    scene: clip(campaign.scene, 700),
    questLog: array(campaign.questLog).slice(0, 8).map(item => clip(item, 220)).filter(Boolean),
    difficulty: clip(campaign.difficulty, 20),
    startingLevel: number(campaign.startingLevel),
    gameSettings: compactSettings(campaign.gameSettings),
    globalTurnState: compactGlobalTurn(campaign.globalTurnState),
    floor: compactFloor(campaign.floor),
    clock: compactClock(campaign.clock),
  });
}

function compactResources(value) {
  return Object.entries(object(value)).slice(0, 12).map(([id, raw]) => {
    const resource = object(raw);
    const max = number(resource.max);
    const used = number(resource.used);
    return withoutUndefined({ id: clip(id, 40), max, used, remaining: max !== undefined && used !== undefined ? Math.max(0, max - used) : undefined });
  });
}

function compactSlots(value) {
  return Object.entries(object(value)).slice(0, 9).map(([level, raw]) => {
    const slot = object(raw);
    const max = number(slot.max);
    const used = number(slot.used);
    return withoutUndefined({ level, max, used, remaining: max !== undefined && used !== undefined ? Math.max(0, max - used) : undefined });
  });
}

function compactSheet(value) {
  const sheet = object(value);
  const spellcasting = object(sheet.spellcasting);
  return withoutUndefined({
    id: clip(sheet.id, 80),
    userId: clip(sheet.userId, 80),
    name: clip(sheet.name, 80),
    class: clip(sheet.class, 60),
    subclass: clip(sheet.subclass, 60),
    level: number(sheet.level),
    hp: number(sheet.currentHp),
    maxHp: number(sheet.maxHp),
    tempHp: number(sheet.tempHp),
    ac: number(sheet.ac),
    conditions: array(sheet.conditions).slice(0, 10).map(item => clip(item, 40)).filter(Boolean),
    exhaustion: number(sheet.exhaustion),
    concentratingOn: clip(sheet.concentratingOn, 80),
    deathSaves: sheet.deathSaves ? withoutUndefined({
      successes: number(sheet.deathSaves.successes),
      failures: number(sheet.deathSaves.failures),
      stable: boolean(sheet.deathSaves.stable),
      dead: boolean(sheet.deathSaves.dead),
    }) : undefined,
    resources: compactResources(sheet.resources),
    spellSlots: compactSlots(spellcasting.slots),
  });
}

function compactMember(value) {
  const member = object(value);
  return withoutUndefined({
    userId: clip(member.userId, 80),
    username: clip(member.username, 80),
    role: clip(member.role, 20),
    ready: boolean(member.ready),
  });
}

function compactOrderEntry(value) {
  const entry = object(value);
  return withoutUndefined({
    kind: clip(entry.kind, 12),
    id: clip(entry.characterId || entry.enemyId || entry.npcId, 80),
    userId: clip(entry.userId, 80),
    name: clip(entry.name, 80),
    initiative: number(entry.initiative),
  });
}

function compactEnemy(value) {
  const enemy = object(value);
  return withoutUndefined({
    id: clip(enemy.id, 80),
    name: clip(enemy.displayName || enemy.name, 80),
    hp: number(enemy.currentHp),
    maxHp: number(enemy.maxHp),
    ac: number(enemy.ac),
    status: clip(enemy.status, 20),
    conditions: array(enemy.conditions).slice(0, 8).map(item => clip(item, 40)).filter(Boolean),
    concentration: clip(enemy.concentration, 80),
  });
}

function compactCombat(value) {
  const wrapper = object(value);
  const encounter = object(wrapper.encounter || wrapper);
  const order = array(encounter.order).slice(0, 20).map(compactOrderEntry);
  return withoutUndefined({
    id: clip(encounter.id, 80),
    roomId: clip(encounter.roomId, 80),
    round: number(encounter.round),
    turnIndex: number(encounter.turnIndex),
    orderReady: boolean(encounter.orderReady),
    current: order[number(encounter.turnIndex) ?? -1],
    order,
    enemies: array(wrapper.enemies).slice(0, 12).map(compactEnemy),
    summary: clip(encounter.summary, 240),
  });
}

function compactLocation(value) {
  const wrapper = object(value);
  const location = object(wrapper.location);
  const tracker = object(wrapper.sceneTracker);
  const sceneTracker = withoutUndefined({
    id: clip(tracker.id, 80),
    kind: clip(tracker.kind, 40),
    status: clip(tracker.status, 40),
    name: clip(tracker.name, 100),
    round: number(tracker.round),
    progress: number(tracker.progress),
    stakes: clip(tracker.stakes, 240),
    summary: clip(tracker.summary, 320),
  });
  return {
    current: Object.keys(location).length ? withoutUndefined({
      id: clip(location.id, 80),
      name: clip(location.name, 100),
      layout: clip(location.layoutDescription, 600),
      connections: array(location.connections).slice(0, 8).map(item => clip(item, 100)).filter(Boolean),
    }) : null,
    ...(Object.keys(sceneTracker).length ? { sceneTracker } : {}),
  };
}

function compactSpatial(value) {
  const spatial = object(value);
  if (!spatial.enabled) return { enabled: false };
  const current = object(spatial.current);
  return {
    enabled: true,
    startSeq: number(spatial.startSeq),
    current: Object.keys(current).length ? withoutUndefined({
      roomId: clip(current.roomId, 80),
      revision: number(current.revision),
    }) : null,
    rooms: array(spatial.rooms).slice(0, 16).map(raw => {
      const room = object(raw);
      return withoutUndefined({
        id: clip(room.id, 80),
        name: clip(room.name, 100),
        active: boolean(room.active),
        occupants: array(room.occupants).slice(0, 12).map(String),
      });
    }),
    exits: array(spatial.exits).slice(0, 12).map(raw => {
      const exit = object(raw);
      return withoutUndefined({ id: clip(exit.id, 80), name: clip(exit.name, 100) });
    }),
    grants: array(spatial.grants).slice(0, 12).map(raw => {
      const grant = object(raw);
      return withoutUndefined({
        userId: clip(grant.userId, 80),
        roomId: clip(grant.roomId, 80),
        mode: clip(grant.mode, 20),
        expiresAt: clip(grant.expiresAt, 50),
      });
    }),
    floor: spatial.floor ? compactFloor(spatial.floor) : null,
    stealth: spatial.stealth ? withoutUndefined({
      status: clip(spatial.stealth.status, 30),
      updatedAt: clip(spatial.stealth.updatedAt, 50),
    }) : null,
    messages: array(spatial.messages).slice(-20).map(raw => {
      const message = object(raw);
      return withoutUndefined({
        id: clip(message.id, 100),
        roomId: clip(message.roomId, 80),
        seq: number(message.seq),
        kind: clip(message.kind, 24),
        authorUserId: clip(message.authorUserId, 80),
        content: clip(message.content, 420),
        stealth: boolean(message.stealth),
        stealthStatus: clip(message.stealthStatus, 30),
        witnessUserIds: array(message.witnessUserIds).slice(0, 12).map(String),
      });
    }),
    hasMore: Boolean(spatial.hasMore),
  };
}

function compactNpc(value) {
  const npc = object(value);
  const agency = object(npc.agency);
  const goals = object(agency.goals);
  const session = object(goals.session);
  return withoutUndefined({
    id: clip(npc.id, 80),
    name: clip(npc.name, 80),
    attitude: clip(npc.attitude, 24),
    location: clip(npc.location, 100),
    trait: clip(npc.trait, 180),
    goal: clip(session.text || npc.goal, 200),
  });
}

function compactFact(value) {
  const fact = object(value);
  return withoutUndefined({
    id: clip(fact.id, 80),
    category: clip(fact.category, 40),
    subject: clip(fact.subject, 100),
    fact: clip(fact.fact, 240),
    pinned: boolean(fact.pinned),
  });
}

function compactNote(value) {
  const note = object(value);
  return withoutUndefined({
    id: clip(note.id, 80),
    title: clip(note.title, 100),
    body: clip(note.body, 240),
    pinned: boolean(note.pinned),
  });
}

function compactMessage(value) {
  const message = object(value);
  return withoutUndefined({
    seq: number(message.seq),
    authorType: clip(message.authorType, 16),
    userId: clip(message.userId, 80),
    characterId: clip(message.characterId, 80),
    content: clip(message.content, 420),
  });
}

function compactRoll(value) {
  const roll = object(value);
  return withoutUndefined({
    id: clip(roll.id, 80),
    characterId: clip(roll.characterId, 80),
    kind: clip(roll.kind, 40),
    total: number(roll.total),
    dc: number(roll.dc),
    success: typeof roll.success === "boolean" ? roll.success : undefined,
  });
}

function compactPending(value) {
  const pending = object(value);
  return withoutUndefined({
    id: clip(pending.id, 80),
    userId: clip(pending.userId, 80),
    characterId: clip(pending.characterId, 80),
    kind: clip(pending.kind, 40),
    status: clip(pending.status, 20),
    reason: clip(pending.reason, 180),
  });
}

function compactEvent(value) {
  const event = object(value);
  return withoutUndefined({ seq: number(event.seq), type: clip(event.type, 60) });
}

function compactSummary(value) {
  const summary = object(value);
  return withoutUndefined({
    text: clip(summary.summary || summary.text, 1000),
    coveredCount: number(summary.coveredCount),
  });
}

function actionFamilies(snapshot) {
  const families = ["state", "narration", "checks", "inventory", "social", "world"];
  if (array(snapshot.combat).length) families.push("combat");
  if (snapshot.spatial?.enabled) families.push("spatial");
  if (snapshot.pending?.rolls?.length) families.push("rolls");
  return families;
}

function pruneForBudget(response, maxBytes) {
  const omitted = [];
  const drop = (path, label) => {
    const keys = path.split(".");
    let parent = response;
    for (const key of keys.slice(0, -1)) parent = parent?.[key];
    const leaf = keys.at(-1);
    if (parent && Object.hasOwn(parent, leaf)) {
      delete parent[leaf];
      omitted.push(label || path);
    }
  };
  for (const [path, label] of [
    ["memory.notes", "memory.notes"],
    ["memory.facts", "memory.facts"],
    ["npcs", "npcs"],
    ["recent.events", "recent.events"],
    ["recent.rolls", "recent.rolls"],
    ["spatial.grants", "spatial.grants"],
    ["location.sceneTracker", "location.sceneTracker"],
  ]) {
    if (bytes(response) <= maxBytes) break;
    drop(path, label);
  }
  if (bytes(response) > maxBytes && response.spatial?.messages?.length > 3) {
    response.spatial.messages = response.spatial.messages.slice(-3);
    omitted.push("spatial.messages:older");
  }
  if (bytes(response) > maxBytes && response.recent?.messages?.length > 3) {
    response.recent.messages = response.recent.messages.slice(-3);
    omitted.push("recent.messages:older");
  }
  if (bytes(response) > maxBytes && Array.isArray(response.combat)) {
    response.combat = response.combat.map(entry => ({ ...entry, enemies: array(entry.enemies).slice(0, 4), order: array(entry.order).slice(0, 8) }));
    omitted.push("combat:detail");
  }
  if (bytes(response) > maxBytes && response.party?.members?.length > 8) {
    response.party.members = response.party.members.slice(0, 8);
    response.party.characters = response.party.characters.slice(0, 8);
    omitted.push("party:overflow");
  }
  if (omitted.length) response.omitted = [...new Set(omitted)];
  if (bytes(response) > maxBytes) throw new Error("Orchestration snapshot exceeds the byte budget; request fewer sections or raise maxBytes.");
  return response;
}

export function buildOrchestrationSnapshot(raw, options = {}) {
  const source = object(raw);
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : 8192;
  if (maxBytes < 4096 || maxBytes > 131072) throw new Error("maxBytes must be 4096..131072.");
  const campaign = compactCampaign(source.campaign);
  const pending = object(source.pending);
  const body = {
    format: "odm.orchestration.v1",
    campaignId: campaign.id,
    timelineEpoch: clip(source.timelineEpoch, 64),
    currentSeq: number(source.currentSeq) ?? 0,
    campaign,
    spatial: compactSpatial(source.spatial),
    pending: {
      rolls: array(pending.rolls).slice(0, 8).map(compactPending),
      whispers: Math.max(0, number(pending.whispers) ?? 0),
      asks: Boolean(pending.asks),
    },
  };
  if (source.party) {
    const party = object(source.party);
    body.party = {
      members: array(party.members).slice(0, 12).map(compactMember),
      characters: array(party.sheets).slice(0, 12).map(compactSheet),
    };
  }
  if (source.combat) body.combat = array(source.combat).slice(0, 4).map(compactCombat);
  if (source.location) body.location = compactLocation(source.location);
  if (source.recent) {
    const recent = object(source.recent);
    body.recent = {
      messages: array(recent.messages).slice(-20).map(compactMessage),
      rolls: array(recent.rolls).slice(-6).map(compactRoll),
      events: array(recent.events).slice(-20).map(compactEvent),
    };
  }
  if (source.memory) {
    const memory = object(source.memory);
    body.memory = {
      summary: compactSummary(memory.summary),
      facts: array(memory.facts).slice(0, 12).map(compactFact),
      notes: array(memory.notes).slice(0, 8).map(compactNote),
    };
  }
  if (source.npcs) body.npcs = array(source.npcs).slice(0, 12).map(compactNpc);
  body.actionFamilies = actionFamilies(body);

  const revision = digest(body);
  if (options.knownRevision === revision) {
    return {
      format: body.format,
      campaignId: body.campaignId,
      timelineEpoch: body.timelineEpoch,
      currentSeq: body.currentSeq,
      revision,
      unchanged: true,
    };
  }
  return pruneForBudget({ ...body, revision, unchanged: false }, maxBytes);
}
