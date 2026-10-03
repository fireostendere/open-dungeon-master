import { getDatabase } from "@/lib/db/core";
import { getBattleMapForEncounter, getTokenByRef, listTokens, placeTokens, removeTokenByRef } from "@/lib/db/battle-maps";
import { getEnemy, listActiveEncounters, listActiveFights, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { getLocation } from "@/lib/db/locations";
import { partyStanding } from "@/lib/db/overworld";
import { listSheets } from "@/lib/db/sheets";
import { nearestOpenTile } from "@/lib/battlemap/paint";
import { tileIndex } from "@/lib/battlemap/types";
import { spatialEnabled, spatialStore } from "@/lib/spatial/service";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A fight happens in one place: a location-chat room, or without rooms the
// recorded place it started at. Only characters standing there take part:
// they roll initiative, take turns, act, and can be hit or caught in it.
// Anyone elsewhere is out of it, whatever the narrator writes; walking in
// and rolling initiative is the only way to join.

export function atFight(campaignId: string, encounter: Encounter, sheet: Pick<CharacterSheet, "id" | "userId">): boolean {
  if (encounter.roomId) return !spatialEnabled(campaignId) || spatialStore().getUserRoom(campaignId, sheet.userId) === encounter.roomId;
  if (encounter.locationId) return partyStanding(campaignId)[sheet.id] === encounter.locationId;
  return true;
}

export function fightPlaceName(encounter: Encounter): string {
  if (encounter.locationId) return getLocation(encounter.locationId)?.name ?? "the fight's place";
  const room = encounter.roomId ? getDatabase().prepare("SELECT name FROM spatial_rooms WHERE id=?").get(encounter.roomId) as { name: string } | undefined : undefined;
  return room?.name ?? "the fight's room";
}

// Every argument the engine reads a character from, at any depth (the steps
// of a combat_turn included). Ids or exact names, as resolveSheetRef takes.
const CHARACTER_KEYS = new Set(["characterId", "characterIds", "targetCharacterId", "targetCharacterIds", "casterId", "allyIds", "attackerCharacterId"]);
function referencedSheets(value: unknown, sheets: CharacterSheet[], found = new Map<string, CharacterSheet>()) {
  if (Array.isArray(value)) for (const item of value) referencedSheets(item, sheets, found);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (CHARACTER_KEYS.has(key)) {
        for (const ref of (Array.isArray(item) ? item : [item]).filter((entry): entry is string => typeof entry === "string")) {
          const sheet = sheets.find(entry => entry.id === ref.trim() || entry.name.toLowerCase() === ref.trim().toLowerCase());
          if (sheet) found.set(sheet.id, sheet);
        }
      } else referencedSheets(item, sheets, found);
    }
  }
  return [...found.values()];
}

const ENEMY_KEYS = new Set(["enemyId", "targetEnemyId", "enemyIds", "casterEnemyId"]);
function referencedEnemyFights(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) referencedEnemyFights(item, found);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (ENEMY_KEYS.has(key)) {
        for (const ref of (Array.isArray(item) ? item : [item]).filter((entry): entry is string => typeof entry === "string")) {
          const enemy = getEnemy(ref.trim());
          if (enemy) found.add(enemy.encounterId);
        }
      } else referencedEnemyFights(item, found);
    }
  }
  return found;
}

// Without rooms, which fight a narrator call is about: the one at its
// locationId, the one its enemies are in, or the one its characters stand
// in. undefined when the call names no fight (a lone fight is then found by
// itself); an error when it names two, or when several fights run and a
// fight tool does not say which.
export function fightForCall(
  campaignId: string,
  tool: { name: string; needsEncounter?: boolean },
  args: Record<string, unknown>,
): { fightId?: string | null } | { error: string } {
  const fights = listActiveFights(campaignId).filter((fight) => !fight.roomId);
  // A new fight is made at the table and runs in its own scope from there.
  if (tool.name === "start_encounter" || !fights.length) return { fightId: null };
  const named = new Set<string>();
  if (typeof args.locationId === "string") {
    const at = fights.find((fight) => fight.locationId === args.locationId);
    if (at) named.add(at.id);
  }
  for (const id of referencedEnemyFights(args)) if (fights.some((fight) => fight.id === id)) named.add(id);
  if (!named.size) {
    for (const sheet of referencedSheets(args, listSheets(campaignId))) {
      const fight = fights.find((entry) => atFight(campaignId, entry, sheet));
      if (fight) named.add(fight.id);
    }
  }
  const places = () => fights.map((fight) => `${fightPlaceName(fight)} (locationId=${fight.locationId})`).join("; ");
  if (named.size > 1) return { error: `This call reaches into several fights at once (${places()}); act in one fight per call.` };
  if (named.size === 1) return { fightId: [...named][0] };
  if (fights.length === 1) return {};
  if (tool.needsEncounter) return { error: `Several fights are running: ${places()}. Pass locationId, or name a character or enemy of the fight you mean.` };
  return { fightId: null };
}

// The refusal for an engine call that would reach across places, or null.
// A fight tool needs everyone it names at the fight; any other call may name
// people elsewhere only if it names nobody at the fight.
export function fightCrossing(campaignId: string, encounter: Encounter | null, tool: { name: string; needsEncounter?: boolean }, args: unknown): string | null {
  // Ending a turn or the fight must stay possible for someone who left.
  if (!encounter || tool.name === "end_turn" || tool.name === "end_encounter") return null;
  const named = referencedSheets(args, listSheets(campaignId));
  const away = named.filter(sheet => !atFight(campaignId, encounter, sheet));
  if (!away.length || (away.length === named.length && !tool.needsEncounter)) return null;
  return `${away.map(sheet => sheet.name).join(", ")} ${away.length === 1 ? "is" : "are"} not at the fight (${fightPlaceName(encounter)}). Only characters standing there take part in it: move them there (move_party with characterIds, or location_move) and they join it at once.`;
}

// After anyone moves: a hero who left a fight leaves its board (and is
// skipped in its order until they return); one standing there with a place
// in the order gets a token back. Returns notes for the narrator, and the
// fights whose current hero just walked out (the engine passes those turns:
// syncFightRosters in src/lib/dm/encounter-tools.ts).
export function syncFightBoards(campaignId: string): {
  notes: string[];
  leftOnTheirTurn: Encounter[];
  // Heroes standing at a running fight with no place in its order yet: they
  // just walked in and join it (syncFightRosters rolls their initiative).
  arrivals: Array<{ encounter: Encounter; sheet: CharacterSheet }>;
} {
  const notes: string[] = [];
  const leftOnTheirTurn: Encounter[] = [];
  const arrivals: Array<{ encounter: Encounter; sheet: CharacterSheet }> = [];
  const sheets = listSheets(campaignId);
  for (const encounter of listActiveEncounters(campaignId)) {
    if (encounter.kind !== "fight") continue;
    const map = getBattleMapForEncounter(encounter.id);
    const place = fightPlaceName(encounter);
    const current = encounter.order[encounter.turnIndex];
    for (const sheet of sheets) {
      const here = atFight(campaignId, encounter, sheet);
      const inOrder = encounter.order.some(entry => entry.kind === "pc" && entry.characterId === sheet.id);
      const token = map ? getTokenByRef(map.id, sheet.id) : null;
      if (!here && token) {
        removeTokenByRef(map!.id, sheet.id);
        notes.push(`${sheet.name} left the fight at ${place}: out of it until they return.`);
      } else if (here && inOrder && !token && map) {
        placeArrivingHero(campaignId, encounter, sheet);
      } else if (here && !inOrder && encounter.orderReady) {
        arrivals.push({ encounter, sheet });
      }
      if (!here && encounter.orderReady && current?.kind === "pc" && current.characterId === sheet.id) leftOnTheirTurn.push(encounter);
    }
  }
  return { notes, leftOnTheirTurn, arrivals };
}

// A token for a hero who joins a fight already on the board, next to an ally.
export function placeArrivingHero(campaignId: string, encounter: Encounter, sheet: CharacterSheet) {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map || getTokenByRef(map.id, sheet.id)) return;
  const tokens = listTokens(map.id);
  const taken = new Set(tokens.map(token => tileIndex(map.width, token.x, token.y)));
  const ally = tokens.find(token => token.kind === "pc") ?? { x: 0, y: Math.floor(map.height / 2) };
  const spot = nearestOpenTile(map.terrain, map.width, map.height, ally, taken);
  placeTokens(map.id, campaignId, [{ kind: "pc", refId: sheet.id, name: sheet.name, spot }]);
}

// A hero who walks in after initiative is rolled takes the count they rolled,
// below anyone already tied with it, as a late arrival does at a real table.
export function joinFight(encounter: Encounter, entry: Extract<Encounter["order"][number], { kind: "pc" }>) {
  const at = encounter.order.findIndex(other => other.initiative < entry.initiative);
  const index = at === -1 ? encounter.order.length : at;
  encounter.order.splice(index, 0, entry);
  if (index <= encounter.turnIndex) encounter.turnIndex += 1;
  saveEncounter(encounter);
}
