import { fnv1a, type XY } from "./logic.ts";
import { environmentForLocation, landmarkForLocation, LANDMARK_ASSETS } from "./cartography.ts";

export type AtlasLocation = {
  id: string;
  name: string;
  layoutDescription?: string;
  visited: boolean;
  isCurrent: boolean;
  connections: string[];
  anchor: XY | null;
};

export type AtlasCharacter = {
  id: string;
  name: string;
  class: string;
  portraitUrl: string | null;
  locationId: string | null;
};

export type AtlasQuest = { id: string; text: string; locationId: string | null; anchor: XY | null };
export type AtlasPin = XY & { id: string; label: string };

export function locationKind(location: Pick<AtlasLocation, "name" | "layoutDescription">) {
  const asset = landmarkForLocation(location);
  if (asset) return LANDMARK_ASSETS[asset][2];
  const env = environmentForLocation(location);
  return env?.ground === "f" ? "forest" : env?.ground === "m" ? "mountain" : "neutral";
}

export const questId = (text: string) => `quest:${fnv1a(text).toString(16)}`;
export const isQuestPin = (pin: Pick<AtlasPin, "id">) => pin.id.startsWith("quest:");

// Explicit bindings use the existing pins ledger. Resolve the location ID
// afresh so moving its anchor also moves the objective. An ambiguous prose
// mention stays unplaced; it must never invent a destination.
export function atlasQuests(lines: string[], locations: AtlasLocation[], pins: AtlasPin[]): AtlasQuest[] {
  return [...new Set(lines.filter(line => line.trim()))].map(text => {
    const id = questId(text);
    const binding = pins.find(pin => pin.id.startsWith(`${id}@`));
    const lower = text.toLowerCase();
    const mentioned = locations.filter(location => {
      const name = location.name.trim().toLowerCase();
      const letter = /[\p{L}\p{N}]/u;
      if (name.length <= 2) return false;
      for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) {
        if (!letter.test(lower[at - 1] ?? "") && !letter.test(lower[at + name.length] ?? "")) return true;
      }
      return false;
    });
    const target = binding
      ? locations.find(location => location.id === binding.id.slice(id.length + 1))
      : mentioned.length === 1 ? mentioned[0] : undefined;
    return { id, text, locationId: target?.id ?? null, anchor: target?.anchor ?? null };
  });
}

// Only recorded connections count as a route, including one-way passages.
export function atlasRoute(locations: AtlasLocation[], fromId: string | null, toId: string | null): string[] {
  if (!fromId || !toId) return [];
  const byId = new Map(locations.map(location => [location.id, location]));
  const byName = new Map<string, string | null>();
  for (const location of locations) {
    const name = location.name.trim().toLowerCase();
    byName.set(name, byName.has(name) ? null : location.id);
  }
  if (!byId.has(fromId) || !byId.has(toId)) return [];
  const previous = new Map<string, string | null>([[fromId, null]]);
  const queue = [fromId];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (id === toId) {
      const route: string[] = [];
      for (let cursor: string | null = id; cursor; cursor = previous.get(cursor) ?? null) route.unshift(cursor);
      return route;
    }
    for (const name of byId.get(id)?.connections ?? []) {
      const next = byName.get(name.trim().toLowerCase());
      if (next && !previous.has(next)) { previous.set(next, id); queue.push(next); }
    }
  }
  return [];
}

// All camera gestures share the same limits: the overview fills the map
// viewport, and dragging cannot strand the whole region off-screen.
export function constrainAtlasView(view: XY & { zoom: number }, viewport: { width: number; height: number }, map: { width: number; height: number }) {
  if (!viewport.width || !viewport.height || !map.width || !map.height) return view;
  const minimum = Math.min(viewport.width / map.width, viewport.height / map.height);
  const zoom = Math.max(minimum, Math.min(Math.max(4, minimum), view.zoom));
  const width = map.width * zoom, height = map.height * zoom;
  return { zoom,
    x: width <= viewport.width ? (viewport.width - width) / 2 : Math.max(viewport.width - width, Math.min(0, view.x)),
    y: height <= viewport.height ? (viewport.height - height) / 2 : Math.max(viewport.height - height, Math.min(0, view.y)) };
}

export type AtlasMarker = XY & { id: string; name: string; priority: number; partyCount: number };
export type AtlasMarkerGroup = { marker: AtlasMarker; members: AtlasMarker[]; label: (XY & { width: number; height: number }) | null };

// Geometry stays in screen pixels: a distant location is a compact group,
// never a pile of full-size names. Party positions keep their real anchor.
// ponytail: pairwise layout for a few hundred places; use a spatial index
// only if thousands of visible markers make camera gestures slow.
export function layoutAtlasMarkers(markers: AtlasMarker[], width: number, height: number, detailed: boolean, blocked: Array<XY & { width: number; height: number }> = []): AtlasMarkerGroup[] {
  const groups: AtlasMarkerGroup[] = [];
  const rects: Array<XY & { width: number; height: number }> = [
    ...blocked,
    { x: 10, y: 10, width: Math.min(245, width - 90), height: 105 },
    { x: width - 88, y: 10, width: 78, height: 85 },
    { x: 10, y: height - 64, width: 180, height: 54 },
    { x: width - 100, y: height - 47, width: 90, height: 37 },
  ];
  const overlaps = (a: typeof rects[number], b: typeof rects[number]) => a.x < b.x + b.width + 5 && a.x + a.width + 5 > b.x && a.y < b.y + b.height + 5 && a.y + a.height + 5 > b.y;
  for (const marker of [...markers].filter(at => at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const group = groups.find(entry => Math.hypot(entry.marker.x - marker.x, entry.marker.y - marker.y) < (detailed ? 60 : 52));
    if (group) group.members.push(marker);
    else groups.push({ marker, members: [marker], label: null });
  }
  for (const { marker, members } of groups) {
    rects.push({ x: marker.x - 30, y: marker.y - 30, width: 60, height: 67 });
    if (detailed && members.length === 1 && marker.partyCount) {
      rects.push({ x: marker.x - 48, y: marker.y + 31, width: marker.partyCount > 3 ? 122 : 96, height: 32 });
    }
  }
  for (const group of groups) {
    const { marker } = group;
    const labelWidth = Math.min(180, Math.max(75, marker.name.length * 7 + 22));
    const labelHeight = marker.partyCount || marker.priority >= 800 ? 40 : 28;
    const gap = labelHeight / 2 + 38;
    const offsets = [{ x: 0, y: -gap }, { x: 0, y: gap + 8 }, { x: labelWidth / 2 + 38, y: 0 }, { x: -labelWidth / 2 - 38, y: 0 }, { x: 0, y: -gap - 45 }, { x: 0, y: gap + 45 }];
    for (const offset of offsets) {
      const box = { x: marker.x + offset.x - labelWidth / 2, y: marker.y + offset.y - labelHeight / 2, width: labelWidth, height: labelHeight };
      if (box.x < 8 || box.y < 8 || box.x + box.width > width - 8 || box.y + box.height > height - 8 || rects.some(rect => overlaps(box, rect))) continue;
      group.label = { ...offset, width: labelWidth, height: labelHeight };
      rects.push(box);
      break;
    }
  }
  return groups;
}
