import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getActiveEncounter, listEnemies, saveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { chebyshev } from "@/lib/battlemap/types";
import { isJrpgCombat } from "@/lib/dm/combat-mode";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import {
  adjudicateHit,
  resolveAttackWeapon,
  weaponAttackProfile,
} from "@/lib/dm/attack-logic";
import { computeSheetDerived, effectiveAcFor, spellAttackFor } from "@/lib/srd";
import { combatRiders, hasFeat, isPoleReachWeapon } from "@/lib/srd/feature-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { enemyDamageMath } from "@/lib/dm/encounter-logic";
import { patchEnemyHp } from "@/lib/db/encounters";
import { healthState } from "@/lib/bestiary/health";

import { applyDamageMath } from "@/lib/dm/mutation-math";
import { applyDamageDeathHook } from "@/lib/dm/death";
import {
  DODGING,
  damageAdjust,
  isIncapacitated,
  pcResistances,
} from "@/lib/dm/condition-logic";

// Opportunity attacks: walking out of an enemy's reach is not free. Before
// this, a player could stroll away from a troll with no consequence at all,
// which is the single most-noticed missing rule in 5e combat.
//
// Resolved here rather than through handleEnemyAttack because the trigger
// fires from the player's own token-move route, which has no DM turn to
// hang tool calls on. The outcome posts as a table note, exactly like the
// death saves the server rolls between turns.

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export type OpportunityOutcome = {
  notes: string[];
  downed: boolean;
};

// Every living enemy that had the mover within reach before the step and
// does not after it. Reach is 1 tile for almost everything; the stat block's
// own reach wording ("10 ft.") widens it.
function enemyReachTiles(speedOrAttack: string): number {
  return /reach 1[05] ft/i.test(speedOrAttack) ? 2 : 1;
}

// Resolves the opportunity attacks a character's move provokes, applying
// damage and posting table notes. `disengaged` suppresses all of them.
export function resolveOpportunityAttacks(
  campaign: Campaign,
  characterId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  disengaged: boolean,
): OpportunityOutcome {
  const empty: OpportunityOutcome = { notes: [], downed: false };
  if (disengaged || isJrpgCombat(campaign)) {
    return empty;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return empty;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return empty;
  }
  const notes: string[] = [];
  let downed = false;

  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || isIncapacitated(enemy.conditions)) {
      continue;
    }
    if (encounter.reactionsUsed.includes(enemy.id)) {
      continue;
    }
    const token = getTokenByRef(map.id, enemy.id);
    if (!token) {
      continue;
    }
    // Its first melee attack that deals damage: a web or a bow is no
    // opportunity attack.
    const attack = enemy.stats.attacks.find((entry) => entry.damage && (entry.reach !== undefined || entry.range === undefined));
    if (!attack) {
      continue;
    }
    const reach = attack.reach !== undefined
      ? Math.max(1, Math.floor(attack.reach / 5))
      : enemyReachTiles(`${attack.name} ${enemy.stats.traits.join(" ")}`);
    const wasInReach = chebyshev(token.x, token.y, from.x, from.y) <= reach;
    const stillInReach = chebyshev(token.x, token.y, to.x, to.y) <= reach;
    if (!wasInReach || stillInReach) {
      continue;
    }

    const sheet = getSheetById(characterId);
    if (!sheet || sheet.currentHp <= 0) {
      break;
    }
    // The reaction is spent whether or not the swing lands.
    encounter.reactionsUsed = [...encounter.reactionsUsed, enemy.id];
    saveEncounter(encounter);

    const dodging = sheet.conditions.some((entry) => entry.toLowerCase() === DODGING);
    const hitOutcome = rollExpression(
      d20Expression(attack.toHit, dodging ? "disadvantage" : "none"),
    );
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "attack",
      detail: `${enemy.displayName}: opportunity attack on ${sheet.name}`,
      advantage: dodging ? "disadvantage" : "none",
      result: hitOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, effectiveAcFor(sheet));
    if (!adjudicated.hit) {
      notes.push(
        `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away and misses (${hitOutcome.total} vs AC ${effectiveAcFor(sheet)}).`,
      );
      continue;
    }

    const damageOutcome = rollExpression(
      adjudicated.crit ? `${attack.damage}+${attack.damage.split("+")[0]}` : attack.damage,
    );
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: null,
      requestedBy: "dm",
      kind: "damage",
      detail: `${enemy.displayName}: opportunity attack damage`,
      result: damageOutcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });

    // The character's own resistances apply exactly as they would to any
    // other hit (rage, dwarven poison resistance, tiefling fire).
    const adjusted = damageAdjust(
      Math.max(1, damageOutcome.total),
      attack.type,
      pcResistances(sheet),
      "",
      "",
    );
    const math = applyDamageMath(sheet.currentHp, sheet.tempHp, adjusted.amount);
    const patch = { currentHp: math.currentHp, tempHp: math.tempHp };
    patchSheet(sheet.id, patch);
    const entry = insertSheetAudit({
      campaignId: campaign.id,
      characterId: sheet.id,
      turnId: null,
      kind: "damage",
      delta: patch,
      reason: `opportunity attack from ${enemy.displayName}`,
      seq: allocateSeq(campaign.id),
      before: sheet,
      patch,
    });
    publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
    // The death engine owns what happens at 0 HP.
    applyDamageDeathHook(campaign, null, sheet, math, adjudicated.crit);
    const updated = getSheetById(sheet.id);
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    if (math.currentHp <= 0) {
      downed = true;
    }
    notes.push(
      `${enemy.displayName} takes an opportunity attack as ${sheet.name} pulls away: ${
        adjudicated.crit ? "a critical hit for " : "hit for "
      }${adjusted.amount} damage${adjusted.note ? ` (${adjusted.note})` : ""}.`,
    );
  }

  for (const note of notes) {
    tableNote(campaign, note);
  }
  return { notes, downed };
}


// ---- the characters' reactions ----

// The melee weapon a character's reactions swing: their best carried melee
// weapon, else an unarmed strike when they carry no weapon at all. A
// character holding only a bow has no reaction swing to make.
function reactionProfile(sheet: CharacterSheet) {
  const derived = computeSheetDerived(sheet);
  const riders = combatRiders(sheet);
  const ranged = (item: CharacterSheet["equipment"][number]) => {
    const resolved = resolveAttackWeapon([item], sheet.proficiencies.weapons, undefined);
    return !resolved.unarmed && resolved.srd?.kind === "ranged";
  };
  const melee = sheet.equipment.filter((item) => !ranged(item));
  const resolved = resolveAttackWeapon(melee, sheet.proficiencies.weapons, undefined);
  if (resolved.unarmed && melee.length < sheet.equipment.length && sheet.equipment.some(ranged)) {
    return null;
  }
  const escapedWeapon = resolved.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shillelagh = sheet.conditions.some((condition) =>
    new RegExp(`^shillelagh \\(${escapedWeapon}\\)$`, "i").test(condition),
  );
  const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, {
    riders,
    ...(shillelagh
      ? {
          shillelagh: {
            abilityMod:
              (spellAttackFor(sheet, "Shillelagh") ?? derived.spellAttack ?? derived.proficiencyBonus) -
              derived.proficiencyBonus,
          },
        }
      : {}),
  });
  if (profile.ranged) {
    return null;
  }
  return {
    profile,
    riders,
    // Polearm Master: a creature entering this reach provokes too.
    polearm: hasFeat(sheet, "polearm master") && isPoleReachWeapon(resolved.srd?.name),
    sentinel: hasFeat(sheet, "sentinel"),
  };
}

type Reactor = NonNullable<ReturnType<typeof reactionProfile>> & { sheet: CharacterSheet };

// One reaction swing by a character at an enemy. The reaction is spent
// whether it lands or not; the damage is applied straight to the enemy
// (applyEnemyDamage owns ending the fight, which needs a DM turn this
// trigger does not have, so a killing blow is reported and the narrator
// ends the fight next).
function reactionSwing(
  campaign: Campaign,
  encounter: Encounter,
  reactor: Reactor,
  enemy: EncounterEnemy,
  trigger: string,
): { note: string; hit: boolean; dropped: boolean } {
  const { sheet, profile, riders } = reactor;
  encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
  saveEncounter(encounter);

  const hitOutcome = rollExpression(d20Expression(profile.toHit));
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail: `${sheet.name}: reaction attack on ${enemy.displayName}`,
    result: hitOutcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: hitRoll,
    source: "digital",
  });
  const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, enemy.ac, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  if (!adjudicated.hit) {
    return {
      note: `${sheet.name} swings at ${enemy.displayName} ${trigger} and misses (${hitOutcome.total} vs AC ${enemy.ac}).`,
      hit: false,
      dropped: false,
    };
  }

  const damageOutcome = rollExpression(
    adjudicated.crit ? `${profile.damageExpression}+${profile.damageExpression.split(/[+-]/)[0]}` : profile.damageExpression,
  );
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: `${sheet.name}: reaction attack damage`,
    result: damageOutcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll: damageRoll,
    source: "digital",
  });
  const adjusted = damageAdjust(
    Math.max(1, damageOutcome.total),
    profile.damageType,
    enemy.stats.resist,
    enemy.stats.immune,
    enemy.stats.vulnerable,
    profile.magical,
  );
  const math = enemyDamageMath(enemy.currentHp, adjusted.amount);
  patchEnemyHp(enemy.id, math.currentHp, math.dropped ? "dead" : "alive");
  publishPersisted(campaign.id, "encounter_updated", { encounterId: encounter.id });
  return {
    note: `${sheet.name} catches ${enemy.displayName} ${trigger}: ${adjudicated.crit ? "a critical hit for " : ""}${adjusted.amount} damage${
      adjusted.note ? ` (${adjusted.note})` : ""
    }. ${math.dropped ? `${enemy.displayName} drops.` : `It is now ${healthState(math.currentHp, enemy.maxHp)}.`}`,
    hit: true,
    dropped: math.dropped,
  };
}

// Every character on the board who can still react with a melee weapon.
function reactors(campaign: Campaign, encounter: Encounter, mapId: string): Array<Reactor & { at: { x: number; y: number } }> {
  return listSheets(campaign.id).flatMap((sheet) => {
    if (sheet.currentHp <= 0 || isIncapacitated(sheet.conditions) || encounter.reactionsUsed.includes(sheet.id)) {
      return [];
    }
    const token = getTokenByRef(mapId, sheet.id);
    const reaction = token ? reactionProfile(sheet) : null;
    return token && reaction ? [{ ...reaction, sheet, at: { x: token.x, y: token.y } }] : [];
  });
}

export type PathReactions = {
  notes: string[];
  // Index into the walked path where the enemy ends up: the last tile, or
  // where a Sentinel's hit or a killing blow stopped it.
  stopIndex: number;
  stopped: boolean;
  dropped: boolean;
};

// The characters' side of opportunity attacks, step by step along an
// enemy's walk (path[0] is where it started). Leaving a character's reach
// provokes; with Polearm Master and a glaive, halberd, pike, quarterstaff or
// spear, entering it provokes too. A Sentinel's hit drops the enemy's speed
// to 0 where it stands, and a killing blow ends the walk. Fires from every
// enemy step (move_token and the auto-approach before an attack) and spends
// each character's reaction out of the same per-round list the enemies use.
export function resolvePcReactionsAlongPath(
  campaign: Campaign,
  enemyId: string,
  path: Array<{ x: number; y: number }>,
): PathReactions {
  const last = Math.max(0, path.length - 1);
  const result: PathReactions = { notes: [], stopIndex: last, stopped: false, dropped: false };
  if (isJrpgCombat(campaign) || path.length < 2) {
    return result;
  }
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return result;
  }
  const ready = reactors(campaign, encounter, map.id);
  walk: for (let step = 0; step < last; step += 1) {
    const from = path[step];
    const to = path[step + 1];
    for (const reactor of ready) {
      if (encounter.reactionsUsed.includes(reactor.sheet.id)) {
        continue;
      }
      const reach = reactor.profile.reachTiles;
      const wasIn = chebyshev(reactor.at.x, reactor.at.y, from.x, from.y) <= reach;
      const isIn = chebyshev(reactor.at.x, reactor.at.y, to.x, to.y) <= reach;
      const leaving = wasIn && !isIn;
      const entering = !wasIn && isIn && reactor.polearm;
      if (!leaving && !entering) {
        continue;
      }
      const enemy = listEnemies(encounter.id).find((entry) => entry.id === enemyId);
      if (!enemy || enemy.status !== "alive") {
        break walk;
      }
      const swing = reactionSwing(
        campaign,
        encounter,
        reactor,
        enemy,
        leaving ? "as it breaks away (opportunity attack)" : "as it steps into reach (Polearm Master)",
      );
      result.notes.push(swing.note);
      // Leaving: the swing lands before it goes. Entering: once it is in.
      const at = leaving ? step : step + 1;
      if (swing.dropped) {
        Object.assign(result, { stopIndex: at, stopped: true, dropped: true });
        break walk;
      }
      if (swing.hit && reactor.sentinel) {
        result.notes.push(`Sentinel: ${enemy.displayName}'s speed drops to 0 for the rest of its turn; it stops there.`);
        Object.assign(result, { stopIndex: at, stopped: true });
        break walk;
      }
    }
  }
  for (const note of result.notes) {
    tableNote(campaign, note);
  }
  return result;
}

// The endpoint form of the same rule, for a move known only by where it
// started and ended.
export function resolvePcOpportunityAttacks(
  campaign: Campaign,
  enemyId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): string[] {
  return resolvePcReactionsAlongPath(campaign, enemyId, [from, to]).notes;
}

// Sentinel: an enemy within 5 feet that attacks someone else (who has no
// Sentinel of their own) takes a melee reaction attack from the sentinel.
export function resolveSentinelGuard(campaign: Campaign, enemyId: string, targetCharacterId: string): string[] {
  if (isJrpgCombat(campaign)) {
    return [];
  }
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const target = getSheetById(targetCharacterId);
  const enemyToken = map ? getTokenByRef(map.id, enemyId) : null;
  if (!encounter || !map || !enemyToken || !target || hasFeat(target, "sentinel")) {
    return [];
  }
  const notes: string[] = [];
  for (const reactor of reactors(campaign, encounter, map.id)) {
    if (!reactor.sentinel || reactor.sheet.id === targetCharacterId ||
        chebyshev(reactor.at.x, reactor.at.y, enemyToken.x, enemyToken.y) > 1) {
      continue;
    }
    const enemy = listEnemies(encounter.id).find((entry) => entry.id === enemyId);
    if (!enemy || enemy.status !== "alive") {
      break;
    }
    notes.push(reactionSwing(campaign, encounter, reactor, enemy, `for attacking ${target.name} (Sentinel)`).note);
  }
  for (const note of notes) {
    tableNote(campaign, note);
  }
  return notes;
}
