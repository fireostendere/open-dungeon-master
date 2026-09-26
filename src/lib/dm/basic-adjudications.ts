import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq, getFloor, setCampaignScene, setFloor } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listOpenPendingRolls } from "@/lib/db/dm-turns";
import { hasRecentIdenticalEvent, insertCharacterEvent, CHARACTER_EVENT_KINDS, type CharacterEventKind } from "@/lib/db/character-events";
import { getCurrentLocation, updateCurrentLocationDetails, upsertCurrentLocation } from "@/lib/db/locations";
import { publishPersisted } from "@/lib/events";
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

export function handleLocationCall(campaign: Campaign, toolName: string, rawArguments: string): Record<string, unknown> {
  let args: { name?: unknown; layoutDescription?: unknown; connections?: unknown; visionClear?: unknown };
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { error: "Invalid arguments." }; }
  const layoutDescription = typeof args.layoutDescription === "string" ? args.layoutDescription : undefined;
  const connections = Array.isArray(args.connections) ? args.connections.map(String).slice(0, 12) : undefined;
  let location;
  if (toolName === "move_party") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { error: "move_party needs a location name." };
    const previous = getCurrentLocation(campaign.id);
    location = upsertCurrentLocation({ campaignId: campaign.id, name, layoutDescription, connections });
    if (previous && previous.id !== location.id) {
      const merged = [...new Set([...location.connections, previous.name])];
      if (merged.length !== location.connections.length) location = updateCurrentLocationDetails(campaign.id, { connections: merged }) ?? location;
    }
    setCampaignScene(campaign.id, location.name);
  } else {
    location = updateCurrentLocationDetails(campaign.id, { layoutDescription, connections });
    if (!location) return { error: "No current location; call move_party first." };
  }
  publishPersisted(campaign.id, "location_updated", { location });
  followSceneAmbience(campaign, `${location.name} ${location.layoutDescription}`);
  return { ok: true, location: location.name, note: "Recorded. Continue the scene." };
}
