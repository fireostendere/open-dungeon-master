import { z } from "zod";
import { isOocMessage } from "@/lib/campaign-types";
import { getCampaignById, getCampaignSummaryState, latestSeq, listMembers, setFloor } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
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
import { invokeEngine } from "@/lib/dm/invoke";
import { persistHumanNarration } from "@/lib/dm/human-narration";
import { enqueueDmJob } from "@/lib/dm/queue";
import { coverInEffect } from "@/lib/dm/delegation";
import { npcRosterForPrompt } from "@/lib/dm/social-tools";
import { listEventsSince, publishPersisted } from "@/lib/events";

export class McpNarratorControlError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const id = z.string().uuid();
const readSchema = z.object({ campaignId: id, afterSeq: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
const writeBase = z.object({ campaignId: id, expectedSeq: z.number().int().min(0) }).strict();

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
    entries: group.entries.filter((entry) => EXTERNAL_NARRATOR_ACTIONS.has(entry.name)),
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
  // If the final allocated sequence has no persisted event (a crashed writer),
  // advance only after the persisted stream is drained so clients cannot loop.
  const nextCursor = hasMore ? events.at(-1)?.seq ?? p.data.afterSeq : currentSeq;
  const messages = nextCursor > p.data.afterSeq
    ? listMessagesInSeqRange(campaign.id, p.data.afterSeq + 1, nextCursor).filter((msg) => !isOocMessage(msg))
    : [];
  return {
    campaign: safeCampaign(campaign), currentSeq,
    cursor: p.data.afterSeq, nextCursor,
    hasMore,
    // Event payloads may be client projections; command arguments never enter
    // this audit feed. The matching persisted transcript rows carry prose.
    events: events.map((event) => event.type === "roll_result"
      ? { seq: event.seq, type: event.type, payload: event.payload }
      : { seq: event.seq, type: event.type }),
    messages,
    summary: getCampaignSummaryState(campaign.id),
    members: listMembers(campaign.id), sheets: listSheets(campaign.id),
    pendingRolls: listOpenPendingRolls(campaign.id),
    recentRolls: listRecentRolls(campaign.id, 100),
    playerWhispers: listPendingPlayerWhispers(campaign.id),
    recentDmWhispers: listRecentWhispersForPrompt(campaign.id),
    recentMessages: listRecentMessages(campaign.id, 400).filter((msg) => !isOocMessage(msg)),
    notes: listPublicCampaignNotes(campaign.id, 20),
    npcs: npcRosterForPrompt(campaign.id).slice(0, 100),
    facts: listActiveFacts(campaign.id), chapters: listChapters(campaign.id),
    location: getCurrentLocation(campaign.id), sceneTracker: getSceneTracker(campaign.id),
    encounter: (() => { const encounter = getActiveEncounter(campaign.id); return encounter ? { encounter, enemies: listEnemies(encounter.id) } : null; })(),
  };
}

async function serializedWrite(campaignId: string, expectedSeq: number, work: (campaign: NonNullable<ReturnType<typeof getCampaignById>>) => Promise<unknown> | unknown) {
  let outcome: unknown;
  let failure: McpNarratorControlError | undefined;
  await enqueueDmJob(campaignId, async () => {
    try {
      const campaign = campaignOrHuman(campaignId);
      if (campaign.kind !== "campaign" || campaign.status !== "active") {
        throw new McpNarratorControlError("External narrator writes require an active campaign.", 409);
      }
      if (latestSeq(campaignId) !== expectedSeq) {
        throw new McpNarratorControlError("Stale narrator cursor; reread and drain events before writing.", 409);
      }
      // A durable, argument-free marker makes an ambiguous request non-retryable.
      publishPersisted(campaignId, "narrator_command_attempted", {});
      outcome = await work(campaign);
    } catch (error) {
      failure = error instanceof McpNarratorControlError
        ? error
        : new McpNarratorControlError(error instanceof Error ? error.message : "Narrator command failed.", 500);
    }
  });
  if (failure) throw failure;
  return { result: outcome, currentSeq: latestSeq(campaignId) };
}

async function invoke(raw: unknown) {
  const p = writeBase.extend({ name: z.string().trim().min(1).max(100), args: z.record(z.string(), z.unknown()).default({}) }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  if (!EXTERNAL_NARRATOR_ACTIONS.has(p.data.name)) {
    throw new McpNarratorControlError("That action is not available to an external narrator.", 403);
  }
  return serializedWrite(p.data.campaignId, p.data.expectedSeq, async (campaign) => {
    const outcome = await invokeEngine(campaign, { kind: "human", userId: campaign.dmUserId! }, { name: p.data.name, args: p.data.args });
    if (!outcome.ok) throw new McpNarratorControlError(outcome.error);
    return outcome;
  });
}

async function narrate(raw: unknown) {
  const p = writeBase.extend({ content: z.string().trim().min(1).max(8000) }).safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data.campaignId, p.data.expectedSeq, (campaign) => {
    const message = persistHumanNarration(campaign, p.data.content, campaign.dmUserId!);
    return { messageId: message.id };
  });
}

async function releaseFloor(raw: unknown) {
  const p = writeBase.safeParse(raw);
  if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
  return serializedWrite(p.data.campaignId, p.data.expectedSeq, (campaign) => {
    const floor = campaign.floor.mode === "hold" ? campaign.floor.next : campaign.floor;
    setFloor(campaign.id, floor);
    publishPersisted(campaign.id, "floor_changed", { floor });
    return { floor };
  });
}

export async function executeMcpNarratorControl(action: string, raw: unknown): Promise<{ handled: false } | { handled: true; result: unknown }> {
  switch (action) {
    case "narrator.connect": {
      const p = z.object({ campaignId: id }).strict().safeParse(raw);
      if (!p.success) throw new McpNarratorControlError(z.prettifyError(p.error));
      campaignOrHuman(p.data.campaignId);
      return { handled: true, result: { instructions: "Call narrator.read, drain until hasMore is false, then use its currentSeq as expectedSeq for exactly one invoke, narrate, or release_floor. Reread after every write or ambiguous error; never retry a write automatically.", state: read({ campaignId: p.data.campaignId }) } };
    }
    case "narrator.read": return { handled: true, result: read(raw) };
    case "narrator.catalog": return { handled: true, result: { groups: catalog() } };
    case "narrator.invoke": return { handled: true, result: await invoke(raw) };
    case "narrator.narrate": return { handled: true, result: await narrate(raw) };
    case "narrator.release_floor": return { handled: true, result: await releaseFloor(raw) };
    default: return { handled: false };
  }
}
