// 3D bestiary: every creature must get a valid spec and a finite, animated
// model; the same name must always look the same; and well-known monsters
// must land in the body plan a player would expect.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveCreatureSpec, buildCreature, PLANS, SIZES, SIZE_CELLS, CREATURE_TYPES } = await import("../src/lib/bestiary3d/index.ts");
const { Box3, Triangle, Vector3 } = await import("three");

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

function surfaceDistance(skin, point) {
  const p = skin.geometry.attributes.position, index = skin.geometry.index;
  const triangle = new Triangle(), closest = new Vector3();
  let distance = Infinity;
  const count = index?.count ?? p.count;
  for (let i = 0; i < count; i += 3) {
    triangle.a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(skin.matrixWorld);
    triangle.b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(skin.matrixWorld);
    triangle.c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(skin.matrixWorld);
    triangle.closestPointToPoint(point, closest);
    distance = Math.min(distance, point.distanceTo(closest));
  }
  return distance;
}

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

test("the three reviewed creatures have source-specific anatomy and equipment", () => {
  const cases = [
    ["A-mi-kuk", "aberration", "huge", "biped", "none", ["cranium", "grasping-claw-right", "grasping-claw-left"]],
    ["Kobold", "humanoid", "small", "biped", "dagger", ["reptilian-jaw", "dagger", "sling"]],
    ["Planetar", "celestial", "large", "biped", "sword", ["human-face", "greatsword", "wing-right", "wing-left"]],
  ];
  for (const [name, type, size, plan, weapon, parts] of cases) {
    const spec = deriveCreatureSpec({ slug: name.toLowerCase(), name, type, size });
    assert.equal(spec.plan, plan, name);
    assert.equal(spec.traits.weapon, weapon, `${name}: weapon`);
    const model = buildCreature(spec);
    for (const part of parts) assert.ok(model.root.getObjectByName(part), `${name}: missing ${part}`);
    const anchor = model.root.getObjectByName(name === "A-mi-kuk" ? "body-focus" : "head-focus");
    assert.ok(anchor, `${name}: focus anchor`);
    for (const time of [0, 1.37, 50.123]) {
      model.update(time);
      assert.ok(model.focus.distanceTo(anchor.getWorldPosition(new Vector3())) < 1e-6, `${name}: focus follows anatomy`);
    }
    model.dispose();
  }
});

test("kobold tail scutes touch the curved skin throughout the idle pose", () => {
  const model = buildCreature(deriveCreatureSpec({ slug: "kobold", name: "Kobold", type: "humanoid", size: "small" }));
  const skin = model.root.getObjectByName("tail-skin");
  assert.ok(skin, "curved tail skin");
  const scutes = [];
  skin.parent.traverse(o => { if (o.isMesh && o.geometry.type === "SphereGeometry") scutes.push(o); });
  assert.equal(scutes.length, 7);
  for (const time of [0, 1.37, 50.123]) {
    model.update(time);
    for (const scute of scutes) {
      const distance = surfaceDistance(skin, scute.getWorldPosition(new Vector3()));
      assert.ok(distance <= scute.geometry.parameters.radius * Math.min(...scute.getWorldScale(new Vector3()).toArray()) * 1.2,
        `floating tail scute at ${time}: gap ${distance}`);
    }
  }
  model.dispose();
});

test("families have distinct facial anatomy, including humanoid undead and hybrid heads", () => {
  const families = [
    ["Wolf", "beast", "canine"], ["Lion", "beast", "feline"], ["Giant Rat", "beast", "rodent"],
    ["Riding Horse", "beast", "equine"], ["Boar", "beast", "porcine"], ["Brown Bear", "beast", "ursine"],
    ["Crocodile", "beast", "crocodilian"], ["Ape", "beast", "primate"], ["Adult Red Dragon", "dragon", "draconic"],
    ["Goblin", "humanoid", "goblin"], ["Orc", "humanoid", "orc"], ["Ogre", "giant", "brute"],
    ["Commoner", "humanoid", "human"], ["Zombie", "undead", "gaunt"], ["Owlbear", "monstrosity", "owl"],
  ];
  const silhouettes = new Set();
  for (const [name, type, family] of families) {
    const model = buildCreature(deriveCreatureSpec({ slug: name, name, type, size: "medium" }));
    const face = model.root.getObjectByName(`face-${family}`);
    assert.ok(face, `${name}: expected ${family} anatomy`);
    const bounds = new Box3().setFromObject(face).getSize(new Vector3());
    silhouettes.add(bounds.toArray().map(n => n.toFixed(4)).join(","));
    model.dispose();
  }
  assert.equal(silhouettes.size, families.length, "families must differ geometrically");
  const chimera = buildCreature(deriveCreatureSpec({ slug: "chimera", name: "Chimera", type: "monstrosity", size: "large" }));
  for (const family of ["feline", "caprine", "draconic"]) assert.ok(chimera.root.getObjectByName(`face-${family}`), family);
  chimera.dispose();
  const medusaSpec = deriveCreatureSpec({ slug: "medusa", name: "Medusa", type: "monstrosity", size: "medium" });
  assert.equal(medusaSpec.traits.head, "humanoid");
  assert.equal(medusaSpec.traits.wings, "none");
  const medusa = buildCreature(medusaSpec);
  let snakes = 0;
  medusa.root.traverse(o => { if (o.name === "snake-hair-root") snakes++; });
  assert.equal(snakes, 6);
  medusa.dispose();
  for (const name of ["Cyclops", "Nothic"]) assert.equal(deriveCreatureSpec({ slug: name, name, type: "monstrosity", size: "medium" }).traits.eyes, 1);
});

test("surface details stay rooted during breathing and mirrored poses", () => {
  const cases = [["Adult Red Dragon", "dragon"], ["Stegosaurus", "beast"], ["Giant Turtle", "beast"], ["Shambling Mound", "plant"], ["Goblin", "humanoid"], ["Planetar", "celestial"]];
  for (const [name, type] of cases) {
    const spec = deriveCreatureSpec({ slug: name, name, type, size: "large" });
    const model = buildCreature(spec), details = [];
    model.root.traverse(o => {
      if (/^(tail-spike|dorsal-spike|dorsal-plate|shell-scute|mound-leaf|mound-thorn|eye-socket|wing-feather-root)$/.test(o.name)) details.push(o);
    });
    assert.ok(details.length > 0, name);
    for (const time of [0, 1.37, 50.123]) {
      model.update(time);
      for (const detail of details) {
        assert.ok(detail.parent.isMesh, `${name}: ${detail.name} must follow the skin`);
        const distance = surfaceDistance(detail.parent, detail.getWorldPosition(new Vector3()));
        assert.ok(distance < .03 * spec.sizeFactor, `${name}: detached ${detail.name} at ${time}: ${distance}`);
      }
    }
    model.dispose();
  }
});

test("individual portraits are geometrically varied and deterministic", () => {
  const portrait = name => {
    const model = buildCreature(deriveCreatureSpec({ slug: name, name, type: "humanoid", size: "medium" }));
    const geometry = Array.from(model.root.getObjectByName("cranium").geometry.attributes.position.array);
    model.dispose();
    return geometry;
  };
  assert.deepEqual(portrait("Commoner"), portrait("Commoner"));
  const portraits = ["Commoner", "Bandit", "Mage", "Noble", "Veteran"].map(name => JSON.stringify(portrait(name)));
  assert.equal(new Set(portraits).size, portraits.length);
});

test("humanoid-shaped focus follows the head instead of equipment bounds", () => {
  for (const name of ["Commoner", "Mage", "Ogre", "Ghost", "Djinni"]) {
    const model = buildCreature(deriveCreatureSpec({ slug: name, name, type: "humanoid", size: "medium" }));
    const head = model.root.getObjectByName("head-focus");
    assert.ok(head, name);
    model.update(2);
    assert.ok(model.focus.distanceTo(head.getWorldPosition(new Vector3())) < 1e-6, name);
    model.dispose();
  }
});

test("a non-humanoid's body focus is independent of its wings", () => {
  const spec = deriveCreatureSpec({ slug: "pegasus", name: "Pegasus", type: "celestial", size: "large" });
  const winged = buildCreature(spec);
  const bare = buildCreature({ ...spec, traits: { ...spec.traits, wings: "none" } });
  assert.ok(winged.focus.distanceTo(bare.focus) < 1e-6, "wings must not displace the centre of the body");
  assert.ok(winged.root.getObjectByName("body-focus"));
  winged.dispose();
  bare.dispose();
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
  assert.ok(model.focus.toArray().every(Number.isFinite), `${input.name}: non-finite focus`);
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

console.log(`test-bestiary-3d: ${passed} passed${catalog ? ` (${catalog.length} catalog creatures)` : ""}`);
