import { SPATIAL_NARRATOR_CATALOG, SPATIAL_NARRATOR_OPERATIONS, SPATIAL_GUIDANCE, readSpatialForNarrator, invokeSpatialForNarrator } from "@/lib/spatial/narrator";
import { spatialNarratorBoundary } from "@/lib/spatial/narrator-page.mjs";
import { spatialEnabled, spatialContext } from "@/lib/spatial/service";
import { bindActiveBattleMapToRoom, scopeBattleMapInvocation } from "@/lib/spatial/battle-map";
import { campaignTimelineEpoch } from "@/lib/spatial/timeline";
import { getDatabase } from "@/lib/db/core";
import { unrelatedRoomChat } from "@/lib/spatial/narrator-concurrency.mjs";
import { attachPostWriteRead } from "@/lib/mcp-post-write.mjs";
import { readNarratorSections } from "@/lib/mcp-read-sections.mjs";
import { z } from "zod";
import { queueSkippedCombatTurn } from "@/lib/dm/encounter-tools";
import { isOocMessage } from "@/lib/campaign-types";
import { isNarratorEvent } from "@/lib/mcp-event-filter";
import { getCampaignById, getCampaignSummaryState, getFloor, getGlobalTurnState, latestSeq, listMembers, setFloor } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { getDmTurn, listOpenPendingRolls } from "@/lib/db/dm-turns";
import { listRecentWhispersForPrompt, listPendingPlayerWhispers } from "@/lib/db/dm-whispers";
import { getActiveEncounter, listActiveEncounters, listEnemies } from "@/lib/db/encounters";
import { listActiveFacts } from "@/lib/db/facts";
import { getCurrentLocation } from "@/lib/db/locations";
import { listMessagesInSeqRange, listRecentMessages } from "@/lib/db/messages";
import { listPublicCampaignNotes } from "@/lib/db/notes";
import { listRecentRolls } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { getSceneTracker } from "@/lib/db/scene-tracker";
import { consoleAdjudications } from "@/lib/dm/invoke-catalog";
import { invokeEngineSynchronous } from "@/lib/dm/invoke";
import { persistHumanNarration } from "@/lib/dm/human-narration";
import { executeNarratorCommand, NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";
import { completeGlobalTurn, startGlobalTurn } from "@/lib/dm/global-turn-logic";
import { listNarratorReceipts } from "@/lib/db/narrator-commands";
import { coverInEffect } from "@/lib/dm/delegation";
import { npcRosterForPrompt } from "@/lib/dm/social-tools";
import { answerAsk, listPendingAsksForCampaign, AskQueueConflict } from "@/lib/db/asks";
import { narratorSnapshots } from "@/lib/mcp-snapshot-cache.mjs";
import { budgetRead, ReadBudgetError } from "@/lib/mcp-read-budget.mjs";
import { listEventsSince, publishEphemeral, publishPersisted, publishUserEphemeral } from "@/lib/events";
import { buildOrchestrationSnapshot } from "../../shared/orchestration-snapshot.mjs";
export { NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";
const id = z.string().uuid();
const sectionDigest = z.string().regex(/^[a-f0-9]{64}$/);
const readSchema = z.object({
  campaignId: id, afterSeq: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50),
  afterAskSeq: z.number().int().min(0).default(0), askLimit: z.number().int().min(1).max(50).default(20),
  paged: z.boolean().default(false), pageCursor: z.string().max(500).optional(),
  maxBytes: z.number().int().min(4096).max(131072).default(65536), projection: z.enum(["full", "live"]).default("full"),
  delta: z.boolean().default(false), knownSeq: z.number().int().min(0).optional(),
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
  "move_party", "update_location", "travel", "pass_time", "start_scene", "scene_check", "end_scene", "request_roll", "request_player_input", "send_whisper", "record_event", "complete_beat", "write_campaign_note", "set_ambience", "play_sting",
  "set_npc", "npc_reaction", "social_check", "relationship_beat", "romance_advance", "relationship_end", "summon_pet", "pet_attack", "damage_pet", "dismiss_pet",
]);
function campaignOrHuman(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) throw new McpNarratorControlError("Campaign not found.", 404);
  if (campaign.gameSettings.dmMode !== "human" || !campaign.dmUserId || coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover)) throw new McpNarratorControlError("External narration requires a human-DM campaign with a DM seat.", 409);
  if (campaign.gameSettings.ttsEnabled || campaign.gameSettings.mapsEnabled) throw new McpNarratorControlError("External narration requires TTS and automatic maps to be disabled.", 409);
  return campaign;
}
function safeCampaign(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
  return {
    id: campaign.id, title: campaign.title, description: campaign.description, status: campaign.status, theme: campaign.theme, scene: campaign.scene, questLog: campaign.questLog,
    difficulty: campaign.difficulty, startingLevel: campaign.startingLevel, dmMode: campaign.gameSettings.dmMode, dmUserId: campaign.dmUserId,
    gameSettings: campaign.gameSettings, globalTurnState: campaign.globalTurnState, dmOutline: campaign.dmOutline, storyArc: campaign.storyArc, floor: campaign.floor, clock: campaign.clock, party: campaign.party,
  };
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
function read(raw: unknown) {
  const p = readSchema.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
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
  const fetched = listEventsSince(campaign.id, p.data.afterSeq, p.data.limit + 1);
  const spatial = readSpatialForNarrator(campaign.id, campaign.dmUserId!, p.data.afterSeq, p.data.limit);
  const { nextCursor, hasMore, events, roomMessages } = spatialNarratorBoundary({ afterSeq: p.data.afterSeq, currentSeq, limit: p.data.limit, events: fetched, spatial });
  const legacyMessages = nextCursor > p.data.afterSeq ? listMessagesInSeqRange(campaign.id, p.data.afterSeq + 1, nextCursor).filter(msg => !isOocMessage(msg)) : [];
  const messages = [...legacyMessages, ...roomMessages.map(message => ({
    ...message, campaignId: campaign.id, userId: message.authorUserId, characterId: null,
    authorType: message.kind === "narration" || message.kind === "perception" ? "dm" : "player", channel: "location" as const,
  }))].sort((a,b) => a.seq-b.seq);
  const askPage = listPendingAsksForCampaign(campaign.id, p.data.afterAskSeq, p.data.askLimit), live = p.data.projection === "live";
  const delta = Boolean(p.data.delta), baselineSeq = p.data.knownSeq ?? (delta ? p.data.afterSeq : 0);
  // Cheap, transactional source revisions precede mapping and content hashing.
  // User authorization, room audiences and current mechanics are never cached.
  const { sections, sectionVersions, omittedSections } = readNarratorSections({
    db: getDatabase(), campaignId: campaign.id, timelineEpoch, principal: campaign.dmUserId,
    live, delta, knownSections: p.data.knownSections,
    loaders: {
      sheets: () => listSheets(campaign.id), facts: () => listActiveFacts(campaign.id),
      notes: () => listPublicCampaignNotes(campaign.id, 20), npcs: () => npcRosterForPrompt(campaign.id, 100),
      recentMessages: () => listRecentMessages(campaign.id, 400).filter(msg => !isOocMessage(msg)),
      recentRolls: () => listRecentRolls(campaign.id, 100), chapters: () => listChapters(campaign.id),
    },
  });
  const receipts = listNarratorReceipts(campaign.id);
  const state = {
    campaign: safeCampaign(campaign), currentSeq, timelineEpoch, cursor: p.data.afterSeq, nextCursor, hasMore,
    events: events.filter(isNarratorEvent).map(event =>
      event.type === "roll_result" ||
      event.type === "global_turn_ready" ||
      event.type === "global_turn_narrator_trigger"
        ? { seq: event.seq, type: event.type, payload: event.payload }
        : { seq: event.seq, type: event.type },
    ),
    messages, spatial: spatial ? { enabled: true, instructions: SPATIAL_GUIDANCE } : { enabled: false }, spatialRooms: spatial?.rooms ?? [], spatialGrants: spatial?.grants ?? [],
    commands: delta && baselineSeq > 0 ? receipts.filter(receipt => receipt.committedSeq > baselineSeq) : receipts,
    summary: getCampaignSummaryState(campaign.id), members: listMembers(campaign.id), pendingRolls: listOpenPendingRolls(campaign.id),
    playerWhispers: listPendingPlayerWhispers(campaign.id), recentDmWhispers: live ? [] : listRecentWhispersForPrompt(campaign.id),
    omittedSections, asks: askPage.items, askQueue: { nextCursor: askPage.nextCursor, hasMore: askPage.hasMore },
    ...sections, sectionVersions, location: getCurrentLocation(campaign.id), sceneTracker: getSceneTracker(campaign.id),
    encounter: (() => { const encounter = getActiveEncounter(campaign.id); return encounter ? { encounter, enemies: listEnemies(encounter.id) } : null; })(),
    ...(delta ? { deltaState: { enabled: true, baselineSeq, pruned: ["sheets", "facts", "notes", "npcs"].every(key => omittedSections.includes(key)) } } : {}),
  };
  try {
    const result = budgetRead(state, p.data);
    if (p.data.paged && "nextPage" in result && result.nextPage && !narratorSnapshots.remember(state, cacheParams)) throw new McpNarratorControlError("Snapshot exceeds the bounded page cache; reduce the projection.", 413);
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
      ? { members: listMembers(campaign.id), sheets: listSheets(campaign.id) }
      : undefined,
    combat: sections.has("combat")
      ? listActiveEncounters(campaign.id)
          .filter(encounter => encounter.kind === "fight")
          .map(encounter => ({ encounter, enemies: listEnemies(encounter.id) }))
      : undefined,
    location: sections.has("location")
      ? { location: getCurrentLocation(campaign.id), sceneTracker: getSceneTracker(campaign.id) }
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
  const p = writeBase.extend({ name: z.string().trim().min(1).max(100), args: z.record(z.string(), z.unknown()).default({}), scopeRoomId: id.optional() }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  if (!EXTERNAL_NARRATOR_ACTIONS.has(p.data.name)) throw new McpNarratorControlError("That action is not available to an external narrator.", 403);
  if (p.data.scopeRoomId && (p.data.name !== "location_narrate" || p.data.args.roomId !== p.data.scopeRoomId)) throw new McpNarratorControlError("Room concurrency scope is only valid for location_narrate in that room.", 400);
  return serializedWrite(p.data, "narrator.invoke", { name: p.data.name, args: p.data.args, ...(p.data.scopeRoomId ? { scopeRoomId: p.data.scopeRoomId } : {}) }, campaign => {
    if (Object.hasOwn(SPATIAL_NARRATOR_OPERATIONS, p.data.name)) return invokeSpatialForNarrator(campaign.id, campaign.dmUserId!, p.data.name, p.data.args, p.data.commandId);
    const scoped = scopeBattleMapInvocation(campaign.id, campaign.dmUserId!, p.data.name, p.data.args);
    const outcome = invokeEngineSynchronous(campaign, { kind: "human", userId: campaign.dmUserId! }, { name: p.data.name, args: scoped.args });
    if (!outcome.ok) throw new McpNarratorControlError(outcome.error);
    if (scoped.roomId) bindActiveBattleMapToRoom(campaign.id, campaign.dmUserId!, scoped.roomId);
    return outcome;
  }, p.data.scopeRoomId ? (campaign, currentSeq) => unrelatedRoomChat(getDatabase(), {
    campaignId: campaign.id, dmUserId: campaign.dmUserId!, roomId: p.data.scopeRoomId!, afterSeq: p.data.expectedSeq, currentSeq,
  }) : undefined);
}
async function narrate(raw: unknown) {
  const p = writeBase.extend({
    content: z.string().trim().min(1).max(8000),
    turnId: id.optional(),
    releaseFloor: z.boolean().optional(),
    completeGlobalRound: z.number().int().min(1).optional(),
    startGlobalRound: z.number().int().min(1).optional(),
  }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(
    p.data,
    "narrator.narrate",
    {
      content: p.data.content,
      turnId: p.data.turnId,
      releaseFloor: p.data.releaseFloor,
      completeGlobalRound: p.data.completeGlobalRound,
      startGlobalRound: p.data.startGlobalRound,
    },
    campaign => {
    if (p.data.turnId) {
      const turn = getDmTurn(p.data.turnId);
      if (!turn || turn.campaignId !== campaign.id || turn.actor !== "human_dm") throw new McpNarratorControlError("Narration turn does not belong to this human-DM campaign.", 409);
    }
    if (spatialEnabled(campaign.id)) throw new McpNarratorControlError("Use narrator.invoke location_narrate with an explicit roomId for this campaign.", 409);
    if (p.data.releaseFloor) {
      const floor = getFloor(campaign.id);
      if (listOpenPendingRolls(campaign.id).length) throw new McpNarratorControlError("Resolve pending physical rolls before releasing the floor.", 409);
      if (floor.mode === "hold" && floor.combat?.requiresEndTurn && !floor.combat.mechanicsResolved) throw new McpNarratorControlError("Combat mechanics must finish before the floor can be released.", 409);
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
    const message = persistHumanNarration(campaign, p.data.content, campaign.dmUserId!);
    let floorResult;
    if (p.data.releaseFloor) {
      const current = getFloor(campaign.id);
      const floor = current.mode === "hold" && !current.combat ? current.next : current;
      setFloor(campaign.id, floor); publishPersisted(campaign.id, "floor_changed", { floor });
      queueSkippedCombatTurn(campaign.id);
      floorResult = { floorReleased: getFloor(campaign.id).mode !== "hold", floor: getFloor(campaign.id) };
    }
    let globalTurnResult;
    if (p.data.startGlobalRound !== undefined) {
      const started = startGlobalTurn(campaign.id, "opening_narration");
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
    return {
      messageId: message.id,
      ...(p.data.turnId ? { turnId: p.data.turnId } : {}),
      ...(floorResult ?? {}),
      ...(globalTurnResult ?? {}),
    };
  },
  );
}
async function releaseFloor(raw: unknown) {
  const p = writeBase.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.release_floor", {}, campaign => {
    const current = getFloor(campaign.id);
    if (listOpenPendingRolls(campaign.id).length) throw new McpNarratorControlError("Resolve pending physical rolls before releasing the floor.", 409);
    if (current.mode === "hold" && current.combat) throw new McpNarratorControlError("Combat adjudication is still in progress.", 409);
    const floor = current.mode === "hold" ? current.next : current;
    setFloor(campaign.id, floor); publishPersisted(campaign.id, "floor_changed", { floor });
    queueSkippedCombatTurn(campaign.id);
    return { floor: getFloor(campaign.id) };
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
      const p = z.object({ campaignId: id, paged: z.boolean().optional(), maxBytes: z.number().int().min(4096).max(131072).optional(), projection: z.enum(["full", "live"]).optional() }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      campaignOrHuman(p.data.campaignId);
      return { handled: true, result: { instructions: "Read odm://narrator/playbook. Call narrator.read, drain until hasMore is false, then use its currentSeq as expectedSeq for exactly one invoke, narrate, or release_floor. Persist a unique UUID commandId before each story write. After an ambiguous error, retry only the identical commandId, expectedSeq and payload to recover its receipt, never regenerate or modify a command. Consume the attached state after a confirmed write as its read, then drain any remaining pages/events. If readRequired is true, the write succeeded but its read failed: read again, never replay the effect. end_turn advances initiative itself; narration never advances it. For a private reply provide exact replyToWhisperIds from playerWhispers. With globalTurn enabled, the campaign starts locked: wait for global_turn_narrator_trigger, narrate the opening, and send startGlobalRound equal to its roundNumber; only that confirmed narration unlocks players. After that, collect player messages until global_turn_ready; resolve the whole batch through that event seq, then narrate with completeGlobalRound set to its roundNumber so the confirmed MCP write advances and opens the next round atomically. Do not narrate individual global-turn messages before the barrier. Check the pending asks queue on every read even when the story cursor is unchanged. Page it using afterAskSeq and askQueue.nextCursor; a fresh Ask scan may start at zero. answer_ask requires the pending ask version as expectedVersion and a persisted UUID commandId; it changes no story/floor state. For bounded reads use paged:true and drain pageCursor/nextPage before advancing the story cursor. Byte pages use a bounded frozen snapshot. Restart on expiry, a changed scope or timeline; never use incomplete pages. projection:live explicitly omits historical duplicate sections, not current state or new tool results. Carry the returned timelineEpoch on reads and writes; reconnect and discard incompatible pending work when it changes.", contractVersion: 3, timelineVersion: 1, features: { postWriteRead: true, frozenPages: true, liveDefaults: true }, state: read({ projection: "full", ...p.data }) } };
    }
    case "narrator.read": return { handled: true, result: read(raw) };
    case "narrator.snapshot": return { handled: true, result: orchestrationSnapshot(raw) };
    case "narrator.catalog": {
      const p = z.object({ summaryOnly: z.boolean().optional(), category: z.string().optional(), action: z.string().optional(), actionFilter: z.string().optional(), name: z.string().optional() }).optional().safeParse(raw);
      const options = p.success && p.data ? { summaryOnly: p.data.summaryOnly, category: p.data.category, action: p.data.action || p.data.actionFilter || p.data.name } : {};
      return { handled: true, result: { groups: catalog(options) } };
    }
    case "narrator.invoke": return { handled: true, result: await invoke(raw) };
    case "narrator.narrate": return { handled: true, result: await narrate(raw) };
    case "narrator.release_floor": return { handled: true, result: await releaseFloor(raw) };
    case "narrator.answer_ask": {
      const p = z.object({
        campaignId: id, askId: id, expectedVersion: z.number().int().min(0).default(0), commandId: id.optional(), expectedSeq: z.number().int().min(0).optional(),
        answer: z.string().trim().min(1).max(4000),
        citations: z.array(z.object({ kind: z.enum(["fact", "chapter", "scene", "summary", "npc", "place", "rule", "sheet", "recent"]), ref: z.string().max(300), quote: z.string().max(2000) }).strict()).max(50).default([]),
      }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      const campaign = campaignOrHuman(p.data.campaignId);
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
const storyWrites = new Set(["narrator.invoke", "narrator.narrate", "narrator.release_floor"]);
const readAfterSchema = z.union([z.boolean(), z.object({
  afterSeq: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
  afterAskSeq: z.number().int().min(0).optional(), askLimit: z.number().int().min(1).max(50).optional(),
  paged: z.boolean().optional(), projection: z.enum(["full", "live"]).optional(),
  maxBytes: z.number().int().min(4096).max(131072).optional(), delta: z.boolean().optional(),
  knownSeq: z.number().int().min(0).optional(), knownSections: readSchema.shape.knownSections,
}).strict()]);
export async function executeMcpNarratorControl(action: string, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown }> {
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
