// 3D bestiary: every creature must get a valid spec and a finite, animated
// model; the same name must always look the same; and well-known monsters
// must land in the body plan a player would expect.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveCreatureSpec, buildCreature, PLANS, SIZES, SIZE_CELLS, CREATURE_TYPES } = await import("../src/lib/bestiary3d/index.ts");
const { Box3 } = await import("three");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A small fixture that runs everywhere, even without the (untracked) content pack.
const FIXTURE = [
  ["Goblin", "humanoid", "small"], ["Wolf", "beast", "medium"], ["Giant Rat", "beast", "small"],
  ["Adult Red Dragon", "dragon", "huge"], ["Skeleton", "undead", "medium"], ["Zombie", "undead", "medium"],
  ["Giant Spider", "beast", "large"], ["Shark", "beast", "large"], ["Giant Eagle", "beast", "large"],
  ["Black Pudding", "ooze", "large"], ["Beholder", "aberration", "large"], ["Ghost", "undead", "medium"],
  ["Gelatinous Cube", "ooze", "large"], ["Tyrannosaurus Rex", "beast", "huge"], ["Giant Constrictor Snake", "beast", "huge"],
  ["Swarm of Bats", "swarm", "medium"], ["Air Elemental", "elemental", "large"], ["Kraken", "monstrosity", "gargantuan"],
  ["Centaur", "monstrosity", "large"], ["Myconid Adult", "plant", "medium"], ["Werewolf", "humanoid", "medium"],
  ["Owlbear", "monstrosity", "large"], ["Lich", "undead", "medium"], ["Ogre", "giant", "large"],
  ["Pegasus", "celestial", "large"], ["Mimic", "monstrosity", "medium"], ["Mage", "humanoid", "medium"],
  ["Ancient Blue Dragon", "dragon", "gargantuan"], ["Iron Golem", "construct", "large"], ["Fire Elemental", "elemental", "large"],
];
const row = ([name, type, size], i) => ({ slug: `fixture-${i}`, name, type, size, speed: { walk: 30 } });

test("well-known monsters get the body plan a player expects", () => {
  const expect = {
    Goblin: "biped", Wolf: "quadruped", "Giant Rat": "quadruped", "Adult Red Dragon": "dragon", Skeleton: "biped",
    Zombie: "biped", "Giant Spider": "octopod", Shark: "fish", "Giant Eagle": "avian", "Black Pudding": "blob",
    Beholder: "orb", Ghost: "spirit", "Gelatinous Cube": "cube", "Tyrannosaurus Rex": "theropod",
    "Giant Constrictor Snake": "serpent", "Swarm of Bats": "swarm", "Air Elemental": "vortex", Kraken: "tentacled",
    Centaur: "taur", "Myconid Adult": "fungus", Werewolf: "biped", Owlbear: "quadruped", Lich: "biped", Ogre: "biped",
    Pegasus: "quadruped", Mimic: "cube", Mage: "biped", "Ancient Blue Dragon": "dragon", "Iron Golem": "biped",
  };
  FIXTURE.forEach((f, i) => {
    const spec = deriveCreatureSpec(row(f, i));
    if (expect[f[0]]) assert.equal(spec.plan, expect[f[0]], `${f[0]} -> ${spec.plan}`);
  });
  assert.equal(deriveCreatureSpec(row(FIXTURE[4], 4)).traits.skeletal, true, "Skeleton is skeletal");
  assert.equal(deriveCreatureSpec(row(FIXTURE[5], 5)).traits.zombie, true, "Zombie shambles");
  assert.ok(deriveCreatureSpec(row(FIXTURE[3], 3)).traits.wings !== "none", "dragons have wings");
});

test("a creature's look depends on its name only", () => {
  const a = deriveCreatureSpec({ slug: "wolf-a", name: "Wolf", type: "beast", size: "medium" });
  const b = deriveCreatureSpec({ slug: "wolf-b", name: "wolf", type: "Beast", size: "Medium", speed: { walk: 40 } });
  assert.deepEqual({ ...a, slug: "", name: "" }, { ...b, slug: "", name: "" });
  const again = deriveCreatureSpec({ slug: "wolf-a", name: "Wolf", type: "beast", size: "medium" });
  assert.deepEqual(a, again);
});

test("size drives scale and the battle-grid footprint", () => {
  const goblin = deriveCreatureSpec(row(FIXTURE[0], 0));
  const ogre = deriveCreatureSpec(row(FIXTURE[23], 23));
  assert.ok(ogre.sizeFactor > goblin.sizeFactor);
  assert.equal(ogre.footprintCells, 2);
  assert.equal(goblin.footprintCells, 1);
  for (const size of SIZES) assert.ok(SIZE_CELLS[size] > 0);
});

function finiteObject(obj) {
  const { position: p, rotation: r, scale: s } = obj;
  return [p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z].every(Number.isFinite);
}

function checkModel(input) {
  const spec = deriveCreatureSpec(input);
  assert.ok(PLANS.includes(spec.plan), `${input.name}: plan ${spec.plan}`);
  assert.ok(CREATURE_TYPES.includes(spec.type), `${input.name}: type`);
  for (const [k, v] of Object.entries(spec.palette)) assert.match(v, /^#[0-9a-f]{6}$/, `${input.name}: palette.${k}=${v}`);
  const model = buildCreature(spec);
  let meshes = 0;
  const sample = () => {
    let sum = 0;
    model.root.traverse((o) => {
      assert.ok(finiteObject(o), `${input.name}: non-finite transform`);
      if (o.isMesh) meshes += 1;
      // Swarms move instances, and some bodies deform their vertices: both count as animation.
      if (o.isInstancedMesh) for (let i = 0; i < Math.min(o.instanceMatrix.array.length, 400); i += 1) sum += o.instanceMatrix.array[i] * (1 + (i % 7));
      const pos = o.isMesh && o.geometry.attributes.position;
      if (pos && pos.usage === 35048) for (let i = 0; i < Math.min(pos.array.length, 90); i += 1) sum += pos.array[i] * (1 + (i % 5));
      sum += o.rotation.x * 1.3 + o.rotation.y * 1.7 + o.rotation.z * 2.1 + o.position.y * 0.9 + o.scale.y * 1.1 + o.scale.x * 0.7;
    });
    return sum;
  };
  model.update(0);
  const a = sample();
  meshes = 0;
  model.update(1.37);
  const b = sample();
  model.update(50.123);
  sample();
  assert.notEqual(a, b, `${input.name} (${spec.plan}) has no idle animation`);
  assert.ok(meshes > 0 && meshes < 600, `${input.name}: ${meshes} meshes`);
  const box = new Box3().setFromObject(model.root);
  const size = box.getSize(box.min.clone());
  assert.ok(Number.isFinite(size.x + size.y + size.z) && size.y > 0.02 && size.x > 0.02 && size.z > 0.02, `${input.name}: degenerate size ${size.toArray()}`);
  assert.ok(Math.max(size.x, size.y, size.z) < 200, `${input.name}: absurd size ${size.toArray()}`);
  assert.ok(Math.abs(box.min.y) < 0.5 * size.y + 0.5, `${input.name}: not grounded (min y ${box.min.y})`);
  model.dispose();
  return spec;
}

test("fixture creatures build finite, grounded, animated models", () => {
  FIXTURE.forEach((f, i) => checkModel(row(f, i)));
});

// The full catalog runs when the content pack is installed.
let catalog = null;
try {
  const { loadCatalog } = await import("./lib/bestiary-catalog.mjs");
  catalog = loadCatalog();
} catch (error) {
  console.log(`(content pack not available, full-catalog checks skipped: ${String(error.message).split("\n")[0]})`);
}

if (catalog) {
  test("the catalog is deduplicated by name and sizeable", () => {
    assert.ok(catalog.length > 1500, `only ${catalog.length} creatures`);
    assert.equal(new Set(catalog.map((c) => c.name.toLowerCase())).size, catalog.length);
  });

  test("every creature in the catalog builds a valid animated model", () => {
    const byPlan = new Map();
    for (const entry of catalog) {
      const spec = checkModel(entry);
      byPlan.set(spec.plan, (byPlan.get(spec.plan) ?? 0) + 1);
    }
    // Every body plan is exercised by real creatures.
    for (const plan of PLANS) assert.ok((byPlan.get(plan) ?? 0) > 0, `no creature uses the ${plan} plan`);
  });

  test("names, not just types, decide most plans", () => {
    const matched = catalog.filter((c) => deriveCreatureSpec(c).matchedBy === "name").length;
    assert.ok(matched / catalog.length > 0.6, `only ${Math.round((100 * matched) / catalog.length)}% matched by name`);
  });
}

console.log(`test-bestiary-3d: ${passed} passed`);
