import type { AttackWeaponUse } from "./action-budget.ts";
import { isPoleStrikeWeapon } from "../srd/feature-effects.ts";
import type { SrdWeapon } from "../srd/weapons.ts";

// Client-safe rules for the bonus-action weapon attacks, shared by the
// pc_attack engine and the combat turn builder.

// The bonus-action swings that follow the Attack action: two-weapon
// fighting, Polearm Master's butt strike, Crossbow Expert's hand crossbow,
// and Great Weapon Master's swing after a critical hit or a kill.
export const BONUS_ATTACKS = ["off_hand", "pole_strike", "crossbow_expert", "great_weapon_master"] as const;
export type BonusAttackKind = (typeof BONUS_ATTACKS)[number];

// What a weapon is, for the rules above. Unarmed strikes and improvised
// weapons are no light weapons for two-weapon fighting.
export function attackWeaponUse(resolved: { displayName: string; srd: SrdWeapon | null }): AttackWeaponUse {
  const properties = resolved.srd?.properties ?? [];
  return {
    name: resolved.srd?.name ?? resolved.displayName,
    melee: resolved.srd ? resolved.srd.kind === "melee" : true,
    light: properties.includes("light"),
    twoHanded: properties.includes("two-handed"),
    pole: isPoleStrikeWeapon(resolved.srd?.name),
  };
}

// Why this bonus-action attack is not allowed, or null. `attacks` are the
// Attack-action swings already made this turn; `carried` counts the copies
// of this weapon they hold, since two daggers make a valid pair.
export function bonusAttackError(
  kind: BonusAttackKind,
  weapon: AttackWeaponUse,
  attacks: AttackWeaponUse[],
  options: { dualWielder: boolean; carried: number; who: string },
): string | null {
  const { who } = options;
  if (kind === "great_weapon_master") {
    return weapon.melee ? null : "Great Weapon Master's bonus attack is a melee weapon attack.";
  }
  if (!attacks.length) {
    return `${who} must take the Attack action first; this bonus-action attack follows it.`;
  }
  if (kind === "off_hand") {
    const pairable = (entry: AttackWeaponUse) => entry.melee && !entry.twoHanded && (entry.light || options.dualWielder);
    if (!pairable(weapon)) {
      return options.dualWielder
        ? `${weapon.name} is not a one-handed melee weapon, so it cannot be the off-hand weapon.`
        : `${weapon.name} is not a light melee weapon; two-weapon fighting needs light weapons (Dual Wielder lifts that).`;
    }
    const main = attacks.filter(pairable);
    if (!main.length) {
      return `${who} attacked with ${attacks.map((entry) => entry.name).join(", ")}; the off-hand attack must follow an attack with a ${options.dualWielder ? "one-handed" : "light"} melee weapon in the other hand.`;
    }
    if (main.every((entry) => entry.name.toLowerCase() === weapon.name.toLowerCase()) && options.carried < 2) {
      return `${who} needs a second ${weapon.name} in the other hand for an off-hand attack with it.`;
    }
    return null;
  }
  if (kind === "pole_strike") {
    if (!weapon.pole) {
      return `Polearm Master's butt strike takes a glaive, halberd, quarterstaff or spear, not ${weapon.name}.`;
    }
    return attacks.some((entry) => entry.pole)
      ? null
      : `Polearm Master's butt strike follows an Attack-action swing with a glaive, halberd, quarterstaff or spear.`;
  }
  if (weapon.name.toLowerCase() !== "hand crossbow") {
    return "Crossbow Expert's bonus attack is made with a hand crossbow.";
  }
  return attacks.some((entry) => !entry.twoHanded)
    ? null
    : "Crossbow Expert's bonus attack follows an Attack-action attack with a one-handed weapon.";
}

