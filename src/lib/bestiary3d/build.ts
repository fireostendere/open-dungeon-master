// Assembles a CreatureSpec into a three.js model: picks the plan builder,
// grounds and centres the result, scales it by size category, adds the aura,
// and exposes an idle-animation clock.

import { Box3, Group, InstancedMesh, Mesh, Vector3, type Material } from "three";
import { makeRng } from "./rng";
import { addAura, detailSurfaces, makeMaterials, type Ctx } from "./parts";
import type { CreatureSpec, Plan } from "./spec";
import { buildBiped } from "./biped";
import { buildDragon, buildQuadruped, buildTaur, buildTheropod } from "./quadruped";
import { buildAvian, buildFish, buildHexapod, buildOctopod, buildSerpent, buildSwarm } from "./crawlers";
import { buildBlob, buildCube, buildFungus, buildObject, buildOrb, buildSpirit, buildTentacled, buildVortex } from "./oddities";
import { buildAmikuk, buildKobold, buildPlanetar } from "./reviewed";

export interface CreatureModel {
  root: Group;
  // Advances the idle animation; `t` is seconds and may be any value.
  update(t: number): void;
  // Size of the model in metres, after size scaling.
  size: Vector3;
  // Anatomical orbit target in root-local metres; updated with the idle pose.
  focus: Vector3;
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

const REVIEWED = new Map<string, (ctx: Ctx) => void>([
  ["a-mi-kuk", buildAmikuk], ["kobold", buildKobold], ["planetar", buildPlanetar],
]);

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
  const custom = REVIEWED.get(spec.name.toLowerCase().trim());
  (custom ?? BUILDERS[spec.plan])(ctx);
  detailSurfaces(ctx);

  const focus = new Vector3();
  const update = (t: number) => {
    for (const fn of ctx.ticks) fn(t);
    if (ctx.focus) {
      holder.updateWorldMatrix(true, true);
      holder.worldToLocal(ctx.focus.getWorldPosition(focus));
      focus.multiply(holder.scale);
    }
  };
  update(0);
  const box = new Box3().setFromObject(inner);
  const center = box.getCenter(new Vector3());
  // Choose the bulk of the body, excluding thin appendages and equipment.
  // ponytail: equal-density volume proxy; authored anchors override it for unusual anatomy.
  if (!ctx.focus) {
    let largest = 0;
    const masses: Array<{ center: Vector3; volume: number }> = [];
    inner.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh instanceof InstancedMesh) return;
      mesh.geometry.computeBoundingBox();
      // Surface-mounted details must not enter their host's mass bounds twice.
      const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
      const extent = mesh.geometry.boundingBox!.getSize(new Vector3()).multiply(mesh.getWorldScale(new Vector3()));
      const volume = Math.abs(extent.x * extent.y * extent.z);
      largest = Math.max(largest, volume);
      masses.push({ center: bounds.getCenter(new Vector3()), volume });
    });
    let mass = 0;
    const bodyCenter = new Vector3();
    for (const part of masses) if (part.volume >= largest * 0.3) {
      bodyCenter.addScaledVector(part.center, part.volume);
      mass += part.volume;
    }
    const anchor = new Group();
    anchor.name = "body-focus";
    anchor.position.copy(mass ? bodyCenter.divideScalar(mass) : center);
    inner.add(anchor);
    ctx.focus = anchor;
  }
  // A weapon can extend the frame, but must never displace the body's axis.
  ctx.focus.getWorldPosition(focus);
  inner.position.set(-focus.x, -box.min.y, -focus.z);
  const size = box.getSize(new Vector3());

  addAura(ctx, Math.max(size.x, size.z) * 0.45, size.y);
  holder.scale.setScalar(spec.sizeFactor);
  // The aura sits in `inner`'s frame before recentering; move it with the model.
  update(0);

  return {
    root: holder,
    update,
    size: size.multiplyScalar(spec.sizeFactor),
    focus,
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
