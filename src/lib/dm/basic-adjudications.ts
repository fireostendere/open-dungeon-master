import type { Campaign } from "@/lib/db/campaigns";
import { getDatabase, nowIso } from "@/lib/db/core";
import { allocateSeq, getFloor, setCampaignScene, setFloor } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { hasRecentIdenticalEvent, insertCharacterEvent, CHARACTER_EVENT_KINDS, type CharacterEventKind } from "@/lib/db/character-events";
import { getLocation, updateCurrentLocationDetails, upsertCurrentLocation } from "@/lib/db/locations";
import { getOverworldPartyPositions, partyStanding, setPartyStanding } from "@/lib/db/overworld";
import { spatialEnabled } from "@/lib/spatial/service";
import { syncFightRosters } from "@/lib/dm/encounter-tools";
import { publishOocMessage, publishPersisted } from "@/lib/events";
import { z } from "zod";
import { normalizeEventKind } from "@/lib/dm/arg-coerce";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { followSceneAmbience } from "@/lib/dm/ambience-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";

function parseSpotlightUserIds(rawArguments: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>) {
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { characterIds?: unknown; prompt?: unknown };
    const ids = Array.isArray(parsed.characterIds) ? parsed.characterIds.map(String) : [];
    const userIds = [...new Set(ids
      .map((requested) => resolveSheetRef(requested, sheets, sheetsById))
      .filter((sheet): sheet is CharacterSheet => sheet !== null && !sheet.isCompanion)
      .map((sheet) => sheet.userId))];
    return userIds.length ? { userIds, prompt: String(parsed.prompt ?? "") } : null;
  } catch { return null; }
}

export function handleRequestPlayerInput(campaign: Campaign, rawArguments: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): Record<string, unknown> {
  const currentFloor = getFloor(campaign.id);
  const effectiveFloor = currentFloor.mode === "hold" ? currentFloor.next : currentFloor;
  const parsed = parseSpotlightUserIds(rawArguments, sheets, sheetsById);
  if (!parsed) return { error: "Name at least one player character to give the floor to." };
  const encounter = getActiveEncounter(campaign.id);
  if (encounter || effectiveFloor.mode === "initiative") {
    const actor = encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
    if (currentFloor.mode !== "hold" || !currentFloor.combat || currentFloor.combat.mechanicsResolved ||
        effectiveFloor.mode !== "initiative" || !encounter || effectiveFloor.encounterId !== encounter.id ||
        currentFloor.combat.round !== encounter.round || currentFloor.combat.turnIndex !== encounter.turnIndex ||
        actor?.kind !== "pc" || currentFloor.combat.characterId !== actor.characterId ||
        parsed.userIds.length !== 1 || parsed.userIds[0] !== actor.userId || listOpenPendingRolls(campaign.id).length) {
      return { error: "Clarification requires the held current player's turn and no pending roll; it cannot advance or reset initiative." };
    }
    setFloor(campaign.id, effectiveFloor);
    publishPersisted(campaign.id, "floor_changed", { floor: effectiveFloor });
    return { ok: true, clarification: true, characterId: actor.characterId, prompt: parsed.prompt,
      note: "The current player can clarify this same turn. Spent actions, resources and confirmed rolls remain spent; do not replay them." };
  }
  const floor = { mode: "spotlight" as const, userIds: parsed.userIds, prompt: parsed.prompt, respondedUserIds: [] };
  setFloor(campaign.id, floor);
  publishPersisted(campaign.id, "floor_changed", { floor });
  return { ok: true, waitingOn: parsed.userIds.length };
}

const oocArgsSchema = z.object({
  message: z.string().trim().max(2000).transform(text => text.replace(/^\(ooc\)\s*/i, "").trim()).pipe(z.string().min(1)),
});

export function handleSendOoc(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  if (!campaign.dmUserId) return { error: "A DM seat is required for table messages." };
  let args: z.infer<typeof oocArgsSchema>;
  try { args = oocArgsSchema.parse(JSON.parse(rawArguments || "{}")); }
  catch { return { error: "send_ooc needs a nonempty message of at most 2000 characters." }; }
  const messageId = crypto.randomUUID();
  publishOocMessage(campaign.id, {
    id: messageId, campaignId: campaign.id, seq: 0,
    authorType: "dm", userId: campaign.dmUserId, characterId: null,
    content: `(ooc) ${args.message}`, kind: "ooc", authorUserId: campaign.dmUserId,
    roomId: null, createdAt: nowIso(),
  });
  return { ok: true, messageId };
}

export function handleRecordEvent(campaign: Campaign, rawArguments: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): Record<string, unknown> {
  let args: { characterId?: unknown; kind?: unknown; summary?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { error: "Invalid arguments." }; }
  const sheet = resolveSheetRef(typeof args.characterId === "string" ? args.characterId : undefined, sheets, sheetsById);
  if (!sheet) return { error: "Unknown characterId; use one from GAME STATE." };
  const kind = normalizeEventKind(args.kind, CHARACTER_EVENT_KINDS) as CharacterEventKind;
  const summary = String(args.summary ?? "").trim().slice(0, 300);
  if (!summary) return { error: "record_event needs a one-sentence summary." };
  if (hasRecentIdenticalEvent(sheet.id, summary)) return { ok: true, note: "Already recorded." };
  const event = insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId, campaignCharacterId: sheet.id, campaignId: campaign.id,
    seq: allocateSeq(campaign.id), kind, summary,
  });
  publishPersisted(campaign.id, "character_event", { event, characterName: sheet.name });
  return { ok: true };
}

// "Олег, Как: Лес; Левик: Костёр", what the map now shows, so the narrator
// sees the recorded positions in the same receipt as the move.
function whereabouts(campaignId: string) {
  const groups = new Map<string, string[]>();
  for (const position of getOverworldPartyPositions(campaignId)) {
    const place = position.locationName ?? "not placed";
    groups.set(place, [...groups.get(place) ?? [], position.name]);
  }
  return [...groups].map(([place, names]) => `${names.join(", ")}: ${place}`).join("; ");
}

export function handleLocationCall(campaign: Campaign, toolName: string, rawArguments: string, sheets: CharacterSheet[], sheetsById: Map<string, CharacterSheet>): Record<string, unknown> {
  let args: { name?: unknown; layoutDescription?: unknown; connections?: unknown; visionClear?: unknown; characterIds?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { error: "Invalid arguments." }; }
  // Location chat tracks who is in which room itself; a legacy move here would
  // change nothing the table sees, so it must not look like it succeeded.
  if (spatialEnabled(campaign.id)) {
    return { error: `Location chat is on: move players between rooms with location_move {roomId, characterIds}; ${toolName} does not move anyone there.` };
  }
  const layoutDescription = typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections) ? args.connections.map(String).slice(0, 12) : undefined;
  let location;
  let split = false;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { error: "move_party needs a location name." };
    const requested = Array.isArray(args.characterIds) ? args.characterIds.map(String) : [];
    const movers = requested.map(ref => resolveSheetRef(ref, sheets, sheetsById));
    if (movers.some(sheet => !sheet)) {
      return { error: `Unknown characterIds ${requested.filter((_, index) => !movers[index]).join(", ")}; use: ${sheets.map(sheet => `${sheet.id} (${sheet.name})`).join(", ")}.` };
    }
    const moving = new Set(movers.map(sheet => sheet!.id));
    const before = partyStanding(campaign.id, sheets);
    location = upsertCurrentLocation({ campaignId: campaign.id, name, layoutDescription, connections });
    const target = location.id;
    // Everyone not named stays where they stood; nobody named means everyone.
    const after = Object.fromEntries(sheets.flatMap(sheet => {
      const at = !moving.size || moving.has(sheet.id) ? target : before[sheet.id];
      return at ? [[sheet.id, at]] : [];
    }));
    split = setPartyStanding(campaign.id, after);
    const leftFrom = [...new Set(sheets.filter(sheet => !moving.size || moving.has(sheet.id)).map(sheet => before[sheet.id]))]
      .filter(id => id && id !== target).map(id => getLocation(id)?.name).filter((place): place is string => Boolean(place));
    const merged = [...new Set([...location.connections, ...leftFrom])];
    if (merged.length !== location.connections.length) {
      getDatabase().prepare("UPDATE locations SET connections_json=?, updated_at=? WHERE id=?").run(JSON.stringify(merged), nowIso(), target);
      location = getLocation(target) ?? location;
    }
    if (!split) setCampaignScene(campaign.id, location.name);
  } else {
    location = updateCurrentLocationDetails(campaign.id, { layoutDescription, connections });
    if (!location) return { error: "No current location: the party is split or not placed. Record a place's layout with move_party {name, layoutDescription, characterIds of who is there}." };
  }
  publishPersisted(campaign.id, "location_updated", { location });
  followSceneAmbience(campaign, `${location.name} ${location.layoutDescription}`);
  const fight = syncFightRosters(campaign.id);
  return { ok: true, location: location.name, positions: whereabouts(campaign.id), ...(fight.length ? { fight } : {}), note: "Recorded. Continue the scene." };
}
