import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { listLocations, type CampaignLocation } from "@/lib/db/locations";
import { getCampaignById } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { activeQuestLines } from "@/lib/dm/arc-logic";
import { spatialContext, spatialEnabled, spatialStore } from "@/lib/spatial/service";
import type { AtlasCharacter, AtlasLocation } from "@/lib/overworld/atlas";
import { atlasTerrain } from "@/lib/overworld/cartography";
import {
  DEFAULT_OVERWORLD_PARAMS,
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  normalizeOverworldParams,
  placeAnchor,
  tileAt,
  type OverworldParams,
  type XY,
} from "@/lib/overworld/logic";
import {
  paintOverworld,
  type AnchorRef,
  type OverworldStroke,
} from "@/lib/overworld/paint";
import {
  normalizeLabels,
  normalizePaths,
  normalizeSize,
  type OverworldLabel,
  type OverworldPath,
  type OverworldSize,
} from "@/lib/overworld/features";
import { isUploadedImagePath } from "@/lib/uploads";

// Overworld region map storage: one seeded terrain grid per campaign, with
// known locations anchored at tile coordinates and lead-placed pins.
// Anchors reconcile lazily at read time: any location without one gets
// placed near its first connected anchor, so the map grows as the party
// travels without hooks in the location write path.

export type OverworldPin = { id: string; x: number; y: number; label: string };

export type OverworldMap = {
  campaignId: string;
  seed: number;
  width: number;
  height: number;
  terrain: string;
  anchors: Record<string, XY>;
  pins: OverworldPin[];
  // The dials the terrain was rolled under; a reroll reuses them unless the
  // DM changes them.
  params: OverworldParams;
  // Where the party is standing, when a DM has placed them. Null otherwise:
  // the current location has always been the proxy and still is.
  partyXy: XY | null;
  // The DM's notes on the region. Never leaves the DM's own projection.
  notes: string;
  // Roads, rivers, borders and the words over the map
  // (src/lib/overworld/features.ts). World facts, so every member sees them.
  paths: OverworldPath[];
  labels: OverworldLabel[];
  // A picture shown in place of the tiles, when the DM has one. The tiles
  // stay underneath and still decide where a place may land.
  backdropPath: string;
  createdAt: string;
  updatedAt: string;
};

type OverworldRow = {
  campaign_id: string;
  seed: number;
  width: number;
  height: number;
  terrain: string;
  anchors_json: string;
  pins_json: string;
  params_json: string | null;
  party_xy_json: string | null;
  notes: string | null;
  paths_json: string | null;
  labels_json: string | null;
  backdrop_path: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: OverworldRow): OverworldMap {
  return {
    campaignId: row.campaign_id,
    seed: row.seed,
    width: row.width,
    height: row.height,
    terrain: row.terrain,
    anchors: parseJson<Record<string, XY>>(row.anchors_json, {}),
    pins: parseJson<OverworldPin[]>(row.pins_json, []),
    params: normalizeOverworldParams(
      parseJson<OverworldParams>(row.params_json, DEFAULT_OVERWORLD_PARAMS),
    ),
    partyXy: parseJson<XY | null>(row.party_xy_json, null),
    notes: row.notes ?? "",
    paths: normalizePaths(parseJson<unknown>(row.paths_json ?? "[]", []), row.width, row.height),
    labels: normalizeLabels(parseJson<unknown>(row.labels_json ?? "[]", []), row.width, row.height),
    backdropPath: isUploadedImagePath(row.backdrop_path) ? row.backdrop_path : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRow(campaignId: string): OverworldMap | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM overworld_maps WHERE campaign_id = ?`)
    .get(campaignId) as OverworldRow | undefined;
  return row ? mapRow(row) : null;
}

function saveAnchors(campaignId: string, anchors: Record<string, XY>) {
  getDatabase()
    .prepare(`UPDATE overworld_maps SET anchors_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(anchors), nowIso(), campaignId);
}

const DEFAULT_SIZE: OverworldSize = { width: OVERWORLD_WIDTH, height: OVERWORLD_HEIGHT };

// A fresh row: rolled terrain at the size asked for, or a terrain handed in
// ready-made (an Azgaar import). INSERT OR REPLACE leaves every column not
// named here at its default, which is what makes carryAuthoring below the
// only place the DM's own writing survives a reroll.
function createMap(
  campaignId: string,
  seed: number,
  params: OverworldParams = DEFAULT_OVERWORLD_PARAMS,
  size: OverworldSize = DEFAULT_SIZE,
  terrain?: string,
): OverworldMap {
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO overworld_maps
         (campaign_id, seed, width, height, terrain, anchors_json, pins_json,
          params_json, party_xy_json, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, '', '', ?, ?)`,
    )
    .run(
      campaignId,
      seed,
      size.width,
      size.height,
      terrain ?? generateOverworldTerrain(seed, size.width, size.height, params),
      JSON.stringify(params),
      now,
      now,
    );
  return readRow(campaignId)!;
}

// After the ground has been replaced: everything the DM wrote on the old
// map, re-validated against the new size. Recorded locations keep their
// coordinates: the cartography layer fits terrain to the place's type.
// Pins, paths and labels are fitted to the new size; the
// notes and the backdrop are kept as they were.
function carryAuthoring(
  campaignId: string,
  previous: OverworldMap | null,
  fresh: OverworldMap,
  paths: OverworldPath[],
) {
  if (!previous) {
    return;
  }
  const onLand = (at: XY) =>
    at.x >= 0 &&
    at.y >= 0 &&
    at.x < fresh.width &&
    at.y < fresh.height &&
    !["w", "m"].includes(tileAt(fresh.terrain, fresh.width, at.x, at.y));
  const carried: Record<string, XY> = {};
  for (const [locationId, anchor] of Object.entries(previous.anchors)) {
    if (anchor.x >= 0 && anchor.y >= 0 && anchor.x < fresh.width && anchor.y < fresh.height) {
      carried[locationId] = anchor;
    }
  }
  saveAnchors(campaignId, carried);
  const pins = previous.pins.filter(
    (pin) => pin.x >= 0 && pin.y >= 0 && pin.x < fresh.width && pin.y < fresh.height,
  );
  const party = previous.partyXy && onLand(previous.partyXy) ? previous.partyXy : null;
  getDatabase()
    .prepare(
      `UPDATE overworld_maps
         SET pins_json = ?, party_xy_json = ?, notes = ?, paths_json = ?, labels_json = ?,
             backdrop_path = ?, updated_at = ?
       WHERE campaign_id = ?`,
    )
    .run(
      JSON.stringify(pins),
      party ? JSON.stringify(party) : "",
      previous.notes,
      JSON.stringify(normalizePaths(paths, fresh.width, fresh.height)),
      JSON.stringify(normalizeLabels(previous.labels, fresh.width, fresh.height)),
      previous.backdropPath,
      nowIso(),
      campaignId,
    );
}

// Places anchors for any locations that lack one, oldest first so a
// location lands near the places it was discovered from.
function reconcileAnchors(map: OverworldMap, locations: CampaignLocation[]): OverworldMap {
  const anchorsByLocationId = { ...map.anchors };
  const idByName = new Map(locations.map((location) => [location.name.toLowerCase(), location.id]));
  const ordered = [...locations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let changed = false;
  for (const location of ordered) {
    if (anchorsByLocationId[location.id]) {
      continue;
    }
    let connected: XY | null = null;
    for (const connectionName of location.connections) {
      const connectedId = idByName.get(connectionName.toLowerCase());
      if (connectedId && anchorsByLocationId[connectedId]) {
        connected = anchorsByLocationId[connectedId];
        break;
      }
    }
    anchorsByLocationId[location.id] = placeAnchor({
      terrain: map.terrain,
      width: map.width,
      height: map.height,
      existing: Object.values(anchorsByLocationId),
      connected,
      name: location.name,
      layoutDescription: location.layoutDescription,
    });
    changed = true;
  }
  // Drop anchors for locations that no longer exist (rollback, cleanup).
  const known = new Set(locations.map((location) => location.id));
  for (const locationId of Object.keys(anchorsByLocationId)) {
    if (!known.has(locationId)) {
      delete anchorsByLocationId[locationId];
      changed = true;
    }
  }
  if (changed) {
    saveAnchors(map.campaignId, anchorsByLocationId);
    return { ...map, anchors: anchorsByLocationId };
  }
  return map;
}

// The campaign's overworld, created on first read and reconciled with the
// known locations on every read.
export function getOverworld(campaignId: string): OverworldMap {
  const map =
    readRow(campaignId) ?? createMap(campaignId, (Math.random() * 0xffffffff) >>> 0);
  const locations = listLocations(campaignId);
  if (spatialEnabled(campaignId)) {
    // Canonical anchors cover all rooms; only an authenticated spatial view
    // below may expose them. Room IDs and legacy location IDs stay distinct.
    const rooms = getDatabase().prepare("SELECT id, name, rowid AS ordinal FROM spatial_rooms WHERE campaign_id=? ORDER BY rowid")
      .all(campaignId) as Array<{ id: string; name: string; ordinal: number }>;
    locations.push(...rooms.map(room => ({
      id: room.id, campaignId, name: room.name, layoutDescription: "", connections: [],
      visited: false, isCurrent: false, mapImage: null,
      createdAt: `~${String(room.ordinal).padStart(16, "0")}`, updatedAt: "",
    })));
  }
  return reconcileAnchors(map, locations);
}

// Lead reroll: new seed and terrain, at the same size or a new one. Recorded
// anchors remain stable; only anchors outside a smaller map are re-placed.
// A seed may be named,
// which is what makes the studio's preview and the map the table ends up
// with the same map.
export function regenerateOverworld(
  campaignId: string,
  options: { seed?: number; params?: OverworldParams; width?: number; height?: number } = {},
): OverworldMap {
  const previous = readRow(campaignId);
  const size = normalizeSize(
    { width: options.width, height: options.height },
    previous ? { width: previous.width, height: previous.height } : DEFAULT_SIZE,
  );
  const fresh = createMap(
    campaignId,
    options.seed ?? (Math.random() * 0xffffffff) >>> 0,
    options.params ?? previous?.params ?? DEFAULT_OVERWORLD_PARAMS,
    size,
  );
  carryAuthoring(campaignId, previous, fresh, previous?.paths ?? []);
  return getOverworld(campaignId);
}

// Ground drawn elsewhere (src/lib/overworld/azgaar.ts) takes the place of
// the rolled terrain, with its own roads and rivers in place of whatever
// lines were drawn over the old ground. The rest of the DM's writing is
// carried the same way a reroll carries it.
export function replaceOverworldTerrain(
  campaignId: string,
  input: { terrain: string; width: number; height: number; paths: OverworldPath[] },
): OverworldMap | { error: string } {
  const size = normalizeSize(input, DEFAULT_SIZE);
  if (input.terrain.length !== size.width * size.height) {
    return { error: "That terrain does not fit the size it claims." };
  }
  const previous = readRow(campaignId);
  const fresh = createMap(
    campaignId,
    (Math.random() * 0xffffffff) >>> 0,
    previous?.params ?? DEFAULT_OVERWORLD_PARAMS,
    size,
    input.terrain,
  );
  carryAuthoring(campaignId, previous ?? { ...fresh, paths: [] }, fresh, input.paths);
  return getOverworld(campaignId);
}

// One brush pass over the region map. The validation that matters is in
// src/lib/overworld/paint.ts; this is the part that knows where the
// locations are standing and writes the result.
//
// Anchors the paint stranded are REPORTED, never moved. setOverworldAnchor
// below already accepts water and mountains on the grounds that a DM who
// puts a lighthouse on a reef means it, and silently relocating a town
// because the DM widened a lake would contradict that.
export function paintOverworldTerrain(
  campaignId: string,
  strokes: OverworldStroke[],
): { map: OverworldMap; stranded: AnchorRef[]; changed: number } | { error: string } {
  const map = getOverworld(campaignId);
  const locationNames = new Map(
    listLocations(campaignId).map((location) => [location.id, location.name]),
  );
  const painted = paintOverworld({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    strokes,
    anchors: Object.entries(map.anchors).map(([id, at]) => ({
      id,
      name: locationNames.get(id) ?? "",
      at,
    })),
  });
  if ("error" in painted) {
    return { error: painted.error };
  }
  getDatabase()
    .prepare(`UPDATE overworld_maps SET terrain = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(painted.terrain, nowIso(), campaignId);
  return {
    map: { ...map, terrain: painted.terrain },
    stranded: painted.stranded,
    changed: painted.changed,
  };
}

// The DM drags a location's marker. Clamped to the grid; unlike the
// automatic placement this accepts water and mountains, because a DM who
// puts a lighthouse on a reef means it.
export function setOverworldAnchor(campaignId: string, locationId: string, at: XY): OverworldMap {
  const map = getOverworld(campaignId);
  if (!map.anchors[locationId]) {
    return map;
  }
  const anchors = {
    ...map.anchors,
    [locationId]: {
      x: Math.min(map.width - 1, Math.max(0, Math.round(at.x))),
      y: Math.min(map.height - 1, Math.max(0, Math.round(at.y))),
    },
  };
  saveAnchors(campaignId, anchors);
  return { ...map, anchors };
}

// Null clears the marker, which is the honest state for a party in transit.
export function setOverworldParty(campaignId: string, at: XY | null): OverworldMap {
  const map = getOverworld(campaignId);
  const partyXy = at
    ? {
        x: Math.min(map.width - 1, Math.max(0, Math.round(at.x))),
        y: Math.min(map.height - 1, Math.max(0, Math.round(at.y))),
      }
    : null;
  getDatabase()
    .prepare(`UPDATE overworld_maps SET party_xy_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(partyXy ? JSON.stringify(partyXy) : "", nowIso(), campaignId);
  return { ...map, partyXy };
}

export function setOverworldNotes(campaignId: string, notes: string): OverworldMap {
  const map = getOverworld(campaignId);
  const trimmed = notes.slice(0, 4_000);
  getDatabase()
    .prepare(`UPDATE overworld_maps SET notes = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(trimmed, nowIso(), campaignId);
  return { ...map, notes: trimmed };
}

export function setOverworldPins(campaignId: string, pins: OverworldPin[]): OverworldMap {
  const map = getOverworld(campaignId);
  const cleaned = pins.slice(0, 40).map((pin) => ({
    id: pin.id || crypto.randomUUID(),
    x: Math.min(map.width - 1, Math.max(0, Math.round(pin.x))),
    y: Math.min(map.height - 1, Math.max(0, Math.round(pin.y))),
    label: String(pin.label ?? "").slice(0, 60),
  }));
  getDatabase()
    .prepare(`UPDATE overworld_maps SET pins_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(cleaned), nowIso(), campaignId);
  return { ...map, pins: cleaned };
}

// The lines and words over the map, each written whole: the client sends
// the list it now wants, the way pins are sent.
export function setOverworldPaths(campaignId: string, raw: unknown): OverworldMap {
  const map = getOverworld(campaignId);
  const paths = normalizePaths(raw, map.width, map.height);
  getDatabase()
    .prepare(`UPDATE overworld_maps SET paths_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(paths), nowIso(), campaignId);
  return { ...map, paths };
}

export function setOverworldLabels(campaignId: string, raw: unknown): OverworldMap {
  const map = getOverworld(campaignId);
  const labels = normalizeLabels(raw, map.width, map.height);
  getDatabase()
    .prepare(`UPDATE overworld_maps SET labels_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(labels), nowIso(), campaignId);
  return { ...map, labels };
}

// Only a path /api/upload produced, or nothing. The same rule lore images
// and battle map backdrops live under.
export function setOverworldBackdrop(campaignId: string, path: string): OverworldMap {
  const map = getOverworld(campaignId);
  const backdropPath = isUploadedImagePath(path) ? path : "";
  getDatabase()
    .prepare(`UPDATE overworld_maps SET backdrop_path = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(backdropPath, nowIso(), campaignId);
  return { ...map, backdropPath };
}

// The overworld as a member sees it: terrain grid, anchors joined with
// location state (visited/current names), lead pins, the party marker, the
// lines and words over the map, and the DM's own notes only for whoever
// holds the story's secrets (src/lib/dm/viewer.ts).
export function overworldView(campaignId: string, secrets: boolean, viewerUserId?: string) {
  const map = getOverworld(campaignId);
  const campaign = getCampaignById(campaignId);
  const spatial = spatialEnabled(campaignId);
  const actor = spatial && viewerUserId ? spatialContext(campaignId, viewerUserId).actor : null;
  const roomView = actor ? spatialStore().view(actor) : null;
  const privateMap = spatial && !actor?.isDm;
  const locations: AtlasLocation[] = privateMap ? [] : listLocations(campaignId).map((location) => ({
    id: location.id,
    name: location.name,
    layoutDescription: location.layoutDescription,
    visited: location.visited,
    isCurrent: !spatial && location.isCurrent,
    connections: location.connections,
    anchor: map.anchors[location.id] ?? null,
  }));
  if (roomView?.enabled) {
    const known = new Map(roomView.rooms.map(room => [room.id, { ...room, visited: true }]));
    for (const exit of roomView.exits) {
      if (!known.has(exit.id)) known.set(exit.id, { ...exit, active: false, occupants: [], visited: false });
    }
    for (const room of known.values()) {
      const links = actor?.isDm
        ? getDatabase().prepare("SELECT r.name FROM spatial_links l JOIN spatial_rooms r ON r.id=l.target_id WHERE l.campaign_id=? AND l.source_id=? AND l.walkable=1")
          .all(campaignId, room.id) as Array<{ name: string }>
        : room.active ? roomView.exits : [];
      locations.push({ id: room.id, name: room.name, visited: room.visited, isCurrent: room.active,
        connections: links.map(link => link.name), anchor: map.anchors[room.id] ?? null });
    }
  }
  const current = locations.find(location => location.isCurrent);
  const knownRoomIds = new Set(locations.map(location => location.id));
  const store = spatialStore();
  // The atlas tracks the party in known places; chat occupants remain local.
  // Never reveal a private destination or an undetected concealed character.
  const party: AtlasCharacter[] = listSheets(campaignId)
    .flatMap(sheet => {
      let locationId = current?.id ?? null;
      if (spatial) {
        if (!actor || !roomView?.enabled || !actor.playerIds.includes(sheet.userId)) return [];
        locationId = store.getUserRoom(campaignId, sheet.userId);
        if (!locationId || !knownRoomIds.has(locationId)) return [];
        if (!actor.isDm && sheet.userId !== actor.userId &&
          store.isUnseen(campaignId, sheet.id, [actor.userId, actor.characterId ?? actor.userId], locationId)) return [];
      }
      return [{ id: sheet.id, name: sheet.name, class: sheet.class,
        portraitUrl: sheet.portrait?.url ?? null, locationId }];
    });
  // Use the established public journal. Planned beats, hooks and private
  // room objectives are never a map projection for an ordinary player.
  const quests = privateMap ? [] : campaign?.questLog.length ? campaign.questLog
    : campaign?.storyArc ? activeQuestLines(campaign.storyArc) : [];
  // Hidden rooms must not leave a volcano/coast signature in a player's
  // terrain. Compose AFTER the established visibility projection above.
  const landscape = atlasTerrain(map, locations);
  return {
    map: {
      seed: map.seed,
      width: map.width,
      height: map.height,
      terrain: landscape.terrain,
      materialGrid: landscape.materialGrid,
      terrainConflicts: landscape.conflicts,
      pins: privateMap ? [] : map.pins,
      partyXy: spatial ? null : map.partyXy,
      params: map.params,
      paths: privateMap ? [] : map.paths,
      labels: privateMap ? [] : map.labels,
      backdropPath: privateMap ? "" : map.backdropPath,
      ...(secrets && !privateMap ? { notes: map.notes } : {}),
    },
    locations,
    party,
    quests,
    scope: spatial ? "spatial" : "party",
  };
}
