import {
  allocateSeq,
  getCampaignById,
  getFloor,
  getGlobalTurnState,
  setFloor,
  type Campaign,
  type Floor,
  type InitiativeFloor,
} from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { partyStanding } from "@/lib/db/party-standing";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { globalTurnSubmitted, type GlobalTurnState } from "@/lib/campaign-types";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The team round. A fight runs in one place while part of the party stands
// somewhere else (location mode, global turns on). Then a round of the
// fight is a round of the whole team: the heroes elsewhere play their one
// global-turn action, the heroes in the fight take their one initiative
// turn, and nobody gets a next turn until everyone has had this one. The
// global round seals only once every fighter has acted; a fighter's next
// turn waits until the next global round opens. Enemies keep their own
// initiative and wait for nobody.
//
// When the whole party is in the fight it owns the table as before: global
// turns pause until it ends. Leaf module (db and events only), so both
// global-turn-logic and the encounter engine can use it.

function heroes(campaign: Campaign): CharacterSheet[] {
  return listSheets(campaign.id).filter((sheet) => !sheet.isCompanion && sheet.userId !== campaign.dmUserId);
}

// The fight a team round runs around, or null.
export function teamRoundFight(campaignId: string): Encounter | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.gameSettings.globalTurn?.enabled) return null;
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || encounter.kind !== "fight" || encounter.roomId || !encounter.locationId) return null;
  const standing = partyStanding(campaignId);
  return heroes(campaign).some((sheet) => standing[sheet.id] !== encounter.locationId) ? encounter : null;
}

// A fight with the whole party in it: global turns wait for it to end.
export function fightOwnsTable(campaignId: string): boolean {
  return Boolean(getActiveEncounter(campaignId)) && !teamRoundFight(campaignId);
}

// Whether this hero stands in the team-round fight (and so plays it on
// initiative rather than through the global turn).
export function inTeamRoundFight(campaignId: string, encounter: Encounter, sheet: Pick<CharacterSheet, "id">): boolean {
  return partyStanding(campaignId)[sheet.id] === encounter.locationId;
}

// Fighters who still owe this team round their turn: in the order, standing
// at the fight, able to act, not yet counted.
export function fightersOwing(campaignId: string, encounter: Encounter, state: GlobalTurnState): string[] {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return [];
  const inOrder = new Set(encounter.order.flatMap((entry) => (entry.kind === "pc" ? [entry.characterId] : [])));
  return heroes(campaign)
    .filter((sheet) =>
      inOrder.has(sheet.id) &&
      inTeamRoundFight(campaignId, encounter, sheet) &&
      sheet.currentHp > 0 &&
      !isIncapacitated(sheet.conditions) &&
      !globalTurnSubmitted(state.actionsByCharacter[sheet.id]))
    .map((sheet) => sheet.id);
}

// Whether this hero's initiative turn waits for the rest of the team: they
// already had their turn this team round, or the round is closed (sealed for
// the narrator, or not opened yet). AI companions never wait.
export function waitsForTeam(campaignId: string, characterId: string): boolean {
  if (!teamRoundFight(campaignId)) return false;
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.isCompanion) return false;
  const state = getGlobalTurnState(campaignId);
  return !(state.phase === "active" || state.phase === "quorum_delay") ||
    globalTurnSubmitted(state.actionsByCharacter[characterId]);
}

// The floor for a hero's initiative turn: theirs now, or held for the team.
export function teamFloor(campaignId: string, floor: InitiativeFloor, characterId: string): Floor {
  return waitsForTeam(campaignId, characterId)
    ? { mode: "hold", next: floor, team: { round: getGlobalTurnState(campaignId).roundNumber } }
    : floor;
}

// What the table reads when initiative lands on a hero.
export function turnAnnouncement(campaignId: string, encounter: Encounter, name: string): string {
  const floor = getFloor(campaignId);
  return floor.mode === "hold" && floor.team
    ? `Round ${encounter.round}: ${name} acts as soon as the rest of the party has had its turn (team round ${floor.team.round}).`
    : `It is now ${name}'s turn (round ${encounter.round}).`;
}

// A new team round opened, or the fight no longer needs one: the held hero
// gets their turn. Returns whether anything was released.
export function releaseTeamHold(campaignId: string): boolean {
  const floor = getFloor(campaignId);
  if (floor.mode !== "hold" || !floor.team) return false;
  const encounter = getActiveEncounter(campaignId);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  if (current?.kind === "pc" && waitsForTeam(campaignId, current.characterId)) return false;
  const next: Floor = encounter && floor.next.mode === "initiative" && floor.next.encounterId === encounter.id
    ? floor.next
    : { mode: "open" };
  setFloor(campaignId, next);
  publishPersisted(campaignId, "floor_changed", { floor: next });
  if (encounter && current && next.mode === "initiative") {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: turnAnnouncement(campaignId, encounter, current.name),
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }
  return true;
}
