// Assembles a CreatureSpec into a three.js model: picks the plan builder,
// grounds and centres the result, scales it by size category, adds the aura,
// and exposes an idle-animation clock.

import { Box3, Group, Mesh, Vector3, type Material } from "three";
import { makeRng } from "./rng";
import { addAura, makeMaterials, type Ctx } from "./parts";
import type { CreatureSpec, Plan } from "./spec";
import { buildBiped } from "./biped";
import { buildDragon, buildQuadruped, buildTaur, buildTheropod } from "./quadruped";
import { buildAvian, buildFish, buildHexapod, buildOctopod, buildSerpent, buildSwarm } from "./crawlers";
import { buildBlob, buildCube, buildFungus, buildObject, buildOrb, buildSpirit, buildTentacled, buildVortex } from "./oddities";

export interface CreatureModel {
  root: Group;
  // Advances the idle animation; `t` is seconds and may be any value.
  update(t: number): void;
  // Size of the model in metres, after size scaling.
  size: Vector3;
  dispose(): void;
}

const BUILDERS: Record<Plan, (ctx: Ctx) => unknown> = {
  biped: (ctx) => buildBiped(ctx),
  quadruped: buildQuadruped,
  theropod: buildTheropod,
  dragon: buildDragon,
  taur: buildTaur,
  serpent: buildSerpent,
  avian: buildAvian,
  hexapod: buildHexapod,
  octopod: buildOctopod,
  fish: buildFish,
  swarm: buildSwarm,
  blob: buildBlob,
  spirit: buildSpirit,
  orb: buildOrb,
  tentacled: buildTentacled,
  cube: buildCube,
  vortex: buildVortex,
  fungus: buildFungus,
  object: buildObject,
};

export function buildCreature(spec: CreatureSpec): CreatureModel {
  const rng = makeRng((spec.seed ^ 0x9e3779b9) >>> 0);
  const holder = new Group();
  const inner = new Group();
  holder.add(inner);
  const ctx: Ctx = {
    spec,
    t: spec.traits,
    rng,
    mats: makeMaterials(spec),
    root: inner,
    ticks: [],
    phase: rng() * Math.PI * 2,
  };
  BUILDERS[spec.plan](ctx);

  const update = (t: number) => {
    for (const fn of ctx.ticks) fn(t);
  };
  update(0);
  const box = new Box3().setFromObject(inner);
  const center = box.getCenter(new Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);
  const size = box.getSize(new Vector3());

  addAura(ctx, Math.max(size.x, size.z) * 0.45, size.y);
  holder.scale.setScalar(spec.sizeFactor);
  // The aura sits in `inner`'s frame before recentering; move it with the model.
  update(0);

  return {
    root: holder,
    update,
    size: size.multiplyScalar(spec.sizeFactor),
    dispose() {
      const seen = new Set<Material>();
      holder.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!seen.has(m)) { seen.add(m); m.dispose(); }
        }
      });
    },
  };
}
