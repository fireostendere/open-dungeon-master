import { getCampaignById, getFightFloor, getGlobalTurnState, setFightFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { isTeamRoundFight } from "@/lib/dm/team-round";
import { endEncounter, getActiveEncounter, getEnemy, listActiveFights, listEnemies, patchEnemyHp, setEnemyConcentration, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getDmTurn, type DmTurn, type PendingRoll } from "@/lib/db/dm-turns";
import { getRoll, markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { publishPersisted } from "@/lib/events";
import { healthState } from "@/lib/bestiary/health";
import { ammoCount, recoveredAmmo, withAmmoCount } from "@/lib/srd/ammunition";
import { saveModFor } from "@/lib/bestiary/statblock";
import { d20Expression, rollExpression } from "@/lib/dice";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { enemyDamageMath } from "@/lib/dm/encounter-logic";
import { damageAdjust } from "@/lib/dm/condition-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { dismissGuestCompanions } from "@/lib/dm/companion-tools";
import { followCombatAmbience } from "@/lib/dm/ambience-tools";
import { tickWaypointsFrom } from "@/lib/dm/waypoint-tick";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spatialStore } from "@/lib/spatial/service";

// The single server-side path for damage landing on an enemy. Used by the
// damage_enemy tool AND by damage rolls carrying targetEnemyId, which the
// server applies the moment the dice land so the enemy card can never lag
// the narration. Also home to encounter finishing, shared with the turn
// loop. This module must not import encounter-tools (the import points the
// other way, same rule as map-tools).

export function publishEncounter(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", {
    encounter: activePublicEncounter(campaignId),
  });
}

export function resolveEnemyRef(encounterId: string, ref: string): EncounterEnemy | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  const direct = getEnemy(trimmed);
  if (direct && direct.encounterId === encounterId) {
    return direct;
  }
  return (
    listEnemies(encounterId).find(
      (enemy) => enemy.displayName.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
}

export function finishEncounter(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  outcome: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  // Asked before the fight ends: a fight elsewhere ends on its own; one the
  // whole party was in hands its closing hold to the table (below).
  const teamRound = !encounter.roomId && isTeamRoundFight(campaign.id, encounter);
  // Survivors scatter when the fight ends without their deaths.
  if (outcome === "enemies_fled" || outcome === "truce" || outcome === "party_fled") {
    for (const enemy of enemies) {
      if (enemy.status === "alive") {
        patchEnemyHp(enemy.id, enemy.currentHp, "fled");
      }
    }
  }
  endEncounter(encounter.id, outcome);
  // A fight the party won (or routed) ticks the [NOW] beat's fight waypoint
  // naming these foes; every ending comes through here, the automatic
  // victory on the last kill included.
  const waypointsTicked =
    outcome === "victory" || outcome === "enemies_fled"
      ? tickWaypointsFrom(campaign.id, { kind: "fight", names: enemies.map((enemy) => enemy.displayName) })
      : [];

  // Half the ammunition spent in the fight is recovered from the field
  // (PHB). Only ever non-empty when the `ammunition` variant rule is on, so
  // a table that never asked for it pays nothing here.
  const ammoRecovered: Record<string, number> = {};
  for (const [key, spent] of Object.entries(encounter.ammoSpent)) {
    const back = recoveredAmmo(spent);
    if (back <= 0) {
      continue;
    }
    const separator = key.indexOf("|");
    const sheetId = key.slice(0, separator);
    const itemName = key.slice(separator + 1);
    const owner = getSheetById(sheetId);
    if (!owner) {
      continue;
    }
    const index = owner.equipment.findIndex((item) => item.name === itemName);
    const equipment =
      index >= 0
        ? withAmmoCount(owner.equipment, index, ammoCount(owner.equipment[index]) + back)
        : [...owner.equipment, { name: itemName, qty: back }];
    patchSheet(sheetId, { equipment });
    ammoRecovered[`${owner.name}: ${itemName}`] = back;
  }

  const totalXp = enemies.reduce((sum, enemy) => sum + enemy.xp, 0);
  const share =
    outcome === "victory" ? 1 : outcome === "enemies_fled" || outcome === "truce" ? 0.5 : 0;
  // The fight's XP goes to the heroes who fought it (everyone in its
  // initiative order), never to the whole party: with a split party the
  // caller's list holds heroes standing somewhere else entirely.
  const fought = sheets.filter((sheet) => encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === sheet.id));
  const xpEach = fought.length ? Math.floor((totalXp * share) / fought.length) : 0;
  let xpResult: Record<string, unknown> = {};
  if (xpEach > 0) {
    xpResult = applyDmMutation(
      campaign,
      turn.id,
      "award_xp",
      JSON.stringify({
        characterIds: fought.map((sheet) => sheet.id),
        amount: xpEach,
        reason: outcome === "victory" ? "encounter victory" : `encounter ended: ${outcome}`,
      }),
      sheets,
      sheetsById,
    ).result;
  }

  const floor = getFightFloor(campaign.id, encounter);
  if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
    // Even a killing blow needs its consequence narrated before submissions
    // reopen. The completed gate releases to open through narration.
    const next = floor.mode === "hold" && floor.combat
      ? { ...floor, next: { mode: "open" as const }, combat: { ...floor.combat, mechanicsResolved: true } }
      : { mode: "open" as const };
    if (encounter.roomId) {
      setFightFloor(campaign.id, encounter, next);
      publishPersisted(campaign.id, "floor_changed", { floor: next });
    } else {
      // Without rooms the fight's own floor ends with it. The closing hold
      // of a whole-party fight moves to the table, where the narration that
      // tells the ending releases it, as it always did.
      setFightFloor(campaign.id, encounter, { mode: "open" });
      publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" }, encounterId: encounter.id });
      if (next.mode === "hold" && !teamRound) {
        setFloor(campaign.id, next, null);
        publishPersisted(campaign.id, "floor_changed", { floor: next, encounterId: null });
      }
    }
  }
  publishPersisted(campaign.id, "encounter_updated", { encounter: null, endedEncounterId: encounter.id });
  // Every ending, including the last killing blow, requests the post-combat
  // scene. Its final handoff starts the waiting round, never the damage itself.
  if (!encounter.roomId && campaign.gameSettings.globalTurn?.enabled && !listActiveFights(campaign.id).length) {
    const globalTurn = getGlobalTurnState(campaign.id);
    if (globalTurn.phase === "waiting") {
      publishPersisted(campaign.id, "global_turn_narrator_trigger", {
        kind: "post_combat",
        roundNumber: globalTurn.roundNumber,
      });
    }
  }
  // The fight is over, so the fight music is. Every way an encounter can
  // end comes through here, which is why the hook is here and not in the
  // end_encounter tool: a party wipe and a last enemy dropping are not
  // end_encounter calls.
  followCombatAmbience(campaign, false);
  // Clients drop their fogged map view; the archived rows stay for history.
  publishBattleMapUpdate(campaign.id);
  // Guest allies joined for this fight, so the fight ending writes them out;
  // lasting party companions stay. XP above already counted them in.
  const guestsGone = dismissGuestCompanions(campaign, "the fight ended");

  return {
    encounterOver: true,
    ...(Object.keys(ammoRecovered).length ? { ammoRecovered } : {}),
    outcome,
    ...(guestsGone.length
      ? {
          guestsDismissed: `${guestsGone.join(", ")} left with the scene; narrate the parting.`,
        }
      : {}),
    ...(xpEach > 0 ? { xpAwarded: `${xpEach} XP each` } : {}),
    ...(waypointsTicked.length ? { waypointsTicked } : {}),
    ...(typeof xpResult.levelUpAvailable !== "undefined"
      ? { levelUpAvailable: xpResult.levelUpAvailable }
      : {}),
  };
}

// Ends the encounter with victory XP once no living enemies remain.
export function autoEndOnVictory(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  if (!enemies.length || enemies.some((enemy) => enemy.status === "alive")) {
    return {};
  }
  return finishEncounter(campaign, turn, encounter, "victory", sheets, sheetsById);
}

// Applies damage to a living enemy: resistance/immunity/vulnerability math
// from the stat block, HP patch, live enemy-card update, token removal and
// auto-victory on a kill. Returns the compact tool result.
export function applyEnemyDamage(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  amount: number,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
  magical = false,
): Record<string, unknown> {
  const adjusted = damageAdjust(
    amount,
    damageType,
    enemy.stats.resist,
    enemy.stats.immune,
    enemy.stats.vulnerable,
    magical,
  );
  if (adjusted.amount <= 0) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      damageApplied: 0,
      note: `${enemy.displayName} is ${adjusted.note}. Narrate the effect washing over it harmlessly.`,
    };
  }
  const math = enemyDamageMath(enemy.currentHp, adjusted.amount);
  const updated = patchEnemyHp(enemy.id, math.currentHp, math.dropped ? "dead" : "alive");
  publishEncounter(campaign.id);
  if (!updated) {
    return { error: "Failed to update enemy." };
  }
  const base: Record<string, unknown> = {
    ok: true,
    name: updated.displayName,
    hp: `${updated.currentHp}/${updated.maxHp}`,
    health: healthState(updated.currentHp, updated.maxHp),
    ...(adjusted.note ? { damageApplied: adjusted.amount, damageNote: adjusted.note } : {}),
  };
  // Enemy concentration: damage forces the CON save (DC 10 or half the
  // damage); death breaks it outright. A break ends the spell's conditions
  // on everyone it was holding (the same cleanup a PC's break runs).
  if (enemy.concentration) {
    const spell = enemy.concentration;
    if (math.dropped) {
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, spell, undefined, { casterId: enemy.id, casterKind: "enemy" }, turn.id);
      base.concentrationBroken = `${updated.displayName}'s ${spell} ends with its death; the spell's effects fade.`;
    } else {
      const dc = Math.max(10, Math.floor(adjusted.amount / 2));
      const outcome = rollExpression(d20Expression(saveModFor(enemy.stats, "con")));
      const held = outcome.total >= dc;
      if (!held) {
        setEnemyConcentration(enemy.id, null);
        clearSpellConditionsByName(campaign, spell, undefined, { casterId: enemy.id, casterKind: "enemy" }, turn.id);
      }
      base.concentration = held
        ? `${updated.displayName} keeps concentrating on ${spell} (CON save ${outcome.total} vs DC ${dc}).`
        : `${updated.displayName} loses concentration on ${spell} (CON save ${outcome.total} vs DC ${dc}); the spell's effects end.`;
    }
  }
  if (math.dropped) {
    base.dead = true;
    base.note = `${updated.displayName} is slain. You may now narrate its death.`;
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      removeTokenByRef(map.id, enemy.id);
      publishBattleMapUpdate(campaign.id);
    }
    Object.assign(base, autoEndOnVictory(campaign, turn, encounter, sheets, sheetsById));
  }
  return base;
}

// A resolved damage roll that names its target: apply it before the model
// even sees the number. Returned payload merges into the roll's tool result.
export function autoApplyDamageRoll(
  campaign: Campaign,
  turn: DmTurn,
  targetEnemyRef: string,
  roll: StoredRoll,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
  magical = false,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { warning: "No active encounter; this damage was not applied to anyone." };
  }
  const enemy = resolveEnemyRef(encounter.id, targetEnemyRef);
  if (!enemy || enemy.status !== "alive") {
    return {
      warning: `targetEnemyId "${targetEnemyRef}" matched no living enemy; the damage was NOT applied. Call damage_enemy with an exact enemyId from GAME STATE.`,
    };
  }
  const result = applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    Math.max(1, roll.total),
    sheets,
    sheetsById,
    damageType,
    magical,
  );
  if (!("error" in result)) {
    markRollApplied(roll.id, enemy.id);
    result.note = result.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Do NOT call damage_enemy for this hit.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT call damage_enemy for this hit.`;
  }
  return result;
}

// Physical-dice variant, called from the pending-rolls route when a player
// submits a targeted damage roll. Returns the summary the resumed turn
// surfaces to the model (stored in pending_rolls.combat_note).
export function applyPendingDamageRoll(pending: PendingRoll, roll: StoredRoll): string | null {
  if (!pending.targetEnemyId && !pending.attack?.targetCharacterId) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  if (pending.attack?.targetCharacterId) {
    const target = getSheetById(pending.attack.targetCharacterId);
    const encounter = getActiveEncounter(campaign.id);
    if (!campaign.gameSettings.friendlyFire || !target || target.campaignId !== campaign.id ||
      !encounter?.order.some(entry => entry.kind === "pc" && entry.characterId === target.id) ||
      encounter.roomId && spatialStore().getUserRoom(campaign.id, target.userId) !== encounter.roomId) {
      return "The friendly-fire target is no longer available; no damage was applied.";
    }
    if (getRoll(roll.id)?.applied) return "This damage roll has already been applied.";
    const applied = applyDmMutation(campaign, turn.id, "apply_damage", JSON.stringify({
      characterId: target.id, amount: Math.max(1, roll.total), type: pending.attack.damageType,
      crit: pending.attack.crit, reason: `${pending.attack.attacker}: ${pending.attack.weapon}`,
    }), sheets, sheetsById).result;
    if ("error" in applied) return String(applied.error);
    markRollApplied(roll.id, target.id);
    return `The server applied ${roll.total} damage to ${target.name} (${String(applied.hp ?? "form HP updated")}). Do NOT apply it again.`;
  }
  const applied = autoApplyDamageRoll(
    campaign,
    turn,
    pending.targetEnemyId!,
    roll,
    sheets,
    sheetsById,
    pending.attack?.damageType,
    Boolean(pending.attack?.magical),
  );
  if (typeof applied.warning === "string") {
    return applied.warning;
  }
  if ("error" in applied) {
    return null;
  }
  const parts = [
    `The server already applied this ${roll.total} damage to ${String(applied.name)} (now ${
      applied.dead ? "SLAIN" : String(applied.health)
    }).`,
  ];
  if (applied.encounterOver) {
    parts.push(`The encounter ended: ${String(applied.outcome)}. XP was awarded automatically.`);
  }
  parts.push("Do NOT call damage_enemy for this hit; narrate from this state.");
  return parts.join(" ");
}
