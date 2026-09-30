// Shared building blocks for creature models: materials, primitive shortcuts,
// tapered limbs, wavy chains (tails, necks, tentacles), heads, horns, wings,
// and floating aura particles. Every plan builder is assembled from these.
//
// Conventions: Y is up, the creature faces +Z, its left/right are +/-X, feet
// (or belly) rest near y = 0. Everything is authored at "medium" size and
// scaled at the end by the size category.

import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  BoxGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Rng } from "./rng";
import { between, chance, pick } from "./rng";
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
  return {
    skin: std(palette.skin, lookProps),
    belly: std(palette.belly, lookProps),
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
        const outer = new Group();
        const a = spike(r * 1.0, r * 0.3, 0, mat, 2);
        a.rotation.z = -1.35 * side;
        outer.add(a);
        const b = spike(r * 1.3, r * 0.25, 0.9, mat, 3);
        b.position.set(-side * r * 0.95, r * 0.22, 0);
        b.rotation.z = -0.3 * side;
        outer.add(b);
        return outer;
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
        const beam = spike(r * 1.6, r * 0.14, -0.9, mat, 4);
        beam.rotation.z = -0.25 * side;
        beam.rotation.x = -0.3;
        a.add(beam);
        for (let i = 0; i < 3; i += 1) {
          const tine = spike(r * (0.55 - i * 0.08), r * 0.09, 0.4, mat, 2);
          tine.position.set(-side * r * 0.06, r * (0.45 + i * 0.32), -r * (0.06 + i * 0.16));
          tine.rotation.z = -0.5 * side;
          a.add(tine);
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
}

// Origin is the cranium centre; the face points along +Z.
export function makeHead(ctx: Ctx, opts: HeadOpts): Group {
  const { mats, t } = ctx;
  const { r } = opts;
  const style = opts.style ?? t.head;
  const snout = opts.snout ?? t.snout;
  const g = new Group();
  const eyeMat = mats.eye;
  const eyeR = r * (style === "insect" ? 0.3 : style === "frog" ? 0.3 : 0.16);
  const eye = () => ball(eyeR, eyeMat, 1, 1, 0.8, 8);

  switch (style) {
    case "skull": {
      const cranium = ball(r, mats.skin, 0.92, 1.02, 1.05);
      g.add(cranium);
      const jaw = box(r * 0.95, r * 0.34, r * 0.8, mats.skin);
      jaw.position.set(0, -r * 0.72, r * 0.3);
      g.add(jaw);
      addPair(g, () => {
        const socket = ball(r * 0.25, mats.dark, 1, 1.15, 0.7, 8);
        const lamp = ball(r * 0.11, mats.eye, 1, 1, 0.6, 6);
        lamp.position.z = r * 0.06;
        const grp = new Group();
        grp.add(socket, lamp);
        return grp;
      }, r * 0.36, r * 0.1, r * 0.84);
      const nose = cone(r * 0.12, r * 0.22, mats.dark, 3);
      nose.position.set(0, -r * 0.22, r * 0.98);
      nose.rotation.x = Math.PI;
      g.add(nose);
      const teeth = box(r * 0.8, r * 0.1, r * 0.06, mats.white);
      teeth.position.set(0, -r * 0.5, r * 0.72);
      g.add(teeth);
      break;
    }
    case "frog": {
      g.add(ball(r, mats.skin, 1.35, 0.7, 1.1));
      const mouth = box(r * 2.2, r * 0.06, r * 0.5, mats.dark);
      mouth.position.set(0, -r * 0.18, r * 0.62);
      g.add(mouth);
      addPair(g, () => {
        const eye = ball(r * 0.34, mats.skin, 1, 1, 1, 10);
        const pupil = ball(r * 0.18, eyeMat, 1, 1, 0.6, 8);
        pupil.position.set(0, 0, r * 0.26);
        const grp = new Group();
        grp.add(eye, pupil);
        return grp;
      }, r * 0.62, r * 0.55, r * 0.15);
      break;
    }
    case "bird": {
      g.add(ball(r, mats.skin, 0.85, 0.95, 1));
      const upper = cone(r * 0.32, r * 1.0, mats.accent, 6);
      upper.rotation.x = Math.PI / 2 + 0.12;
      upper.position.set(0, -r * 0.02, r * 1.28);
      const lower = cone(r * 0.24, r * 0.75, mats.accent, 6);
      lower.rotation.x = Math.PI / 2 - 0.05;
      lower.position.set(0, -r * 0.22, r * 1.15);
      g.add(upper, lower);
      addPair(g, eye, r * 0.62, r * 0.2, r * 0.5);
      break;
    }
    case "insect": {
      g.add(ball(r, mats.skin, 0.9, 0.85, 0.95, 10));
      addPair(g, () => ball(eyeR, eyeMat, 1, 1.15, 0.9, 8), r * 0.6, r * 0.2, r * 0.45);
      addPair(g, (side) => {
        const m = spike(r * 0.7, r * 0.12, 1.6, mats.accent, 3);
        m.rotation.x = Math.PI / 2;
        m.rotation.z = side * 0.4;
        return m;
      }, r * 0.22, -r * 0.4, r * 0.7);
      addPair(g, (side) => {
        const a = spike(r * 1.3, r * 0.05, 0.8, mats.accent, 3);
        a.rotation.x = -0.4;
        a.rotation.z = -0.35 * side;
        return a;
      }, r * 0.3, r * 0.6, r * 0.5);
      break;
    }
    case "fish": {
      g.add(ball(r, mats.skin, 0.85, 0.8, 1.35));
      const mouth = box(r * 1.1, r * 0.08, r * 0.8, mats.dark);
      mouth.position.set(0, -r * 0.22, r * 0.95);
      g.add(mouth);
      addPair(g, eye, r * 0.62, r * 0.25, r * 0.8);
      const crest = cone(r * 0.25, r * 0.9, mats.belly, 4);
      crest.rotation.x = -0.4;
      crest.position.set(0, r * 0.95, -r * 0.1);
      g.add(crest);
      break;
    }
    case "humanoid": {
      g.add(ball(r, mats.skin, 0.9, 1.05, 1));
      const nose = box(r * 0.16, r * 0.26, r * 0.28, mats.skin);
      nose.position.set(0, -r * 0.05, r * 0.96);
      g.add(nose);
      const brow = box(r * 1.15, r * 0.12, r * 0.3, mats.skin);
      brow.position.set(0, r * 0.3, r * 0.82);
      g.add(brow);
      const mouth = box(r * 0.5, r * 0.06, r * 0.1, mats.dark);
      mouth.position.set(0, -r * 0.42, r * 0.9);
      g.add(mouth);
      if (t.eyes === 1) {
        const e = ball(r * 0.3, mats.white, 1, 1, 0.7, 10);
        e.position.set(0, r * 0.12, r * 0.86);
        const pupil = ball(r * 0.16, eyeMat, 1, 1, 0.6, 8);
        pupil.position.set(0, r * 0.12, r * 1.02);
        g.add(e, pupil);
      } else {
        addPair(g, () => {
          const grp = new Group();
          const white = ball(r * 0.17, mats.white, 1, 0.85, 0.6, 8);
          const pupil = ball(r * 0.09, eyeMat, 1, 1, 0.6, 8);
          pupil.position.z = r * 0.06;
          grp.add(white, pupil);
          return grp;
        }, r * 0.36, r * 0.12, r * 0.86);
      }
      break;
    }
    default: {
      // "beast": cranium, muzzle, jaw, nose, eyes.
      g.add(ball(r, mats.skin, 0.95, 0.95, 1));
      const len = r * (0.5 + snout * 1.9);
      const muzzle = ball(r * 0.58, mats.skin, 0.8, 0.72, len / (r * 0.58) * 0.62, 10);
      muzzle.position.set(0, -r * 0.2, r * 0.55 + len * 0.42);
      g.add(muzzle);
      const nose = ball(r * 0.16, mats.dark, 1.2, 0.8, 0.9, 8);
      nose.position.set(0, -r * 0.06, r * 0.55 + len * 1.02);
      g.add(nose);
      const jaw = ball(r * 0.44, mats.belly, 0.85, 0.42, len / (r * 0.44) * 0.52, 8);
      jaw.position.set(0, -r * 0.5, r * 0.5 + len * 0.36);
      g.add(jaw);
      if (t.beak) {
        const beak = cone(r * 0.42, r * 0.95, mats.accent, 6);
        beak.rotation.x = Math.PI / 2 + 0.25;
        beak.position.set(0, -r * 0.18, r * 1.25);
        g.add(beak);
      }
      if (snout > 0.55 && !t.beak) {
        const teeth = box(r * 0.5, r * 0.06, len * 0.5, mats.white);
        teeth.position.set(0, -r * 0.38, r * 0.5 + len * 0.42);
        g.add(teeth);
      }
      if (t.eyes === 1) {
        const e = ball(r * 0.28, mats.white, 1, 1, 0.7, 10);
        e.position.set(0, r * 0.2, r * 0.82);
        const pupil = ball(r * 0.15, eyeMat, 1, 1, 0.6, 8);
        pupil.position.set(0, r * 0.2, r * 0.98);
        g.add(e, pupil);
      } else {
        addPair(g, eye, r * 0.5, r * 0.3, r * 0.68);
      }
      break;
    }
  }

  // tusks
  if (t.tusks) {
    addPair(g, (side) => {
      const tusk = spike(r * 0.75, r * 0.13, 1.3, mats.white, 3);
      tusk.rotation.z = side * 0.2;
      return tusk;
    }, r * 0.32, -r * 0.4, r * 0.75);
  }
  // ears
  if (t.ears !== "none" && style !== "skull" && style !== "bird" && style !== "fish" && style !== "insect") {
    const earR = r * (t.ears === "long" ? 0.3 : 0.24);
    addPair(g, (side) => {
      if (t.ears === "round") {
        const e = ball(earR * 1.2, mats.skin, 0.45, 1, 1, 8);
        e.rotation.z = -0.3 * side;
        return e;
      }
      const e = cone(earR, r * (t.ears === "long" ? 1.5 : 0.85), mats.skin, 5);
      e.scale.z = 0.35;
      e.rotation.z = -(t.ears === "long" ? 0.35 : 1.1) * side;
      return e;
    }, r * (t.ears === "round" ? 0.8 : 0.85), r * (t.ears === "round" ? 0.65 : 0.45), -r * 0.05);
  }
  // horns
  if (t.horns !== "none") {
    g.add(makeHorns(t.horns, r, mats));
  }
  return g;
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
        f.position.set(x, 0, -len * 0.5 - chord * 0.08);
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
