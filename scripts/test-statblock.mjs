// Open5e stat-block parsing into enemy snapshots, CR-baseline synthesis,
// and crit-expression doubling. Fixtures mirror real Open5e rows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { parseMonster, saveModFor, sizeRank } = await import("../src/lib/bestiary/statblock.ts");
const { synthesizeStats } = await import("../src/lib/bestiary/synthesize.ts");
const { healthState } = await import("../src/lib/bestiary/health.ts");
const { critDamageExpression } = await import("../src/lib/dm/encounter-logic.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Shaped like the real hell-hound row (multi-part damage, save trait).
const hellHound = {
  cr: 3,
  hit_points: 45,
  armor_class: 15,
  dexterity: 12,
  speed: { walk: 50 },
  actions: [
    {
      name: "Bite",
      desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 7 (2d6) fire damage.",
      attack_bonus: 5,
      damage_dice: "1d8",
      damage_bonus: 3,
    },
    {
      name: "Fire Breath (Recharge 5-6)",
      desc: "The hound exhales fire in a 15-foot cone. Each creature in that area must make a DC 12 Dexterity saving throw, taking 21 (6d6) fire damage on a failed save.",
      attack_bonus: 0,
      damage_dice: "6d6",
      damage_bonus: null,
    },
  ],
  special_abilities: [
    { name: "Keen Hearing and Smell", desc: "The hound has advantage on Wisdom (Perception) checks that rely on hearing or smell." },
  ],
  damage_resistances: "",
  damage_immunities: "fire",
  damage_vulnerabilities: "",
  condition_immunities: "",
};

test("hell hound parses to an honest snapshot", () => {
  const stats = parseMonster(hellHound, 3);
  assert.equal(stats.maxHp, 45);
  assert.equal(stats.ac, 15);
  assert.equal(stats.dexMod, 1);
  assert.equal(stats.cr, 3);
  assert.equal(stats.xp, 700);
  assert.equal(stats.immune, "fire");
  assert.equal(stats.speed, "50");
  assert.equal(stats.attacks.length, 1);
  const bite = stats.attacks[0];
  assert.equal(bite.name, "Bite");
  assert.equal(bite.toHit, 5);
  assert.equal(bite.damage, "1d8+3+2d6");
  assert.equal(bite.type, "piercing/fire");
});

test("non-attack actions and specials become traits", () => {
  const stats = parseMonster(hellHound, 3);
  assert.ok(stats.traits.some((line) => line.startsWith("Fire Breath")));
  assert.ok(stats.traits.some((line) => line.startsWith("Keen Hearing")));
});

test("multiattack lines with null bonus become traits, dice attacks parse", () => {
  const dragon = {
    cr: 17,
    hit_points: 256,
    armor_class: 19,
    dexterity: 10,
    actions: [
      { name: "Multiattack", desc: "The dragon makes three attacks.", attack_bonus: null, damage_dice: null, damage_bonus: null },
      { name: "Bite", desc: "Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.", attack_bonus: 14, damage_dice: "2d10+2d6", damage_bonus: 8 },
    ],
  };
  const stats = parseMonster(dragon, 17);
  assert.equal(stats.attacks.length, 1);
  // The field already carries the fire rider the text prints; read once, it counts once.
  assert.equal(stats.attacks[0].damage, "2d10+8+2d6");
  assert.equal(stats.attacks[0].toHit, 14, "a block without the attack header keeps its field to-hit");
  assert.ok(stats.traits.some((line) => line.startsWith("Multiattack")));
});

// Real Open5e rows (2026-10 content pack), trimmed to their actions.
const giantSpider = {
  cr: 1,
  hit_points: 26,
  armor_class: 14,
  dexterity: 16,
  actions: [
    { name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one. If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour, even after regaining hit points, and is paralyzed while poisoned in this way.", attack_bonus: 5, damage_dice: "1d8", damage_bonus: 3 },
    { name: "Web (Recharge 5-6)", desc: "Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success. The webbing can also be attacked and destroyed (AC 10; hp 5; vulnerability to fire damage; immunity to bludgeoning, poison, and psychic damage).", attack_bonus: 5 },
  ],
};

test("a giant spider keeps its web and its poison", () => {
  const [bite, web] = parseMonster(giantSpider, 1).attacks;
  assert.deepEqual(bite, {
    name: "Bite", toHit: 5, damage: "1d8+3", type: "piercing", reach: 5,
    onHit: { save: { ability: "con", dc: 11, damage: "2d8", damageType: "poison", half: true } },
  });
  assert.deepEqual(web, {
    name: "Web (Recharge 5-6)", toHit: 5, damage: "", type: "untyped", range: 30, longRange: 60, recharge: 5,
    onHit: { condition: "restrained", escapeDc: 12 },
  });
});

test("attacks read from the text when the fields are missing", () => {
  const stats = parseMonster({
    actions: [
      // Ghoul: no attack_bonus/damage_dice fields at all.
      { name: "Claws", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) slashing damage. If the target is a creature other than an elf or undead, it must succeed on a DC 10 Constitution saving throw or be paralyzed for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success." },
      // Black Flag markdown and abbreviated saves.
      { name: "Toxic Nodule", desc: "_Ranged Weapon Attack:_ +5 to hit, range 30/60 ft., one target. _Hit:_ 12 (2d8+3) poison damage, and the target must succeed on a DC 13 CON save or be poisoned until the end of its next turn." },
      // Tome of Beasts: no "reach", no "Hit:".
      { name: "Iron Axe", desc: "Melee Weapon Attack: +8 to hit, 10 ft., one target, 18 (3d8+5) slashing damage." },
      { name: "Spear", desc: "Melee or Ranged Weapon Attack: +2 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 3 (1d6) piercing damage, or 4 (1d8) piercing damage if used with two hands to make a melee attack.", attack_bonus: 2, damage_dice: "1d6" },
    ],
  }, 1);
  const [claws, nodule, axe, spear] = stats.attacks;
  assert.deepEqual(claws.onHit, { save: { ability: "con", dc: 10, condition: "paralyzed" } }, "a repeated save is save-ends");
  assert.equal(claws.damage, "2d4+2");
  assert.deepEqual(nodule.onHit, { save: { ability: "con", dc: 13, condition: "poisoned", rounds: 1 } });
  assert.equal(nodule.range, 30);
  assert.deepEqual([axe.toHit, axe.damage, axe.reach], [8, "3d8+5", 10]);
  assert.deepEqual([spear.reach, spear.range, spear.longRange, spear.damage], [5, 20, 60, "1d6"]);
});

test("a wolf knocks prone on a failed save; a breath weapon is a save action", () => {
  const wolf = parseMonster({ actions: [{ name: "Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage. If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone.", attack_bonus: 4, damage_dice: "2d4", damage_bonus: 2 }] }, 0.25);
  assert.deepEqual(wolf.attacks[0].onHit, { save: { ability: "str", dc: 11, condition: "prone" } });
  const dragon = parseMonster({ actions: [{ name: "Fire Breath (Recharge 5-6)", desc: "The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.", attack_bonus: 0, damage_dice: "16d6" }] }, 10);
  assert.deepEqual(dragon.saves, [{ name: "Fire Breath (Recharge 5-6)", ability: "dex", dc: 17, damage: "16d6", damageType: "fire", half: true, area: "30-foot cone", recharge: 5 }]);
  assert.ok(dragon.traits.some((line) => line.startsWith("Fire Breath")), "the printed text stays for the narrator");
  assert.equal(parseMonster(hellHound, 3).saves[0].dc, 12);
});

test("every parsed damage expression rolls", () => {
  for (const source of [hellHound]) {
    for (const attack of parseMonster(source, 3).attacks) {
      assert.ok(isValidExpression(attack.damage), attack.damage);
    }
  }
});

test("missing fields degrade to sane defaults", () => {
  const stats = parseMonster({}, 1);
  assert.equal(stats.ac, 12);
  assert.equal(stats.maxHp, 10);
  assert.equal(stats.attacks.length, 0);
  assert.equal(stats.xp, 200);
});

test("synthesizeStats scales monotonically and rolls", () => {
  let lastHp = 0;
  for (const cr of [0, 1, 3, 5, 10, 20, 30]) {
    const stats = synthesizeStats(cr);
    assert.ok(stats.maxHp >= lastHp, `hp not monotonic at CR ${cr}`);
    lastHp = stats.maxHp;
    assert.equal(stats.attacks.length, 1);
    assert.ok(isValidExpression(stats.attacks[0].damage));
    assert.ok(stats.ac >= 12 && stats.ac <= 19);
  }
});

test("crit doubles dice, not modifiers", () => {
  assert.equal(critDamageExpression("1d8+3"), "1d8+1d8+3");
  assert.equal(critDamageExpression("2d6"), "2d6+2d6");
  assert.equal(critDamageExpression("1d8+3+2d6"), "1d8+1d8+3+2d6+2d6");
  assert.ok(isValidExpression(critDamageExpression("1d8+3+2d6")));
});

test("save mods parse from scores with explicit saves winning", () => {
  const stats = parseMonster(
    {
      armor_class: 15,
      hit_points: 30,
      strength: 16,
      dexterity: 14,
      constitution: 12,
      wisdom: 8,
      dexterity_save: 6,
      cr: 2,
    },
    2,
  );
  assert.equal(stats.saveMods.str, 3);
  assert.equal(stats.saveMods.dex, 6);
  assert.equal(stats.saveMods.con, 1);
  assert.equal(stats.saveMods.wis, -1);
});

test("saveModFor falls back for legacy snapshots without saveMods", () => {
  const legacy = { ...synthesizeStats(4), saveMods: undefined, dexMod: 2, cr: 4 };
  assert.equal(saveModFor(legacy, "dex"), 2);
  assert.equal(saveModFor(legacy, "con"), 1);
  const modern = synthesizeStats(4);
  assert.equal(saveModFor(modern, "dex"), modern.saveMods.dex);
});

test("health states", () => {
  assert.equal(healthState(45, 45), "healthy");
  assert.equal(healthState(30, 45), "wounded");
  assert.equal(healthState(20, 45), "bloodied");
  assert.equal(healthState(5, 45), "near death");
  assert.equal(healthState(0, 45), "dead");
});

test("multiattack parsing", async () => {
  const { parseMultiattackCount, parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  assert.equal(parseMultiattackCount("The wolf makes two bite attacks."), 2);
  assert.equal(parseMultiattackCount("makes three attacks: one with its bite"), 3);
  assert.equal(parseMultiattackCount("makes four claw attacks"), 3);
  assert.equal(parseMultiattackCount("It attacks once."), null);
  const parsed = parseMonster(
    {
      armor_class: 13,
      hit_points: 26,
      dexterity: 15,
      actions: [
        { name: "Multiattack", desc: "The thug makes two melee attacks." },
        { name: "Mace", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6+2) bludgeoning damage." },
      ],
    },
    0.5,
  );
  assert.equal(parsed.attacksPerTurn, 2);
});

test("creature size parses and ranks for the grapple cap", () => {
  const parsed = parseMonster({ size: "Large", hit_points: 30 }, 1);
  assert.equal(parsed.size, "Large");
  // Synthesized stats and old snapshots carry no size and rank as Medium.
  assert.equal(synthesizeStats(2).size, undefined);
  assert.equal(sizeRank(undefined), sizeRank("Medium"));
  assert.ok(sizeRank("Tiny") < sizeRank("Small"));
  assert.ok(sizeRank("Small") < sizeRank("Medium"));
  assert.ok(sizeRank("Large") < sizeRank("Huge"));
  assert.ok(sizeRank("Huge") < sizeRank("Gargantuan"));
  // A Medium attacker can grapple up to Large, never Huge.
  assert.ok(sizeRank("Large") <= sizeRank("Medium") + 1);
  assert.ok(sizeRank("Huge") > sizeRank("Medium") + 1);
});

console.log(`test-statblock: ${passed} passed`);
