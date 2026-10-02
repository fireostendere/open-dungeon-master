import { randomUUID } from "node:crypto";
import type { CatalogEntry, CatalogField } from "@/lib/dm/invoke-catalog";
import { NarratorCommandError } from "@/lib/dm/narrator-command";
import { listSheets } from "@/lib/db/sheets";
import { runSpatialCommand, spatialContext, spatialStore, SpatialError } from "@/lib/spatial/service";

export const SPATIAL_NARRATOR_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  location_enable: "enable", location_disable: "disable", location_create_room: "create_room", location_link: "link",
  location_move: "move", location_narrate: "send", location_observe: "observe",
  location_revoke: "revoke", location_propagate: "propagate", location_perceive: "perceive",
  location_stealth_resolve: "stealth_resolve",
  location_detect: "detect",
  location_lose_detection: "lose_detection",
  location_set_floor: "set_floor",
});
export const SPATIAL_GUIDANCE = "LOCATION PRIVACY: messages with roomId are private location scenes. witnessUserIds is the write-time audience, not everybody currently in that room. Use narrator.invoke with location_narrate and an explicit roomId; unscoped narrator.narrate is refused while this mode is active. Never recap unwitnessed conversations to arrivals, other rooms, public Ask, global notes or OOC. Players moving into a room receive only future messages. For windows and magic adjudicate checks/resources with the engine, then location_observe (speech or scry) or location_perceive (only the perceived fragment). For an explosion/fire use location_propagate with a separately authored sound/sight summary, never the source transcript. Revoke perception on lost concentration/conditions. OOC stays global and never drives the story. Use location_disable when abandoning spatial mode; it clears room/privacy state and encounter room bindings without changing the campaign story or sheets. When location chat is enabled, start_encounter requires the owning spatial roomId; the server binds its tactical map to that room and preserves each player's last observed map version after they leave. For mechanical actions provide roomId whenever the acting character does not identify one unambiguously. Each room retains its own encounter, initiative and pending-roll gates. Invisibility and hidden sheet conditions automatically conceal player actions; these are private declarations, including dialogue. Publish only audible or visible consequences as separate perceived fragments. Ordinary Invisibility ends when its target attacks or casts; Greater Invisibility retains its duration. Detection sense=special represents an adjudicated ability to see an invisible creature; sound alone never makes it visible. friendlyFire=true permits pc_attack and cast_at_enemy with targetCharacterId; enemies:[] starts party-only combat after an opening scene. For AoE use area geometry when a map exists; include every affected character, including the caster and invisible allies. Without a map provide all adjudicated characterIds. Never give automatic success or bypass initiative. For stealth actions, adjudicate with location_stealth_resolve and deliver separate perceived fragments only to detecting players; use location_detect/lose_detection for sensory awareness.";

const field = (name: string, help: string, kind: CatalogField["kind"] = "text", required = true): CatalogField => ({ name, label: name, kind, required, help });
const room = field("roomId", "Exact location UUID from spatialRooms, not the legacy map location ID.");
const content = field("content", "Only prose intended for the specified recipients.", "longtext");
const users = field("userIds", "JSON array of PLAYER USER UUIDs from members; not character-sheet UUIDs.");
const movers = [field("characterIds", "JSON array of character ids from partyPositions (the server finds their players). Use this or userIds.", "text", false),
  { ...users, required: false }];
const passages = [field("walkable", "Players may traverse this boundary.", "boolean", false), field("sound", "Sound-permeable boundary; speech still needs an observation grant.", "boolean", false), field("sight", "A separately narrated visible incident can cross this boundary.", "boolean", false)];
export const SPATIAL_NARRATOR_CATALOG: CatalogEntry[] = [
  { name: "location_enable", label: "Enable location chats", category: "world", summary: "Opt in and place the current players in a starting room. No automatic historical disclosure.", fields: [field("name", "Starting room name, 1–80 characters.")] },
  { name: "location_disable", label: "Disable location chats", category: "world", summary: "Remove room/privacy state and return the campaign to the shared chat. Story, sheets and ordinary history stay intact.", fields: [field("preserveMapPositions", "Keep occupied place names and character positions on the shared map, without private room messages. Defaults to false.", "boolean", false)] },
  { name: "location_create_room", label: "Create a room", category: "world", summary: "Add a separate scene; optionally connect it to a known room.", fields: [field("name", "Room name, 1–80 characters."), field("connectTo", "Optional neighboring room UUID.", "text", false), ...passages] },
  { name: "location_link", label: "Connect rooms", category: "world", summary: "Set a symmetric walking / sound / sight boundary. Closing sound revokes physical eavesdropping across it.", fields: [field("sourceId", "Source room UUID."), field("targetId", "Destination room UUID."), ...passages] },
  { name: "location_move", label: "Move a subgroup", category: "world", summary: "Move specified players without granting old history. Call it whenever the story moves a character to another room; the map shows only recorded positions. Adjudicate combat movement before calling this.", fields: [room, ...movers] },
  { name: "location_narrate", label: "Narrate in a room", category: "story", summary: "Narrate only to the room's current occupants and authorized magical observers.", fields: [room, content] },
  { name: "location_observe", label: "Grant perception", category: "world", summary: "Future speech or future magical scene, never old history. Resolve checks and resources first.", fields: [room, field("userId", "Listening player USER UUID."), field("mode", "speech (sound-linked rooms) or scry (DM-adjudicated magic)."), field("seconds", "Real-time duration, 1–3600 seconds.", "number"), field("reason", "Recorded adjudication, 1–500 characters.")] },
  { name: "location_revoke", label: "Revoke perception", category: "world", summary: "Stop future reception; already perceived information remains in the player's archive.", fields: [field("grantId", "Exact observation UUID from spatialGrants.")] },
  { name: "location_propagate", label: "Propagate an incident", category: "story", summary: "Publish a separately authored perception to connected rooms, one hop only. Never sends the source conversation.", fields: [room, field("medium", "sound or sight."), content] },
  { name: "location_perceive", label: "Deliver a perceived fragment", category: "story", summary: "Only selected players receive this fragment; no room-history access is granted.", fields: [room, users, content] },
  { name: "location_stealth_resolve", label: "Resolve stealth action", category: "story", summary: "Adjudicate stealth outcome for a hidden action. Delivers perceived text only to detecting players.", fields: [field("messageId", "ID of the stealth message to resolve."), field("outcome", "confirmed, revealed, or failed."), field("characterId", "Target character ID.", "text", false), field("detectedByUserIds", "Array of player user IDs who detected the action.", "text", false), field("perceivedText", "Perception fragment for detecting observers.", "longtext", false), field("sense", "sight, sound, both, special.", "text", false)] },
  { name: "location_detect", label: "Register detection", category: "world", summary: "Set detection state between an observer and a target character/enemy.", fields: [field("observerId", "Observer character or user ID."), field("targetId", "Target character or enemy ID."), field("roomId", "Room UUID.", "text", false), field("sense", "sight, sound, both, special.", "text", false), field("state", "detected, unaware, suspected.", "text", false)] },
  { name: "location_lose_detection", label: "Lose detection", category: "world", summary: "Remove detection record between observer and target.", fields: [field("observerId", "Observer character or user ID."), field("targetId", "Target character or enemy ID.")] },
  { name: "location_set_floor", label: "Set room floor", category: "story", summary: "Set the floor state for a specific room.", fields: [room, field("floor", "Floor configuration object.", "text", false)] },
];

export function readSpatialForNarrator(campaignId: string, dmUserId: string, afterSeq: number, limit: number) {
  const store = spatialStore();
  if (!store.enabled(campaignId)) return null;
  const { actor } = spatialContext(campaignId, dmUserId);
  return store.narratorRead(actor, { afterSeq, limit });
}

// Presence is per player; the narrator thinks in characters. Translate here so
// a wrong id fails loudly instead of moving somebody else's player.
function withMoverUserIds(campaignId: string, args: Record<string, unknown>) {
  const { characterIds, ...rest } = args;
  const sheets = listSheets(campaignId);
  const refs = Array.isArray(characterIds) ? characterIds.map(String) : [];
  const found = refs.map(ref => sheets.find(sheet => sheet.id === ref || sheet.name.toLowerCase() === ref.trim().toLowerCase()));
  if (!refs.length || found.some(sheet => !sheet)) {
    throw new NarratorCommandError(`Unknown characterIds ${refs.filter((_, index) => !found[index]).join(", ")}; use: ${sheets.map(sheet => `${sheet.id} (${sheet.name})`).join(", ")}.`, 400);
  }
  const userIds = Array.isArray(rest.userIds) ? rest.userIds.map(String) : [];
  return { ...rest, userIds: [...new Set([...userIds, ...found.map(sheet => sheet!.userId)])] };
}

// Invoked INSIDE executeNarratorCommand's existing serialized CAS transaction.
// No new public action family or broader narrator credential is introduced.
export function invokeSpatialForNarrator(campaignId: string, dmUserId: string, name: string, args: Record<string, unknown>, commandId?: string) {
  const operation = Object.hasOwn(SPATIAL_NARRATOR_OPERATIONS, name) ? SPATIAL_NARRATOR_OPERATIONS[name] : undefined;
  if (!operation) throw new NarratorCommandError("Unknown location action.", 403);
  if (name === "location_move" && args.characterIds !== undefined) args = withMoverUserIds(campaignId, args);
  try {
    const result = runSpatialCommand(campaignId, dmUserId, { ...args, operation, requestId: commandId ?? randomUUID(),
      ...(name === "location_narrate" ? { kind: "narration" } : {}) });
    // Narrator receipts are reread every turn. Do not duplicate complete
    // private prose there when the ordered message feed already carries it.
    if (result.message) {
      const message = result.message as { id: string; roomId: string | null; seq: number };
      return { messageId: message.id, roomId: message.roomId, seq: message.seq };
    }
    if (Array.isArray(result.messages)) return { messageIds: result.messages.map((message: { id: string }) => message.id) };
    return result;
  } catch (error) {
    if (error instanceof SpatialError) throw new NarratorCommandError(error.message, error.status);
    throw error;
  }
}
