import { z } from "zod";
import { getDatabase } from "@/lib/db/core";
import { afterCommit } from "@/lib/db/commit-effects";
import { notifySpatialChange } from "@/lib/spatial/updates.mjs";
import { allocateSeq, campaignSeats, capsFor, getCampaignForUser, getGlobalTurnState, listMembers, touchCampaign, canAct, getFloor, normalizeFloor, setFloor, type Floor } from "@/lib/db/campaigns";
import { getSheetForUser } from "@/lib/db/sheets";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { isMemberMuted } from "@/lib/db/moderation";
import { coverInEffect } from "@/lib/dm/delegation";
import { recordGlobalTurnAction, resolveGlobalTurn } from "@/lib/dm/global-turn-logic";
import { isDmSeat } from "@/lib/dm/viewer";
import { createSpatialStore, SpatialError, type SpatialActor, type SpatialStore } from "@/lib/spatial/store.mjs";
import { capturePreSpatialEntities } from "@/lib/spatial/domain-migration";
import { normalizeNarrationUnits } from "@/lib/units/narration";
import { publishEphemeral, publishOocMessage } from "@/lib/events";
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
    characterId: getSheetForUser(campaignId, userId)?.id ?? null,
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

// Pending physical rolls are scene-scoped too: a roll in another room must
// not lock this room. Initiative membership keeps a moved participant's
// unresolved combat roll attached to its encounter.
function hasPendingRoomRolls(campaignId: string, roomId: string) {
  const encounter = getActiveEncounter(campaignId, roomId);
  return listOpenPendingRolls(campaignId).some(roll =>
    spatialStore().getUserRoom(campaignId, roll.userId) === roomId ||
    Boolean(roll.characterId && encounter?.order.some(entry => entry.kind === "pc" && entry.characterId === roll.characterId)),
  );
}

export function runSpatialCommand(campaignId: string, userId: string, raw: unknown) {
  const parsed = spatialCommandSchema.safeParse(raw);
  if (!parsed.success) throw new SpatialError(z.prettifyError(parsed.error));
  const command = parsed.data;
  const { operation, requestId, ...input } = command;
  const ooc = operation === "send" && command.kind === "ooc";
  let applied = false;
  let oocMessage: Record<string, unknown> | null = null;
  let globalTurnResolution: { roundNumber: number } | null = null;
  let spatialModeChanged: boolean | null = null;
  const result = getDatabase().transaction(() => {
    // Authorization is re-read inside the write transaction, including on a
    // receipt replay. A removed member must never recover private receipts.
    const { campaign, actor } = spatialContext(campaignId, userId);
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
    const store = spatialStore();
    const previouslyEnabled = store.enabled(campaignId);
    let playerInput: { sheetId: string; roomId: string; floor: Floor; inCombat: boolean } | null = null;
    return store.command(actor, requestId, operation, input, (rawInput) => {
      // This callback is deliberately fresh-command-only. Rechecking the
      // current round/position for an old receipt would break idempotency.
      let normalized = rawInput;
      if (!actor.isDm && !ooc) {
        const sheet = getSheetForUser(campaignId, userId);
        if (!sheet) throw new SpatialError("You need a character to act.", 409);
        if (operation === "move") {
          const userRoom = store.getUserRoom(campaignId, userId);
          if (userRoom && getActiveEncounter(campaignId, userRoom)) {
            throw new SpatialError("Ask the DM to adjudicate movement during an encounter.", 409);
          }
        }
        if (operation === "send") {
          if (rawInput.characterId !== undefined && rawInput.characterId !== sheet.id) {
            throw new SpatialError("You can only act as your own character.", 403);
          }
          const position = store.getUserPosition(campaignId, userId);
          if (!position) throw new SpatialError("Place the player in a location before sending an action.", 409);
          // Narrator autopilot intentionally omits both location assertions:
          // resolve them together, inside this transaction, on first apply.
          // Explicit or partial assertions must never silently retarget a send.
          const useCurrentPosition = rawInput.roomId === undefined && rawInput.expectedRevision === undefined;
          if (!useCurrentPosition && (position.roomId !== rawInput.roomId || position.revision !== rawInput.expectedRevision)) {
            throw new SpatialError("Your location changed. Refresh before sending.", 409);
          }
          const roomId = position.roomId;
          const floor = getFloor(campaignId, roomId);
          if (!canAct(floor, userId, String(rawInput.kind)) ||
            (floor.mode === "spotlight" && floor.respondedUserIds.includes(userId))) {
            throw new SpatialError("Wait for the DM to open your responses. OOC remains available.", 409);
          }
          const encounter = getActiveEncounter(campaignId, roomId);
          const turnActor = encounter?.order[encounter.turnIndex];
          if (encounter && (!encounter.orderReady || floor.mode !== "initiative" ||
            floor.encounterId !== encounter.id || floor.round !== encounter.round ||
            turnActor?.kind !== "pc" || turnActor.characterId !== sheet.id || hasPendingRoomRolls(campaignId, roomId))) {
            throw new SpatialError("Wait for your combat turn and pending rolls. OOC remains available.", 409);
          }
          if (!encounter && campaign.gameSettings.globalTurn?.enabled) {
            const state = getGlobalTurnState(campaignId);
            if (state.phase !== "active" && state.phase !== "quorum_delay") {
              throw new SpatialError("This round is not accepting input. Wait for the MCP Dungeon Master.", 409);
            }
          }
          normalized = { ...rawInput, roomId, expectedRevision: position.revision, characterId: sheet.id };
          playerInput = { sheetId: sheet.id, roomId, floor, inCombat: Boolean(encounter) };
        }
      }
      if (operation === "set_floor") normalized = { ...normalized, floor: normalizeFloor(rawInput.floor) };
      return actor.isDm && ["send", "propagate", "perceive"].includes(operation) && typeof normalized.content === "string"
        ? { ...normalized, content: normalizeNarrationUnits(normalized.content, campaign.gameSettings.unitSystem) }
        : normalized;
    }, (commandResult, normalized) => {
      applied = true;
      if (operation === "send" && command.kind === "ooc") {
        const message = (commandResult as { message: { id: string; content: string; createdAt: string } }).message;
        oocMessage = {
          ...message,
          campaignId,
          seq: 0,
          authorType: "player",
          userId,
          characterId: actor.characterId ?? null,
          content: `(ooc) ${message.content}`,
          authorUserId: userId,
          kind: "ooc",
        };
        return;
      }
      // The message, quota and floor are committed with ONE receipt. A retry
      // cannot consume a later round or re-close an already released floor.
      if (playerInput && (command.operation === "send") && (command.kind === "do" || command.kind === "say")) {
        const { sheetId, roomId, floor, inCombat } = playerInput;
        if (!inCombat && campaign.gameSettings.globalTurn?.enabled) {
          const turn = recordGlobalTurnAction(campaignId, sheetId, userId, command.kind);
          if (!turn.allowed) throw new SpatialError(turn.error ?? "This round is not accepting input.", 409);
          if (turn.shouldResolve) globalTurnResolution = { roundNumber: getGlobalTurnState(campaignId).roundNumber };
        }
        if (floor.mode === "spotlight") {
          const respondedUserIds = [...new Set([...floor.respondedUserIds, userId])];
          setFloor(campaignId, floor.userIds.every(id => respondedUserIds.includes(id))
            ? { mode: "open" } : { ...floor, respondedUserIds }, roomId);
        }
        if (inCombat && floor.mode === "initiative") {
          const encounter = getActiveEncounter(campaignId, roomId)!;
          setFloor(campaignId, { mode: "hold", next: floor, combat: {
            encounterId: encounter.id, round: encounter.round, turnIndex: encounter.turnIndex,
            characterId: sheetId, requiresEndTurn: false, mechanicsResolved: false,
          } }, roomId);
        }
        // Preserve main's private RakoBot feed. This reference is committed
        // with the accepted action, never enqueued again on request replay.
        const message = commandResult.message as { id?: string } | undefined;
        if (message?.id) queuePlayerAction(campaignId, "spatial", message.id, command.kind);
      }
      if (actor.isDm && operation === "send" && normalized.kind === "narration" && typeof normalized.roomId === "string") {
        const roomId = normalized.roomId;
        const floor = getFloor(campaignId, roomId);
        if (floor.mode === "hold" && floor.combat &&
          (!floor.combat.requiresEndTurn || floor.combat.mechanicsResolved) && !hasPendingRoomRolls(campaignId, roomId)) {
          setFloor(campaignId, floor.next, roomId);
        }
        if (campaign.gameSettings.holdSubmissions) {
          const current = getFloor(campaignId, roomId);
          if (current.mode !== "hold") setFloor(campaignId, { mode: "hold", next: current }, roomId);
        }
      }
      if (operation === "enable" && !previouslyEnabled) capturePreSpatialEntities(campaignId);
      const enabledNow = store.enabled(campaignId);
      if (enabledNow !== previouslyEnabled) spatialModeChanged = enabledNow;
      if (!ooc) touchCampaign(campaignId);
    });
  })();
  if (!applied) return result;
  const resolution = globalTurnResolution as { roundNumber: number } | null;
  const pendingOocMessage = oocMessage;
  // No wakeup, timer sealing or global mode signal can escape an outer
  // narrator rollback. Private room content never enters the shared stream.
  afterCommit(() => {
    if (pendingOocMessage) publishOocMessage(campaignId, pendingOocMessage);
    if (spatialModeChanged !== null) {
      publishEphemeral(campaignId, "spatial_mode_changed", { enabled: spatialModeChanged }, { kind: "global" });
    }
    if (!ooc) notifySpatialChange(campaignId);
    if (resolution) {
      void resolveGlobalTurn(campaignId, resolution.roundNumber).catch(error =>
        console.error("[global-turn] Failed to seal spatial round:", error),
      );
    }
  });
  return result;
}
