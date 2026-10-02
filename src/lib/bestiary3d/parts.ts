// Shared building blocks for creature models: materials, primitive shortcuts,
// tapered limbs, wavy chains (tails, necks, tentacles), heads, horns, wings,
// and floating aura particles. Every plan builder is assembled from these.
//
// Conventions: Y is up, the creature faces +Z, its left/right are +/-X, feet
// (or belly) rest near y = 0. Everything is authored at "medium" size and
// scaled at the end by the size category.

import {
  BufferGeometry,
  CatmullRomCurve3,
  CapsuleGeometry,
  ConeGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  BoxGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Rng } from "./rng";
import { between, chance, makeRng, pick } from "./rng";
import type { CreatureSpec, Traits } from "./spec";

export type Tick = (t: number) => void;

export interface Mats {
  skin: MeshStandardMaterial;
  belly: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  eye: MeshStandardMaterial;
  glow: MeshBasicMaterial;
  dark: MeshStandardMaterial;
  white: MeshStandardMaterial;
}

export interface Ctx {
  spec: CreatureSpec;
  t: Traits;
  rng: Rng;
  mats: Mats;
  root: Group;
  ticks: Tick[];
  // Random phase so two creatures on one page never breathe in lockstep.
  phase: number;
  // Authored anatomical anchor, not the bounds of a weapon, wing or aura.
  focus?: Object3D;
}

const FLAT_LOOKS = new Set(["scale", "stone", "crystal", "metal", "chitin", "bark", "ice"]);

export function makeMaterials(spec: CreatureSpec): Mats {
  const { look, palette } = spec;
  const flat = FLAT_LOOKS.has(look);
  const std = (color: string, extra: Record<string, unknown> = {}) =>
    new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: flat, ...extra });

  const lookProps: Record<string, unknown> = (() => {
    switch (look) {
      case "fur": return { roughness: 0.96 };
      case "hide": return { roughness: 0.82 };
      case "skin": return { roughness: 0.78 };
      case "flesh": return { roughness: 0.7 };
      case "scale": return { roughness: 0.5, metalness: 0.14 };
      case "feather": return { roughness: 0.92 };
      case "chitin": return { roughness: 0.32, metalness: 0.28 };
      case "bark": return { roughness: 1 };
      case "bone": return { roughness: 0.72 };
      case "metal": return { roughness: 0.34, metalness: 0.86 };
      case "stone": return { roughness: 1 };
      case "crystal": return { roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.86, emissive: palette.skin, emissiveIntensity: 0.28 };
      case "ghost": return { roughness: 1, transparent: true, opacity: 0.55, emissive: palette.glow, emissiveIntensity: 0.4, depthWrite: false };
      case "flame": return { roughness: 1, emissive: palette.skin, emissiveIntensity: 1.1 };
      case "ice": return { roughness: 0.1, transparent: true, opacity: 0.74, emissive: palette.skin, emissiveIntensity: 0.15 };
      case "slime": return { roughness: 0.12, transparent: true, opacity: 0.8, emissive: palette.skin, emissiveIntensity: 0.12 };
      default: return {};
    }
  })();

  const glowingEyes = spec.traits.glowEyes || look === "ghost" || look === "flame";
  const skin = std(palette.skin, lookProps), belly = std(palette.belly, lookProps);
  skin.name = "anatomy-skin";
  belly.name = "anatomy-belly";
  return {
    skin,
    belly,
    cloth: new MeshStandardMaterial({ color: palette.cloth, roughness: 0.95, side: DoubleSide }),
    accent: std(palette.accent, { roughness: 0.55, metalness: look === "metal" ? 0.6 : 0.05 }),
    metal: new MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.35, metalness: 0.85, flatShading: true }),
    eye: glowingEyes
      ? new MeshStandardMaterial({ color: palette.eye, emissive: palette.eye, emissiveIntensity: 1.6, roughness: 0.3 })
      : new MeshStandardMaterial({ color: palette.eye, roughness: 0.25 }),
    glow: new MeshBasicMaterial({ color: palette.glow, toneMapped: false }),
    dark: new MeshStandardMaterial({ color: "#150d10", roughness: 0.9 }),
    white: new MeshStandardMaterial({ color: "#eee9dd", roughness: 0.6 }),
  };
}

// ---------------------------------------------------------------------------
// primitives

export const UP = new Vector3(0, 1, 0);

export function tick(ctx: Ctx, fn: Tick): void {
  ctx.ticks.push(fn);
}

export function place<T extends Object3D>(obj: T, x = 0, y = 0, z = 0): T {
  obj.position.set(x, y, z);
  return obj;
}

export function ball(r: number, mat: Material, sx = 1, sy = 1, sz = 1, seg = 14): Mesh {
  const m = new Mesh(new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.6))), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

export function cyl(rTop: number, rBottom: number, h: number, mat: Material, radial = 8): Mesh {
  return new Mesh(new CylinderGeometry(rTop, rBottom, h, radial, 1), mat);
}

export function cone(r: number, h: number, mat: Material, radial = 8): Mesh {
  return new Mesh(new ConeGeometry(r, h, radial, 1), mat);
}

export function box(w: number, h: number, d: number, mat: Material): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), mat);
}

export function capsule(r: number, len: number, mat: Material, radial = 8): Mesh {
  return new Mesh(new CapsuleGeometry(r, len, 4, radial), mat);
}

export function torus(radius: number, tube: number, mat: Material, arc = Math.PI * 2, radial = 6, tubular = 16): Mesh {
  return new Mesh(new TorusGeometry(radius, tube, radial, tubular, arc), mat);
}

export function shard(r: number, mat: Material): Mesh {
  return new Mesh(new OctahedronGeometry(r, 0), mat);
}

export type Ring = [y: number, width: number, depth: number, z?: number, x?: number];

// Continuous anatomical surfaces shared by authored and procedural models.
export function loft(rings: Ring[], mat: Material, sides = 32): Mesh {
  const positions: number[] = [], indices: number[] = [];
  for (const [y, rx, rz, z = 0, x = 0] of rings) for (let j = 0; j < sides; j++) {
    const a = j / sides * Math.PI * 2;
    positions.push(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, a + sides, b, b, a + sides, b + sides);
  }
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j, j + 1);
    const top = (rings.length - 1) * sides;
    indices.push(top, top + j + 1, top + j);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new Mesh(geo, mat);
}

export function tendon(points: Vector3[], radii: number[], mat: Material, steps = 24, sides = 10): Mesh {
  const curve = new CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(steps, false);
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, center = curve.getPointAt(u);
    const k = u * (radii.length - 1), n = Math.min(radii.length - 2, Math.floor(k));
    const r = radii[n]! + (radii[n + 1]! - radii[n]!) * (k - n);
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      const p = center.clone().addScaledVector(frames.normals[i]!, Math.cos(a) * r)
        .addScaledVector(frames.binormals[i]!, Math.sin(a) * r);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new Mesh(geo, mat);
}

const surfaceMaterial = new MeshBasicMaterial({ side: DoubleSide });

// `near` and `out` are in the skin's parent frame. Embed the detail's base in
// the actual mesh, then parent it to the skin so breathing cannot detach it.
export function mountSurface(skin: Mesh, detail: Object3D, near: Vector3, out: Vector3, inset = 0.002): void {
  skin.updateMatrix();
  skin.geometry.computeBoundingSphere();
  const radius = skin.geometry.boundingSphere!.radius * Math.max(...skin.scale.toArray().map(Math.abs));
  const probe = new Mesh(skin.geometry, surfaceMaterial);
  probe.matrixAutoUpdate = false;
  probe.matrix.copy(skin.matrix);
  probe.updateMatrixWorld(true);
  const normal = out.clone().normalize();
  const ray = new Raycaster(near.clone().addScaledVector(normal, radius * 2), normal.clone().negate());
  const hit = ray.intersectObject(probe, false)[0];
  if (!hit) throw new Error(`No skin beneath ${detail.name || "surface detail"}`);
  detail.position.copy(hit.point).addScaledVector(normal, -inset);
  detail.quaternion.setFromUnitVectors(UP, normal);
  detail.applyMatrix4(skin.matrix.clone().invert());
  skin.add(detail);
}

export function surfaceTendon(skin: Mesh, points: Vector3[], radii: number[], mat: Material, out = new Vector3(0, 0, 1), steps = 24): Mesh {
  const projected = points.map((point, i) => {
    const anchor = new Group();
    mountSurface(skin, anchor, point, out, Math.min(.01, radii[i]! * .45));
    const local = anchor.position.clone();
    skin.remove(anchor);
    return local;
  });
  const fold = tendon(projected, radii, mat, steps, 8);
  skin.add(fold);
  return fold;
}

// A tapered cylinder from point a (radius r0) to point b (radius r1).
export function segment(a: Vector3, b: Vector3, r0: number, r1: number, mat: Material, radial = 8): Mesh {
  const dir = b.clone().sub(a);
  const len = Math.max(1e-4, dir.length());
  const m = new Mesh(new CylinderGeometry(r1, r0, len, radial, 1), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

// Two-bone limb a -> b -> c (hip, knee, foot / shoulder, elbow, hand).
export function limb(a: Vector3, b: Vector3, c: Vector3, r0: number, r1: number, r2: number, mat: Material, radial = 8): Group {
  const g = new Group();
  g.add(segment(a, b, r0, r1, mat, radial));
  g.add(segment(b, c, r1, r2, mat, radial));
  const knee = ball(r1 * 1.02, mat, 1, 1, 1, 8);
  knee.position.copy(b);
  g.add(knee);
  return g;
}

export interface Chain {
  root: Group;
  segs: Group[];
  tip: Group;
}

// A tapering chain of nested segments along local -Z. Each segment sits in
// its own group so a sine of rotations makes tails, necks and tentacles
// bend smoothly. Aim it by setting root.quaternion (see aim()).
export function chain(n: number, length: number, r0: number, r1: number, mat: Material, radial = 7): Chain {
  const root = new Group();
  const segs: Group[] = [];
  const seg = length / n;
  let parent: Group = root;
  for (let i = 0; i < n; i += 1) {
    const g = new Group();
    const ra = r0 + (r1 - r0) * (i / n);
    const rb = r0 + (r1 - r0) * ((i + 1) / n);
    const body = new Mesh(new CylinderGeometry(rb, ra, seg * 1.04, radial, 1), mat);
    // CylinderGeometry(rb, ra): thin end on +Y. Pointing +Y at -Z puts it at the tip.
    body.rotation.x = -Math.PI / 2;
    body.position.z = -seg / 2;
    g.add(body);
    if (i > 0) {
      const joint = ball(ra * 1.01, mat, 1, 1, 1, 8);
      g.add(joint);
    }
    parent.add(g);
    if (i > 0) g.position.z = -seg;
    segs.push(g);
    parent = g;
  }
  const tip = new Group();
  tip.position.z = -seg;
  parent.add(tip);
  return { root, segs, tip };
}

export function aim(obj: Object3D, dir: Vector3): void {
  obj.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), dir.clone().normalize());
}

// Registers a sine wave down a chain: tails, tentacles, serpents.
export function wave(ctx: Ctx, c: Chain, opts: { yaw?: number; pitch?: number; speed?: number; lag?: number; phase?: number }): void {
  const { yaw = 0.12, pitch = 0, speed = 1.4, lag = 0.55, phase = ctx.phase } = opts;
  tick(ctx, (t) => {
    c.segs.forEach((g, i) => {
      g.rotation.y = yaw * Math.sin(t * speed - i * lag + phase);
      g.rotation.x = pitch * Math.sin(t * speed * 0.8 - i * lag + phase + 1.3);
    });
  });
}

// A curved spike: a stack of cones, each bent a little more. Horns, claws,
// tusks, thorns. Grows along +Y; rotate the returned group to place it.
export function spike(len: number, r: number, bend: number, mat: Material, segs = 4, radial = 6): Group {
  const g = new Group();
  let parent: Group = g;
  const seg = len / segs;
  for (let i = 0; i < segs; i += 1) {
    const ra = r * (1 - i / segs);
    const rb = r * (1 - (i + 1) / segs) + 0.0001;
    const part = new Group();
    const body = new Mesh(new CylinderGeometry(rb, ra, seg * 1.05, radial, 1), mat);
    body.position.y = seg / 2;
    part.add(body);
    part.rotation.x = i === 0 ? 0 : bend / segs;
    if (i > 0) part.position.y = seg;
    parent.add(part);
    parent = part;
  }
  return g;
}

export function addPair(parent: Object3D, make: (side: 1 | -1) => Object3D, x: number, y: number, z: number): void {
  for (const side of [1, -1] as const) {
    const o = make(side);
    o.position.set(x * side, y, z);
    parent.add(o);
  }
}

// ---------------------------------------------------------------------------
// horns

export function makeHorns(kind: Traits["horns"], r: number, mats: Mats): Group {
  const g = new Group();
  const mat = mats.accent;
  switch (kind) {
    case "straight": {
      addPair(g, (side) => {
        const h = spike(r * 1.5, r * 0.28, -0.25, mat, 3);
        h.rotation.z = -0.3 * side;
        return h;
      }, r * 0.42, r * 0.78, r * 0.1);
      break;
    }
    case "curved": {
      addPair(g, (side) => {
        const h = spike(r * 1.7, r * 0.3, -1.9, mat, 5);
        h.rotation.z = -0.55 * side;
        h.rotation.x = -0.25;
        return h;
      }, r * 0.45, r * 0.72, -r * 0.05);
      break;
    }
    case "bull": {
      addPair(g, (side) => {
        return tendon([new Vector3(), new Vector3(side * r * .72, r * .16, 0), new Vector3(side * r * 1.18, r * .63, -r * .05), new Vector3(side * r * 1.15, r * 1.24, -r * .12)], [r * .29, r * .25, r * .14, .0001], mat, 24, 8);
      }, r * 0.55, r * 0.55, r * 0.05);
      break;
    }
    case "ram": {
      addPair(g, (side) => {
        const curl = torus(r * 0.55, r * 0.16, mat, Math.PI * 1.6, 6, 14);
        curl.rotation.y = side * Math.PI / 2;
        curl.rotation.z = -0.6;
        curl.scale.set(1, 1, 1.15);
        const holder = new Group();
        holder.add(curl);
        holder.rotation.z = 0;
        return holder;
      }, r * 0.72, r * 0.3, -r * 0.1);
      break;
    }
    case "antlers": {
      addPair(g, (side) => {
        const a = new Group();
        const points = [new Vector3(), new Vector3(side * r * .17, r * .55, -r * .06), new Vector3(side * r * .30, r * 1.05, -r * .24), new Vector3(side * r * .35, r * 1.60, -r * .50)];
        a.add(tendon(points, [r * .14, r * .12, r * .075, .0001], mat, 22, 7));
        for (let i = 0; i < 3; i += 1) {
          const start = new CatmullRomCurve3(points).getPoint(.25 + i * .22);
          a.add(tendon([start, start.clone().add(new Vector3(-side * r * .22, r * .30, r * .10)), start.clone().add(new Vector3(-side * r * .26, r * .60, r * .14))], [r * .075, r * .05, .0001], mat, 12, 6));
        }
        return a;
      }, r * 0.35, r * 0.75, -r * 0.05);
      break;
    }
    default:
      break;
  }
  return g;
}

// ---------------------------------------------------------------------------
// heads

export interface HeadOpts {
  r: number;
  style?: Traits["head"];
  snout?: number;
  bulk?: number;
  family?: FaceFamily;
}

export type FaceFamily =
  | "human" | "elven" | "dwarven" | "goblin" | "orc" | "brute" | "gaunt" | "fiend" | "primate"
  | "canine" | "feline" | "rodent" | "ursine" | "porcine" | "bovine" | "caprine" | "equine" | "cervine" | "pachyderm"
  | "reptilian" | "crocodilian" | "draconic" | "dinosaur" | "owl" | "raptor" | "corvid" | "waterfowl" | "wader" | "bird"
  | "skull" | "frog" | "fish" | "insect" | "construct" | "wood";

function faceFamily(ctx: Ctx, style: Traits["head"]): FaceFamily {
  const n = ctx.spec.name.toLowerCase(), { t, spec } = ctx;
  if (style === "skull" || style === "frog" || style === "fish" || style === "insect") return style;
  if (style === "bird" || t.beak) {
    if (/owl/.test(n)) return "owl";
    if (/raven|crow|kenku|corvid/.test(n)) return "corvid";
    if (/duck|goose|geese|swan|pelican/.test(n)) return "waterfowl";
    if (/heron|stork|crane/.test(n)) return "wader";
    return /eagle|hawk|falcon|griff|roc\b|vrock/.test(n) ? "raptor" : "bird";
  }
  if (style === "humanoid") {
    if (spec.look === "metal" || spec.look === "stone" || spec.look === "crystal") return "construct";
    if (spec.look === "bark") return "wood";
    if (/hobgoblin|goblin|gremlin|boggle/.test(n)) return "goblin";
    if (/\borc|ork\b|uruk/.test(n)) return "orc";
    if (/hag|witch|crone|troll|ghoul|zombie|vampire|wight|revenant|mummy/.test(n) || t.zombie) return "gaunt";
    if (/dwarf|duergar|derro|gnome/.test(n)) return "dwarven";
    if (/\belf\b|elven|drow|gith|pixie|sprite|dryad/.test(n) || spec.type === "fey") return "elven";
    return spec.type === "giant" || /ogre|ettin|cyclops/.test(n) ? "brute" : "human";
  }
  if (/gorilla|baboon|monkey|chimp|orangutan|\bape\b|yeti|sasquatch|bigfoot|bugbear/.test(n)) return "primate";
  if (/rakshasa|tabaxi|leonin|lion|tiger|panther|leopard|\bcat|cheetah|lynx|jaguar|cougar|puma|smilodon|displacer/.test(n)) return "feline";
  if (/rat|mouse|mice|squirrel|beaver|rabbit|hare|hamster|rodent|mole|shrew/.test(n)) return "rodent";
  if (/boar|hog|pig|swine|peccary|nalfeshnee/.test(n)) return "porcine";
  if (/bear|panda|grolar/.test(n)) return "ursine";
  if (/minotaur|bull|\box\b|bison|buffalo|yak|gorgon|aurochs|cow/.test(n)) return "bovine";
  if (/goat|\bram\b|sheep|ibex|satyr|faun|krampus/.test(n)) return "caprine";
  if (/elk|deer|stag|moose|antelope|gazelle|peryton|giraffe/.test(n)) return "cervine";
  if (/horse|pony|mule|donkey|zebra|camel|llama|steed|pegasus|unicorn|ki-rin|buraq|nightmare/.test(n)) return "equine";
  if (t.trunk || /rhino|hippo/.test(n)) return "pachyderm";
  if (/crocodile|alligator|caiman|gator/.test(n)) return "crocodilian";
  if (spec.plan === "dragon" || /dragonborn|drakkin|hydra/.test(n)) return "draconic";
  if (spec.plan === "theropod" || /saurus|saur\b|tarrasque/.test(n)) return "dinosaur";
  if (spec.look === "scale" || /kobold|lizard|basilisk|snake|serpent/.test(n)) return "reptilian";
  if (/wolf|worg|warg|dog|hound|fox|jackal|hyena|gnoll|coyote|cerberus|orthrus|arcanaloth/.test(n)) return "canine";
  if (/succubus|incubus|erinyes|cambion/.test(n)) return "human";
  if (spec.type === "fiend") return "fiend";
  return t.snout >= .6 ? "canine" : t.bulk >= 1.2 ? "ursine" : "reptilian";
}

// Width/height/depth, muzzle width/height/reach. No universal dog muzzle.
const MUZZLES: Partial<Record<FaceFamily, [number, number, number, number, number, number]>> = {
  canine: [ .80, .94, .95, .36, .28, 2.05 ], feline: [ 1.06, .86, .88, .56, .28, 1.02 ],
  rodent: [ .70, .81, .88, .25, .22, 1.58 ], ursine: [ 1.10, 1.02, 1.02, .56, .39, 1.42 ],
  porcine: [ .94, .83, 1.02, .45, .40, 1.82 ], bovine: [ .99, 1.05, 1.00, .66, .43, 1.50 ],
  caprine: [ .69, 1.07, .82, .31, .36, 1.42 ], equine: [ .72, 1.24, .90, .47, .47, 2.18 ],
  cervine: [ .62, 1.03, .79, .28, .30, 1.66 ], pachyderm: [ 1.22, 1.03, 1.04, .77, .52, 1.42 ],
  reptilian: [ .92, .65, 1.01, .58, .23, 1.70 ], crocodilian: [ .98, .58, .93, .68, .22, 3.15 ],
  draconic: [ .98, .92, 1.08, .58, .35, 1.95 ], dinosaur: [ .87, 1.08, 1.03, .66, .48, 2.22 ],
};

// Origin remains at the cranium; the inner face is authored at unit radius.
// Callers can still add hair/frills in their original coordinate frame.
export function makeHead(ctx: Ctx, opts: HeadOpts): Group {
  const { mats, t } = ctx;
  const family = opts.family ?? faceFamily(ctx, opts.style ?? t.head);
  const rng = makeRng((ctx.spec.seed ^ 0xfaceb00c) >>> 0);
  const g = new Group(), face = new Group();
  face.name = `face-${family}`;
  face.scale.setScalar(opts.r);
  g.add(face);
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const add = (o: Object3D, x = 0, y = 0, z = 0) => { face.add(place(o, x, y, z)); return o; };
  const proportions = MUZZLES[family];
  const human = ["human", "elven", "dwarven", "goblin", "orc", "brute", "gaunt", "fiend", "primate", "construct", "wood", "skull"].includes(family);
  let width = (proportions?.[0] ?? .85) * between(rng, .94, 1.06);
  let height = (proportions?.[1] ?? 1.08) * between(rng, .95, 1.05);
  let depth = proportions?.[2] ?? .84;
  let jaw = .68, noseLength = .23, eyeSize = .16;
  if (family === "human") {
    const portrait = pick(rng, [[.80, 1.12, .55, .20, .14], [1.06, .96, .85, .30, .18], [.94, 1.05, .68, .24, .16], [.85, 1.20, .50, .33, .15], [1.09, .91, .88, .22, .15]] as const);
    width *= portrait[0]; height *= portrait[1]; jaw = portrait[2]; noseLength = portrait[3]; eyeSize = portrait[4];
  }
  if (family === "goblin") { width *= 1.12; height *= .88; jaw = .48; noseLength = .42; eyeSize = .22; }
  if (family === "orc" || family === "brute" || family === "primate") { width *= 1.18; height *= .94; jaw = .94; noseLength = .31; }
  if (family === "elven" || family === "gaunt") { width *= .86; height *= 1.10; jaw = .44; noseLength = .30; eyeSize = .13; }
  if (family === "dwarven") { width *= 1.13; height *= .92; jaw = .90; noseLength = .34; }
  if (family === "frog") { width = 1.32; height = .59; depth = 1.05; eyeSize = .29; }
  if (family === "insect") { width = .83; height = .82; depth = .86; eyeSize = .34; }
  if (family === "fish") { width = .86; height = .91; depth = 1.26; eyeSize = .21; }
  if (family === "owl") { width = 1.16; height = 1.08; depth = .88; eyeSize = .29; }
  if (family === "raptor") { width = .80; height = .93; depth = 1.08; }
  if (family === "corvid") { width = .75; height = .85; depth = 1.12; }
  if (family === "waterfowl") { width = .72; height = .82; depth = 1.05; }
  if (family === "wader") { width = .60; height = .74; depth = 1.11; }
  const skull = loft([
    [-height * .94, width * jaw * .60, depth * .48, .12],
    [-height * .68, width * jaw, depth * .72, .10],
    [-height * .25, width * .94, depth * .88, .03],
    [height * .24, width, depth], [height * .65, width * .84, depth * .90, -.06],
    [height * .92, width * .46, depth * .53, -.08], [height, .01, .01, -.08],
  ], mats.skin, ctx.spec.look === "metal" ? 12 : 28);
  skull.name = "cranium";
  add(skull);

  // Socket, globe, iris, pupil and brow move as one surface-mounted feature.
  const eye = (x: number, y: number, z: number, side: number, size = eyeSize) => {
    const e = new Group();
    e.name = "eye-socket";
    e.add(place(ball(size * 1.18, family === "skull" ? mats.dark : mats.skin, 1.2, .38, .86, 12), 0, .025, 0));
    e.add(place(ball(size, human && family !== "skull" ? mats.white : mats.eye, 1, .48, .75, 14), 0, .06, 0));
    e.add(place(ball(size * .56, mats.eye, 1, .22, .92, 12), 0, .10, 0));
    const slit = /reptilian|crocodilian|draconic|feline/.test(family);
    e.add(place(ball(size * .30, mats.dark, slit ? .32 : .78, .18, 1, 10), 0, .122, 0));
    if (family !== "insect" && family !== "frog") {
      const brow = place(ball(size, mats.skin, 1.45, .38, .31, 12), 0, .06, -size * .83);
      brow.rotation.y = side * (family === "gaunt" || family === "orc" ? .28 : .10);
      e.add(brow);
    }
    mountSurface(skull, e, v(x, y, z), v(human || family === "owl" ? 0 : side * .55, .04, 1), .012);
  };
  if (t.eyes === 1) eye(0, .20, depth, 0, .30);
  else {
    const eyeX = family === "frog" ? .72 : human || family === "owl" ? .40 : .63;
    for (const side of [-1, 1]) eye(side * width * eyeX, height * (family === "frog" ? .60 : .18), depth * .80, side);
    if (t.eyes === 3) eye(0, height * .57, depth * .85, 0, .14);
  }

  if (proportions) {
    const [, , , mw, mh, reach] = proportions;
    const end = reach * between(rng, .94, 1.07);
    const muzzle = loft([[.22, mw * .85, mh], [.75, mw, mh], [end - .16, mw * .82, mh * .79], [end, mw * .66, mh * .62]], mats.skin, 24);
    muzzle.rotation.x = Math.PI / 2;
    add(muzzle, 0, -.20, 0);
    const lower = loft([[.25, mw * .65, mh * .48], [.8, mw * .83, mh * .46], [end - .08, mw * .66, mh * .36]], mats.belly, 24);
    lower.rotation.x = Math.PI / 2;
    add(lower, 0, -.20 - mh * .92, 0);
    const mammal = !/reptilian|crocodilian|draconic|dinosaur/.test(family);
    const nose = new Group();
    if (mammal) {
      const pad = ball(mw * .46, mats.dark, family === "porcine" ? 1.7 : 1.2, .42, .75, 14);
      nose.add(pad);
      if (family === "porcine" || family === "bovine" || family === "equine" || family === "pachyderm") {
        pad.material = mats.belly;
        for (const side of [-1, 1]) nose.add(place(ball(mw * .11, mats.dark, 1, .30, .75, 10), side * mw * .25, mw * .17, 0));
      }
      mountSurface(muzzle, nose, v(0, -.20, end), v(0, 0, 1), .012);
    } else {
      for (const side of [-1, 1]) {
        const nostril = ball(.065, mats.dark, 1, .30, .65, 10);
        mountSurface(muzzle, nostril, v(side * mw * .45, -.12, end - .18), v(0, 1, .3), .01);
      }
    }
      // A continuous mouth seam down each cheek; rooted teeth overlap the jaws.
    for (const side of [-1, 1]) {
      const seam: Vector3[] = [];
      for (let i = 0; i < 7; i++) {
        const z = .65 + (end - .72) * i / 6;
        const mark = new Group();
        mountSurface(muzzle, mark, v(side * mw * .50, -.20 - mh * .62, z), v(side, 0, 0), .008);
        seam.push(mark.position.clone().applyMatrix4(muzzle.matrix));
        muzzle.remove(mark);
      }
      add(tendon(seam, seam.map(() => .012), mats.dark, 22, 6));
      if (!mammal || family === "canine" || family === "feline") for (let i = 0; i < 5; i++) {
        const z = .79 + (end - .85) * i / 5;
        const tooth = spike(mh * .44, .028, -.15, mats.white, 2, 5);
        mountSurface(muzzle, tooth, v(side * mw * .58, -.20, z), v(0, -1, 0), .012);
      }
      if (family === "feline") add(ball(.24, mats.belly, 1, .65, .65, 12), side * .25, -.20, end - .10);
    }
    if (family === "rodent") for (const side of [-1, 1]) add(box(.14, .25, .09, mats.white), side * .09, -.48, end - .02);
  } else if (human) {
    if (family !== "skull" && family !== "construct" && family !== "wood") {
      const bridge = loft([[-.30, .13, noseLength * .66, depth * .82], [-.13, .15, noseLength, depth * .87], [.13, .075, .12, depth * .82], [.35, .045, .05, depth * .76]], mats.skin, 16);
      add(bridge);
      for (const side of [-1, 1]) {
        const cheek = ball(.17, mats.belly, 1.15, .28, .80, 12);
        mountSurface(skull, cheek, v(side * width * .59, -.25, depth), v(0, 0, 1), .025);
        const nostril = ball(.042, mats.dark, 1, .5, .35, 8);
        add(nostril, side * .09, -.24, depth * .87 + noseLength * .70);
      }
    }
    const lips = new Group();
    lips.name = "mouth";
    lips.add(box(family === "brute" || family === "orc" ? .80 : .48, .055, .05, mats.dark));
    if (family === "skull") {
      for (let i = 0; i < 8; i++) lips.add(place(box(.073, .09, .14, mats.white), (i - 3.5) * .085, .025, 0));
    } else lips.add(place(ball(.22, mats.skin, 1.2, .18, .16, 12), 0, .02, .055));
    mountSurface(skull, lips, v(0, -height * .56, depth * .75), v(0, 0, 1), .015);
    if (family === "skull") {
      const cavity = cone(.13, .23, mats.dark, 3);
      cavity.rotation.x = Math.PI / 2;
      const mount = new Group(); mount.add(cavity);
      mountSurface(skull, mount, v(0, -.16, depth), v(0, 0, 1), .01);
    }
    // Stable per-name forehead/jaw/nose proportions plus close-cropped hair.
    if ((family === "human" || family === "elven" || family === "dwarven") && ctx.spec.look !== "ghost" && t.crown === "none" && !/medusa/i.test(ctx.spec.name) && chance(rng, .85)) {
      add(loft([[height * .50, width * .90, depth * .95, -.04], [height * .65, width * .85, depth * .91, -.06], [height * .92, width * .47, depth * .54, -.08], [height * 1.01, .01, .01, -.08]], mats.dark, 28));
    }
  } else if (/owl|raptor|corvid|waterfowl|wader|bird/.test(family)) {
    const length = opts.style === "bird" && opts.snout !== undefined ? opts.snout : family === "owl" ? .65 : family === "wader" ? 3.3 : family === "corvid" ? 2.0 : 1.35;
    if (family === "owl") for (const side of [-1, 1]) {
      const disk = ball(.48, mats.belly, 1, .22, 1.12, 18);
      mountSurface(skull, disk, v(side * .48, .04, .8), v(0, 0, 1), .09);
    }
    const bill = tendon([v(0, -.06, .65), v(0, -.06, .95 + length * .50), v(0, -.15, .92 + length), v(0, -.36, .88 + length)], [.30, .22, .075, .001], mats.accent, 24, 10);
    if (family === "waterfowl") bill.geometry.scale(1.55, .62, 1);
    add(bill);
    add(tendon([v(0, -.28, .65), v(0, -.27, .95 + length * .6), v(0, -.28, .90 + length * .85)], [.17, .12, .001], mats.accent, 16, 8));
  } else if (family === "frog" || family === "fish") {
    const mouth = new Group();
    mouth.add(ball(1, mats.dark, family === "frog" ? .94 : .48, .08, .09, 16));
    mouth.add(place(ball(1, mats.belly, family === "frog" ? .95 : .49, .06, .07, 16), 0, .015, .09));
    mountSurface(skull, mouth, v(0, -.18, depth), v(0, 0, 1), .015);
    if (family === "fish") for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const gill = ball(.17, mats.dark, .12, .16, 1, 8);
      mountSurface(skull, gill, v(side * width * .8, -.10, -.20 + i * .15), v(side, 0, 0), .005);
    }
  } else if (family === "insect") {
    for (const side of [-1, 1]) {
      const mandible = add(tendon([v(side * .21, -.40, .58), v(side * .45, -.47, 1.08), v(side * .12, -.45, 1.22)], [.13, .08, .001], mats.accent, 18, 8));
      mandible.name = "mandible";
      const antenna = new Group();
      antenna.name = "antenna";
      antenna.add(tendon([v(0, 0, 0), v(side * .18, .45, .15), v(side * .24, 1.10, .38)], [.055, .035, .008], mats.dark, 18, 6));
      mountSurface(skull, antenna, v(side * .26, .40, .45), UP, .045);
    }
  }

  if (t.tusks) for (const side of [-1, 1]) {
    const z = proportions ? proportions[5] * .75 : depth * .80;
    const x = proportions ? proportions[3] * .75 : width * .43;
    add(tendon([v(side * x, -.42, z), v(side * (x + .10), -.24, z + .18), v(side * (x + .12), .10, z + .10)], [.12, .075, .001], mats.white, 18, 8));
  }
  if (t.ears !== "none" && !/skull|owl|raptor|corvid|waterfowl|wader|bird|fish|insect|frog/.test(family)) {
    for (const side of [-1, 1]) {
      if (t.ears === "round") {
        add(ball(.24, mats.skin, .55, 1, .80, 12), side * width * .85, height * (human ? .05 : .56), -.07);
      } else {
        const ear = spike(t.ears === "long" ? 1.05 : human ? .63 : .67, .20, -.12, mats.skin, 3, 8);
        ear.scale.z = .48;
        ear.rotation.z = -side * (human ? 1.10 : .33);
        add(ear, side * width * (human ? .81 : .66), height * (human ? .06 : .58), -.10);
      }
    }
  }
  if (t.horns !== "none") {
    const horns = makeHorns(t.horns, 1, mats);
    for (const horn of [...horns.children]) {
      const near = v(Math.sign(horn.position.x) * width * .52, height * .5, -.08);
      horn.position.set(0, 0, 0);
      const mount = new Group(); mount.add(horn);
      mountSurface(skull, mount, near, v(0, 1, 0), .06);
    }
  }
  if (/medusa/i.test(ctx.spec.name)) for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const snake = chain(5, between(rng, 1.8, 2.5), .10, .045, mats.skin, 8);
    aim(snake.root, v(Math.cos(a) * .55, .85, Math.sin(a) * .30));
    const mount = new Group(); mount.name = "snake-hair-root"; mount.add(snake.root);
    mountSurface(skull, mount, v(Math.cos(a) * width * .45, height * .65, Math.sin(a) * depth * .40), UP, .05);
    snake.tip.add(place(ball(.13, mats.skin, 1, .65, 1.3, 12), 0, 0, -.045));
    for (const side of [-1, 1]) snake.tip.add(place(ball(.025, mats.eye, 1, .7, 1, 8), side * .095, .045, -.08));
    wave(ctx, snake, { yaw: .12, pitch: .11, speed: .9, lag: .65, phase: i });
  }
  return g;
}

// Pigmentation is part of the surface, not another layer of detached meshes.
// Vertex colours keep the distributable self-contained, including swarms.
export function detailSurfaces(ctx: Ctx): void {
  const { root, mats, spec } = ctx;
  root.updateMatrixWorld(true);
  const point = new Vector3(), color = new Color();
  root.traverse(o => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.geometry.hasAttribute("color")) return;
    const mat = mesh.material as MeshStandardMaterial;
    if (mat !== mats.skin && mat !== mats.belly && mat !== mats.metal && !mat.name.startsWith("anatomy-")) return;
    mat.vertexColors = true;
    mat.name ||= "anatomy-surface";
    const pos = mesh.geometry.getAttribute("position"), colors: number[] = [];
    const rate = spec.look === "scale" || spec.look === "chitin" ? 30 : spec.look === "fur" || spec.look === "feather" ? 19 : spec.look === "bark" ? 11 : 7;
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const { x, y, z } = point;
      const grain = Math.sin(x * rate + Math.sin(y * rate * .73)) * Math.sin(z * rate * .83 + y * rate * .37);
      const shade = .91 + grain * .09;
      color.setRGB(shade, shade, shade);
      colors.push(color.r, color.g, color.b);
    }
    mesh.geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  });
}

// ---------------------------------------------------------------------------
// wings

// Builds the pair of wings, pivoting at the shoulder blades. Returns the
// group; caller positions it on the back. `span` is one wing's length.
export function makeWings(ctx: Ctx, span: number, chord: number, kind: Traits["wings"], flap = 0.16, rest = 0.5): Group {
  const { mats } = ctx;
  const pair = new Group();
  const pivots: Array<{ pivot: Group; side: 1 | -1 }> = [];
  for (const side of [1, -1] as const) {
    const pivot = new Group();
    const wing = new Group();
    const bone = segment(new Vector3(0, 0, 0), new Vector3(span, 0, 0), chord * 0.11, chord * 0.05, mats.skin, 6);
    wing.add(bone);
    if (kind === "feather") {
      const n = 8;
      for (let i = 0; i < n; i += 1) {
        const k = i / (n - 1);
        const len = chord * (0.62 + Math.sin(k * Math.PI * 0.85) * 0.5);
        const f = ball(1, i % 2 ? mats.skin : mats.belly, span * 0.085, span * 0.02, len * 0.5, 6);
        const x = span * (0.14 + k * 0.84);
        f.position.set(x, 0, -len * 0.5);
        f.rotation.y = -0.05 - k * 0.22;
        wing.add(f);
      }
      const coverts = ball(1, mats.belly, span * 0.4, span * 0.03, chord * 0.32, 8);
      coverts.position.set(span * 0.4, span * 0.008, -chord * 0.12);
      wing.add(coverts);
    } else if (kind === "insect") {
      const blade = ball(1, mats.glow, span * 0.5, span * 0.006, chord * 0.55, 10);
      blade.material = new MeshStandardMaterial({ color: "#e8f4ff", transparent: true, opacity: 0.45, roughness: 0.1, side: DoubleSide, depthWrite: false });
      blade.position.set(span * 0.5, 0, -chord * 0.36);
      wing.add(blade);
      const vein = segment(new Vector3(span * 0.05, 0, -chord * 0.1), new Vector3(span * 0.95, 0, -chord * 0.62), chord * 0.02, chord * 0.012, mats.dark, 4);
      wing.add(vein);
    } else if (kind === "flame") {
      for (let i = 0; i < 5; i += 1) {
        const f = cone(chord * 0.18, span * (0.5 + 0.1 * Math.sin(i * 1.7)), mats.glow, 5);
        f.rotation.z = -Math.PI / 2;
        f.position.set(span * (0.3 + i * 0.13), 0, -chord * 0.1 * i);
        wing.add(f);
      }
    } else {
      // membrane: arm bone, 4 finger bones and a triangle-fan skin.
      const tips: Vector3[] = [];
      const fingers = 4;
      for (let i = 0; i < fingers; i += 1) {
        const a = -0.15 - i * 0.42;
        const len = span * (0.95 - i * 0.12);
        const tip = new Vector3(Math.cos(a * 0.7) * len * 0.5 + span * 0.42, 0, -Math.sin(-a) * len * 0.75 - chord * 0.08 * i);
        tips.push(tip);
        wing.add(segment(new Vector3(span * 0.55, 0, 0), tip, chord * 0.035, chord * 0.012, mats.skin, 4));
      }
      const verts: number[] = [];
      const origin = new Vector3(span * 0.55, 0, 0);
      const body = new Vector3(0, 0, -chord * 0.15);
      const outline = [new Vector3(span, 0, 0), ...tips, body];
      for (let i = 0; i < outline.length - 1; i += 1) {
        const a = outline[i]!;
        const b = outline[i + 1]!;
        verts.push(origin.x, origin.y, origin.z, a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      const skinMat = mats.belly.clone();
      skinMat.side = DoubleSide;
      const membrane = new Mesh(geo, skinMat);
      wing.add(membrane);
    }
    // fold: raise the tip and sweep back
    wing.rotation.y = 0.25;
    // Cup the wing toward the viewer so a folded pair reads as a V behind the back instead of a flat edge-on plank.
    wing.rotation.x = kind === "insect" ? 0.15 : 0.55;
    pivot.add(wing);
    pivot.scale.x = side;
    pair.add(pivot);
    pivots.push({ pivot, side });
  }
  tick(ctx, (t) => {
    const s = Math.sin(t * 1.5 + ctx.phase);
    // The mirrored pivot has scale.x = -1, so its Z rotation must be mirrored too.
    pivots.forEach(({ pivot, side }) => {
      pivot.rotation.z = side * (rest + s * flap);
    });
  });
  return pair;
}

// ---------------------------------------------------------------------------
// aura particles

const auraGeo = new OctahedronGeometry(1, 0);
const smokeGeo = new SphereGeometry(1, 7, 5);

export function addAura(ctx: Ctx, radius: number, height: number): void {
  const { spec, rng } = ctx;
  const kind = spec.traits.aura;
  if (kind === "none") return;
  const count = kind === "smoke" ? 8 : kind === "sparks" ? 10 : 14;
  const color = kind === "embers" ? "#ff8a2a" : kind === "frost" ? "#dff4ff" : kind === "smoke" ? "#3a3340"
    : kind === "sparks" ? "#ffe86a" : kind === "spores" ? "#b8f26a" : spec.palette.glow;
  const mat = kind === "smoke"
    ? new MeshStandardMaterial({ color, transparent: true, opacity: 0.35, roughness: 1, depthWrite: false })
    : new MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.9 });
  const g = new Group();
  const parts: Array<{ m: Mesh; a: number; s: number; r: number; p: number; size: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const size = kind === "smoke" ? between(rng, 0.06, 0.11) : between(rng, 0.014, 0.03);
    const m = new Mesh(kind === "smoke" ? smokeGeo : auraGeo, mat);
    parts.push({ m, a: rng() * Math.PI * 2, s: between(rng, 0.5, 1.2), r: radius * between(rng, 0.55, 1.15), p: rng(), size });
    g.add(m);
  }
  tick(ctx, (t) => {
    for (const q of parts) {
      const life = (t * 0.22 * q.s + q.p) % 1;
      const ang = q.a + t * (kind === "motes" ? 0.5 : kind === "sparks" ? 2.4 : 0.3) * q.s;
      let y: number;
      let fade: number;
      switch (kind) {
        case "frost": y = height * (1 - life); fade = Math.sin(life * Math.PI); break;
        case "motes": y = height * (0.15 + 0.75 * (0.5 + 0.5 * Math.sin(t * q.s + q.p * 6))); fade = 1; break;
        case "sparks": y = height * (0.1 + 0.8 * Math.abs(Math.sin(t * 3 * q.s + q.p * 9))); fade = Math.abs(Math.sin(t * 9 * q.s + q.p * 5)); break;
        default: y = height * (0.05 + 0.95 * life); fade = Math.sin(life * Math.PI); break;
      }
      const wob = kind === "sparks" ? 0.12 : 0.05;
      q.m.position.set(Math.cos(ang) * q.r + Math.sin(t * 2 + q.p * 8) * wob * radius, y, Math.sin(ang) * q.r);
      q.m.scale.setScalar(q.size * (kind === "smoke" ? 0.6 + life * 1.8 : 0.3 + fade));
    }
  });
  ctx.root.add(g);
}

// ---------------------------------------------------------------------------
// small utilities

export function mirrorPairs<T extends Object3D>(parent: Object3D, make: () => T, x: number, y: number, z: number): T[] {
  const out: T[] = [];
  for (const side of [1, -1] as const) {
    const o = make();
    o.position.set(x * side, y, z);
    if (side === -1) o.scale.x *= -1;
    parent.add(o);
    out.push(o);
  }
  return out;
}

export { between, chance, pick };
