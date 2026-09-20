import { gameText, modelFailureText, resolveGameLanguage, type GameLanguage } from "@/lib/i18n/game-text";
import { executeDmTool, withGameStateRollback } from "@/lib/dm/tool-transaction";
import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import {
  commitDmBatch, commitDmFinalization, dmExecutionState, dmReadyToFinalize, pendingDmBatch,
  prepareDmBatch, restoreDmBatch, type BatchDecision,
} from "@/lib/db/dm-execution";
import { completedInputSeq, rememberTurnInput } from "@/lib/db/dm-turn-inputs";
import { latestInputSeq, needsDmTurn, normalizeTurnToolCalls, collectTurnToolCallIds } from "@/lib/dm/turn-input";
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
  listOpenPendingRolls,
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
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { generateImageTool, parseGenerateImageToolCall } from "@/lib/image-tool";
import { extractStoryText } from "@/lib/story-prompt";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { enqueueDmMediaIntent } from "@/lib/dm/media-jobs";
import { imageProducerReady } from "@/lib/image-generate";
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
import { dmThinkingEnabled, storyContextTokens } from "@/lib/model-client";
import { YOLO_MAX_MODEL_CALLS, yoloDndEnabled, yoloThinkingEnabled, yoloToolAllowed } from "@/lib/dm/yolo";
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
import {
  getCurrentLocation,
  listLocations,
  updateCurrentLocationDetails,
  upsertCurrentLocation,
} from "@/lib/db/locations";
import { maybeCompactHistory } from "@/lib/dm/compaction";
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
  queueSkippedCombatTurn,
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

const MUTATION_NAMES = new Set<string>(MUTATION_TOOL_NAMES);
const ENCOUNTER_NAMES = new Set<string>(ENCOUNTER_TOOL_NAMES);

// One DM turn is a bounded tool loop: narrate -> maybe request rolls ->
// server rolls -> model interprets -> ... -> final narration. The model
// never invents dice results; every number comes from src/lib/dice.
//
// The turn is a PERSISTED state machine (dm_turns): when a roll belongs to
// a player using physical dice, the turn saves its conversation, parks as
// awaiting_rolls, and the queue job ends. Submitting the roll enqueues
// resumeDmTurn, which appends the results and continues. Parked turns
// survive restarts.
// Exported for the retry path (src/lib/dm/retry-turn.ts), which has to know
// where a resumed turn may re-enter the loop.
export const MAX_MODEL_CALLS = yoloDndEnabled() ? YOLO_MAX_MODEL_CALLS : 4;

// Tools whose results decide an attack/damage outcome: narration written in
// the same model call is a premature guess and is withheld from players.
const ATTACK_OUTCOME_TOOLS = new Set([
  "pc_attack",
  "cast_at_enemy",
  "enemy_attack",
  "damage_enemy",
  "aoe_damage",
]);

type TurnContext = {
  language: GameLanguage;
  campaign: Campaign;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
};

// Compact snapshot of the active encounter for the GAME STATE block. Exact
// HP is model-facing only; clients get vague health states elsewhere.
function buildEncounterState(campaignId: string, sheets: CharacterSheet[]) {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
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
      ? encounter.order.map((entry, index) => ({
          name: entry.name,
          current: index === encounter.turnIndex,
        }))
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
      // Durations render inline so the model sees "stunned (2 more rounds)".
      conditions: enemy.conditions.map((condition) => {
        const meta = enemy.conditionMeta[condition];
        if (meta?.rounds) {
          return `${condition} (${meta.rounds} more round${meta.rounds === 1 ? "" : "s"})`;
        }
        if (meta?.saveEnds) {
          return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
        }
        return condition;
      }),
      attacks: enemy.stats.attacks,
      // The trait lines, then the printed half of the block (scores,
      // skills, senses, languages, spells) for blocks that carry one.
      traits: [...enemy.stats.traits, ...extraBlockLines(enemy.stats)],
      resist: enemy.stats.resist,
      immune: enemy.stats.immune,
      vulnerable: enemy.stats.vulnerable,
      concentration: enemy.concentration,
    })),
    map: buildMapText(encounter.id, sheets),
  };
}

// The DM is omniscient on the battle map: full grid, all positions, plus
// per-combatant status notes (downed PCs, enemy conditions).
function buildMapText(encounterId: string, sheets: CharacterSheet[]): string | null {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return null;
  }
  const statuses = new Map<string, string>();
  for (const sheet of sheets) {
    if (sheet.deathSaves?.dead) {
      statuses.set(sheet.id, "DEAD");
    } else if (sheet.deathSaves?.stable) {
      statuses.set(sheet.id, "STABLE at 0 HP");
    } else if (sheet.currentHp <= 0) {
      statuses.set(sheet.id, "DYING at 0 HP");
    }
  }
  for (const enemy of listEnemies(encounterId)) {
    if (enemy.status === "alive" && enemy.conditions.length) {
      statuses.set(enemy.id, enemy.conditions.join(", "));
    }
  }
  // The drawn board, so the model sees the doors, with the shut ones named.
  return serializeMapForPrompt({ ...map, terrain: map.drawnTerrain }, listTokens(map.id), statuses);
}

function loadContext(campaign: Campaign): TurnContext {
  const sheets = listSheets(campaign.id);
  const members = listMembers(campaign.id);
  const realDiceUserIds =
    campaign.gameSettings.dicePolicy === "real_allowed"
      ? new Set(members.filter((member) => member.useRealDice).map((member) => member.userId))
      : new Set<string>();
  return {
    language: resolveGameLanguage(campaign.gameSettings.language, campaign.gameSettings.language ? [] : listRecentMessages(campaign.id, 100)),
    campaign,
    sheets,
    sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
    realDiceUserIds,
  };
}

export async function startDmTurn(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") {
    return;
  }
  failStaleRunningTurns(campaignId);

  // 400 recent messages always over-covers the prompt builder's 100k-char
  // budget; the full transcript stays in the DB for compaction and chapters.
  const history = listRecentMessages(campaignId, 400);
  // Only inputs captured by a successfully completed turn are acknowledged.
  // A player action arriving during the model request must not be hidden by
  // the later DM message that finishes that request.
  const pendingWhispers = listPendingPlayerWhispers(campaignId);
  if (!needsDmTurn(history, completedInputSeq(campaignId), pendingWhispers.length > 0)) {
    setDmStatus(campaignId, "idle");
    return;
  }

  setDmStatus(campaignId, "thinking");

  const context = loadContext(campaign);
  // Combat can never wedge on missing initiative: when nothing is pending,
  // stragglers are auto-rolled before the prompt is built.
  ensureInitiativeProgress(campaign);
  const { summary } = getCampaignSummaryState(campaignId);
  const currentLocation = getCurrentLocation(campaignId);
  // Variant rules always ride; house rules and world lore are retrieved
  // against the current moment (one MiniLM embed, keyword fallback).
  // Naming an archived NPC brings them back before the prompt is built, so
  // the DM sees them on the very turn the party asks after them rather than
  // one turn late.
  restoreMentionedNpcs(campaignId, history.slice(-4).map((entry) => entry.content).join("\n"));

  // Optional stages (src/lib/dm/stages.ts): all default on, so this changes
  // nothing until an operator opts out.
  const yolo = yoloDndEnabled();
  const stages = campaign.gameSettings.stages;
  const retrieval = !yolo && isStageEnabled(stages, "retrieval")
    ? await buildTurnRetrieval(campaign, history)
    : { variantRulesBlock: renderVariantRules(campaign.gameSettings.variantRules), houseRulesBlock: "", loreBlock: "" };
  // Taken (read and deleted in one statement) rather than read-then-clear, so
  // two turns racing cannot both fire the same directive. It is consumed here,
  // before the conversation is persisted below, which is what makes a retry
  // correct: retry-turn.ts replays that stored conversation, so the directive
  // is still in the prompt it re-runs, neither lost nor applied twice.
  const turn = withCommittedEffects(() => getDatabase().transaction(() => {
    const directorArm = takeDirectorArm(campaignId);
    const directorBlock = buildDirectorBlock(directorArm);
    if (directorArm) {
      // Clear the armed badge for every client now that the steer is spent.
      publishPersisted(campaignId, "director_armed", {
        armed: false,
        oneShot: null,
        absoluteCommand: "",
      });
    }
    const promptState: DmGameState = {
        campaign,
        // The window the prompt is actually being built against; without this
        // every budget silently fell back to the default rather than the
        // campaign's configured model.
        contextLimitTokens: storyContextTokens(campaign.settings),
        variantRulesBlock: retrieval.variantRulesBlock,
        houseRulesBlock: retrieval.houseRulesBlock,
        loreBlock: retrieval.loreBlock,
        members: listMembers(campaignId),
        sheets: context.sheets,
        encounter: buildEncounterState(campaignId, context.sheets),
        enemySuggestions: suggestEnemies(
          campaign.gameSettings,
          context.sheets.map((sheet) => sheet.level),
          yolo ? 5 : 10,
        ),
        recentRolls: listRecentRolls(campaignId, yolo ? 3 : 5),
        storySummary: summary,
        currentLocation: currentLocation
          ? {
              name: currentLocation.name,
              layoutDescription: currentLocation.layoutDescription,
              connections: currentLocation.connections,
            }
          : null,
        visitedLocationNames: listLocations(campaignId)
          .filter((location) => location.visited)
          .map((location) => location.name)
          .slice(0, yolo ? 5 : 15),
        recentEventsByCharacter: new Map(
          [...listRecentEventsForCampaign(campaignId, yolo ? 1 : 3)].map(([characterId, events]) => [
            characterId,
            events.map((event) => event.summary),
          ]),
        ),
        pins: listPins(campaignId).map((pin) => ({ text: pin.text })),
        chapters: (yolo ? [] : listChapters(campaignId))
          .filter((chapter) => chapter.status === "closed")
          .map((chapter) => ({
            id: chapter.id,
            index: chapter.index,
            title: chapter.title,
            oneLiner: chapter.highlights[0] ?? "",
            // The full sealed summary; the LOD renderer decides per chapter
            // whether the prompt gets all of it or just its first sentence.
            summary: chapter.summary || chapter.highlights[0] || "",
          })),
        publicNotes: listPublicCampaignNotes(campaignId, yolo ? 4 : 10)
          .filter((note) => !yolo || note.pinned)
          .map((note) => ({
          pinned: note.pinned,
          title: note.title,
          body: note.body,
        })),
        facts: listActiveFacts(campaignId)
          .filter((fact) => !yolo || fact.pinned)
          .slice(0, yolo ? 8 : undefined)
          .map((fact) => ({
          category: fact.category,
          subject: fact.subject,
          fact: fact.fact,
          pinned: fact.pinned,
          knownBy: fact.knownBy,
        })),
        directorNotes: consumePendingSparks(campaignId).map((spark) => spark.text),
        directorBlock,
        npcs: npcRosterForPrompt(campaignId).slice(0, yolo ? 8 : undefined),
        relationships:
          yolo || campaign.gameSettings.relationships === "off"
            ? []
            : relationshipRosterForPrompt(campaignId),
        recentWhispers: listRecentWhispersForPrompt(campaignId, yolo ? 4 : 10),
        pendingPlayerWhispers: pendingWhispers.map((whisper) => ({
          from: whisper.characterName,
          content: whisper.content,
        })),
    };
    const conversation = buildDmMessages(promptState, history);
  
    const turn = createDmTurn(campaignId, conversation);
    rememberTurnInput(turn.id, campaignId, latestInputSeq(history));
    // buildDmMessages fills this in on the state object it was handed, so the
    // trace is carried onto the turn row rather than recomputed.
    turn.contextTrace = promptState.contextTrace ?? null;
    // Remember which player whispers this turn's prompt carries; finalize()
    // marks them answered only when the turn succeeds.
    turn.playerWhisperIds = pendingWhispers.map((whisper) => whisper.id);
    saveDmTurn(turn);
    return turn;
  })());
  await advance(context, turn);
}

export async function resumeDmTurn(campaignId: string, turnId: string) {
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  if (!campaign || campaign.status !== "active" || !turn || turn.status !== "awaiting_rolls") {
    return;
  }
  const pendings = listPendingForTurn(turnId);
  if (pendings.some((pending) => pending.status === "pending")) {
    return;
  }

  // Answer each parked tool call with the roll the player entered (or the
  // digital fallback), in creation order.
  for (const pending of pendings) {
    const roll = pending.rollId ? getRoll(pending.rollId) : null;
    if (!roll) {
      continue;
    }
    if (!turn.rollIds.includes(roll.id)) {
      turn.rollIds.push(roll.id);
    }
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
        // What the server already did with this roll (initiative locked,
        // damage applied); the model must narrate from it, not repeat it.
        ...(pending.combatNote ? { combat: pending.combatNote } : {}),
      }),
    });
  }

  // Positions may have changed while the turn was parked (the mover's own
  // click-to-move never wakes the DM), so the map snapshot baked into the
  // turn's GAME STATE can be stale. Hand the model a fresh one.
  const context = loadContext(campaign);
  const encounter = getActiveEncounter(campaignId);
  if (encounter) {
    const mapText = buildMapText(encounter.id, context.sheets);
    if (mapText) {
      turn.conversation.push({
        role: "user",
        content: `[GAME STATE UPDATE] Combatants may have moved while you waited on rolls. Current battle map (authoritative, replaces the one above):\n${mapText}`,
      });
    }
  }

  turn.status = "running";
  saveDmTurn(turn);
  setDmStatus(campaignId, "narrating");
  await advance(context, turn);
}

// Retry entry point (src/lib/dm/retry-turn.ts): re-enter a halted turn from
// its persisted conversation. Lives here because advance() and loadContext()
// are turn internals; the retry's own guards run before this is called.
export async function reenterDmTurn(campaign: Campaign, turn: DmTurn) {
  await advance(loadContext(campaign), turn);
}

// A throwing tool handler used to leave dm_turns stuck at 'running' until
// failStaleRunningTurns reaped it ten minutes later, with the table watching
// a DM that never speaks. Any unexpected throw now finalizes the turn at
// once. Parked turns return with status 'awaiting_rolls' and are left alone.
async function advance(context: TurnContext, turn: DmTurn) {
  try {
    await runAdvance(context, turn);
  } catch (error) {
    console.error("[dm-turn] advance failed", error);
    if (turn.status === "running") {
      finalize(context, turn, gameText(context.language, "internal"));
    } else {
      setDmStatus(context.campaign.id, "idle");
    }
  }
}

async function runAdvance(context: TurnContext, turn: DmTurn) {
  const { campaign, sheets, sheetsById, realDiceUserIds } = context;
  const campaignId = campaign.id;
  let failed = "";
  const executionState = dmExecutionState(turn.id);
  let spotlightSet = executionState.spotlightSet;

  const yolo = yoloDndEnabled();
  const imageEnabled =
    !yolo && campaign.settings.imageGenerationEnabled && campaign.settings.autoImages;
  // The YOLO profile needs a small subset of mutation tools, so build the full
  // source list and filter it below instead of dropping mutations wholesale.
  const leanTools = !yolo && process.env.DM_LEAN_TOOLS === "1";
  // These caps survive a crash or physical-dice resume, not just one
  // invocation of advance(). A retry cannot spend the same allowance twice.
  let beatCompleted = executionState.beatCompleted;
  let whisperCount = executionState.whisperCount;
  // One suggested note per turn keeps the DM from papering the
  // lead's approval queue in a single reply.
  let noteCount = executionState.noteCount;
  // One shot at fixing a fight announced in prose without start_encounter; a
  // model that ignores the correction keeps its text rather than looping.
  let encounterNudged = executionState.encounterNudged;
  const runtimeState = () => ({ spotlightSet, beatCompleted, whisperCount, noteCount, encounterNudged });

  while (turn.status === "running" && (turn.callIndex < MAX_MODEL_CALLS || pendingDmBatch(turn.id))) {
    type ModelReply = Awaited<ReturnType<typeof requestDmMessage>>["message"];
    const pendingBatch = pendingDmBatch<ModelReply>(turn.id);
    if (pendingBatch?.phase === "whispers" || (!pendingBatch && dmReadyToFinalize(turn.id))) break;
    if (pendingBatch) restoreDmBatch(turn, pendingBatch);
    const finalCall = turn.callIndex === MAX_MODEL_CALLS - 1;
    // Rebuilt each iteration: the moment start_encounter succeeds mid-turn,
    // the combat tools must appear on the very next model call. Encounter
    // tools ignore DM_LEAN_TOOLS; they are the point of combat. Rest tools
    // only exist outside combat.
    const inEncounter = Boolean(getActiveEncounter(campaignId));
    const allTools = [
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
      // The party's shared pack and common purse. Out of combat only, like
      // the rest of the world tools: nobody rummages in the group kit while
      // initiative is running.
      ...(inEncounter ? [] : partyTools),
      // Effects are offered in and out of combat: a blessing lands mid-fight
      // as often as a curse lands in a throne room.
      ...effectTools,
      // Structured non-combat scenes and mounts are both out-of-combat
      // business: a chase clock and an initiative order are two answers to
      // the same question, and nobody saddles up mid-round.
      ...(inEncounter ? [] : sceneTools),
      // Sound is offered in and out of a fight: a sting lands mid-round as
      // often as a bed changes between them. Silent for a table that has
      // the library switched off, which is why it is gated here rather
      // than left to the handler to refuse.
      ...(campaign.gameSettings.ambienceEnabled ? ambienceTools : []),
      ...(inEncounter ? [] : mountTools),
      ...encounterTools(inEncounter),
      castBuffTool,
      ...(inEncounter ? [] : restTools),
      ...companionTools(campaign),
      ...(leanTools ? [] : mutationTools),
      ...(imageEnabled ? [generateImageTool] : []),
    ];
    const tools = yolo
      ? allTools.filter((tool) =>
          yoloToolAllowed(tool.function.name, ENCOUNTER_NAMES.has(tool.function.name)),
        )
      : allTools;
    // Model deltas are untrusted drafts: dice and the narration guard have
    // not run yet. Keep the thinking status, but publish prose only through
    // finalize() after the authoritative results have been checked.
    const response = pendingBatch ? { message: pendingBatch.message, error: undefined }
      : await requestDmMessage(campaign.settings, turn.conversation, {
      tools,
      // Force pure narration on the last permitted call so a tool-happy
      // model cannot loop forever.
      toolChoice: finalCall ? "none" : "auto",
      // Thinking mode on tool-decision calls only: without it qwen3.6-35b
      // narrates right past its tools (0/11 tool calls in live combat);
      // with it, rolls and encounters fire reliably. The forced-narration
      // final call skips it to keep turns snappy. Admin → Модели toggles it
      // (text.thinking), falling back to DM_THINKING=0.
      thinking: !finalCall && (yolo ? yoloThinkingEnabled() : dmThinkingEnabled()),

    });

    const { message, error } = response;
    if (error) {
      const payload = (await error.json().catch(() => null)) as { error?: string } | null;
      failed = modelFailureText(context.language, payload?.error, error.status);
      break;
    }

    const batch = pendingBatch ?? prepareDmBatch(turn, message);
    if (process.env.DM_DEBUG) {
      console.log(
        `[dm-debug] call ${turn.callIndex}: content=${JSON.stringify(String(message?.content ?? "").slice(0, 300))} tool_calls=${JSON.stringify(message?.tool_calls ?? null).slice(0, 500)}`,
      );
    }
    turn.callIndex += 1;

    // Salvage tool calls the model wrote as literal text so they still run
    // (and never reach players as raw text), then merge them with the
    // structured calls under synthetic ids for tool-result pairing. Three
    // nets, in order: the model's native XML dialect (llama-server's
    // extraction intermittently misses it), bracket leaks, prose roll-asks.
    const xmlSalvage = salvageXmlToolCalls(extractStoryText(message?.content));
    const salvage = salvageTextualToolCalls(xmlSalvage.text);
    // Prose roll-asks ("Avery, make an Investigation check, DC 15.")
    // become real request_roll calls. Skipped when the reply already rolls
    // (no double dice) and on the forced-narration final call, where a
    // synthesized roll could never resolve.
    const alreadyRolls = [
      ...extractToolCalls(message?.tool_calls),
      ...xmlSalvage.calls,
      ...salvage.calls,
    ].some((toolCall) => toolCall.name === "request_roll");
    const proseRolls =
      finalCall || alreadyRolls
        ? { text: salvage.text, calls: [] }
        : salvageProseRollAsks(salvage.text, sheets);
    const salvagedCalls = [...xmlSalvage.calls, ...salvage.calls, ...proseRolls.calls];
    const visibleText = proseRolls.text;
    const allToolCalls = normalizeTurnToolCalls(
      [...extractToolCalls(message?.tool_calls), ...salvagedCalls],
      `${turn.id}_${batch.index}`,
      collectTurnToolCallIds(turn.conversation),
    );
    const echoedToolCalls = allToolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.rawArguments },
    }));
    const offeredNames = new Set(tools.map((tool) => tool.function.name));
    const toolCalls = allToolCalls.filter((call) => offeredNames.has(call.name));
    // tool_choice=none is a protocol boundary, not a promise by the model.
    // Reject the whole final batch before any bookkeeping or mutation runs.
    if (finalCall && allToolCalls.length) {
      withGameStateRollback([context, turn], () => commitDmBatch(turn, batch, allToolCalls, () => {
        turn.conversation.push({ role: "assistant", content: visibleText || "", tool_calls: echoedToolCalls });
        for (const call of allToolCalls) {
          turn.conversation.push({ role: "tool", tool_call_id: call.id,
            content: JSON.stringify({ error: "Tool budget exhausted. No action was applied by this call." }) });
        }
        return "continue";
      }, runtimeState));
      failed = gameText(context.language, "toolsExhausted");
      break;
    }
    // Text streamed alongside an attack-resolving tool call is the model
    // guessing the outcome before the dice exist ("the blade bites deep" on
    // what turns out to be a miss). Drop it from the persisted narration;
    // the tool result comes back this same turn and the follow-up call
    // narrates from the real numbers. It stays in the echoed assistant
    // message, so the model keeps its own context.
    const calledAttackTool = toolCalls.some((toolCall) =>
      ATTACK_OUTCOME_TOOLS.has(toolCall.name),
    );
    // Hand-written "[roll:...]" markers rolled nothing (real markers are
    // appended by finalize() from actual roll ids); drop them before the
    // text is persisted so players never see dead bookkeeping tokens.
    const narration = (visibleText ?? "").replace(fakeRollMarkerRegex(), "").trim();
    if (narration && !calledAttackTool) {
      turn.narrationParts.push(narration);
    }
    const rollCalls = toolCalls.filter((toolCall) => toolCall.name === "request_roll");
    const inputCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "request_player_input",
    );
    const mutationCalls = toolCalls.filter((toolCall) => MUTATION_NAMES.has(toolCall.name));
    const encounterCalls = toolCalls.filter((toolCall) => ENCOUNTER_NAMES.has(toolCall.name));
    const castBuffCalls = toolCalls.filter((toolCall) => toolCall.name === "cast_buff");
    const restCalls = toolCalls.filter((toolCall) => toolCall.name === "take_rest");
    const companionCalls = toolCalls.filter((toolCall) =>
      COMPANION_TOOL_NAMES.has(toolCall.name),
    );
    const locationCalls = toolCalls.filter(
      (toolCall) => toolCall.name === "move_party" || toolCall.name === "update_location",
    );
    const eventCalls = toolCalls.filter((toolCall) => toolCall.name === "record_event");
    const beatCalls = toolCalls.filter((toolCall) => toolCall.name === "complete_beat");
    const recallCalls = toolCalls.filter((toolCall) => toolCall.name === "recall_story");
    const searchLoreCalls = toolCalls.filter((toolCall) => toolCall.name === "search_lore");
    const noteCalls = toolCalls.filter((toolCall) => toolCall.name === "write_campaign_note");
    const whisperCalls = toolCalls.filter((toolCall) => toolCall.name === "send_whisper");
    const checkCalls = toolCalls.filter((toolCall) =>
      (CHECK_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const hazardCalls = toolCalls.filter((toolCall) =>
      (HAZARD_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const splitCalls = toolCalls.filter((toolCall) =>
      (SPLIT_DAMAGE_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const petCalls = toolCalls.filter((toolCall) =>
      (PET_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const socialCalls = toolCalls.filter((toolCall) =>
      (SOCIAL_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const relationshipCalls = toolCalls.filter((toolCall) =>
      (RELATIONSHIP_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );
    const worldCalls = toolCalls.filter(
      (toolCall) =>
        (WORLD_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (PARTY_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (EFFECT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (SCENE_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (MOUNT_TOOL_NAMES as readonly string[]).includes(toolCall.name) ||
        (AMBIENCE_TOOL_NAMES as readonly string[]).includes(toolCall.name),
    );

    const recallResults = new Map<string, Record<string, unknown>>();
    for (const recallCall of recallCalls) {
      recallResults.set(
        recallCall.id ?? "recall_story",
        await handleRecallStory(campaignId, recallCall.rawArguments),
      );
    }
    const searchLoreResults = new Map<string, Record<string, unknown>>();
    for (const searchLoreCall of searchLoreCalls) {
      searchLoreResults.set(
        searchLoreCall.id ?? "search_lore",
        await handleSearchLore(campaignId, searchLoreCall.rawArguments),
      );
    }
    const decision = withGameStateRollback([context, turn], () => commitDmBatch(turn, batch, allToolCalls, (): BatchDecision => {
    // Location bookkeeping is synchronous and cheap; maps render async on
    // the media queue when vision allows.
    const locationResults = new Map<string, Record<string, unknown>>();
    for (const locationCall of locationCalls) {
      const result = executeDmTool([context, turn], () => handleLocationCall(campaign, locationCall.name, locationCall.rawArguments));
      if (result.movedToNewLocation) {
        delete result.movedToNewLocation;
        // Link the narration message finalize() writes to the new area so
        // the chat can show its map inline; only when a map exists or one
        // was just enqueued, so the placeholder can never dangle forever.
        if (result._mapAvailable && typeof result._locationId === "string") {
          turn.locationId = result._locationId;
        }
      }
      delete result._locationId;
      delete result._mapAvailable;
      locationResults.set(locationCall.id ?? locationCall.name, result);
    }
    // Notes deliver as pending suggestions immediately (like whispers); the
    // lead approves them in the notes panel.
    const noteResults = new Map<string, Record<string, unknown>>();
    for (const noteCall of noteCalls) {
      let result: Record<string, unknown>;
      if (noteCount >= 1) {
        result = { error: "Note limit reached for this turn." };
      } else {
        result = executeDmTool([context, turn], () => handleWriteCampaignNote(campaign, noteCall.rawArguments));
        if (!("error" in result)) {
          noteCount += 1;
        }
      }
      noteResults.set(noteCall.id ?? "write_campaign_note", result);
    }
    const eventResults = new Map<string, Record<string, unknown>>();
    for (const eventCall of eventCalls) {
      eventResults.set(
        eventCall.id ?? "record_event",
        executeDmTool([context, turn], () => handleRecordEvent(campaign, eventCall.rawArguments, sheets, sheetsById)),
      );
    }
    const beatResults = new Map<string, Record<string, unknown>>();
    for (const beatCall of beatCalls) {
      const outcome = executeDmTool([context, turn], () => handleCompleteBeat(campaignId, beatCall.rawArguments, beatCompleted));
      beatCompleted = beatCompleted || outcome.completed;
      beatResults.set(beatCall.id ?? "complete_beat", outcome.result);
    }
    // Whispers deliver immediately (like events); recipients are notified
    // via a contentless ephemeral, so narration never carries the secret.
    const whisperResults = new Map<string, Record<string, unknown>>();
    for (const whisperCall of whisperCalls) {
      let result: Record<string, unknown>;
      if (whisperCount >= WHISPER_CAP_PER_TURN) {
        result = { error: "Whisper limit reached for this turn." };
      } else {
        result = executeDmTool([context, turn], () => handleSendWhisper(campaign, turn.id, whisperCall.rawArguments, sheets, sheetsById));
        if (!("error" in result)) {
          whisperCount += 1;
          // Track which senders were actually answered so finalize() (and the
          // reply backstop) never mark an unanswered player whisper as done.
          for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
            if (!turn.answeredWhisperCharacterIds.includes(characterId)) {
              turn.answeredWhisperCharacterIds.push(characterId);
            }
          }
        }
      }
      whisperResults.set(whisperCall.id ?? "send_whisper", result);
    }
    if (!turn.imageArgs) {
      const parsedImage = parseGenerateImageToolCall(echoedToolCalls);
      if (parsedImage?.prompt) {
        turn.imageArgs = { prompt: parsedImage.prompt, reason: parsedImage.reason };
      }
    }

    // AI and human adjudication share the same initiative guard. Preserve
    // each call's real result rather than claiming the floor always changed.
    const inputResults = new Map<string, Record<string, unknown>>();
    for (const inputCall of inputCalls) {
      const result = spotlightSet
        ? { error: "The floor was already set in this turn." }
        : executeDmTool([context, turn], () => handleRequestPlayerInput(campaign, inputCall.rawArguments, sheets, sheetsById));
      inputResults.set(inputCall.id, result);
      if (!("error" in result)) spotlightSet = true;
    }

    // A tool call is work, even when it accompanies narration. Never infer
    // whether to execute it from a second, incomplete list of tool groups.
    const needsFollowUp = allToolCalls.length > 0;

    if (!needsFollowUp) {
      saveDmTurn(turn);
      // A fight announced in prose alone does not exist: no enemies, no
      // initiative, no HP. Hold the announcement back and send the model to
      // start_encounter for real; the follow-up narrates from tool results.
      if (
        !finalCall &&
        !encounterNudged &&
        !inEncounter &&
        narration &&
        turn.narrationParts[turn.narrationParts.length - 1] === narration &&
        announcesEncounterStart(narration)
      ) {
        encounterNudged = true;
        turn.narrationParts.pop();
        turn.conversation.push({
          role: "assistant",
          content: visibleText || "",
          tool_calls: echoedToolCalls,
        });
        turn.conversation.push({ role: "user", content: FAKE_ENCOUNTER_PROMPT });
        // Saved again: the save above still carried the withheld announcement.
        saveDmTurn(turn);
        return "continue";
      }
      return "finish";
    }
    setDmStatus(campaignId, "rolling");

    // Echo the assistant turn (with its tool calls) then answer each call
    // with a tool result carrying the real dice outcome.
    turn.conversation.push({
      role: "assistant",
      content: visibleText || "",
      tool_calls: echoedToolCalls,
    });

    const resultStart = turn.conversation.length;
    for (const inputCall of inputCalls) {
      turn.conversation.push({
        role: "tool",
        ...(inputCall.id ? { tool_call_id: inputCall.id } : {}),
        content: JSON.stringify(inputResults.get(inputCall.id)),
      });
    }

    for (const locationCall of locationCalls) {
      turn.conversation.push({
        role: "tool",
        ...(locationCall.id ? { tool_call_id: locationCall.id } : {}),
        content: JSON.stringify(
          locationResults.get(locationCall.id ?? locationCall.name) ?? { ok: true },
        ),
      });
    }

    for (const eventCall of eventCalls) {
      turn.conversation.push({
        role: "tool",
        ...(eventCall.id ? { tool_call_id: eventCall.id } : {}),
        content: JSON.stringify(
          eventResults.get(eventCall.id ?? "record_event") ?? { ok: true },
        ),
      });
    }

    for (const beatCall of beatCalls) {
      turn.conversation.push({
        role: "tool",
        ...(beatCall.id ? { tool_call_id: beatCall.id } : {}),
        content: JSON.stringify(beatResults.get(beatCall.id ?? "complete_beat") ?? { ok: true }),
      });
    }

    for (const recallCall of recallCalls) {
      turn.conversation.push({
        role: "tool",
        ...(recallCall.id ? { tool_call_id: recallCall.id } : {}),
        content: JSON.stringify(
          recallResults.get(recallCall.id ?? "recall_story") ?? { ok: true },
        ),
      });
    }

    for (const searchLoreCall of searchLoreCalls) {
      turn.conversation.push({
        role: "tool",
        ...(searchLoreCall.id ? { tool_call_id: searchLoreCall.id } : {}),
        content: JSON.stringify(
          searchLoreResults.get(searchLoreCall.id ?? "search_lore") ?? { ok: true },
        ),
      });
    }

    for (const noteCall of noteCalls) {
      turn.conversation.push({
        role: "tool",
        ...(noteCall.id ? { tool_call_id: noteCall.id } : {}),
        content: JSON.stringify(
          noteResults.get(noteCall.id ?? "write_campaign_note") ?? { ok: true },
        ),
      });
    }

    for (const whisperCall of whisperCalls) {
      turn.conversation.push({
        role: "tool",
        ...(whisperCall.id ? { tool_call_id: whisperCall.id } : {}),
        content: JSON.stringify(
          whisperResults.get(whisperCall.id ?? "send_whisper") ?? { ok: true },
        ),
      });
    }

    // Encounter tools resolve synchronously against server-authoritative
    // enemy state; the model narrates from the compact results. A pc_attack
    // for a physical-dice player parks instead: its tool result arrives when
    // the turn resumes with the adjudicated roll.
    let parkedAny = false;
    for (const encounterCall of encounterCalls) {
      let result: Record<string, unknown>;
      if (turn.encounterCount >= ENCOUNTER_CAP_PER_TURN) {
        result = { error: "Encounter action limit reached for this turn." };
      } else {
        result = executeDmTool([context, turn], () => applyEncounterCall(
          campaign,
          turn,
          encounterCall.name,
          encounterCall.rawArguments,
          sheets,
          sheetsById,
          { realDiceUserIds, toolCallId: encounterCall.id ?? null },
        )).result;
        if (!("error" in result)) {
          turn.encounterCount += 1;
        }
      }
      if (result[PC_ATTACK_PARKED]) {
        parkedAny = true;
        continue;
      }
      turn.conversation.push({
        role: "tool",
        ...(encounterCall.id ? { tool_call_id: encounterCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Companion recruit/dismiss resolves synchronously: the sheet, order
    // slot, and token exist before the model narrates the arrival. The
    // fresh sheet list matters (the shared `sheets` snapshot predates it),
    // so later tools in this turn resolve the new characterId via the DB.
    for (const companionCall of companionCalls) {
      const result = executeDmTool([context, turn], () => applyCompanionCall(
        campaign,
        companionCall.name,
        companionCall.rawArguments,
        listSheets(campaignId),
      ));
      if (!("error" in result)) {
        // Refresh the shared snapshot in place so pc_attack and friends can
        // resolve the new (or removed) companion later this same turn.
        const fresh = listSheets(campaignId);
        sheets.length = 0;
        sheets.push(...fresh);
        sheetsById.clear();
        for (const freshSheet of fresh) {
          sheetsById.set(freshSheet.id, freshSheet);
        }
      }
      turn.conversation.push({
        role: "tool",
        ...(companionCall.id ? { tool_call_id: companionCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Buff casts resolve synchronously: the slot spends, the effect lands
    // as a tracked condition, and the model narrates from the result.
    for (const castBuffCall of castBuffCalls) {
      const result = executeDmTool([context, turn], () => handleCastBuff(
        campaign,
        turn,
        castBuffCall.rawArguments,
        sheets,
        sheetsById,
      ));
      turn.conversation.push({
        role: "tool",
        ...(castBuffCall.id ? { tool_call_id: castBuffCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Rests resolve synchronously: hit dice roll server-side and every
    // sheet write is audited; the model narrates from the results.
    for (const restCall of restCalls) {
      const result = executeDmTool([context, turn], () => handleTakeRest(campaign, turn.id, restCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({
        role: "tool",
        ...(restCall.id ? { tool_call_id: restCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Stat mutations resolve synchronously; the model narrates from the
    // compact results. A hard per-turn cap bounds the blast radius.
    for (const mutationCall of mutationCalls) {
      let result: Record<string, unknown>;
      if (turn.mutationCount >= MUTATION_CAP_PER_TURN) {
        result = { error: "Mutation limit reached for this turn." };
      } else {
        // inventoryApprovals: item/gold changes to player characters stage
        // as offers the owning player answers; null falls through to the
        // normal auto-apply path.
        const proposed = executeDmTool([context, turn], () => maybeProposeItemChange(
          campaign,
          turn.id,
          mutationCall.name,
          mutationCall.rawArguments,
          sheetsById,
        ));
        result =
          proposed ??
          executeDmTool([context, turn], () => applyDmMutation(
            campaign,
            turn.id,
            mutationCall.name,
            mutationCall.rawArguments,
            sheets,
            sheetsById,
          )).result;
        if (!("error" in result)) {
          turn.mutationCount += 1;
        }
      }
      turn.conversation.push({
        role: "tool",
        ...(mutationCall.id ? { tool_call_id: mutationCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Group checks and passive-notice gates resolve synchronously against the
    // sheets: group_check rolls every participant and applies the half-succeed
    // rule, check_notice compares passive scores with no dice.
    for (const checkCall of checkCalls) {
      const result =
        checkCall.name === "group_check"
          ? executeDmTool([context, turn], () => handleGroupCheck(campaign, turn, checkCall.rawArguments, sheets, sheetsById))
          : executeDmTool([context, turn], () => handleCheckNotice(campaign, checkCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({
        role: "tool",
        ...(checkCall.id ? { tool_call_id: checkCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Traps, falls, and environmental hazards resolve synchronously: the
    // server owns the save DC and damage dice and applies them per victim.
    for (const hazardCall of hazardCalls) {
      const result = executeDmTool([context, turn], () => handleApplyHazard(campaign, turn, hazardCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({
        role: "tool",
        ...(hazardCall.id ? { tool_call_id: hazardCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // One rolled total, several targets, a share each: the halving and
    // doubling are the server's, and every share then lands through the
    // ordinary damage rules.
    for (const splitCall of splitCalls) {
      const result = executeDmTool([context, turn], () => handleSplitDamage(campaign, turn, splitCall.rawArguments, sheets, sheetsById));
      turn.conversation.push({
        role: "tool",
        ...(splitCall.id ? { tool_call_id: splitCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Familiars, companions, and drakes: summons validate the granting
    // feature, attacks roll real dice, damage lands on the pet's own pool.
    for (const petCall of petCalls) {
      let result: Record<string, unknown>;
      if (petCall.name === "summon_pet") {
        result = executeDmTool([context, turn], () => handleSummonPet(campaign, turn, petCall.rawArguments, sheets, sheetsById));
      } else if (petCall.name === "pet_attack") {
        result = executeDmTool([context, turn], () => handlePetAttack(campaign, turn, petCall.rawArguments, sheets, sheetsById));
      } else if (petCall.name === "damage_pet") {
        result = executeDmTool([context, turn], () => handleDamagePet(campaign, petCall.rawArguments, sheets, sheetsById));
      } else {
        result = executeDmTool([context, turn], () => handleDismissPet(campaign, petCall.rawArguments, sheets, sheetsById));
      }
      turn.conversation.push({
        role: "tool",
        ...(petCall.id ? { tool_call_id: petCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // NPC bookkeeping and social checks resolve synchronously against the
    // persisted NPC roster: attitude drives the check DC and shifts on a
    // decisive result, at most once per exchange.
    for (const socialCall of socialCalls) {
      let result: Record<string, unknown>;
      if (socialCall.name === "set_npc") {
        result = executeDmTool([context, turn], () => handleSetNpc(campaign, socialCall.rawArguments));
      } else if (socialCall.name === "npc_reaction") {
        result = executeDmTool([context, turn], () => handleNpcReaction(campaign, turn, socialCall.rawArguments));
      } else {
        result = executeDmTool([context, turn], () => handleSocialCheck(campaign, turn, socialCall.rawArguments, sheets, sheetsById));
      }
      turn.conversation.push({
        role: "tool",
        ...(socialCall.id ? { tool_call_id: socialCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Standing resolves synchronously against the relationship ledger: a
    // deed is weighed against the subject's own nature, an overture rolls a
    // real Charisma skill, and a romance moves at most once per exchange.
    for (const relationshipCall of relationshipCalls) {
      let result: Record<string, unknown>;
      if (relationshipCall.name === "relationship_beat") {
        result = executeDmTool([context, turn], () => handleRelationshipBeat(
          campaign,
          turn,
          relationshipCall.rawArguments,
          sheets,
          sheetsById,
        ));
      } else if (relationshipCall.name === "romance_advance") {
        result = executeDmTool([context, turn], () => handleRomanceAdvance(
          campaign,
          turn,
          relationshipCall.rawArguments,
          sheets,
          sheetsById,
        ));
      } else {
        result = executeDmTool([context, turn], () => handleRelationshipEnd(campaign, relationshipCall.rawArguments, sheets, sheetsById));
      }
      turn.conversation.push({
        role: "tool",
        ...(relationshipCall.id ? { tool_call_id: relationshipCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    // Treasure, object-breaking, and travel resolve synchronously: coins move
    // through modify_gold, forced-march failures apply exhaustion, and an
    // object break is read from the DMG table.
    for (const worldCall of worldCalls) {
      let result: Record<string, unknown>;
      if (worldCall.name === "roll_treasure") {
        result = executeDmTool([context, turn], () => handleRollTreasure(campaign, turn, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "travel") {
        result = executeDmTool([context, turn], () => handleTravel(campaign, turn, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "pass_time") {
        result = executeDmTool([context, turn], () => handlePassTime(campaign, worldCall.rawArguments));
      } else if (worldCall.name === "party_stash") {
        result = executeDmTool([context, turn], () => handlePartyStash(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "set_effect") {
        result = executeDmTool([context, turn], () => handleSetEffect(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "clear_effect") {
        result = executeDmTool([context, turn], () => handleClearEffect(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "start_scene") {
        result = executeDmTool([context, turn], () => handleStartScene(campaign, worldCall.rawArguments));
      } else if (worldCall.name === "scene_check") {
        result = executeDmTool([context, turn], () => handleSceneCheck(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "end_scene") {
        result = executeDmTool([context, turn], () => handleEndScene(campaign, worldCall.rawArguments));
      } else if (worldCall.name === "mount_up") {
        result = executeDmTool([context, turn], () => handleMountUp(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "dismount") {
        result = executeDmTool([context, turn], () => handleDismount(campaign, worldCall.rawArguments, sheets, sheetsById));
      } else if (worldCall.name === "set_ambience") {
        result = executeDmTool([context, turn], () => handleSetAmbience(campaign, worldCall.rawArguments));
      } else if (worldCall.name === "play_sting") {
        result = executeDmTool([context, turn], () => handlePlaySting(campaign, worldCall.rawArguments));
      } else {
        result = executeDmTool([context, turn], () => handleDamageObject(worldCall.rawArguments));
      }
      turn.conversation.push({
        role: "tool",
        ...(worldCall.id ? { tool_call_id: worldCall.id } : {}),
        content: JSON.stringify(result),
      });
    }

    for (const rollCall of rollCalls) {
      let parsedResult: RollArgs | null = null;
      try {
        parsedResult = rollArgsSchema.parse(JSON.parse(rollCall.rawArguments || "{}"));
      } catch {
        parsedResult = null;
      }
      const parsedArgs = parsedResult;

      if (!parsedArgs) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            error:
              "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented.",
          }),
        });
        continue;
      }

      const sheet = resolveSheetRef(parsedArgs.characterId, sheets, sheetsById);
      // In combat, character attacks belong to the pc_attack engine: the
      // server derives the bonus, adjudicates vs AC, and applies damage.
      if (parsedArgs.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            error:
              "Character attacks in combat go through pc_attack: call it with characterId plus both enemyId and targetEnemyId set to the same enemy, and the weapon (or spell + damage dice). The server rolls to-hit from their sheet, adjudicates against the enemy's AC, and applies damage itself.",
          }),
        });
        continue;
      }
      const aura =
        parsedArgs.kind === "saving_throw" && sheet ? allySaveAura(campaignId, sheet) : null;
      const resolved = resolveRollExpression(
        parsedArgs,
        sheet,
        {
          ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
          ...(sheet ? rollEffectExtras(campaignId, sheet.id, parsedArgs.kind) : {}),
          encumbrance: campaign.gameSettings.variantRules.encumbrance,
        },
      );
      if ("error" in resolved) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({ error: resolved.error }),
        });
        continue;
      }
      // Conditions can decide a save outright (paralyzed auto-fails STR and
      // DEX saves): no dice, the result is a failure the model narrates.
      if ("autoFail" in resolved) {
        turn.conversation.push({
          role: "tool",
          ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
          content: JSON.stringify({
            success: false,
            autoFailed: true,
            note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}. No dice are rolled; narrate the failure.`,
          }),
        });
        continue;
      }

      // Validate digital dice before spending resources. Only invalid dice
      // syntax is a recoverable tool error; persistence/handler failures must
      // escape to the batch transaction so no partial roll effects commit.
      let digitalOutcome: ReturnType<typeof rollExpression> | undefined;
      if (!(sheet && realDiceUserIds.has(sheet.userId))) {
        try {
          digitalOutcome = rollExpression(resolved.expression);
        } catch (rollError) {
          turn.conversation.push({
            role: "tool",
            tool_call_id: rollCall.id,
            content: JSON.stringify({
              error: rollError instanceof Error ? rollError.message : "Invalid dice expression.",
            }),
          });
          continue;
        }
      }

      // The inspiration die and a held Help are baked into the expression
      // above, so they are spent whether the dice are digital or physical:
      // clear them now. The field carries one or both, "|"-separated.
      if (sheet && resolved.spendInspiration) {
        const { conditions, meta } = removeConditions(
          sheet.conditions,
          sheet.conditionMeta,
          resolved.spendInspiration.split("|"),
        );
        const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
        if (updated) {
          publishPersisted(campaignId, "sheet_updated", { sheet: updated });
        }
      }

      // Physical dice: park this call for the player instead of rolling.
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
          targetEnemyId:
            parsedArgs.kind === "damage" ? parsedArgs.targetEnemyId ?? null : null,
        });
        publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
        parkedAny = true;
        continue;
      }

      // Digital roll: all writes below belong to the enclosing batch.
      const outcome = digitalOutcome!;
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
      turn.rollIds.push(roll.id);
      publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
        roll,
        source: "digital",
      });
      // Combat initiative: feed the roll into the active encounter; the
      // last one in locks the order and begins combat.
      const combatNote =
        parsedArgs.kind === "initiative"
          ? recordInitiativeRoll(campaignId, sheet?.id ?? null, roll.total)
          : null;
      // Damage rolls aimed at an enemy apply server-side the moment the
      // dice land, so the enemy card can never lag the narration.
      const targetEnemyId = parsedArgs.targetEnemyId;
      const appliedDamage =
        parsedArgs.kind === "damage" && targetEnemyId
          ? executeDmTool([context, turn], () => autoApplyDamageRoll(
              campaign,
              turn,
              targetEnemyId,
              roll,
              sheets,
              sheetsById,
              parsedArgs.damageType,
            ))
          : null;
      turn.conversation.push({
        role: "tool",
        ...(rollCall.id ? { tool_call_id: rollCall.id } : {}),
        content: JSON.stringify({
          total: roll.total,
          dice: outcome.terms,
          ...(parsedArgs.dc !== undefined
            ? { dc: parsedArgs.dc, success: roll.total >= parsedArgs.dc }
            : {}),
          ...(outcome.crit ? { crit: outcome.crit } : {}),
          ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
          note: "Narrate this real result. Do not roll again for the same action.",
          ...(combatNote ? { combat: combatNote } : {}),
          ...(appliedDamage ? { applied: appliedDamage } : {}),
        }),
      });
    }

    const answered = new Set(
      turn.conversation.slice(resultStart)
        .filter((entry) => entry.role === "tool")
        .map((entry) => entry.tool_call_id),
    );
    const pendingIds = new Set(
      listPendingForTurn(turn.id).filter((roll) => roll.status === "pending").map((roll) => roll.toolCallId),
    );
    for (const call of allToolCalls) {
      if (answered.has(call.id) || pendingIds.has(call.id)) continue;
      const result = call.name === "generate_image" && offeredNames.has(call.name)
        ? (turn.imageArgs ? { ok: true, note: "Image request recorded." } : { error: "Invalid image request." })
        : { error: `Tool ${call.name} is unavailable or has no handler in this turn.` };
      turn.conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }

    if (parkedAny) {
      // Park: the queue job ends here. Submissions resume the turn.
      turn.status = "awaiting_rolls";
      saveDmTurn(turn);
      setDmStatus(campaignId, "awaiting_rolls");
      return "park";
    }

    saveDmTurn(turn);
    setDmStatus(campaignId, "narrating");
    return "continue";
    }, runtimeState));
    if (decision === "park") return;
    if (decision === "finish") break;
  }

  if (turn.status === "done") return;
  if (!failed) {
    await ensureWhisperReplies(context, turn);
    // YOLO accepts an occasional rough edge instead of paying for a corrective
    // narration pass. The authoritative tool results are still preserved.
    if (!yolo) {
      await enforceEngineBoundary(campaign, turn, MAX_MODEL_CALLS - turn.callIndex, sheets);
    }
  }
  finalize(context, turn, failed);
  if (!failed && !yolo) {
    await maybeCloseChapter(campaignId, { beatCompleted });
    if (isStageEnabled(context.campaign.gameSettings.stages, "compaction")) {
      await maybeCompactHistory(campaignId);
    }
  }
}

// Guarantees every private player message this turn carried gets a private
// reply. The model often narrates instead of calling send_whisper (or does
// nothing), which used to silently consume the message; here we nudge it once
// with an explicit whisper prompt, then fall back to a canned whisper so the
// player is never left in silence.
async function ensureWhisperReplies(context: TurnContext, turn: DmTurn) {
  if (!turn.playerWhisperIds.length) return;
  const { campaign, sheets, sheetsById } = context;
  const pending = listPendingPlayerWhispers(campaign.id).filter((whisper) =>
    turn.playerWhisperIds.includes(whisper.id),
  );
  const unanswered = () => pending.filter((whisper) =>
    whisper.characterId && !turn.answeredWhisperCharacterIds.includes(whisper.characterId),
  );
  type ModelReply = Awaited<ReturnType<typeof requestDmMessage>>["message"];
  let batch = pendingDmBatch<ModelReply>(turn.id);
  if (batch && batch.phase !== "whispers") throw new Error("An unfinished tool batch must be resolved before private replies.");
  if (batch) restoreDmBatch(turn, batch);
  if (!batch && !unanswered().length) return;
  if (!batch) {
    if (yoloDndEnabled()) {
      // Do not spend a third model call just to recover a missed private
      // reply. The normal YOLO turn exposes send_whisper; if the small model
      // misses it, the deterministic fallback below acknowledges the whisper
      // and the next scene can carry the consequence.
      batch = prepareDmBatch(
        turn,
        { role: "assistant", content: "", tool_calls: [] } as ModelReply,
        "whispers",
      );
    } else {
      const owed = unanswered().map((whisper) => `- ${whisper.characterName}: "${whisper.content}"`).join("\n");
      const { message } = await requestDmMessage(campaign.settings, [
        ...turn.conversation,
        { role: "user", content: `[System] Privately answer each message using send_whisper. Refuse out-of-character requests for levels, XP, perks, items, or abilities in-fiction. Do not narrate to the shared table.\n${owed}` },
      ], { tools: [sendWhisperTool], toolChoice: "auto", thinking: true });
      batch = prepareDmBatch(turn, message, "whispers");
    }
  }
  const preparedBatch = batch;
  const message = preparedBatch.message;
  const xmlSalvage = salvageXmlToolCalls(extractStoryText(message?.content));
  const salvage = salvageTextualToolCalls(xmlSalvage.text);
  const calls = normalizeTurnToolCalls([
    ...extractToolCalls(message?.tool_calls), ...xmlSalvage.calls, ...salvage.calls,
  ], `${turn.id}_${preparedBatch.index}`, collectTurnToolCallIds(turn.conversation));
  withGameStateRollback([context, turn], () => commitDmBatch(turn, preparedBatch, calls, () => {
    if (calls.length) turn.conversation.push({ role: "assistant", content: "", tool_calls: calls.map((call) => ({
      id: call.id, type: "function", function: { name: call.name, arguments: call.rawArguments },
    })) });
    for (const call of calls) {
      const result = call.name === "send_whisper"
        ? executeDmTool([context, turn], () => handleSendWhisper(campaign, turn.id, call.rawArguments, sheets, sheetsById))
        : { error: "Only private replies are permitted at this stage." };
      turn.conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      if (!("error" in result)) for (const characterId of (result.whisperedCharacterIds as string[] | undefined) ?? []) {
        if (!turn.answeredWhisperCharacterIds.includes(characterId)) turn.answeredWhisperCharacterIds.push(characterId);
      }
    }
    // Deterministic fallbacks are effects too: record their stable keys and
    // results in the same transaction as the delivered private message.
    for (const whisper of unanswered()) {
      if (!whisper.characterId) continue;
      const args = JSON.stringify({ characterId: whisper.characterId, message: gameText(context.language, "whisper") });
      const [fallback] = normalizeTurnToolCalls([{ id: `odm_whisper_fallback_${turn.id}_${whisper.id}`,
        name: "send_whisper", rawArguments: args }], `${turn.id}_${preparedBatch.index}_fallback`,
        collectTurnToolCallIds(turn.conversation));
      const id = fallback.id;
      deliverWhisper(campaign.id, turn.id, [{ userId: whisper.userId,
        characterId: whisper.characterId, characterName: whisper.characterName }], gameText(context.language, "whisper"));
      turn.answeredWhisperCharacterIds.push(whisper.characterId);
      calls.push({ id, name: "send_whisper", rawArguments: args });
      turn.conversation.push({ role: "assistant", content: "", tool_calls: [{
        id, type: "function", function: { name: "send_whisper", arguments: args },
      }] }, { role: "tool", tool_call_id: id,
        content: JSON.stringify({ ok: true, fallback: true, whisperedCharacterIds: [whisper.characterId] }) });
    }
    return "finish";
  }, () => dmExecutionState(turn.id)));
}

// request_player_input: hands the floor to named players and waits for them.
// Exported for the adjudication façade, which is why the parsing lives in
// parseSpotlightUserIds rather than inline in the turn loop: the AI sets this
// spotlight from a tool call and a person sets the same one from the console,
// and they must land on the identical floor state.
export function handleRequestPlayerInput(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  // Initiative owns the floor while a fight runs, exactly as the floor route
  // refuses there. Handing it to someone out of turn would break the order.
  const currentFloor = getFloor(campaign.id);
  const effectiveFloor = currentFloor.mode === "hold" ? currentFloor.next : currentFloor;
  if (getActiveEncounter(campaign.id) || effectiveFloor.mode === "initiative") {
    return { error: "The initiative order has the floor while the fight runs." };
  }
  const parsed = parseSpotlightUserIds(rawArguments, sheets, sheetsById);
  if (!parsed) {
    return { error: "Name at least one player character to give the floor to." };
  }
  const floor = {
    mode: "spotlight" as const,
    userIds: parsed.userIds,
    prompt: parsed.prompt,
    respondedUserIds: [],
  };
  setFloor(campaign.id, floor);
  publishPersisted(campaign.id, "floor_changed", { floor });
  return { ok: true, waitingOn: parsed.userIds.length };
}

// record_event: a lasting milestone on the character's permanent record
// (feeds the profile "story so far" and future GAME STATE blocks).
// Exported for the adjudication façade (src/lib/dm/invoke.ts): a human DM
// records the same milestones through the same path the model uses.
export function handleRecordEvent(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: { characterId?: unknown; kind?: unknown; summary?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const sheet = resolveSheetRef(
    typeof args.characterId === "string" ? args.characterId : undefined,
    sheets,
    sheetsById,
  );
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  // Unknown kinds fall back to "story" instead of erroring: a milestone is
  // always worth recording under some kind.
  const kind = normalizeEventKind(args.kind, CHARACTER_EVENT_KINDS) as CharacterEventKind;
  const summary = String(args.summary ?? "").trim().slice(0, 300);
  if (!summary) {
    return { error: "record_event needs a one-sentence summary." };
  }
  if (hasRecentIdenticalEvent(sheet.id, summary)) {
    return { ok: true, note: "Already recorded." };
  }
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

// move_party / update_location: record the structured area state, keep the
// campaign scene in sync, and kick off a map render when vision allows.
// Exported for the adjudication façade (src/lib/dm/invoke.ts).
export function handleLocationCall(
  campaign: Campaign,
  toolName: string,
  rawArguments: string,
): Record<string, unknown> {
  let args: {
    name?: unknown;
    layoutDescription?: unknown;
    connections?: unknown;
    visionClear?: unknown;
  };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments." };
  }
  const layoutDescription =
    typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections)
    ? args.connections.map(String).slice(0, 12)
    : undefined;
  const visionClear = args.visionClear === true;

  let location;
  let previousLayout = "";
  let movedToNewLocation = false;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) {
      return { error: "move_party needs a location name." };
    }
    const previous = getCurrentLocation(campaign.id);
    location = upsertCurrentLocation({
      campaignId: campaign.id,
      name,
      layoutDescription,
      connections,
    });
    movedToNewLocation = !previous || previous.id !== location.id;
    // Keep the old area linked to the new one so routes stay consistent.
    if (previous && previous.id !== location.id) {
      const merged = [...new Set([...location.connections, previous.name])];
      if (merged.length !== location.connections.length) {
        location =
          updateCurrentLocationDetails(campaign.id, { connections: merged }) ?? location;
      }
    }
    setCampaignScene(campaign.id, location.name);
  } else {
    previousLayout = getCurrentLocation(campaign.id)?.layoutDescription ?? "";
    location = updateCurrentLocationDetails(campaign.id, { layoutDescription, connections });
    if (!location) {
      return { error: "No current location; call move_party first." };
    }
  }

  publishPersisted(campaign.id, "location_updated", { location });

  // The place is what the room should be hearing. Inferred rather than
  // asked for, so a DM who never touches the sound controls still gets a
  // cave that sounds like one; a held layer and a table with scene
  // following switched off are both left alone inside the helper.
  followSceneAmbience(campaign, `${location.name} ${location.layoutDescription}`);

  // Render when the area has no map yet, or when an update materially
  // changed the recorded layout.
  const layoutRevised =
    toolName === "update_location" && location.layoutDescription !== previousLayout;
  const mapEnqueued =
    visionClear &&
    campaign.gameSettings.mapsEnabled &&
    imageProducerReady(campaign.settings.imageBackend, campaign.settings) &&
    (!location.mapImage || layoutRevised);
  if (mapEnqueued) {
    enqueueDmMediaIntent(campaign.id, { kind: "map", targetId: location.id,
      name: location.name, layout: location.layoutDescription, previousImageId: location.mapImage?.id ?? null });
  }

  return {
    ok: true,
    location: location.name,
    note: "Recorded. Continue the scene.",
    // Consumed by advance() as the chapter-break and inline-map signals,
    // then stripped before the result reaches the model.
    ...(movedToNewLocation
      ? {
          movedToNewLocation: true,
          _locationId: location.id,
          _mapAvailable: mapEnqueued || Boolean(location.mapImage),
        }
      : {}),
  };
}

function parseSpotlightUserIds(
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { userIds: string[]; prompt: string } | null {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as {
      characterIds?: unknown;
      prompt?: unknown;
    };
    const ids = Array.isArray(parsed.characterIds) ? parsed.characterIds.map(String) : [];
    const userIds = [
      ...new Set(
        ids
          .map((requested) => resolveSheetRef(requested, sheets, sheetsById))
          // A spotlight on an AI companion would hand the floor to a user
          // nobody controls and freeze the table; only humans get it.
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
  withGameStateRollback([context, turn], () => commitDmFinalization(turn, () => finalizeInTransaction(context, turn, failed)));
}

function finalizeInTransaction(context: TurnContext, turn: DmTurn, failed: string) {
  const campaignId = context.campaign.id;

  if (failed) {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: `${DM_HALTED_PREFIX}${failed}`,
      // Link the notice to the halted turn so the lead can retry it from its
      // persisted conversation (src/lib/dm/retry-turn.ts) instead of retyping
      // the action, which would duplicate it in the transcript.
      dmTurnId: turn.id,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    setDmStatus(campaignId, "idle");
    turn.status = "failed";
    saveDmTurn(turn);
    return;
  }

  // Mark a player whisper answered only when its sender actually received a
  // reply this turn (ensureWhisperReplies guarantees one, real or fallback),
  // or when it is unanswerable (its character is gone). A whisper with no
  // reply stays pending so the next turn retries instead of it vanishing.
  // Failed turns return above, so they stay pending too.
  if (turn.playerWhisperIds.length) {
    const answeredWhisperIds = listPendingPlayerWhispers(campaignId)
      .filter(
        (whisper) =>
          turn.playerWhisperIds.includes(whisper.id) &&
          (!whisper.characterId ||
            turn.answeredWhisperCharacterIds.includes(whisper.characterId)),
      )
      .map((whisper) => whisper.id);
    markPlayerWhispersAnswered(answeredWhisperIds, turn.id);
  }

  // A purely private exchange (whispers in, send_whisper out, no narration,
  // no rolls) writes nothing to the shared chat; the fallback line below
  // would leak that a secret exchange happened at all.
  if (turn.playerWhisperIds.length && !turn.narrationParts.join("").trim() && !turn.rollIds.length) {
    setDmStatus(campaignId, "idle");
    if (!yoloDndEnabled()) tickWorldState(campaignId);
    turn.status = "done";
    saveDmTurn(turn);
    return;
  }

  // Persist the turn: narration segments joined, roll markers appended so
  // the UI renders dice cards inline between narration and interpretation.
  const narrationParts = turn.narrationParts;
  let content = narrationParts.join("\n\n").trim();
  if (!content) {
    content = gameText(context.language, "moment");
  }
  if (turn.rollIds.length && narrationParts.length > 1) {
    const lastPart = narrationParts[narrationParts.length - 1];
    const earlier = narrationParts.slice(0, -1).join("\n\n");
    content = `${earlier}\n\n${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${lastPart}`;
  } else if (turn.rollIds.length) {
    content = `${turn.rollIds.map((id) => `[roll:${id}]`).join("\n")}\n\n${content}`;
  }

  const imageEnabled =
    context.campaign.settings.imageGenerationEnabled && context.campaign.settings.autoImages;
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "dm",
    content,
    imageRequest:
      imageEnabled && turn.imageArgs?.prompt
        ? {
            needed: true,
            prompt: turn.imageArgs.prompt,
            mode: context.campaign.settings.imageMode,
            backend: context.campaign.settings.imageBackend,
            aspect: context.campaign.settings.aspect,
            reason: turn.imageArgs.reason,
            characterIds: [],
          }
        : undefined,
    locationId: turn.locationId ?? undefined,
    // Links the narration back to the conversation it came from so the lead
    // can reroll its prose (src/lib/dm/renarrate.ts) without re-running the
    // turn's tools.
    dmTurnId: turn.id,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
  setDmStatus(campaignId, "idle");

  // Combat bookkeeping: if the current PC's turn was adjudicated, hand the
  // initiative pointer to the next living PC now, after the narration
  // landed, so the server's next-turn note follows it in the transcript.
  // Runs before the hold below so a hold wraps the NEW turn's floor.
  advanceAfterTurn(context.campaign, turn);

  // A legacy do/say during initiative is exclusive while it is narrated but
  // does not assert an end of turn. Release its stored initiative floor now;
  // structured bundles instead advanced through their explicit end_turn.
  const combatGate = getFloor(campaignId);
  if (combatGate.mode === "hold" && combatGate.combat &&
    (!combatGate.combat.requiresEndTurn || combatGate.combat.mechanicsResolved) &&
    !listOpenPendingRolls(campaignId).length) {
    setFloor(campaignId, combatGate.next);
    publishPersisted(campaignId, "floor_changed", { floor: combatGate.next });
  }

  // Held responses: after a successful narration the table is locked for
  // discussion until the lead releases. A spotlight set this turn becomes
  // the floor that takes effect on release.
  if (context.campaign.gameSettings.holdSubmissions) {
    const current = getFloor(campaignId);
    if (current.mode !== "hold") {
      const held = { mode: "hold" as const, next: current };
      setFloor(campaignId, held);
      publishPersisted(campaignId, "floor_changed", { floor: held });
    }
  }

  if (message.imageRequest && imageProducerReady(context.campaign.settings.imageBackend, context.campaign.settings)) {
    enqueueDmMediaIntent(campaignId, { kind: "image", targetId: message.id });
  }
  if (context.campaign.gameSettings.ttsEnabled) {
    enqueueDmMediaIntent(campaignId, { kind: "tts", targetId: message.id,
      voice: context.campaign.gameSettings.ttsVoice });
  }

  if (!yoloDndEnabled()) tickWorldState(campaignId);
  turn.status = "done";
  saveDmTurn(turn);
  queueSkippedCombatTurn(campaignId);
}
