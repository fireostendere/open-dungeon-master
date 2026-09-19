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
  const engineArgs = { ...args, roomId };
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
  const board = getActiveBoard(campaignId, roomId);
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

// Verifies the DM-owned binding without trusting a room ID supplied by a
// player route. The caller still owns the current-room check.
export function boundBattleMapRoom(
  campaignId: string,
  userId: string,
  board: { id: string },
  map: { id: string },
): string | null {
  if (!spatialEnabled(campaignId)) return null;
  const { campaign } = spatialContext(campaignId, userId);
  if (!campaign.dmUserId) return null;
  const { actor: dmActor } = spatialContext(campaignId, campaign.dmUserId);
  const binding = objectOrNull(dmActor, BINDING_TYPE, map.id);
  const bound = binding?.payload as
    | { boardId?: string; mapId?: string; roomId?: string }
    | undefined;
  return bound?.boardId === board.id && bound.mapId === map.id && typeof bound.roomId === "string"
    ? bound.roomId
    : null;
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

  const view = spatialStore().view(actor);
  const userRoomId = view.enabled && view.current ? view.current.roomId : null;
  // A player who left a room may still retrieve their own frozen projection,
  // but only when there is one unambiguous board to identify that projection.
  const board = getActiveBoard(campaignId, userRoomId) ?? getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!board || !map || !campaign.dmUserId) return null;

  const boundRoomId = boundBattleMapRoom(campaignId, userId, board, map);
  if (!boundRoomId) return null;
  const { actor: dmActor } = spatialContext(campaignId, campaign.dmUserId);

  const projectionId = `${map.id}:${userId}`;
  if (view.enabled && view.current?.roomId === boundRoomId) {
    const live = buildPlayerMapView(campaignId, userId, { fullVision: false, encounter: board });
    if (!live) return null;
    const previous = objectOrNull(dmActor, VIEW_TYPE, projectionId);
    if (JSON.stringify(previous?.payload) !== JSON.stringify(live)) {
      spatialStore().publishObject(dmActor, {
        objectType: VIEW_TYPE,
        objectId: projectionId,
        roomId: boundRoomId,
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
