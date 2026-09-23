import { z } from "zod";
import { getDatabase } from "@/lib/db/core";
import { afterCommit } from "@/lib/db/commit-effects";
import { notifySpatialChange } from "@/lib/spatial/updates.mjs";
import { allocateSeq, campaignSeats, capsFor, getCampaignForUser, getGlobalTurnState, listMembers, touchCampaign } from "@/lib/db/campaigns";
import { getSheetForUser } from "@/lib/db/sheets";
import { getActiveEncounter } from "@/lib/db/encounters";
import { isMemberMuted } from "@/lib/db/moderation";
import { coverInEffect } from "@/lib/dm/delegation";
import { recordGlobalTurnAction, resolveGlobalTurn } from "@/lib/dm/global-turn-logic";
import { isDmSeat } from "@/lib/dm/viewer";
import { createSpatialStore, SpatialError, type SpatialActor, type SpatialStore } from "@/lib/spatial/store.mjs";
import { capturePreSpatialEntities } from "@/lib/spatial/domain-migration";
import { normalizeNarrationUnits } from "@/lib/units/narration";
import { publishEphemeral } from "@/lib/events";
import { queuePlayerAction } from "@/lib/integrations/rakobot";

export { SpatialError } from "@/lib/spatial/store.mjs";
const stores = new WeakMap<ReturnType<typeof getDatabase>, SpatialStore>();
export function spatialStore(): SpatialStore {
  const db = getDatabase();
  let store = stores.get(db);
  // A first initialization can occur inside a later-rolled-back command.
  // Recheck schema existence rather than caching a rolled-back DDL state.
  if (!store || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_campaigns'").get()) { store = createSpatialStore(db, { nextSeq: allocateSeq }); stores.set(db, store); }
  return store;
}
export const spatialEnabled = (campaignId: string) => spatialStore().enabled(campaignId);

// Re-resolve membership and role AFTER parsing the body. Never trust a client
// actor, member list, DM flag, location, or a prior request's authorization.
export function spatialContext(campaignId: string, userId: string) {
  const campaign = getCampaignForUser(campaignId, userId);
  if (!campaign) throw new SpatialError("Campaign not found.", 404);
  const members = listMembers(campaignId), seats = campaignSeats(campaign);
  const actor: SpatialActor = { campaignId, userId, isDm: capsFor(campaign, userId).role === "dm",
    memberIds: members.map(member => member.userId),
    playerIds: members.filter(member => !isDmSeat(seats, member.userId)).map(member => member.userId) };
  return { campaign, actor };
}

const id = z.string().uuid();
const base = { requestId: id };
const passage = { walkable: z.boolean().optional(), sound: z.boolean().optional(), sight: z.boolean().optional() };
const revision = z.number().int().min(1).optional();
export const spatialCommandSchema = z.discriminatedUnion("operation", [
  z.object({ ...base, operation: z.literal("enable"), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ ...base, operation: z.literal("disable") }).strict(),
  z.object({ ...base, operation: z.literal("create_room"), name: z.string().trim().min(1).max(80), connectTo: id.optional(), ...passage }).strict(),
  z.object({ ...base, operation: z.literal("link"), sourceId: id, targetId: id, ...passage }).strict(),
  z.object({ ...base, operation: z.literal("move"), roomId: id, userIds: z.array(id).min(1).max(20).optional(), expectedRevision: revision }).strict(),
  z.object({ ...base, operation: z.literal("send"), roomId: id.nullable().optional(), kind: z.enum(["say", "do", "narration", "ooc"]), content: z.string().trim().min(1).max(8000), expectedRevision: revision, stealth: z.boolean().optional(), characterId: z.string().optional() }).strict(),
  z.object({ ...base, operation: z.literal("observe"), roomId: id, userId: id, mode: z.enum(["speech", "scry"]), seconds: z.number().int().min(1).max(3600), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...base, operation: z.literal("revoke"), grantId: id }).strict(),
  z.object({ ...base, operation: z.literal("propagate"), roomId: id, medium: z.enum(["sound", "sight"]), content: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, operation: z.literal("perceive"), roomId: id, userIds: z.array(id).min(1).max(20), content: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, operation: z.literal("stealth_resolve"), messageId: z.string().min(1).max(100), outcome: z.enum(["confirmed", "revealed", "failed"]), characterId: z.string().optional(), detectedByUserIds: z.array(z.string()).optional(), perceivedText: z.string().max(2000).optional(), sense: z.enum(["sight", "sound", "both", "special"]).optional() }).strict(),
  z.object({ ...base, operation: z.literal("detect"), observerId: z.string().min(1).max(100), targetId: z.string().min(1).max(100), roomId: id.optional(), sense: z.enum(["sight", "sound", "both", "special"]).optional(), state: z.enum(["detected", "unaware", "suspected"]).optional(), expiresAt: z.string().optional() }).strict(),
  z.object({ ...base, operation: z.literal("lose_detection"), observerId: z.string().min(1).max(100), targetId: z.string().min(1).max(100) }).strict(),
  z.object({ ...base, operation: z.literal("set_floor"), roomId: id, floor: z.unknown().optional() }).strict(),
]);

export function runSpatialCommand(campaignId: string, userId: string, raw: unknown) {
  const parsed = spatialCommandSchema.safeParse(raw);
  if (!parsed.success) throw new SpatialError(z.prettifyError(parsed.error));
  const { campaign, actor } = spatialContext(campaignId, userId);
  const command = parsed.data;
  const ooc = command.operation === "send" && command.kind === "ooc";
  if (campaign.kind !== "campaign" || (campaign.status !== "active" && !ooc)) {
    throw new SpatialError("Location actions require an active campaign.", 409);
  }
  if (campaign.gameSettings.dmMode !== "human" || !campaign.dmUserId) {
    throw new SpatialError("Location chat requires a human DM seat (including an external MCP narrator).", 409);
  }
  if (!ooc && coverInEffect(campaign.gameSettings.dmMode, campaign.gameSettings.dmAssist, campaign.dmCover)) {
    throw new SpatialError("End AI cover before using location chat.", 409);
  }
  if (isMemberMuted(campaignId, userId)) throw new SpatialError("The party lead has muted you at this table.", 403);
  if (!actor.isDm && !ooc) {
    if (!getSheetForUser(campaignId, userId)) throw new SpatialError("You need a character to act.", 409);
    if (command.operation === "move") {
      const userRoom = spatialStore().getUserRoom(campaignId, userId);
      if (userRoom && getActiveEncounter(campaignId, userRoom)) {
        throw new SpatialError("Ask the DM to adjudicate movement during an encounter.", 409);
      }
    }
  }
  const { operation, requestId, ...input } = command;
  let globalTurnResolution: { roundNumber: number } | null = null;
  let spatialModeChanged: boolean | null = null;
  const result = getDatabase().transaction(() => {
    const previouslyEnabled = spatialStore().enabled(campaignId);
    const alreadyProcessed = getDatabase().prepare("SELECT 1 FROM spatial_requests WHERE campaign_id=? AND actor_id=? AND request_id=?")
      .get(campaignId, userId, requestId);
    const result = spatialStore().command(actor, requestId, operation, input, (raw) =>
      actor.isDm && ["send", "propagate", "perceive"].includes(operation) && typeof raw.content === "string"
        ? { ...raw, content: normalizeNarrationUnits(raw.content, campaign.gameSettings.unitSystem) }
        : raw);

    // Spatial player chat participates in the same global-round barrier as the
    // legacy composer. Run this inside the same DB transaction so a locked
    // round or duplicate do/say rolls the spatial message back as well.
    if (
      !actor.isDm &&
      operation === "send" &&
      (command.kind === "do" || command.kind === "say") &&
      campaign.gameSettings.globalTurn?.enabled
    ) {
      const sheet = getSheetForUser(campaignId, userId);
      if (!sheet) throw new SpatialError("You need a character to act.", 409);
      const turn = recordGlobalTurnAction(
        campaignId,
        sheet.id,
        userId,
        command.kind,
      );
      if (!turn.allowed) {
        throw new SpatialError(turn.error ?? "This round is not accepting input.", 409);
      }
      if (turn.shouldResolve) {
        globalTurnResolution = { roundNumber: getGlobalTurnState(campaignId).roundNumber };
      }
    }

    // The action and its notification reference commit/roll back together.
    // Never enqueue historical request replays after integration is enabled.
    if (!alreadyProcessed && !actor.isDm && operation === "send" && (command.kind === "do" || command.kind === "say")) {
      const message = result.message as { id?: string } | undefined;
      if (message?.id) queuePlayerAction(campaignId, "spatial", message.id, command.kind);
    }

    // Exact retry of enable must not capture newer text as pre-spatial history.
    if (operation === "enable" && !previouslyEnabled) capturePreSpatialEntities(campaignId);
    const enabledNow = spatialStore().enabled(campaignId);
    if (enabledNow !== previouslyEnabled) spatialModeChanged = enabledNow;
    return result;
  })();
  const resolution = globalTurnResolution as { roundNumber: number } | null;
  if (resolution) {
    void resolveGlobalTurn(campaignId, resolution.roundNumber).catch((error) =>
      console.error("[global-turn] Failed to seal spatial round:", error),
    );
  }
  touchCampaign(campaignId);
  if (spatialModeChanged !== null) {
    // Mode itself is table-global metadata. Room contents still never enter
    // the shared stream; this nudge only tells clients whether to start/stop
    // their identity-bound location long poll.
    publishEphemeral(campaignId, "spatial_mode_changed", { enabled: spatialModeChanged }, { kind: "global" });
  }
  // Internal wakeup only, after the OUTERMOST narrator transaction commits.
  // Each waiting request reloads its authorized projection. An unchanged
  // projection stays pending: no private activity enters the global SSE bus.
  afterCommit(() => notifySpatialChange(campaignId));
  return result;
}
