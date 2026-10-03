import {
  allocateSeq,
  getCampaignById,
  getFightFloor,
  getGlobalTurnState,
  setFightFloor,
  type Campaign,
  type Floor,
  type InitiativeFloor,
} from "@/lib/db/campaigns";
import { listActiveFights, saveEncounter, getEncounter, type Encounter } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getLocation } from "@/lib/db/locations";
import { partyStanding } from "@/lib/db/party-standing";
import { getSheetById, getSheetForUser, listSheets } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { globalTurnSubmitted, type GlobalTurnState } from "@/lib/campaign-types";
import { isIncapacitated } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The team round. Without rooms and with global turns on, a fight that is not
// the whole party's (part of the party stands elsewhere, or two fights run at
// two places) does not stop the table. One round of a fight is one round of
// the whole team:
//
// - Heroes outside every fight play their one global-turn action.
// - Inside a fight, heroes take their initiative turns as usual. A hero who
//   already spent this global round (they walked in, say) sits the rest of
//   this combat round out.
// - When a fight's order wraps into its next combat round and it has already
//   had a combat round in this global round, it waits: the next hero's turn
//   is held (floor hold + team) until the next global round opens. A fight
//   that starts while the round is sealed waits the same way.
// - The global round seals only once every fight is waiting (or has nobody
//   left able to act), so no fight is ever behind and nobody waits on anyone
//   who is waiting on them.
// - Enemies act on initiative and wait for nobody.
//
// The whole party in one fight: that fight owns the table as before and
// global turns pause until it ends. Leaf module (db and events only), so both
// global-turn-logic and the encounter engine use it.

function heroes(campaign: Campaign): CharacterSheet[] {
  return listSheets(campaign.id).filter((sheet) => !sheet.isCompanion && sheet.userId !== campaign.dmUserId);
}

// Fights at places (not rooms).
function placeFights(campaignId: string): Encounter[] {
  return listActiveFights(campaignId).filter((fight) => !fight.roomId);
}

// The fights running as team rounds right now, or [] when there is no team round.
export function teamRoundFights(campaignId: string): Encounter[] {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.gameSettings.globalTurn?.enabled) return [];
  const fights = placeFights(campaignId);
  if (fights.length > 1) return fights;
  const [fight] = fights;
  if (!fight || !fight.locationId) return [];
  const standing = partyStanding(campaignId);
  return heroes(campaign).some((sheet) => standing[sheet.id] !== fight.locationId) ? [fight] : [];
}

export function isTeamRoundFight(campaignId: string, encounter: Pick<Encounter, "id">): boolean {
  return teamRoundFights(campaignId).some((fight) => fight.id === encounter.id);
}

// The one fight running as a team round, for callers that only handle one.
export function teamRoundFight(campaignId: string): Encounter | null {
  return teamRoundFights(campaignId)[0] ?? null;
}

// A fight the whole party is in: global turns wait for it to end.
export function fightOwnsTable(campaignId: string): boolean {
  return listActiveFights(campaignId).length > 0 && teamRoundFights(campaignId).length === 0;
}

// The fight this hero is in without rooms: the one at their place, or a fight
// with no recorded place (nobody was placed), which is everyone's.
export function fightOf(campaignId: string, sheet: Pick<CharacterSheet, "id">): Encounter | null {
  const fights = placeFights(campaignId);
  const place = partyStanding(campaignId)[sheet.id];
  return (place ? fights.find((fight) => fight.locationId === place) : undefined) ??
    fights.find((fight) => !fight.locationId) ?? null;
}

export function inTeamRoundFight(campaignId: string, encounter: Encounter, sheet: Pick<CharacterSheet, "id">): boolean {
  return fightOf(campaignId, sheet)?.id === encounter.id;
}

function collecting(state: GlobalTurnState): boolean {
  return state.phase === "active" || state.phase === "quorum_delay";
}

export function actedThisRound(state: GlobalTurnState, characterId: string): boolean {
  return globalTurnSubmitted(state.actionsByCharacter[characterId]);
}

function waitingForTeam(floor: Floor): boolean {
  return floor.mode === "hold" && Boolean(floor.team);
}

// Whether a fight has done its part of this global round: it waits at its
// round boundary, or nobody in it can take a turn (initiative not collected
// yet, everyone down or gone).
function fightSettled(campaignId: string, fight: Encounter): boolean {
  if (!fight.orderReady || waitingForTeam(getFightFloor(campaignId, fight))) return true;
  const campaign = getCampaignById(campaignId);
  if (!campaign) return true;
  const inOrder = new Set(fight.order.flatMap((entry) => (entry.kind === "pc" ? [entry.characterId] : [])));
  return !heroes(campaign).some((sheet) =>
    inOrder.has(sheet.id) && inTeamRoundFight(campaignId, fight, sheet) && sheet.currentHp > 0 && !isIncapacitated(sheet.conditions));
}

// Heroes standing in a team-round fight who have nothing left to give this
// global round: their fight waits at its boundary, or they cannot act. They
// count as answered for quorum, so a hero whose slot already passed when they
// walked in never holds the round open.
export function fightersDoneForRound(campaignId: string): Set<string> {
  const done = new Set<string>();
  const campaign = getCampaignById(campaignId);
  if (!campaign) return done;
  for (const fight of teamRoundFights(campaignId)) {
    const settled = fightSettled(campaignId, fight);
    for (const sheet of heroes(campaign)) {
      if (!inTeamRoundFight(campaignId, fight, sheet)) continue;
      if (settled || sheet.currentHp <= 0 || isIncapacitated(sheet.conditions)) done.add(sheet.id);
    }
  }
  return done;
}

// Fights still playing their combat round in this global round. It seals
// only when this is empty.
export function fightsStillPlaying(campaignId: string): Encounter[] {
  return teamRoundFights(campaignId).filter((fight) => !fightSettled(campaignId, fight));
}

// Where initiative landing on a hero (inside a combat round) leaves them:
// their turn opens, they sit this combat round out (they already spent the
// global round), or the fight waits for the team (the round is not open).
// The round boundary itself is walkPointer's (src/lib/dm/encounter-tools.ts).
export function teamLanding(campaignId: string, encounter: Encounter, characterId: string): "open" | "skip" | "wait" {
  if (!isTeamRoundFight(campaignId, encounter)) return "open";
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.isCompanion) return "open";
  const state = getGlobalTurnState(campaignId);
  if (!collecting(state)) return "wait";
  return actedThisRound(state, characterId) ? "skip" : "open";
}

// The floor for a hero's initiative turn: theirs, or held for the team.
export function teamFloor(campaignId: string, floor: InitiativeFloor, wait: boolean): Floor {
  return wait ? { mode: "hold", next: floor, team: { round: getGlobalTurnState(campaignId).roundNumber } } : floor;
}

function placeName(encounter: Encounter): string | null {
  return encounter.locationId ? getLocation(encounter.locationId)?.name ?? null : null;
}

// What the table reads when initiative lands on a hero. With several fights
// running, each line says which fight it is about.
export function turnAnnouncement(campaignId: string, encounter: Encounter, name: string): string {
  const floor = getFightFloor(campaignId, encounter);
  const place = placeFights(campaignId).length > 1 ? placeName(encounter) : null;
  const prefix = place ? `${place}: ` : "";
  return waitingForTeam(floor) && floor.mode === "hold"
    ? `${prefix}Round ${encounter.round}: ${name} acts as soon as the rest of the party has had its turn (team round ${floor.team!.round}).`
    : `${prefix}It is now ${name}'s turn (round ${encounter.round}).`;
}

// A new global round opened, or a fight stopped being a team round: every
// fight waiting from an earlier round goes on. The held hero's turn opens and
// the fight's combat round now belongs to this global round. Safe to call any
// time: a fight held in this very round is left waiting.
export function releaseTeamHolds(campaignId: string): number {
  const state = getGlobalTurnState(campaignId);
  let released = 0;
  for (const fight of placeFights(campaignId)) {
    const floor = getFightFloor(campaignId, fight);
    if (!waitingForTeam(floor) || floor.mode !== "hold") continue;
    const team = isTeamRoundFight(campaignId, fight);
    // A fight held this very round keeps waiting; one held in an earlier
    // round (or no longer a team round at all) goes on.
    if (team && (!collecting(state) || floor.team!.round >= state.roundNumber)) continue;
    const current = fight.orderReady ? fight.order[fight.turnIndex] : undefined;
    const next: Floor = floor.next.mode === "initiative" && floor.next.encounterId === fight.id ? floor.next : { mode: "open" };
    const fresh = getEncounter(fight.id);
    if (fresh) {
      fresh.teamRound = team ? state.roundNumber : null;
      saveEncounter(fresh);
    }
    setFightFloor(campaignId, fight, next);
    publishPersisted(campaignId, "floor_changed", { floor: next, encounterId: fight.id });
    if (current && next.mode === "initiative") {
      const seq = allocateSeq(campaignId);
      const message = insertCampaignMessage({
        campaignId,
        seq,
        authorType: "system",
        content: turnAnnouncement(campaignId, fight, current.name),
      });
      publishWithSeq(campaignId, seq, "message_added", { message });
    }
    released += 1;
  }
  return released;
}

// Without rooms, the two fights a player's screen is about: `own`, the one
// their hero stands in (its floor gates their input), and `shown`, the one
// they watch: the one they picked, else their own, else the first running.
// Everyone sees every fight; rooms keep fights private (spatial routes).
export function viewerFights(campaignId: string, userId: string, requested?: string | null): { own: Encounter | null; shown: Encounter | null } {
  const fights = placeFights(campaignId);
  const sheet = getSheetForUser(campaignId, userId);
  const own = sheet ? fightOf(campaignId, sheet) : null;
  const picked = requested ? fights.find((fight) => fight.id === requested) ?? null : null;
  return { own, shown: picked ?? own ?? fights[0] ?? null };
}

export type FightSummary = { id: string; place: string | null; round: number };

// Every fight running at a place, for the fight switcher.
export function fightSummaries(campaignId: string): FightSummary[] {
  return placeFights(campaignId).map((fight) => ({ id: fight.id, place: placeName(fight), round: fight.round }));
}

// Whether a player is in a fight right now, and so acts through it rather
// than at the table: their hero stands in one. Without a hero (a lead with
// no character), any fight counts. Room fights keep the old answer.
export function userInFight(campaignId: string, userId: string): boolean {
  const fights = listActiveFights(campaignId);
  if (!fights.length) return false;
  if (fights.some((fight) => fight.roomId)) return true;
  const sheet = getSheetForUser(campaignId, userId);
  return sheet ? Boolean(fightOf(campaignId, sheet)) : true;
}

