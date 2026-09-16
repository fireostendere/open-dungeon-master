import {
  allocateSeq,
  getCampaignById,
  getCampaignSummaryState,
  getFloor,
  listMembers,
  setCampaignScene,
  setFloor,
  type Campaign,
} from "@/lib/db/campaigns";
import {
  createDmTurn,
  createPendingRoll,
  failStaleRunningTurns,
  getDmTurn,
  listPendingForTurn,
  publicPendingRoll,
  saveDmTurn,
  type DmTurn,
} from "@/lib/db/dm-turns";
import { DM_HALTED_PREFIX } from "@/lib/campaign-types";
import { PC_ATTACK_PARKED } from "@/lib/dm/pc-attack";
import { normalizeEventKind } from "@/lib/dm/arg-coerce";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getRoll, insertRoll, listRecentRolls } from "@/lib/db/rolls";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { removeConditions } from "@/lib/dm/condition-logic";
import { rollExpression } from "@/lib/dice";
import { publishEphemeral, publishPersisted, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import { createStreamingArtifactFilter, extractStoryText } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { fulfillMessageImage } from "@/lib/dm/images";
import { imageProducerReady } from "@/lib/image-generate";
import { enqueueNarrationAudio } from "@/lib/tts";
import { requestDmMessage } from "@/lib/dm/model";
import { setDmStatus } from "@/lib/dm/status";
import {
  extractToolCalls,
  resolveRollExpression,
  resolveSheetRef,
  rollArgsSchema,
  salvageProseRollAsks,
  salvageTextualToolCalls,
  salvageXmlToolCalls,
  type RollArgs,
} from "@/lib/dm/rolls";
import { fakeRollMarkerRegex } from "@/lib/dm/tool-text";
import { announcesEncounterStart, FAKE_ENCOUNTER_PROMPT } from "@/lib/dm/engine-boundary";
import { handleCompleteBeat } from "@/lib/dm/arc";
import { enforceEngineBoundary } from "@/lib/dm/narration-guard";
import {
  buildDmMessages,
  type DmGameState,
  completeBeatTool,
  movePartyTool,
  recallStoryTool,
  recordEventTool,
  requestPlayerInputTool,
  requestRollTool,
  sendWhisperTool,
  updateLocationTool,
} from "@/lib/dm/prompt";
import {
  deliverWhisper,
  FALLBACK_WHISPER_MESSAGE,
  handleSendWhisper,
  WHISPER_CAP_PER_TURN,
} from "@/lib/dm/whispers";
import {
  listPendingPlayerWhispers,
  listRecentWhispersForPrompt,
  markPlayerWhispersAnswered,
} from "@/lib/db/dm-whispers";
import { listChapters } from "@/lib/db/chapters";
import { listPublicCampaignNotes } from "@/lib/db/notes";
import { listActiveFacts } from "@/lib/db/facts";
import { consumePendingSparks, tickWorldState } from "@/lib/dm/world-tick";
import { buildDirectorBlock } from "@/lib/dm/director-logic";
import { takeDirectorArm } from "@/lib/db/director-arms";
import { listPins } from "@/lib/db/pins";
import { isStageEnabled } from "@/lib/dm/stages";
import { renderVariantRules } from "@/lib/dm/rules-logic";
import { dmThinkingEnabled } from "@/lib/model-client";
import { resolvedStoryContextTokens } from "@/lib/dm/context-limit";
import { restoreMentionedNpcs } from "@/lib/dm/npc-archive";
import { handleRecallStory } from "@/lib/dm/recall";
import { handleSearchLore, searchLoreTool } from "@/lib/dm/lore-search";
import { handleWriteCampaignNote, writeCampaignNoteTool } from "@/lib/dm/note-tools";
import { buildTurnRetrieval } from "@/lib/dm/context-retrieval";
import { maybeProposeItemChange } from "@/lib/dm/proposal-intercept";
import { maybeCloseChapter } from "@/lib/dm/chapter-close";
import {
  hasRecentIdenticalEvent,
  insertCharacterEvent,
  listRecentEventsForCampaign,
  CHARACTER_EVENT_KINDS,
  type CharacterEventKind,
} from "@/lib/db/character-events";
import { enqueueLocationMap } from "@/lib/dm/maps";
import {
  getCurrentLocation,
  listLocations,
  updateCurrentLocationDetails,
  upsertCurrentLocation,
} from "@/lib/db/locations";
import { maybeCompactHistory } from "@/lib/dm/compaction";
import { createDeltaBatcher } from "@/lib/dm/delta-buffer";
import {
  applyDmMutation,
  MUTATION_CAP_PER_TURN,
  MUTATION_TOOL_NAMES,
  mutationTools,
} from "@/lib/dm/mutations";
import { describeBudget } from "@/lib/dm/action-budget";
import { castBuffTool, handleCastBuff } from "@/lib/dm/cast-tools";
import {
  advanceAfterTurn,
  applyEncounterCall,
  ENCOUNTER_CAP_PER_TURN,
  ENCOUNTER_TOOL_NAMES,
  encounterTools,
  ensureInitiativeProgress,
  recordInitiativeRoll,
} from "@/lib/dm/encounter-tools";
import { autoApplyDamageRoll } from "@/lib/dm/enemy-damage";
import { handleTakeRest, restTools } from "@/lib/dm/rest-tools";
import {
  checkTools,
  CHECK_TOOL_NAMES,
  handleCheckNotice,
  handleGroupCheck,
} from "@/lib/dm/check-tools";
import { hazardTools, HAZARD_TOOL_NAMES, handleApplyHazard } from "@/lib/dm/hazard-tools";
import {
  handleSplitDamage,
  splitDamageTool,
  SPLIT_DAMAGE_TOOL_NAMES,
} from "@/lib/dm/split-damage";
import { allySaveAura } from "@/lib/dm/aura";
import {
  petTools,
  PET_TOOL_NAMES,
  handleSummonPet,
  handlePetAttack,
  handleDamagePet,
  handleDismissPet,
} from "@/lib/dm/pet-tools";
import {
  socialTools,
  SOCIAL_TOOL_NAMES,
  handleSetNpc,
  handleNpcReaction,
  handleSocialCheck,
  npcRosterForPrompt,
} from "@/lib/dm/social-tools";
import {
  relationshipTools,
  RELATIONSHIP_TOOL_NAMES,
  handleRelationshipBeat,
  handleRomanceAdvance,
  handleRelationshipEnd,
  relationshipRosterForPrompt,
} from "@/lib/dm/relationship-tools";
import { handlePartyStash, PARTY_TOOL_NAMES, partyTools } from "@/lib/dm/party-tools";
import {
  handleEndScene,
  handleSceneCheck,
  handleStartScene,
  SCENE_TOOL_NAMES,
  sceneTools,
} from "@/lib/dm/scene-tools";
import {
  AMBIENCE_TOOL_NAMES,
  ambienceTools,
  followSceneAmbience,
  handlePlaySting,
  handleSetAmbience,
} from "@/lib/dm/ambience-tools";
import {
  handleDismount,
  handleMountUp,
  MOUNT_TOOL_NAMES,
  mountTools,
} from "@/lib/dm/mount-tools";
import {
  effectTools,
  EFFECT_TOOL_NAMES,
  handleClearEffect,
  handleSetEffect,
  rollEffectExtras,
} from "@/lib/dm/effect-tools";
import {
  handlePassTime,
  worldTools,
  WORLD_TOOL_NAMES,
  handleRollTreasure,
  handleDamageObject,
  handleTravel,
} from "@/lib/dm/world-tools";
import {
  applyCompanionCall,
  COMPANION_TOOL_NAMES,
  companionTools,
} from "@/lib/dm/companion-tools";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getBattleMapForEncounter, listTokens } from "@/lib/db/battle-maps";
import { serializeMapForPrompt } from "@/lib/battlemap/serialize";
import { suggestEnemies } from "@/lib/bestiary";
import { extraBlockLines } from "@/lib/bestiary/block-sections";
import {
  getDmInputWatermark,
  markDmInputsIncluded,
  maxDmInputSeq,
} from "@/lib/dm/input-watermark";
import { executeToolOnce } from "@/lib/dm/tool-execution";

const MUTATION_NAMES = new Set<string>(MUTATION_TOOL_NAMES);
const ENCOUNTER_NAMES = new Set<string>(ENCOUNTER_TOOL_NAMES);

export const MAX_MODEL_CALLS = 4;

const ATTACK_OUTCOME_TOOLS = new Set([
  "pc_attack",
  "cast_at_enemy",
  "enemy_attack",
  "damage_enemy",
  "aoe_damage",
]);

type TurnContext = {
  campaign: Campaign;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
};

type ToolCallLike = {
  id?: string;
  name: string;
  rawArguments: string;
};

function buildEncounterState(campaignId: string, sheets: CharacterSheet[]) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) return null;
  const enemies = listEnemies(encounter.id);
  const staged = new Set(
    encounter.order
      .filter((entry) => entry.kind === "pc")
      .map((entry) => (entry.kind === "pc" ? entry.characterId : "")),
  );
  return {
    round: encounter.round,
    orderReady: encounter.orderReady,
    order: encounter.orderReady
      ? encounter.order.map((entry, index) => ({ name: entry.name, current: index === encounter.turnIndex }))
      : [],
    awaitingInitiative: encounter.orderReady
      ? []
      : sheets.filter((sheet) => !staged.has(sheet.id)).map((sheet) => sheet.name),
    turnBudget: encounter.turnBudget ? describeBudget(encounter.turnBudget) : null,
    enemies: enemies.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      ac: enemy.ac,
      status: enemy.status,
      conditions: enemy.conditions.map((condition) => {
        const meta = enemy.conditionMeta[condition];
        if (meta?.rounds) return `${condition} (${meta.rounds} more round${meta.rounds === 1 ? "" : "s"})`;
        if (meta?.saveEnds) return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
        return condition;
      }),
      attacks: enemy.stats.attacks,
      traits: [...enemy.stats.traits, ...extraBlockLines(enemy.stats)],
      resist: enemy.stats.resist,
      immune: enemy.stats.immune,
      vulnerable: enemy.stats.vulnerable,
      concentration: enemy.concentration,
    })),
    map: buildMapText(encounter.id, sheets),
  };
}

function buildMapText(encounterId: string, sheets: CharacterSheet[]): string | null {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) return null;
  const statuses = new Map<string, string>();
  for (const sheet of sheets) {
    if (sheet.deathSaves?.dead) statuses.set(sheet.id, "DEAD");
    else if (sheet.deathSaves?.stable) statuses.set(sheet.id, "STABLE at 0 HP");
    else if (sheet.currentHp <= 0) statuses.set(sheet.id, "DYING at 0 HP");
  }
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status === "alive" && enemy.conditions.length) statuses.set(enemy.id, enemy.conditions.join(", "));
  }
  return serializeMapForPrompt({ ...map, terrain: map.drawnTerrain }, listTokens(map.id), statuses);
}

function loadContext(campaign: Campaign): TurnContext {
  const sheets = listSheets(campaign.id);
  const members = listMembers(campaign.id);
  const realDiceUserIds = campaign.gameSettings.dicePolicy === "real_allowed"
    ? new Set(members.filter((member) => member.useRealDice).map((member) => member.userId))
    : new Set<string>();
  return { campaign, sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds };
}

export async function startDmTurn(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") return;
  failStaleRunningTurns(campaignId);

  const history = listRecentMessages(campaignId, 400);
  const pendingWhispers = listPendingPlayerWhispers(campaignId);
  const maxInputSeq = maxDmInputSeq(history);
  const inputWatermark = getDmInputWatermark(campaignId);
  if (
    history.length &&
    history[history.length - 1].authorType === "dm" &&
    !pendingWhispers.length &&
    maxInputSeq <= inputWatermark
  ) {
    setDmStatus(campaignId, "idle");
    return;
  }

  setDmStatus(campaignId, "thinking");
  const context = loadContext(campaign);
  ensureInitiativeProgress(campaign);
  const { summary } = getCampaignSummaryState(campaignId);
  const currentLocation = getCurrentLocation(campaignId);
  restoreMentionedNpcs(campaignId, history.slice(-4).map((entry) => entry.content).join("\n"));

  const stages = campaign.gameSettings.stages;
  const retrieval = isStageEnabled(stages, "retrieval")
    ? await buildTurnRetrieval(campaign, history)
    : { variantRulesBlock: renderVariantRules(campaign.gameSettings.variantRules), houseRulesBlock: "", loreBlock: "" };
  const directorArm = takeDirectorArm(campaignId);
  const directorBlock = buildDirectorBlock(directorArm);
  if (directorArm) {
    publishPersisted(campaignId, "director_armed", { armed: false, oneShot: null, absoluteCommand: "" });
  }
  const promptState: DmGameState = {
    campaign,
    contextLimitTokens: resolvedStoryContextTokens(campaign.settings),
    variantRulesBlock: retrieval.variantRulesBlock,
    houseRulesBlock: retrieval.houseRulesBlock,
    loreBlock: retrieval.loreBlock,
    members: listMembers(campaignId),
    sheets: context.sheets,
    encounter: buildEncounterState(campaignId, context.sheets),
    enemySuggestions: suggestEnemies(campaign.gameSettings, context.sheets.map((sheet) => sheet.level), 10),
    recentRolls: listRecentRolls(campaignId, 5),
    storySummary: summary,
    currentLocation: currentLocation
      ? { name: currentLocation.name, layoutDescription: currentLocation.layoutDescription, connections: currentLocation.connections }
      : null,
    visitedLocationNames: listLocations(campaignId).filter((location) => location.visited).map((location) => location.name).slice(0, 15),
    recentEventsByCharacter: new Map(
      [...listRecentEventsForCampaign(campaignId, 3)].map(([characterId, events]) => [characterId, events.map((event) => event.summary)]),
    ),
    pins: listPins(campaignId).map((pin) => ({ text: pin.text })),
    chapters: listChapters(campaignId)
      .filter((chapter) => chapter.status === "closed")
      .map((chapter) => ({ id: chapter.id, index: chapter.index, title: chapter.title, oneLiner: chapter.highlights[0] ?? "", summary: chapter.summary || chapter.highlights[0] || "" })),
    publicNotes: listPublicCampaignNotes(campaignId, 10).map((note) => ({ pinned: note.pinned, title: note.title, body: note.body })),
    facts: listActiveFacts(campaignId).map((fact) => ({ category: fact.category, subject: fact.subject, fact: fact.fact, pinned: fact.pinned, knownBy: fact.knownBy })),
    directorNotes: consumePendingSparks(campaignId).map((spark) => spark.text),
    directorBlock,
    npcs: npcRosterForPrompt(campaignId),
    relationships: campaign.gameSettings.relationships === "off" ? [] : relationshipRosterForPrompt(campaignId),
    recentWhispers: listRecentWhispersForPrompt(campaignId, 10),
    pendingPlayerWhispers: pendingWhispers.map((whisper) => ({ from: whisper.characterName, content: whisper.content })),
  };
  const conversation = buildDmMessages(promptState, history);
  const turn = createDmTurn(campaignId, conversation);
  turn.contextTrace = promptState.contextTrace ?? null;
  turn.playerWhisperIds = pendingWhispers.map((whisper) => whisper.id);
  // The watermark records exactly the inbound messages that were present when
  // this prompt was built. An action that arrives while the model is running
  // has a larger seq and therefore forces the already-queued follow-up turn
  // even if the previous DM reply is now the last chat message.
  markDmInputsIncluded(campaignId, maxInputSeq);
  saveDmTurn(turn);
  await advance(context, turn);
}

export async function resumeDmTurn(campaignId: string, turnId: string) {
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  if (!campaign || campaign.status !== "active" || !turn || turn.status !== "awaiting_rolls") return;
  const pendings = listPendingForTurn(turnId);
  if (pendings.some((pending) => pending.status === "pending")) return;

  for (const pending of pendings) {
    const roll = pending.rollId ? getRoll(pending.rollId) : null;
    if (!roll) continue;
    if (!turn.rollIds.includes(roll.id)) turn.rollIds.push(roll.id);
    turn.conversation.push({
      role: "tool",
      ...(pending.toolCallId ? { tool_call_id: pending.toolCallId } : {}),
      content: JSON.stringify({
        total: roll.total,
        dice: roll.breakdown.terms,
        ...(pending.dc !== null ? { dc: pending.dc, success: roll.total >= pending.dc } : {}),
        ...(roll.breakdown.crit ? { crit: roll.breakdown.crit } : {}),
        rolledBy: pending.status === "submitted" ? "the player, with physical dice" : "the server",
        note: "Narrate this real result. Do not roll again for the same action.",
        ...(pending.combatNote ? { combat: pending.combatNote } : {}),
      }),
    });
  }

  const context = loadContext(campaign);
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    const mapText = buildMapText(encounter.id, context.sheets);
    if (mapText) turn.conversation.push({ role: "user", content: `[GAME STATE UPDATE] Combatants may have moved while you waited on rolls. Current battle map (authoritative, replaces the one above):\n${mapText}` });
  }
  turn.status = "running";
  saveDmTurn(turn);
  setDmStatus(campaignId, "narrating");
  await advance(context, turn);
}

export async function reenterDmTurn(campaign: Campaign, turn: DmTurn) {
  await advance(loadContext(campaign), turn);
}

async function advance(context: TurnContext, turn: DmTurn) {
  try {
    await runAdvance(context, turn);
  } catch (error) {
    console.error("[dm-turn] advance failed", error);
    if (turn.status === "running") finalize(context, turn, "The Dungeon Master hit an internal error and had to stop this turn.");
    else setDmStatus(context.campaign.id, "idle");
  }
}

async function runAdvance(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets, sheetsById, realDiceUserIds } = context;
  const campaignId = campaign.id;
  let failed = "";
  let spotlightSet = false;
  const imageEnabled = campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  const leanTools = process.env.DM_LEAN_TOOLS === "1";
  let beatCompleted = false;
  let whisperCount = 0;
  let noteCount = 0;
  let encounterNudged = false;

  while (turn.callIndex < MAX_MODEL_CALLS) {
    const finalCall = turn.callIndex === MAX_MODEL_CALLS - 1;
    const inEncounter = Boolean(getActiveEncounter(campaignId));
    const tools = [
      requestRollTool,
      requestPlayerInputTool,
      movePartyTool,
      updateLocationTool,
      recordEventTool,
      ...(isStageEnabled(campaign.gameSettings.stages, "recall") ? [recallStoryTool] : []),
      searchLoreTool,
      writeCampaignNoteTool,
      sendWhisperTool,
      ...(campaign.storyArc ? [completeBeatTool] : []),
      ...checkTools,
      ...hazardTools,
      ...(inEncounter ? [splitDamageTool] : []),
      ...petTools,
      ...socialTools,
      ...(inEncounter ? [] : relationshipTools(campaign)),
      ...(inEncounter ? [] : worldTools),
      ...(inEncounter ? [] : partyTools),
      ...effectTools,
      ...(inEncounter ? [] : sceneTools),
      ...(campaign.gameSettings.ambienceEnabled ? ambienceTools : []),
      ...(inEncounter ? [] : mountTools),
      ...encounterTools(inEncounter),
      castBuffTool,
      ...(inEncounter ? [] : restTools),
      ...companionTools(campaign),
      ...(leanTools ? [] : mutationTools),
      ...(imageEnabled ? [generateImageTool] : []),
    ];
    const filter = createStreamingArtifactFilter();
    const batcher = createDeltaBatcher((text) => publishEphemeral(campaignId, "dm_delta", { text }));
    const { message, error } = await requestDmMessage(campaign.settings, turn.conversation, {
      tools,
      toolChoice: finalCall ? "none" : "auto",
      thinking: !finalCall && dmThinkingEnabled(),
      onDelta: (text) => {
        const visible = filter.push(text);
        if (visible) batcher.push(visible);
      },
    });

    if (error) {
      batcher.flush();
      const payload = (await error.json().catch(() => null)) as { error?: string } | null;
      failed = payload?.error || "The Dungeon Master could not reach the model backend.";
      break;
    }
    batcher.push(filter.flush());
    batcher.flush();
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] call ${turn.callIndex}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`);
    }
    turn.callIndex += 1;

    const xmlSalvage = salvageXmlToolCalls(extractStoryText(message?.content));
    const salvage = salvageTextualToolCalls(xmlSalvage.text);
    const alreadyRolls = [...extractToolCalls(message?.tool_calls), ...xmlSalvage.calls, ...salvage.calls].some((toolCall) => toolCall.name === "request_roll");
    const proseRolls = finalCall || alreadyRolls ? { text: salvage.text, calls: [] } : salvageProseRollAsks(salvage.text, sheets);
    const salvagedCalls = [...xmlSalvage.calls, ...salvage.calls, ...proseRolls.calls];
    const visibleText = proseRolls.text;
    const echoedToolCalls = salvagedCalls.length
      ? [
          ...(Array.isArray(message?.tool_calls) ? message.tool_calls : []),
          ...salvagedCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.rawArguments } })),
        ]
      : message?.tool_calls;
    const toolCalls = [...extractToolCalls(message?.tool_calls), ...salvagedCalls] as ToolCallLike[];
    const calledAttackTool = toolCalls.some((toolCall) => ATTACK_OUTCOME_TOOLS.has(toolCall.name));
    const narration = (visibleText ?? "").replace(fakeRollMarkerRegex(), "").trim();
    if (narration && !calledAttackTool) turn.narrationParts.push(narration);

    const stableToolId = (call: ToolCallLike) => call.id ?? `call-${turn.callIndex - 1}-${toolCalls.indexOf(call)}-${call.name}`;
    const once = <T extends Record<string, unknown>>(call: ToolCallLike, fn: () => T): T =>
      executeToolOnce({ turnId: turn.id, toolCallId: stableToolId(call), toolName: call.name }, fn);

    // Persist the assistant tool-call envelope before any side effect. Every
    // stateful handler below records its result in the same SQLite transaction
    // as its mutation; a crash can therefore be replayed from the journal
    // without executing the mutation twice.
    if (toolCalls.length > 0) {
      turn.conversation.push({ role: "assistant", content: visibleText || "", tool_calls: echoedToolCalls });
      saveDmTurn(turn);
    }

    const rollCalls = toolCalls.filter((toolCall) => toolCall.name === "request_roll");
    const inputCalls = toolCalls.filter((toolCall) => toolCall.name === "request_player_input");
    const mutationCalls = toolCalls.filter((toolCall) => MUTATION_NAMES.has(toolCall.name));
    const encounterCalls = toolCalls.filter((toolCall) => ENCOUNTER_NAMES.has(toolCall.name));
    const castBuffCalls = toolCalls.filter((toolCall) => toolCall.name === "cast_buff");
    const restCalls = toolCalls.filter((toolCall) => toolCall.name === "take_rest");
    const companionCalls = toolCalls.filter((toolCall) => COMPANION_TOOL_NAMES.has(toolCall.name));
    const locationCalls = toolCalls.filter((toolCall) => toolCall.name === "move_party" || toolCall.name === "update_location");
    const eventCalls = toolCalls.filter((toolCall) => toolCall.name === "record_event");
    const beatCalls = toolCalls.filter((toolCall) => toolCall.name === "complete_beat");
    const recallCalls = toolCalls.filter((toolCall) => toolCall.name === "recall_story");
    const searchLoreCalls = toolCalls.filter((toolCall) => toolCall.name === "search_lore");
    const noteCalls = toolCalls.filter((toolCall) => toolCall.name === "write_campaign_note");
    const whisperCalls = toolCalls.filter((toolCall) => toolCall.name === "send_whisper");
    const checkCalls = toolCalls.filter((toolCall) => (CHECK_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const hazardCalls = toolCalls.filter((toolCall) => (HAZARD_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const splitCalls = toolCalls.filter((toolCall) => (SPLIT_DAMAGE_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const petCalls = toolCalls.filter((toolCall) => (PET_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const socialCalls = toolCalls.filter((toolCall) => (SOCIAL_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const socialRollCalls = socialCalls.filter((toolCall) => toolCall.name !== "set_npc");
    const setNpcCalls = socialCalls.filter((toolCall) => toolCall.name === "set_npc");
    const relationshipCalls = toolCalls.filter((toolCall) => (RELATIONSHIP_TOOL_NAMES as readonly string[]).includes(toolCall.name));
    const worldCalls = toolCalls.filter(
      (toolCall) =>
        (WORLD_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (PARTY_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (EFFECT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (SCENE_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (MOUNT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (AMBIENCE_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );

    const locationResults = new Map<string, Record<string, unknown>>();
    for (const locationCall of locationCalls) {
      const result = once(locationCall, () => handleLocationCall(campaign, locationCall.name, locationCall.rawArguments));
      if (result.movedToNewLocation) {
        delete result.movedToNewLocation;
        if (result._mapAvailable && typeof result._locationId === "string") turn.locationId = result._locationId;
      }
      delete result._locationId;
      delete result._mapAvailable;
      locationResults.set(stableToolId(locationCall), result);
    }
    const recallResults = new Map<string, Record<string, unknown>>();
    for (const recallCall of recallCalls) recallResults.set(stableToolId(recallCall), await handleRecallStory(campaignId, recallCall.rawArguments));
    const searchLoreResults = new Map<string, Record<string, unknown>>();
    for (const searchLoreCall of searchLoreCalls) searchLoreResults.set(stableToolId(searchLoreCall), await handleSearchLore(campaignId, searchLoreCall.rawArguments));

    const noteResults = new Map<string, Record<string, unknown>>();
    for (const noteCall of noteCalls) {
      const result = once(noteCall, () => {
        if (noteCount >= 1) return { error: "Note limit reached for this turn." };
        const outcome = handleWriteCampaignNote(campaign, noteCall.rawArguments);
        if (!("error" in outcome)) noteCount += 1;
        return outcome;
      });
      noteResults.set(stableToolId(noteCall), result);
    }
    const eventResults = new Map<string, Record<string, unknown>>();
    for (const eventCall of eventCalls) eventResults.set(stableToolId(eventCall), once(eventCall, () => handleRecordEvent(campaign, eventCall.rawArguments, sheets, sheetsById)));
    const beatResults = new Map<string, Record<string, unknown>>();
    for (const beatCall of beatCalls) {
      const raw = once(beatCall, () => {
        const outcome = handleCompleteBeat(campaignId, beatCall.rawArguments, beatCompleted);
        return { ...outcome.result, __completed: outcome.completed };
      });
      beatCompleted = beatCompleted || raw.__completed === true;
      const { __completed: _completed, ...clean } = raw;
      beatResults.set(stableToolId(beatCall), clean);
    }
    const whisperResults = new Map<string, Record<string, unknown>>();
    for (const whisperCall of whisperCalls) {
      const result = once(whisperCall, () => {
        if (whisperCount >= WHISPER_CAP_PER_TURN) return { error: "Whisper limit reached for this turn." };
        const outcome = handleSendWhisper(campaign, turn.id, whisperCall.rawArguments, sheets, sheetsById);
        if (!("error" in outcome)) whisperCount += 1;
        return outcome;
      });
      if (!("error" in result)) {
        for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
          if (!turn.answeredWhisperCharacterIds.includes(characterId)) turn.answeredWhisperCharacterIds.push(characterId);
        }
      }
      whisperResults.set(stableToolId(whisperCall), result);
    }
    if (!turn.imageArgs) {
      const parsedImage = parseGenerateImageToolCall(echoedToolCalls);
      if (parsedImage?.prompt) turn.imageArgs = { prompt: parsedImage.prompt, reason: parsedImage.reason };
    }

    const inputResults = new Map<string, Record<string, unknown>>();
    for (const inputCall of inputCalls) {
      const result = once(inputCall, () => handleRequestPlayerInput(campaign, inputCall.rawArguments, sheets, sheetsById));
      inputResults.set(stableToolId(inputCall), result);
      if (result.ok === true) spotlightSet = true;
    }

    // Every recognized stateful call must reach its handler before this loop
    // may terminate. These four were the omissions that allowed cast_buff,
    // split_damage and set_npc/request_player_input to be silently skipped.
    const needsFollowUp =
      rollCalls.length > 0 ||
      inputCalls.length > 0 ||
      castBuffCalls.length > 0 ||
      splitCalls.length > 0 ||
      setNpcCalls.length > 0 ||
      checkCalls.length > 0 ||
      hazardCalls.length > 0 ||
      petCalls.length > 0 ||
      socialRollCalls.length > 0 ||
      relationshipCalls.length > 0 ||
      worldCalls.length > 0 ||
      mutationCalls.length > 0 ||
      encounterCalls.length > 0 ||
      restCalls.length > 0 ||
      companionCalls.length > 0 ||
      recallCalls.length > 0 ||
      searchLoreCalls.length > 0 ||
      ((locationCalls.length > 0 || eventCalls.length > 0 || whisperCalls.length > 0 || noteCalls.length > 0) && !turn.narrationParts.length);

    if (!needsFollowUp) {
      saveDmTurn(turn);
      if (!finalCall && !encounterNudged && !inEncounter && narration && turn.narrationParts[turn.narrationParts.length - 1] === narration && announcesEncounterStart(narration)) {
        encounterNudged = true;
        turn.narrationParts.pop();
        // No tools means the assistant envelope was not persisted above.
        if (!toolCalls.length) turn.conversation.push({ role: "assistant", content: visibleText || "", tool_calls: echoedToolCalls });
        turn.conversation.push({ role: "user", content: FAKE_ENCOUNTER_PROMPT });
        saveDmTurn(turn);
        continue;
      }
      if (spotlightSet && !turn.narrationParts.length && !finalCall) {
        for (const inputCall of inputCalls) {
          turn.conversation.push({
            role: "tool",
            ...(inputCall.id ? { tool_call_id: inputCall.id } : {}),
            content: JSON.stringify(inputResults.get(stableToolId(inputCall)) ?? { ok: true, note: "The floor is theirs. Narrate the moment and stop." }),
          });
        }
        continue;
      }
      break;
    }
    if (finalCall) {
      saveDmTurn(turn);
      break;
    }

    setDmStatus(campaignId, "rolling");

    for (const inputCall of inputCalls) {
      turn.conversation.push({ role: "tool", ...(inputCall.id ? { tool_call_id: inputCall.id } : {}), content: JSON.stringify(inputResults.get(stableToolId(inputCall)) ?? { error: "Input request was not applied." }) });
    }
    for (const locationCall of locationCalls) {
      turn.conversation.push({ role: "tool", ...(locationCall.id ? { tool_call_id: locationCall.id } : {}), content: JSON.stringify(locationResults.get(stableToolId(locationCall)) ?? { ok: true }) });
    }
    for (const eventCall of eventCalls) {
      turn.conversation.push({ role: "tool", ...(eventCall.id ? { tool_call_id: eventCall.id } : {}), content: JSON.stringify(eventResults.get(stableToolId(eventCall)) ?? { ok: true }) });
    }
    for (const beatCall of beatCalls) {
      turn.conversation.push({ role: "tool", ...(beatCall.id ? { tool_call_id: beatCall.id } : {}), content: JSON.stringify(beatResults.get(stableToolId(beatCall)) ?? { ok: true }) });
    }
    for (const recallCall of recallCalls) {
      turn.conversation.push({ role: "tool", ...(recallCall.id ? { tool_call_id: recallCall.id } : {}), content: JSON.stringify(recallResults.get(stableToolId(recallCall)) ?? { ok: true }) });
    }
    for (const searchLoreCall of searchLoreCalls) {
      turn.conversation.push({ role: "tool", ...(searchLoreCall.id ? { tool_call_id: searchLoreCall.id } : {}), content: JSON.stringify(searchLoreResults.get(stableToolId(searchLoreCall)) ?? { ok: true }) });
    }
    for (const noteCall of noteCalls) {
      turn.conversation.push({ role: "tool", ...(noteCall.id ? { tool_call_id: noteCall.id } : {}), content: JSON.stringify(noteResults.get(stableToolId(noteCall)) ?? { ok: true }) });
    }
    for (const whisperCall of whisperCalls) {
      turn.conversation.push({ role: "tool", ...(whisperCall.id ? { tool_call_id: whisperCall.id } : {}), content: JSON.stringify(whisperResults.get(stableToolId(whisperCall)) ?? { ok: true }) });
    }

    let parkedAny = false;
    for (const encounterCall of encounterCalls) {
      const result = once(encounterCall, () => {
        if (turn.encounterCount >= ENCOUNTER_CAP_PER_TURN) return { error: "Encounter action limit reached for this turn." };
        const outcome = applyEncounterCall(campaign, turn, encounterCall.name, encounterCall.rawArguments, sheets, sheetsById, { realDiceUserIds, toolCallId: encounterCall.id ?? null }).result;
        if (!("error" in outcome)) turn.encounterCount += 1;
        return outcome;
      });
      if (result[PC_ATTACK_PARKED]) {
        parkedAny = true;
        continue;
      }
      turn.conversation.push({ role: "tool", ...(encounterCall.id ? { tool_call_id: encounterCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const companionCall of companionCalls) {
      const result = once(companionCall, () => applyCompanionCall(campaign, companionCall.name, companionCall.rawArguments, listSheets(campaignId)));
      if (!("error" in result)) {
        const fresh = listSheets(campaignId);
        sheets.length = 0;
        sheets.push(...fresh);
        sheetsById.clear();
        for (const freshSheet of fresh) sheetsById.set(freshSheet.id, freshSheet);
      }
      turn.conversation.push({ role: "tool", ...(companionCall.id ? { tool_call_id: companionCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const castBuffCall of castBuffCalls) {
      const result = once(castBuffCall, () => handleCastBuff(campaign, turn, castBuffCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({ role: "tool", ...(castBuffCall.id ? { tool_call_id: castBuffCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const restCall of restCalls) {
      const result = once(restCall, () => handleTakeRest(campaign, turn.id, restCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({ role: "tool", ...(restCall.id ? { tool_call_id: restCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const mutationCall of mutationCalls) {
      const result = once(mutationCall, () => {
        if (turn.mutationCount >= MUTATION_CAP_PER_TURN) return { error: "Mutation limit reached for this turn." };
        const proposed = maybeProposeItemChange(campaign, turn.id, mutationCall.name, mutationCall.rawArguments, sheetsById);
        const outcome = proposed ?? applyDmMutation(campaign, turn.id, mutationCall.name, mutationCall.rawArguments, sheets, sheetsById).result;
        if (!("error" in outcome)) turn.mutationCount += 1;
        return outcome;
      });
      turn.conversation.push({ role: "tool", ...(mutationCall.id ? { tool_call_id: mutationCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const checkCall of checkCalls) {
      const result = once(checkCall, () => checkCall.name === "group_check"
        ? handleGroupCheck(campaign, turn, checkCall.rawArguments, sheets, sheetsById)
        : handleCheckNotice(campaign, checkCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({ role: "tool", ...(checkCall.id ? { tool_call_id: checkCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const hazardCall of hazardCalls) {
      const result = once(hazardCall, () => handleApplyHazard(campaign, turn, hazardCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({ role: "tool", ...(hazardCall.id ? { tool_call_id: hazardCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const splitCall of splitCalls) {
      const result = once(splitCall, () => handleSplitDamage(campaign, turn, splitCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({ role: "tool", ...(splitCall.id ? { tool_call_id: splitCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const petCall of petCalls) {
      const result = once(petCall, () => {
        if (petCall.name === "summon_pet") return handleSummonPet(campaign, turn, petCall.rawArguments, sheets, sheetsById);
        if (petCall.name === "pet_attack") return handlePetAttack(campaign, turn, petCall.rawArguments, sheets, sheetsById);
        if (petCall.name === "damage_pet") return handleDamagePet(campaign, petCall.rawArguments, sheets, sheetsById);
        return handleDismissPet(campaign, petCall.rawArguments, sheets, sheetsById);
      });
      turn.conversation.push({ role: "tool", ...(petCall.id ? { tool_call_id: petCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const socialCall of socialCalls) {
      const result = once(socialCall, () => {
        if (socialCall.name === "set_npc") return handleSetNpc(campaign, socialCall.rawArguments);
        if (socialCall.name === "npc_reaction") return handleNpcReaction(campaign, turn, socialCall.rawArguments);
        return handleSocialCheck(campaign, turn, socialCall.rawArguments, sheets, sheetsById);
      });
      turn.conversation.push({ role: "tool", ...(socialCall.id ? { tool_call_id: socialCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const relationshipCall of relationshipCalls) {
      const result = once(relationshipCall, () => {
        if (relationshipCall.name === "relationship_beat") return handleRelationshipBeat(campaign, turn, relationshipCall.rawArguments, sheets, sheetsById);
        if (relationshipCall.name === "romance_advance") return handleRomanceAdvance(campaign, turn, relationshipCall.rawArguments, sheets, sheetsById);
        return handleRelationshipEnd(campaign, relationshipCall.rawArguments, sheets, sheetsById);
      });
      turn.conversation.push({ role: "tool", ...(relationshipCall.id ? { tool_call_id: relationshipCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const worldCall of worldCalls) {
      const result = once(worldCall, () => {
        if (worldCall.name === "roll_treasure") return handleRollTreasure(campaign, turn, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "travel") return handleTravel(campaign, turn, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "pass_time") return handlePassTime(campaign, worldCall.rawArguments);
        if (worldCall.name === "party_stash") return handlePartyStash(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "set_effect") return handleSetEffect(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "clear_effect") return handleClearEffect(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "start_scene") return handleStartScene(campaign, worldCall.rawArguments);
        if (worldCall.name === "scene_check") return handleSceneCheck(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "end_scene") return handleEndScene(campaign, worldCall.rawArguments);
        if (worldCall.name === "mount_up") return handleMountUp(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "dismount") return handleDismount(campaign, worldCall.rawArguments, sheets, sheetsById);
        if (worldCall.name === "set_ambience") return handleSetAmbience(campaign, worldCall.rawArguments);
        if (worldCall.name === "play_sting") return handlePlaySting(campaign, worldCall.rawArguments);
        return handleDamageObject(worldCall.rawArguments);
      });
      turn.conversation.push({ role: "tool", ...(worldCall.id ? { tool_call_id: worldCall.id } : {}), content: JSON.stringify(result) });
    }

    for (const rollCall of rollCalls) {
      let parsedArgs: RollArgs | null = null;
      try { parsedArgs = rollArgsSchema.parse(JSON.parse(rollCall.rawArguments || "{}")); } catch { parsedArgs = null; }
      if (!parsedArgs) {
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify({ error: "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented." }) });
        continue;
      }

      const sheet = resolveSheetRef(parsedArgs.characterId, sheets, sheetsById);
      if (parsedArgs.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify({ error: "Character attacks in combat go through pc_attack: call it with characterId, targetEnemyId, and the weapon (or spell + damage dice). The server rolls to-hit from their sheet, adjudicates against the enemy's AC, and applies damage itself." }) });
        continue;
      }
      const aura = parsedArgs.kind === "saving_throw" && sheet ? allySaveAura(campaignId, sheet) : null;
      const resolved = resolveRollExpression(parsedArgs, sheet, {
        ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
        ...(sheet ? rollEffectExtras(campaignId, sheet.id, parsedArgs.kind) : {}),
        encumbrance: campaign.gameSettings.variantRules.encumbrance,
      });
      if ("error" in resolved) {
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify({ error: resolved.error }) });
        continue;
      }
      if ("autoFail" in resolved) {
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify({ success: false, autoFailed: true, note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}. No dice are rolled; narrate the failure.` }) });
        continue;
      }

      if (sheet && resolved.spendInspiration) {
        once(rollCall, () => {
          const { conditions, meta } = removeConditions(sheet.conditions, sheet.conditionMeta, resolved.spendInspiration!.split("|"));
          const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
          if (updated) publishPersisted(campaignId, "sheet_updated", { sheet: updated });
          return { inspirationSpent: true };
        });
      }

      if (sheet && realDiceUserIds.has(sheet.userId)) {
        const pending = createPendingRoll({
          campaignId,
          turnId: turn.id,
          toolCallId: rollCall.id ?? null,
          userId: sheet.userId,
          characterId: sheet.id,
          kind: parsedArgs.kind,
          detail: resolved.detail,
          expression: resolved.expression,
          advantage: parsedArgs.advantage ?? "none",
          dc: parsedArgs.dc ?? null,
          reason: parsedArgs.reason?.slice(0, 200) ?? "",
          targetEnemyId: parsedArgs.kind === "damage" ? parsedArgs.targetEnemyId ?? null : null,
        });
        publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
        parkedAny = true;
        continue;
      }

      try {
        const journaled = once(rollCall, () => {
          const outcome = rollExpression(resolved.expression);
          const roll = insertRoll({
            campaignId,
            characterId: sheet?.id ?? null,
            requestedBy: "dm",
            kind: parsedArgs.kind,
            detail: resolved.detail,
            advantage: parsedArgs.advantage ?? "none",
            dc: parsedArgs.dc ?? null,
            result: outcome,
          });
          publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
          const combatNote = parsedArgs.kind === "initiative" ? recordInitiativeRoll(campaignId, sheet?.id ?? null, roll.total) : null;
          const appliedDamage = parsedArgs.kind === "damage" && parsedArgs.targetEnemyId
            ? autoApplyDamageRoll(campaign, turn, parsedArgs.targetEnemyId, roll, sheets, sheetsById, parsedArgs.damageType)
            : null;
          return {
            _rollId: roll.id,
            total: roll.total,
            dice: outcome.terms,
            ...(parsedArgs.dc !== undefined ? { dc: parsedArgs.dc, success: roll.total >= parsedArgs.dc } : {}),
            ...(outcome.crit ? { crit: outcome.crit } : {}),
            ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
            note: "Narrate this real result. Do not roll again for the same action.",
            ...(combatNote ? { combat: combatNote } : {}),
            ...(appliedDamage ? { applied: appliedDamage } : {}),
          };
        });
        const rollId = typeof journaled._rollId === "string" ? journaled._rollId : null;
        if (rollId && !turn.rollIds.includes(rollId)) turn.rollIds.push(rollId);
        const { _rollId, ...toolResult } = journaled;
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify(toolResult) });
      } catch (rollError) {
        turn.conversation.push({ role: "tool", ...(rollCall.id ? { tool_call_id: rollCall.id } : {}), content: JSON.stringify({ error: rollError instanceof Error ? rollError.message : "Invalid dice expression." }) });
      }
    }

    if (parkedAny) {
      turn.status = "awaiting_rolls";
      saveDmTurn(turn);
      setDmStatus(campaignId, "awaiting_rolls");
      return;
    }

    saveDmTurn(turn);
    setDmStatus(campaignId, "narrating");
  }

  if (!failed) {
    await ensureWhisperReplies(context, turn);
    await enforceEngineBoundary(campaign, turn, MAX_MODEL_CALLS - turn.callIndex, sheets);
  }
  finalize(context, turn, failed);
  if (!failed) {
    await maybeCloseChapter(campaignId, { beatCompleted });
    if (isStageEnabled(context.campaign.gameSettings.stages, "compaction")) await maybeCompactHistory(campaignId);
    tickWorldState(campaignId);
  }
}

async function ensureWhisperReplies(context: TurnContext, turn: DmTurn) {
  if (!turn.playerWhisperIds.length) return;
  const { campaign, sheets, sheetsById } = context;
  const pending = listPendingPlayerWhispers(campaign.id).filter((whisper) => turn.playerWhisperIds.includes(whisper.id));
  const unanswered = () => pending.filter((whisper) => whisper.characterId && !turn.answeredWhisperCharacterIds.includes(whisper.characterId));
  if (!unanswered().length) return;

  const owed = unanswered().map((whisper) => `- ${whisper.characterName}: "${whisper.content}"`).join("\n");
  const { message } = await requestDmMessage(
    campaign.settings,
    [
      ...turn.conversation,
      { role: "user", content: `[System] You have not yet privately answered these player messages. Reply to each one now using the send_whisper tool addressed to that character. Refuse any out-of-character request for levels, XP, perks, items, or abilities in-fiction, but resolve legitimate secret actions. Do not narrate anything to the shared table.\n${owed}` },
    ],
    { tools: [sendWhisperTool], toolChoice: "auto", thinking: true },
  );
  const xmlSalvage = salvageXmlToolCalls(extractStoryText(message?.content));
  const salvage = salvageTextualToolCalls(xmlSalvage.text);
  const whisperCalls = [...extractToolCalls(message?.tool_calls), ...xmlSalvage.calls, ...salvage.calls].filter((toolCall) => toolCall.name === "send_whisper");
  for (const whisperCall of whisperCalls) {
    const result = executeToolOnce(
      { turnId: turn.id, toolCallId: whisperCall.id ?? `whisper-reply-${turn.answeredWhisperCharacterIds.length}`, toolName: "send_whisper" },
      () => handleSendWhisper(campaign, turn.id, whisperCall.rawArguments, sheets, sheetsById),
    );
    if (!("error" in result)) {
      for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
        if (!turn.answeredWhisperCharacterIds.includes(characterId)) turn.answeredWhisperCharacterIds.push(characterId);
      }
    }
  }

  for (const whisper of unanswered()) {
    if (!whisper.characterId) continue;
    deliverWhisper(campaign.id, turn.id, [{ userId: whisper.userId, characterId: whisper.characterId, characterName: whisper.characterName }], FALLBACK_WHISPER_MESSAGE);
    turn.answeredWhisperCharacterIds.push(whisper.characterId);
  }
  saveDmTurn(turn);
}

export function handleRequestPlayerInput(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  if (getFloor(campaign.id).mode === "initiative") return { error: "The initiative order has the floor while the fight runs." };
  const parsed = parseSpotlightUserIds(rawArguments, sheets, sheetsById);
  if (!parsed) return { error: "Name at least one player character to give the floor to." };
  const floor = { mode: "spotlight" as const, userIds: parsed.userIds, prompt: parsed.prompt, respondedUserIds: [] };
  setFloor(campaign.id, floor);
  publishPersisted(campaign.id, "floor_changed", { floor });
  return { ok: true, waitingOn: parsed.userIds.length };
}

export function handleRecordEvent(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: { characterId?: unknown; kind?: unknown; summary?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { error: "Invalid arguments." }; }
  const sheet = resolveSheetRef(typeof args.characterId === "string" ? args.characterId : undefined, sheets, sheetsById);
  if (!sheet) return { error: "Unknown characterId; use one from GAME STATE." };
  const kind = normalizeEventKind(args.kind, CHARACTER_EVENT_KINDS) as CharacterEventKind;
  const summary = String(args.summary ?? "").trim().slice(0, 300);
  if (!summary) return { error: "record_event needs a one-sentence summary." };
  if (hasRecentIdenticalEvent(sheet.id, summary)) return { ok: true, note: "Already recorded." };
  const event = insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind,
    summary,
  });
  publishPersisted(campaign.id, "character_event", { event, characterName: sheet.name });
  return { ok: true };
}

export function handleLocationCall(campaign: Campaign, toolName: string, rawArguments: string): Record<string, unknown> {
  let args: { name?: unknown; layoutDescription?: unknown; connections?: unknown; visionClear?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { error: "Invalid arguments." }; }
  const layoutDescription = typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections) ? args.connections.map(String).slice(0, 12) : undefined;
  const visionClear = args.visionClear === true;

  let location;
  let previousLayout = "";
  let movedToNewLocation = false;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { error: "move_party needs a location name." };
    const previous = getCurrentLocation(campaign.id);
    location = upsertCurrentLocation({ campaignId: campaign.id, name, layoutDescription, connections });
    movedToNewLocation = !previous || previous.id !== location.id;
    if (previous && previous.id !== location.id) {
      const merged = [...new Set([...location.connections, previous.name])];
      if (merged.length !== location.connections.length) location = updateCurrentLocationDetails(campaign.id, { connections: merged }) ?? location;
    }
    setCampaignScene(campaign.id, location.name);
  } else {
    previousLayout = getCurrentLocation(campaign.id)?.layoutDescription ?? "";
    location = updateCurrentLocationDetails(campaign.id, { layoutDescription, connections });
    if (!location) return { error: "No current location; call move_party first." };
  }

  publishPersisted(campaign.id, "location_updated", { location });
  followSceneAmbience(campaign, `${location.name} ${location.layoutDescription}`);
  const layoutRevised = toolName === "update_location" && location.layoutDescription !== previousLayout;
  const mapEnqueued = visionClear && campaign.gameSettings.mapsEnabled && imageProducerReady(campaign.settings.imageBackend, campaign.settings) && (!location.mapImage || layoutRevised);
  if (mapEnqueued) void enqueueLocationMap(campaign, location.id);

  return {
    ok: true,
    location: location.name,
    note: "Recorded. Continue the scene.",
    ...(movedToNewLocation ? { movedToNewLocation: true, _locationId: location.id, _mapAvailable: mapEnqueued || Boolean(location.mapImage) } : {}),
  };
}

function parseSpotlightUserIds(
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { userIds: string[]; prompt: string } | null {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { characterIds?: unknown; prompt?: unknown };
    const ids = Array.isArray(parsed.characterIds) ? parsed.characterIds.map(String) : [];
    const userIds = [
      ...new Set(
        ids
          .map((requested) => resolveSheetRef(requested, sheets, sheetsById))
          .filter((sheet): sheet is CharacterSheet => sheet !== null && !sheet.isCompanion)
          .map((sheet) => sheet.userId),
      ),
    ];
    return userIds.length ? { userIds, prompt: String(parsed.prompt ?? "") } : null;
  } catch {
    return null;
  }
}

function finalize(context: TurnContext, turn: DmTurn, failed: string) {
  const campaignId = context.campaign.id;
  if (failed) {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({ campaignId, seq, authorType: "system", content: `${DM_HALTED_PREFIX}${failed}`, dmTurnId: turn.id });
    publishWithSeq(campaignId, seq, "message_added", { message });
    setDmStatus(campaignId, "idle");
    turn.status = "failed";
    saveDmTurn(turn);
    return;
  }

  if (turn.playerWhisperIds.length) {
    const answeredWhisperIds = listPendingPlayerWhispers(campaignId)
      .filter((whisper) => turn.playerWhisperIds.includes(whisper.id) && (!whisper.characterId || turn.answeredWhisperCharacterIds.includes(whisper.characterId)))
      .map((whisper) => whisper.id);
    markPlayerWhispersAnswered(answeredWhisperIds, turn.id);
  }

  if (turn.playerWhisperIds.length && !turn.narrationParts.join("").trim() && !turn.rollIds.length) {
    setDmStatus(campaignId, "idle");
    turn.status = "done";
    saveDmTurn(turn);
    return;
  }

  const narrationParts = turn.narrationParts;
  let content = narrationParts.join("\n\n").trim();
  if (!content) content = "The moment hangs there, waiting on the party's next move.";
  if (turn.rollIds.length && narrationParts.length > 1) {
    const lastPart = narrationParts[narrationParts.length - 1];
    const earlier = narrationParts.slice(0, -1).join("\n\n");
    content = `${earlier}\n\n${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${lastPart}`;
  } else if (turn.rollIds.length) {
    content = `${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${content}`;
  }

  const imageEnabled = context.campaign.settings.imageGenerationEnabled && context.campaign.settings.autoImages;
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "dm",
    content,
    imageRequest: imageEnabled && turn.imageArgs?.prompt
      ? { needed: true, prompt: turn.imageArgs.prompt, mode: context.campaign.settings.imageMode, backend: context.campaign.settings.imageBackend, aspect: context.campaign.settings.aspect, reason: turn.imageArgs.reason, characterIds: [] }
      : undefined,
    locationId: turn.locationId ?? undefined,
    dmTurnId: turn.id,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  setDmStatus(campaignId, "idle");
  advanceAfterTurn(context.campaign, turn);

  if (context.campaign.gameSettings.holdSubmissions) {
    const current = getFloor(campaignId);
    if (current.mode !== "hold") {
      const held = { mode: "hold" as const, next: current };
      setFloor(campaignId, held);
      publishPersisted(campaignId, "floor_changed", { floor: held });
    }
  }

  if (message.imageRequest && imageProducerReady(context.campaign.settings.imageBackend, context.campaign.settings)) {
    void fulfillMessageImage(campaignId, message.id, message.imageRequest, context.campaign.settings);
  }
  if (context.campaign.gameSettings.ttsEnabled) {
    void enqueueNarrationAudio(campaignId, message.id, content, context.campaign.gameSettings.ttsVoice);
  }

  turn.status = "done";
  saveDmTurn(turn);
}
