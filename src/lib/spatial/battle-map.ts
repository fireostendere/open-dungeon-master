import { buildPlayerMapView, type PlayerMapView } from "@/lib/battlemap/view";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveBoard } from "@/lib/db/encounters";
import {
  spatialContext,
  spatialEnabled,
  spatialStore,
  SpatialError,
} from "@/lib/spatial/service";

const BINDING_TYPE = "battle-map-binding";
const VIEW_TYPE = "battle-map-view";

function objectOrNull(
  actor: ReturnType<typeof spatialContext>["actor"],
  objectType: string,
  objectId: string,
) {
  try {
    return spatialStore().object(actor, objectType, objectId);
  } catch (error) {
    if (error instanceof SpatialError && error.status === 404) return null;
    throw error;
  }
}

function roomExists(campaignId: string, dmUserId: string, roomId: string) {
  const { actor } = spatialContext(campaignId, dmUserId);
  if (!actor.isDm) throw new SpatialError("Only the Dungeon Master can bind a battle map.", 403);
  const view = spatialStore().view(actor);
  return view.enabled && view.rooms.some((room) => room.id === roomId);
}

export function scopeBattleMapInvocation(
  campaignId: string,
  dmUserId: string,
  name: string,
  args: Record<string, unknown>,
): { args: Record<string, unknown>; roomId: string | null } {
  if (name !== "start_encounter" || !spatialEnabled(campaignId)) {
    return { args, roomId: null };
  }
  const roomId = typeof args.roomId === "string" ? args.roomId : "";
  if (!roomId || !roomExists(campaignId, dmUserId, roomId)) {
    throw new SpatialError(
      "start_encounter requires roomId for an existing spatial location.",
      400,
    );
  }
  const engineArgs = { ...args };
  delete engineArgs.roomId;
  return { args: engineArgs, roomId };
}

export function bindActiveBattleMapToRoom(
  campaignId: string,
  dmUserId: string,
  roomId: string,
): { boardId: string; mapId: string; roomId: string } {
  if (!spatialEnabled(campaignId) || !roomExists(campaignId, dmUserId, roomId)) {
    throw new SpatialError("Battle-map room is unavailable.", 409);
  }
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!board || !map) throw new SpatialError("The active encounter has no battle map.", 409);

  const { actor: dmActor } = spatialContext(campaignId, dmUserId);
  const payload = { boardId: board.id, mapId: map.id, roomId };
  const previous = objectOrNull(dmActor, BINDING_TYPE, map.id);
  if (JSON.stringify(previous?.payload) !== JSON.stringify(payload)) {
    spatialStore().publishObject(dmActor, {
      objectType: BINDING_TYPE,
      objectId: map.id,
      roomId,
      payload,
      userIds: [],
    });
  }
  return payload;
}

export function spatialBattleMapView(
  campaignId: string,
  userId: string,
  options: { fullVision?: boolean } = {},
): PlayerMapView | null {
  if (!spatialEnabled(campaignId)) {
    return buildPlayerMapView(campaignId, userId, {
      fullVision: options.fullVision === true,
    });
  }

  const { campaign, actor } = spatialContext(campaignId, userId);
  if (actor.isDm) {
    return buildPlayerMapView(campaignId, userId, { fullVision: true });
  }

  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!board || !map || !campaign.dmUserId) return null;

  const { actor: dmActor } = spatialContext(campaignId, campaign.dmUserId);
  const binding = objectOrNull(dmActor, BINDING_TYPE, map.id);
  const bound = binding?.payload as
    | { boardId?: string; mapId?: string; roomId?: string }
    | undefined;
  if (
    !bound ||
    bound.boardId !== board.id ||
    bound.mapId !== map.id ||
    typeof bound.roomId !== "string"
  ) {
    return null;
  }

  const view = spatialStore().view(actor);
  const projectionId = `${map.id}:${userId}`;
  if (view.enabled && view.current?.roomId === bound.roomId) {
    const live = buildPlayerMapView(campaignId, userId, { fullVision: false });
    if (!live) return null;
    const previous = objectOrNull(dmActor, VIEW_TYPE, projectionId);
    if (JSON.stringify(previous?.payload) !== JSON.stringify(live)) {
      spatialStore().publishObject(dmActor, {
        objectType: VIEW_TYPE,
        objectId: projectionId,
        roomId: bound.roomId,
        payload: live,
        userIds: [userId],
      });
    }
    return live;
  }

  const remembered = objectOrNull(actor, VIEW_TYPE, projectionId);
  if (!remembered) return null;
  const payload = remembered.payload as PlayerMapView;
  return { ...payload, reachable: [], budgetLeft: 0 };
}
