// Creatures that are not built like a person or a horse: birds and bats,
// insects, spiders and crabs, fish and whales, snakes and worms, and swarms.
// Each builder assembles one body plan from the shared parts and registers
// its idle animation; build.ts grounds, centres and scales the result.

import {
  BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group,
  InstancedMesh, Mesh, MeshStandardMaterial, Object3D, OctahedronGeometry, Quaternion, Shape, ShapeGeometry,
  SphereGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  aim, ball, box, chain, cone, cyl, limb, makeHead, makeWings, mountSurface, segment, spike, tick, torus, wave,
  type Ctx, type Chain,
} from "./parts";
import { between, chance } from "./rng";

// ---------------------------------------------------------------------------
// local helpers

const X_AXIS = new Vector3(1, 0, 0);

function stdMat(color: string, extra: Record<string, unknown> = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.7, ...extra });
}

// A flat polygon in the XY plane (fan-triangulated from the first point):
// fins, membranes, flat wings.
function flatShape(points: Array<[number, number]>, mat: MeshStandardMaterial): Mesh {
  const verts: number[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    verts.push(points[0]![0], points[0]![1], 0, points[i]![0], points[i]![1], 0, points[i + 1]![0], points[i + 1]![1], 0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const m = mat.clone();
  m.side = DoubleSide;
  m.flatShading = false;
  return new Mesh(geo, m);
}

function nameOf(ctx: Ctx): string {
  return ctx.spec.name.toLowerCase();
}

// A chain whose thickness follows a profile (0 at the head end, 1 at the tip),
// so snakes and fish tails can bulge in the middle.
function profileChain(n: number, length: number, radius: (u: number) => number, mat: MeshStandardMaterial, radial = 8): Chain {
  const root = new Group();
  const segs: Group[] = [];
  const seg = length / n;
  let parent: Group = root;
  for (let i = 0; i < n; i += 1) {
    const g = new Group();
    const ra = radius(i / n);
    const rb = radius((i + 1) / n);
    const body = new Mesh(new CylinderGeometry(rb, ra, seg * 1.05, radial, 1), mat);
    // Thin end on +Y; pointing +Y at -Z puts it at the tip (same as parts.chain).
    body.rotation.x = -Math.PI / 2;
    body.position.z = -seg / 2;
    g.add(body);
    if (i > 0) g.add(ball(ra * 1.01, mat, 1, 1, 1, 8));
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

// Re-orient `child` (parented somewhere in a rotated chain) so it faces
// world +Z again. Call after the chain's static pose is set.
function faceForward(root: Object3D, child: Object3D, pitch = 0): void {
  root.updateMatrixWorld(true);
  const q = child.parent!.getWorldQuaternion(new Quaternion());
  child.quaternion.copy(q.invert());
  child.rotateX(pitch);
}

// ---------------------------------------------------------------------------
// birds and bats

type BirdKind =
  | "owl" | "raptor" | "vulture" | "corvid" | "wader" | "waterfowl" | "poultry"
  | "flightless" | "phoenix" | "generic";

interface BirdCfg {
  legH: number; legR: number; body: [number, number, number]; tilt: number;
  neck: number; neckDir: [number, number, number]; bend: number[];
  head: number; beak: number; hook: boolean;
  wings: "open" | "folded" | "stub";
  span: number; chord: number;
  tail: "fan" | "short" | "up" | "long";
  tailLen: number;
  legCol: string; beakCol: string;
}

function birdKind(name: string): BirdKind {
  if (/owl/.test(name)) return "owl";
  if (/vulture/.test(name)) return "vulture";
  if (/phoenix|firebird|thunderbird/.test(name)) return "phoenix";
  if (/eagle|hawk|falcon|\broc\b|archaeopteryx/.test(name)) return "raptor";
  if (/raven|crow|cikavak|magpie|rook/.test(name)) return "corvid";
  if (/heron|stork|crane|flamingo/.test(name)) return "wader";
  if (/swan|goose|duck|pelican|cormorant|gull|albatross/.test(name)) return "waterfowl";
  if (/chicken|rooster|cockatrice|\bhen\b|peacock|turkey/.test(name)) return "poultry";
  if (/ostrich|emu|axe beak|terror bird|kiwi|dodo|avestruzii/.test(name)) return "flightless";
  return "generic";
}

function birdCfg(kind: BirdKind, name: string): BirdCfg {
  const base: BirdCfg = {
    legH: 0.24, legR: 0.02, body: [0.17, 0.19, 0.3], tilt: 0.55,
    neck: 0.16, neckDir: [0, 1, 0.5], bend: [0, 0, 0, 0],
    head: 0.12, beak: 0.2, hook: false, wings: "folded", span: 0.6, chord: 0.32,
    tail: "fan", tailLen: 0.32, legCol: "#c9962c", beakCol: "#d4a437",
  };
  switch (kind) {
    case "owl":
      return { ...base, legH: 0.14, legR: 0.032, body: [0.22, 0.27, 0.26], tilt: 1.15, neck: 0.03, neckDir: [0, 1, 0.1], head: 0.2, beak: 0.08, hook: true, tail: "short", tailLen: 0.2, legCol: "#d8c9a3", beakCol: "#3a3228" };
    case "raptor":
      return { ...base, legH: 0.25, legR: 0.028, body: [0.2, 0.22, 0.34], tilt: 0.7, neck: 0.12, head: 0.125, beak: 0.22, hook: true, wings: "open", span: 1.1, chord: 0.55, tailLen: 0.4 };
    case "vulture":
      return { ...base, legH: 0.26, legR: 0.03, body: [0.22, 0.24, 0.36], tilt: 0.6, neck: 0.28, neckDir: [0, 1, 0.6], bend: [-0.2, 0.1, 0.4, 0.5], head: 0.105, beak: 0.22, hook: true, wings: "folded", tailLen: 0.3, legCol: "#a58c86", beakCol: "#8b8078" };
    case "corvid":
      return { ...base, legH: 0.22, legR: 0.018, body: [0.15, 0.17, 0.3], tilt: 0.5, neck: 0.13, head: 0.115, beak: 0.3, tail: "long", tailLen: 0.38, legCol: "#1a1613", beakCol: "#1d1a17" };
    case "wader":
      return { ...base, legH: 0.85, legR: 0.017, body: [0.15, 0.17, 0.3], tilt: 0.6, neck: 0.56, neckDir: [0, 1, 0.3], bend: [-0.55, -0.35, 0.05, 0.5, 0.6], head: 0.075, beak: /flamingo/.test(name) ? 0.24 : 0.55, tail: "short", tailLen: 0.2, legCol: /flamingo/.test(name) ? "#e58aa8" : "#8a7a4a", beakCol: /flamingo/.test(name) ? "#2a2020" : "#d4a437" };
    case "waterfowl":
      return { ...base, legH: 0.16, legR: 0.02, body: [0.24, 0.22, 0.4], tilt: 0.22, neck: /swan|goose/.test(name) ? 0.5 : 0.2, neckDir: [0, 1, 0.3], bend: [-0.5, -0.4, 0.2, 0.45, 0.5], head: 0.075, beak: /pelican/.test(name) ? 0.5 : 0.17, tail: "short", tailLen: 0.2, legCol: "#e08a2c", beakCol: /swan/.test(name) ? "#e07a24" : "#d4a437" };
    case "poultry":
      return { ...base, legH: 0.22, legR: 0.02, body: [0.19, 0.21, 0.27], tilt: 0.5, neck: 0.13, neckDir: [0, 1, 0.35], head: 0.1, beak: 0.11, tail: "up", tailLen: 0.4 };
    case "flightless":
      return /terror bird|axe beak/.test(name)
        ? { ...base, legH: 0.9, legR: 0.045, body: [0.26, 0.3, 0.36], tilt: 0.35, neck: 0.5, neckDir: [0, 1, 0.3], bend: [-0.3, -0.1, 0.2, 0.3], head: 0.16, beak: 0.42, hook: true, wings: "stub", tail: "short", tailLen: 0.25 }
        : { ...base, legH: 1.0, legR: 0.045, body: [0.26, 0.3, 0.36], tilt: 0.3, neck: 0.75, neckDir: [0, 1, 0.3], bend: [-0.4, -0.2, 0.1, 0.35, 0.4], head: 0.09, beak: 0.2, wings: "stub", tail: "short", tailLen: 0.25 };
    case "phoenix":
      return { ...base, legH: 0.25, legR: 0.026, body: [0.19, 0.21, 0.34], tilt: 0.6, neck: 0.14, head: 0.12, beak: 0.22, hook: true, wings: "open", span: 1.2, chord: 0.62, tail: "long", tailLen: 0.75 };
    default:
      return /archaeopteryx/.test(name) ? { ...base, wings: "open", tail: "long", tailLen: 0.5 } : base;
  }
}

function birdHead(ctx: Ctx, kind: BirdKind, cfg: BirdCfg): Group {
  const { mats } = ctx;
  const r = cfg.head;
  const headMat = kind === "vulture" ? stdMat("#b08a84", { roughness: 0.9 }) : mats.skin;
  const beakMat = stdMat(cfg.beakCol, { roughness: 0.45 });
  const g = makeHead({ ...ctx, mats: { ...mats, skin: headMat, accent: beakMat } }, { r, style: "bird", snout: cfg.beak / r });
  const skull = g.getObjectByName("cranium") as Mesh;
  const len = cfg.beak;
  if (kind === "waterfowl" && len > 0.4) {
    const pouch = ball(r * 0.42, stdMat("#e6b872", { roughness: 0.6 }), 0.9, 0.9, len / (r * 0.42) * 0.45, 8);
    pouch.position.set(0, -r * 0.5, r * 0.9 + len * 0.42);
    g.add(pouch);
  }
  if (kind === "poultry") {
    const red = stdMat("#c1272d", { roughness: 0.55 });
    for (let i = 0; i < 3; i += 1) {
      const c = ball(.24 - i * .03, red, .45, 1, 1, 10);
      mountSurface(skull, c, new Vector3(0, .65, .4 - i * .35), new Vector3(0, 1, 0), .04);
    }
    const wattle = ball(r * 0.22, red, 0.6, 1.3, 0.7, 8);
    wattle.position.set(0, -r * 0.55, r * 0.75);
    g.add(wattle);
  }
  if (kind === "phoenix") {
    for (let i = 0; i < 3; i += 1) {
      const h = 1.4 - i * .25;
      const f = cone(.20, h, mats.glow, 5);
      f.geometry.translate(0, h * .43, 0);
      mountSurface(skull, f, new Vector3(0, .60, -.10 - i * .25), new Vector3(0, 1, 0), .03);
    }
  }
  return g;
}

function birdLegs(ctx: Ctx, cfg: BirdCfg): void {
  const { mats, root } = ctx;
  const legMat = stdMat(cfg.legCol, { roughness: 0.6 });
  const hipX = cfg.body[0] * 0.5;
  const toe = 0.06 + cfg.legR * 3.5;
  for (const side of [1, -1]) {
    const hip = new Vector3(hipX * side, cfg.legH, -0.03);
    const ankle = new Vector3(hipX * 1.15 * side, 0.02, 0.05);
    root.add(segment(hip, ankle, cfg.legR * 1.5, cfg.legR, legMat, 6));
    const thigh = ball(cfg.legR * 3.2, mats.skin, 1, 1.3, 1.3, 8);
    thigh.position.copy(hip);
    root.add(thigh);
    for (const a of [-0.45, 0, 0.45]) {
      const t = cone(cfg.legR * 0.9, toe, legMat, 4);
      t.rotation.x = Math.PI / 2;
      t.rotation.z = a;
      t.position.set(ankle.x - Math.sin(a) * toe * 0.5, 0.012, ankle.z + Math.cos(a) * toe * 0.5);
      root.add(t);
    }
    const back = cone(cfg.legR * 0.9, toe * 0.6, legMat, 4);
    back.rotation.x = -Math.PI / 2;
    back.position.set(ankle.x, 0.012, ankle.z - toe * 0.3);
    root.add(back);
  }
}

// makeWings mirrors its right wing with scale.x = -1, and rotation is applied
// after scale, so its shared flap tick lifts one wing and drops the other.
// Run after it and overwrite the rotation with a properly mirrored one.
function mirrorFlap(ctx: Ctx, wings: Group, rest: number, flap: number): void {
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.5 + ctx.phase);
    wings.children.forEach((p, i) => { p.rotation.z = (i === 0 ? 1 : -1) * (rest + s * flap); });
  });
}

// A filled, scalloped bird wing (leading edge along +X, trailing edge back).
const WING_OUTLINE: Array<[number, number]> = [
  [0, -0.12], [0.35, -0.17], [0.7, -0.09], [1, 0.1], [0.94, 0.5], [0.87, 0.38], [0.83, 0.78], [0.74, 0.6],
  [0.69, 1.0], [0.59, 0.82], [0.51, 1.06], [0.41, 0.9], [0.31, 1.0], [0.16, 0.9], [0, 0.8],
];
const COVERT_OUTLINE: Array<[number, number]> = [
  [0, -0.1], [0.4, -0.15], [0.75, -0.07], [0.88, 0.1], [0.74, 0.32], [0.52, 0.4], [0.3, 0.42], [0.12, 0.38], [0, 0.32],
];

function outlineShape(points: Array<[number, number]>, span: number, chord: number): Shape {
  const shape = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * span, y * chord) : shape.lineTo(x * span, y * chord)));
  return shape;
}

function featherWings(ctx: Ctx, span: number, chord: number, opts: { rest: number; flap: number; pitch: number; sweep: number; glow?: boolean }): Group {
  const { mats } = ctx;
  const pair = new Group();
  const pivots: Group[] = [];
  const skin = mats.skin.clone();
  skin.side = DoubleSide;
  const covert = mats.belly.clone();
  covert.side = DoubleSide;
  const edgeMat = opts.glow ? mats.glow : skin;
  for (const side of [1, -1]) {
    const pivot = new Group();
    const wing = new Group();
    const blade = new Mesh(new ShapeGeometry(outlineShape(WING_OUTLINE, span, chord)), edgeMat);
    blade.rotation.x = -Math.PI / 2;
    wing.add(blade);
    const top = new Mesh(new ShapeGeometry(outlineShape(COVERT_OUTLINE, span, chord)), covert);
    top.rotation.x = -Math.PI / 2;
    top.position.y = chord * 0.006;
    wing.add(top);
    wing.add(segment(new Vector3(0, 0, chord * 0.11), new Vector3(span * 0.95, 0, -chord * 0.07), chord * 0.06, chord * 0.025, mats.skin, 6));
    wing.rotation.set(opts.pitch, opts.sweep, 0);
    pivot.add(wing);
    pivot.scale.x = side;
    pair.add(pivot);
    pivots.push(pivot);
  }
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.5 + ctx.phase);
    pivots.forEach((p, i) => { p.rotation.z = (i === 0 ? 1 : -1) * (opts.rest + s * opts.flap); });
  });
  return pair;
}

export function buildAvian(ctx: Ctx): void {
  const name = nameOf(ctx);
  if (/\bbats?\b/.test(name)) return buildBat(ctx);
  if (/pteranodon|quetzalcoatlus|pterodactyl/.test(name)) return buildPterosaur(ctx);
  const { mats, rng, root, t } = ctx;
  const kind = birdKind(name);
  const cfg = birdCfg(kind, name);
  const jitter = between(rng, 0.94, 1.08);
  cfg.body = cfg.body.map((v) => v * jitter) as [number, number, number];
  const [rx, ry, rz] = cfg.body;

  birdLegs(ctx, cfg);

  const bodyPos = new Vector3(0, cfg.legH + ry * 0.85, 0);
  const bodyG = new Group();
  bodyG.position.copy(bodyPos);
  bodyG.rotation.x = -cfg.tilt;
  root.add(bodyG);
  bodyG.add(ball(1, mats.skin, rx, ry, rz, 14));
  const breast = ball(1, mats.belly, rx * 0.92, ry * 0.85, rz * 0.62, 12);
  breast.position.set(0, -ry * 0.22, rz * 0.32);
  bodyG.add(breast);

  // --- wings
  if (cfg.wings === "open") {
    const membrane = t.wings === "membrane" && !/archaeopteryx/.test(name);
    const wings = membrane
      ? makeWings(ctx, cfg.span, cfg.chord, "membrane", 0.28, 0.5)
      : featherWings(ctx, cfg.span, cfg.chord, { rest: 0.45, flap: 0.3, pitch: 0.2, sweep: 0.3, glow: kind === "phoenix" });
    wings.position.set(0, ry * 0.35, rz * 0.05);
    if (membrane) { wings.rotation.x = cfg.tilt * 0.8; mirrorFlap(ctx, wings, 0.5, 0.28); }
    wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * rx * 0.7; });
    bodyG.add(wings);
  } else {
    const len = cfg.wings === "stub" ? 0.4 : 0.9;
    const wingPair: Group[] = [];
    for (const side of [1, -1]) {
      const w = new Group();
      w.position.set(rx * 0.88 * side, ry * 0.08, -rz * 0.1);
      const blade = ball(1, mats.skin, rx * 0.26, ry * 0.7, rz * 0.9 * len, 10);
      blade.position.z = -rz * 0.1;
      w.add(blade);
      if (cfg.wings === "folded") {
        const tip = cone(rx * 0.14, rz * 0.55, mats.skin, 5);
        tip.rotation.x = -Math.PI / 2;
        tip.position.set(0, -ry * 0.05, -rz * 0.95);
        w.add(tip);
      }
      w.rotation.z = -0.1 * side;
      bodyG.add(w);
      wingPair.push(w);
    }
    tick(ctx, (time) => {
      wingPair.forEach((w, i) => {
        w.rotation.z = (i === 0 ? -1 : 1) * (0.1 + 0.04 * Math.max(0, Math.sin(time * 0.8 + ctx.phase * 2)));
      });
    });
  }

  // --- tail
  const tailG = new Group();
  tailG.position.set(0, -ry * 0.1, -rz * 0.85);
  bodyG.add(tailG);
  const tailMat = kind === "phoenix" ? mats.glow : mats.skin;
  if (cfg.tail === "up") {
    for (let i = 0; i < 5; i += 1) {
      const s = spike(cfg.tailLen * (0.8 + (i % 3) * 0.12), 0.03, -1.3, i % 2 ? mats.skin : stdMat(ctx.spec.palette.cloth), 4, 5);
      s.rotation.x = -0.35 - i * 0.05;
      s.rotation.z = (i - 2) * 0.18;
      s.position.set(0, ry * 0.15, 0);
      tailG.add(s);
    }
    if (/cockatrice/.test(name)) {
      const lizard = chain(7, 0.7, 0.05, 0.01, mats.skin, 6);
      lizard.root.position.set(0, -ry * 0.1, 0);
      aim(lizard.root, new Vector3(0, -0.3, -1));
      tailG.add(lizard.root);
      wave(ctx, lizard, { yaw: 0.2, speed: 1.6, lag: 0.5 });
    }
  } else {
    const n = kind === "phoenix" ? 7 : 5;
    for (let i = 0; i < n; i += 1) {
      const f = new Group();
      f.rotation.y = (i - (n - 1) / 2) * (kind === "phoenix" ? 0.16 : 0.15);
      const len = cfg.tailLen * (1 - Math.abs(i - (n - 1) / 2) * (kind === "phoenix" ? 0.06 : 0.1));
      if (kind === "phoenix") {
        const m = cone(0.045, len, tailMat, 5);
        m.rotation.x = -Math.PI / 2;
        m.position.z = -len / 2;
        f.add(m);
      } else {
        const m = ball(1, tailMat, 0.05, 0.013, len / 2, 6);
        m.position.z = -len / 2;
        f.add(m);
      }
      tailG.add(f);
    }
    tailG.rotation.x = 0.1;
  }

  // --- neck and head
  const head = birdHead(ctx, kind, cfg);
  const nb = new Vector3(0, ry * 0.55, rz * 0.7).applyAxisAngle(X_AXIS, -cfg.tilt).add(bodyPos);
  let neck: Chain | null = null;
  if (cfg.neck > 0.05) {
    const segs = cfg.bend.length > 4 ? 5 : 4;
    neck = chain(segs, cfg.neck, rx * (kind === "wader" || kind === "flightless" || kind === "waterfowl" ? 0.38 : 0.5), cfg.head * 0.6, mats.skin, 7);
    neck.root.position.copy(nb);
    aim(neck.root, new Vector3(...cfg.neckDir));
    neck.segs.forEach((s, i) => { s.rotation.x = cfg.bend[i] ?? 0; });
    root.add(neck.root);
    neck.tip.add(head);
    faceForward(root, head, kind === "raptor" || kind === "vulture" ? 0.15 : 0.05);
  } else {
    head.position.copy(nb).add(new Vector3(0, cfg.head * 0.35, cfg.head * 0.6));
    root.add(head);
  }
  if (kind === "vulture") {
    const ruff = torus(rx * 0.55, rx * 0.16, mats.skin, Math.PI * 2, 6, 14);
    ruff.rotation.x = Math.PI / 2;
    ruff.position.copy(nb);
    root.add(ruff);
  }

  // --- idle
  const phase = ctx.phase;
  const neckRest = neck ? neck.segs.map((s) => s.rotation.x) : [];
  tick(ctx, (time) => {
    const b = Math.sin(time * 1.8 + phase);
    bodyG.scale.set(1 - 0.008 * b, 1 + 0.012 * b, 1);
    tailG.rotation.y = 0.12 * Math.sin(time * 1.1 + phase);
    if (neck) {
      neck.segs.forEach((s, i) => {
        s.rotation.x = neckRest[i]! + 0.03 * Math.sin(time * 1.2 - i * 0.4 + phase);
        s.rotation.y = 0.1 * Math.sin(time * 0.55 + phase - i * 0.3);
      });
    } else {
      head.rotation.y = 0.35 * Math.sin(time * 0.6 + phase);
    }
    head.rotation.z = 0.28 * Math.pow(Math.max(0, Math.sin(time * 0.9 + phase * 2)), 3);
  });
}

function buildBat(ctx: Ctx): void {
  const { mats, root, rng } = ctx;
  const fur = mats.skin;
  const body = ball(0.12, fur, 1, 0.95, 1.35, 12);
  body.position.y = 0.2;
  root.add(body);
  const belly = ball(0.1, mats.belly, 0.9, 0.8, 1.1, 10);
  belly.position.set(0, 0.17, 0.03);
  root.add(belly);
  const head = new Group();
  head.position.set(0, 0.29, 0.15);
  head.add(ball(0.075, fur, 1, 0.95, 1, 10));
  const snout = ball(0.04, mats.belly, 1, 0.8, 1.2, 8);
  snout.position.set(0, -0.02, 0.07);
  head.add(snout);
  const nose = ball(0.014, mats.dark, 1, 0.8, 1, 6);
  nose.position.set(0, -0.005, 0.105);
  head.add(nose);
  for (const side of [1, -1]) {
    const ear = cone(0.048, 0.15, fur, 4);
    ear.position.set(0.05 * side, 0.09, -0.01);
    ear.rotation.z = -0.25 * side;
    ear.scale.z = 0.45;
    head.add(ear);
    const eye = ball(0.014, mats.eye, 1, 1, 1, 6);
    eye.position.set(0.035 * side, 0.02, 0.062);
    head.add(eye);
    const fang = cone(0.006, 0.026, mats.white, 4);
    fang.rotation.x = Math.PI;
    fang.position.set(0.012 * side, -0.05, 0.095);
    head.add(fang);
  }
  root.add(head);
  const wings = makeWings(ctx, between(rng, 0.6, 0.7), 0.42, "membrane", 0.3, 0.7);
  mirrorFlap(ctx, wings, 0.7, 0.3);
  wings.position.set(0, 0.24, 0.02);
  wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * 0.08; });
  root.add(wings);
  for (const side of [1, -1]) {
    root.add(segment(new Vector3(0.05 * side, 0.12, -0.1), new Vector3(0.08 * side, 0.02, -0.02), 0.014, 0.01, mats.skin, 5));
    const foot = ball(0.02, mats.skin, 1, 0.6, 1.5, 6);
    foot.position.set(0.08 * side, 0.015, 0.0);
    root.add(foot);
  }
  const phase = ctx.phase;
  tick(ctx, (time) => {
    body.scale.y = 0.95 + 0.03 * Math.sin(time * 2.4 + phase);
    head.rotation.y = 0.5 * Math.sin(time * 0.7 + phase);
    head.rotation.x = 0.15 * Math.sin(time * 1.3 + phase);
  });
}

function buildPterosaur(ctx: Ctx): void {
  const { mats, root, rng } = ctx;
  const legMat = stdMat(ctx.spec.palette.accent, { roughness: 0.6 });
  const tilt = 0.4;
  const bodyPos = new Vector3(0, 0.62, 0);
  const bodyG = new Group();
  bodyG.position.copy(bodyPos);
  bodyG.rotation.x = -tilt;
  root.add(bodyG);
  bodyG.add(ball(1, mats.skin, 0.14, 0.15, 0.3, 12));
  const belly = ball(1, mats.belly, 0.12, 0.12, 0.22, 10);
  belly.position.set(0, -0.06, 0.06);
  bodyG.add(belly);
  for (const side of [1, -1]) {
    const hip = new Vector3(0.07 * side, 0.55, -0.03);
    root.add(segment(hip, new Vector3(0.09 * side, 0.02, 0.05), 0.03, 0.016, legMat, 6));
    const foot = ball(0.03, legMat, 1.3, 0.5, 2, 6);
    foot.position.set(0.09 * side, 0.015, 0.09);
    root.add(foot);
  }
  const nb = new Vector3(0, 0.1, 0.28).applyAxisAngle(X_AXIS, -tilt).add(bodyPos);
  const neck = chain(4, 0.42, 0.06, 0.035, mats.skin, 6);
  neck.root.position.copy(nb);
  aim(neck.root, new Vector3(0, 1, 0.55));
  neck.segs.forEach((s, i) => { s.rotation.x = [-0.3, -0.1, 0.25, 0.45][i]!; });
  root.add(neck.root);
  const head = new Group();
  head.add(ball(0.07, mats.skin, 0.9, 0.9, 1.2, 10));
  const beakMat = stdMat(ctx.spec.palette.accent, { roughness: 0.5 });
  const beak = cone(0.03, 0.5, beakMat, 6);
  beak.rotation.x = Math.PI / 2;
  beak.position.z = 0.07 + 0.25;
  head.add(beak);
  const low = cone(0.024, 0.42, beakMat, 5);
  low.rotation.x = Math.PI / 2;
  low.position.set(0, -0.03, 0.07 + 0.2);
  head.add(low);
  const crest = cone(0.03, 0.34, mats.belly, 4);
  crest.rotation.x = -Math.PI / 2 + 0.25;
  crest.position.set(0, 0.06, -0.14);
  head.add(crest);
  for (const side of [1, -1]) {
    const eye = ball(0.017, mats.eye, 1, 1, 1, 6);
    eye.position.set(0.055 * side, 0.03, 0.04);
    head.add(eye);
  }
  neck.tip.add(head);
  faceForward(root, head, 0.25);
  const wings = makeWings(ctx, between(rng, 1.05, 1.2), 0.55, "membrane", 0.25, 0.45);
  mirrorFlap(ctx, wings, 0.45, 0.25);
  wings.position.set(0, 0.06, 0.02);
  wings.rotation.x = tilt * 0.8;
  wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * 0.12; });
  bodyG.add(wings);
  const tail = cone(0.04, 0.3, mats.skin, 5);
  tail.rotation.x = Math.PI / 2 + 0.3;
  tail.position.set(0, -0.06, -0.4);
  bodyG.add(tail);
  const rest = neck.segs.map((s) => s.rotation.x);
  const phase = ctx.phase;
  tick(ctx, (time) => {
    neck.segs.forEach((s, i) => {
      s.rotation.x = rest[i]! + 0.04 * Math.sin(time * 1.2 - i * 0.4 + phase);
      s.rotation.y = 0.14 * Math.sin(time * 0.5 + phase - i * 0.3);
    });
    bodyG.scale.y = 1 + 0.012 * Math.sin(time * 1.7 + phase);
  });
}


// ---------------------------------------------------------------------------
// insects

type BugKind =
  | "ant" | "beetle" | "wasp" | "fly" | "dragonfly" | "mantis" | "moth" | "locust" | "roach" | "firefly" | "brain";

function bugKind(ctx: Ctx): BugKind {
  const n = nameOf(ctx);
  if (/intellect devourer/.test(n)) return "brain";
  if (/dragonfly|dawnfly|mayfly/.test(n)) return "dragonfly";
  if (/firefly/.test(n)) return "firefly";
  if (/stirge|mosquito|\bfly\b|flies|hoverfly|tsetse/.test(n)) return "fly";
  if (/wasp|\bbees?\b|hornet/.test(n)) return "wasp";
  if (/mantis/.test(n)) return "mantis";
  if (/moth|butterfl/.test(n)) return "moth";
  if (/locust|cricket|grasshopper|katydid/.test(n)) return "locust";
  if (/roach|cockroach/.test(n)) return "roach";
  if (/beetle|scarab|weevil/.test(n)) return "beetle";
  if (/\bants?\b|termite|myrmex/.test(n)) return "ant";
  if (ctx.spec.type === "aberration") return "brain";
  return "ant";
}

interface LegSpec { x: number; y: number; z: number; out: number; reach: number; lift: number; r: number }
interface LegRef { g: Group; base: number; parity: number }

// Three-part legs, one group per leg so the whole leg can shuffle.
function addLegs(parent: Object3D, specs: LegSpec[], mat: MeshStandardMaterial, radial = 5): LegRef[] {
  const refs: LegRef[] = [];
  specs.forEach((sp, idx) => {
    for (const side of [1, -1]) {
      const g = new Group();
      g.position.set(sp.x * side, sp.y, sp.z);
      const knee = new Vector3(sp.out * 0.55 * side, sp.lift, sp.reach * 0.3);
      const foot = new Vector3(sp.out * side, -sp.y + 0.012, sp.reach);
      g.add(limb(new Vector3(), knee, foot, sp.r * 1.3, sp.r, sp.r * 0.6, mat, radial));
      const pad = ball(sp.r * 0.9, mat, 1, 0.6, 1.3, 5);
      pad.position.copy(foot);
      g.add(pad);
      parent.add(g);
      refs.push({ g, base: 0, parity: (idx + (side === 1 ? 0 : 1)) % 2 });
    }
  });
  return refs;
}

function shuffleLegs(ctx: Ctx, legs: LegRef[], amp = 0.09, speed = 2.1): void {
  tick(ctx, (time) => {
    for (const l of legs) l.g.rotation.y = l.base + amp * Math.sin(time * speed + l.parity * Math.PI + ctx.phase);
  });
}

function bugHead(ctx: Ctx, r: number, opts: { eyes?: number; mandibles?: boolean; eyeMat?: MeshStandardMaterial } = {}): Group {
  const { mats } = ctx;
  const g = makeHead({ ...ctx, mats: { ...mats, eye: opts.eyeMat ?? mats.eye } }, { r, style: "insect" });
  const face = g.getObjectByName("face-insect")!;
  const skull = g.getObjectByName("cranium")!;
  for (const o of [...face.children, ...skull.children]) {
    if (o.name === "antenna" || opts.mandibles === false && o.name === "mandible") o.removeFromParent();
    if (o.name === "eye-socket") o.scale.multiplyScalar((opts.eyes ?? .34) / .34);
  }
  return g;
}

function addAntennae(ctx: Ctx, head: Group, r: number, len: number, mat: MeshStandardMaterial): Group[] {
  const list: Group[] = [];
  const skull = head.getObjectByName("cranium") as Mesh;
  for (const side of [1, -1]) {
    const a = spike(len / r, .06, -.9, mat, 4, 4);
    a.rotation.x = 0.9;
    a.rotation.z = -0.35 * side;
    const mount = new Group(); mount.add(a);
    mountSurface(skull, mount, new Vector3(.28 * side, .42, .5), new Vector3(0, 1, 0), .045);
    list.push(a);
  }
  const baseX = list.map((a) => a.rotation.x);
  tick(ctx, (time) => list.forEach((a, i) => { a.rotation.x = baseX[i]! + 0.12 * Math.sin(time * 3.1 + i * 1.7 + ctx.phase); }));
  return list;
}

// Translucent buzzing wings. `pairs` of fore/hind wings ride on a mount.
function insectWings(ctx: Ctx, mount: Group, span: number, chord: number, pairs: 1 | 2, opts: { rest?: number; amp?: number; freq?: number; color?: string; opacity?: number } = {}): void {
  const { rest = 0.55, amp = 0.35, freq = 28, color = "#e6f3ff", opacity = 0.42 } = opts;
  const mat = stdMat(color, { transparent: true, opacity, roughness: 0.1, side: DoubleSide, depthWrite: false });
  const vein = ctx.mats.dark;
  const pivots: Group[] = [];
  for (let p = 0; p < pairs; p += 1) {
    for (const side of [1, -1]) {
      const pivot = new Group();
      pivot.position.set(0.05 * side, 0, -p * chord * 0.35);
      const s = span * (p === 0 ? 1 : 0.82);
      const blade = ball(1, mat, s / 2, s * 0.004, chord / 2, 10);
      blade.position.set((s / 2) * side, 0, -chord * 0.35);
      blade.rotation.y = -0.12 * side;
      pivot.add(blade);
      const v = segment(new Vector3(0, 0, 0), new Vector3(s * 0.95 * side, 0, -chord * 0.5), s * 0.012, s * 0.005, vein, 4);
      pivot.add(v);
      mount.add(pivot);
      pivots.push(pivot);
    }
  }
  tick(ctx, (time) => {
    const b = Math.sin(time * freq + ctx.phase);
    pivots.forEach((pv, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      pv.rotation.z = side * (rest + amp * b * (i >= 2 ? -0.7 : 1));
    });
  });
}

const OUTLINE_CIRCLE = (rx: number, ry: number, cx: number, cy: number): Shape => {
  const shape = new Shape();
  shape.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, false, 0);
  return shape;
};

export function buildHexapod(ctx: Ctx): void {
  const kind = bugKind(ctx);
  const { mats, root, rng } = ctx;
  const phase = ctx.phase;
  const legMat = mats.skin;
  const name = nameOf(ctx);
  const glows = /fire|glow|lantern|light|shine|shining/.test(name) || kind === "firefly";

  if (kind === "brain") return buildBrain(ctx);

  if (kind === "mantis") {
    const y0 = 0.36;
    root.add(segment(new Vector3(0, y0, -0.08), new Vector3(0, 0.78, 0.18), 0.05, 0.035, mats.skin, 6));
    root.add(segment(new Vector3(0, y0, -0.1), new Vector3(0, 0.32, -0.7), 0.075, 0.02, mats.skin, 6));
    const head = bugHead(ctx, 0.075, { eyes: 0.42, mandibles: false });
    head.scale.set(1.15, 0.8, 0.9);
    head.position.set(0, 0.84, 0.24);
    head.rotation.x = 0.2;
    root.add(head);
    addAntennae(ctx, head, 0.075, 0.28, mats.dark);
    const forelegs: Group[] = [];
    for (const side of [1, -1]) {
      const g = new Group();
      g.position.set(0.06 * side, 0.72, 0.16);
      const up = new Vector3(0.03 * side, 0.12, 0.26);
      const down = new Vector3(0.03 * side, -0.12, 0.3);
      g.add(limb(new Vector3(), up, down, 0.032, 0.026, 0.014, mats.skin, 5));
      for (let i = 0; i < 4; i += 1) {
        const sp = cone(0.008, 0.05, mats.accent, 4);
        sp.position.set(0.03 * side, 0.12 - i * 0.055 + (0.0), 0.28 + i * 0.01);
        sp.rotation.z = Math.PI / 2 * side;
        g.add(sp);
      }
      root.add(g);
      forelegs.push(g);
    }
    tick(ctx, (time) => forelegs.forEach((g, i) => { g.rotation.x = -0.15 + 0.22 * Math.sin(time * 1.3 + phase + i * 0.6); }));
    const legs = addLegs(root, [
      { x: 0.04, y: 0.36, z: -0.06, out: 0.3, reach: 0.12, lift: 0.14, r: 0.02 },
      { x: 0.04, y: 0.34, z: -0.2, out: 0.32, reach: -0.24, lift: 0.14, r: 0.02 },
    ], legMat);
    shuffleLegs(ctx, legs, 0.05, 1.4);
    const wing = new Group();
    wing.position.set(0, 0.4, -0.15);
    const blade = ball(1, stdMat("#cfe6bd", { transparent: true, opacity: 0.55, side: DoubleSide, roughness: 0.3, depthWrite: false }), 0.09, 0.006, 0.42, 8);
    blade.position.z = -0.3;
    wing.add(blade);
    wing.rotation.x = -0.1;
    root.add(wing);
    tick(ctx, (time) => { wing.rotation.z = 0.02 * Math.sin(time * 6 + phase); });
    return;
  }

  if (kind === "moth") {
    const body = ball(0.07, mats.skin, 1, 1, 3.2, 8);
    body.position.set(0, 0.16, 0);
    root.add(body);
    const thorax = ball(0.095, mats.belly, 1, 1, 1.1, 8);
    thorax.position.set(0, 0.17, 0.12);
    root.add(thorax);
    const head = bugHead(ctx, 0.06, { eyes: 0.45, mandibles: false });
    head.position.set(0, 0.17, 0.25);
    root.add(head);
    addAntennae(ctx, head, 0.06, 0.24, mats.dark);
    const legs = addLegs(root, [
      { x: 0.03, y: 0.15, z: 0.14, out: 0.14, reach: 0.06, lift: 0.06, r: 0.008 },
      { x: 0.03, y: 0.15, z: 0.06, out: 0.16, reach: -0.02, lift: 0.06, r: 0.008 },
      { x: 0.03, y: 0.15, z: -0.02, out: 0.14, reach: -0.1, lift: 0.06, r: 0.008 },
    ], mats.dark);
    shuffleLegs(ctx, legs, 0.05, 1.2);
    const foreMat = stdMat(ctx.spec.palette.skin, { side: DoubleSide, roughness: 0.75 });
    const hindMat = stdMat(ctx.spec.palette.cloth, { side: DoubleSide, roughness: 0.75 });
    const spotMat = stdMat(ctx.spec.palette.accent, { side: DoubleSide, roughness: 0.6 });
    const pivots: Group[] = [];
    for (const side of [1, -1]) {
      const pivot = new Group();
      pivot.position.set(0.04 * side, 0.2, 0.08);
      const fore = new Mesh(new ShapeGeometry(OUTLINE_CIRCLE(0.2, 0.3, 0.02, 0.28)), foreMat);
      const hind = new Mesh(new ShapeGeometry(OUTLINE_CIRCLE(0.14, 0.2, -0.16, 0.2)), hindMat);
      const eye = new Mesh(new ShapeGeometry(OUTLINE_CIRCLE(0.045, 0.045, 0.04, 0.35)), spotMat);
      eye.position.z = 0.002;
      for (const m of [fore, hind, eye]) { m.rotation.y = Math.PI / 2; pivot.add(m); }
      root.add(pivot);
      pivots.push(pivot);
    }
    tick(ctx, (time) => {
      const open = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3 + phase));
      pivots.forEach((pv, i) => { pv.rotation.z = (i === 0 ? -1 : 1) * open; });
    });
    void rng;
    return;
  }

  // ----- the six-legged body plans built from head / thorax / abdomen -----
  interface BugCfg {
    hipY: number; thorax: [number, number, number, number]; abdomen: [number, number, number, number, number]; head: number; headPos: [number, number, number];
    legs: LegSpec[]; antenna: number; legR: number;
  }
  let cfg: BugCfg;
  switch (kind) {
    case "beetle":
      cfg = { hipY: 0.16, thorax: [0, 0.3, 0.26, 0.18], abdomen: [0, 0.34, -0.12, 0.34, 0.5], head: 0.11, headPos: [0, 0.24, 0.5], legs: [], antenna: 0.22, legR: 0.03 };
      break;
    case "wasp":
      cfg = { hipY: 0.3, thorax: [0, 0.4, 0.18, 0.15], abdomen: [0, 0.34, -0.36, 0.13, 0.36], head: 0.11, headPos: [0, 0.4, 0.34], legs: [], antenna: 0.28, legR: 0.018 };
      break;
    case "fly":
      cfg = { hipY: 0.3, thorax: [0, 0.38, 0.1, 0.17], abdomen: [0, 0.34, -0.26, 0.14, 0.3], head: 0.12, headPos: [0, 0.38, 0.3], legs: [], antenna: 0.12, legR: 0.014 };
      break;
    case "dragonfly":
      cfg = { hipY: 0.24, thorax: [0, 0.32, 0.12, 0.1], abdomen: [0, 0.32, -0.55, 0.04, 0.9], head: 0.12, headPos: [0, 0.34, 0.28], legs: [], antenna: 0.1, legR: 0.012 };
      break;
    case "locust":
      cfg = { hipY: 0.28, thorax: [0, 0.38, 0.12, 0.2], abdomen: [0, 0.38, -0.32, 0.11, 0.5], head: 0.12, headPos: [0, 0.36, 0.4], legs: [], antenna: 0.5, legR: 0.02 };
      break;
    case "roach":
      cfg = { hipY: 0.1, thorax: [0, 0.14, 0.1, 0.3], abdomen: [0, 0.14, -0.1, 0.28, 0.5], head: 0.09, headPos: [0, 0.11, 0.5], legs: [], antenna: 0.6, legR: 0.018 };
      break;
    case "firefly":
      cfg = { hipY: 0.2, thorax: [0, 0.28, 0.14, 0.16], abdomen: [0, 0.28, -0.22, 0.14, 0.32], head: 0.09, headPos: [0, 0.27, 0.32], legs: [], antenna: 0.2, legR: 0.014 };
      break;
    default: // ant and generic
      cfg = { hipY: 0.3, thorax: [0, 0.34, 0.2, 0.12], abdomen: [0, 0.36, -0.32, 0.19, 0.4], head: 0.13, headPos: [0, 0.34, 0.5], legs: [], antenna: 0.3, legR: 0.024 };
      break;
  }

  // body sections
  const striped = kind === "wasp";
  const yellow = stdMat("#e2b91c", { roughness: 0.5 });
  const black = stdMat("#17110c", { roughness: 0.5 });
  const thoraxMat = striped ? black : mats.skin;
  const thorax = ball(1, thoraxMat, cfg.thorax[3] * 0.55, cfg.thorax[3] * (kind === "roach" ? 0.3 : 0.5), cfg.thorax[2] * 1.4, 12);
  thorax.position.set(0, cfg.thorax[1], cfg.thorax[2] * 0.6);
  if (kind !== "beetle" && kind !== "roach") root.add(thorax);
  const abdRoot = new Group();
  abdRoot.position.set(0, cfg.abdomen[1], cfg.abdomen[2]);
  root.add(abdRoot);
  if (kind === "dragonfly") {
    const tail = chain(7, cfg.abdomen[4], 0.055, 0.02, mats.skin, 6);
    tail.root.position.set(0, 0, 0.1);
    aim(tail.root, new Vector3(0, 0.02, -1));
    abdRoot.add(tail.root);
    wave(ctx, tail, { yaw: 0.05, pitch: 0.06, speed: 1.4, lag: 0.4 });
    for (let i = 0; i < 6; i += 1) {
      const band = torus(0.05 - i * 0.004, 0.008, mats.belly, Math.PI * 2, 4, 8);
      band.position.set(0, 0, 0.05 - i * 0.14);
      abdRoot.add(band);
    }
    thorax.scale.multiply(new Vector3(0.8, 1, 1.1));
    root.add(thorax);
  } else if (striped) {
    const seg = cfg.abdomen[4] / 5;
    for (let i = 0; i < 5; i += 1) {
      const rr = cfg.abdomen[3] * (1 - Math.abs(i - 1.3) * 0.17);
      const b = ball(rr, i % 2 ? black : yellow, 1, 0.95, 0.9, 10);
      b.position.z = -i * seg * 0.85;
      abdRoot.add(b);
    }
    const sting = cone(0.02, 0.16, mats.dark, 5);
    sting.rotation.x = -Math.PI / 2 - 0.3;
    sting.position.set(0, -0.03, -cfg.abdomen[4] * 0.85 - 0.06);
    abdRoot.add(sting);
    const stalk = cyl(0.02, 0.03, 0.14, black, 6);
    stalk.rotation.x = Math.PI / 2;
    stalk.position.set(0, 0, 0.13);
    abdRoot.add(stalk);
  } else if (kind === "beetle") {
    const dome = ball(1, mats.skin, cfg.abdomen[3] * 0.85, cfg.abdomen[3] * 0.75, cfg.abdomen[4] * 0.7, 14);
    dome.position.set(0, 0.03, -0.02);
    abdRoot.add(dome);
    const seam = cyl(0.006, 0.006, cfg.abdomen[4] * 1.25, mats.dark, 4);
    seam.rotation.x = Math.PI / 2;
    seam.position.set(0, cfg.abdomen[3] * 0.75 + 0.03, -0.02);
    abdRoot.add(seam);
    const shield = ball(1, mats.skin, 0.17, 0.12, 0.13, 10);
    shield.position.set(0, 0.26, 0.32);
    root.add(shield);
    if (glows) {
      for (const z of [0.36, 0.22]) {
        const g = ball(0.04, mats.glow, 1, 1, 1, 8);
        g.position.set(0.1, 0.36, z);
        const g2 = g.clone();
        g2.position.x = -0.1;
        root.add(g, g2);
      }
    }
  } else if (kind === "roach") {
    const shell = ball(1, mats.skin, 0.3, 0.1, 0.5, 12);
    shell.position.set(0, 0.03, -0.08);
    abdRoot.add(shell);
    const shield = ball(1, mats.belly, 0.2, 0.07, 0.17, 10);
    shield.position.set(0, 0.03, 0.4);
    abdRoot.add(shield);
  } else {
    const abd = ball(1, mats.skin, cfg.abdomen[3], cfg.abdomen[3] * (kind === "locust" ? 0.85 : 0.95), cfg.abdomen[4] * 0.55, 12);
    abdRoot.add(abd);
    const stalk = ball(0.06, mats.skin, 1, 1, 1.4, 8);
    stalk.position.set(0, 0.0, cfg.abdomen[4] * 0.55 + 0.02);
    abdRoot.add(stalk);
    if (kind === "firefly" || glows) {
      const lamp = ball(cfg.abdomen[3] * 0.85, mats.glow, 1, 0.9, 0.9, 10);
      lamp.position.set(0, -0.01, -cfg.abdomen[4] * 0.45);
      abdRoot.add(lamp);
    }
    if (kind === "fly") {
      for (let i = 0; i < 3; i += 1) {
        const band = torus(cfg.abdomen[3] * (0.95 - i * 0.2), 0.012, mats.dark, Math.PI * 2, 4, 10);
        band.position.z = -0.08 - i * 0.07;
        abdRoot.add(band);
      }
    }
  }

  // head
  const head = bugHead(ctx, cfg.head, { eyes: kind === "fly" || kind === "dragonfly" ? 0.6 : 0.34, mandibles: kind !== "fly" });
  head.position.set(...cfg.headPos);
  root.add(head);
  if (kind === "fly") {
    const isStirge = /stirge|mosquito/.test(name);
    const probLen = isStirge ? 0.4 : 0.1;
    const prob = cone(cfg.head * 0.12, probLen, mats.accent, 5);
    prob.rotation.x = Math.PI / 2 + (isStirge ? 0.3 : 0);
    prob.position.set(0, -cfg.head * 0.4, cfg.head * 0.9 + probLen / 2);
    head.add(prob);
  }
  if (kind === "beetle" && chance(rng, 0.6)) {
    const horn = spike(0.28, 0.035, 1.1, mats.accent, 4, 6);
    horn.rotation.x = 0.7;
    horn.position.set(0, cfg.head * 0.2, cfg.head * 0.8);
    head.add(horn);
  }
  addAntennae(ctx, head, cfg.head, cfg.antenna, mats.dark);

  // legs
  const hipY = cfg.hipY;
  const z0 = cfg.thorax[1] > 0 ? cfg.thorax[2] * 0.6 : 0.2;
  let legs: LegRef[];
  if (kind === "locust") {
    legs = addLegs(root, [
      { x: 0.05, y: hipY, z: 0.15, out: 0.24, reach: 0.18, lift: 0.1, r: cfg.legR },
      { x: 0.05, y: hipY, z: 0.05, out: 0.28, reach: -0.02, lift: 0.1, r: cfg.legR },
    ], legMat);
    for (const side of [1, -1]) {
      const g = new Group();
      g.position.set(0.07 * side, 0.36, -0.15);
      const knee = new Vector3(0.1 * side, 0.2, -0.32);
      const foot = new Vector3(0.18 * side, -0.35, -0.7);
      g.add(limb(new Vector3(), knee, foot, 0.06, 0.03, 0.014, mats.skin, 6));
      root.add(g);
      legs.push({ g, base: 0, parity: side === 1 ? 0 : 1 });
    }
  } else if (kind === "roach" || kind === "beetle") {
    const hy = hipY;
    legs = addLegs(root, [
      { x: 0.16, y: hy, z: 0.28, out: 0.3, reach: 0.22, lift: 0.1, r: cfg.legR },
      { x: 0.2, y: hy, z: 0.05, out: 0.36, reach: 0.02, lift: 0.1, r: cfg.legR },
      { x: 0.18, y: hy, z: -0.2, out: 0.32, reach: -0.24, lift: 0.1, r: cfg.legR },
    ], legMat);
  } else {
    legs = addLegs(root, [
      { x: 0.05, y: hipY, z: z0 + 0.1, out: 0.26, reach: 0.28, lift: 0.16, r: cfg.legR },
      { x: 0.05, y: hipY, z: z0, out: 0.32, reach: 0.02, lift: 0.18, r: cfg.legR },
      { x: 0.05, y: hipY, z: z0 - 0.1, out: 0.28, reach: -0.3, lift: 0.16, r: cfg.legR },
    ], legMat);
  }
  shuffleLegs(ctx, legs, kind === "dragonfly" || kind === "fly" ? 0.03 : 0.09, 2.1);

  // wings
  if (kind === "wasp" || kind === "fly" || kind === "dragonfly" || kind === "firefly") {
    const mount = new Group();
    mount.position.set(0, cfg.thorax[1] + 0.08, cfg.thorax[2] * 0.4);
    root.add(mount);
    const big = kind === "dragonfly";
    insectWings(ctx, mount, big ? 0.7 : kind === "fly" ? 0.5 : 0.42, big ? 0.14 : 0.16, big || kind === "wasp" ? 2 : 1, { rest: big ? 0.05 : 0.5, amp: big ? 0.1 : 0.32, freq: big ? 22 : 34 });
  } else if (kind === "beetle" || kind === "locust" || kind === "roach") {
    const mount = new Group();
    mount.position.set(0, cfg.thorax[1] + 0.12, cfg.thorax[2] * 0.2);
    root.add(mount);
    if (kind === "locust") {
      const blade = ball(1, stdMat("#c9b98a", { transparent: true, opacity: 0.6, side: DoubleSide, roughness: 0.4, depthWrite: false }), 0.1, 0.006, 0.5, 8);
      blade.position.set(0, 0.03, -0.42);
      mount.add(blade);
    }
  }

  // idle breathing
  tick(ctx, (time) => {
    const b = Math.sin(time * 2 + phase);
    abdRoot.scale.set(1 + 0.02 * b, 1 + 0.03 * b, 1 - 0.02 * b);
    head.rotation.y = 0.25 * Math.sin(time * 0.9 + phase);
  });
}

function buildBrain(ctx: Ctx): void {
  const { mats, root, t, rng } = ctx;
  const y = 0.42;
  for (const side of [1, -1]) {
    const lobe = ball(0.22, mats.skin, 1, 0.9, 1.15, 12);
    lobe.position.set(0.13 * side, y, 0);
    root.add(lobe);
    for (let i = 0; i < 4; i += 1) {
      const groove = torus(0.19 - i * 0.02, 0.012, mats.dark, Math.PI * 1.1, 4, 10);
      groove.rotation.y = Math.PI / 2;
      groove.rotation.x = 0.4 + i * 0.35;
      groove.position.set(0.13 * side + 0.02 * side, y + 0.02, -0.04 + i * 0.03);
      root.add(groove);
    }
  }
  const cerebellum = ball(0.13, mats.belly, 1.4, 0.9, 1, 10);
  cerebellum.position.set(0, y - 0.05, -0.24);
  root.add(cerebellum);
  const legs = addLegs(root, [
    { x: 0.13, y: y - 0.08, z: 0.16, out: 0.34, reach: 0.22, lift: 0.14, r: 0.025 },
    { x: 0.13, y: y - 0.08, z: -0.15, out: 0.36, reach: -0.24, lift: 0.14, r: 0.025 },
  ], mats.belly, 5);
  shuffleLegs(ctx, legs, 0.12, 2.4);
  const mouth = new Group();
  mouth.position.set(0, y - 0.12, 0.26);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const tooth = cone(0.018, 0.08, mats.white, 4);
    tooth.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.05, 0.02);
    tooth.rotation.x = Math.PI / 2;
    mouth.add(tooth);
  }
  mouth.add(ball(0.055, mats.dark, 1, 0.8, 0.5, 8));
  root.add(mouth);
  const n = Math.max(2, Math.min(5, t.eyestalks || 2 + Math.floor(rng() * 3)));
  const stalks: Group[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = spike(0.28 + rng() * 0.12, 0.014, 0.6, mats.skin, 3, 5);
    const a = (i / n) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.1, y + 0.16, Math.sin(a) * 0.14 + 0.02);
    s.rotation.x = Math.sin(a) * 0.5;
    s.rotation.z = -Math.cos(a) * 0.5;
    root.add(s);
    const eye = ball(0.04, mats.eye, 1, 1, 1, 8);
    eye.position.set(0, 0.3, 0);
    s.children[0]?.add(eye);
    stalks.push(s);
  }
  const base = stalks.map((s) => [s.rotation.x, s.rotation.z] as const);
  tick(ctx, (time) => {
    stalks.forEach((s, i) => {
      s.rotation.x = base[i]![0] + 0.12 * Math.sin(time * 1.6 + i * 1.3 + ctx.phase);
      s.rotation.z = base[i]![1] + 0.12 * Math.sin(time * 1.3 + i * 2.1 + ctx.phase);
    });
    root.position.y = 0;
  });
}

// ---------------------------------------------------------------------------
// spiders, scorpions, crabs

type ArachKind = "spider" | "scorpion" | "crab" | "lobster" | "tick" | "harvestman";

function arachKind(name: string): ArachKind {
  if (/scorpion/.test(name)) return "scorpion";
  if (/lobster|crayfish|crawfish|chuul|reefclaw|mantis shrimp/.test(name)) return "lobster";
  if (/crab/.test(name)) return "crab";
  if (/\btick\b|\bmite\b/.test(name)) return "tick";
  if (/harvestman/.test(name)) return "harvestman";
  return "spider";
}

// A crab/scorpion pincer: palm plus a fixed and a moving finger. Faces +Z.
function pincer(ctx: Ctx, size: number, side: number, mat: MeshStandardMaterial): { g: Group; jaw: Group } {
  const g = new Group();
  const palm = ball(0.1 * size, mat, 1, 0.75, 1.5, 10);
  g.add(palm);
  const fixed = cone(0.045 * size, 0.3 * size, mat, 5);
  fixed.rotation.x = Math.PI / 2;
  fixed.position.set(0.04 * size * side, 0, 0.2 * size);
  g.add(fixed);
  const jaw = new Group();
  jaw.position.set(-0.04 * size * side, 0, 0.1 * size);
  const finger = cone(0.04 * size, 0.28 * size, mat, 5);
  finger.rotation.x = Math.PI / 2;
  finger.position.z = 0.15 * size;
  jaw.add(finger);
  g.add(jaw);
  void ctx;
  return { g, jaw };
}

export function buildOctopod(ctx: Ctx): void {
  const { mats, root, rng } = ctx;
  const name = nameOf(ctx);
  const kind = arachKind(name);
  const phase = ctx.phase;
  const legMat = mats.skin;

  if (kind === "spider" || kind === "harvestman") {
    const harvest = kind === "harvestman";
    const cy = harvest ? 0.55 : 0.4;
    const thorax = ball(1, mats.skin, harvest ? 0.1 : 0.2, harvest ? 0.06 : 0.14, harvest ? 0.12 : 0.26, 12);
    thorax.position.set(0, cy, 0.2);
    root.add(thorax);
    const abdomen = new Group();
    abdomen.position.set(0, cy + (harvest ? 0 : 0.06), harvest ? -0.1 : -0.3);
    abdomen.add(ball(1, mats.skin, harvest ? 0.1 : 0.31, harvest ? 0.08 : 0.28, harvest ? 0.14 : 0.4, 12));
    if (!harvest) {
      const nSpots = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < nSpots; i += 1) {
        const spot = ball(1, i === 0 ? mats.glow : mats.belly, 0.06 + rng() * 0.05, 0.02, 0.07 + rng() * 0.05, 8);
        spot.position.set((rng() - 0.5) * 0.24, 0.26 - Math.abs((rng() - 0.5) * 0.1) - (i === 0 ? 0 : 0.03), -0.28 + i * 0.16);
        spot.visible = i !== 0 || /widow|glow/.test(name);
        abdomen.add(spot);
      }
    }
    root.add(abdomen);
    // eyes
    const eyes: Array<[number, number, number, number]> = [[0.05, 0.05, 0.42, 0.028], [0.11, 0.03, 0.38, 0.022], [0.06, 0.1, 0.36, 0.03], [0.13, 0.08, 0.3, 0.02]];
    if (!harvest) {
      for (const [x, y, z, r] of eyes) {
        for (const side of [1, -1]) {
          const e = ball(r, mats.eye, 1, 1, 1, 8);
          e.position.set(x * side, cy + y, z);
          root.add(e);
        }
      }
      for (const side of [1, -1]) {
        const ch = spike(0.16, 0.05, 0.7, mats.skin, 3, 6);
        ch.rotation.x = Math.PI - 0.4;
        ch.position.set(0.07 * side, cy - 0.06, 0.42);
        root.add(ch);
        const fang = cone(0.014, 0.08, mats.white, 4);
        fang.rotation.x = Math.PI - 0.3;
        fang.position.set(0.07 * side, cy - 0.28, 0.5);
        root.add(fang);
        root.add(segment(new Vector3(0.11 * side, cy - 0.02, 0.44), new Vector3(0.15 * side, cy - 0.06, 0.68), 0.025, 0.018, mats.skin, 5));
      }
    }
    const legs = harvest
      ? addLegs(root, [
        { x: 0.07, y: cy, z: 0.28, out: 1.1, reach: 0.9, lift: 0.5, r: 0.01 },
        { x: 0.08, y: cy, z: 0.2, out: 1.2, reach: 0.3, lift: 0.55, r: 0.01 },
        { x: 0.08, y: cy, z: 0.12, out: 1.2, reach: -0.3, lift: 0.55, r: 0.01 },
        { x: 0.07, y: cy, z: 0.04, out: 1.1, reach: -0.9, lift: 0.5, r: 0.01 },
      ], legMat, 4)
      : addLegs(root, [
        { x: 0.14, y: cy, z: 0.36, out: 0.78, reach: 0.68, lift: 0.42, r: 0.03 },
        { x: 0.16, y: cy, z: 0.26, out: 0.86, reach: 0.28, lift: 0.46, r: 0.03 },
        { x: 0.16, y: cy, z: 0.16, out: 0.84, reach: -0.14, lift: 0.46, r: 0.03 },
        { x: 0.14, y: cy, z: 0.06, out: 0.76, reach: -0.6, lift: 0.4, r: 0.03 },
      ], legMat, 6);
    shuffleLegs(ctx, legs, 0.07, 1.7);
    tick(ctx, (time) => {
      const b = Math.sin(time * 1.6 + phase);
      abdomen.scale.set(1 + 0.02 * b, 1 + 0.03 * b, 1);
      abdomen.rotation.x = 0.04 * Math.sin(time * 0.8 + phase);
    });
    return;
  }

  if (kind === "scorpion") {
    const y = 0.16;
    const shield = ball(1, mats.skin, 0.2, 0.09, 0.22, 12);
    shield.position.set(0, y, 0.3);
    root.add(shield);
    for (const side of [1, -1]) {
      const eye = ball(0.03, mats.eye, 1, 1, 1, 8);
      eye.position.set(0.06 * side, y + 0.08, 0.36);
      root.add(eye);
    }
    for (let i = 0; i < 5; i += 1) {
      const seg = ball(1, i % 2 ? mats.belly : mats.skin, 0.19 - i * 0.012, 0.08, 0.1, 10);
      seg.position.set(0, y, 0.12 - i * 0.11);
      root.add(seg);
    }
    const tail = chain(7, 0.85, 0.075, 0.04, mats.skin, 7);
    tail.root.position.set(0, y + 0.02, -0.4);
    aim(tail.root, new Vector3(0, 0.25, -1));
    tail.segs.forEach((sg) => { sg.rotation.x = 0.36; });
    root.add(tail.root);
    const bulb = ball(0.075, mats.skin, 1, 1, 1.3, 8);
    tail.tip.add(bulb);
    const sting = spike(0.16, 0.035, 0.9, mats.dark, 3, 5);
    sting.rotation.x = -Math.PI / 2 - 0.2;
    tail.tip.add(sting);
    const rest = tail.segs.map((sg) => sg.rotation.x);
    tick(ctx, (time) => {
      tail.segs.forEach((sg, i) => {
        sg.rotation.x = rest[i]! + 0.06 * Math.sin(time * 1.5 - i * 0.5 + phase);
        sg.rotation.y = 0.05 * Math.sin(time * 1.1 - i * 0.4 + phase);
      });
    });
    const jaws: Array<{ jaw: Group; side: number }> = [];
    const arms: Group[] = [];
    for (const side of [1, -1]) {
      const g = new Group();
      const a = new Vector3(0.12 * side, y, 0.42);
      const b = new Vector3(0.3 * side, y + 0.02, 0.58);
      const c = new Vector3(0.24 * side, y + 0.02, 0.82);
      g.add(limb(a, b, c, 0.045, 0.04, 0.035, mats.skin, 6));
      const { g: claw, jaw } = pincer(ctx, 1.0, side, mats.skin);
      claw.position.copy(c).add(new Vector3(0, 0, 0.08));
      claw.rotation.y = -0.2 * side;
      g.add(claw);
      jaws.push({ jaw, side });
      root.add(g);
      arms.push(g);
    }
    const legs = addLegs(root, [
      { x: 0.12, y, z: 0.32, out: 0.5, reach: 0.22, lift: 0.1, r: 0.022 },
      { x: 0.14, y, z: 0.18, out: 0.52, reach: 0.06, lift: 0.1, r: 0.022 },
      { x: 0.14, y, z: 0.04, out: 0.5, reach: -0.1, lift: 0.1, r: 0.022 },
      { x: 0.13, y, z: -0.1, out: 0.48, reach: -0.26, lift: 0.1, r: 0.022 },
    ], legMat, 5);
    shuffleLegs(ctx, legs, 0.08, 2);
    tick(ctx, (time) => {
      jaws.forEach(({ jaw, side }, i) => { jaw.rotation.y = side * (0.15 + 0.3 * (0.5 + 0.5 * Math.sin(time * 1.3 + phase + i))); });
      arms.forEach((a, i) => { a.rotation.y = 0.05 * Math.sin(time * 0.9 + i + phase); });
    });
    return;
  }

  if (kind === "tick") {
    const body = ball(1, mats.skin, 0.32, 0.24, 0.36, 12);
    body.position.set(0, 0.3, -0.06);
    root.add(body);
    const head = ball(0.1, mats.dark, 1, 0.8, 1, 8);
    head.position.set(0, 0.24, 0.32);
    root.add(head);
    const legs = addLegs(root, [
      { x: 0.2, y: 0.24, z: 0.16, out: 0.42, reach: 0.22, lift: 0.14, r: 0.035 },
      { x: 0.22, y: 0.24, z: 0.05, out: 0.46, reach: 0.06, lift: 0.14, r: 0.035 },
      { x: 0.22, y: 0.24, z: -0.06, out: 0.46, reach: -0.08, lift: 0.14, r: 0.035 },
      { x: 0.2, y: 0.24, z: -0.17, out: 0.42, reach: -0.24, lift: 0.14, r: 0.035 },
    ], legMat, 6);
    shuffleLegs(ctx, legs, 0.06, 1.6);
    tick(ctx, (time) => { body.scale.set(0.32 * (1 + 0.02 * Math.sin(time * 1.4 + phase)), 0.24, 0.36); });
    return;
  }

  // crab and lobster
  const lobster = kind === "lobster";
  const chuul = /chuul/.test(name);
  const y = lobster ? 0.26 : 0.3;
  const carapace = lobster
    ? ball(1, mats.skin, 0.24, 0.2, 0.4, 12)
    : ball(1, mats.skin, 0.5, 0.17, 0.36, 12);
  carapace.position.set(0, y, lobster ? 0.28 : 0);
  root.add(carapace);
  if (!lobster) {
    const rim = ball(1, mats.belly, 0.52, 0.06, 0.38, 12);
    rim.position.set(0, y - 0.08, 0);
    root.add(rim);
  }
  if (chuul) {
    for (let i = 0; i < 4; i += 1) {
      const sp = spike(0.16, 0.03, 0.3, mats.accent, 2, 5);
      sp.position.set((i - 1.5) * 0.11, y + 0.19, 0.3 - Math.abs(i - 1.5) * 0.04);
      sp.rotation.x = -0.4;
      root.add(sp);
    }
  }
  const eyeZ = lobster ? 0.62 : 0.32;
  const eyeStalks: Group[] = [];
  for (const side of [1, -1]) {
    const st = new Group();
    st.position.set(0.11 * side, y + 0.12, eyeZ);
    st.add(segment(new Vector3(), new Vector3(0.02 * side, 0.1, 0.03), 0.018, 0.014, mats.skin, 5));
    const eye = ball(0.035, mats.eye, 1, 1, 1, 8);
    eye.position.set(0.02 * side, 0.12, 0.03);
    st.add(eye);
    root.add(st);
    eyeStalks.push(st);
  }
  let tail: Chain | null = null;
  if (lobster) {
    tail = chain(5, 0.7, 0.17, 0.08, mats.skin, 8);
    tail.root.position.set(0, y - 0.02, -0.08);
    aim(tail.root, new Vector3(0, -0.12, -1));
    root.add(tail.root);
    for (const a of [-0.5, 0, 0.5]) {
      const fan = ball(1, mats.belly, 0.08, 0.018, 0.16, 8);
      fan.rotation.y = a;
      fan.position.set(Math.sin(a) * 0.1, 0, -0.08);
      tail.tip.add(fan);
    }
    wave(ctx, tail, { yaw: 0.08, pitch: 0.07, speed: 1.2, lag: 0.45 });
    // antennae
    for (const side of [1, -1]) {
      const ant = spike(0.7, 0.012, -0.5, mats.dark, 4, 4);
      ant.rotation.x = 1.2;
      ant.rotation.z = -0.25 * side;
      ant.position.set(0.06 * side, y + 0.1, 0.62);
      root.add(ant);
    }
  }
  if (chuul) {
    const tents: Chain[] = [];
    for (let i = 0; i < 4; i += 1) {
      const tt = chain(5, 0.32, 0.024, 0.008, mats.skin, 5);
      tt.root.position.set((i - 1.5) * 0.05, y - 0.06, 0.66);
      aim(tt.root, new Vector3((i - 1.5) * 0.15, -0.5, 0.6));
      root.add(tt.root);
      wave(ctx, tt, { yaw: 0.25, pitch: 0.2, speed: 2, lag: 0.7, phase: i });
      tents.push(tt);
    }
  }
  const claws: Array<{ jaw: Group; side: number }> = [];
  const clawScale = lobster ? 1.5 : 1.7;
  for (const side of [1, -1]) {
    const bigger = !lobster && chance(rng, 0.4) && side === 1 ? 1.3 : 1;
    const a = new Vector3((lobster ? 0.16 : 0.42) * side, y, lobster ? 0.6 : 0.16);
    const b = new Vector3((lobster ? 0.36 : 0.75) * side, y + (lobster ? 0.02 : 0.1), lobster ? 0.85 : 0.36);
    const c = new Vector3((lobster ? 0.34 : 0.66) * side, y + (lobster ? 0.03 : 0.16), lobster ? 1.1 : 0.62);
    const arm = limb(a, b, c, 0.06, 0.05, 0.045, mats.skin, 7);
    const g = new Group();
    g.add(arm);
    const { g: claw, jaw } = pincer(ctx, clawScale * bigger, side, mats.skin);
    claw.position.copy(c).add(new Vector3(0, 0, 0.1 * clawScale));
    claw.rotation.y = -0.15 * side;
    g.add(claw);
    root.add(g);
    claws.push({ jaw, side });
  }
  const legs = lobster
    ? addLegs(root, [
      { x: 0.18, y, z: 0.5, out: 0.45, reach: 0.18, lift: 0.1, r: 0.03 },
      { x: 0.2, y, z: 0.38, out: 0.48, reach: 0.05, lift: 0.1, r: 0.03 },
      { x: 0.2, y, z: 0.26, out: 0.48, reach: -0.08, lift: 0.1, r: 0.03 },
      { x: 0.18, y, z: 0.14, out: 0.44, reach: -0.2, lift: 0.1, r: 0.03 },
    ], legMat, 6)
    : addLegs(root, [
      { x: 0.4, y, z: 0.12, out: 0.62, reach: 0.16, lift: 0.28, r: 0.035 },
      { x: 0.44, y, z: -0.04, out: 0.66, reach: 0.0, lift: 0.3, r: 0.035 },
      { x: 0.42, y, z: -0.18, out: 0.62, reach: -0.14, lift: 0.28, r: 0.035 },
    ], legMat, 6);
  shuffleLegs(ctx, legs, 0.08, 2);
  tick(ctx, (time) => {
    claws.forEach(({ jaw, side }, i) => { jaw.rotation.y = side * (0.1 + 0.32 * (0.5 + 0.5 * Math.sin(time * 1.1 + phase + i * 1.6))); });
    eyeStalks.forEach((st, i) => { st.rotation.x = 0.15 * Math.sin(time * 1.7 + i * 2 + phase); st.rotation.z = 0.12 * Math.sin(time * 1.3 + i + phase); });
    carapace.scale.y = (lobster ? 0.2 : 0.17) * (1 + 0.03 * Math.sin(time * 1.8 + phase));
  });
  void tail;
}

// ---------------------------------------------------------------------------
// fish, sharks, whales, rays

type FishKind = "shark" | "dolphin" | "whale" | "orca" | "ray" | "seahorse" | "angler" | "fish";

function fishKind(name: string): FishKind {
  if (/seahorse|sea horse|hippocamp/.test(name)) return "seahorse";
  if (/angler/.test(name)) return "angler";
  if (/\bray\b|manta|stingray/.test(name)) return "ray";
  if (/orca|killer whale/.test(name)) return "orca";
  if (/whale|leviathan/.test(name)) return "whale";
  if (/dolphin/.test(name)) return "dolphin";
  if (/shark|megalodon/.test(name)) return "shark";
  return "fish";
}

// A fin lying in the YZ plane: points are (distance back, height).
function verticalFin(points: Array<[number, number]>, mat: MeshStandardMaterial): Mesh {
  const m = flatShape(points, mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

// A fin lying in the XZ plane: points are (distance out, distance back).
function horizontalFin(points: Array<[number, number]>, mat: MeshStandardMaterial): Mesh {
  const m = flatShape(points, mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

interface TorpedoCfg {
  y: number; rx: number; ry: number; rz: number; snout: number; tailLen: number;
  fluke: boolean; dorsal: number; curved: boolean; flipper: number; teeth: boolean; gills: boolean;
  fork: boolean; eyeR: number; blowhole?: boolean; orca?: boolean;
}

function buildTorpedo(ctx: Ctx, c: TorpedoCfg): void {
  const { mats, root } = ctx;
  const phase = ctx.phase;
  const { y, rx, ry, rz } = c;
  const fishG = new Group();
  root.add(fishG);

  const black = stdMat("#15161a", { roughness: 0.5 });
  const white = stdMat("#eef0f2", { roughness: 0.5 });
  const top = c.orca ? black : mats.skin;
  const under = c.orca ? white : mats.belly;

  const torso = ball(1, top, rx, ry, rz, 16);
  torso.position.set(0, y, 0);
  fishG.add(torso);
  const belly = ball(1, under, rx * 0.93, ry * 0.62, rz * 0.95, 14);
  belly.position.set(0, y - ry * 0.38, rz * 0.04);
  fishG.add(belly);
  if (c.snout > 0) {
    const sn = cone(rx * 0.72, c.snout, top, 10);
    sn.rotation.x = Math.PI / 2;
    sn.position.set(0, y - ry * 0.05, rz * 0.92 + c.snout / 2 - 0.05);
    fishG.add(sn);
    const jaw = cone(rx * 0.5, c.snout * 0.85, under, 8);
    jaw.rotation.x = Math.PI / 2;
    jaw.position.set(0, y - ry * 0.32, rz * 0.9 + c.snout * 0.4);
    fishG.add(jaw);
  }
  // mouth and teeth
  const mouthZ = rz * 0.8 + c.snout * 0.35;
  const mouth = box(rx * 0.85, 0.018, Math.max(0.16, c.snout * 0.55), mats.dark);
  mouth.position.set(0, y - ry * (c.snout > 0 ? 0.44 : 0.3), mouthZ + (c.snout > 0 ? 0.05 : 0.02));
  fishG.add(mouth);
  if (c.teeth) {
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 ? 1 : -1;
      const t = cone(0.012 + rx * 0.02, 0.05 + rx * 0.08, mats.white, 4);
      t.rotation.x = Math.PI;
      t.position.set(side * rx * 0.28 * Math.ceil(i / 2) * 0.55, y - ry * (c.snout > 0 ? 0.42 : 0.3), mouthZ + 0.12 - Math.floor(i / 2) * 0.03 + (c.snout > 0 ? 0.08 : 0.02));
      fishG.add(t);
    }
  }
  // eyes
  for (const side of [1, -1]) {
    const socket = new Group(), globe = new Group();
    globe.rotation.x = -Math.PI / 2;
    const eye = ball(c.eyeR, mats.white, 1, 1, 0.7, 8);
    const pupil = ball(c.eyeR * 0.55, mats.eye, 1, 1, 0.7, 8);
    pupil.position.z = c.eyeR * .65;
    globe.add(eye, pupil);
    socket.add(globe);
    mountSurface(torso, socket, new Vector3(rx * .80 * side, y + ry * .22, rz * .62), new Vector3(side, 0, 0), c.eyeR * .3);
    if (c.orca) {
      const patch = ball(rx * 0.22, white, 0.5, 0.9, 1.4, 8);
      patch.position.set(rx * 0.86 * side, y + ry * 0.32, rz * 0.6);
      patch.rotation.y = 0.25 * side;
      fishG.add(patch);
    }
    if (c.gills) {
      for (let g = 0; g < 4; g += 1) {
        const slit = box(ry * .5, .008, .012, mats.dark);
        mountSurface(torso, slit, new Vector3(rx * .80 * side, y, rz * (.42 - g * .06)), new Vector3(side, 0, 0), .002);
      }
    }
  }
  if (c.blowhole) {
    const bh = ball(0.05, mats.dark, 1, 0.3, 1, 8);
    mountSurface(torso, bh, new Vector3(0, y, rz * .5), new Vector3(0, 1, 0), .004);
  }
  // dorsal fin
  if (c.dorsal > 0) {
    const h = c.dorsal;
    const pts: Array<[number, number]> = c.curved
      ? [[0, 0], [h * 0.35, h * 0.55], [h * 0.75, h * 0.98], [h * 0.9, h * 1.0], [h * 0.55, h * 0.45], [h * 0.9, 0]]
      : [[0, 0], [h * 0.7, h], [h * 1.0, 0.0]];
    const fin = verticalFin(c.fork ? [[0, 0], [h * 0.3, h], [h * 0.55, h * 0.8], [h * 1.2, 0]] : pts, mats.skin);
    fin.position.set(0, y + ry * 0.85, rz * (c.fork ? 0.35 : 0.18));
    fishG.add(fin);
  }
  // flippers / pectoral fins
  const fins: Group[] = [];
  const f = c.flipper;
  for (const side of [1, -1]) {
    const pivot = new Group();
    pivot.position.set(rx * 0.85 * side, y - ry * 0.35, rz * 0.32);
    const pts: Array<[number, number]> = [[0, 0.02], [f * 0.6 * side, f * 0.28], [f * 0.85 * side, f * 0.75], [f * 0.5 * side, f * 0.55], [0, f * 0.4]];
    pivot.add(horizontalFin(pts, mats.skin));
    pivot.rotation.z = -side * 0.55;
    fishG.add(pivot);
    fins.push(pivot);
  }
  // tail
  const tail = profileChain(6, c.tailLen, (u) => Math.max(0.025, ry * 0.72 * (1 - u * 0.86)), top, 8);
  tail.root.position.set(0, y, -rz * 0.9);
  fishG.add(tail.root);
  const tl = c.tailLen;
  if (c.fluke) {
    for (const side of [1, -1]) {
      const fl = horizontalFin([[0, 0.02], [tl * 0.55 * side, tl * 0.28], [tl * 0.62 * side, tl * 0.08], [tl * 0.24 * side, -tl * 0.02]].map(([a, b]) => [a!, -b!] as [number, number]).reverse(), mats.skin);
      fl.position.z = 0;
      tail.tip.add(fl);
    }
  } else {
    const h = Math.max(ry * 1.25, tl * 0.4);
    const fl = Math.max(ry * 1.5, tl * 0.32);
    const tf = verticalFin(c.fork
      ? [[0, 0], [fl, h], [fl * 0.65, 0.02], [fl, -h]]
      : [[0, 0], [fl, h * 0.9], [fl * 1.2, 0], [fl, -h * 0.9]], mats.skin);
    tf.position.z = 0;
    tail.tip.add(tf);
  }
  wave(ctx, tail, { yaw: c.fluke ? 0.03 : 0.2, pitch: c.fluke ? 0.16 : 0.02, speed: c.fluke ? 1.5 : 2.4, lag: 0.5 });
  tick(ctx, (time) => {
    fishG.position.y = 0.03 * Math.sin(time * 1.2 + phase);
    fishG.rotation.y = 0.05 * Math.sin(time * 0.8 + phase);
    fishG.rotation.z = 0.02 * Math.sin(time * 1.1 + phase);
    fins.forEach((p, i) => { p.rotation.z = -(i === 0 ? 1 : -1) * (0.55 + 0.14 * Math.sin(time * 2.2 + phase + i)); });
    torso.scale.set(rx * (1 + 0.012 * Math.sin(time * 1.6 + phase)), ry, rz);
  });
}

function buildRay(ctx: Ctx): void {
  const { mats, root } = ctx;
  const y = 0.32;
  const phase = ctx.phase;
  const g = new Group();
  g.rotation.x = -0.3;
  root.add(g);
  const disc = ball(1, mats.skin, 0.36, 0.1, 0.5, 14);
  disc.position.y = y;
  g.add(disc);
  const under = ball(1, mats.belly, 0.34, 0.05, 0.48, 12);
  under.position.y = y - 0.05;
  g.add(under);
  const pivots: Group[] = [];
  for (const side of [1, -1]) {
    const pv = new Group();
    pv.position.set(0.2 * side, y, 0);
    const wing = ball(1, mats.skin, 0.65, 0.035, 0.48, 12);
    wing.position.x = 0.5 * side;
    wing.rotation.y = -0.25 * side;
    pv.add(wing);
    const wbelly = ball(1, mats.belly, 0.6, 0.02, 0.42, 10);
    wbelly.position.set(0.5 * side, -0.025, 0);
    wbelly.rotation.y = -0.25 * side;
    pv.add(wbelly);
    const tip = cone(0.06, 0.28, mats.skin, 4);
    tip.rotation.z = -Math.PI / 2 * side;
    tip.position.set(1.14 * side, 0, -0.12);
    pv.add(tip);
    g.add(pv);
    pivots.push(pv);
    const lobe = cone(0.05, 0.24, mats.skin, 5);
    lobe.rotation.x = Math.PI / 2;
    lobe.position.set(0.14 * side, y, 0.6);
    g.add(lobe);
    const eye = ball(0.035, mats.eye, 1, 1, 1, 8);
    eye.position.set(0.18 * side, y + 0.08, 0.34);
    g.add(eye);
  }
  const mouth = ball(1, mats.dark, 0.12, 0.02, 0.05, 8);
  mouth.position.set(0, y - 0.09, 0.42);
  g.add(mouth);
  const tail = profileChain(6, 0.95, (u) => 0.05 * (1 - u * 0.85) + 0.008, mats.skin, 5);
  tail.root.position.set(0, y, -0.45);
  g.add(tail.root);
  wave(ctx, tail, { yaw: 0.1, pitch: 0.08, speed: 1.6, lag: 0.5 });
  tick(ctx, (time) => {
    pivots.forEach((pv, i) => { pv.rotation.z = (i === 0 ? 1 : -1) * 0.14 * Math.sin(time * 1.7 + phase); });
    g.position.y = 0.04 * Math.sin(time * 1.1 + phase);
  });
}

function buildSeahorse(ctx: Ctx): void {
  const { mats, root } = ctx;
  const phase = ctx.phase;
  const g = new Group();
  root.add(g);
  const torso = ball(1, mats.skin, 0.2, 0.3, 0.2, 12);
  torso.position.set(0, 0.85, 0);
  g.add(torso);
  const belly = ball(1, mats.belly, 0.18, 0.22, 0.17, 10);
  belly.position.set(0, 0.8, 0.06);
  g.add(belly);
  for (let i = 0; i < 5; i += 1) {
    const ring = torus(0.15, 0.012, mats.belly, Math.PI * 2, 4, 12);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.68 + i * 0.09, 0.02);
    g.add(ring);
  }
  const neckB = ball(1, mats.skin, 0.13, 0.2, 0.13, 10);
  neckB.position.set(0, 1.08, 0.03);
  neckB.rotation.x = 0.4;
  g.add(neckB);
  const head = new Group();
  head.position.set(0, 1.24, 0.08);
  head.add(ball(0.11, mats.skin, 0.9, 1, 1.1, 10));
  const snout = cyl(0.03, 0.045, 0.3, mats.skin, 6);
  snout.rotation.x = Math.PI / 2 - 0.15;
  snout.position.set(0, -0.02, 0.22);
  head.add(snout);
  for (const side of [1, -1]) {
    const eye = ball(0.03, mats.eye, 1, 1, 1, 8);
    eye.position.set(0.085 * side, 0.03, 0.05);
    head.add(eye);
  }
  for (let i = 0; i < 3; i += 1) {
    const crest = cone(0.025, 0.11, mats.belly, 4);
    crest.position.set(0, 0.11, -0.05 - i * 0.045);
    crest.rotation.x = -0.5;
    head.add(crest);
  }
  g.add(head);
  const tail = profileChain(8, 0.9, (u) => 0.12 * (1 - u * 0.85) + 0.01, mats.skin, 6);
  tail.root.position.set(0, 0.66, -0.02);
  aim(tail.root, new Vector3(0, -1, -0.15));
  tail.segs.forEach((sg) => { sg.rotation.x = -0.42; });
  g.add(tail.root);
  const fin = verticalFin([[0, 0], [0.16, 0.16], [0.3, 0.02], [0.22, -0.12], [0.05, -0.12]], mats.belly);
  fin.position.set(0, 0.86, -0.19);
  fin.rotation.z = 0;
  g.add(fin);
  const rest = tail.segs.map((sg) => sg.rotation.x);
  tick(ctx, (time) => {
    tail.segs.forEach((sg, i) => { sg.rotation.x = rest[i]! + 0.07 * Math.sin(time * 1.3 - i * 0.5 + phase); });
    g.position.y = 0.04 * Math.sin(time * 1.1 + phase);
    fin.scale.z = 1 + 0.18 * Math.sin(time * 9 + phase);
    head.rotation.x = 0.06 * Math.sin(time * 1.4 + phase);
  });
}

function buildAngler(ctx: Ctx): void {
  const { mats, root } = ctx;
  const phase = ctx.phase;
  const y = 0.5;
  const g = new Group();
  root.add(g);
  const body = ball(1, mats.skin, 0.42, 0.38, 0.5, 14);
  body.position.y = y;
  g.add(body);
  const jaw = ball(1, mats.belly, 0.36, 0.14, 0.34, 10);
  jaw.position.set(0, y - 0.27, 0.34);
  g.add(jaw);
  const mouthDark = ball(1, mats.dark, 0.34, 0.1, 0.3, 10);
  mouthDark.position.set(0, y - 0.15, 0.42);
  g.add(mouthDark);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 11 - 0.5) * 2.2;
    const up = cone(0.017, 0.11, mats.white, 4);
    up.rotation.x = Math.PI;
    up.position.set(Math.sin(a) * 0.3, y - 0.11, 0.42 + Math.cos(a) * 0.14);
    g.add(up);
    const low = cone(0.017, 0.12, mats.white, 4);
    low.position.set(Math.sin(a) * 0.28, y - 0.2, 0.44 + Math.cos(a) * 0.14);
    g.add(low);
  }
  for (const side of [1, -1]) {
    const eye = ball(0.05, mats.white, 1, 1, 0.8, 8);
    eye.position.set(0.31 * side, y + 0.16, 0.36);
    g.add(eye);
    const pupil = ball(0.028, mats.dark, 1, 1, 0.8, 6);
    pupil.position.set(0.34 * side, y + 0.16, 0.39);
    g.add(pupil);
  }
  const lure = chain(4, 0.5, 0.018, 0.008, mats.dark, 5);
  lure.root.position.set(0, y + 0.34, 0.3);
  aim(lure.root, new Vector3(0, 1, 0.5));
  lure.segs.forEach((sg, i) => { sg.rotation.x = i === 0 ? 0 : 0.5; });
  g.add(lure.root);
  const bulb = ball(0.06, mats.glow, 1, 1, 1, 10);
  lure.tip.add(bulb);
  const rest = lure.segs.map((sg) => sg.rotation.x);
  const tail = profileChain(4, 0.4, (u) => 0.2 * (1 - u * 0.7), mats.skin, 6);
  tail.root.position.set(0, y - 0.02, -0.46);
  g.add(tail.root);
  const tf = verticalFin([[0, 0], [0.2, 0.2], [0.16, 0], [0.2, -0.2]], mats.skin);
  tail.tip.add(tf);
  wave(ctx, tail, { yaw: 0.2, speed: 2, lag: 0.5 });
  for (const side of [1, -1]) {
    const pf = horizontalFin([[0, 0], [0.22 * side, 0.1], [0.24 * side, 0.26], [0, 0.18]], mats.skin);
    pf.position.set(0.4 * side, y - 0.1, 0.08);
    g.add(pf);
  }
  tick(ctx, (time) => {
    lure.segs.forEach((sg, i) => { sg.rotation.x = rest[i]! + 0.1 * Math.sin(time * 1.8 - i * 0.6 + phase); });
    g.position.y = 0.04 * Math.sin(time * 1.1 + phase);
    bulb.scale.setScalar(1 + 0.2 * Math.sin(time * 3 + phase));
  });
}

export function buildFish(ctx: Ctx): void {
  const name = nameOf(ctx);
  const kind = fishKind(name);
  switch (kind) {
    case "ray": return buildRay(ctx);
    case "seahorse": return buildSeahorse(ctx);
    case "angler": return buildAngler(ctx);
    case "shark":
      return buildTorpedo(ctx, { y: 0.5, rx: 0.25, ry: 0.25, rz: 0.82, snout: 0.38, tailLen: 1.0, fluke: false, dorsal: 0.5, curved: false, flipper: 0.55, teeth: true, gills: true, fork: false, eyeR: 0.035 });
    case "dolphin":
      return buildTorpedo(ctx, { y: 0.5, rx: 0.22, ry: 0.23, rz: 0.62, snout: 0.3, tailLen: 0.75, fluke: true, dorsal: 0.32, curved: true, flipper: 0.32, teeth: false, gills: false, fork: false, eyeR: 0.03 });
    case "orca":
      return buildTorpedo(ctx, { y: 0.55, rx: 0.36, ry: 0.36, rz: 1.0, snout: 0.0, tailLen: 1.0, fluke: true, dorsal: 0.6, curved: true, flipper: 0.5, teeth: false, gills: false, fork: false, eyeR: 0.035, blowhole: true, orca: true });
    case "whale":
      return buildTorpedo(ctx, { y: 0.6, rx: 0.5, ry: 0.46, rz: 1.1, snout: 0.0, tailLen: 1.2, fluke: true, dorsal: 0.16, curved: true, flipper: 0.6, teeth: false, gills: false, fork: false, eyeR: 0.04, blowhole: true });
    default: {
      const bite = /piranha|quipper|barracuda|pike/.test(name);
      return buildTorpedo(ctx, { y: 0.4, rx: 0.15, ry: 0.27, rz: 0.5, snout: 0.0, tailLen: 0.42, fluke: false, dorsal: 0.32, curved: false, flipper: 0.2, teeth: bite, gills: false, fork: true, eyeR: 0.055 });
    }
  }
}

// ---------------------------------------------------------------------------
// snakes, worms, centipedes

type SerpKind = "snake" | "cobra" | "python" | "worm" | "eel" | "centipede" | "millipede" | "grub" | "couatl" | "legworm";

function serpKind(name: string): SerpKind {
  if (/couatl|amphisbaena|feathered serpent|quetzal/.test(name)) return "couatl";
  if (/cobra/.test(name)) return "cobra";
  if (/python|constrictor|anaconda|\bboa\b/.test(name)) return "python";
  if (/ankheg|carrion crawler|remorhaz|behir|tarrasque/.test(name)) return "legworm";
  if (/centipede/.test(name)) return "centipede";
  if (/millipede/.test(name)) return "millipede";
  if (/caterpillar|larva|maggot|slug|leech/.test(name)) return "grub";
  if (/\beels?\b|lamprey/.test(name)) return "eel";
  if (/worm/.test(name)) return "worm";
  return "snake";
}

interface SerpCfg {
  n: number; length: number; rmax: number; rear: number; a: number;
  yaw: number; pitch: number; speed: number; lag: number; bias: number;
}

const SERP_CFG: Record<SerpKind, SerpCfg> = {
  snake: { n: 16, length: 1.8, rmax: 0.09, rear: 4, a: 0.26, yaw: 0.18, pitch: 0.02, speed: 1.3, lag: 0.6, bias: 0.17 },
  cobra: { n: 16, length: 1.9, rmax: 0.09, rear: 4, a: 0.32, yaw: 0.14, pitch: 0.02, speed: 1.1, lag: 0.5, bias: 0.12 },
  python: { n: 16, length: 2.1, rmax: 0.15, rear: 3, a: 0.22, yaw: 0.13, pitch: 0.02, speed: 0.9, lag: 0.6, bias: 0.2 },
  worm: { n: 14, length: 2.6, rmax: 0.3, rear: 4, a: 0.26, yaw: 0.07, pitch: 0.03, speed: 0.7, lag: 0.4, bias: 0.05 },
  eel: { n: 20, length: 2.0, rmax: 0.09, rear: 0, a: 0, yaw: 0.26, pitch: 0.02, speed: 2.2, lag: 0.5, bias: 0 },
  centipede: { n: 14, length: 1.6, rmax: 0.09, rear: 2, a: 0.12, yaw: 0.1, pitch: 0.02, speed: 1.6, lag: 0.5, bias: 0.06 },
  millipede: { n: 18, length: 1.6, rmax: 0.1, rear: 2, a: 0.12, yaw: 0.08, pitch: 0.02, speed: 1.3, lag: 0.5, bias: 0.1 },
  grub: { n: 8, length: 1.1, rmax: 0.2, rear: 2, a: 0.12, yaw: 0.05, pitch: 0.16, speed: 1.2, lag: 0.7, bias: 0 },
  couatl: { n: 16, length: 2.0, rmax: 0.1, rear: 4, a: 0.28, yaw: 0.14, pitch: 0.02, speed: 1.0, lag: 0.5, bias: 0.14 },
  legworm: { n: 12, length: 2.0, rmax: 0.2, rear: 3, a: 0.2, yaw: 0.08, pitch: 0.02, speed: 0.9, lag: 0.5, bias: 0 },
};

export function buildSerpent(ctx: Ctx): void {
  const name = nameOf(ctx);
  const { mats, root, rng } = ctx;
  const phase = ctx.phase;
  const kind = serpKind(name);
  const cfg = { ...SERP_CFG[kind] };
  if (kind === "legworm" && /tarrasque/.test(name)) { cfg.rmax = 0.34; cfg.length = 2.2; cfg.n = 9; }
  if (kind === "legworm" && /ankheg/.test(name)) { cfg.n = 8; cfg.length = 1.4; cfg.rmax = 0.18; }
  if (kind === "legworm" && /carrion crawler/.test(name)) { cfg.n = 9; cfg.length = 1.5; cfg.rmax = 0.15; }
  const { n, rmax } = cfg;
  const segLen = cfg.length / n;
  const profile = (u: number): number => {
    let base: number;
    switch (kind) {
      case "grub": base = 0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.76 * u)); break;
      case "eel": base = Math.min(1, 0.55 + 3 * u) * (1 - 0.8 * Math.pow(Math.max(0, (u - 0.7) / 0.3), 1.2)); break;
      case "centipede": case "millipede": base = 0.85 * (1 - 0.5 * Math.max(0, (u - 0.7) / 0.3)); break;
      case "worm": case "legworm": base = Math.min(1, 0.7 + 2 * u) * (1 - 0.85 * Math.pow(Math.max(0, (u - 0.6) / 0.4), 1.4)); break;
      default: base = Math.min(1, 0.42 + 3 * u) * (1 - 0.92 * Math.pow(Math.max(0, (u - 0.55) / 0.45), 1.2));
    }
    return Math.max(0.012, rmax * base);
  };
  const body = profileChain(n, cfg.length, profile, mats.skin, kind === "worm" || kind === "legworm" || kind === "grub" ? 10 : 8);
  body.root.position.set(0, 0.55, 0.9);
  root.add(body.root);

  // static pose: rear up at the head, then lay the rest flat
  const base = body.segs.map((_, i) => (i < cfg.rear ? -cfg.a : i < cfg.rear * 2 ? cfg.a : 0));
  const flatFrom = cfg.rear * 2;
  body.segs.forEach((sg, i) => { sg.rotation.x = base[i]!; });

  // segment rings and patterns
  const ringed = kind === "worm" || kind === "grub" || kind === "millipede" || kind === "centipede" || kind === "legworm";
  const spotMat = stdMat(`#${new (mats.skin.color.constructor as new (c: number) => { multiplyScalar(n: number): unknown; getHexString(): string })(mats.skin.color.getHex()).getHexString()}`, {});
  void spotMat;
  const darkSpots = (kind === "python" || kind === "snake") && chance(rng, 0.7);
  const spotCol = mats.skin.color.clone().multiplyScalar(0.55);
  const spot = stdMat(`#${spotCol.getHexString()}`, { roughness: 0.6 });
  body.segs.forEach((sg, i) => {
    const ra = profile((i + .5) / n);
    if (ringed && i > 0) {
      const ring = torus(ra * 1.03, Math.max(0.008, ra * 0.16), i % 2 ? mats.belly : mats.skin, Math.PI * 2, 5, 14);
      ring.position.z = -segLen * 0.5;
      sg.add(ring);
    }
    if (darkSpots && i > 1 && i % 2 === 0) {
      const dot = ball(1, spot, ra * 0.7, ra * 0.16, segLen * 0.5, 8);
      mountSurface(sg.children[0] as Mesh, dot, new Vector3(0, 0, -segLen * .5), new Vector3(0, 1, 0), .004);
    }
  });

  // legs
  const legs: Array<{ g: Group; i: number; side: number }> = [];
  const legLen = kind === "legworm" ? 0.32 + rmax : kind === "millipede" ? 0.1 : 0.17;
  const legR = kind === "legworm" ? (/tarrasque/.test(name) ? 0.1 : 0.045) : kind === "millipede" ? 0.008 : 0.012;
  const legStep = kind === "legworm" ? 2 : 1;
  if (kind === "centipede" || kind === "millipede" || kind === "legworm" || (kind === "grub" && /caterpillar/.test(name))) {
    body.segs.forEach((sg, i) => {
      if (i < (kind === "legworm" ? flatFrom : 1) || i >= n - 1 || i % legStep !== 0) return;
      if (/tarrasque/.test(name) && i !== flatFrom && i !== flatFrom + 4) return;
      const ra = profile(i / n);
      for (const side of [1, -1]) {
        const g = new Group();
        g.position.set(side * ra * 0.75, -ra * 0.35, -segLen * 0.5);
        const len = kind === "grub" ? 0.08 : legLen;
        g.add(segment(new Vector3(), new Vector3(side * len * 0.55, -len, 0), legR * 1.4, legR, mats.skin, 4));
        sg.add(g);
        legs.push({ g, i, side });
      }
    });
  }

  // ----- head
  const head = new Group();
  head.position.set(0, 0, 0);
  body.root.add(head);
  const hr = Math.max(0.07, rmax * (kind === "worm" || kind === "legworm" ? 1.0 : 1.25));
  const tongues: Mesh[] = [];
  const eyeAt = (side: number, x: number, y: number, z: number, r: number) => {
    const e = ball(r, mats.eye, 1, 1, 0.8, 8);
    e.position.set(x * side, y, z);
    head.add(e);
  };
  if (kind === "worm") {
    head.add(ball(hr, mats.skin, 1, 1, 1.05, 12));
    const mouthRing = torus(hr * 0.72, hr * 0.14, mats.belly, Math.PI * 2, 5, 16);
    mouthRing.position.z = hr * 0.85;
    head.add(mouthRing);
    const inside = ball(hr * 0.66, mats.dark, 1, 1, 0.3, 12);
    inside.position.z = hr * 0.88;
    head.add(inside);
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const tooth = cone(hr * 0.06, hr * 0.32, mats.white, 4);
      tooth.rotation.x = Math.PI / 2;
      tooth.rotation.z = 0;
      tooth.position.set(Math.cos(a) * hr * 0.6, Math.sin(a) * hr * 0.6, hr * 1.0);
      tooth.lookAt(tooth.position.clone().add(new Vector3(-Math.cos(a) * 0.4, -Math.sin(a) * 0.4, 1)));
      tooth.rotateX(Math.PI / 2);
      head.add(tooth);
    }
  } else if (kind === "grub") {
    head.add(ball(hr * 0.75, mats.skin, 1, 1, 1, 10));
    if (/slug/.test(name)) {
      for (const side of [1, -1]) {
        const st = spike(hr * 1.5, hr * 0.09, 0.4, mats.skin, 3, 5);
        st.position.set(hr * 0.3 * side, hr * 0.5, hr * 0.4);
        st.rotation.x = 0.3;
        st.rotation.z = -0.25 * side;
        head.add(st);
        const eye = ball(hr * 0.13, mats.eye, 1, 1, 1, 8);
        eye.position.set(hr * 0.42 * side, hr * 1.75, hr * 0.5);
        head.add(eye);
      }
    } else if (/leech/.test(name)) {
      const sucker = torus(hr * 0.5, hr * 0.14, mats.dark, Math.PI * 2, 5, 12);
      sucker.position.z = hr * 0.7;
      head.add(sucker);
    } else {
      for (const side of [1, -1]) {
        eyeAt(side, hr * 0.42, hr * 0.25, hr * 0.55, hr * 0.15);
        const mand = spike(hr * 0.5, hr * 0.13, 1.2 * side, mats.accent, 2, 5);
        mand.rotation.x = Math.PI / 2 + 0.2;
        mand.position.set(hr * 0.18 * side, -hr * 0.35, hr * 0.62);
        head.add(mand);
      }
    }
  } else if (kind === "centipede" || kind === "millipede" || kind === "legworm") {
    head.add(ball(hr, mats.skin, 1.0, 0.75, 1.05, 10));
    const isCrawler = /carrion crawler/.test(name);
    for (const side of [1, -1]) {
      eyeAt(side, hr * 0.5, hr * 0.28, hr * 0.5, hr * 0.14);
      const mand = spike(hr * (kind === "legworm" ? 1.1 : 0.8), hr * 0.16, 1.5 * side, mats.accent, 3, 5);
      mand.rotation.x = Math.PI / 2 + 0.25;
      mand.position.set(hr * 0.25 * side, -hr * 0.3, hr * 0.75);
      head.add(mand);
      const ant = spike(hr * (kind === "legworm" ? 1.3 : 2.4), hr * 0.06, -0.8, mats.dark, 4, 4);
      ant.rotation.x = 1.0;
      ant.rotation.z = -0.4 * side;
      ant.position.set(hr * 0.3 * side, hr * 0.45, hr * 0.7);
      head.add(ant);
    }
    if (isCrawler) {
      for (let i = 0; i < 8; i += 1) {
        const tt = chain(4, 0.5, 0.02, 0.008, mats.belly, 5);
        const a = (i / 8) * Math.PI * 2;
        tt.root.position.set(Math.cos(a) * hr * 0.4, Math.sin(a) * hr * 0.3 + hr * 0.1, hr * 0.8);
        aim(tt.root, new Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45 + 0.1, 1));
        head.add(tt.root);
        wave(ctx, tt, { yaw: 0.25, pitch: 0.2, speed: 2, lag: 0.7, phase: i });
      }
    }
    if (/behir|tarrasque/.test(name)) {
      for (const side of [1, -1]) {
        const horn = spike(hr * 1.6, hr * 0.14, -0.9, mats.accent, 4, 6);
        horn.rotation.x = -0.7;
        horn.rotation.z = -0.3 * side;
        horn.position.set(hr * 0.4 * side, hr * 0.5, -hr * 0.1);
        head.add(horn);
      }
    }
    if (/tarrasque|behir/.test(name)) {
      body.segs.forEach((sg, i) => {
        if (i < 1) return;
        const ra = profile(i / n);
        const sp = cone(ra * 0.28, ra * 0.9, mats.accent, 4);
        sp.position.set(0, ra * 0.95, -segLen * 0.5);
        sg.add(sp);
      });
    }
    if (/remorhaz/.test(name)) {
      body.segs.forEach((sg, i) => {
        if (i < 2) return;
        const ra = profile(i / n);
        const fin = cone(ra * 0.5, ra * 1.4, mats.glow, 4);
        fin.position.set(0, ra * 0.95, -segLen * 0.5);
        sg.add(fin);
      });
    }
  } else if (kind === "eel") {
    head.add(ball(hr, mats.skin, 0.9, 0.85, 1.4, 10));
    const jaw = box(hr * 0.9, hr * 0.06, hr * 1.2, mats.dark);
    jaw.position.set(0, -hr * 0.28, hr * 0.5);
    head.add(jaw);
    for (const side of [1, -1]) eyeAt(side, hr * 0.62, hr * 0.28, hr * 0.5, hr * 0.14);
    for (let i = 0; i < 6; i += 1) {
      const tooth = cone(hr * 0.05, hr * 0.2, mats.white, 3);
      tooth.rotation.x = Math.PI;
      tooth.position.set((i % 2 ? 1 : -1) * hr * 0.25, -hr * 0.22, hr * (0.55 + Math.floor(i / 2) * 0.22));
      head.add(tooth);
    }
    for (const side of [1, -1]) {
      const pf = horizontalFin([[0, 0], [0.16 * side, 0.06], [0.17 * side, 0.2], [0, 0.14]], mats.belly);
      pf.position.set(hr * 0.9 * side, -hr * 0.3, -hr * 0.4);
      head.add(pf);
    }
    const rid = verticalFin([[0, 0], [0.25, 0.06], [0.7, 0.09], [1.6, 0.06], [2.2, 0]], mats.belly);
    rid.position.set(0, hr * 0.7, -hr * 0.5);
    body.root.add(rid);
  } else {
    // snakes: cobra, python, couatl, plain
    const viper = /viper|adder|\basp\b|rattlesnake|mamba/.test(name);
    const hs = kind === "python" ? 1.25 : 1;
    head.add(makeHead(ctx, { r: hr * hs, style: "beast", family: "reptilian" }));
    if (viper) {
      for (const side of [1, -1]) {
        const cheek = ball(hr * 0.6, mats.skin, 0.9, 0.7, 0.9, 8);
        cheek.position.set(hr * 0.7 * side, -hr * 0.05, -hr * 0.3);
        head.add(cheek);
      }
    }
    // forked tongue
    for (const side of [1, -1]) {
      const tg = cone(hr * 0.04, hr * 0.9, stdMat("#c42e46", { roughness: 0.5 }), 4);
      tg.rotation.x = Math.PI / 2;
      tg.rotation.z = 0.25 * side;
      tg.position.set(hr * 0.1 * side, -hr * 0.14, hr * 2.0 * hs);
      head.add(tg);
      tongues.push(tg);
    }
    if (kind === "cobra") {
      const hood = ball(hr * 1.6, mats.skin, 1, 1.5, 0.16, 12);
      hood.position.set(0, -hr * 0.3, -hr * 0.9);
      head.add(hood);
      const mark = ball(hr * 0.7, mats.belly, 1, 1.3, 0.1, 8);
      mark.rotation.x = -Math.PI / 2;
      const patch = new Group(); patch.add(mark);
      mountSurface(hood, patch, hood.position.clone(), new Vector3(0, 0, -1), .003);
    }
    if (kind === "couatl") {
      for (let i = 0; i < 4; i += 1) {
        const f = cone(hr * 0.22, hr * (2.2 - i * 0.3), mats.glow, 5);
        f.position.set((i - 1.5) * hr * 0.35, hr * 0.6, -hr * (0.6 + i * 0.2));
        f.rotation.x = -1.1;
        head.add(f);
      }
    }
  }
  if (kind === "couatl") {
    const wings = featherWings(ctx, 1.0, 0.55, { rest: 0.85, flap: 0.3, pitch: 0.1, sweep: 0.25, glow: true });
    wings.position.set(0, rmax * 0.8, -segLen * 0.4);
    wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * rmax * 0.5; });
    body.segs[4]!.add(wings);
  }

  // ----- idle
  tick(ctx, (time) => {
    body.segs.forEach((sg, i) => {
      const damp = i < cfg.rear * 2 && cfg.rear > 0 ? 0.25 : 1;
      sg.rotation.y = (i < cfg.rear * 2 ? 0 : cfg.bias) + cfg.yaw * damp * Math.sin(time * cfg.speed - i * cfg.lag + phase);
      sg.rotation.x = base[i]! + cfg.pitch * Math.sin(time * cfg.speed * 0.8 - i * cfg.lag + phase + 1.3);
    });
    head.rotation.y = 0.18 * Math.sin(time * 0.7 + phase);
    const flick = Math.max(0, Math.sin(time * 2.6 + phase));
    tongues.forEach((tg) => { tg.scale.z = 0.3 + flick * flick * 1.0; });
    legs.forEach(({ g, i, side }) => {
      g.rotation.x = 0.5 * Math.sin(time * cfg.speed * 3 - i * 0.9 + (side === 1 ? 0 : Math.PI * 0.5));
    });
  });
}

// ---------------------------------------------------------------------------
// swarms: dozens of tiny bodies drawn as instanced meshes

function ellipsoidGeo(rx: number, ry: number, rz: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new SphereGeometry(1, 8, 6);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

function coneGeo(r: number, h: number, axis: "z" | "-z", x: number, y: number, z: number): BufferGeometry {
  const g = new ConeGeometry(r, h, 5, 1);
  g.rotateX(axis === "z" ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false) ?? parts[0]!;
  if (g !== parts[0]) parts.forEach((p) => p.dispose());
  return g;
}

// A pair of wings as one V-shaped mesh; scaling it along Y flaps it.
function vWingGeo(span: number, chord: number, lift: number): BufferGeometry {
  const pts: Array<[number, number, number]> = [[0, 0, chord * 0.15], [span, lift, chord * 0.05], [span * 0.85, lift * 0.85, -chord * 0.8], [span * 0.3, 0, -chord], [0, 0, -chord * 0.4]];
  const verts: number[] = [];
  for (const side of [1, -1]) {
    for (let i = 1; i < pts.length - 1; i += 1) {
      const a = pts[0]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      verts.push(a[0] * side, a[1], a[2], b[0] * side, b[1], b[2], c[0] * side, c[1], c[2]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

export function buildSwarm(ctx: Ctx): void {
  const { mats, root, rng, t } = ctx;
  const nm = nameOf(ctx);
  const kind = t.swarmKind === "generic" && /meerkat|rodent|mole|badger|weasel|mice|mouse|lemming|jackal|hound|dog|wolves|wolf/.test(nm) ? "rat" : t.swarmKind;
  const flying = kind === "bat" || kind === "bird" || kind === "insect";
  const N = { bat: 26, bird: 22, insect: 46, rat: 34, fish: 30, snake: 20, generic: 36 }[kind];

  let bodyGeo: BufferGeometry;
  let wingGeo: BufferGeometry | null = null;
  let wingMat: MeshStandardMaterial | null = null;
  switch (kind) {
    case "bat":
      bodyGeo = merged([ellipsoidGeo(0.035, 0.03, 0.06), ellipsoidGeo(0.028, 0.026, 0.028, 0, 0.005, 0.07), coneGeo(0.014, 0.05, "z", 0.016, 0.04, 0.06), coneGeo(0.014, 0.05, "z", -0.016, 0.04, 0.06)]);
      wingGeo = vWingGeo(0.15, 0.1, 0.06);
      wingMat = mats.skin.clone();
      break;
    case "bird":
      bodyGeo = merged([ellipsoidGeo(0.04, 0.035, 0.085), ellipsoidGeo(0.028, 0.028, 0.03, 0, 0.02, 0.09), coneGeo(0.012, 0.045, "z", 0, 0.015, 0.13), coneGeo(0.03, 0.09, "-z", 0, 0, -0.14)]);
      wingGeo = vWingGeo(0.17, 0.09, 0.05);
      wingMat = mats.skin.clone();
      break;
    case "insect":
      bodyGeo = merged([ellipsoidGeo(0.014, 0.013, 0.036), ellipsoidGeo(0.012, 0.012, 0.012, 0, 0.002, 0.045)]);
      wingGeo = vWingGeo(0.05, 0.035, 0.03);
      wingMat = stdMat("#e8f3ff", { transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false });
      break;
    case "rat": {
      const tail = new CylinderGeometry(0.006, 0.012, 0.16, 5);
      tail.rotateX(Math.PI / 2 + 0.2);
      tail.translate(0, 0.03, -0.19);
      bodyGeo = merged([ellipsoidGeo(0.05, 0.045, 0.1, 0, 0.05, 0), ellipsoidGeo(0.033, 0.03, 0.045, 0, 0.055, 0.12), coneGeo(0.012, 0.04, "z", 0, 0.05, 0.17), ellipsoidGeo(0.014, 0.02, 0.008, 0.02, 0.09, 0.105), ellipsoidGeo(0.014, 0.02, 0.008, -0.02, 0.09, 0.105), tail]);
      break;
    }
    case "fish":
      bodyGeo = merged([ellipsoidGeo(0.03, 0.055, 0.12), coneGeo(0.05, 0.1, "-z", 0, 0, -0.16)]);
      break;
    case "snake": {
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 8; i += 1) {
        const r = i === 0 ? 0.03 : 0.024 - i * 0.0018;
        parts.push(ellipsoidGeo(r, r, r * 1.5, Math.sin(i * 0.9) * 0.05, r, 0.2 - i * 0.055));
      }
      bodyGeo = merged(parts);
      break;
    }
    default:
      bodyGeo = new OctahedronGeometry(0.04, 0);
  }

  const bodyMesh = new InstancedMesh(bodyGeo, mats.skin, N);
  bodyMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  bodyMesh.frustumCulled = false;
  root.add(bodyMesh);
  let wingMesh: InstancedMesh | null = null;
  if (wingGeo && wingMat) {
    wingMat.side = DoubleSide;
    wingMesh = new InstancedMesh(wingGeo, wingMat, N);
    wingMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    wingMesh.frustumCulled = false;
    root.add(wingMesh);
  }
  // Fixes the model's bounds (and so its grounding and framing) whatever the
  // swarm happens to be doing at the moment it is measured.
  const height = flying ? 1.4 : kind === "fish" ? 1.4 : 0.35;
  const proxy = new Mesh(new CylinderGeometry(0.72, 0.72, height, 6), mats.dark);
  proxy.position.y = height / 2;
  proxy.visible = false;
  root.add(proxy);

  // per-instance parameters
  const R = new Float32Array(N);
  const A = new Float32Array(N);
  const W = new Float32Array(N);
  const Y = new Float32Array(N);
  const P = new Float32Array(N);
  const Q = new Float32Array(N);
  const S = new Float32Array(N);
  const dir = kind === "bat" || kind === "bird" || kind === "fish" ? 1 : 1;
  for (let i = 0; i < N; i += 1) {
    R[i] = between(rng, kind === "rat" ? 0.06 : 0.2, kind === "rat" ? 0.55 : 0.7);
    A[i] = rng() * Math.PI * 2;
    W[i] = dir * between(rng, 0.5, 1.2) * (chance(rng, 0.12) ? -1 : 1);
    Y[i] = flying || kind === "fish" ? between(rng, 0.25, 1.15) : between(rng, 0.02, 0.2);
    P[i] = rng() * Math.PI * 2;
    Q[i] = between(rng, 0.8, 2.2);
    S[i] = between(rng, 0.8, 1.25) * (kind === "snake" ? 1.7 : kind === "insect" ? 1.7 : 1);
  }
  const dummy = new Object3D();
  const yawOf = (vx: number, vz: number) => Math.atan2(vx, vz);

  const place = (i: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, flap: number) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(pitch, yaw, roll);
    dummy.scale.setScalar(S[i]!);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(i, dummy.matrix);
    if (wingMesh) {
      dummy.scale.set(S[i]!, S[i]! * flap, S[i]!);
      dummy.updateMatrix();
      wingMesh.setMatrixAt(i, dummy.matrix);
    }
  };

  tick(ctx, (time) => {
    for (let i = 0; i < N; i += 1) {
      const w = W[i]!;
      switch (kind) {
        case "bat":
        case "bird": {
          const th = A[i]! + w * time * (kind === "bird" ? 1.1 : 0.9);
          const r = R[i]!;
          const y = Y[i]! + 0.1 * Math.sin(time * 1.3 + P[i]!);
          const vx = -Math.sin(th) * w;
          const vz = Math.cos(th) * w;
          place(i, Math.cos(th) * r, y, Math.sin(th) * r, yawOf(vx, vz), 0.12 * Math.sin(time * 2 + P[i]!), -Math.sign(w) * 0.35, Math.sin(time * (kind === "bird" ? 7 : 9) + P[i]!));
          break;
        }
        case "insect": {
          const a = Q[i]!;
          const x = 0.6 * Math.sin(time * a + P[i]!) * Math.cos(time * 0.4 + A[i]!);
          const z = 0.6 * Math.sin(time * a * 0.83 + P[i]! * 1.7);
          const y = Y[i]! + 0.22 * Math.sin(time * a * 1.3 + A[i]!);
          const vx = a * Math.cos(time * a + P[i]!);
          const vz = a * 0.83 * Math.cos(time * a * 0.83 + P[i]! * 1.7);
          place(i, x, y, z, yawOf(vx, vz), 0, 0, Math.sin(time * 45 + P[i]!));
          break;
        }
        case "fish": {
          const th = A[i]! + w * time * 0.8;
          const r = R[i]! * (0.8 + 0.2 * Math.sin(time * 0.5 + P[i]!));
          const y = Y[i]! + 0.15 * Math.sin(time * 0.9 + P[i]!);
          const vx = -Math.sin(th) * w;
          const vz = Math.cos(th) * w;
          place(i, Math.cos(th) * r, y, Math.sin(th) * r, yawOf(vx, vz) + 0.3 * Math.sin(time * 9 + P[i]!), 0, -Math.sign(w) * 0.15, 1);
          break;
        }
        case "rat": {
          const th = A[i]! + w * time * 0.9;
          const r = R[i]!;
          const y = 0.1 * (1 - r / 0.6) + Y[i]! * 0.4 + 0.012 * Math.sin(time * 9 + P[i]!);
          const vx = -Math.sin(th) * w;
          const vz = Math.cos(th) * w;
          place(i, Math.cos(th) * r, y, Math.sin(th) * r, yawOf(vx, vz), 0.06 * Math.sin(time * 9 + P[i]!), 0, 1);
          break;
        }
        case "snake": {
          const th = A[i]!;
          const r = R[i]! * 0.7;
          const y = Y[i]! * 0.7 + 0.03;
          place(i, Math.cos(th) * r, y, Math.sin(th) * r, th + 0.6 * Math.sin(time * 0.8 * (Q[i]! / 1.5) + P[i]!), 0.35 * Math.sin(time * 0.6 + P[i]!), 0.2 * Math.sin(time * 0.7 + P[i]! * 2), 1);
          break;
        }
        default: {
          const th = A[i]! + w * time * 0.7;
          const r = R[i]!;
          const y = Y[i]! + 0.15 * Math.sin(time * Q[i]! + P[i]!);
          place(i, Math.cos(th) * r, y, Math.sin(th) * r, time * Q[i]! + P[i]!, time * 0.9 * Q[i]!, 0, 1);
        }
      }
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    if (wingMesh) wingMesh.instanceMatrix.needsUpdate = true;
  });
}
