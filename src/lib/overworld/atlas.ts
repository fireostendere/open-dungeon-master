import { fnv1a, type XY } from "./logic.ts";

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
  // The destination's name determines its icon; a village description
  // mentioning the forest road must not turn the village into a forest.
  const text = location.name.toLowerCase();
  if (/пещер|подземел|шахт|cave|dungeon|mine\b/.test(text)) return "dungeon";
  if (/крепост|замок|башн|цитадел|castle|fort|tower|keep\b/.test(text)) return "fort";
  if (/руин|гробниц|склеп|ruin|tomb|crypt/.test(text)) return "ruin";
  if (/храм|святилищ|монастыр|temple|shrine|abbey/.test(text)) return "shrine";
  if (/перевал|хребет|вершин|гора(?:\s|$)|mountain|pass\b|peak\b/.test(text)) return "mountain";
  if (/лес|рощ|forest|wood|grove/.test(text)) return "forest";
  if (/лагер|стоянк|camp/.test(text)) return "camp";
  if (/порт|пристан|гаван|harbour|harbor|port\b|wharf/.test(text)) return "port";
  return "settlement";
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
  const byName = new Map(locations.map(location => [location.name.trim().toLowerCase(), location.id]));
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
