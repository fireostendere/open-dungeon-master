// Four-legged and long-bodied plans: mammals, reptiles, dinosaurs, hybrids
// (griffon, chimera, hydra), dragons, and taurs (a person on a beast body).
//
// One rig drives every plain quadruped; what makes a wolf a wolf and a horse
// a horse is the table of proportions below plus traits (snout, ears, horns,
// tusks, mane, tail, wings) and a few name-based accents (tiger stripes, a
// rhino's nose horn, a triceratops frill).

import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3, type BufferAttribute, type Material } from "three";
import { buildBiped } from "./biped";
import {
  UP, ball, box, cone, cyl, makeHead, makeWings, mountSurface, segment, spike, tick, torus,
  type Chain, type Ctx, type FaceFamily,
} from "./parts";
import type { Traits } from "./spec";

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

// ---------------------------------------------------------------------------
// helpers

// parts.chain draws a ball at every joint, which reads as ribbing on a neck.
// This one is joint-free: overlapping tapered cylinders, which look like one
// smooth tube as long as each joint bends only a little.
function chain(n: number, length: number, r0: number, r1: number, mat: Material, radial = 8): Chain {
  const root = new Group();
  const segs: Group[] = [];
  const seg = length / n;
  let parent: Group = root;
  for (let i = 0; i < n; i += 1) {
    const g = new Group();
    const ra = r0 + (r1 - r0) * (i / n);
    const rb = r0 + (r1 - r0) * ((i + 1) / n);
    const body = new Mesh(new CylinderGeometry(rb * 0.985, ra, seg * 1.2, radial, 1, true), mat);
    body.rotation.x = -Math.PI / 2;
    body.position.z = -seg / 2 - seg * 0.05;
    g.add(body);
    if (i === 0) {
      const cap = ball(ra, mat, 1, 1, 1, radial + 2);
      g.add(cap);
    }
    if (i > 0) g.position.z = -seg;
    parent.add(g);
    segs.push(g);
    parent = g;
  }
  const tip = new Group();
  tip.position.z = -seg;
  parent.add(tip);
  const end = ball(r1, mat, 1, 1, 1, radial + 2);
  tip.add(end);
  return { root, segs, tip };
}

function darker(mat: MeshStandardMaterial, k: number): MeshStandardMaterial {
  const m = mat.clone();
  m.color.multiplyScalar(k);
  return m;
}

// makeHead reads traits from ctx.t; borrow them for one call.
function withTraits<T>(ctx: Ctx, patch: Partial<Traits>, fn: () => T): T {
  const t = ctx.t as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) saved[k] = t[k];
  Object.assign(t, patch);
  try {
    return fn();
  } finally {
    Object.assign(t, saved);
  }
}

// Points a chain (which grows along local -Z) backward: yaw about +Y, elevation
// above the horizon. Euler order YXZ keeps local X horizontal, so bending a
// segment about X later is always a pitch in the chain's own vertical plane.
function aimBack(obj: Group, yaw: number, elev: number): void {
  obj.rotation.set(elev, yaw, 0, "YXZ");
}

interface SwayOpts {
  yaw?: number;
  pitch?: number;
  speed?: number;
  lag?: number;
  phase?: number;
  bias?: (i: number, n: number) => number;
}

// Like parts.wave, but with a static curve (bias) underneath the sway, so
// necks can arch and tails can hang.
function sway(ctx: Ctx, c: Chain, o: SwayOpts = {}): void {
  const { yaw = 0.1, pitch = 0.04, speed = 1.3, lag = 0.5, phase = ctx.phase, bias } = o;
  const n = c.segs.length;
  const base = c.segs.map((_, i) => (bias ? bias(i, n) : 0));
  tick(ctx, (t) => {
    c.segs.forEach((g, i) => {
      g.rotation.y = yaw * Math.sin(t * speed - i * lag + phase);
      g.rotation.x = base[i]! + pitch * Math.sin(t * speed * 0.8 - i * lag + phase + 1.3);
    });
  });
}

// A smooth tapered tube through a list of points: the skin of a neck or trunk.
function taperedTube(points: Vector3[], r0: number, r1: number, mat: Material, radial = 10, tubular = 22): Group {
  const g = new Group();
  const curve = new CatmullRomCurve3(points, false, "centripetal");
  const geo = new TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.attributes.position as BufferAttribute;
  const ring = radial + 1;
  const v = new Vector3();
  for (let i = 0; i <= tubular; i += 1) {
    const centre = curve.getPointAt(i / tubular);
    const r = r0 + (r1 - r0) * (i / tubular);
    for (let j = 0; j < ring; j += 1) {
      const idx = i * ring + j;
      v.set(pos.getX(idx), pos.getY(idx), pos.getZ(idx)).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  g.add(new Mesh(geo, mat));
  const start = ball(r0, mat, 1, 1, 1, radial + 2);
  start.position.copy(points[0]!);
  const end = ball(r1, mat, 1, 1, 1, radial + 2);
  end.position.copy(points[points.length - 1]!);
  g.add(start, end);
  return g;
}

// Centreline of an arched neck: the elevation eases from `elev` to `end`.
function archPoints(len: number, elev: number, end: number, yaw: number, n = 10): Vector3[] {
  const pts = [V(0, 0, 0)];
  const step = len / n;
  let p = V(0, 0, 0);
  for (let i = 0; i < n; i += 1) {
    const el = elev + (end - elev) * ((i + 0.5) / n);
    p = p.clone().add(V(Math.sin(yaw) * Math.cos(el) * step, Math.sin(el) * step, Math.cos(yaw) * Math.cos(el) * step));
    pts.push(p);
  }
  return pts;
}

function polyLimb(points: Vector3[], radii: number[], mat: Material, radial = 8): Group {
  const g = new Group();
  for (let i = 0; i < points.length - 1; i += 1) {
    g.add(segment(points[i]!, points[i + 1]!, radii[i]!, radii[i + 1]!, mat, radial));
    if (i > 0) {
      const j = ball(radii[i]! * 1.02, mat, 1, 1, 1, 8);
      j.position.copy(points[i]!);
      g.add(j);
    }
  }
  return g;
}

function nameOf(ctx: Ctx): string {
  return ctx.spec.name.toLowerCase();
}

// ---------------------------------------------------------------------------
// the rig

type Kind =
  | "canine" | "feline" | "heavy" | "hoofed" | "rodent" | "elephant" | "giraffe"
  | "sprawl" | "frog" | "turtle" | "dino" | "sauropod" | "plesio";

interface Rig {
  kind: Kind;
  L: number; bw: number; bh: number; leg: number; legR: number; y: number;
  headR: number; neckLen: number; neckElev: number; neckEnd: number; headPitch: number;
  tailLen: number; tailR: number; tailElev: number;
}

const PROPORTIONS: Record<Kind, Omit<Rig, "kind" | "y" | "tailElev">> = {
  canine: { L: 1.25, bw: 0.16, bh: 0.2, leg: 0.55, legR: 0.055, headR: 0.145, neckLen: 0.3, neckElev: 0.45, neckEnd: 0, headPitch: -0.05, tailLen: 0.7, tailR: 0.05 },
  feline: { L: 1.3, bw: 0.17, bh: 0.21, leg: 0.48, legR: 0.06, headR: 0.15, neckLen: 0.28, neckElev: 0.4, neckEnd: 0, headPitch: -0.08, tailLen: 0.9, tailR: 0.045 },
  heavy: { L: 1.25, bw: 0.27, bh: 0.32, leg: 0.5, legR: 0.095, headR: 0.17, neckLen: 0.25, neckElev: 0.3, neckEnd: -0.05, headPitch: -0.1, tailLen: 0.3, tailR: 0.06 },
  hoofed: { L: 1.45, bw: 0.2, bh: 0.27, leg: 0.85, legR: 0.055, headR: 0.17, neckLen: 0.7, neckElev: 1.0, neckEnd: 0.1, headPitch: -0.6, tailLen: 0.7, tailR: 0.05 },
  rodent: { L: 0.85, bw: 0.1, bh: 0.12, leg: 0.14, legR: 0.035, headR: 0.1, neckLen: 0.12, neckElev: 0.2, neckEnd: 0, headPitch: -0.05, tailLen: 0.7, tailR: 0.02 },
  elephant: { L: 1.8, bw: 0.4, bh: 0.5, leg: 0.95, legR: 0.17, headR: 0.28, neckLen: 0.3, neckElev: 0.15, neckEnd: -0.05, headPitch: 0, tailLen: 0.5, tailR: 0.04 },
  giraffe: { L: 1.3, bw: 0.17, bh: 0.25, leg: 1.35, legR: 0.05, headR: 0.1, neckLen: 1.6, neckElev: 1.2, neckEnd: 0.4, headPitch: -0.45, tailLen: 0.6, tailR: 0.03 },
  sprawl: { L: 1.4, bw: 0.15, bh: 0.14, leg: 0.16, legR: 0.045, headR: 0.12, neckLen: 0.2, neckElev: 0.05, neckEnd: 0, headPitch: -0.02, tailLen: 1.3, tailR: 0.13 },
  frog: { L: 0.75, bw: 0.22, bh: 0.2, leg: 0.12, legR: 0.05, headR: 0.2, neckLen: 0.05, neckElev: 0.1, neckEnd: 0.1, headPitch: 0.05, tailLen: 0, tailR: 0 },
  turtle: { L: 1.0, bw: 0.3, bh: 0.18, leg: 0.16, legR: 0.07, headR: 0.11, neckLen: 0.28, neckElev: 0.3, neckEnd: 0.1, headPitch: -0.05, tailLen: 0.2, tailR: 0.05 },
  dino: { L: 1.6, bw: 0.3, bh: 0.38, leg: 0.7, legR: 0.12, headR: 0.18, neckLen: 0.4, neckElev: 0.5, neckEnd: 0.1, headPitch: -0.1, tailLen: 1.4, tailR: 0.16 },
  sauropod: { L: 1.7, bw: 0.4, bh: 0.45, leg: 0.9, legR: 0.15, headR: 0.13, neckLen: 1.7, neckElev: 1.0, neckEnd: 0.55, headPitch: -0.3, tailLen: 2.0, tailR: 0.2 },
  plesio: { L: 1.5, bw: 0.3, bh: 0.28, leg: 0.12, legR: 0.05, headR: 0.11, neckLen: 1.3, neckElev: 0.9, neckEnd: 0.2, headPitch: -0.2, tailLen: 0.9, tailR: 0.1 },
};

const TAIL_ELEV: Record<Kind, number> = {
  canine: 0.25, feline: 0.05, heavy: 0, hoofed: -0.7, rodent: 0, elephant: -1.1, giraffe: -0.6,
  sprawl: -0.02, frog: 0, turtle: -0.1, dino: 0.05, sauropod: -0.02, plesio: -0.1,
};

function classify(ctx: Ctx): Kind {
  const { t } = ctx;
  const n = nameOf(ctx);
  if (t.head === "frog") return "frog";
  if (t.shell && /turtle|tortoise|terrapin|tortle/.test(n)) return "turtle";
  if (/plesiosaur/.test(n)) return "plesio";
  if (/brontosaurus|apatosaurus|brachiosaurus|diplodocus|sauropod/.test(n)) return "sauropod";
  if (t.trunk) return "elephant";
  if (/giraffe/.test(n)) return "giraffe";
  if (/lizard|crocodile|alligator|gator|iguana|gecko|komodo|monitor|basilisk|skink|caiman|chameleon|reptile|dimetrodon/.test(n)) return "sprawl";
  if (/\b(rat|rats|mouse|mice|squirrel|rabbit|hare|hamster|chipmunk|marmot|lemming|vole|shrew|gerbil|doppelrat)\b|weasel|ferret|stoat|mongoose|erina|marten|mole\b/.test(n)) return "rodent";
  if (ctx.spec.look === "scale" && !t.shell && t.bulk >= 1.2 && t.tail === "long") return "dino";
  if (t.hooves && t.longNeck) return "hoofed";
  if (/boar|hog|pig|warthog|bison|buffalo|yak|bull|\box\b|aurochs|gorgon/.test(n)) return "heavy";
  if (t.hooves) return "hoofed";
  if (t.bulk >= 1.2 || t.shell) return "heavy";
  return t.snout >= 0.6 ? "canine" : "feline";
}

function makeRig(ctx: Ctx): Rig {
  const kind = classify(ctx);
  const n = nameOf(ctx);
  const p = { ...PROPORTIONS[kind] };
  if (kind === "heavy" || kind === "elephant") {
    const s = Math.max(0.85, Math.min(1.2, ctx.t.bulk / 1.25));
    p.bw *= s; p.bh *= s; p.legR *= s;
  }
  if (/hippo/.test(n)) Object.assign(p, { leg: 0.32, bw: 0.38, bh: 0.38, headR: 0.28, neckLen: 0.15, L: 1.5, legR: 0.13 });
  else if (/rhino/.test(n)) Object.assign(p, { leg: 0.6, headR: 0.2, bw: 0.32, bh: 0.38, L: 1.6, legR: 0.12 });
  else if (/boar|hog|pig|warthog/.test(n)) Object.assign(p, { leg: 0.36, bw: 0.22, bh: 0.27, L: 1.1, headR: 0.15, legR: 0.06 });
  else if (/bulette|armadillo|dogmole|land shark/.test(n)) Object.assign(p, { leg: 0.3, bw: 0.3, bh: 0.28, L: 1.4, headR: 0.17 });
  if (ctx.t.longNeck && kind !== "hoofed" && kind !== "giraffe" && kind !== "sauropod" && kind !== "plesio") {
    p.neckLen = Math.max(p.neckLen, 0.6); p.neckElev = 0.9; p.neckEnd = 0.1;
  }
  if (/triceratops/.test(n)) Object.assign(p, { headR: 0.24, neckLen: 0.3, neckElev: 0.25, neckEnd: -0.1 });
  else if (/stegosaurus/.test(n)) Object.assign(p, { headR: 0.1, neckLen: 0.45, neckElev: 0.35, neckEnd: -0.2, leg: 0.6 });
  const y = p.leg + p.bh * 0.75;
  return { kind, ...p, y, tailElev: TAIL_ELEV[kind] };
}

// ---------------------------------------------------------------------------
// torso, legs, tail

function makeTorso(ctx: Ctx, rig: Rig, shortChest = false): Group {
  const { mats } = ctx;
  const { L, bw, bh } = rig;
  const g = new Group();
  g.position.y = rig.y;
  const mid = ball(1, mats.skin, bw, bh, L * 0.5, 14);
  mid.name = "torso-skin";
  const chest = ball(1, mats.skin, bw * 1.06, bh * 1.08, L * (shortChest ? 0.17 : 0.3), 14);
  chest.position.set(0, bh * 0.06, L * (shortChest ? 0.33 : 0.25));
  const hip = ball(1, mats.skin, bw * 1.02, bh * 1.02, L * 0.28, 14);
  hip.position.set(0, bh * 0.02, -L * 0.26);
  const belly = ball(1, mats.belly, bw * 0.92, bh * 0.62, L * 0.42, 12);
  belly.position.set(0, -bh * 0.42, 0);
  g.add(mid, chest, hip, belly);
  if (/bear|bull|bison|buffalo|yak|boar|hog|gorgon|hyena|owlbear/.test(nameOf(ctx))) {
    const hump = ball(1, mats.skin, bw * 0.95, bh * 0.75, L * 0.2, 12);
    hump.position.set(0, bh * 0.75, L * 0.22);
    g.add(hump);
  }
  return g;
}

function makeFoot(ctx: Ctx, rig: Rig, at: Vector3, r: number, front: boolean, hooves: boolean, claws: boolean): Group {
  const { mats, t } = ctx;
  const g = new Group();
  g.position.set(at.x, 0, at.z);
  const kind = rig.kind;
  const talon = t.beak && t.wings === "feather" && front;
  if (hooves && kind !== "frog") {
    const hoof = cyl(r * 0.85, r * 1.05, 0.07, mats.dark, 6);
    hoof.position.y = 0.035;
    g.add(hoof);
  } else if (kind === "elephant" || kind === "sauropod") {
    const pad = cyl(r * 1.05, r * 1.18, 0.09, mats.skin, 9);
    pad.position.y = 0.045;
    g.add(pad);
    for (let i = -1; i <= 1; i += 1) {
      const nail = ball(r * 0.22, mats.accent, 1, 0.7, 0.8, 6);
      nail.position.set(i * r * 0.5, 0.04, r * 1.05);
      g.add(nail);
    }
  } else if (kind === "frog") {
    const toe = ball(r * 1.0, mats.skin, front ? 1.0 : 1.4, 0.3, front ? 1.6 : 2.6, 8);
    toe.position.set(0, 0.02, front ? r * 1.2 : r * 2);
    g.add(toe);
  } else if (kind === "plesio") {
    const fl = ball(1, mats.skin, r * 2.4, 0.03, r * 4.2, 8);
    fl.position.set(0, 0.04, r * 2);
    g.add(fl);
  } else {
    const paw = ball(r * (talon ? 1.05 : 1.3), talon ? mats.accent : mats.skin, 1, 0.55, 1.55, 8);
    paw.position.set(0, 0.04, r * 0.9);
    g.add(paw);
    if (claws || talon) {
      for (let i = 0; i < 3; i += 1) {
        const c = cone(r * 0.2, r * (talon ? 1.7 : 1.0), mats.accent, 4);
        c.rotation.x = Math.PI / 2 + 0.35;
        c.position.set((i - 1) * r * 0.75, 0.035, r * 2.2);
        g.add(c);
      }
    }
  }
  return g;
}

function makeLegs(ctx: Ctx, rig: Rig, parent: Group, hooves: boolean): void {
  const { mats } = ctx;
  const { L, bw, bh, leg, legR, y, kind } = rig;
  const frontZ = L * 0.3;
  const backZ = -L * 0.3;
  const hy = y - bh * 0.3;
  const claws = !hooves && ctx.spec.look !== "chitin";
  const r = legR;
  for (const front of [true, false]) {
    for (const side of [1, -1] as const) {
      const z = front ? frontZ : backZ;
      const sx = side * bw * 0.72;
      let pts: Vector3[];
      let radii: number[];
      switch (kind) {
        case "elephant":
        case "sauropod":
          pts = [V(sx, hy, z), V(sx, leg * 0.5, z), V(sx * 1.02, 0.05, z)];
          radii = [r * 1.15, r * 1.0, r * 0.95];
          break;
        case "sprawl":
          pts = [V(side * bw * 0.8, hy, z), V(side * (bw + 0.22), leg * 0.9, z + (front ? 0.06 : -0.02)), V(side * (bw + 0.25), 0.03, z + (front ? 0.12 : 0.02))];
          radii = [r * 1.4, r * 1.0, r * 0.8];
          break;
        case "frog":
          if (front) {
            pts = [V(side * bw * 0.8, hy, z), V(side * bw * 1.1, leg * 0.5, z + 0.04), V(side * bw * 1.1, 0.03, z + 0.1)];
            radii = [r * 1.3, r * 1.0, r * 0.8];
          } else {
            pts = [V(side * bw * 0.85, y - bh * 0.2, z + 0.12), V(side * bw * 1.9, 0.2, z + 0.32), V(side * bw * 1.35, 0.03, z - 0.02)];
            radii = [r * 2.6, r * 1.4, r * 0.9];
          }
          break;
        case "turtle":
          pts = [V(sx * 1.05, hy, z), V(sx * 1.15, 0.02, z)];
          radii = [r * 1.2, r * 1.05];
          break;
        case "plesio":
          pts = [V(side * bw * 0.85, hy, z), V(side * (bw + 0.3), 0.06, z + (front ? 0.25 : -0.05))];
          radii = [r * 1.2, r * 0.6];
          break;
        default:
          if (front) {
            pts = [V(sx, hy, z), V(sx, hy * 0.52, z - 0.03), V(sx, 0.03, z + 0.02)];
            radii = [r * 1.35, r * 0.95, r * 0.8];
          } else {
            pts = [V(sx, hy, z), V(sx, hy * 0.5, z + 0.1 * (leg + 0.4)), V(sx, leg * 0.3, z - 0.07 * (leg + 0.4)), V(sx, 0.03, z - 0.03)];
            radii = [r * 1.75, r * 1.0, r * 0.75, r * 0.7];
          }
      }
      parent.add(polyLimb(pts, radii, mats.skin, kind === "sprawl" || kind === "frog" ? 6 : 8));
      const clawsHere = claws && kind !== "elephant" && kind !== "sauropod" && kind !== "plesio" && kind !== "frog";
      parent.add(makeFoot(ctx, rig, pts[pts.length - 1]!, r * (kind === "frog" ? 0.9 : 0.85), front, hooves, clawsHere));
    }
  }
}

function makeTail(ctx: Ctx, rig: Rig, parent: Group, override?: Traits["tail"]): void {
  const { mats, t } = ctx;
  const type = override ?? t.tail;
  if (type === "none" || rig.kind === "frog") return;
  const base = V(0, rig.y + rig.bh * 0.15, -rig.L * 0.48);
  const hair = darker(mats.skin, 0.55);
  if (type === "short") {
    const stub = chain(3, 0.22, rig.tailR * 1.4, rig.tailR * 0.5, mats.skin, 6);
    stub.root.position.copy(base);
    aimBack(stub.root, 0, rig.kind === "hoofed" ? -0.4 : 0.35);
    parent.add(stub.root);
    sway(ctx, stub, { yaw: 0.18, pitch: 0.06, speed: 1.6 });
    return;
  }
  if (type === "scorpion") {
    const c = chain(9, 1.0, 0.09, 0.02, mats.skin, 7);
    c.root.position.copy(base).add(V(0, 0.02, 0));
    aimBack(c.root, 0, 0.35);
    parent.add(c.root);
    const stinger = cone(0.045, 0.22, mats.accent, 5);
    stinger.rotation.x = -Math.PI / 2;
    stinger.position.z = -0.1;
    c.tip.add(stinger);
    const bulb = ball(0.075, mats.skin, 1, 1, 1.2, 8);
    bulb.position.z = -0.02;
    c.tip.add(bulb);
    sway(ctx, c, { yaw: 0.05, pitch: 0.035, speed: 1.1, bias: () => 0.24 });
    return;
  }
  const len = type === "fluffy" ? Math.max(0.55, rig.tailLen) : rig.tailLen;
  const segs = type === "fluffy" ? 6 : 8;
  const r1 = rig.kind === "sauropod" ? 0.02 : 0.014;
  const c = chain(segs, len, rig.tailR, r1, type === "fluffy" ? hair : mats.skin, 7);
  c.root.position.copy(base);
  aimBack(c.root, 0, rig.tailElev);
  parent.add(c.root);
  const bend = rig.kind === "hoofed" || rig.kind === "elephant" ? -0.05 : rig.kind === "canine" ? 0.04 : 0;
  sway(ctx, c, { yaw: rig.kind === "sprawl" || rig.kind === "dino" ? 0.14 : 0.2, pitch: 0.05, speed: 1.2, bias: () => bend });
  if (type === "fluffy") {
    const puff = ball(rig.tailR * 2.2, hair, 1, 1.4, 1.1, 8);
    puff.position.z = -0.05;
    c.tip.add(puff);
  } else if (type === "club") {
    const club = ball(rig.tailR * 2.4 + 0.05, mats.belly, 1, 0.8, 1.2, 8);
    club.position.z = -0.06;
    c.tip.add(club);
    for (let i = 0; i < 6; i += 1) {
      const s = cone(0.03, 0.1, mats.accent, 4);
      const a = (i / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.1, -0.06);
      s.rotation.z = a - Math.PI / 2;
      c.tip.add(s);
    }
  } else if (rig.kind === "canine" && /wolf|worg|warg|dog|hound/.test(nameOf(ctx))) {
    c.tip.add(ball(rig.tailR * 1.5, mats.belly, 1, 1, 1.4, 6));
  }
}

// ---------------------------------------------------------------------------
// necks and heads

interface HeadCfg {
  yaw: number; elev: number; len: number; end: number; r: number; pitch: number; phase: number;
  patch: Partial<Traits>;
  skin?: MeshStandardMaterial;
  ruff?: boolean;
  sway?: number;
  family?: FaceFamily;
}

function makeNeckHead(ctx: Ctx, parent: Group, base: Vector3, cfg: HeadCfg, rig: Rig): Group {
  const { t } = ctx;
  const n = nameOf(ctx);
  const mats = cfg.skin ? { ...ctx.mats, skin: cfg.skin } : ctx.mats;
  const r0 = Math.max(cfg.r * 0.95, Math.min(rig.bh * 0.75, cfg.r * 1.55));
  const r1 = cfg.r * 0.68;
  const neck = new Group();
  neck.position.copy(base);
  parent.add(neck);
  const pts = archPoints(cfg.len, cfg.elev, cfg.end, cfg.yaw);
  neck.add(taperedTube(pts, r0, r1, mats.skin));

  // Hybrid heads borrow traits (and a swapped skin) for the makeHead call.
  const patch: Partial<Traits> = { ...cfg.patch };
  if (/rhino|unicorn|ki-rin|kirin|buraq|triceratops/.test(n)) patch.horns = "none";
  if (t.trunk) { patch.tusks = false; patch.ears = "none"; }
  const saved = ctx.mats;
  ctx.mats = mats;
  const head = withTraits(ctx, patch, () => makeHead(ctx, { r: cfg.r, style: patch.head ?? t.head, snout: patch.snout ?? t.snout, family: cfg.family }));
  ctx.mats = saved;
  const dir = V(Math.sin(cfg.yaw) * Math.cos(cfg.end), Math.sin(cfg.end), Math.cos(cfg.yaw) * Math.cos(cfg.end));
  head.position.copy(pts[pts.length - 1]!).addScaledVector(dir, cfg.r * 0.35);
  const headPitch = -(cfg.end + cfg.pitch);
  head.rotation.set(headPitch, cfg.yaw, 0, "YXZ");
  neck.add(head);
  const s = cfg.sway ?? 1;
  tick(ctx, (time) => {
    neck.rotation.y = 0.07 * s * Math.sin(time * 0.9 + cfg.phase);
    neck.rotation.x = 0.03 * s * Math.sin(time * 0.72 + cfg.phase + 1.3);
    head.rotation.x = headPitch + 0.05 * Math.sin(time * 1.3 + cfg.phase + 0.6);
  });

  // Hair: a ruff for lions, a crest down the neck for horses.
  const maned = cfg.patch.mane ?? t.mane;
  if (cfg.ruff !== false && /\blion\b|manticore|sphinx|chimera/.test(n) && cfg.patch.horns !== "ram" && cfg.patch.horns !== "straight") {
    const ruff = ball(cfg.r * 1.55, darker(mats.skin, 0.5), 1.1, 1.05, 0.9, 12);
    ruff.position.set(0, -cfg.r * 0.05, -cfg.r * 0.55);
    head.add(ruff);
  } else if (maned && cfg.ruff !== false) {
    const hair = darker(mats.skin, 0.5);
    for (let i = 1; i < pts.length; i += 1) {
      const tangent = pts[i]!.clone().sub(pts[i - 1]!).normalize();
      const along = i / (pts.length - 1);
      const radius = r0 + (r1 - r0) * along;
      const outDir = V(0, 0.75, 0).addScaledVector(tangent, -0.65).normalize();
      const h = cfg.r * 0.95;
      const tuft = cone(cfg.r * 0.17, h, hair, 4);
      tuft.position.copy(pts[i]!).add(V(0, radius * 0.75, 0)).addScaledVector(outDir, h * 0.5);
      tuft.quaternion.setFromUnitVectors(UP, outDir);
      neck.add(tuft);
    }
    const forelock = cone(cfg.r * 0.2, cfg.r * 0.8, hair, 4);
    forelock.position.set(0, cfg.r * 0.9, cfg.r * 0.4);
    forelock.rotation.x = 0.7;
    head.add(forelock);
  }

  // Name-based head accents.
  if (/rhino/.test(n)) {
    const big = spike(cfg.r * 1.5, cfg.r * 0.3, -0.5, mats.accent, 3);
    big.position.set(0, cfg.r * 0.05, cfg.r * 1.55);
    big.rotation.x = 0.55;
    const small = spike(cfg.r * 0.8, cfg.r * 0.22, -0.3, mats.accent, 3);
    small.position.set(0, cfg.r * 0.4, cfg.r * 0.95);
    small.rotation.x = 0.3;
    head.add(big, small);
  }
  if (/unicorn|ki-rin|kirin|buraq/.test(n)) {
    const horn = spike(cfg.r * 2.3, cfg.r * 0.17, -0.1, mats.white, 4);
    horn.position.set(0, cfg.r * 0.8, cfg.r * 0.55);
    horn.rotation.x = 0.95;
    head.add(horn);
  }
  if (/triceratops/.test(n)) {
    const frill = ball(1, mats.skin, cfg.r * 1.9, cfg.r * 1.55, cfg.r * 0.14, 12);
    frill.position.set(0, cfg.r * 0.5, -cfg.r * 0.7);
    frill.rotation.x = -0.4;
    head.add(frill);
    for (let i = -4; i <= 4; i += 1) {
      const bump = cone(cfg.r * 0.13, cfg.r * 0.34, mats.accent, 4);
      const a = Math.PI / 2 + i * 0.32;
      bump.position.set(Math.cos(a) * cfg.r * 1.85, cfg.r * 0.25 + Math.sin(a) * cfg.r * 1.4, -cfg.r * 0.9);
      bump.rotation.z = a - Math.PI / 2;
      head.add(bump);
    }
    for (const side of [1, -1] as const) {
      const brow = spike(cfg.r * 2.8, cfg.r * 0.22, -0.4, mats.accent, 4);
      brow.position.set(side * cfg.r * 0.5, cfg.r * 0.6, cfg.r * 0.5);
      brow.rotation.x = 1.15;
      brow.rotation.z = -side * 0.12;
      head.add(brow);
    }
    const nose = spike(cfg.r * 0.9, cfg.r * 0.2, -0.3, mats.accent, 3);
    nose.position.set(0, cfg.r * 0.05, cfg.r * 1.55);
    nose.rotation.x = 0.5;
    head.add(nose);
  }
  if (t.trunk) {
    const trunk = new Group();
    trunk.position.set(0, -cfg.r * 0.2, cfg.r * 1.05);
    trunk.add(taperedTube(archPoints(cfg.r * 4.0, -1.25, -0.15, 0, 10), cfg.r * 0.34, cfg.r * 0.16, mats.skin, 9, 22));
    head.add(trunk);
    tick(ctx, (time) => {
      trunk.rotation.x = 0.07 * Math.sin(time * 1.0 + cfg.phase + 1);
      trunk.rotation.y = 0.08 * Math.sin(time * 0.8 + cfg.phase);
    });
    for (const side of [1, -1] as const) {
      const ear = ball(1, mats.skin, cfg.r * 0.16, cfg.r * 1.15, cfg.r * 0.95, 10);
      ear.position.set(side * cfg.r * 1.0, cfg.r * 0.25, -cfg.r * 0.2);
      ear.rotation.y = side * 0.55;
      head.add(ear);
      const tusk = spike(cfg.r * 2.4, cfg.r * 0.13, -1.2, mats.white, 5);
      tusk.position.set(side * cfg.r * 0.55, -cfg.r * 0.45, cfg.r * 0.95);
      tusk.rotation.x = 2.0;
      tusk.rotation.z = side * 0.12;
      head.add(tusk);
    }
  }
  if (/dilophosaurus/.test(n)) {
    for (const side of [1, -1] as const) {
      const crest = ball(1, mats.belly, cfg.r * 0.06, cfg.r * 0.5, cfg.r * 0.9, 8);
      crest.position.set(side * cfg.r * 0.2, cfg.r * 0.95, cfg.r * 0.2);
      head.add(crest);
    }
  }
  return head;
}

function headConfigs(ctx: Ctx, rig: Rig): HeadCfg[] {
  const { t } = ctx;
  const n = nameOf(ctx);
  const juv = t.juvenile ? 1.3 : 1;
  const one = (patch: Partial<Traits> = {}): HeadCfg => ({
    yaw: 0, elev: rig.neckElev, len: rig.neckLen, end: rig.neckEnd, r: rig.headR * juv, pitch: rig.headPitch, phase: ctx.phase, patch,
  });
  if (/hydra/.test(n)) {
    const count = 5;
    return Array.from({ length: count }, (_, i) => ({
      yaw: (i - (count - 1) / 2) * 0.5,
      elev: 1.0 + (i % 2) * 0.2,
      len: 1.15 + ((i * 37) % 5) * 0.1,
      end: 0.2,
      r: 0.14,
      pitch: -0.15,
      phase: ctx.phase + i * 1.3,
      sway: 1.6,
      ruff: false,
      patch: { horns: "none", mane: false, wings: "none", snout: 0.5, heads: 1, ears: "none", tusks: false },
    }));
  }
  if (/cerberus|orthrus/.test(n)) {
    const count = /orthrus/.test(n) ? 2 : 3;
    return Array.from({ length: count }, (_, i) => ({
      yaw: (i - (count - 1) / 2) * 0.55,
      elev: 0.55,
      len: 0.4,
      end: 0,
      r: 0.13,
      pitch: -0.05,
      phase: ctx.phase + i * 1.1,
      ruff: false,
      patch: { horns: "none", mane: false, wings: "none", snout: 0.7, ears: "pointy", heads: 1 },
    }));
  }
  if (/chimera/.test(n)) {
    return [
      { ...one({ horns: "none", snout: 0.25, ears: "round", beak: false, mane: false, heads: 1 }), family: "feline", yaw: 0, elev: 0.5, len: 0.35, end: 0.05, r: 0.15 },
      { ...one({ horns: "ram", snout: 0.45, ears: "pointy", beak: false, mane: false, heads: 1 }), family: "caprine", yaw: 0.75, elev: 0.75, len: 0.55, end: 0.1, r: 0.12, phase: ctx.phase + 1.4, ruff: false },
      { ...one({ horns: "straight", snout: 0.55, ears: "none", beak: false, mane: false, heads: 1 }), family: "draconic", yaw: -0.65, elev: 0.85, len: 0.9, end: 0.1, r: 0.12, phase: ctx.phase + 2.6, ruff: false, skin: darker(ctx.mats.skin, 0.85) },
    ];
  }
  if (t.heads > 1) {
    const count = Math.min(t.heads, 3);
    return Array.from({ length: count }, (_, i) => ({
      ...one({ heads: 1 }),
      yaw: (i - (count - 1) / 2) * 0.5,
      len: rig.neckLen + 0.15,
      phase: ctx.phase + i * 1.5,
    }));
  }
  return [one({ heads: 1 })];
}

function neckBase(rig: Rig): Vector3 {
  switch (rig.kind) {
    case "elephant": return V(0, rig.y + rig.bh * 0.3, rig.L * 0.42);
    case "frog": return V(0, rig.y + 0.02, rig.L * 0.42);
    case "turtle": return V(0, rig.y + rig.bh * 0.1, rig.L * 0.46);
    case "sprawl": return V(0, rig.y + rig.bh * 0.15, rig.L * 0.46);
    default: return V(0, rig.y + rig.bh * 0.5, rig.L * 0.38);
  }
}

// ---------------------------------------------------------------------------
// accents

function addPlates(ctx: Ctx, parent: Group, rig: Rig): void {
  const skin = parent.getObjectByName("torso-skin") as Mesh;
  for (let i = 0; i < 8; i += 1) {
    const k = i / 7;
    const h = 0.12 + 0.3 * Math.sin(Math.PI * (0.1 + k * 0.8));
    const plate = cone(0.11, h, ctx.mats.belly, 4);
    plate.scale.z = 0.2;
    plate.rotation.y = Math.PI / 4;
    plate.geometry.translate(0, h * .44, 0);
    plate.name = "dorsal-plate";
    mountSurface(skin, plate, V(i % 2 ? .05 : -.05, 0, rig.L * .36 - k * rig.L * .78), UP, .012);
  }
}

function addSail(ctx: Ctx, parent: Group, rig: Rig): void {
  const skin = parent.getObjectByName("torso-skin") as Mesh;
  for (let i = 0; i < 9; i += 1) {
    const k = i / 8;
    const h = 0.18 + 0.45 * Math.sin(Math.PI * (0.08 + k * 0.84));
    const fin = ball(1, ctx.mats.belly, 0.012, h * 0.5, rig.L * 0.045, 6);
    fin.geometry.translate(0, .85, 0);
    fin.name = "sail-root";
    mountSurface(skin, fin, V(0, 0, rig.L * .36 - k * rig.L * .72), UP, .015);
  }
}

function addRidge(parent: Group, rig: Rig, count: number, h: number, mat: Material): void {
  const skin = parent.getObjectByName("torso-skin") as Mesh;
  for (let i = 0; i < count; i += 1) {
    const k = i / Math.max(1, count - 1);
    const length = h * (1 - Math.abs(k - .4) * .5);
    const c = cone(h * .32, length, mat, 4);
    c.geometry.translate(0, length * .44, 0);
    c.name = "dorsal-spike";
    mountSurface(skin, c, V(0, 0, rig.L * .36 - k * rig.L * .72), UP, .01);
  }
}

function addShell(ctx: Ctx, rig: Rig, parent: Group): void {
  const { mats } = ctx;
  const turtle = rig.kind === "turtle";
  const mat = turtle ? darker(mats.skin, 0.72) : mats.skin;
  const dome = new Mesh(new SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  const domeH = rig.bh * (turtle ? 2.2 : 1.5);
  dome.scale.set(rig.bw * 1.3, domeH, rig.L * 0.53);
  dome.position.set(0, rig.y + rig.bh * 0.05, 0);
  parent.add(dome);
  const ridges = turtle ? 5 : 7;
  for (let i = 0; i < ridges; i += 1) {
    const k = i / (ridges - 1);
    const plate = ball(1, turtle ? mats.belly : mats.accent, rig.bw * (turtle ? 0.35 : 0.22), rig.bh * (turtle ? 0.28 : 0.3), rig.L * 0.07, 6);
    plate.name = "shell-scute";
    mountSurface(dome, plate, V(0, 0, (.5 - k) * rig.L * .98), UP, .008);
  }
}

function addStripes(ctx: Ctx, rig: Rig, torso: Group): void {
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const arc = Math.PI * 1.15;
    const ring = torus(1, 0.018, ctx.mats.dark, arc, 4, 14);
    ring.scale.set(rig.bw * 1.03, rig.bh * 1.03, 1);
    ring.rotation.z = Math.PI / 2 - arc / 2;
    ring.position.set(0, 0, rig.L * (0.38 - (i / (n - 1)) * 0.78));
    torso.add(ring);
  }
}

function addWingsTo(ctx: Ctx, parent: Group, x: number, y: number, z: number, span: number, chord: number, flap = 0.18, rest = 0.55): void {
  const wings = makeWings(ctx, span, chord, ctx.t.wings, flap, rest);
  wings.position.set(0, y, z);
  wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * x; });
  parent.add(wings);
}

function breathe(ctx: Ctx, torso: Group, amount = 0.02): void {
  tick(ctx, (t) => {
    const b = Math.sin(t * 1.6 + ctx.phase);
    torso.scale.y = 1 + amount * b;
    torso.scale.x = 1 - amount * 0.4 * b;
  });
}

// ---------------------------------------------------------------------------
// quadruped

export function buildQuadruped(ctx: Ctx): void {
  const { t, mats } = ctx;
  const rig = makeRig(ctx);
  const n = nameOf(ctx);
  const body = new Group();
  ctx.root.add(body);

  const torso = makeTorso(ctx, rig);
  body.add(torso);
  breathe(ctx, torso, rig.kind === "frog" ? 0.05 : 0.02);
  makeLegs(ctx, rig, body, t.hooves);
  if (t.shell) addShell(ctx, rig, body);
  makeTail(ctx, rig, body);

  const base = neckBase(rig);
  for (const cfg of headConfigs(ctx, rig)) makeNeckHead(ctx, body, base, cfg, rig);

  if (t.wings !== "none" && !/hydra|cerberus/.test(n)) {
    const span = /griffon|griffin|gryphon|hippogriff|peryton|pegasus/.test(n) ? 1.0 : 0.95;
    addWingsTo(ctx, body, rig.bw * 0.55, rig.y + rig.bh * 0.85, rig.L * 0.12, span, span * 0.55, 0.2, 0.5);
  }
  if (t.plates || /stegosaurus/.test(n)) addPlates(ctx, torso, rig);
  else if (t.spikes) addRidge(torso, rig, 9, 0.1, mats.accent);
  if (/dimetrodon|spinosaurus/.test(n)) addSail(ctx, torso, rig);
  if (/tiger|zebra/.test(n)) addStripes(ctx, rig, torso);
  if (rig.kind === "frog") {
    const throat = ball(rig.headR * 0.8, mats.belly, 1.1, 0.8, 1, 10);
    throat.position.set(0, rig.y - rig.bh * 0.15, rig.L * 0.5);
    body.add(throat);
    tick(ctx, (time) => { throat.scale.setScalar(1 + 0.18 * Math.max(0, Math.sin(time * 2.2 + ctx.phase))); });
  }
}

// ---------------------------------------------------------------------------
// theropod

export function buildTheropod(ctx: Ctx): void {
  const { mats } = ctx;
  const n = nameOf(ctx);
  const raptor = /raptor|compsognathus|deinonychus|dilophosaurus/.test(n);
  const s = raptor ? 0.72 : 1;
  const hipY = 0.95 * (raptor ? 0.82 : 1);
  const body = new Group();
  ctx.root.add(body);

  const torso = new Group();
  torso.position.set(0, hipY + 0.14 * s, 0.05);
  torso.rotation.x = -0.05;
  const mid = ball(1, mats.skin, 0.34 * s, 0.4 * s, 0.82 * s, 14);
  mid.name = "torso-skin";
  const chest = ball(1, mats.skin, 0.27 * s, 0.32 * s, 0.32 * s, 12);
  chest.position.set(0, 0.03, 0.5 * s);
  const belly = ball(1, mats.belly, 0.25 * s, 0.22 * s, 0.6 * s, 10);
  belly.position.set(0, -0.2 * s, 0.04);
  torso.add(mid, chest, belly);
  body.add(torso);
  breathe(ctx, torso, 0.025);

  // Legs: thigh forward, shin back, foot forward, three toes.
  for (const side of [1, -1] as const) {
    const x = 0.26 * s * (raptor ? 0.9 : 1);
    const pts = [V(x * side, hipY, -0.04), V(x * 1.15 * side, hipY * 0.56, 0.3 * s), V(x * 1.1 * side, 0.3 * s, -0.12 * s), V(x * 1.05 * side, 0.04, 0.06 * s)];
    body.add(polyLimb(pts, [0.19 * s, 0.125 * s, 0.075 * s, 0.06 * s], mats.skin, 8));
    const foot = new Group();
    foot.position.set(x * 1.05 * side, 0, 0.06 * s);
    for (let i = -1; i <= 1; i += 1) {
      const toe = segment(V(0, 0.045, 0), V(i * 0.09 * s, 0.03, 0.26 * s), 0.038 * s, 0.03 * s, mats.skin, 5);
      const claw = cone(0.03 * s, 0.09 * s, mats.accent, 4);
      claw.rotation.x = Math.PI / 2 + 0.3;
      claw.position.set(i * 0.09 * s, 0.03, 0.31 * s);
      foot.add(toe, claw);
    }
    if (raptor) {
      const sickle = cone(0.035 * s, 0.2 * s, mats.accent, 5);
      sickle.position.set(0.06 * s * side, 0.12 * s, 0.03 * s);
      sickle.rotation.x = -0.6;
      foot.add(sickle);
    }
    body.add(foot);
  }

  // Tiny arms (longer, held forward, on raptors).
  const armK = raptor ? 1.7 : 1;
  for (const side of [1, -1] as const) {
    const pts = [V(0.22 * s * side, hipY + 0.18 * s, 0.5 * s), V(0.27 * s * side, hipY + 0.05 * s, 0.56 * s + 0.03 * armK), V(0.24 * s * side, hipY + 0.02 * s, 0.7 * s + 0.08 * armK)];
    body.add(polyLimb(pts, [0.045 * s, 0.033 * s, 0.028 * s], mats.skin, 6));
    for (const dx of [-0.015, 0.015]) {
      const claw = cone(0.012 * s, 0.07 * s * armK, mats.accent, 4);
      claw.rotation.x = Math.PI / 2 + 0.5;
      claw.position.set(pts[2]!.x + dx, pts[2]!.y - 0.01, pts[2]!.z + 0.05);
      body.add(claw);
    }
  }

  // Neck and big head.
  const cfg: HeadCfg = {
    yaw: 0, elev: 0.75, len: 0.42 * s + 0.05, end: 0.05, r: raptor ? 0.16 : 0.29, pitch: -0.1, phase: ctx.phase,
    patch: { snout: /spinosaurus/.test(n) ? 0.98 : 0.85, ears: "none", horns: "none", tusks: false, head: "beast" },
  };
  const rig: Rig = {
    kind: "dino", L: 1.5 * s, bw: 0.3 * s, bh: 0.36 * s, leg: hipY, legR: 0.1, y: hipY + 0.14,
    headR: cfg.r, neckLen: cfg.len, neckElev: cfg.elev, neckEnd: cfg.end, headPitch: cfg.pitch, tailLen: 1.4, tailR: 0.16, tailElev: 0,
  };
  makeNeckHead(ctx, body, V(0, hipY + 0.28 * s, 0.6 * s), cfg, rig);

  // Heavy tail as a counterweight.
  const tail = chain(9, 1.55 * s + 0.2, 0.2 * s, 0.018, mats.skin, 8);
  tail.root.position.set(0, hipY + 0.1 * s, -0.55 * s);
  aimBack(tail.root, 0, 0.03);
  body.add(tail.root);
  sway(ctx, tail, { yaw: 0.11, pitch: 0.025, speed: 1.05, lag: 0.45 });

  if (/spinosaurus/.test(n)) {
    addSail(ctx, torso, rig);
  }
  if (raptor && !/dilophosaurus/.test(n)) {
    // A hint of feathers: a fringe on the tail tip.
    const fringe = ball(1, mats.belly, 0.05, 0.05, 0.16, 6);
    fringe.position.set(0, 0, -0.08);
    tail.tip.add(fringe);
  }
}

// ---------------------------------------------------------------------------
// dragon

export function buildDragon(ctx: Ctx): void {
  const { t, mats } = ctx;
  const juv = t.juvenile;
  const twoLegs = t.legs === 2;
  const turtle = t.shell;
  const L = 1.6;
  const bw = 0.38;
  const bh = 0.38;
  const leg = turtle ? 0.14 : twoLegs ? 0.75 : 0.48;
  const y = leg + bh * 0.75;
  const rig: Rig = {
    kind: "dino", L, bw, bh, leg, legR: 0.13, y, headR: juv ? 0.28 : 0.235,
    neckLen: turtle ? 0.55 : juv ? 0.75 : 1.3, neckElev: turtle ? 0.5 : 1.0, neckEnd: turtle ? 0.1 : 0.25, headPitch: -0.15,
    tailLen: turtle ? 0.6 : 2.1, tailR: 0.27, tailElev: -0.02,
  };
  const body = new Group();
  ctx.root.add(body);
  // A wyvern balances on its hind legs: tilt the whole upper body up around the hips.
  const holder = new Group();
  if (twoLegs) {
    const pivot = new Group();
    pivot.position.set(0, leg + 0.05, -0.15);
    pivot.rotation.x = -0.42;
    body.add(pivot);
    holder.position.set(0, -(leg + 0.05), 0.15);
    pivot.add(holder);
  } else {
    body.add(holder);
  }

  const torso = makeTorso(ctx, rig);
  holder.add(torso);
  breathe(ctx, torso, 0.022);

  if (turtle) {
    for (const front of [true, false]) {
      for (const side of [1, -1] as const) {
        const fl = ball(1, mats.skin, 0.36, 0.05, 0.15, 10);
        fl.position.set(side * (bw + 0.28), y - bh * 0.3, front ? L * 0.28 : -L * 0.3);
        fl.rotation.z = -side * 0.4;
        fl.rotation.y = side * (front ? -0.5 : 0.5);
        body.add(fl);
      }
    }
    addShell(ctx, { ...rig, kind: "heavy" }, body);
  } else if (twoLegs) {
    for (const side of [1, -1] as const) {
      const pts = [V(side * bw * 0.7, leg + 0.05, 0), V(side * bw * 0.75, leg * 0.5, 0.18), V(side * bw * 0.72, leg * 0.3, -0.12), V(side * bw * 0.72, 0.03, 0)];
      body.add(polyLimb(pts, [0.16, 0.1, 0.07, 0.06], mats.skin, 8));
      body.add(makeFoot(ctx, rig, pts[3]!, 0.07, false, false, true));
    }
  } else {
    for (const front of [true, false]) {
      for (const side of [1, -1] as const) {
        const z = front ? L * 0.3 : -L * 0.3;
        const sx = side * bw * 0.78;
        const pts = front
          ? [V(sx, y - bh * 0.3, z), V(sx * 1.3, leg * 0.55, z - 0.06), V(sx * 1.15, 0.04, z + 0.08)]
          : [V(sx, y - bh * 0.2, z), V(sx * 1.35, leg * 0.55, z + 0.12), V(sx * 1.1, 0.04, z - 0.04)];
        body.add(polyLimb(pts, front ? [0.15, 0.1, 0.075] : [0.2, 0.115, 0.08], mats.skin, 8));
        body.add(makeFoot(ctx, rig, pts[2]!, 0.075, front, false, true));
      }
    }
  }

  // Neck and head. Horns are a dragon's signature, so grant a pair if missing.
  const cfg: HeadCfg = {
    yaw: 0, elev: rig.neckElev, len: rig.neckLen, end: rig.neckEnd, r: rig.headR, pitch: rig.headPitch, phase: ctx.phase,
    patch: { horns: turtle ? "none" : t.horns === "none" ? "curved" : t.horns, snout: juv ? 0.4 : 0.62, ears: "none", beak: false, tusks: false, mane: false, head: "beast" },
    ruff: false, sway: 1.3,
  };
  const head = makeNeckHead(ctx, holder, V(0, y + bh * 0.4, L * 0.4), cfg, rig);
  for (const side of [1, -1] as const) {
    const frill = spike(rig.headR * 1.5, rig.headR * 0.22, 0.3, mats.accent, 3);
    frill.position.set(side * rig.headR * 0.7, -rig.headR * 0.1, -rig.headR * 0.5);
    frill.rotation.set(-Math.PI / 2 - 0.15, 0, side * 0.5);
    head.add(frill);
    if (turtle) {
      const tusk = spike(rig.headR * 1.1, rig.headR * 0.16, -0.5, mats.white, 3);
      tusk.position.set(side * rig.headR * 0.4, -rig.headR * 0.35, rig.headR * 1.3);
      tusk.rotation.x = 1.5;
      head.add(tusk);
    }
  }
  if (t.frill && !turtle) {
    const fan = ball(1, mats.belly, rig.headR * 1.6, rig.headR * 1.3, rig.headR * 0.1, 10);
    fan.position.set(0, rig.headR * 0.2, -rig.headR * 0.8);
    fan.rotation.x = -0.2;
    head.add(fan);
  }

  // Tail.
  const tail = chain(10, rig.tailLen, rig.tailR, 0.016, mats.skin, 8);
  tail.root.position.set(0, y + bh * 0.05, -L * 0.48);
  aimBack(tail.root, 0, twoLegs ? -0.25 : -0.02);
  holder.add(tail.root);
  sway(ctx, tail, { yaw: 0.12, pitch: 0.03, speed: 1.0, lag: 0.42 });
  if (t.tail === "scorpion") {
    const stinger = cone(0.06, 0.28, mats.accent, 5);
    stinger.rotation.x = -Math.PI / 2;
    stinger.position.z = -0.14;
    tail.tip.add(stinger);
  } else if (!turtle) {
    const blade = cone(0.09, 0.3, mats.accent, 4);
    blade.scale.x = 0.4;
    blade.rotation.x = -Math.PI / 2;
    blade.position.z = -0.14;
    tail.tip.add(blade);
  }

  // Ridge along the back and down the tail.
  if (!turtle && (t.spikes || !juv)) {
    addRidge(torso, rig, 9, .19, mats.accent);
    tail.segs.forEach((g, i) => {
      if (i < 1 || i > 7) return;
      const h = .16 * (1 - i / 11);
      const c = cone(.045 * (1 - i / 11), h, mats.accent, 4);
      c.geometry.translate(0, h * .44, 0);
      c.name = "tail-spike";
      mountSurface(g.children[0] as Mesh, c, V(0, 0, -rig.tailLen / 10 / 2), UP, .008);
    });
  }

  if (t.wings !== "none") {
    const span = juv ? 1.05 : 1.75;
    addWingsTo(ctx, holder, bw * 0.6, y + bh * 0.85, L * 0.14, span, span * 0.55, 0.2, 0.62);
  }
}

// ---------------------------------------------------------------------------
// taur: a humanoid torso growing out of a beast body

function spiderLegs(ctx: Ctx, at: Vector3, radius: number, parent: Group): void {
  for (let i = 0; i < 8; i += 1) {
    const side = i < 4 ? 1 : -1;
    const k = i % 4;
    const reach = radius * 2.8;
    const hip = at.clone().add(V(side * radius * 0.35, 0, (1.5 - k) * radius * 0.35));
    const dz = (1.5 - k) * reach * 0.42;
    const dx = side * reach * (0.6 + (k === 1 || k === 2 ? 0.1 : 0));
    const knee = hip.clone().add(V(dx * 0.55, radius * 1.35, dz * 0.45));
    const foot = hip.clone().add(V(dx * 1.0, -hip.y + 0.02, dz * 1.1));
    parent.add(polyLimb([hip, knee, foot], [radius * 0.14, radius * 0.1, radius * 0.045], ctx.mats.skin, 6));
  }
}

export function buildTaur(ctx: Ctx): void {
  const { t, mats } = ctx;
  const lower = t.lower;
  const before = ctx.root.children.length;
  const { hipY } = buildBiped(ctx, { noLegs: true });
  const upperBody = ctx.root.children[before] as Group;
  const lowerG = new Group();
  ctx.root.add(lowerG);

  if (lower === "snake") {
    // Coiled tail: down from the waist, then a flat spiral along the ground.
    const segs = 14;
    const c = chain(segs, 3.6, 0.24, 0.03, mats.skin, 9);
    c.root.position.set(0, 0.78, -0.02);
    aimBack(c.root, 0, -1.05);
    lowerG.add(c.root);
    const pitchBase = c.segs.map((_, i) => (i === 0 ? 0.25 : i < 4 ? 0.3 : i < 6 ? -0.05 : 0));
    const yawBase = c.segs.map((_, i) => (i < 4 ? 0 : 0.4 + (i / segs) * 0.08));
    tick(ctx, (time) => {
      c.segs.forEach((g, i) => {
        g.rotation.x = pitchBase[i]! + 0.02 * Math.sin(time * 1.2 - i * 0.5 + ctx.phase);
        g.rotation.y = yawBase[i]! + 0.05 * Math.sin(time * 1.1 - i * 0.6 + ctx.phase);
      });
    });
    upperBody.position.set(0, 0.78 - hipY + 0.04, 0.02);
    // A hood behind the head, the cobra way.
    const hood = ball(1, mats.belly, 0.24, 0.24, 0.03, 12);
    hood.position.set(0, 0.78 + 0.62 + 0.12, -0.05);
    lowerG.add(hood);
    return;
  }

  if (lower === "spider") {
    const radius = 0.3;
    const thorax = ball(radius, mats.skin, 1.1, 0.85, 1.4, 12);
    thorax.position.set(0, 0.62, 0.05);
    const abdomen = ball(radius * 1.6, mats.skin, 1, 0.9, 1.5, 12);
    abdomen.position.set(0, 0.62, -0.7);
    lowerG.add(thorax, abdomen);
    spiderLegs(ctx, V(0, 0.62, 0.05), radius * 1.6, lowerG);
    upperBody.position.set(0, 0.62 + 0.15 - hipY + 0.02, 0.28);
    tick(ctx, (time) => { abdomen.scale.y = 0.9 + 0.03 * Math.sin(time * 1.6 + ctx.phase); });
    return;
  }

  // Horse or lion: a plain quadruped body behind the person.
  const kind: Kind = lower === "lion" ? "feline" : "hoofed";
  const p = { ...PROPORTIONS[kind] };
  if (kind === "hoofed") Object.assign(p, { L: 1.5, bw: 0.24, bh: 0.29, leg: 0.8, legR: 0.055 });
  else Object.assign(p, { L: 1.35, bw: 0.22, bh: 0.24, leg: 0.5, legR: 0.06 });
  const rig: Rig = { kind, ...p, y: p.leg + p.bh * 0.75, tailElev: TAIL_ELEV[kind] };
  const torso = makeTorso(ctx, rig, true);
  lowerG.add(torso);
  breathe(ctx, torso, 0.015);
  makeLegs(ctx, rig, lowerG, kind === "hoofed");
  makeTail(ctx, rig, lowerG, kind === "hoofed" ? "fluffy" : "long");
  const topY = rig.y + rig.bh * 0.92;
  upperBody.position.set(0, topY - hipY, rig.L * 0.34);
  if (kind === "hoofed") {
    const blanket = box(rig.bw * 2.1, 0.03, 0.4, mats.cloth);
    blanket.position.set(0, rig.y + rig.bh * 0.95, 0.0);
    lowerG.add(blanket);
  } else {
    // Lamia: a lion's ruff where person and cat meet.
    const ruff = ball(rig.bw * 1.1, darker(mats.skin, 0.55), 1.1, 0.9, 0.9, 10);
    ruff.position.set(0, topY - 0.05, rig.L * 0.36);
    lowerG.add(ruff);
  }
}
