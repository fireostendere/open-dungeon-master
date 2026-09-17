import { z } from "zod";
import { isOocMessage } from "@/lib/campaign-types";
import { isNarratorEvent } from "@/lib/mcp-event-filter";
import { getCampaignById, getCampaignSummaryState, latestSeq, listMembers, setFloor } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { getDmTurn, listOpenPendingRolls } from "@/lib/db/dm-turns";
import { listRecentWhispersForPrompt, listPendingPlayerWhispers } from "@/lib/db/dm-whispers";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { listActiveFacts } from "@/lib/db/facts";
import { getCurrentLocation } from "@/lib/db/locations";
import { listMessagesInSeqRange, listRecentMessages } from "@/lib/db/messages";
import { listPublicCampaignNotes } from "@/lib/db/notes";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSceneTracker } from "@/lib/db/scene-tracker";
import { listSheets } from "@/lib/db/sheets";
import { consoleAdjudications } from "@/lib/dm/invoke-catalog";
import { invokeEngineSynchronous } from "@/lib/dm/invoke";
import { persistHumanNarration } from "@/lib/dm/human-narration";
import { executeNarratorCommand, NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";
import { listNarratorReceipts } from "@/lib/db/narrator-commands";
import { coverInEffect } from "@/lib/dm/delegation";
import { npcRosterForPrompt } from "@/lib/dm/social-tools";
import { answerAsk, listPendingAsksForCampaign, AskQueueConflict } from "@/lib/db/asks";
import { budgetRead, ReadBudgetError } from "@/lib/mcp-read-budget.mjs";
import { listEventsSince, publishEphemeral, publishPersisted, publishUserEphemeral } from "@/lib/events";

export { NarratorCommandError as McpNarratorControlError } from "@/lib/dm/narrator-command";

const id = z.string().uuid();
const readSchema = z.object({
  campaignId: id, afterSeq: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  afterAskSeq: z.number().int().min(0).default(0),
  askLimit: z.number().int().min(1).max(50).default(20),
  paged: z.boolean().default(false), pageCursor: z.string().max(500).optional(),
  maxBytes: z.number().int().min(4096).max(131072).default(65536),
  projection: z.enum(["full", "live"]).default("full"),
}).strict();
const writeBase = z.object({ campaignId: id, expectedSeq: z.number().int().min(0), commandId: id.optional() }).strict();

// This is intentionally a literal allowlist, not "all console actions minus
// today's unsafe ones": future AI-producing adjudications stay unavailable.
export const EXTERNAL_NARRATOR_ACTIONS = new Set([
  "start_encounter", "add_enemies", "pc_attack", "enemy_attack", "damage_enemy", "cast_at_enemy", "cast_at_player", "cast_buff", "aoe_damage", "split_damage", "set_enemy_condition", "clear_enemy_condition", "enemy_flees", "take_action", "use_reaction", "apply_hazard", "end_turn", "end_encounter", "move_token",
  "apply_damage", "heal", "stabilize", "award_xp", "party_stash", "party_award", "modify_gold", "grant_item", "reveal_item", "remove_item", "use_item", "purchase", "use_resource", "set_condition", "set_effect", "clear_effect", "clear_condition", "use_spell_slot", "learn_spell", "update_sheet", "take_rest",
  "move_party", "update_location", "travel", "pass_time", "start_scene", "scene_check", "end_scene", "request_roll", "request_player_input", "send_whisper", "record_event", "complete_beat", "write_campaign_note", "set_ambience", "play_sting",
  "set_npc", "npc_reaction", "social_check", "relationship_beat", "romance_advance", "relationship_end", "summon_pet", "pet_attack", "damage_pet", "dismiss_pet",
]);

function campaignOrHuman(campaignId: string) {
  const campaign = getCampaignById(campaignId);
  if (!campaign) throw new McpNarratorControlError("Campaign not found.", 404);
  if (campaign.gameSettings.dmMode !== "human" || !campaign.dmUserId || coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover)) {
    throw new McpNarratorControlError("External narration requires a human-DM campaign with a DM seat.", 409);
  }
  if (campaign.gameSettings.ttsEnabled || campaign.gameSettings.mapsEnabled) {
    throw new McpNarratorControlError("External narration requires TTS and automatic maps to be disabled.", 409);
  }
  return campaign;
}

function safeCampaign(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
  return {
    id: campaign.id, title: campaign.title, description: campaign.description,
    status: campaign.status, theme: campaign.theme, scene: campaign.scene, questLog: campaign.questLog,
    difficulty: campaign.difficulty, startingLevel: campaign.startingLevel,
    dmMode: campaign.gameSettings.dmMode, dmUserId: campaign.dmUserId,
    gameSettings: campaign.gameSettings, dmOutline: campaign.dmOutline, storyArc: campaign.storyArc,
    floor: campaign.floor, clock: campaign.clock, party: campaign.party,
  };
}

function catalog() {
  return consoleAdjudications().map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => EXTERNAL_NARRATOR_ACTIONS.has(entry.name)).map((entry) => entry.name === "send_whisper"
      ? { ...entry, fields: [...entry.fields, { name: "replyToWhisperIds", label: "Incoming whisper IDs", kind: "text" as const,
        help: "Exact IDs from playerWhispers. Reply and acknowledge only these messages, never later arrivals." }] }
      : entry),
  })).filter((group) => group.entries.length);
}

function read(raw: unknown) {
  const p = readSchema.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  const campaign = campaignOrHuman(p.data.campaignId);
  const currentSeq = latestSeq(campaign.id);
  if (p.data.afterSeq > currentSeq) {
    throw new McpNarratorControlError("Narrator cursor is ahead of campaign state; reconnect from a fresh read.", 409);
  }
  const fetched = listEventsSince(campaign.id, p.data.afterSeq, p.data.limit + 1);
  const hasMore = fetched.length > p.data.limit;
  const events = fetched.slice(0, p.data.limit);
  // Advance over the ORIGINAL page, including OOC entries. Only the projection
  // is filtered, so an OOC-only page can never strand a client at its old cursor.
  // Also tolerate sequence gaps left by a crashed writer once the feed is drained.
  const nextCursor = hasMore ? events.at(-1)?.seq ?? p.data.afterSeq : currentSeq;
  const messages = nextCursor > p.data.afterSeq
    ? listMessagesInSeqRange(campaign.id, p.data.afterSeq + 1, nextCursor).filter((msg) => !isOocMessage(msg))
    : [];
  const askPage = listPendingAsksForCampaign(campaign.id, p.data.afterAskSeq, p.data.askLimit);
  const live = p.data.projection === "live";
  const state = {
    campaign: safeCampaign(campaign), currentSeq,
    cursor: p.data.afterSeq, nextCursor,
    hasMore,
    // Event payloads may be client projections; command arguments never enter
    // this audit feed. The matching persisted transcript rows carry prose.
    events: events.filter(isNarratorEvent).map((event) => event.type === "roll_result"
      ? { seq: event.seq, type: event.type, payload: event.payload }
      : { seq: event.seq, type: event.type }),
    messages,
    commands: listNarratorReceipts(campaign.id),
    summary: getCampaignSummaryState(campaign.id),
    members: listMembers(campaign.id), sheets: listSheets(campaign.id),
    pendingRolls: listOpenPendingRolls(campaign.id),
    recentRolls: live ? [] : listRecentRolls(campaign.id, 100),
    playerWhispers: listPendingPlayerWhispers(campaign.id),
    recentDmWhispers: live ? [] : listRecentWhispersForPrompt(campaign.id),
    recentMessages: live ? [] : listRecentMessages(campaign.id, 400).filter((msg) => !isOocMessage(msg)),
    omittedSections: live ? ["recentRolls", "recentDmWhispers", "recentMessages", "chapters"] : [],
    asks: askPage.items,
    askQueue: { nextCursor: askPage.nextCursor, hasMore: askPage.hasMore },
    notes: listPublicCampaignNotes(campaign.id, 20),
    npcs: npcRosterForPrompt(campaign.id).slice(0, 100),
    facts: listActiveFacts(campaign.id), chapters: live ? [] : listChapters(campaign.id),
    location: getCurrentLocation(campaign.id), sceneTracker: getSceneTracker(campaign.id),
    encounter: (() => { const encounter = getActiveEncounter(campaign.id); return encounter ? { encounter, enemies: listEnemies(encounter.id) } : null; })(),
  };
  try { return budgetRead(state, p.data); }
  catch (error) {
    if (error instanceof ReadBudgetError) throw new McpNarratorControlError(error.message, error.status);
    throw error;
  }
}

function serializedWrite(
  params: z.infer<typeof writeBase>, operation: string, payload: unknown,
  work: (campaign: NonNullable<ReturnType<typeof getCampaignById>>) => Record<string, unknown>,
) {
  return executeNarratorCommand({ ...params, operation, payload, work, loadState: () => {
    const campaign = campaignOrHuman(params.campaignId);
    if (campaign.kind !== "campaign" || campaign.status !== "active") {
      throw new McpNarratorControlError("External narrator writes require an active campaign.", 409);
    }
    return campaign;
  } });
}

async function invoke(raw: unknown) {
  const p = writeBase.extend({ name: z.string().trim().min(1).max(100), args: z.record(z.string(), z.unknown()).default({}) }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  if (!EXTERNAL_NARRATOR_ACTIONS.has(p.data.name)) {
    throw new McpNarratorControlError("That action is not available to an external narrator.", 403);
  }
  return serializedWrite(p.data, "narrator.invoke", { name: p.data.name, args: p.data.args }, (campaign) => {
    const outcome = invokeEngineSynchronous(campaign, { kind: "human", userId: campaign.dmUserId! }, { name: p.data.name, args: p.data.args });
    if (!outcome.ok) throw new McpNarratorControlError(outcome.error);
    return outcome;
  });
}

async function narrate(raw: unknown) {
  const p = writeBase.extend({ content: z.string().trim().min(1).max(8000), turnId: id.optional() }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.narrate", { content: p.data.content, turnId: p.data.turnId }, (campaign) => {
    if (p.data.turnId) {
      const turn = getDmTurn(p.data.turnId);
      if (!turn || turn.campaignId !== campaign.id || turn.actor !== "human_dm") throw new McpNarratorControlError("Narration turn does not belong to this human-DM campaign.", 409);
    }
    const message = persistHumanNarration(campaign, p.data.content, campaign.dmUserId!);
    // The receipt links narration to an explicit adjudication. Narration never
    // advances an arbitrary latest turn or repeats an end_turn transition.
    return { messageId: message.id, ...(p.data.turnId ? { turnId: p.data.turnId } : {}) };
  });
}

async function releaseFloor(raw: unknown) {
  const p = writeBase.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data, "narrator.release_floor", {}, (campaign) => {
    const floor = campaign.floor.mode === "hold" ? campaign.floor.next : campaign.floor;
    setFloor(campaign.id, floor);
    publishPersisted(campaign.id, "floor_changed", { floor });
    return { floor };
  });
}

export async function executeMcpNarratorControl(action: string, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown }> {
  switch (action) {
    case "narrator.connect": {
      const p = z.object({ campaignId: id, paged: z.boolean().optional(), maxBytes: z.number().int().min(4096).max(131072).optional(), projection: z.enum(["full", "live"]).optional() }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      campaignOrHuman(p.data.campaignId);
      return { handled: true, result: { instructions: "Read odm://narrator/playbook. Call narrator.read, drain until hasMore is false, then use its currentSeq as expectedSeq for exactly one invoke, narrate, or release_floor. Persist a unique commandId before each story write. After an ambiguous error, retry only the identical commandId, expectedSeq and payload to recover its receipt, never regenerate or modify a command. Reread after every confirmed write. end_turn advances initiative itself; narration never advances it. For a private reply provide exact replyToWhisperIds from playerWhispers. Check the pending asks queue on every read even when the story cursor is unchanged. Page it using afterAskSeq and askQueue.nextCursor. answer_ask requires the pending ask version as expectedVersion and a persisted commandId; it changes no story/floor state. For bounded reads use paged:true and drain pageCursor/nextPage before advancing the story cursor. A changed snapshot requires restarting that read; never use incomplete pages. projection:live explicitly omits historical duplicate sections, not current state or new tool results.", contractVersion: 2, state: read(p.data) } };
    }
    case "narrator.read": return { handled: true, result: read(raw) };
    case "narrator.catalog": return { handled: true, result: { groups: catalog() } };
    case "narrator.invoke": return { handled: true, result: await invoke(raw) };
    case "narrator.narrate": return { handled: true, result: await narrate(raw) };
    case "narrator.release_floor": return { handled: true, result: await releaseFloor(raw) };
    case "narrator.answer_ask": {
      const p = z.object({
        campaignId: id,
        askId: id,
        expectedVersion: z.number().int().min(0).default(0),
        commandId: id.optional(),
        expectedSeq: z.number().int().min(0).optional(),
        answer: z.string().trim().min(1).max(4000),
        citations: z.array(z.object({
          kind: z.enum(["fact", "chapter", "scene", "summary", "npc", "place", "rule", "sheet", "recent"]),
          ref: z.string().max(300),
          quote: z.string().max(2000),
        }).strict()).max(50).default([]),
      }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      const campaign = campaignOrHuman(p.data.campaignId);
      if (p.data.expectedSeq !== undefined && p.data.expectedSeq !== latestSeq(campaign.id)) {
        throw new McpNarratorControlError("Stale narrator cursor; reread before answering.", 409);
      }
      let updated;
      try {
        updated = answerAsk(campaign.id, p.data.askId, p.data.answer, p.data.citations,
          { expectedVersion: p.data.expectedVersion, commandId: p.data.commandId });
      } catch (error) {
        if (error instanceof AskQueueConflict) throw new McpNarratorControlError(error.message, 409);
        throw error;
      }
      if (!updated) throw new McpNarratorControlError("Ask not found in this campaign.", 404);
      if (updated.visibility === "table") publishEphemeral(campaign.id, "ask_activity", {});
      else publishUserEphemeral(campaign.id, updated.userId, "ask_activity", {});
      return { handled: true, result: { ok: true, ask: updated } };
    }
    default: return { handled: false };
  }
}
