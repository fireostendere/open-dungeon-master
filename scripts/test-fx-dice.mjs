// 3D dice and roll-overlay logic: honest numbering, landing on the rolled
// face, never sinking into the table, and "who throws what at whom".
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const bundle = await build({
  stdin: {
    contents: `
      export * from "@/lib/fx/dice/geometry";
      export { planThrow, orientationFor, supportHeight } from "@/lib/fx/dice/motion";
      export { describeRoll, paletteForCharacter } from "@/components/fx/roll-context";
      export { stageRoll, stageExpression } from "@/components/fx/roll-dice";
      export { rollExpression } from "@/lib/dice";
      export { Quaternion, Vector3 } from "three";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "error",
});
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { dieShape, restPose, faceIndexFor, splitPercentile, planThrow, orientationFor, supportHeight, describeRoll, stageRoll, stageExpression, rollExpression, Quaternion, Vector3 } = m;

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- numbering ---
for (const kind of ["d6", "d8", "d10", "d10x", "d12", "d20"]) {
  const shape = dieShape(kind);
  const values = shape.faces.map((f) => f.value).sort((a, b) => a - b);
  assert.deepEqual(values, Array.from({ length: shape.sides }, (_, i) => i + 1), `${kind} faces carry 1..n once`);
  for (const face of shape.faces) {
    const opposite = shape.faces.reduce((best, f) => (dot(f.normal, face.normal) < dot(best.normal, face.normal) ? f : best));
    assert.equal(face.value + opposite.value, shape.sides + 1, `${kind}: opposite faces sum to n+1`);
  }
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
assert.deepEqual([...dieShape("d4").vertexValues].sort(), [1, 2, 3, 4]);
assert.equal(dieShape("d10").faces.find((f) => f.value === 10).label, "0", "a d10 prints 0 for ten");
assert.equal(dieShape("d10x").faces.find((f) => f.value === 10).label, "00");

// --- rest pose shows the value on top ---
for (const kind of ["d4", "d6", "d8", "d10", "d12", "d20"]) {
  const shape = dieShape(kind);
  for (let value = 1; value <= shape.sides; value++) {
    const pose = restPose(shape, value);
    const q = orientationFor(new Vector3(...pose.up), new Vector3(...pose.toward), 0.3);
    const up = new Vector3(...pose.up).applyQuaternion(q);
    assert.ok(near(up.y, 1, 1e-6), `${kind} ${value}: the chosen face/vertex points up`);
    if (kind !== "d4") {
      const face = shape.faces[faceIndexFor(shape, value)];
      assert.equal(face.value, value);
    }
  }
}

// --- percentile pair ---
assert.deepEqual(splitPercentile(100), { tens: 10, units: 10 });
assert.deepEqual(splitPercentile(37), { tens: 3, units: 7 });
assert.deepEqual(splitPercentile(40), { tens: 4, units: 10 });
assert.deepEqual(splitPercentile(5), { tens: 10, units: 5 });

// --- throws land exactly and never sink ---
let seed = 7;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const kind of ["d4", "d6", "d8", "d10", "d12", "d20"]) {
  const shape = dieShape(kind);
  for (let trial = 0; trial < 12; trial++) {
    const value = 1 + (trial % shape.sides);
    const pose = restPose(shape, value);
    const rest = orientationFor(new Vector3(...pose.up), new Vector3(...pose.toward), rng() - 0.5);
    const target = new Vector3(rng() * 4 - 2, 0, rng() * 2 - 1);
    const plan = planThrow({
      shape,
      size: 0.8,
      target,
      rest,
      rng,
      start: { pos: new Vector3(rng() * 6 - 3, 2.2, 5), quat: new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0).normalize(), rng() * 6) },
      delay: 0.05,
    });
    const pos = new Vector3();
    const quat = new Quaternion();
    let prevQ = null;
    for (let t = 0; t <= plan.duration; t += 1 / 120) {
      plan.sample(t, pos, quat);
      assert.ok(pos.y - supportHeight(shape, 0.8, quat) > -1e-6, `${kind}: never below the table`);
      if (prevQ && t > plan.delay + 0.02) {
        // No snaps: consecutive frames stay within a plausible spin step.
        assert.ok(Math.abs(prevQ.dot(quat)) > Math.cos(0.3), `${kind}: orientation is continuous`);
      }
      prevQ = quat.clone();
    }
    plan.sample(plan.duration, pos, quat);
    assert.ok(Math.abs(quat.dot(rest)) > 1 - 1e-6, `${kind} ${value}: ends on its rest orientation`);
    assert.ok(near(pos.x, target.x, 1e-6) && near(pos.z, target.z, 1e-6), `${kind}: ends on its spot`);
    assert.ok(near(pos.y, shape.inradius * 0.8, 1e-5), `${kind}: rests flat on a face`);
    assert.ok(plan.impacts.length >= 1 && plan.impacts.every((im) => im.t > plan.delay && im.t < plan.duration));
  }
}

// --- who throws, what for, at whom ---
const env = {
  sheets: [
    { id: "pc-1", userId: "me", name: "Эйра", class: "Следопыт", level: 5 },
    { id: "pc-2", userId: "u2", name: "Торин", class: "Воин", level: 5 },
  ],
  enemies: [{ id: "gob", name: "Goblin Archer", health: "bloodied", hpPercent: 40 }],
  meUserId: "me",
  mySkin: "arcane",
  locale: { skill: (id) => ({ stealth: "Скрытность", sleightOfHand: "Ловкость рук" })[id], ability: (id) => ({ dex: "ЛОВ", wis: "МДР" })[id], dm: "Мастер", unknownHero: "Герой" },
};
const attack = describeRoll({ kind: "attack", detail: "Эйра: Longbow vs Goblin Archer", dc: null, characterId: "pc-1", requestedBy: "player" }, env);
assert.equal(attack.actor.kind, "me");
assert.equal(attack.throwFrom, "bottom");
assert.equal(attack.action, "Longbow");
assert.equal(attack.target.name, "Goblin Archer");
assert.equal(attack.target.hpPercent, 40, "the target's HP bar comes from the encounter");
assert.equal(attack.stakes.kind, "ac");

const ally = describeRoll({ kind: "saving_throw", detail: "Торин: DEX save vs Fireball", dc: 15, characterId: "pc-2" }, env);
assert.equal(ally.actor.kind, "ally");
assert.equal(ally.throwFrom, "left");
assert.equal(ally.action, "ЛОВ");
assert.deepEqual(ally.target, { name: "Fireball", kind: "effect" });
assert.deepEqual(ally.stakes, { kind: "dc", value: 15 });
assert.notEqual(ally.palette, "cursed");

const enemy = describeRoll({ kind: "attack", detail: "Goblin Archer: Shortbow", dc: null, characterId: null }, env);
assert.equal(enemy.actor.kind, "enemy");
assert.equal(enemy.throwFrom, "top");
assert.equal(enemy.palette, "cursed");

const damage = describeRoll({ kind: "damage", detail: "Эйра: Longbow damage", dc: null, characterId: "pc-1", targetEnemyId: "gob" }, env);
assert.equal(damage.action, "Longbow");
assert.equal(damage.target.name, "Goblin Archer");

const skill = describeRoll({ kind: "skill_check", detail: "sleight_of_hand", dc: 12, characterId: "pc-1", reason: "Stash the key" }, env);
assert.equal(skill.action, "Ловкость рук");
assert.equal(skill.reason, "Stash the key");
assert.equal(describeRoll({ kind: "saving_throw", detail: "death save", dc: 10, characterId: "pc-2" }, env).icon, "death");

// --- rolls become dice on the table ---
const forced = (values) => () => values.shift();
const adv = stageRoll(rollExpression("2d20kh1+5", forced([6, 17])), "arcane");
assert.equal(adv.dice.length, 2);
assert.equal(adv.hero, 1, "the kept d20 decides the roll");
assert.equal(adv.dice[0].dropped, true);
const pct = stageRoll(rollExpression("1d100", forced([40])), "arcane");
assert.deepEqual(pct.dice.map((d) => [d.kind, d.value]), [["d10x", 4], ["d10", 10]]);
assert.equal(stageRoll(rollExpression("8d6", () => 3), "crimson").dice.length, 8);
assert.equal(stageRoll(rollExpression("1d3+1", () => 2), "arcane").hidden, 1, "odd dice show as chips, not meshes");
assert.deepEqual(stageExpression("2d20kh1+4", "arcane").map((d) => d.kind), ["d20", "d20"]);

console.log("fx dice: ok");
