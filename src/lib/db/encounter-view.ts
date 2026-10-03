import { healthState, type HealthState } from "@/lib/bestiary/health";
import { creatureTypeOf } from "@/lib/bestiary/statblock";
import { getBattleMapForEncounter, listHiddenRefIds } from "@/lib/db/battle-maps";
import {
  getActiveEncounter,
  listEnemies,
  orderEntryId,
  type Encounter,
  type EncounterEnemy,
  type EncounterStatus,
  type EnemyStatus,
} from "@/lib/db/encounters";
import { spatialStore } from "@/lib/spatial/service";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { inTeamRoundFight, isTeamRoundFight } from "@/lib/dm/team-round";
import { getCampaignById } from "@/lib/db/campaigns";
import type { EnemyConditionVisibility, EnemyHpVisibility } from "@/lib/schemas/game-settings-options";

// What a client is allowed to know about a fight. Split out of
// encounters.ts, which is persistence: this is the projection, and it is the
// only shape that ever leaves the server.

// Client-safe projection. Campaign settings may expose a health bar, exact HP,
// condition names, or condition duration to players, but AC/initiative remain
// DM-only. The DM seat always receives the full mechanical view regardless of
// presentation settings. That grant comes from src/lib/dm/viewer.ts and is
// never a raw id comparison here.
export type PublicEncounter = {
  id: string;
  status: EncounterStatus;
  round: number;
  turnIndex: number;
  orderReady: boolean;
  // Never infer this from a filtered initiative list. A hidden enemy yields
  // null, so its identity does not leak to player clients.
  currentActorId: string | null;
  turnBudget: { actionUsed: boolean; bonusUsed: boolean; reactionUsed: boolean; attacksMade: number; attacksAllowed: number; extraActions?: number; oncePerTurn?: string[]; spellsCast?: Array<{ cost: "action" | "bonus" | "reaction"; level: number }> } | null;
  order: Array<{
    kind: "pc" | "enemy" | "npc";
    id: string;
    name: string;
    hidden: boolean;
    // DM view only, like the enemy numbers below.
    initiative?: number;
  }>;
  enemies: Array<{
    id: string;
    name: string;
    health: HealthState;
    status: EnemyStatus;
    cr: number;
    // SRD creature type off the snapshot, for the thumbnail.
    type: string;
    // Kept off the players' board and tracker by the DM. Only ever true in
    // the DM's own projection: a hidden enemy is absent from a player's.
    hidden: boolean;
    // The mob this one belongs to: every enemy from the same stat block in
    // this fight shares it. Initiative never stopped on enemies
    // individually (advanceOrder walks past them all to the next PC), so
    // this is what lets the panel show a mob as one line the DM can open up
    // rather than four rows of the same goblin.
    groupKey: string;
    conditions: string[];
    conditionRounds: Record<string, number>;
    // Player-visible only when the campaign enables an HP bar or exact HP.
    hpPercent?: number;
    currentHp?: number;
    maxHp?: number;
    // DM view only.
    ac?: number;
    initiative?: number | null;
  }>;
  // Heroes standing away from a fight only part of the party is in. They
  // play the team round instead and watch this fight (src/lib/dm/team-round.ts).
  outsideIds?: string[];
};

export function publicEncounter(
  encounter: Encounter,
  enemies: EncounterEnemy[],
  options: {
    enemyNumbers?: boolean;
    hiddenRefIds?: string[];
    enemyHpVisibility?: EnemyHpVisibility;
    enemyConditionVisibility?: EnemyConditionVisibility;
  } = {},
): PublicEncounter {
  const showNumbers = options.enemyNumbers === true;
  const hpVisibility = options.enemyHpVisibility ?? "state";
  const conditionVisibility = options.enemyConditionVisibility ?? "status_turns";
  const showHpBar = showNumbers || hpVisibility === "bar" || hpVisibility === "exact";
  const showExactHp = showNumbers || hpVisibility === "exact";
  const showConditions = showNumbers || conditionVisibility !== "hidden";
  const showConditionTurns = showNumbers || conditionVisibility === "status_turns";
  // Hidden is one flag on the board token (src/lib/db/battle-maps.ts) and it
  // means the same thing in both places: an ambusher the players have not
  // met yet is neither on the map nor on the tracker.
  const hidden = new Set(options.hiddenRefIds ?? []);
  const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const currentId = current ? orderEntryId(current) : null;
  const currentVisible = Boolean(currentId && (showNumbers || !hidden.has(currentId)));
  return {
    id: encounter.id,
    status: encounter.status,
    round: encounter.round,
    turnIndex: encounter.turnIndex,
    orderReady: encounter.orderReady,
    currentActorId: currentVisible ? currentId : null,
    turnBudget: currentVisible && current?.kind === "pc" && encounter.turnBudget?.ownerId === current.characterId && encounter.turnBudget.round === encounter.round
      ? { actionUsed: encounter.turnBudget.actionUsed, bonusUsed: encounter.turnBudget.bonusUsed, reactionUsed: encounter.reactionsUsed.includes(current.characterId) || encounter.turnBudget.reactionUsed, attacksMade: encounter.turnBudget.attacksMade, attacksAllowed: encounter.turnBudget.attacksAllowed, extraActions: encounter.turnBudget.extraActions, oncePerTurn: encounter.turnBudget.oncePerTurn.filter(key => key.startsWith("pet:")), spellsCast: encounter.turnBudget.spellsCast }
      : null,
    order: encounter.orderReady
      ? encounter.order
          // A hidden combatant is not on the players' tracker at all. The DM
          // gets the whole order, marked, because they are the one hiding it.
          .filter((entry) => showNumbers || !hidden.has(orderEntryId(entry)))
          .map((entry) => ({
            kind: entry.kind,
            id: orderEntryId(entry),
            name: entry.name,
            hidden: hidden.has(orderEntryId(entry)),
            // The count itself rides along only for the seat that may edit
            // it. Players hear initiative announced; they do not need a
            // column of it, and the tracker has never shown one.
            ...(showNumbers ? { initiative: entry.initiative } : {}),
          }))
      : [],
    enemies: enemies
      .filter((enemy) => showNumbers || !hidden.has(enemy.id))
      .map((enemy) => ({
      id: enemy.id,
      hidden: hidden.has(enemy.id),
      name: enemy.displayName,
      health: enemy.status === "fled" ? "healthy" : healthState(enemy.currentHp, enemy.maxHp),
      status: enemy.status,
      cr: enemy.cr,
      type: creatureTypeOf(enemy.stats),
      groupKey: enemy.slug,
      ...(showHpBar
        ? { hpPercent: enemy.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((enemy.currentHp / enemy.maxHp) * 100))) : 0 }
        : {}),
      conditions: showConditions && enemy.status === "alive" ? enemy.conditions : [],
      conditionRounds:
        showConditionTurns && enemy.status === "alive"
          ? Object.fromEntries(
              Object.entries(enemy.conditionMeta)
                .filter(([, meta]) => typeof meta.rounds === "number")
                .map(([name, meta]) => [name, meta.rounds as number]),
            )
          : {},
      ...(showExactHp ? { currentHp: enemy.currentHp, maxHp: enemy.maxHp } : {}),
      ...(showNumbers ? { ac: enemy.ac, initiative: enemy.initiative } : {}),
    })),
  };
}

export function activePublicEncounter(
  campaignId: string,
  options: {
    enemyNumbers?: boolean;
    viewerUserId?: string;
    roomId?: string | null;
    enemyHpVisibility?: EnemyHpVisibility;
    enemyConditionVisibility?: EnemyConditionVisibility;
  } = {},
): PublicEncounter | null {
  const encounter = getActiveEncounter(campaignId, options.roomId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const hidden = new Set<string>(map ? listHiddenRefIds(map.id) : []);
  if (!options.enemyNumbers && options.viewerUserId) {
    const store = spatialStore();
    const own = getSheetForUser(campaignId, options.viewerUserId);
    if (own) hidden.delete(own.id);
    const observerIds = [options.viewerUserId, own?.id ?? options.viewerUserId];
    for (const entry of encounter.order) {
      const id = orderEntryId(entry);
      if (entry.kind === "pc" && entry.userId === options.viewerUserId) continue;
      if (store.isUnseen(campaignId, id, observerIds, encounter.roomId)) hidden.add(id);
    }
    for (const enemy of listEnemies(encounter.id)) {
      if (store.isUnseen(campaignId, enemy.id, observerIds, encounter.roomId)) hidden.add(enemy.id);
    }
  }
  const settings = getCampaignById(campaignId)?.gameSettings;
  const projection = publicEncounter(encounter, listEnemies(encounter.id), {
    ...options,
    enemyHpVisibility: options.enemyHpVisibility ?? settings?.enemyHpVisibility,
    enemyConditionVisibility: options.enemyConditionVisibility ?? settings?.enemyConditionVisibility,
    hiddenRefIds: Array.from(hidden),
  });
  if (!isTeamRoundFight(campaignId, encounter)) return projection;
  return {
    ...projection,
    outsideIds: listSheets(campaignId).filter((sheet) => !inTeamRoundFight(campaignId, encounter, sheet)).map((sheet) => sheet.id),
  };
}
