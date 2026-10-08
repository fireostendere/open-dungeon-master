import { z } from "zod";
import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { chebyshev } from "@/lib/battlemap/types";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { spendAmmo, withAmmoCount } from "@/lib/srd/ammunition";
import { insertRoll, markRollApplied, type StoredRoll } from "@/lib/db/rolls";
import {
  createPendingRoll,
  getDmTurn,
  listOpenPendingRolls,
  publicPendingRoll,
  type DmTurn,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { d20Expression, isValidExpression, rollExpression, withExtraD20, type Advantage } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived, powerfulBuildForRace, sizeForRace, spellAttackFor } from "@/lib/srd";
import { classLevelFor } from "@/lib/srd/multiclass";
import { spellDamageFor, spellMechanicsFor } from "@/lib/content";
import { castRedirect, handleCastAtPlayer } from "@/lib/dm/cast-tools";
import {
  adjudicateHit,
  poleStrikeProfile,
  ragingMeleeBonus,
  resolveAttackWeapon,
  spellAttackProfile,
  weaponAttackProfile,
  type AttackProfile,
} from "@/lib/dm/attack-logic";
import { BONUS_ATTACKS, attackWeaponUse, bonusAttackError, type BonusAttackKind } from "@/lib/dm/bonus-attacks";
import { GWM_TRIGGER, markGwmTrigger } from "@/lib/dm/bonus-trigger";
import type { AttackWeaponUse } from "@/lib/dm/action-budget";
import { combatRiders, hasElvenAccuracy, hasFeat, hasHalflingLuck } from "@/lib/srd/feature-effects";
import {
  conditionExtraActions,
  conditionOnHitDice,
  conditionRollRiders,
  grantedAttackDice,
  grantedAttackFor,
} from "@/lib/srd/condition-effects";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import {
  attackContext,
  exhaustionRollState,
  incapacitatedBy,
  mergeAdvantage,
  removeConditions,
} from "@/lib/dm/condition-logic";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { applyDmMutation } from "@/lib/dm/mutations";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { patchEnemyConditions } from "@/lib/db/encounters";
import { saveModFor } from "@/lib/bestiary/statblock";
import { allyAdjacentToEnemy, checkPcAttackRange, pcAttackSpatials } from "@/lib/dm/map-tools";
import {
  attacksAllowedFor,
  budgetFor,
  currentCombatantId,
  storeBudget,
} from "@/lib/dm/action-tools";
import { attacksLeft, claimOncePerTurn, spendAction, spendAttack } from "@/lib/dm/action-budget";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { resolveCombatTarget } from "@/lib/dm/combat-target";
import { revealAfterAction } from "@/lib/dm/concealment";
import { allSpellNames } from "@/lib/srd/spell-lists";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The pc_attack engine: full server resolution of player attacks. The
// to-hit bonus and damage dice come from the sheet and the SRD weapon
// table, the roll is adjudicated against the enemy's real AC, and damage
// lands through applyEnemyDamage, so the model can no longer decide hits,
// invent modifiers, or forget to apply damage. Physical-dice players still
// roll their own d20 and damage via chained pending rolls. This module must
// not import encounter-tools (the import points the other way); it does
// import mutations for the Divine Smite slot spend, exactly as cast-tools
// does, and mutations must never import back.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const pcAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "pc_attack",
    description:
      "A player character attacks an enemy, or a party character when friendlyFire is enabled. Choose exactly one targetEnemyId or targetCharacterId. The server derives their attack bonus and damage from their sheet, rolls to-hit against the enemy's real AC, applies damage on a hit, and reports the outcome for you to narrate. Use this for EVERY weapon attack and attack-roll spell a player makes; never adjudicate a player's attack yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        targetCharacterId: { type: "string", description: "Exact characterId of the target; requires friendlyFire=true." },
        enemyId: {
          type: "string",
          description: "Legacy compatibility alias for targetEnemyId; when supplied it must be the same enemy.",
        },
        weapon: {
          type: "string",
          description:
            "Weapon they attack with, from their equipment. Omit to use their best carried weapon.",
        },
        spell: {
          type: "string",
          description:
            "Attack-roll spell (e.g. Fire Bolt or Eldritch Blast) instead of a weapon. The server derives damage and spends the action and any slot.",
        },
        level: { type: "integer", minimum: 0, maximum: 9, description: "Spell slot level; omit for the spell's base level. Cantrips spend no slot." },
        damage: {
          type: "string",
          description: "Spell attacks only: the spell's damage dice, e.g. '1d10' or '4d6'.",
        },
        damageType: { type: "string", description: "Spell attacks only: the damage type." },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
          description: "Situational advantage or disadvantage from the fiction.",
        },
        twoHanded: {
          type: "boolean",
          description:
            "They swing a versatile weapon in both hands (bigger damage die). Ignore for other weapons.",
        },
        offHand: {
          type: "boolean",
          description:
            "Legacy alias for bonusAttack='off_hand': the bonus-action second attack of two-weapon fighting.",
        },
        bonusAttack: {
          type: "string",
          enum: [...BONUS_ATTACKS],
          description:
            "A bonus-action weapon attack after the Attack action: off_hand (two-weapon fighting; Dual Wielder allows non-light one-handed weapons), pole_strike (Polearm Master, 1d4 bludgeoning butt end of a glaive/halberd/quarterstaff/spear), crossbow_expert (Crossbow Expert, a held hand crossbow), great_weapon_master (only after a melee critical hit or kill this turn; otherwise it is skipped and nothing is spent; a downed or missing target switches to the nearest living enemy in reach).",
        },
        powerAttack: {
          type: "boolean",
          description:
            "Great Weapon Master (heavy melee weapon) or Sharpshooter (ranged weapon): -5 to hit, +10 damage. Only when the player declared it.",
        },
        lucky: {
          type: "boolean",
          description: "Lucky feat: spend a luck point for an extra d20 on this attack roll (the highest counts). Only when the player declared it.",
        },
        sneakAttack: { type: "boolean", description: "Only true when the player declares Sneak Attack as a rider on a queued attack or in prose. Eligibility and once-per-turn are still checked." },
        flurry: { type: "boolean", description: "Use one remaining unarmed strike from paid Flurry of Blows; requires weapon='Unarmed strike'." },
        smite: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description:
            "Paladin Divine Smite: the spell slot level to burn on a hit. The server spends the slot and adds the radiant dice.",
        },
        maneuver: {
          type: "string",
          description:
            "Battle Master maneuver riding this weapon attack (e.g. 'Trip Attack', 'Precision Attack', 'Menacing Attack'). The server spends a Superiority Die, adds it to the damage (Precision: to the attack roll), and rolls the target's save against the maneuver's rider.",
        },
      },
      required: ["characterId"],
    },
  },
};

const pcAttackArgsSchema = z.object({
  characterId: z.string(),
  targetEnemyId: z.string().optional(),
  targetCharacterId: z.string().optional(),
  enemyId: z.string().optional(),
  weapon: z.string().max(80).optional(),
  spell: z.string().max(80).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  level: z.number().int().min(0).max(9).optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
  twoHanded: z.coerce.boolean().optional(),
  offHand: z.coerce.boolean().optional(),
  bonusAttack: z.enum(BONUS_ATTACKS).optional(),
  powerAttack: z.boolean().optional(),
  lucky: z.boolean().optional(),
  sneakAttack: z.boolean().optional(),
  flurry: z.boolean().optional(),
  smite: z.coerce.number().int().min(1).max(9).optional(),
  maneuver: z.string().max(60).optional(),
});

// Battle Master superiority die by fighter level.
export function superiorityDie(level: number): string {
  if (level >= 18) return "d12";
  if (level >= 10) return "d10";
  return "d8";
}

// The condition a maneuver's rider save decides, when it has one.
const MANEUVER_RIDERS: Array<{ match: RegExp; condition: string; save: "str" | "wis" }> = [
  { match: /trip/i, condition: "prone", save: "str" },
  { match: /menacing/i, condition: "frightened", save: "wis" },
  { match: /disarm/i, condition: "disarmed", save: "str" },
  { match: /goading/i, condition: "goaded", save: "wis" },
];

function publishRoll(campaignId: string, roll: StoredRoll) {
  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    source: "digital",
  });
}

// What the bonus action is spent on, for the refusal text.
const BONUS_ATTACK_LABEL: Record<BonusAttackKind, string> = {
  off_hand: "an off-hand attack",
  pole_strike: "a Polearm Master butt strike",
  crossbow_expert: "a Crossbow Expert hand crossbow shot",
  great_weapon_master: "a Great Weapon Master attack",
};

// Great Weapon Master's swing often follows a kill, so a target that is
// down (or none named) gives way to the nearest living enemy within the
// weapon's reach. No board: the first living enemy. Null: nobody to hit.
function gwmTarget(
  campaign: Campaign,
  encounter: Encounter,
  sheet: CharacterSheet,
  args: { targetEnemyId?: string; weapon?: string },
): string | null {
  const living = listEnemies(encounter.id).filter((enemy) => enemy.status === "alive");
  if (args.targetEnemyId && living.some((enemy) => enemy.id === args.targetEnemyId)) {
    return args.targetEnemyId;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const me = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !me) {
    return living[0]?.id ?? null;
  }
  const weapon = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, args.weapon);
  const reach = weapon.srd?.properties?.includes("reach") ? 2 : 1;
  const inReach = living
    .map((enemy) => ({ enemy, token: getTokenByRef(map.id, enemy.id) }))
    .filter((entry) => entry.token && chebyshev(me.x, me.y, entry.token.x, entry.token.y) <= reach)
    .sort((a, b) => chebyshev(me.x, me.y, a.token!.x, a.token!.y) - chebyshev(me.x, me.y, b.token!.x, b.token!.y));
  return inReach[0]?.enemy.id ?? null;
}

// Sentinel the turn loop checks: a parked pc_attack pushes no tool result
// now; the resumed turn answers it with the adjudicated roll.
export const PC_ATTACK_PARKED = "_parked";

export function handlePcAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  realDiceUserIds: Set<string>,
  toolCallId: string | null,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter. Call start_encounter first." };
  }
  let args: z.infer<typeof pcAttackArgsSchema>;
  try {
    args = pcAttackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: pc_attack needs characterId and exactly one targetEnemyId or targetCharacterId." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet.currentHp <= 0) {
    return { error: `${sheet.name} is at 0 HP and cannot attack.` };
  }
  {
    if (currentCombatantId(encounter) !== sheet.id) {
      return { error: "Only the current encounter participant may take this attack turn." };
    }
    if (listOpenPendingRolls(campaign.id).length) {
      return { error: "Resolve pending rolls before another attack." };
    }
  }
  if (args.enemyId && args.enemyId !== args.targetEnemyId) {
    return { error: "enemyId and targetEnemyId must identify the same enemy." };
  }
  if (args.flurry && (args.spell || args.offHand || args.weapon !== "Unarmed strike" ||
      (encounter.turnBudget?.flurryAttacksRemaining ?? 0) < 1 || encounter.turnBudget?.ownerId !== sheet.id || encounter.turnBudget.round !== encounter.round)) {
    return { error: "Flurry requires a paid remaining strike and weapon='Unarmed strike'; it cannot cast or use an off-hand weapon." };
  }
  const stoppedBy = incapacitatedBy(sheet.conditions);
  if (stoppedBy) {
    return { error: `${sheet.name} is ${stoppedBy} and cannot attack.` };
  }
  // Bonus-action weapon attacks (two-weapon fighting and the feats).
  const bonusAttack: BonusAttackKind | undefined = args.bonusAttack ?? (args.offHand ? "off_hand" : undefined);
  if (bonusAttack && (args.spell || args.flurry || sheet.wildShape?.attacks?.length)) {
    return { error: "A bonus-action weapon attack needs a held weapon; it cannot be a spell, a Flurry strike or a beast form's attack." };
  }
  const featNeeded: Partial<Record<BonusAttackKind, Parameters<typeof hasFeat>[1]>> = {
    pole_strike: "polearm master",
    crossbow_expert: "crossbow expert",
    great_weapon_master: "great weapon master",
  };
  const requiredFeat = bonusAttack ? featNeeded[bonusAttack] : undefined;
  if (requiredFeat && !hasFeat(sheet, requiredFeat)) {
    return { error: `${sheet.name} does not have the ${requiredFeat.replace(/\b\w/g, (letter) => letter.toUpperCase())} feat.` };
  }
  if (bonusAttack === "great_weapon_master") {
    // Only a melee critical hit or a kill this turn opens it. A queued
    // "if it triggers" swing that did not trigger spends nothing.
    const live = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
    if (!live?.oncePerTurn.includes(GWM_TRIGGER)) {
      return {
        ok: true,
        skipped: true,
        attacker: sheet.name,
        note: `Great Weapon Master: ${sheet.name} scored no melee critical hit or kill this turn, so the bonus-action attack does not happen. Nothing was spent; narrate nothing for it.`,
      };
    }
    const retarget = gwmTarget(campaign, encounter, sheet, args);
    if (!retarget) {
      return {
        ok: true,
        skipped: true,
        attacker: sheet.name,
        note: `Great Weapon Master: no living enemy is within ${sheet.name}'s reach, so the bonus-action attack does not happen. Nothing was spent.`,
      };
    }
    args.targetEnemyId = retarget;
    args.enemyId = retarget;
    delete args.targetCharacterId;
  }
  // Lucky: a luck point must be there before anything else is spent. A
  // point spent earlier (use_resource) and still held covers this roll too.
  const heldLuck = sheet.conditions.some((entry) => entry.toLowerCase() === "lucky");
  if (args.lucky && !heldLuck) {
    const luck = sheet.resources.luck_points;
    if (!luck || luck.used >= luck.max) {
      return { error: `${sheet.name} has no luck points left${luck ? "" : " (no Lucky feat)"}.` };
    }
  }
  // A known spell passed in the weapon field is an unambiguous caller error,
  // not an improvised weapon. Preserve explicitly carried/granted weapons.
  if (!args.spell && args.weapon && !sheet.equipment.some(item => item.name.toLowerCase() === args.weapon!.toLowerCase()) &&
      !grantedAttackFor(sheet.conditions, args.weapon) &&
      allSpellNames(sheet.spellcasting).some(name => name.toLowerCase() === args.weapon!.toLowerCase())) {
    args.spell = args.weapon;
    delete args.weapon;
  }
  const enemy = resolveCombatTarget(campaign, encounter, args);
  if ("error" in enemy) return enemy;
  if (enemy.id === sheet.id) return { error: "An attack must target another combatant." };

  const derived = computeSheetDerived(sheet);
  // Everything the character's features add to an attack: fighting styles,
  // Martial Arts, Sneak Attack, crit range, Brutal Critical, Divine Smite.
  const riders = combatRiders(sheet);
  let profile: AttackProfile;
  // What the swing is made with, for the Attack-action record and the
  // bonus-action rules; null for spells and granted attacks.
  let weaponUse: AttackWeaponUse | null = null;
  let carriedCopies = 0;
  // Set when the server derived the spell's dice itself, for the notes.
  let scalingNote: string | null = null;
  // An attack option a condition grants (Starry Form's Archer, Spiritual
  // Weapon): the server owns its dice and it rides a bonus action.
  const grantedTerm = [args.weapon, args.spell].filter(Boolean).join(" ").trim();
  const granted = grantedTerm ? grantedAttackFor(sheet.conditions, grantedTerm) : null;
  let grantedBonusAction = false;
  if (granted && bonusAttack) {
    return { error: `${granted.attack.name} is not a bonus-action weapon attack of that kind.` };
  }
  if (granted) {
    if (derived.spellAttack === null) {
      return { error: `${sheet.name} has no spell attack bonus for ${granted.attack.name}.` };
    }
    const dice = grantedAttackDice(granted.attack, sheet.level);
    const abilityMod =
      granted.attack.abilityToDamage && sheet.spellcasting
        ? derived.abilityMods[sheet.spellcasting.ability]
        : 0;
    profile = {
      weapon: granted.attack.name,
      toHit: derived.spellAttack,
      damageExpression:
        abilityMod > 0 ? `${dice}+${abilityMod}` : abilityMod < 0 ? `${dice}${abilityMod}` : dice,
      damageType: granted.attack.type,
      ranged: granted.attack.ranged,
      thrown: false,
      reachTiles: 1,
      rangeTiles: 12,
      proficient: true,
      improvised: false,
      ability: "dex",
      magicBonus: 0,
      twoHanded: false,
      sneakEligible: false,
      heavy: false,
      riderNotes: [
        `${granted.condition}: ${dice}${granted.attack.type ? ` ${granted.attack.type}` : ""}${
          granted.attack.bonusAction ? ", a bonus action" : ""
        }`,
      ],
    };
    grantedBonusAction = granted.attack.bonusAction;
  } else if (args.spell?.trim()) {
    const spellName = args.spell.trim();
    if (!sheet.spellcasting) {
      return { error: `${sheet.name} cannot cast spells.` };
    }
    // The content pack knows how a known spell resolves; a save or buff
    // spell aimed through pc_attack is redirected to the right tool.
    const resolvedMech = spellMechanicsFor({ spell: spellName, userId: sheet.userId });
    const redirect = castRedirect(resolvedMech, "attack");
    if (redirect) {
      return { error: redirect };
    }
    const mechDamageType = resolvedMech?.mech.damageType;
    const spellList = allSpellNames(sheet.spellcasting);
    const onList = spellList.some(
      (entry) => entry.toLowerCase().includes(spellName.toLowerCase()) ||
        spellName.toLowerCase().includes(entry.toLowerCase()),
    );
    if (!onList) {
      return {
        error: `${spellName} is not on ${sheet.name}'s spell list; they cannot cast it.`,
      };
    }
    // The content pack knows what this spell rolls at this level, including
    // cantrip scaling the model routinely forgets. Its answer wins; the
    // model's dice are the fallback for spells that do not parse.
    const scaled = spellDamageFor({
      spell: spellName,
      userId: sheet.userId,
      casterLevel: sheet.level,
      slotLevel: args.level,
    });
    const damageArg = scaled?.dice ?? (args.damage ?? "").trim();
    if (!damageArg || !isValidExpression(damageArg)) {
      return {
        error: `Spell attacks need the spell's damage dice, e.g. damage="1d10". Send pc_attack again with a damage expression.`,
      };
    }
    if (scaled) {
      scalingNote = scaled.note;
    }
    // Multiclass: the to-hit follows the class whose list carries the spell.
    const spellProfile = spellAttackProfile(
      { spellAttack: spellAttackFor(sheet, spellName) ?? derived.spellAttack },
      spellName,
      damageArg,
      (args.damageType ?? mechDamageType ?? "").trim().toLowerCase(),
    );
    if (!spellProfile) {
      return { error: `${sheet.name} has no spell attack bonus.` };
    }
    profile = spellProfile;
    // Option riders on named attack spells (Agonizing Blast: +CHA per
    // Eldritch Blast beam).
    for (const rider of riders.cantripAbilityRiders) {
      if (spellName.toLowerCase().includes(rider.spell)) {
        const mod =
          derived.abilityMods[rider.ability as keyof typeof derived.abilityMods] ?? 0;
        if (mod > 0) {
          profile = {
            ...profile,
            damageExpression: `${profile.damageExpression}+${mod}`,
            riderNotes: [...profile.riderNotes, `${rider.feature}: +${mod} damage`],
          };
        }
      }
    }
  } else if (sheet.wildShape?.attacks?.length) {
    // Transformed: the form's natural attacks replace the sheet's weapons,
    // with the statblock's own to-hit and damage. A named attack matches
    // loosely ("bite the goblin" -> Bite); no name takes the first attack.
    const wantedAttack = (args.weapon ?? "").trim().toLowerCase();
    const natural =
      sheet.wildShape.attacks.find(
        (attack) =>
          wantedAttack &&
          (attack.name.toLowerCase().includes(wantedAttack) ||
            wantedAttack.includes(attack.name.toLowerCase())),
      ) ?? sheet.wildShape.attacks[0];
    profile = {
      weapon: `${sheet.wildShape.form} ${natural.name}`,
      toHit: natural.toHit,
      damageExpression: natural.damage,
      damageType: natural.type,
      ranged: false,
      thrown: false,
      reachTiles: 1,
      rangeTiles: 1,
      proficient: true,
      improvised: false,
      ability: "str",
      magicBonus: 0,
      twoHanded: false,
      sneakEligible: false,
      heavy: false,
      riderNotes: [`natural attack while transformed (${sheet.wildShape.form})`],
      // Primal Strike: a beast form's attacks count as magical.
      ...(riders.magicalAttacks ? { magical: true } : {}),
    };
  } else {
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, args.weapon, {
      requireCarried: true,
    });
    if (resolved.error) {
      return { error: resolved.error };
    }
    const escapedWeapon = resolved.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shillelagh = sheet.conditions.some((condition) =>
      new RegExp(`^shillelagh \\(${escapedWeapon}\\)$`, "i").test(condition),
    );
    weaponUse = attackWeaponUse(resolved);
    carriedCopies = sheet.equipment
      .filter((item) => (item.qty ?? 1) > 0 && item.name.toLowerCase() === resolved.displayName.toLowerCase())
      .reduce((sum, item) => sum + Math.max(1, item.qty ?? 1), 0);
    profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, {
      riders,
      twoHanded: args.twoHanded,
      offHand: bonusAttack === "off_hand",
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
    if (bonusAttack === "pole_strike") {
      profile = poleStrikeProfile(profile);
    }
  }
  if (sheet.wildShape?.attacks?.length && !args.spell && !granted) {
    // A beast form's bite is a melee attack too (Great Weapon Master counts it).
    weaponUse = { name: profile.weapon, melee: true, light: false, twoHanded: false, pole: false };
  }

  // Ammunition, when the table asked for it. This sits before every roll on
  // purpose: an empty quiver is a refused attack, not a missed one, and the
  // engine boundary says a tool that errors means the attempt never happened.
  // The spend is tallied on the encounter so end_encounter can hand half of
  // it back (src/lib/srd/ammunition.ts).
  if (campaign.gameSettings.variantRules.ammunition && profile.weapon) {
    const spend = spendAmmo(sheet.equipment, profile.weapon, sheet.name);
    if (spend && !spend.ok) {
      return { error: spend.error };
    }
    if (spend && spend.ok) {
      patchSheet(sheet.id, {
        equipment: withAmmoCount(sheet.equipment, spend.index, spend.remaining),
      });
      const key = `${sheet.id}|${spend.name}`;
      encounter.ammoSpent = {
        ...encounter.ammoSpent,
        [key]: (encounter.ammoSpent[key] ?? 0) + 1,
      };
      saveEncounter(encounter);
    }
  }

  // Rage adds its bonus to melee Strength weapon attacks for as long as the
  // condition lasts; the server folds it into the damage dice so both the
  // digital and physical-dice paths carry it.
  const rageBonus = ragingMeleeBonus(sheet, profile);
  if (rageBonus) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rageBonus}`,
    };
  }

  // Effect conditions riding the attacker's hits (Divine Favor's +1d4
  // radiant, Hunter's Mark, Hex, enlarged/reduced) fold into the damage
  // expression so both dice paths carry them.
  const onHit = conditionOnHitDice(sheet.conditions, { weapon: !args.spell && !granted, melee: !profile.ranged });
  if (onHit.suffix) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}${onHit.suffix}`,
    };
  }

  // Feature damage riders (Divine Strike, Improved Divine Smite, Divine
  // Fury) ride weapon attacks only; once-per-turn ones are reconciled with
  // the turn budget below, mirroring Sneak Attack.
  const featureRiders =
    args.spell || granted
      ? []
      : riders.damageRiders.filter((rider) => {
          if (rider.when === "melee" && profile.ranged) {
            return false;
          }
          if (rider.when === "ranged" && !profile.ranged) {
            return false;
          }
          if (
            rider.requiresCondition &&
            !sheet.conditions.some(
              (entry) => entry.toLowerCase() === rider.requiresCondition,
            )
          ) {
            return false;
          }
          return true;
        });
  for (const rider of featureRiders) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${rider.dice}`,
    };
  }

  // Great Weapon Master (heavy melee) / Sharpshooter (ranged weapon): -5 to
  // hit for +10 damage, only when the player declared it.
  const weaponAttack = !args.spell && !granted;
  const sharpshooter = weaponAttack && profile.ranged && hasFeat(sheet, "sharpshooter");
  if (args.powerAttack) {
    const greatWeapon = weaponAttack && !profile.ranged && profile.heavy && hasFeat(sheet, "great weapon master");
    if (!(greatWeapon || sharpshooter) || !profile.proficient) {
      return {
        error: `The -5/+10 option needs Great Weapon Master with a heavy melee weapon, or Sharpshooter with a ranged weapon, that ${sheet.name} is proficient with.`,
      };
    }
    profile = {
      ...profile,
      toHit: profile.toHit - 5,
      damageExpression: `${profile.damageExpression}+10`,
      riderNotes: [...profile.riderNotes, `${greatWeapon ? "Great Weapon Master" : "Sharpshooter"}: -5 to hit, +10 damage`],
    };
  }

  // Battle-map positions are authoritative; players move their own tokens,
  // so an out-of-reach attack is refused rather than auto-approached.
  const rangeError = checkPcAttackRange(campaign, encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    reachTiles: profile.reachTiles,
    thrown: profile.thrown,
  });
  if (rangeError) {
    return { error: rangeError };
  }
  // Terrain cover raises the AC to beat; a shot past normal range is taken
  // at disadvantage.
  const spatials = pcAttackSpatials(campaign, encounter.id, sheet.id, enemy.id, {
    ranged: profile.ranged,
    rangeTiles: profile.rangeTiles,
    thrown: profile.thrown,
  });
  // Sharpshooter: long range costs no disadvantage, and half and
  // three-quarters cover are ignored.
  if (sharpshooter && (spatials.cover || spatials.longRange)) {
    profile = {
      ...profile,
      riderNotes: [...profile.riderNotes, "Sharpshooter: ignores the cover and the long-range penalty"],
    };
    spatials.cover = 0;
    spatials.longRange = false;
  }
  const effectiveAc = enemy.ac + spatials.cover;

  // Conditions on both sides drive advantage and auto-crits; the model's
  // situational claim merges in as one more source.
  const conditionContext = attackContext({
    attackerConditions: sheet.conditions,
    targetConditions: enemy.conditions,
    melee: !profile.ranged,
    adjacent: !profile.ranged,
    requested: args.advantage ?? "none",
  });
  const exhaustion = exhaustionRollState(sheet.exhaustion ?? 0, "attack");
  if (exhaustion.note) {
    conditionContext.notes.push(exhaustion.note);
  }
  if (rageBonus) {
    conditionContext.notes.push(`raging: +${rageBonus} melee damage`);
  }
  for (const note of profile.riderNotes) {
    conditionContext.notes.push(note);
  }
  if (scalingNote) {
    conditionContext.notes.push(scalingNote);
  }
  if (spatials.cover) {
    conditionContext.notes.push(
      `${enemy.displayName} has ${spatials.cover === 2 ? "half" : "three-quarters"} cover: +${spatials.cover} AC`,
    );
  }
  if (spatials.longRange) {
    conditionContext.notes.push("beyond normal range: disadvantage");
  }
  // A Battle Master maneuver riding this swing: the pick is validated, the
  // Superiority Die spends up front, and the die lands on the damage (or the
  // attack roll for Precision). Rider saves resolve after a hit below.
  let maneuverInfo: {
    name: string;
    die: string;
    precision: boolean;
    rider: { condition: string; save: "str" | "wis" } | null;
  } | null = null;
  if (args.maneuver?.trim()) {
    if (args.spell || granted) {
      return { error: "Maneuvers ride weapon attacks, not spells." };
    }
    const term = args.maneuver.trim().toLowerCase();
    const picks = sheet.features
      .map((feature) => feature.name)
      .filter((name) => name.toLowerCase().startsWith("maneuver"));
    const known = picks.some((name) => {
      const bare = name.toLowerCase().replace(/^maneuver:\s*/, "");
      return bare.includes(term) || term.includes(bare);
    });
    if (!known) {
      return {
        error: `${sheet.name} knows no maneuver "${args.maneuver}".${
          picks.length ? ` Their maneuvers: ${picks.join(", ")}.` : " They have no maneuver picks."
        }`,
      };
    }
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_resource",
      JSON.stringify({
        characterId: sheet.id,
        resource: "Superiority Dice",
        reason: args.maneuver.trim(),
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
    // Multiclass: the superiority die grows with FIGHTER levels.
    const die = superiorityDie(classLevelFor(sheet, "fighter") || sheet.level);
    const precision = /precision/i.test(term);
    maneuverInfo = {
      name: args.maneuver.trim(),
      die,
      precision,
      rider: MANEUVER_RIDERS.find((entry) => entry.match.test(term)) ?? null,
    };
    if (!precision) {
      profile = {
        ...profile,
        damageExpression: `${profile.damageExpression}+1${die}`,
      };
    }
    conditionContext.notes.push(
      `${maneuverInfo.name}: Superiority Die spent, +1${die} ${
        precision ? "to the attack roll" : "damage"
      }${maneuverInfo.rider ? `, ${maneuverInfo.rider.save.toUpperCase()} save rider on a hit` : ""}`,
    );
  }

  // Effect conditions on the attacker's own roll: Bless's +1d4, Bane's
  // -1d4, True Strike's one-shot advantage.
  const attackRiders = conditionRollRiders(sheet.conditions, "attack");
  // An ally's Help: advantage on this attack, spent by it.
  const helped = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "helped") ?? null;
  if (helped) {
    attackRiders.notes.push("spends the Help their ally gave them: advantage");
  }
  conditionContext.notes.push(...attackRiders.notes, ...onHit.notes);
  for (const rider of featureRiders) {
    conditionContext.notes.push(
      `${rider.feature}: +${rider.dice}${rider.type ? ` ${rider.type}` : ""} damage`,
    );
  }
  if (profile.magical && !args.spell) {
    conditionContext.notes.push("a magical attack: overcomes resistance to nonmagical attacks");
  }
  // SRD heavy property: Small creatures swing oversized weapons at
  // disadvantage.
  const smallWithHeavy = profile.heavy && sizeForRace(sheet.race) === "Small";
  if (smallWithHeavy) {
    conditionContext.notes.push(
      `${profile.weapon} is a heavy weapon and ${sheet.name} is Small: disadvantage`,
    );
  }
  // Variant: Encumbrance. A heavily loaded character swings at disadvantage
  // like any other physical roll; the pack was already weighed for the
  // ammunition check above.
  const load = campaign.gameSettings.variantRules.encumbrance
    ? encumbranceFor({
          strength: sheet.abilities.str,
          equipment: sheet.equipment ?? [],
          coins: sheet.gold ?? 0,
          size: sizeForRace(sheet.race),
          powerfulBuild: powerfulBuildForRace(sheet.race),
        })
    : null;
  if (load?.disadvantage && load.note) {
    conditionContext.notes.push(load.note);
  }
  const advantage: Advantage = mergeAdvantage([
    conditionContext.advantage,
    exhaustion.advantage,
    ...(load?.disadvantage ? ["disadvantage" as const] : []),
    ...attackRiders.advantageSources,
    ...(helped ? ["advantage" as const] : []),
    ...(spatials.longRange ? ["disadvantage" as const] : []),
    ...(smallWithHeavy ? ["disadvantage" as const] : []),
  ]);

  // Optional rider: possession / browsing alone is not player consent.
  // The engine still checks final advantage, weapon and once-per-turn budget.
  const sneak =
    args.sneakAttack === true &&
    riders.sneakAttackDice > 0 &&
    profile.sneakEligible &&
    advantage !== "disadvantage" &&
    (advantage === "advantage" || enemy.enemy && allyAdjacentToEnemy(campaign, encounter.id, sheet.id, enemy.id));
  if (sneak) {
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${riders.sneakAttackDice}d6`,
    };
    conditionContext.notes.push(`Sneak Attack: +${riders.sneakAttackDice}d6`);
  }

  // Divine Smite: the slot is spent up front so a refused spend refuses the
  // smite rather than handing out free radiant damage. 2d8 at 1st level,
  // +1d8 per slot level above, +1d8 against undead and fiends.
  let smiteNote: string | null = null;
  if (args.smite) {
    if (!riders.canSmite) {
      return { error: `${sheet.name} has no Divine Smite.` };
    }
    if (profile.ranged) {
      return { error: "Divine Smite rides on a melee weapon attack, not a ranged one." };
    }
    const spend = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({ characterId: sheet.id, level: args.smite, reason: "Divine Smite" }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spend) {
      return spend;
    }
    // The stat block carries no creature type, so the name and content slug
    // are what there is to go on; a miss just costs the extra die.
    const undeadOrFiend = /undead|fiend|demon|devil|zombie|skeleton|ghoul|wraith|lich|vampire|specter|shadow|imp/i.test(
      `${enemy.displayName} ${enemy.enemy?.slug ?? ""}`,
    );
    const dice = Math.min(6, 1 + args.smite) + (undeadOrFiend ? 1 : 0);
    profile = {
      ...profile,
      damageExpression: `${profile.damageExpression}+${dice}d8`,
    };
    smiteNote = `Divine Smite (level ${args.smite} slot): +${dice}d8 radiant${
      undeadOrFiend ? " against an undead or fiend" : ""
    }`;
    conditionContext.notes.push(smiteNote);
  }

  // The action economy: the first swing spends the Attack action, the rest
  // come out of Extra Attack, and the off-hand swing is a bonus action. Only
  // binds the character whose turn it actually is.
  if (args.spell && !granted) {
    const resolved = spellMechanicsFor({ spell: args.spell, userId: sheet.userId });
    const spent = applyDmMutation(campaign, turn.id, "use_spell_slot", JSON.stringify({
      characterId: sheet.id, spell: args.spell, level: args.level ?? resolved?.spellLevel ?? 0,
    }), sheets, sheetsById).result;
    if ("error" in spent) return spent;
    encounter.turnBudget = getActiveEncounter(campaign.id)?.turnBudget ?? null;
  }
  let budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionExtraActions(sheet.conditions),
  );
  let luckySpent = false;
  if (budget) {
    const spend = args.spell && !granted
      ? { ok: true as const, budget }
      : args.flurry
      ? { ok: true as const, budget: { ...budget, flurryAttacksRemaining: budget.flurryAttacksRemaining! - 1 } }
      : grantedBonusAction
      ? spendAction(budget, "bonus", `the ${profile.weapon} attack`, sheet.name)
      : bonusAttack
        ? spendAction(budget, "bonus", BONUS_ATTACK_LABEL[bonusAttack], sheet.name)
        : spendAttack(budget, sheet.name);
    if (bonusAttack && weaponUse) {
      const complaint = bonusAttackError(bonusAttack, weaponUse, budget.attackWeapons ?? [], {
        dualWielder: hasFeat(sheet, "dual wielder"),
        carried: carriedCopies,
        who: sheet.name,
      });
      if (complaint) {
        return { error: complaint };
      }
    }
    if (!spend.ok) {
      return { error: spend.error };
    }
    budget = spend.budget;
    // The Attack action's swings are remembered for the bonus attacks that
    // may follow them this turn.
    if (!bonusAttack && !args.flurry && !grantedBonusAction && weaponUse) {
      budget = { ...budget, attackWeapons: [...(budget.attackWeapons ?? []), weaponUse] };
    }
    // Lucky: the point is spent now that the swing is certain to happen; the
    // held "lucky" condition it grants is used up by this very roll.
    if (args.lucky && !heldLuck) {
      const luck = applyDmMutation(campaign, turn.id, "use_resource", JSON.stringify({
        characterId: sheet.id, resource: "luck_points", reason: `Lucky: an extra d20 on the ${profile.weapon} attack`,
      }), sheets, sheetsById).result;
      if ("error" in luck) {
        return luck;
      }
      luckySpent = true;
      conditionContext.notes.push("Lucky: a luck point is spent, an extra d20 rolls and the highest counts");
    }
    if (spend.note) {
      conditionContext.notes.push(spend.note);
    }
    if (sneak) {
      // Sneak Attack is once per turn however many swings land.
      const claimed = claimOncePerTurn(budget, "sneak_attack");
      if (!claimed) {
        profile = {
          ...profile,
          damageExpression: profile.damageExpression.replace(
            `+${riders.sneakAttackDice}d6`,
            "",
          ),
        };
        conditionContext.notes = conditionContext.notes.filter(
          (note) => !note.startsWith("Sneak Attack"),
        );
        conditionContext.notes.push("Sneak Attack already used this turn: no extra dice");
      } else {
        budget = claimed;
      }
    }
    // Once-per-turn feature riders (Divine Strike) spend their turn slot the
    // same way.
    for (const rider of featureRiders) {
      if (!rider.oncePerTurn) {
        continue;
      }
      const claimed = claimOncePerTurn(budget, `rider:${rider.feature.toLowerCase()}`);
      if (!claimed) {
        profile = {
          ...profile,
          damageExpression: profile.damageExpression.replace(`+${rider.dice}`, ""),
        };
        conditionContext.notes = conditionContext.notes.filter(
          (note) => !note.startsWith(`${rider.feature}:`),
        );
        conditionContext.notes.push(`${rider.feature} already used this turn: no extra dice`);
      } else {
        budget = claimed;
      }
    }
    storeBudget(encounter, budget);
  }

  // Striking from hiding spends the hiding (the attack gives them away
  // whether it lands or not), and one-shot riders like True Strike are
  // spent by this roll: clear them all together.
  const spentConditions = [
    ...(sheet.conditions.some((entry) => entry.toLowerCase() === "hidden") ? ["hidden"] : []),
    ...attackRiders.spent,
    ...(helped ? [helped] : []),
    ...(luckySpent ? ["lucky"] : []),
  ];
  if (spentConditions.length) {
    // Re-read: a luck point spent just now added its condition after this
    // handler loaded the sheet.
    const current = luckySpent ? (getSheetById(sheet.id) ?? sheet) : sheet;
    const cleared = removeConditions(current.conditions, current.conditionMeta, spentConditions);
    const revealed = patchSheet(sheet.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    });
    if (revealed) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: revealed });
    }
  }

  revealAfterAction(campaign.id, sheet.id, true);

  const toHitRiderSuffix = `${attackRiders.diceSuffix}${
    maneuverInfo?.precision ? `+1${maneuverInfo.die}` : ""
  }`;

  // Elven Accuracy: advantage on a DEX/INT/WIS/CHA attack rolls a third d20
  // and keeps the highest. Spell attacks report their ability as "dex", so
  // excluding only Strength matches the feat's DEX/INT/WIS/CHA scope.
  const elvenAccuracy =
    advantage === "advantage" && profile.ability !== "str" && hasElvenAccuracy(sheet);
  if (elvenAccuracy) {
    conditionContext.notes.push("Elven Accuracy: rolls a third d20 and keeps the highest");
  }
  // Halfling Lucky rerolls a natural 1 on the attack roll once, so it rides
  // the leading d20 term as the grammar's "r1" suffix, before any rider dice.
  const lucky = hasHalflingLuck(sheet);
  if (lucky) {
    conditionContext.notes.push("Lucky: a natural 1 on the attack roll is rerolled once");
  }
  const baseD20 = d20Expression(profile.toHit, advantage)
    .replace(/^2d20kh1/, elvenAccuracy ? "3d20kh1" : "2d20kh1");
  const toHitD20 = (attackRiders.extraD20 || luckySpent ? withExtraD20(baseD20) : baseD20)
    .replace(/^(\d+d20(?:k[hl]\d+)?)/, lucky ? "$1r1" : "$1");
  const toHitExpression = `${toHitD20}${toHitRiderSuffix}`;
  const detail = `${sheet.name}: ${profile.weapon} vs ${enemy.displayName}`;

  // Great Weapon Fighting rerolls 1s and 2s, but only on the two-handed
  // melee swing it is written for.
  const rerollBelow =
    riders.greatWeaponRerollBelow && profile.twoHanded && !profile.ranged
      ? riders.greatWeaponRerollBelow
      : 0;
  if (rerollBelow) {
    conditionContext.notes.push(`Great Weapon Fighting: rerolling damage dice of ${rerollBelow} or less`);
  }
  const critExpression = critDamageExpression(profile.damageExpression, riders.critExtraDice, {
    powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
    multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
  });

  // Great Weapon Master: a melee critical hit or kill opens the bonus-action
  // swing; whichever path learns the outcome marks it on the turn budget.
  const gwmEligible = Boolean(weaponUse?.melee) && weaponAttack && !profile.ranged && hasFeat(sheet, "great weapon master");

  // Physical dice: park the to-hit roll for the player; the submit route
  // adjudicates it and, on a hit, parks the damage roll too.
  if (realDiceUserIds.has(sheet.userId)) {
    const pending = createPendingRoll({
      campaignId: campaign.id,
      turnId: turn.id,
      toolCallId,
      userId: sheet.userId,
      characterId: sheet.id,
      kind: "attack",
      detail,
      expression: toHitExpression,
      advantage,
      dc: null,
      reason: `${profile.weapon} attack against ${enemy.displayName}`,
      attack: {
        attacker: sheet.name,
        weapon: profile.weapon,
        ...(enemy.sheet ? { targetCharacterId: enemy.id } : { targetEnemyId: enemy.id }),
        targetAc: effectiveAc,
        damageExpression: profile.damageExpression,
        critDamageExpression: critExpression,
        damageType: profile.damageType,
        ...(profile.magical ? { magical: true } : {}),
        ...(conditionContext.autoCrit ? { autoCrit: true } : {}),
        ...(riders.critRange < 20 ? { critRange: riders.critRange } : {}),
        ...(rerollBelow ? { rerollBelow } : {}),
        ...(onHit.spentOnHit.length ? { spentOnHit: onHit.spentOnHit } : {}),
        ...(gwmEligible ? { gwm: true } : {}),
      },
    });
    publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
    return { [PC_ATTACK_PARKED]: true };
  }

  // Digital path: roll, adjudicate, and apply in one pass.
  const hitOutcome = rollExpression(toHitExpression);
  const hitRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "attack",
    detail,
    advantage,
    result: hitOutcome,
  });
  publishRoll(campaign.id, hitRoll);
  turn.rollIds.push(hitRoll.id);

  const adjudicated = adjudicateHit(hitOutcome.total, hitOutcome.crit, effectiveAc, {
    natural: hitOutcome.natural,
    critRange: riders.critRange,
  });
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && conditionContext.autoCrit);
  const base = {
    attacker: sheet.name,
    weapon: profile.weapon,
    ...(bonusAttack ? { bonusAttack, bonusActionSpent: true } : {}),
    rolled: hitOutcome.total,
    vsAc: effectiveAc,
    target: enemy.displayName,
    ...(profile.improvised ? { improvised: true } : {}),
    ...(conditionContext.notes.length ? { conditionEffects: conditionContext.notes } : {}),
    // Extra Attack: the model has no way to know a level-5 fighter swings
    // twice unless the engine says so on every swing.
    ...(budget && attacksLeft(budget) > 0
      ? {
          attacksRemaining: attacksLeft(budget),
          extraAttack: `${sheet.name} has ${attacksLeft(budget)} more attack${
            attacksLeft(budget) === 1 ? "" : "s"
          } this turn; call pc_attack again for each before ending their turn.`,
        }
      : riders.extraAttacks && !budget
        ? {
            extraAttack: `${sheet.name} attacks ${riders.extraAttacks + 1} times per Attack action.`,
          }
        : {}),
  };
  if (!hit) {
    return {
      ...base,
      hit: false,
      ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      note: "The attack misses; narrate the miss.",
    };
  }

  consumeHitConditions(campaign.id, sheet.id, onHit.spentOnHit);

  const damageExpression = crit ? critExpression : profile.damageExpression;
  const damageOutcome = rollExpression(damageExpression, undefined, { rerollBelow });
  const damageRoll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "damage",
    detail: `${sheet.name}: ${profile.weapon} damage`,
    result: damageOutcome,
  });
  publishRoll(campaign.id, damageRoll);
  turn.rollIds.push(damageRoll.id);

  const applied = enemy.sheet
    ? applyDmMutation(campaign, turn.id, "apply_damage", JSON.stringify({
      characterId: enemy.id, amount: Math.max(1, damageOutcome.total), type: profile.damageType, crit,
      reason: `${sheet.name}: ${profile.weapon}`,
    }), sheets, sheetsById).result
    : applyEnemyDamage(campaign, turn, encounter, enemy.enemy!, Math.max(1, damageOutcome.total),
      sheets, sheetsById, profile.damageType, profile.magical);
  if (!("error" in applied)) {
    markRollApplied(damageRoll.id, enemy.id);
  }
  if (gwmEligible && (crit || applied.dead || applied.dropped)) {
    markGwmTrigger(campaign.id, sheet.id);
  }

  // A maneuver's rider save (Trip -> prone, Menacing -> frightened) resolves
  // against the enemy's real stat block once the hit lands.
  const maneuverOutcome: Record<string, unknown> = {};
  if (maneuverInfo?.rider && !applied.dead && !applied.encounterOver) {
    const fresh = resolveCombatTarget(campaign, encounter, args);
    if (!("error" in fresh) && !applied.dropped) {
      const dc =
        8 +
        derived.proficiencyBonus +
        Math.max(derived.abilityMods.str, derived.abilityMods.dex);
      if (fresh.sheet) {
        const saved = handleCastAtPlayer(campaign, turn, JSON.stringify({
          characterId: fresh.id, source: maneuverInfo.name, saveAbility: maneuverInfo.rider.save, dc,
          condition: maneuverInfo.rider.condition, ...(maneuverInfo.rider.condition === "prone" ? {} : { rounds: 1 }),
        }), sheets, sheetsById);
        maneuverOutcome.maneuver = saved;
      } else {
        const saveOutcome = rollExpression(
          d20Expression(saveModFor(fresh.enemy!.stats, maneuverInfo.rider.save)),
        );
        const saveRoll = insertRoll({
          campaignId: campaign.id,
          characterId: null,
          requestedBy: "dm",
          kind: "saving_throw",
          detail: `${fresh.displayName}: ${maneuverInfo.rider.save.toUpperCase()} save vs ${maneuverInfo.name}`,
          dc,
          result: saveOutcome,
        });
        turn.rollIds.push(saveRoll.id);
        publishRoll(campaign.id, saveRoll);
        if (saveOutcome.total < dc) {
          const condition = maneuverInfo.rider.condition;
          if (!fresh.conditions.includes(condition)) {
            patchEnemyConditions(fresh.id, [...fresh.conditions, condition], {
              ...fresh.conditionMeta, ...(condition === "prone" ? {} : { [condition]: { rounds: 1 } }),
            });
            publishEncounter(campaign.id);
          }
          maneuverOutcome.maneuver = `${maneuverInfo.name}: ${fresh.displayName} fails the ${maneuverInfo.rider.save.toUpperCase()} save (${saveOutcome.total} vs DC ${dc}) and is ${condition}.`;
        } else {
          maneuverOutcome.maneuver = `${maneuverInfo.name}: ${fresh.displayName} holds (${saveOutcome.total} vs DC ${dc}); no ${maneuverInfo.rider.condition}.`;
        }
      }
    }
  }
  return {
    ...maneuverOutcome,
    ...base,
    hit: true,
    ...(crit ? { crit: true } : {}),
    damage: damageOutcome.total,
    ...(profile.damageType ? { damageType: profile.damageType } : {}),
    ...applied,
    note: applied.dead
      ? `${enemy.displayName} is slain; the server already applied this damage. Narrate the killing blow.`
      : `The server already applied this damage to ${enemy.displayName}. Do NOT apply this damage again; narrate from this state.`,
  };
}

// Physical-dice adjudication, called from the pending-rolls submit route
// when a parked pc_attack to-hit roll lands. Returns the combat note the
// resumed turn surfaces to the model; on a hit it parks the damage roll so
// the turn stays paused until the player rolls their damage dice (which the
// existing applyPendingDamageRoll path then applies).
export function resolvePendingPcAttack(pending: PendingRoll, roll: StoredRoll): string | null {
  const context = pending.attack;
  if (!context) {
    return null;
  }
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  if (!campaign || !turn) {
    return null;
  }
  const adjudicated = adjudicateHit(roll.total, roll.breakdown.crit, context.targetAc, {
    natural: roll.breakdown.natural,
    critRange: context.critRange,
  });
  const hit = adjudicated.hit;
  const crit = adjudicated.crit || (hit && context.autoCrit === true);
  if (!hit) {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: MISS${
      roll.breakdown.crit === "nat1" ? " (natural 1)" : ""
    }. No damage roll happens; narrate the miss.`;
  }
  // Verify the target still stands before asking for damage dice (the lead
  // may have force-ended the encounter while the roll sat parked).
  const encounter = getActiveEncounter(pending.campaignId);
  const enemy = encounter ? resolveCombatTarget(campaign, encounter, context) : null;
  if (!enemy || "error" in enemy) {
    return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT, but the target is already gone; narrate around it.`;
  }
  if (pending.characterId) consumeHitConditions(pending.campaignId, pending.characterId, context.spentOnHit ?? []);
  if (crit && context.gwm && pending.characterId) markGwmTrigger(pending.campaignId, pending.characterId);
  const expression = crit ? context.critDamageExpression : context.damageExpression;
  const sheets = listSheets(pending.campaignId);
  const sheet = sheets.find((entry) => entry.id === pending.characterId);
  const damagePending = createPendingRoll({
    campaignId: pending.campaignId,
    turnId: pending.turnId,
    // No paired tool call: the resumed turn pushes this result without an
    // id, which the conversation loop tolerates; the combat notes on both
    // stages carry the full story.
    toolCallId: null,
    userId: pending.userId,
    characterId: pending.characterId,
    kind: "damage",
    detail: `${sheet?.name ?? context.attacker}: ${context.weapon} damage`,
    expression,
    advantage: "none",
    dc: null,
    reason: `${context.weapon} damage against ${enemy.displayName}`,
    targetEnemyId: enemy.enemy?.id ?? null,
    // Carried so the damage stage keeps the type for resistance math.
    attack: { ...context, crit },
  });
  publishPersisted(pending.campaignId, "roll_pending", {
    pendingRoll: publicPendingRoll(damagePending),
  });
  return `${context.attacker}'s ${context.weapon} attack rolled ${roll.total} vs AC ${context.targetAc}: HIT${
    crit ? " (CRITICAL: damage dice are doubled)" : ""
  }. ${context.attacker} now rolls damage (${expression})${
    context.rerollBelow
      ? `, rerolling any die of ${context.rerollBelow} or less once for Great Weapon Fighting`
      : ""
  }; the server will apply it to ${enemy.displayName} automatically.`;
}

function consumeHitConditions(campaignId: string, characterId: string, conditions: string[]) {
  if (!conditions.length) return;
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.campaignId !== campaignId) return;
  const next = removeConditions(sheet.conditions, sheet.conditionMeta, conditions);
  const updated = patchSheet(sheet.id, { conditions: next.conditions, conditionMeta: next.meta });
  if (updated) publishPersisted(campaignId, "sheet_updated", { sheet: updated });
}
