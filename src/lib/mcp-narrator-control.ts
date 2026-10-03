import { SPATIAL_NARRATOR_CATALOG, SPATIAL_NARRATOR_OPERATIONS, SPATIAL_GUIDANCE, readSpatialForNarrator, invokeSpatialForNarrator } from "@/lib/spatial/narrator";
import { spatialNarratorBoundary } from "@/lib/spatial/narrator-page.mjs";
import { runSpatialCommand, spatialEnabled, spatialContext, SpatialError } from "@/lib/spatial/service";
import { bindActiveBattleMapToRoom, scopeBattleMapInvocation } from "@/lib/spatial/battle-map";
import { campaignTimelineEpoch } from "@/lib/spatial/timeline";
import { getDatabase } from "@/lib/db/core";
import { touchNarratorLease, NarratorLeaseConflict } from "@/lib/db/narrator-lease";
import { unrelatedRoomChat } from "@/lib/spatial/narrator-concurrency.mjs";
import { attachPostWriteRead } from "@/lib/mcp-post-write.mjs";
import { readNarratorSections } from "@/lib/mcp-read-sections.mjs";
import { projectNarratorStateDelta, unchangedNarratorStateDelta } from "@/lib/mcp-state-delta-cache.mjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";
import { globalTurnSubmitted, isOocMessage } from "@/lib/campaign-types";
import { isNarratorEvent } from "@/lib/mcp-event-filter";
import { allocateSeq, canAct, getCampaignById, getCampaignSummaryState, getFloor, getGlobalTurnState, latestSeq, listMembers, setFloor } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { getDirectorArm, takeDirectorArm } from "@/lib/db/director-arms";
import { buildDirectorBlock } from "@/lib/dm/director-logic";
import { getDmTurn, listOpenPendingRolls } from "@/lib/db/dm-turns";
import { listRecentWhispersForPrompt, listPendingPlayerWhispers } from "@/lib/db/dm-whispers";
import { getActiveEncounter, listActiveEncounters, listEnemies } from "@/lib/db/encounters";
import { listActiveFacts } from "@/lib/db/facts";
import { getCurrentLocation } from "@/lib/db/locations";
import { getOverworldPartyPositions } from "@/lib/db/overworld";
import { deleteCampaignMessage, getCampaignMessage, insertCampaignMessage, listMessagesBefore, listMessagesInSeqRange, listRecentMessages, setMessageVariants, updateMessageContent } from "@/lib/db/messages";
import { MAX_EDITED_LENGTH, checkEdit, replaceSelectedTake } from "@/lib/dm/message-edit-logic";
import { resolveVariantIndex, seedVariants } from "@/lib/dm/renarrate-logic";
import { listPublicCampaignNotes } from "@/lib/db/notes";
import { listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { projectSheetsForViewer } from "@/lib/sheet-privacy";
import { getSceneTracker } from "@/lib/db/scene-tracker";
import { consoleAdjudications } from "@/lib/dm/invoke-catalog";
import { invokeEngineSynchronous } from "@/lib/dm/invoke";
import { handleRequestPlayerInput } from "@/lib/dm/basic-adjudications";
import { persistHumanNarration } from "@/lib/dm/human-narration";
import { closeCampaign } from "@/lib/dm/campaign-ending";
import { assertPlayerFacingArgs, assertPlayerFacingText, NarrationGuardError } from "@/lib/dm/narration-guard";
import { combatHandoffState, passCombatTurn } from "@/lib/dm/human-turn-lifecycle";
import { setDmStatus } from "@/lib/dm/status";
import { executeNarratorCommand, NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";
import { completeGlobalTurn, recordGlobalTurnAction, sealGlobalTurnNow, startGlobalTurn } from "@/lib/dm/global-turn-logic";
import { listNarratorReceipts } from "@/lib/db/narrator-commands";
import { coverInEffect } from "@/lib/dm/delegation";
import { npcRosterForPrompt } from "@/lib/dm/social-tools";
import { answerAsk, listPendingAsksForCampaign, pendingAsksForCampaign, AskQueueConflict } from "@/lib/db/asks";
import { narratorSnapshots } from "@/lib/mcp-snapshot-cache.mjs";
import { budgetRead, ReadBudgetError } from "@/lib/mcp-read-budget.mjs";
import { listEventsSince, publishEphemeral, publishPersisted, publishUserEphemeral, publishWithSeq } from "@/lib/events";
import { storeNarrationAudio } from "@/lib/narration-audio";
import { buildOrchestrationSnapshot } from "../../shared/orchestration-snapshot.mjs";
export { NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";
const id = z.string().uuid();
const sectionDigest = z.string().regex(/^[a-f0-9]{64}$/);
const readSchema = z.object({
  campaignId: id, afterSeq: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50),
  afterAskSeq: z.number().int().min(0).default(0), askLimit: z.number().int().min(1).max(50).default(20),
  includeAsks: z.boolean().default(true),
  paged: z.boolean().default(false), pageCursor: z.string().max(500).optional(),
  maxBytes: z.number().int().min(4096).max(131072).default(65536), projection: z.enum(["full", "live"]).default("full"),
  delta: z.boolean().default(false), knownSeq: z.number().int().min(0).optional(),
  stateDelta: z.boolean().default(false), knownStateRevision: sectionDigest.optional(),
  knownSections: z.object({ sheets: sectionDigest.optional(), facts: sectionDigest.optional(), notes: sectionDigest.optional(), npcs: sectionDigest.optional(),
    recentMessages: sectionDigest.optional(), recentRolls: sectionDigest.optional(), chapters: sectionDigest.optional() }).strict().optional(),
}).strict();
const orchestrationSnapshotSchema = z.object({
  campaignId: id,
  sections: z.array(z.enum(["party", "combat", "location", "recent", "memory", "npcs"])).max(6)
    .default(["party", "combat", "location", "recent", "memory", "npcs"]),
  recentLimit: z.number().int().min(1).max(20).default(8),
  maxBytes: z.number().int().min(4096).max(131072).default(8192),
  knownRevision: sectionDigest.optional(),
}).strict();
const writeBase = z.object({ campaignId: id, expectedSeq: z.number().int().min(0), commandId: id.optional() }).strict();
export const EXTERNAL_NARRATOR_ACTIONS = new Set([
  ...Object.keys(SPATIAL_NARRATOR_OPERATIONS),
  "start_encounter", "add_enemies", "pc_attack", "enemy_attack", "damage_enemy", "cast_at_enemy", "cast_at_player", "cast_buff", "aoe_damage", "split_damage", "set_enemy_condition", "clear_enemy_condition", "enemy_flees", "take_action", "use_reaction", "apply_hazard", "end_turn", "end_encounter", "move_token",
  "apply_damage", "heal", "stabilize", "award_xp", "party_stash", "party_award", "modify_gold", "grant_item", "reveal_item", "remove_item", "use_item", "purchase", "use_resource", "set_condition", "set_effect", "clear_effect", "clear_condition", "use_spell_slot", "learn_spell", "update_sheet", "take_rest",
  "combat_turn", "move_party", "update_location", "travel", "pass_time", "start_scene", "scene_check", "end_scene", "request_roll", "request_player_input", "send_whisper", "record_event", "complete_beat", "update_story", "write_campaign_note", "set_ambience", "play_sting",
  "set_npc", "npc_reaction", "social_check", "relationship_beat", "romance_advance", "relationship_end", "summon_pet", "pet_attack", "damage_pet", "dismiss_pet",
  "add_companion", "dismiss_companion", "mount_up", "dismount", "roll_treasure", "damage_object", "group_check", "check_notice",
]);
function campaignOrHuman(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) throw new McpNarratorControlError("Campaign not found.", 404);
  if (campaign.gameSettings.dmMode !== "human" || !campaign.dmUserId || coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover)) throw new McpNarratorControlError("External narration requires a human-DM campaign with a DM seat.", 409);
  return campaign;
}
function safeCampaign(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
  return {
    id: campaign.id, title: campaign.title, description: campaign.description, status: campaign.status,
    outcome: campaign.outcome, ending: campaign.ending, theme: campaign.theme, scene: campaign.scene, questLog: campaign.questLog,
    difficulty: campaign.difficulty, startingLevel: campaign.startingLevel, dmMode: campaign.gameSettings.dmMode, dmUserId: campaign.dmUserId, leadUserId: campaign.leadUserId,
    gameSettings: campaign.gameSettings, globalTurnState: campaign.globalTurnState,
    dmOutline: campaign.dmOutline, storyArc: campaign.storyArc,
    floor: campaign.floor, clock: campaign.clock, party: campaign.party,
    turnLock: narratorTurnLock(campaign),
  };
}
// The combat hold, spelled out for the narrator: players are locked and the
// next actor gets the floor only on the narrator's explicit handoff.
function narratorTurnLock(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
  const floor = campaign.floor;
  if (floor.mode === "hold" && floor.team) {
    // A team round (src/lib/dm/team-round.ts): the fighter waits for the
    // heroes elsewhere, not for the narrator's handoff.
    const round = getGlobalTurnState(campaign.id);
    const name = floor.next.mode === "initiative" ? floor.next.currentName : "The next hero";
    return {
      state: "awaiting_team",
      globalRound: floor.team.round,
      note: `${name} already had a turn this team round and acts again when global round ${floor.team.round} is done. ` +
        (round.phase === "ready" || round.phase === "resolving"
          ? `That round is sealed: resolve its batch and narrate with completeGlobalRound:${round.roundNumber}; that opens ${name}'s turn.`
          : "The heroes outside the fight are still taking their turns in it; when it seals (global_turn_ready) resolve the batch and narrate with completeGlobalRound.") +
        " Do not end_turn or pass this turn.",
    };
  }
  const handoff = combatHandoffState(campaign.id, floor);
  if (handoff.state === "none") return null;
  return handoff.state === "ready"
    ? { state: "awaiting_pass", characterId: handoff.characterId,
      note: "Turn resolved, initiative not moved yet; players are locked. Finish the narration and send the last message with passTurn:true (or call release_floor)." }
    : { state: "resolving", characterId: handoff.characterId, pendingRolls: handoff.pendingRolls,
      note: "A player's combat turn is submitted and waits for you: resolve it (engine actions, then end_turn), narrate, and hand it over with passTurn:true." };
}
type CatalogOptions = { summaryOnly?: boolean; category?: string; action?: string };
function catalog(options: CatalogOptions = {}) {
  let groups = [...consoleAdjudications(), { category: "world" as const, label: "Location chats", entries: SPATIAL_NARRATOR_CATALOG }].map(group => ({
    ...group, entries: group.entries.filter(entry => EXTERNAL_NARRATOR_ACTIONS.has(entry.name)).map(entry => {
      if (entry.name === "send_whisper") return { ...entry, fields: [...entry.fields, { name: "replyToWhisperIds", label: "Incoming whisper IDs", kind: "text" as const,
        help: "Exact IDs from playerWhispers. Reply and acknowledge only these messages, never later arrivals." }] };
      if (entry.name === "start_encounter") return { ...entry, fields: entry.fields.map(field => field.name === "roomId" ? {
        ...field, required: false,
        help: "Required after location_enable. Exact room UUID that owns this encounter; it reaches the combat engine unchanged.",
      } : field) };
      return entry;
    }),
  })).filter(group => group.entries.length);
  if (options.category) {
    const target = options.category.toLowerCase().trim();
    groups = groups.filter(group => group.category?.toLowerCase() === target || group.label?.toLowerCase().includes(target));
  }
  if (options.action) groups = groups.map(group => ({ ...group, entries: group.entries.filter(entry => entry.name === options.action!.trim()) })).filter(group => group.entries.length);
  if (options.summaryOnly) return groups.map(group => ({ category: group.category, label: group.label, actions: group.entries.map(entry => ({ name: entry.name, label: entry.label })) }));
  return groups;
}
// A resolved roll as the narrator uses it; ids, audit fields and dice terms stay in storage.
function liveRoll(payload: unknown) {
  const roll = (payload as { roll?: Record<string, unknown> } | null)?.roll;
  if (!roll || typeof roll !== "object") return payload;
  const { id, characterId, targetEnemyId, kind, detail, expression, advantage, dc, total, success } = roll;
  const natural = (roll.breakdown as { natural?: unknown } | undefined)?.natural;
  return { roll: Object.fromEntries(Object.entries({ id, characterId, targetEnemyId, kind, detail, expression, advantage, dc, total, success, natural })
    .filter(([, value]) => value !== null && value !== undefined && value !== "none")) };
}
// The sealed round by name. Its declarations arrive over hours of separate wakes; a
// narrator resolving them from memory dropped one and gave another to the wrong hero.
function roundDeclarations(campaignId: string, readySeq: number, startedAt: unknown) {
  if (typeof startedAt !== "string") return [];
  const names = new Map(listSheets(campaignId).map(sheet => [sheet.id, sheet.name]));
  // ponytail: the last 100 messages before the seal; a round has one Do per hero.
  return listMessagesBefore(campaignId, readySeq, 100)
    .filter(msg => msg.authorType === "player" && msg.characterId && msg.createdAt >= startedAt)
    .map(msg => ({ seq: msg.seq, character: names.get(msg.characterId!) ?? null, characterId: msg.characterId, content: msg.content }));
}
function read(raw: unknown) {
  const p = readSchema.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  if (p.data.knownStateRevision && !p.data.stateDelta) throw new McpNarratorControlError("knownStateRevision requires stateDelta:true.", 400);
  const campaign = campaignOrHuman(p.data.campaignId), currentSeq = latestSeq(campaign.id);
  if (p.data.afterSeq > currentSeq || (p.data.knownSeq ?? 0) > currentSeq) throw new McpNarratorControlError("Narrator cursor is ahead of campaign state; reconnect from a fresh read.", 409);
  const timelineEpoch = campaignTimelineEpoch(campaign.id);
  const cacheParams = { ...p.data, dmUserId: campaign.dmUserId };
  if (p.data.pageCursor) {
    if (!p.data.paged) throw new McpNarratorControlError("pageCursor requires paged:true.", 400);
    if (spatialEnabled(campaign.id) && !spatialContext(campaign.id, campaign.dmUserId!).actor.isDm) throw new McpNarratorControlError("Narrator access changed.", 403);
    const snapshot = narratorSnapshots.restore(campaign.id, timelineEpoch, cacheParams);
    if (!snapshot) throw new McpNarratorControlError("Snapshot expired or changed scope; restart the read without a pageCursor.", 409);
    try { return budgetRead(snapshot, p.data); }
    catch (error) { if (error instanceof ReadBudgetError) throw new McpNarratorControlError(error.message, error.status); throw error; }
  }

  if (
    p.data.stateDelta &&
    p.data.projection === "live" &&
    p.data.afterSeq === currentSeq &&
    p.data.knownStateRevision &&
    (!p.data.includeAsks || !pendingAsksForCampaign(campaign.id).pending)
  ) {
    const unchanged = unchangedNarratorStateDelta({
      campaignId: campaign.id,
      timelineEpoch,
      principal: campaign.dmUserId!,
      projection: "live",
      knownStateRevision: p.data.knownStateRevision,
    });
    if (unchanged) {
      const state = {
        campaignId: campaign.id,
        currentSeq,
        timelineEpoch,
        cursor: currentSeq,
        nextCursor: currentSeq,
        hasMore: false,
        events: [],
        messages: [],
        commands: [],
        asks: [],
        askQueue: { nextCursor: p.data.afterAskSeq, hasMore: false, pending: false },
        ...unchanged,
      };
      try { return budgetRead(state, p.data); }
      catch (error) { if (error instanceof ReadBudgetError) throw new McpNarratorControlError(error.message, error.status); throw error; }
    }
  }

  const fetched = p.data.afterSeq === currentSeq
    ? []
    : listEventsSince(campaign.id, p.data.afterSeq, p.data.limit + 1);
  const spatial = readSpatialForNarrator(campaign.id, campaign.dmUserId!, p.data.afterSeq, p.data.limit);
  const { nextCursor, hasMore, events, roomMessages } = spatialNarratorBoundary({ afterSeq: p.data.afterSeq, currentSeq, limit: p.data.limit, events: fetched, spatial });
  const legacyMessages = nextCursor > p.data.afterSeq ? listMessagesInSeqRange(campaign.id, p.data.afterSeq + 1, nextCursor).filter(msg => !isOocMessage(msg)) : [];
  const messages = [...legacyMessages, ...roomMessages.map(message => ({
    ...message, campaignId: campaign.id, userId: message.authorUserId, characterId: null,
    authorType: message.kind === "narration" || message.kind === "perception" ? "dm" : "player", channel: "location" as const,
  }))].sort((a,b) => a.seq-b.seq);
  const askMeta = p.data.includeAsks
    ? pendingAsksForCampaign(campaign.id)
    : { pending: false };
  const askPage = p.data.includeAsks
    ? listPendingAsksForCampaign(campaign.id, p.data.afterAskSeq, p.data.askLimit)
    : { items: [], nextCursor: p.data.afterAskSeq, hasMore: false };
  const live = p.data.projection === "live";
  const delta = Boolean(p.data.delta), stateDelta = Boolean(p.data.stateDelta);
  // The live narrator reads who spoke by name (a bare characterId made it swap two
  // players' declarations) and never needs per-row constants or timestamps.
  const characterNames = live && messages.some(msg => msg.characterId) ? new Map(listSheets(campaign.id).map(sheet => [sheet.id, sheet.name])) : null;
  const liveMessages = live ? messages.map(({ campaignId: _campaign, createdAt: _created, ...msg }) =>
    msg.characterId && characterNames ? { ...msg, character: characterNames.get(msg.characterId) ?? null } : msg) : messages;
  const baselineSeq = p.data.knownSeq ?? (delta ? p.data.afterSeq : 0);
  // Cheap, transactional source revisions precede mapping and content hashing.
  // User authorization, room audiences and current mechanics are never cached.
  const { sections, sectionVersions, omittedSections } = readNarratorSections({
    db: getDatabase(), campaignId: campaign.id, timelineEpoch, principal: campaign.dmUserId,
    live, delta: delta && !stateDelta, knownSections: stateDelta ? {} : p.data.knownSections,
    loaders: {
      sheets: () => projectSheetsForViewer(listSheets(campaign.id), campaign.dmUserId, { adjudicates: true }), facts: () => listActiveFacts(campaign.id),
      notes: () => listPublicCampaignNotes(campaign.id, 20), npcs: () => npcRosterForPrompt(campaign.id, 40),
      // Host memory already keeps an audience-aware rolling summary and the
      // referee sees at most 24 public messages. Keep a 2x overlap for edits
      // and reconnect repair instead of remapping/hashing 96 rows each read.
      recentMessages: () => listRecentMessages(campaign.id, 48).filter(msg => !isOocMessage(msg)),
      recentRolls: () => listRecentRolls(campaign.id, 24), chapters: () => listChapters(campaign.id),
    },
  });
  const receipts = delta && baselineSeq >= currentSeq
    ? []
    : listNarratorReceipts(campaign.id);
  const state = {
    campaignId: campaign.id, campaign: safeCampaign(campaign), currentSeq, timelineEpoch, cursor: p.data.afterSeq, nextCursor, hasMore,
    events: events.filter(event => event.type === "message_updated" || isNarratorEvent(event)).map(event =>
      event.type === "roll_result" && live
        ? { seq: event.seq, type: event.type, payload: liveRoll(event.payload) }
        :
      event.type === "global_turn_ready"
        ? { seq: event.seq, type: event.type, payload: { ...(event.payload as object),
          declarations: roundDeclarations(campaign.id, event.seq, (event.payload as { startedAt?: unknown } | null)?.startedAt) } }
        :
      event.type === "roll_result" ||
      event.type === "global_turn_narrator_trigger" ||
      event.type === "message_deleted" ||
      event.type === "lead_response_requested" ||
      event.type === "spotlight_ready" ||
      event.type === "autopilot_action_requested"
        ? { seq: event.seq, type: event.type, payload: event.payload }
        : event.type === "message_updated"
          ? isNarratorEvent(event)
            ? { seq: event.seq, type: event.type, payload: event.payload }
            : { seq: event.seq, type: event.type, payload: { messageId: (event.payload as { message?: { id?: string } })?.message?.id, removed: true } }
        : { seq: event.seq, type: event.type },
    ),
    messages: liveMessages, spatial: spatial ? { enabled: true, instructions: SPATIAL_GUIDANCE } : { enabled: false }, spatialRooms: spatial?.rooms ?? [], spatialGrants: spatial?.grants ?? [],
    commands: delta && baselineSeq > 0 ? receipts.filter(receipt => receipt.committedSeq > baselineSeq) : receipts,
    // Legacy story_summary was produced by the retired hosted compaction path.
    // Keep it available in explicit full reads, but the live narrator uses its
    // own audience-aware rolling memory and should not query/send it every poll.
    ...(!live ? { summary: getCampaignSummaryState(campaign.id) } : {}),
    members: listMembers(campaign.id), pendingRolls: listOpenPendingRolls(campaign.id),
    directorDirective: buildDirectorBlock(getDirectorArm(campaign.id)),
    playerWhispers: listPendingPlayerWhispers(campaign.id), recentDmWhispers: live ? [] : listRecentWhispersForPrompt(campaign.id),
    omittedSections, asks: askPage.items, askQueue: { nextCursor: askPage.nextCursor, hasMore: askPage.hasMore, pending: askMeta.pending },
    ...sections, sectionVersions,
    // With location chat on, rooms are where people are; the legacy place is stale.
    location: spatial ? null : getCurrentLocation(campaign.id), partyPositions: getOverworldPartyPositions(campaign.id), sceneTracker: getSceneTracker(campaign.id),
    encounter: (() => { const encounter = getActiveEncounter(campaign.id); return encounter ? { encounter, enemies: listEnemies(encounter.id) } : null; })(),
    ...(delta ? { deltaState: { enabled: true, baselineSeq, pruned: ["sheets", "facts", "notes", "npcs"].every(key => omittedSections.includes(key)) } } : {}),
  };
  const projectedState = stateDelta ? projectNarratorStateDelta(state, {
    campaignId: campaign.id, timelineEpoch, principal: campaign.dmUserId!, projection: p.data.projection,
    knownStateRevision: p.data.knownStateRevision,
  }) : state;
  try {
    const result = budgetRead(projectedState, p.data);
    if (p.data.paged && "nextPage" in result && result.nextPage && !narratorSnapshots.remember(projectedState, cacheParams)) throw new McpNarratorControlError("Snapshot exceeds the bounded page cache; reduce the projection.", 413);
    return result;
  } catch (error) { if (error instanceof ReadBudgetError) throw new McpNarratorControlError(error.message, error.status); throw error; }
}
function orchestrationSnapshot(raw: unknown) {
  const p = orchestrationSnapshotSchema.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  const campaign = campaignOrHuman(p.data.campaignId);
  const currentSeq = latestSeq(campaign.id);
  const timelineEpoch = campaignTimelineEpoch(campaign.id);
  const sections = new Set(p.data.sections);
  const asks = listPendingAsksForCampaign(campaign.id, 0, 1);
  const pendingRolls = listOpenPendingRolls(campaign.id);
  const recentLimit = p.data.recentLimit;
  const spatial = readSpatialForNarrator(
    campaign.id,
    campaign.dmUserId!,
    Math.max(0, currentSeq - 256),
    Math.min(20, recentLimit * 2),
  );

  const rawState = {
    // Deliberately narrower than narrator.read: secret story spine fields never
    // enter the compact router projection, even transiently.
    campaign: {
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      status: campaign.status,
      theme: campaign.theme,
      scene: campaign.scene,
      questLog: campaign.questLog,
      difficulty: campaign.difficulty,
      startingLevel: campaign.startingLevel,
      gameSettings: campaign.gameSettings,
      globalTurnState: campaign.globalTurnState,
      floor: campaign.floor,
      clock: campaign.clock,
    },
    currentSeq,
    timelineEpoch,
    spatial: spatial ?? { enabled: false },
    pending: {
      rolls: pendingRolls,
      whispers: listPendingPlayerWhispers(campaign.id).length,
      asks: asks.items.length > 0 || asks.hasMore,
    },
    party: sections.has("party")
      ? { members: listMembers(campaign.id), sheets: projectSheetsForViewer(listSheets(campaign.id), campaign.dmUserId, { adjudicates: true }) }
      : undefined,
    combat: sections.has("combat")
      ? listActiveEncounters(campaign.id)
          .filter(encounter => encounter.kind === "fight")
          .map(encounter => ({ encounter, enemies: listEnemies(encounter.id) }))
      : undefined,
    location: sections.has("location")
      ? { location: spatial ? null : getCurrentLocation(campaign.id), partyPositions: getOverworldPartyPositions(campaign.id), sceneTracker: getSceneTracker(campaign.id) }
      : undefined,
    recent: sections.has("recent")
      ? {
          messages: listRecentMessages(campaign.id, Math.min(40, recentLimit * 2))
            .filter(message => !isOocMessage(message))
            .slice(-recentLimit),
          rolls: listRecentRolls(campaign.id, Math.min(6, recentLimit)),
          events: listEventsSince(campaign.id, Math.max(0, currentSeq - 64), 64)
            .filter(isNarratorEvent)
            .slice(-recentLimit),
        }
      : undefined,
    memory: sections.has("memory")
      ? {
          summary: getCampaignSummaryState(campaign.id),
          facts: listActiveFacts(campaign.id).slice(0, 12),
          notes: listPublicCampaignNotes(campaign.id, 8),
        }
      : undefined,
    npcs: sections.has("npcs") ? npcRosterForPrompt(campaign.id).slice(0, 12) : undefined,
  };

  try {
    return buildOrchestrationSnapshot(rawState, {
      sections: p.data.sections,
      maxBytes: p.data.maxBytes,
      recentLimit,
      knownRevision: p.data.knownRevision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build orchestration snapshot.";
    throw new McpNarratorControlError(message, /byte budget|maxBytes/i.test(message) ? 413 : 500);
  }
}

// Refuse player-visible text that carries protocol or operator talk before
// the write is admitted: nothing is stored and the seq does not move.
function guardPlayerText(check: () => void) {
  try { check(); }
  catch (error) { if (error instanceof NarrationGuardError) throw new McpNarratorControlError(error.message, 400); throw error; }
}
function serializedWrite(params: z.infer<typeof writeBase>, operation: string, payload: unknown,
  work: (campaign: NonNullable<ReturnType<typeof getCampaignById>>) => Record<string, unknown>,
  acceptUnrelated?: (campaign: NonNullable<ReturnType<typeof getCampaignById>>, currentSeq: number) => boolean) {
  return executeNarratorCommand({ ...params, operation, payload, work, acceptUnrelated, loadState: () => {
    const campaign = campaignOrHuman(params.campaignId);
    if (campaign.kind !== "campaign" || campaign.status !== "active") throw new McpNarratorControlError("External narrator writes require an active campaign.", 409);
    return campaign;
  } });
}
async function invoke(raw: unknown) {
  // The advertised MCP schema has a top-level characterId (for autopilot_action);
  // models copy it onto invoke. Fold it into args instead of refusing the call.
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "characterId" in raw) {
    const { characterId, ...rest } = raw as Record<string, unknown>;
    const args = rest.args && typeof rest.args === "object" && !Array.isArray(rest.args) ? rest.args as Record<string, unknown> : {};
    raw = { ...rest, args: { characterId, ...args } };
  }
  const p = writeBase.extend({ name: z.string().trim().min(1).max(100), args: z.record(z.string(), z.unknown()).default({}), scopeRoomId: id.optional() }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  if (!EXTERNAL_NARRATOR_ACTIONS.has(p.data.name)) throw new McpNarratorControlError("That action is not available to an external narrator.", 403);
  if (p.data.scopeRoomId && (p.data.name !== "location_narrate" || p.data.args.roomId !== p.data.scopeRoomId)) throw new McpNarratorControlError("Room concurrency scope is only valid for location_narrate in that room.", 400);
  guardPlayerText(() => assertPlayerFacingArgs(p.data.name, p.data.args));
  return serializedWrite(p.data, "narrator.invoke", { name: p.data.name, args: p.data.args, ...(p.data.scopeRoomId ? { scopeRoomId: p.data.scopeRoomId } : {}) }, campaign => {
    if (Object.hasOwn(SPATIAL_NARRATOR_OPERATIONS, p.data.name)) return invokeSpatialForNarrator(campaign.id, campaign.dmUserId!, p.data.name, p.data.args, p.data.commandId);
    const scoped = scopeBattleMapInvocation(campaign.id, campaign.dmUserId!, p.data.name, p.data.args);
    const outcome = invokeEngineSynchronous(campaign, { kind: "human", userId: campaign.dmUserId! }, { name: p.data.name, args: scoped.args });
    if (!outcome.ok) {
      if (/Unknown (?:characterId|targetCharacterId|casterId)|needs [^\n]*\((?:characterId|targetCharacterId|casterId)\)/i.test(outcome.error)) {
        const characters = listSheets(campaign.id).map(({ id, name }) => ({ id, name }));
        throw new McpNarratorControlError(`${outcome.error} Use the matching campaign sheets[].id inside args; userId and libraryCharacterId are different identifiers. Reread before correcting the refused command. Available campaign characters: ${JSON.stringify(characters)}`);
      }
      throw new McpNarratorControlError(outcome.error);
    }
    if (scoped.roomId) bindActiveBattleMapToRoom(campaign.id, campaign.dmUserId!, scoped.roomId);

    // A global round that transitioned into initiative stays armed in
    // `waiting`. When the MCP narrator ends that encounter, emit the next
    // narrator trigger inside the same committed command. Players remain
    // locked until the follow-up narration starts the waiting round.
    if (p.data.name === "end_encounter" && campaign.gameSettings.globalTurn?.enabled) {
      const globalTurn = getGlobalTurnState(campaign.id);
      if (globalTurn.phase === "waiting") {
        publishPersisted(campaign.id, "global_turn_narrator_trigger", {
          kind: "post_combat",
          roundNumber: globalTurn.roundNumber,
        });
      }
    }
    return outcome;
  }, p.data.scopeRoomId ? (campaign, currentSeq) => unrelatedRoomChat(getDatabase(), {
    campaignId: campaign.id, dmUserId: campaign.dmUserId!, roomId: p.data.scopeRoomId!, afterSeq: p.data.expectedSeq, currentSeq,
  }) : undefined);
}
async function deleteMessage(raw: unknown) {
  const p = writeBase.extend({ messageId: id }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));

  return serializedWrite(
    p.data,
    "narrator.delete_message",
    { messageId: p.data.messageId },
    campaign => {
      const deleted = deleteCampaignMessage(campaign.id, p.data.messageId);
      if (!deleted) throw new McpNarratorControlError("Message not found in this campaign.", 404);

      const eventSeq = publishPersisted(campaign.id, "message_deleted", {
        messageId: deleted.id,
        authorType: deleted.authorType,
        userId: deleted.userId,
        characterId: deleted.characterId,
        messageSeq: deleted.seq,
      });

      const floor = getFloor(campaign.id);
      let inputReopened = false;
      if (deleted.authorType === "player" && deleted.characterId && floor.mode === "hold" &&
          floor.combat?.submissionMessageId === deleted.id) {
        const sheets = listSheets(campaign.id);
        const reopened = handleRequestPlayerInput(campaign, JSON.stringify({ characterIds: [deleted.characterId] }),
          sheets, new Map(sheets.map(sheet => [sheet.id, sheet])));
        inputReopened = reopened.clarification === true;
      }

      return {
        deleted: {
          id: deleted.id,
          authorType: deleted.authorType,
          userId: deleted.userId,
          characterId: deleted.characterId,
          messageSeq: deleted.seq,
        },
        eventSeq,
        inputReopened,
      };
    },
  );
}

async function editMessage(raw: unknown) {
  const p = writeBase.extend({ messageId: id, content: z.string().min(1).max(MAX_EDITED_LENGTH * 2) }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  guardPlayerText(() => assertPlayerFacingText(p.data.content, "edit"));
  return serializedWrite(p.data, "narrator.edit_message", { messageId: p.data.messageId, content: p.data.content }, campaign => {
    const message = getCampaignMessage(p.data.messageId);
    if (!message || message.campaignId !== campaign.id) throw new McpNarratorControlError("Message not found in this campaign.", 404);
    const check = checkEdit(message.content, p.data.content);
    if (!check.ok) throw new McpNarratorControlError(check.reason, 400);
    const variants = seedVariants(message.variants ?? [], message.content);
    const index = resolveVariantIndex(variants, message.variantIndex ?? 0);
    const updated = message.authorType === "dm" && index >= 0 && variants.length > 1
      ? setMessageVariants(message.id, replaceSelectedTake(variants, index, check.content), index)
      : updateMessageContent(message.id, check.content);
    if (!updated) throw new McpNarratorControlError("Could not save the edit.", 500);
    publishPersisted(campaign.id, "message_updated", { message: updated });
    return { message: updated };
  });
}

async function narrate(raw: unknown) {
  const p = writeBase.extend({
    content: z.string().trim().min(1).max(8000),
    turnId: id.optional(),
    releaseFloor: z.boolean().optional(),
    passTurn: z.boolean().optional(),
    completeGlobalRound: z.number().int().min(1).optional(),
    startGlobalRound: z.number().int().min(1).optional(),
  }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  guardPlayerText(() => assertPlayerFacingText(p.data.content, "narration"));
  // A combat turn a player submitted is handed on only by the narrator's
  // last message about it; releaseFloor means the same thing there.
  const handOver = Boolean(p.data.passTurn || p.data.releaseFloor);
  return serializedWrite(
    p.data,
    "narrator.narrate",
    {
      content: p.data.content,
      turnId: p.data.turnId,
      releaseFloor: p.data.releaseFloor,
      ...(p.data.passTurn !== undefined ? { passTurn: p.data.passTurn } : {}),
      completeGlobalRound: p.data.completeGlobalRound,
      startGlobalRound: p.data.startGlobalRound,
    },
    campaign => {
    if (p.data.turnId) {
      const turn = getDmTurn(p.data.turnId);
      if (!turn || turn.campaignId !== campaign.id || turn.actor !== "human_dm") throw new McpNarratorControlError("Narration turn does not belong to this human-DM campaign.", 409);
    }
    if (spatialEnabled(campaign.id)) throw new McpNarratorControlError("Use narrator.invoke location_narrate with an explicit roomId for this campaign.", 409);
    if (handOver) {
      if (listOpenPendingRolls(campaign.id).length) throw new McpNarratorControlError("Resolve pending physical rolls before passing the turn; nothing was written.", 409);
      if (combatHandoffState(campaign.id).state === "resolving") {
        throw new McpNarratorControlError("This combat turn is not resolved yet: call end_turn (or completeTurn) for the acting character first, then send this narration with passTurn:true. Nothing was written.", 409);
      }
    }
    if (
      p.data.completeGlobalRound !== undefined &&
      p.data.startGlobalRound !== undefined
    ) {
      throw new McpNarratorControlError(
        "A narration cannot both start and complete a global round.",
        400,
      );
    }
    if (p.data.startGlobalRound !== undefined) {
      const globalTurn = getGlobalTurnState(campaign.id);
      if (
        !campaign.gameSettings.globalTurn?.enabled ||
        globalTurn.roundNumber !== p.data.startGlobalRound ||
        globalTurn.phase !== "waiting"
      ) {
        throw new McpNarratorControlError(
          "Global round is not waiting for this start trigger. Reread before narrating.",
          409,
        );
      }
    }
    if (p.data.completeGlobalRound !== undefined) {
      const globalTurn = getGlobalTurnState(campaign.id);
      if (
        !campaign.gameSettings.globalTurn?.enabled ||
        globalTurn.roundNumber !== p.data.completeGlobalRound ||
        (globalTurn.phase !== "ready" && globalTurn.phase !== "resolving")
      ) {
        throw new McpNarratorControlError(
          "Global round is not sealed for this narrator command. Reread before narrating.",
          409,
        );
      }
    }
    const heldBefore = combatHandoffState(campaign.id).state !== "none";
    const message = persistHumanNarration(campaign, p.data.content, campaign.dmUserId!, { passTurn: handOver, continueScene: true });
    if (takeDirectorArm(campaign.id)) {
      publishPersisted(campaign.id, "director_armed", { armed: false, oneShot: null, absoluteCommand: "" });
    }
    let floorResult;
    if (p.data.releaseFloor) {
      const current = getFloor(campaign.id);
      // A team-round hold is the global round's to open, not the narrator's.
      const floor = current.mode === "hold" && !current.combat && !current.team ? current.next : current;
      setFloor(campaign.id, floor); publishPersisted(campaign.id, "floor_changed", { floor });
      queueSkippedCombatTurn(campaign.id);
      floorResult = { floorReleased: getFloor(campaign.id).mode !== "hold", floor: getFloor(campaign.id) };
    }
    let globalTurnResult;
    if (p.data.startGlobalRound !== undefined) {
      const started = startGlobalTurn(campaign.id, "mcp_trigger");
      if (
        !started ||
        started.roundNumber !== p.data.startGlobalRound ||
        (started.phase !== "active" && started.phase !== "quorum_delay")
      ) {
        throw new McpNarratorControlError("Global round did not start.", 409);
      }
      globalTurnResult = {
        globalRoundStarted: started.roundNumber,
      };
    }
    if (p.data.completeGlobalRound !== undefined) {
      const completed = completeGlobalTurn(campaign.id, p.data.completeGlobalRound);
      if (!completed || completed.roundNumber <= p.data.completeGlobalRound) {
        throw new McpNarratorControlError("Global round did not advance.", 409);
      }
      globalTurnResult = {
        globalRoundCompleted: p.data.completeGlobalRound,
        nextGlobalRound: completed.roundNumber,
      };
    }
    const handoff = combatHandoffState(campaign.id);
    const turnHandoff = handoff.state === "ready"
      ? { status: "awaiting_pass", note: "Players are still locked (nobody's turn). Post any remaining narration for this turn, and send the last message with passTurn:true (or call release_floor) to move initiative." }
      : handoff.state === "resolving"
        ? { status: "resolving", note: "Players are locked until this turn is resolved: finish its mechanics and end_turn, then narrate with passTurn:true." }
        : heldBefore ? { status: "passed" } : undefined;
    return {
      messageId: message.id,
      ...(message.appended ? { appendedToScene: true } : {}),
      ...(p.data.turnId ? { turnId: p.data.turnId } : {}),
      ...(floorResult ?? {}),
      ...(globalTurnResult ?? {}),
      ...(turnHandoff ? { turnHandoff } : {}),
    };
  },
  );
}
async function finishGlobalRound(raw: unknown) {
  const p = writeBase.extend({
    mode: z.enum(["start", "complete"]),
    roundNumber: z.number().int().min(1),
  }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(
    p.data,
    "narrator.finish_global_round",
    { mode: p.data.mode, roundNumber: p.data.roundNumber },
    campaign => {
      // Non-spatial global rounds must close with narrator.narrate so the
      // narration and round transition are one atomic write. This no-prose
      // finalizer exists only after room-scoped location_narrate writes.
      if (!spatialEnabled(campaign.id)) {
        throw new McpNarratorControlError(
          "Global-round finalizer is only valid for spatial narration.",
          409,
        );
      }
      if (!campaign.gameSettings.globalTurn?.enabled) {
        throw new McpNarratorControlError("Global-turn mode is not enabled.", 409);
      }
      if (p.data.mode === "start") {
        const current = getGlobalTurnState(campaign.id);
        if (current.roundNumber !== p.data.roundNumber || current.phase !== "waiting") {
          throw new McpNarratorControlError(
            "Global round is not waiting for this start finalizer.",
            409,
          );
        }
        const started = startGlobalTurn(campaign.id, "mcp_trigger");
        if (!started || started.roundNumber !== p.data.roundNumber) {
          throw new McpNarratorControlError("Global round did not start.", 409);
        }
        if (takeDirectorArm(campaign.id)) publishPersisted(campaign.id, "director_armed", { armed: false, oneShot: null, absoluteCommand: "" });
        return { globalRoundStarted: started.roundNumber, state: started };
      }

      const current = getGlobalTurnState(campaign.id);
      if (
        current.roundNumber !== p.data.roundNumber ||
        (current.phase !== "ready" && current.phase !== "resolving")
      ) {
        throw new McpNarratorControlError(
          "Global round is not sealed for this completion finalizer.",
          409,
        );
      }
      const completed = completeGlobalTurn(campaign.id, p.data.roundNumber);
      if (!completed || completed.roundNumber <= p.data.roundNumber) {
        throw new McpNarratorControlError("Global round did not advance.", 409);
      }
      if (takeDirectorArm(campaign.id)) publishPersisted(campaign.id, "director_armed", { armed: false, oneShot: null, absoluteCommand: "" });
      return {
        globalRoundCompleted: p.data.roundNumber,
        nextGlobalRound: completed.roundNumber,
        state: completed,
      };
    },
  );
}

async function autopilotAction(raw: unknown) {
  const p = writeBase.extend({
    characterId: id,
    roundNumber: z.number().int().min(1).optional(),
    kind: z.literal("do").default("do"),
    content: z.string().trim().min(1).max(2000),
  }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));

  return serializedWrite(
    p.data,
    "narrator.autopilot_action",
    {
      characterId: p.data.characterId,
      roundNumber: p.data.roundNumber,
      kind: p.data.kind,
      content: p.data.content,
    },
    campaign => {
      if (getActiveEncounter(campaign.id)) {
        throw new McpNarratorControlError("Autopilot does not impersonate combat initiative.", 409);
      }

      const globalMode = Boolean(campaign.gameSettings.globalTurn?.enabled);
      const globalTurn = globalMode ? getGlobalTurnState(campaign.id) : null;
      if (globalMode && (
        globalTurn?.roundNumber !== p.data.roundNumber ||
        (globalTurn?.phase !== "active" && globalTurn?.phase !== "quorum_delay")
      )) {
        throw new McpNarratorControlError("This autopilot round is no longer accepting player input.", 409);
      }

      const sheet = listSheets(campaign.id).find(entry => entry.id === p.data.characterId);
      if (!sheet || sheet.isCompanion || sheet.userId === campaign.dmUserId) {
        throw new McpNarratorControlError("Autopilot character is not an eligible player character.", 409);
      }
      const member = listMembers(campaign.id).find(entry => entry.userId === sheet.userId);
      if (!member?.autopilot) {
        throw new McpNarratorControlError("Autopilot is no longer enabled for this player.", 409);
      }
      if (member.skipTurnsCount > 0) {
        throw new McpNarratorControlError("This player is skipping the round instead of using autopilot.", 409);
      }
      if (member.muted) {
        throw new McpNarratorControlError("This player is muted and cannot submit an autopilot turn.", 409);
      }

      const existing = globalTurn?.actionsByCharacter[sheet.id];
      if (globalTurnSubmitted(existing)) {
        throw new McpNarratorControlError("This character has already responded in the current round.", 409);
      }

      if (spatialEnabled(campaign.id) && globalMode) {
        try {
          const result = runSpatialCommand(campaign.id, sheet.userId, {
            operation: "send",
            requestId: p.data.commandId ?? randomUUID(),
            kind: p.data.kind,
            content: p.data.content,
            characterId: sheet.id,
          });
          const message = result.message as { id?: string; seq?: number } | undefined;
          const afterSpatialAction = getGlobalTurnState(campaign.id);
          const deadlineMs = afterSpatialAction.deadlineAt
            ? new Date(afterSpatialAction.deadlineAt).getTime()
            : Number.POSITIVE_INFINITY;
          if (
            afterSpatialAction.roundNumber === p.data.roundNumber &&
            afterSpatialAction.phase === "quorum_delay" &&
            deadlineMs <= Date.now()
          ) {
            // spatial/service intentionally resolves after its own transaction.
            // This narrator command already owns a serialized outer transaction,
            // so a due zero-grace/all-answered round can be sealed before return.
            sealGlobalTurnNow(campaign.id, p.data.roundNumber);
          }
          return {
            characterId: sheet.id,
            roundNumber: p.data.roundNumber,
            messageId: message?.id ?? null,
            seq: message?.seq ?? null,
            sealed: getGlobalTurnState(campaign.id).phase === "ready",
          };
        } catch (error) {
          if (error instanceof SpatialError) {
            throw new McpNarratorControlError(error.message, error.status);
          }
          throw error;
        }
      }

      const floor = getFloor(campaign.id);
      if (!canAct(floor, sheet.userId, p.data.kind)) {
        throw new McpNarratorControlError("This player cannot act on the current floor.", 409);
      }
      if (!globalMode) {
        if (p.data.roundNumber !== undefined || floor.mode !== "spotlight" || spatialEnabled(campaign.id)) {
          throw new McpNarratorControlError("Sequential autopilot requires an eligible spotlight and no roundNumber.", 409);
        }
        const responded = [...floor.respondedUserIds, sheet.userId];
        const allAnswered = floor.userIds.every(userId => responded.includes(userId));
        const nextFloor = allAnswered ? { mode: "hold" as const, next: { mode: "open" as const } } : { ...floor, respondedUserIds: responded };
        setFloor(campaign.id, nextFloor);
        publishPersisted(campaign.id, "floor_changed", { floor: nextFloor });
        const seq = allocateSeq(campaign.id);
        const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "player", userId: sheet.userId,
          characterId: sheet.id, content: p.data.content });
        publishWithSeq(campaign.id, seq, "message_added", { message });
        if (allAnswered) {
          publishPersisted(campaign.id, "dm_intent_queued", { messageId: message.id, userId: sheet.userId, characterId: sheet.id, seq });
          publishPersisted(campaign.id, "spotlight_ready", { messageId: message.id, autoReleaseFloor: true });
        }
        return { characterId: sheet.id, messageId: message.id, seq, spotlightComplete: allAnswered };
      }

      const turn = recordGlobalTurnAction(
        campaign.id,
        sheet.id,
        sheet.userId,
        p.data.kind,
      );
      if (!turn.allowed) {
        throw new McpNarratorControlError(
          turn.error ?? "This round is not accepting the autopilot action.",
          409,
        );
      }

      const seq = allocateSeq(campaign.id);
      const message = insertCampaignMessage({
        campaignId: campaign.id,
        seq,
        authorType: "player",
        userId: sheet.userId,
        characterId: sheet.id,
        content: p.data.content,
      });
      publishWithSeq(campaign.id, seq, "message_added", { message });

      if (turn.shouldResolve && turn.state) {
        sealGlobalTurnNow(campaign.id, turn.state.roundNumber);
      }

      return {
        characterId: sheet.id,
        roundNumber: p.data.roundNumber,
        messageId: message.id,
        seq,
        sealed: getGlobalTurnState(campaign.id).phase === "ready",
      };
    },
  );
}

// Closes the campaign with a victory or a defeat from any state: mid-fight,
// with dice or Asks outstanding, under a held turn. Allowed on an ended
// campaign too, to correct the outcome or epilogue (and so a retried command
// still finds its receipt).
async function endCampaign(raw: unknown) {
  const p = writeBase.extend({
    outcome: z.enum(["victory", "defeat"]),
    epilogue: z.string().trim().max(12000).optional(),
  }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  const { outcome, epilogue, ...base } = p.data;
  guardPlayerText(() => assertPlayerFacingText(epilogue, "epilogue"));
  return executeNarratorCommand({
    ...base,
    operation: "narrator.end_campaign",
    payload: { outcome, ...(epilogue !== undefined ? { epilogue } : {}) },
    loadState: () => {
      const campaign = campaignOrHuman(base.campaignId);
      if (campaign.kind !== "campaign") throw new McpNarratorControlError("Only a campaign can be ended.", 409);
      return campaign;
    },
    work: campaign => closeCampaign(campaign, { outcome, epilogue, endedBy: "narrator" }) as unknown as Record<string, unknown>,
  });
}

async function releaseFloor(raw: unknown) {
  const p = writeBase.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.release_floor", {}, campaign => {
    if (campaign.gameSettings.globalTurn?.enabled && !getActiveEncounter(campaign.id)) {
      throw new McpNarratorControlError("Global-turn pacing owns the non-combat floor; use request_response.", 409);
    }
    const current = getFloor(campaign.id);
    if (listOpenPendingRolls(campaign.id).length) throw new McpNarratorControlError("Resolve pending physical rolls before releasing the floor.", 409);
    if (current.mode === "hold" && current.team) throw new McpNarratorControlError("The fight waits for the rest of the party this team round; the held turn opens when the next global round starts. Resolve the round with completeGlobalRound instead.", 409);
    if (current.mode === "hold" && current.combat) {
      // The narrator is done writing about a resolved combat turn: hand it on.
      if (combatHandoffState(campaign.id, current).state !== "ready") throw new McpNarratorControlError("Combat adjudication is still in progress: call end_turn for the acting character first.", 409);
      passCombatTurn(campaign);
      return { floor: getFloor(campaign.id), turnHandoff: { status: "passed" } };
    }
    const floor = current.mode === "hold" ? current.next : current;
    setFloor(campaign.id, floor); publishPersisted(campaign.id, "floor_changed", { floor });
    queueSkippedCombatTurn(campaign.id);
    return { floor: getFloor(campaign.id) };
  });
}

async function setNarratorFloor(raw: unknown) {
  const p = writeBase.extend({ mode: z.enum(["open", "hold", "spotlight"]),
    characterIds: z.array(id).max(12).optional(), prompt: z.string().trim().max(300).optional() }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.set_floor", { mode: p.data.mode, characterIds: p.data.characterIds, prompt: p.data.prompt }, campaign => {
    if (campaign.gameSettings.globalTurn?.enabled && !getActiveEncounter(campaign.id)) {
      throw new McpNarratorControlError("Global-turn pacing owns the non-combat floor; use request_response.", 409);
    }
    const current = getFloor(campaign.id);
    if (listOpenPendingRolls(campaign.id).length || getActiveEncounter(campaign.id) || current.mode === "initiative" ||
        (current.mode === "hold" && (current.combat || current.next.mode === "initiative"))) {
      throw new McpNarratorControlError("Resolve combat and pending rolls before changing the floor.", 409);
    }
    let floor: typeof current;
    if (p.data.mode === "spotlight") {
      const selected = new Set(p.data.characterIds ?? []);
      const sheets = listSheets(campaign.id).filter(sheet => selected.has(sheet.id) && !sheet.isCompanion && sheet.userId !== campaign.dmUserId);
      if (!sheets.length || sheets.length !== selected.size) throw new McpNarratorControlError("Choose eligible player characters for the spotlight.", 400);
      floor = { mode: "spotlight", userIds: [...new Set(sheets.map(sheet => sheet.userId))],
        prompt: p.data.prompt ?? "", respondedUserIds: [] };
    } else floor = p.data.mode === "hold" ? { mode: "hold", next: { mode: "open" } } : { mode: "open" };
    setFloor(campaign.id, floor);
    publishPersisted(campaign.id, "floor_changed", { floor });
    if (floor.mode === "spotlight") {
      const members = listMembers(campaign.id);
      const selected = new Set(p.data.characterIds ?? []);
      const sheets = listSheets(campaign.id).filter(sheet => selected.has(sheet.id) && !sheet.isCompanion && sheet.userId !== campaign.dmUserId);
      for (const sheet of sheets) {
        const member = members.find(m => m.userId === sheet.userId);
        if (member?.autopilot && !member.muted && member.skipTurnsCount === 0) {
          publishPersisted(campaign.id, "autopilot_action_requested", {
            characterId: sheet.id,
            userId: sheet.userId,
          });
        }
      }
    }
    if (current.mode === "spotlight" && current.respondedUserIds.length && !campaign.gameSettings.globalTurn?.enabled) {
      publishPersisted(campaign.id, "spotlight_ready", { releasedEarly: true });
    }
    return { floor };
  });
}

async function requestNarratorResponse(raw: unknown) {
  const p = writeBase.extend({ roundNumber: z.number().int().min(1).optional() }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.request_response", { roundNumber: p.data.roundNumber }, campaign => {
    if (getActiveEncounter(campaign.id) || listOpenPendingRolls(campaign.id).length) {
      throw new McpNarratorControlError("Resolve combat and pending rolls before requesting a response.", 409);
    }
    if (!campaign.gameSettings.globalTurn?.enabled) {
      if (p.data.roundNumber !== undefined) throw new McpNarratorControlError("roundNumber requires global-turn mode.", 400);
      const seq = publishPersisted(campaign.id, "lead_response_requested", { leadUserId: campaign.leadUserId });
      return { requested: true, seq };
    }
    const turn = getGlobalTurnState(campaign.id);
    if (turn.roundNumber !== p.data.roundNumber || !["active", "quorum_delay"].includes(turn.phase)) {
      throw new McpNarratorControlError("This round is not collecting input.", 409);
    }
    const next = sealGlobalTurnNow(campaign.id, turn.roundNumber);
    if (next?.phase !== "ready") throw new McpNarratorControlError("Could not seal this round.", 409);
    return { requested: true, globalTurnState: next };
  });
}
async function dispatchMcpNarratorControl(action: string, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown }> {
  if (action === "narrator.invoke" && raw && typeof raw === "object" && "scopeRoomId" in raw && !("timelineEpoch" in raw)) throw new McpNarratorControlError("Scoped narration requires timelineEpoch.", 400);
  if (action.startsWith("narrator.") && raw && typeof raw === "object" && !Array.isArray(raw) && Object.hasOwn(raw, "timelineEpoch")) {
    const { timelineEpoch, ...params } = raw as Record<string, unknown>;
    const campaignId = id.safeParse(params.campaignId);
    if (!campaignId.success || typeof timelineEpoch !== "string" || !/^[a-f0-9]{64}$/.test(timelineEpoch)) throw new McpNarratorControlError("Invalid narrator timeline assertion.", 400);
    campaignOrHuman(campaignId.data);
    if (campaignTimelineEpoch(campaignId.data) !== timelineEpoch) throw Object.assign(new McpNarratorControlError("Narrator timeline changed; reconnect before reading or writing.", 409), { code: "timeline_changed" });
    raw = params;
  }
  switch (action) {
    case "narrator.connect": {
      const p = z.object({ campaignId: id, paged: z.boolean().optional(), maxBytes: z.number().int().min(4096).max(131072).optional(), projection: z.enum(["full", "live"]).optional(), stateDelta: z.boolean().optional() }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      const campaign = campaignOrHuman(p.data.campaignId);
      const metadata = { currentSeq: latestSeq(campaign.id), timelineEpoch: campaignTimelineEpoch(campaign.id) };
      const base = { instructions: "Read odm://narrator/playbook. Call narrator.read, drain until hasMore is false, then use its currentSeq as expectedSeq for exactly one invoke, narrate, delete_message, autopilot_action, finish_global_round, or release_floor. finish_global_round is only the no-prose spatial global-turn finalizer after all required room narrations commit. Persist a unique UUID commandId before each story write. After an ambiguous error, retry only the identical commandId, expectedSeq and payload to recover its receipt, never regenerate or modify a command. Consume the attached state delta after a confirmed write as its read, then drain any remaining pages/events. If readRequired is true, the write succeeded but its read failed: read again, never replay the effect. A player submits exactly one Do per turn, including dialogue. In combat the first accepted Do holds the table: nobody may act (campaign.turnLock) until you hand the turn over. Resolve it with engine actions, including the enemies that act before the next hero, then end_turn or completeTurn: that records the resolution but does NOT move initiative. Post every narration message for the turn and send the LAST one with passTurn:true (or call release_floor); only that moves initiative, lets the server play enemies you skipped and announces the next actor. Never announce whose turn it is yourself. In global-turn mode actionsByCharacter locks that character until round completion. For a private reply provide exact replyToWhisperIds from playerWhispers. With globalTurn enabled, the campaign starts locked: wait for global_turn_narrator_trigger, narrate the opening, and send startGlobalRound equal to its roundNumber; only that confirmed narration unlocks players. After that, collect player messages until global_turn_ready; resolve the whole batch through that event seq, exactly as its declarations list it (each by character name). Autopilot player intent is generated only by the trusted host actor role and committed with autopilot_action; the server rechecks the player's live opt-in and round eligibility and never calls an LLM itself. In ordinary chat, narrate with completeGlobalRound set to its roundNumber so the confirmed MCP write advances and opens the next round atomically. In spatial mode, narrate every affected room separately with location_narrate; the trusted host performs the internal round finalizer only after all required room narrations commit. Do not narrate individual global-turn messages before the barrier. Check the pending asks queue on every read even when the story cursor is unchanged. Page it using afterAskSeq and askQueue.nextCursor; a fresh Ask scan may start at zero. answer_ask requires the pending ask version as expectedVersion and a persisted UUID commandId; it changes no story/floor state. For bounded reads use paged:true and drain pageCursor/nextPage before advancing the story cursor. Byte pages use a bounded frozen snapshot. stateDelta:true negotiates cached entity patches: keep the returned revision, apply patches only to the matching timeline/projection, and accept a full resync when the server no longer has the baseline. Carry the returned timelineEpoch on reads and writes; reconnect and discard incompatible pending work when it changes. Combat contract v6: refresh cached action schemas. Named heal now spends its own slot and casting action; do not separately use_spell_slot. combat_turn resolves an ordered declared plan with one receipt; preserve confirmed steps on blocked/awaiting_rolls. request_player_input can reopen only the same current actor for clarification, without a budget reset.",
        contractVersion: 8, timelineVersion: 1,
        features: { explicitTurnHandoff: true, campaignOutcome: true, postWriteRead: true, frozenPages: true, liveDefaults: true, stateDelta: "odm.state.delta.v1", entityPatches: true, compoundCombatTurn: true, atomicHealing: true, explicitSneakAttack: true, mercyHealing2014: true } };
      return { handled: true, result: p.data.stateDelta ? { ...base, cursor: metadata } : { ...base, state: read({ projection: "full", ...p.data }) } };
    }
    case "narrator.read": return { handled: true, result: read(raw) };
    case "narrator.snapshot": return { handled: true, result: orchestrationSnapshot(raw) };
    case "narrator.catalog": {
      const p = z.object({ campaignId: id.optional(), summaryOnly: z.boolean().optional(), category: z.string().optional(), action: z.string().optional(), actionFilter: z.string().optional(), name: z.string().optional() }).strict().safeParse(raw ?? {});
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      if (p.data.campaignId) campaignOrHuman(p.data.campaignId);
      const options = { summaryOnly: p.data.summaryOnly, category: p.data.category, action: p.data.action || p.data.actionFilter || p.data.name };
      return { handled: true, result: { groups: catalog(options) } };
    }
    case "narrator.status": {
      const p = z.object({
        campaignId: id,
        state: z.enum(["idle", "thinking", "rolling", "narrating", "awaiting_rolls"]),
      }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      campaignOrHuman(p.data.campaignId);
      setDmStatus(p.data.campaignId, p.data.state);
      return { handled: true, result: { ok: true, state: p.data.state } };
    }
    case "narrator.invoke": return { handled: true, result: await invoke(raw) };
    case "narrator.narrate": return { handled: true, result: await narrate(raw) };
    case "narrator.store_audio": {
      const p = z.object({
        campaignId: id,
        messageId: id,
        mimeType: z.literal("audio/wav"),
        audioBase64: z.string().min(4).max(16_777_216),
      }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      const campaign = campaignOrHuman(p.data.campaignId);
      const bytes = Buffer.from(p.data.audioBase64, "base64");
      if (!bytes.length || bytes.toString("base64") !== p.data.audioBase64) {
        throw new McpNarratorControlError("Narration audio must use canonical base64.", 400);
      }
      try {
        const stored = storeNarrationAudio(campaign.id, p.data.messageId, bytes);
        publishEphemeral(campaign.id, "message_updated", { message: stored.message });
        return { handled: true, result: {
          messageId: stored.message.id, audioUrl: stored.audioUrl,
          expiresAt: stored.expiresAt, byteSize: stored.byteSize,
        } };
      } catch (error) {
        throw new McpNarratorControlError(error instanceof Error ? error.message : "Could not store narration audio.", 400);
      }
    }
    case "narrator.delete_message": return { handled: true, result: await deleteMessage(raw) };
    case "narrator.edit_message": return { handled: true, result: await editMessage(raw) };
    case "narrator.autopilot_action": return { handled: true, result: await autopilotAction(raw) };
    case "narrator.finish_global_round": return { handled: true, result: await finishGlobalRound(raw) };
    case "narrator.release_floor": return { handled: true, result: await releaseFloor(raw) };
    case "narrator.end_campaign": return { handled: true, result: await endCampaign(raw) };
    case "narrator.set_floor": return { handled: true, result: await setNarratorFloor(raw) };
    case "narrator.request_response": return { handled: true, result: await requestNarratorResponse(raw) };
    case "narrator.answer_ask": {
      const p = z.object({
        campaignId: id, askId: id, expectedVersion: z.number().int().min(0).default(0), commandId: id.optional(), expectedSeq: z.number().int().min(0).optional(),
        answer: z.string().trim().min(1).max(4000),
        citations: z.array(z.object({ kind: z.enum(["fact", "chapter", "scene", "summary", "npc", "place", "rule", "sheet", "recent"]), ref: z.string().max(300), quote: z.string().max(2000) }).strict()).max(50).default([]),
      }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      const campaign = campaignOrHuman(p.data.campaignId);
      guardPlayerText(() => assertPlayerFacingText(p.data.answer, "Ask answer"));
      if (p.data.expectedSeq !== undefined && p.data.expectedSeq !== latestSeq(campaign.id)) throw new McpNarratorControlError("Stale narrator cursor; reread before answering.", 409);
      let updated;
      try { updated = answerAsk(campaign.id, p.data.askId, p.data.answer, p.data.citations, { expectedVersion: p.data.expectedVersion, commandId: p.data.commandId }); }
      catch (error) { if (error instanceof AskQueueConflict) throw new McpNarratorControlError(error.message, 409); throw error; }
      if (!updated) throw new McpNarratorControlError("Ask not found in this campaign.", 404);
      if (updated.visibility === "table") publishEphemeral(campaign.id, "ask_activity", {}); else publishUserEphemeral(campaign.id, updated.userId, "ask_activity", {});
      return { handled: true, result: { ok: true, ask: updated } };
    }
    default: return { handled: false };
  }
}
const storyWrites = new Set([
  "narrator.invoke",
  "narrator.narrate",
  "narrator.delete_message",
  "narrator.edit_message",
  "narrator.autopilot_action",
  "narrator.finish_global_round",
  "narrator.release_floor",
  "narrator.end_campaign",
]);
const readAfterSchema = z.union([z.boolean(), z.object({
  afterSeq: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
  afterAskSeq: z.number().int().min(0).optional(), askLimit: z.number().int().min(1).max(50).optional(),
  includeAsks: z.boolean().optional(),
  paged: z.boolean().optional(), projection: z.enum(["full", "live"]).optional(),
  maxBytes: z.number().int().min(4096).max(131072).optional(), delta: z.boolean().optional(),
  stateDelta: z.boolean().optional(), knownStateRevision: sectionDigest.optional(),
  knownSeq: z.number().int().min(0).optional(), knownSections: readSchema.shape.knownSections,
}).strict()]);
function leaseBoundRequest(action: string, raw: unknown) {
  if (!action.startsWith("narrator.") || !raw || typeof raw !== "object" || Array.isArray(raw)) return { params: raw, hostId: undefined as string | undefined };
  const record = raw as Record<string, unknown>;
  const host = record.narratorHostId;
  const wantsV4 = record.stateDelta === true ||
    (record.readAfter && typeof record.readAfter === "object" && !Array.isArray(record.readAfter) &&
      (record.readAfter as Record<string, unknown>).stateDelta === true);
  if (host === undefined) {
    if (wantsV4) throw new McpNarratorControlError("stateDelta requires a narrator host identity.", 400);
    return { params: raw, hostId: undefined as string | undefined };
  }
  const parsedHost = id.safeParse(host), parsedCampaign = id.safeParse(record.campaignId);
  if (!parsedHost.success || !parsedCampaign.success) throw new McpNarratorControlError("Invalid narrator host lease metadata.", 400);
  campaignOrHuman(parsedCampaign.data);
  try { touchNarratorLease(parsedCampaign.data, parsedHost.data); }
  catch (error) {
    if (error instanceof NarratorLeaseConflict) throw new McpNarratorControlError(error.message, error.status);
    throw error;
  }
  const { narratorHostId: _ignored, ...params } = record;
  return { params, hostId: parsedHost.data };
}

export async function executeMcpNarratorControl(action: string, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown }> {
  const leased = leaseBoundRequest(action, raw);
  raw = leased.params;
  if (!storyWrites.has(action) || !raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, "readAfter")) return dispatchMcpNarratorControl(action, raw);
  const { readAfter, ...params } = raw as Record<string, unknown>;
  const options = readAfterSchema.safeParse(readAfter);
  if (!options.success) throw new McpNarratorControlError(z.prettifyError(options.error));
  const query = typeof options.data === "object" ? options.data : {};
  for (const cursor of [query.afterSeq, query.knownSeq]) {
    if (cursor !== undefined && (typeof params.expectedSeq !== "number" || cursor > params.expectedSeq)) throw new McpNarratorControlError("Post-write read cannot skip unread input.", 400);
  }
  const result = await dispatchMcpNarratorControl(action, params);
  if (!result.handled || options.data === false) return result;
  const readParams = { campaignId: params.campaignId, afterSeq: params.expectedSeq, projection: "live", delta: true, ...query,
    ...(params.timelineEpoch ? { timelineEpoch: params.timelineEpoch } : {}) };
  const receipt = await attachPostWriteRead(result.result, readParams, async (params: Record<string, unknown>) => {
    const fresh = await dispatchMcpNarratorControl("narrator.read", params);
    if (!fresh.handled) throw new Error("Read handler unavailable.");
    return fresh.result;
  });
  return { handled: true, result: receipt };
}
