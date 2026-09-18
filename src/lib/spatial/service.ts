import { z } from "zod";
import { getDatabase } from "@/lib/db/core";
import { allocateSeq, campaignSeats, capsFor, getCampaignForUser, listMembers, touchCampaign } from "@/lib/db/campaigns";
import { getSheetForUser } from "@/lib/db/sheets";
import { getActiveEncounter } from "@/lib/db/encounters";
import { isMemberMuted } from "@/lib/db/moderation";
import { coverInEffect } from "@/lib/dm/delegation";
import { isDmSeat } from "@/lib/dm/viewer";
import { createSpatialStore, SpatialError, type SpatialActor, type SpatialStore } from "@/lib/spatial/store.mjs";

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
  z.object({ ...base, operation: z.literal("create_room"), name: z.string().trim().min(1).max(80), connectTo: id.optional(), ...passage }).strict(),
  z.object({ ...base, operation: z.literal("link"), sourceId: id, targetId: id, ...passage }).strict(),
  z.object({ ...base, operation: z.literal("move"), roomId: id, userIds: z.array(id).min(1).max(20).optional(), expectedRevision: revision }).strict(),
  z.object({ ...base, operation: z.literal("send"), roomId: id.nullable().optional(), kind: z.enum(["say", "do", "narration", "ooc"]), content: z.string().trim().min(1).max(8000), expectedRevision: revision }).strict(),
  z.object({ ...base, operation: z.literal("observe"), roomId: id, userId: id, mode: z.enum(["speech", "scry"]), seconds: z.number().int().min(1).max(3600), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ ...base, operation: z.literal("revoke"), grantId: id }).strict(),
  z.object({ ...base, operation: z.literal("propagate"), roomId: id, medium: z.enum(["sound", "sight"]), content: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, operation: z.literal("perceive"), roomId: id, userIds: z.array(id).min(1).max(20), content: z.string().trim().min(1).max(2000) }).strict(),
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
    if (command.operation === "move" && getActiveEncounter(campaignId)) {
      throw new SpatialError("Ask the DM to adjudicate movement during an encounter.", 409);
    }
  }
  const { operation, requestId, ...input } = command;
  const result = spatialStore().command(actor, requestId, operation, input);
  touchCampaign(campaignId);
  // No content (nor private room IDs/rosters) enters the global SSE ledger.
  // Authenticated views refetch independently; the narrator has a bounded feed.
  return result;
}
