// Pure waypoint mechanics (upstream issue #31): which of a beat's steps a
// tool call satisfies, how a tick is recorded, and which steps gate
// complete_beat. Database-free so scripts/test-waypoints.mjs can exercise
// every branch; waypoint-tick.ts wraps this with the campaign.

import type { ArcBeat, StoryArc, Waypoint, WaypointKind } from "./arc-logic.ts";

export type WaypointSignal = { kind: WaypointKind; names: string[] };

// The kinds a tool call can tick, and so the only ones that gate a beat.
// Upstream also gated objective and narrative steps behind a server model
// judge; ours has no model, so the narrator judges those itself and they
// stay a checklist it reads, not a lock it cannot open.
const GATING_KINDS: ReadonlySet<WaypointKind> = new Set(["place", "npc", "item", "fight"]);

export function openWaypoints(beat: ArcBeat | null | undefined): Waypoint[] {
  return (beat?.waypoints ?? []).filter((waypoint) => !waypoint.done);
}

// The open steps that hold the beat shut.
export function gatingWaypoints(beat: ArcBeat | null | undefined): Waypoint[] {
  return openWaypoints(beat).filter((waypoint) => GATING_KINDS.has(waypoint.kind));
}

export function beatGated(beat: ArcBeat | null | undefined): boolean {
  return gatingWaypoints(beat).length > 0;
}

export function activeBeat(arc: StoryArc): { beat: ArcBeat; number: number } | null {
  const index = arc.beats.findIndex((beat) => beat.status === "active");
  return index < 0 ? null : { beat: arc.beats[index], number: index + 1 };
}

// What a tool call says the party just did, in waypoint terms. Names are
// what the narrator passed in (and, for the location tools, the location
// the server recorded), so a place waypoint matches where the party was
// moved, not a guess from narration. Fights tick from the encounter's end
// (enemy-damage.ts finishEncounter), not from here.
export function signalFromToolCall(
  name: string,
  rawArguments: string,
  result: Record<string, unknown> = {},
): WaypointSignal | null {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const signal = (kind: WaypointKind, ...values: unknown[]) => {
    const names = [...new Set(values.map(text).filter(Boolean))];
    return names.length ? { kind, names } : null;
  };
  switch (name) {
    case "move_party":
    case "update_location":
      return signal("place", args.name, result.location);
    case "set_npc":
    case "npc_reaction":
      return signal("npc", args.name);
    case "social_check":
      return signal("npc", args.npc);
    case "grant_item":
      return signal("item", args.name);
    case "purchase":
      return args.action === "buy" ? signal("item", args.item) : null;
    default:
      return null;
  }
}

// Folds case and accents the same way on both sides ("ё" and "е", "й" and
// "и" agree).
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOPWORDS = new Set(
  [
    "the", "a", "an", "of", "to", "at", "in", "on", "with", "and", "or", "for", "from", "into",
    "reach", "reaches", "reaching", "arrive", "arrives", "arriving", "find", "finds", "finding",
    "go", "goes", "get", "gets", "meet", "meets", "meeting", "speak", "speaks", "talk", "talks",
    "obtain", "obtains", "recover", "recovers", "take", "takes", "defeat", "defeats", "kill",
    "kills", "beat", "beats", "win", "wins", "party", "their", "its", "his", "her", "them", "it",
    "is", "are", "be", "by", "up", "out", "down",
    "для", "при", "под", "над", "без", "или", "что", "это", "как", "они", "его", "она", "них",
    "там", "где", "все", "всех", "добраться", "дойти", "прийти", "попасть", "достичь", "найти",
    "отыскать", "поговорить", "говорить", "встретить", "встретиться", "получить", "забрать",
    "взять", "добыть", "победить", "одолеть", "убить", "разбить", "отряд", "отряда", "отряду",
  ].map(fold),
);

// Word stems the two sides are compared on: folded words of any script
// (Cyrillic included), minus the words every waypoint shares, cut to five
// letters, and a short word loses its last letter, so an inflected ending
// does not split one name in two ("Ваэль" and "Ваэля", "cathedral" and
// "cathedrals").
export function stems(text: string): string[] {
  return fold(text)
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => (word.length > 5 ? word.slice(0, 5) : word.length >= 4 ? word.slice(0, -1) : word));
}

const sameStem = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

// Whether a name the narrator used (a location, a person, an item) is the
// thing a waypoint names: every distinctive stem of the name appears in the
// waypoint, or the two share most of their stems. "the drowned cathedral"
// matches "Reach the Drowned Cathedral of Vael" and "Бриской" matches
// "Поговорить с Бриской Хейл", while "the ferry" does not match "reach the
// drowned cathedral".
export function lexicalMatch(waypointText: string, name: string): boolean {
  const target = stems(waypointText);
  const given = stems(name);
  if (!target.length || !given.length) {
    return false;
  }
  const hits = given.filter((stem) => target.some((other) => sameStem(stem, other))).length;
  if (hits === given.length) {
    return true;
  }
  return hits / (target.length + given.length - hits) >= 0.5;
}

// Open waypoints of the beat that a signal satisfies by name.
export function matchSignal(beat: ArcBeat, signal: WaypointSignal): number[] {
  const matched: number[] = [];
  (beat.waypoints ?? []).forEach((waypoint, index) => {
    if (waypoint.done || waypoint.kind !== signal.kind || !GATING_KINDS.has(waypoint.kind)) {
      return;
    }
    if (signal.names.some((name) => lexicalMatch(waypoint.text, name))) {
      matched.push(index);
    }
  });
  return matched;
}

// Records ticks on one beat. Out-of-range or already-done indexes are
// ignored, so a stale tick can never throw a turn.
export function tickWaypoints(arc: StoryArc, beatNumber: number, indexes: number[]): StoryArc {
  const beat = arc.beats[beatNumber - 1];
  if (!beat?.waypoints || !indexes.some((index) => beat.waypoints?.[index] && !beat.waypoints[index].done)) {
    return arc;
  }
  const waypoints = beat.waypoints.map((waypoint, index) =>
    indexes.includes(index) && !waypoint.done ? { ...waypoint, done: true } : waypoint,
  );
  return {
    ...arc,
    beats: arc.beats.map((entry, index) => (index === beatNumber - 1 ? { ...entry, waypoints } : entry)),
    updatedAt: new Date().toISOString(),
  };
}
