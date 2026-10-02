// The odd body plans: things that are not built like an animal or a person.
// Oozes and plant mounds, ghosts and genies, beholders and wisps, kraken and
// ropers, gelatinous cubes and mimics, whirlwinds, fungi, animated objects.
//
// Each builder adds meshes to ctx.root and registers idle animation with
// tick(). Chains here are built with a local `strand` (correct taper) and
// aimed with `orient`, which keeps a predictable "up" so a positive curl
// always bends the tip toward world-up.

import {
  CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Quaternion, SphereGeometry, TubeGeometry, Vector2, Vector3, type Material, type Object3D,
} from "three";
import {
  ball, box, capsule, cone, cyl, limb, makeHead, makeHorns, mountSurface, shard, tick, torus,
  type Chain, type Ctx,
} from "./parts";
import { between, chance, pick } from "./rng";

const TAU = Math.PI * 2;
const UPV = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);
const scratchM = new Matrix4();
const zero = new Vector3();

// ---------------------------------------------------------------------------
// local helpers

function goldMat(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: "#e0b93a", roughness: 0.3, metalness: 0.85 });
}

function glass(color: Color | string, opacity: number, emissive = 0.25): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color, transparent: true, opacity, roughness: 0.15, emissive: color, emissiveIntensity: emissive, depthWrite: false,
  });
}

function haze(color: Color | string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
}

// Points a strand (which runs along local -Z) along `dir`, keeping local +Y
// as close to world-up as possible (or world-forward for vertical strands).
function orient(obj: Object3D, dir: Vector3): void {
  const d = dir.clone().normalize();
  scratchM.lookAt(zero, d, Math.abs(d.y) > 0.97 ? FWD : UPV);
  obj.quaternion.setFromRotationMatrix(scratchM);
}

// A tapering chain of nested segments along local -Z (see parts.chain, but
// with the taper the right way round).
function strand(n: number, length: number, r0: number, r1: number, mat: Material, radial = 7): Chain {
  const root = new Group();
  const segs: Group[] = [];
  const seg = length / n;
  let parent: Group = root;
  for (let i = 0; i < n; i += 1) {
    const g = new Group();
    const ra = r0 + (r1 - r0) * (i / n);
    const rb = r0 + (r1 - r0) * ((i + 1) / n);
    const body = new Mesh(new CylinderGeometry(rb, ra, seg * 1.05, radial, 1), mat);
    body.rotation.x = -Math.PI / 2;
    body.position.z = -seg / 2;
    g.add(body);
    if (i > 0) {
      g.add(ball(ra * 1.02, mat, 1, 1, 1, 8));
      g.position.z = -seg;
    }
    parent.add(g);
    segs.push(g);
    parent = g;
  }
  const tip = new Group();
  tip.position.z = -seg;
  parent.add(tip);
  return { root, segs, tip };
}

interface SwayOpts { yaw?: number; pitch?: number; curl?: number; speed?: number; lag?: number; phase?: number }

// Sine sway down a strand with an optional resting curl (radians in total;
// positive bends the tip toward local +Y, i.e. up for oriented strands).
function sway(ctx: Ctx, c: Chain, o: SwayOpts): void {
  const { yaw = 0.15, pitch = 0.1, curl = 0, speed = 1.3, lag = 0.55, phase = ctx.phase } = o;
  const per = curl / Math.max(1, c.segs.length);
  tick(ctx, (time) => {
    for (let i = 0; i < c.segs.length; i += 1) {
      const g = c.segs[i]!;
      g.rotation.y = yaw * Math.sin(time * speed - i * lag + phase);
      g.rotation.x = per + pitch * Math.sin(time * speed * 0.8 - i * lag + phase + 1.3);
    }
  });
}

// A round eye that looks along local +Z.
function eyeball(ctx: Ctx, r: number, iris: MeshStandardMaterial = ctx.mats.eye): Group {
  const g = new Group();
  g.add(ball(r, ctx.mats.white, 1, 1, 1, 12));
  const i = ball(r * 0.62, iris, 1, 1, 0.45, 10);
  i.position.z = r * 0.72;
  const p = ball(r * 0.3, ctx.mats.dark, 1, 1, 0.5, 8);
  p.position.z = r * 0.93;
  g.add(i, p);
  return g;
}

function irisMat(ctx: Ctx): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: ctx.spec.palette.glow, emissive: ctx.spec.palette.glow, emissiveIntensity: 1.1, roughness: 0.3,
  });
}

function crownOf(r: number, gold: MeshStandardMaterial): Group {
  const g = new Group();
  const ring = torus(r * 0.98, r * 0.09, gold, TAU, 6, 16);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    const pt = cone(r * 0.11, r * 0.42, gold, 4);
    pt.position.set(Math.cos(a) * r * 0.98, r * 0.24, Math.sin(a) * r * 0.98);
    g.add(pt);
  }
  return g;
}

// Small rising spore / mote puffs around an origin.
function spores(ctx: Ctx, parent: Object3D, origin: Vector3, spread: number, rise: number, count = 9): void {
  const mat = haze(ctx.spec.palette.glow, 0.5);
  const parts: Array<{ m: Mesh; a: number; s: number; p: number; r: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const m = ball(0.022, mat, 1, 1, 1, 6);
    parent.add(m);
    parts.push({ m, a: ctx.rng() * TAU, s: between(ctx.rng, 0.6, 1.2), p: ctx.rng(), r: spread * between(ctx.rng, 0.3, 1) });
  }
  tick(ctx, (time) => {
    for (const q of parts) {
      const life = (time * 0.2 * q.s + q.p) % 1;
      const ang = q.a + life * 2.4;
      q.m.position.set(origin.x + Math.cos(ang) * q.r * (0.4 + life), origin.y + life * rise, origin.z + Math.sin(ang) * q.r * (0.4 + life));
      q.m.scale.setScalar(0.4 + Math.sin(life * Math.PI) * 1.3);
    }
  });
}

function surfaceUp(n: Vector3): Quaternion {
  return new Quaternion().setFromUnitVectors(UPV, n.clone().normalize());
}

// Places eye stalks over the top and back of a round body.
function eyeStalks(ctx: Ctx, parent: Group, center: Vector3, radius: number, count: number, len: number, iris: MeshStandardMaterial): void {
  const { rng, mats } = ctx;
  for (let i = 0; i < count; i += 1) {
    const phi = (i / count) * TAU + between(rng, -0.25, 0.25) + 0.6;
    const theta = between(rng, 0.3, 1.0);
    const d = new Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    if (d.z > 0.5) d.z = -d.z * 0.6;
    d.normalize();
    const c = strand(4, len * between(rng, 0.8, 1.2), 0.04, 0.022, mats.skin, 6);
    c.root.position.copy(center).addScaledVector(d, radius * 0.92);
    orient(c.root, d.clone().add(new Vector3(0, 0.55, 0)));
    parent.add(c.root);
    const eye = eyeball(ctx, 0.066, iris);
    eye.rotation.y = Math.PI;
    c.tip.add(eye);
    sway(ctx, c, { yaw: 0.32, pitch: 0.3, curl: between(rng, -0.3, 0.5), speed: between(rng, 0.9, 1.5), lag: 0.5, phase: i * 1.7 });
  }
}

// ---------------------------------------------------------------------------
// blob: oozes, puddings, jellies and plant mounds

export function buildBlob(ctx: Ctx): void {
  if (ctx.spec.look === "bark") buildMound(ctx);
  else buildOoze(ctx);
}

function buildOoze(ctx: Ctx): void {
  const { mats, rng, root, spec } = ctx;
  const name = spec.name.toLowerCase();
  const mouther = /gibbering|mouther/.test(name);
  const forms: Record<string, [number, number, number]> = {
    puddle: [1.4, 0.4, 1.3], dome: [1.05, 0.72, 1.0], tall: [0.78, 1.0, 0.78], mound: [1.15, 0.75, 1.1],
  };
  const formKey = mouther ? "mound" : /pudding|\btar\b|sludge|offal|flab|lurker/.test(name) ? "puddle"
    : /jelly|cube/.test(name) ? "dome" : pick(rng, ["puddle", "dome", "tall"] as const);
  const [sx, sy, sz] = forms[formKey]!;
  const R = 0.6;

  const blob = new Group();
  root.add(blob);
  const body = ball(R, mats.skin, sx, sy, sz, 24);
  body.position.y = R * sy;
  blob.add(body);
  if (formKey === "puddle" || formKey === "mound") {
    const sheet = cyl(R * sx * 1.1, R * sx * 1.18, 0.03, mats.skin, 26);
    sheet.scale.z = sz / sx;
    sheet.position.y = 0.015;
    blob.add(sheet);
  }

  const lumps: Array<{ m: Mesh; ph: number }> = [];
  const lumpCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < lumpCount; i += 1) {
    const a = (i / lumpCount) * TAU + rng() * 0.6;
    const lr = between(rng, 0.13, 0.24) * (formKey === "tall" ? 0.6 : 1);
    const rr = R * sx * 0.82 * between(rng, 0.8, 1.05);
    const m = ball(lr, mats.skin, 1, 0.8, 1, 12);
    m.position.set(Math.cos(a) * rr, lr * 0.7, Math.sin(a) * rr * (sz / sx));
    blob.add(m);
    lumps.push({ m, ph: rng() * TAU });
  }

  const nucleus = new MeshStandardMaterial({ color: mats.belly.color, roughness: 0.6 });
  const core = ball(R * 0.28, nucleus, sx * 0.9, sy * 0.85, sz * 0.9, 12);
  core.position.y = R * sy * 0.9;
  blob.add(core);

  const items: Array<{ g: Group; y: number; ph: number }> = [];
  const itemCount = mouther ? 0 : chance(rng, 0.65) ? 2 + Math.floor(rng() * 3) : 0;
  const gold = goldMat();
  for (let i = 0; i < itemCount; i += 1) {
    const g = new Group();
    const kind = pick(rng, ["skull", "bone", "coin", "coin"] as const);
    if (kind === "skull") {
      g.add(ball(0.07, mats.white, 1, 1, 1, 8));
      const jaw = box(0.07, 0.03, 0.05, mats.white);
      jaw.position.set(0, -0.06, 0.03);
      g.add(jaw);
    } else if (kind === "bone") {
      const b = capsule(0.018, 0.14, mats.white, 6);
      b.rotation.z = rng() * TAU;
      g.add(b);
    } else {
      const c = cyl(0.06, 0.06, 0.015, gold, 10);
      c.rotation.x = rng() * 1.2;
      g.add(c);
    }
    const a = rng() * TAU;
    const rr = between(rng, 0.05, 0.4) * R;
    const y = R * sy * between(rng, 0.55, 1.15);
    g.position.set(Math.cos(a) * rr * sx, y, Math.sin(a) * rr * sz);
    blob.add(g);
    items.push({ g, y, ph: rng() * TAU });
  }

  if (mouther) {
    const iris = irisMat(ctx);
    for (let i = 0; i < 12; i += 1) {
      const d = new Vector3(between(rng, -0.9, 0.9), between(rng, -0.05, 0.95), between(rng, 0.15, 1)).normalize();
      const p = new Vector3(d.x * R * sx, R * sy + d.y * R * sy, d.z * R * sz);
      const holder = new Group();
      const nrm = new Vector3(d.x / (sx * sx), d.y / (sy * sy), d.z / (sz * sz)).normalize();
      const feature = new Group();
      feature.rotation.x = -Math.PI / 2;
      holder.add(feature);
      if (i < 8) {
        feature.add(eyeball(ctx, between(rng, 0.045, 0.08), iris));
      } else {
        feature.add(ball(0.1, mats.dark, 1, 0.8, 0.35, 8));
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * TAU;
          const tooth = cone(0.014, 0.05, mats.white, 4);
          tooth.rotation.x = Math.PI / 2;
          tooth.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.06, 0.03);
          feature.add(tooth);
        }
      }
      mountSurface(body, holder, p, nrm, .015);
    }
  } else if (chance(rng, 0.3)) {
    for (const side of [1, -1]) {
      const e = eyeball(ctx, 0.07, mats.eye);
      e.rotation.x = -Math.PI / 2;
      const holder = new Group(); holder.add(e);
      mountSurface(body, holder, new Vector3(.20 * side * sx, R * sy * 1.32, R * sz * .82), new Vector3(side * .15, .15, 1), .02);
    }
  }

  tick(ctx, (time) => {
    const s = Math.sin(time * 1.7 + ctx.phase);
    blob.scale.set(1 - 0.035 * s, 1 + 0.07 * s, 1 - 0.035 * s);
    for (const l of lumps) l.m.scale.setScalar(1 + 0.2 * Math.sin(time * 2.1 + l.ph));
    for (const it of items) {
      it.g.position.y = it.y + 0.03 * Math.sin(time * 1.1 + it.ph);
      it.g.rotation.y = time * 0.4 + it.ph;
      it.g.rotation.z = 0.3 * Math.sin(time * 0.7 + it.ph);
    }
  });
}

function buildMound(ctx: Ctx): void {
  const { mats, rng, root, t } = ctx;
  const leaf = new MeshStandardMaterial({
    color: new Color().setHSL(between(rng, 0.22, 0.36), between(rng, 0.4, 0.6), between(rng, 0.22, 0.32)), roughness: 0.9, side: DoubleSide,
  });
  const heap = new Group();
  root.add(heap);
  const body = ball(0.62, mats.skin, 1.15, 0.9, 1.05, 14);
  body.position.y = 0.52;
  heap.add(body);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + 0.5;
    const lobe = ball(0.3, mats.skin, 1, 0.8, 1, 10);
    lobe.position.set(Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.5);
    heap.add(lobe);
  }

  for (let i = 0; i < 28; i += 1) {
    const th = between(rng, 0.1, 1.5);
    const ph = rng() * TAU;
    const p = new Vector3(Math.sin(th) * Math.cos(ph) * 0.71, Math.cos(th) * 0.56, Math.sin(th) * Math.sin(ph) * 0.65);
    const l = ball(1, leaf, 0.16, 0.026, 0.09, 6);
    l.name = "mound-leaf";
    mountSurface(body, l, p.clone().add(new Vector3(0, .52, 0)), new Vector3(p.x / .5, p.y / .31, p.z / .42), .015);
    l.rotateY(rng() * TAU);
  }

  const vineCount = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < vineCount; i += 1) {
    const a = (i / vineCount) * TAU + rng() * 0.4;
    const c = strand(4, between(rng, 0.55, 0.95), 0.085, 0.014, mats.skin, 6);
    c.root.position.set(Math.cos(a) * 0.55, 0.5 + rng() * 0.2, Math.sin(a) * 0.5);
    orient(c.root, new Vector3(Math.cos(a) * 0.7, 0.9 + rng() * 0.6, Math.sin(a) * 0.7));
    heap.add(c.root);
    c.tip.add(ball(1, leaf, 0.11, 0.022, 0.065, 6));
    sway(ctx, c, { yaw: 0.24, pitch: 0.16, curl: -between(rng, 0.5, 1.2), speed: between(rng, 0.9, 1.4), phase: i * 1.3 });
  }

  if (t.spikes) {
    for (let i = 0; i < 12; i += 1) {
      const th = between(rng, 0.2, 1.3);
      const ph = rng() * TAU;
      const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th) * 1.3, Math.sin(th) * Math.sin(ph));
      const s = cone(0.03, 0.14, mats.accent, 4);
      s.geometry.translate(0, .065, 0);
      s.name = "mound-thorn";
      mountSurface(body, s, new Vector3(n.x * .68, .52 + n.y * .50, n.z * .62), n, .015);
    }
  }
  if (chance(rng, 0.5)) {
    const petal = new MeshStandardMaterial({ color: new Color().setHSL(pick(rng, [0.95, 0.12, 0.62, 0.8]), 0.7, 0.62), roughness: 0.8, side: DoubleSide });
    for (let i = 0; i < 3; i += 1) {
      const a = rng() * TAU;
      const f = new Group();
      for (let k = 0; k < 5; k += 1) {
        const pt = ball(0.045, petal, 1, 0.4, 1.4, 6);
        const b = (k / 5) * TAU;
        pt.position.set(Math.cos(b) * 0.05, 0, Math.sin(b) * 0.05);
        pt.rotation.y = -b;
        f.add(pt);
      }
      f.add(ball(0.03, mats.dark, 1, 1, 1, 6));
      mountSurface(body, f, new Vector3(Math.cos(a) * .30, .90, Math.sin(a) * .28), UPV, .02);
    }
  }

  const hollow = ball(0.18, mats.dark, 1.2, 0.75, 0.4, 10);
  hollow.position.set(0, 0.6, 0.6);
  heap.add(hollow);
  for (const side of [1, -1]) {
    const e = ball(0.045, mats.eye, 1.2, 0.8, 0.6, 8);
    e.position.set(0.09 * side, 0.62, 0.66);
    heap.add(e);
  }

  tick(ctx, (time) => {
    const s = Math.sin(time * 1.3 + ctx.phase);
    heap.scale.set(1 - 0.015 * s, 1 + 0.03 * s, 1 - 0.015 * s);
  });
}

// ---------------------------------------------------------------------------
// spirit: ghosts, wraiths, banshees, shadows; genies

export function buildSpirit(ctx: Ctx): void {
  const name = ctx.spec.name.toLowerCase();
  if (/djinni|djinn|efreet|ifrit|marid|\bdao\b|genie|jann/.test(name)) buildGenie(ctx);
  else buildGhost(ctx);
}

// A ragged hanging strip of cloth: a flat cone that swings from its top edge.
function tatter(mat: Material, len: number, width: number): Group {
  const pivot = new Group();
  const strip = cone(width, len, mat, 4);
  strip.rotation.x = Math.PI;
  strip.scale.z = 0.3;
  strip.position.y = -len / 2;
  pivot.add(strip);
  return pivot;
}

function buildGhost(ctx: Ctx): void {
  const { mats, rng, root, spec } = ctx;
  const name = spec.name.toLowerCase();
  const shadow = /shadow|umbral|dread|soul/.test(name);
  const banshee = /banshee|maiden|lady|bride|weeping|wailing/.test(name);
  const hooded = /wraith|specter|spectre|reaper|dread|soul|haunt|shroud/.test(name) || (!shadow && !banshee && chance(rng, 0.4));
  const form = shadow ? "robe" : banshee ? "robe" : pick(rng, ["robe", "robe", "tail", "cloak"] as const);
  const wide = between(rng, 0.85, 1.2) * (form === "cloak" ? 1.3 : 1);
  const tall = between(rng, 0.92, 1.18);
  const g = new Group();
  root.add(g);

  const trailMat = mats.skin.clone();
  trailMat.depthWrite = true;

  // Lathe body: hem, waist, shoulders. The tail form stops at the hip.
  const profile = form === "tail"
    ? [[0.001, 0.55], [0.3, 0.6], [0.28, 0.86], [0.24, 1.0], [0.27, 1.1], [0.19, 1.22], [0.001, 1.25]]
    : [[0.001, 0], [0.44, 0.02], [0.42, 0.2], [0.33, 0.5], [0.24, 0.86], [0.27, 1.08], [0.19, 1.22], [0.001, 1.25]];
  const pts = profile.map(([x, y]) => new Vector2(x! * wide, y! * tall));
  const geo = new LatheGeometry(pts, 22);
  if (form !== "tail") {
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      if (y < 0.06 && y > 0.001) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, y + 0.1 * (0.5 + 0.5 * Math.sin(a * 6 + 1)));
      }
    }
    geo.computeVertexNormals();
  }
  const robe = new Mesh(geo, mats.skin);
  robe.position.y = 0.55;
  g.add(robe);

  const headY = 0.55 + 1.4 * tall;
  const headR = 0.16;
  const head = new Group();
  head.name = "head-focus";
  ctx.focus = head;
  head.position.set(0, headY, 0.02);
  g.add(head);
  const skullFace = !banshee && !shadow && chance(rng, 0.3);
  if (skullFace) {
    head.add(makeHead(ctx, { r: headR, style: "skull" }));
  } else {
    const visage = makeHead(ctx, { r: headR, style: "humanoid", family: "gaunt" });
    if (banshee) visage.getObjectByName("mouth")!.scale.z = 4;
    head.add(visage);
  }
  if (hooded) {
    const cowl = new Mesh(new SphereGeometry(headR * 1.32, 14, 10, Math.PI / 2 + 0.75, TAU - 1.5, 0, Math.PI * 0.8), mats.skin);
    cowl.position.set(0, headR * 0.06, -headR * 0.15);
    head.add(cowl);
    const peak = cone(headR * 0.9, headR * 1.6, mats.skin, 10);
    peak.position.set(0, headR * 1.1, -headR * 0.5);
    peak.rotation.x = -0.6;
    head.add(peak);
  }

  if (form !== "cloak") {
    const reach = shadow ? 0.95 : between(rng, 0.45, 0.75);
    for (const side of [1, -1]) {
      const arm = strand(4, reach, 0.06, 0.012, trailMat, 6);
      arm.root.position.set(0.25 * side * wide, 0.55 + 1.08 * tall, 0.04);
      orient(arm.root, new Vector3(side * 0.35, -0.3, 0.9));
      g.add(arm.root);
      arm.tip.add(ball(0.05, mats.skin, 1, 0.6, 1.3, 8));
      sway(ctx, arm, { yaw: 0.25, pitch: 0.3, curl: -0.4, speed: 1.4, lag: 0.6, phase: side });
    }
  }
  if (form === "tail") {
    const tail = strand(8, 1.1, 0.28 * wide, 0.015, trailMat, 9);
    tail.root.position.set(0, 0.55 + 0.56 * tall, 0);
    orient(tail.root, new Vector3(0, -1, -0.2));
    g.add(tail.root);
    sway(ctx, tail, { yaw: 0.3, pitch: 0.16, curl: 0.7, speed: 1.2, lag: 0.55 });
  } else {
    const count = form === "cloak" ? 11 : 8;
    const hemR = 0.42 * wide;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + rng() * 0.3;
      const t = tatter(mats.skin, between(rng, 0.3, form === "cloak" ? 0.75 : 0.6), 0.1 * wide);
      t.position.set(Math.cos(a) * hemR * 0.92, 0.62, Math.sin(a) * hemR * 0.92);
      t.rotation.y = -a + Math.PI / 2;
      g.add(t);
      const sp = between(rng, 1.0, 1.7);
      const ph = i * 1.9;
      tick(ctx, (time) => {
        t.rotation.x = 0.22 * Math.sin(time * sp + ph);
        t.rotation.z = 0.18 * Math.sin(time * sp * 0.8 + ph + 1);
      });
    }
  }
  if (banshee) {
    for (let i = 0; i < 7; i += 1) {
      const h = strand(5, between(rng, 0.7, 1.0), 0.03, 0.006, trailMat, 5);
      h.root.position.set((i - 3) * 0.035, 0.1, -headR * 0.5);
      orient(h.root, new Vector3((i - 3) * 0.12, -0.15, -1));
      head.add(h.root);
      sway(ctx, h, { yaw: 0.3, pitch: 0.2, curl: 0.3, speed: 1.6, lag: 0.55, phase: i });
    }
  }

  tick(ctx, (time) => {
    g.position.y = 0.05 + 0.05 * Math.sin(time * 1.3 + ctx.phase);
    g.rotation.z = 0.04 * Math.sin(time * 0.9 + ctx.phase);
    head.rotation.y = 0.2 * Math.sin(time * 0.6 + ctx.phase);
    robe.scale.set(1 + 0.02 * Math.sin(time * 1.8), 1, 1 + 0.02 * Math.sin(time * 1.8 + 1));
  });
}

function buildGenie(ctx: Ctx): void {
  const { mats, rng, root, t } = ctx;
  const g = new Group();
  root.add(g);
  const gold = goldMat();

  const tail = strand(9, 1.3, 0.3, 0.035, mats.skin, 10);
  tail.root.position.set(0, 1.12, 0);
  orient(tail.root, new Vector3(0, -1, 0.25));
  g.add(tail.root);
  sway(ctx, tail, { yaw: 0.34, pitch: 0.16, speed: 1.3, lag: 0.55 });

  const torso = ball(1, mats.skin, 0.3, 0.34, 0.2, 14);
  torso.position.y = 1.38;
  const waist = ball(1, mats.skin, 0.21, 0.2, 0.16, 12);
  waist.position.y = 1.1;
  const sash = torus(0.2, 0.035, gold, TAU, 6, 16);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 1.08;
  g.add(torso, waist, sash);

  const arms: Group[] = [];
  for (const side of [1, -1]) {
    const shoulder = new Group();
    shoulder.position.set(0.34 * side, 1.5, 0);
    shoulder.add(ball(0.11, mats.skin, 1, 1, 1, 10));
    shoulder.add(limb(zero, new Vector3(0.1 * side, -0.28, 0.05), new Vector3(-0.1 * side, -0.36, 0.3), 0.085, 0.07, 0.06, mats.skin, 8));
    const wrist = torus(0.06, 0.018, gold, TAU, 5, 12);
    wrist.position.set(-0.08 * side, -0.35, 0.27);
    const fist = ball(0.06, mats.skin, 1, 1, 1, 8);
    fist.position.set(-0.1 * side, -0.36, 0.32);
    shoulder.add(wrist, fist);
    g.add(shoulder);
    arms.push(shoulder);
  }

  const headR = 0.15;
  const head = makeHead(ctx, { r: headR, style: "humanoid" });
  head.name = "head-focus";
  ctx.focus = head;
  head.position.set(0, 1.9, 0.02);
  g.add(head);
  if (t.horns === "none" && (ctx.spec.look === "flame" || chance(rng, 0.45))) head.add(makeHorns("curved", headR, mats));
  if (t.crown === "crown" || chance(rng, 0.4)) {
    const c = crownOf(headR, gold);
    c.position.y = headR * 0.62;
    head.add(c);
  }
  const knot = ball(0.07, mats.dark, 1, 1.1, 1, 8);
  knot.position.set(0, headR * 0.95, -headR * 0.2);
  head.add(knot);
  const beard = cone(headR * 0.55, headR * 1.3, mats.dark, 7);
  beard.rotation.x = Math.PI + 0.3;
  beard.position.set(0, -headR * 0.95, headR * 0.5);
  head.add(beard);

  tick(ctx, (time) => {
    g.position.y = 0.07 * Math.sin(time * 1.2 + ctx.phase);
    torso.scale.set(0.3 * (1 + 0.012 * Math.sin(time * 1.7)), 0.34 * (1 + 0.02 * Math.sin(time * 1.7)), 0.2);
    head.rotation.y = 0.15 * Math.sin(time * 0.7 + ctx.phase);
    arms.forEach((a, i) => { a.rotation.x = 0.05 * Math.sin(time * 1.4 + i * 2); });
  });
}

// ---------------------------------------------------------------------------
// orb: beholders, spectators, wisps, flameskulls

export function buildOrb(ctx: Ctx): void {
  const name = ctx.spec.name.toLowerCase();
  const wispish = /will-o|wisp|flameskull|skull|lantern|firegeist|spark|mote|orb\b/.test(name)
    && !/beholder|gauth|spectator|tyrant|\beye|watcher|gazer|observer/.test(name);
  if (wispish) buildWisp(ctx);
  else buildBeholder(ctx);
}

function buildBeholder(ctx: Ctx): void {
  const { mats, rng, root, t, spec } = ctx;
  const name = spec.name.toLowerCase();
  const g = new Group();
  root.add(g);
  const R = 0.5;
  const cy = 0.75;
  const iris = irisMat(ctx);

  const single = /floating eye/.test(name);
  let stalks = t.eyestalks;
  if (stalks === 0) {
    stalks = single ? 0 : /spectator|gauth/.test(name) ? 4 : /beholder|tyrant/.test(name) ? 10 : 6;
  }
  const wideBody = between(rng, 0.92, 1.15);
  const body = ball(R, mats.skin, wideBody, 1, 0.95, 20);
  body.position.y = cy;
  g.add(body);
  if (chance(rng, 0.3)) {
    const horns = makeHorns(pick(rng, ["curved", "straight", "bull"] as const), 0.3, mats);
    horns.position.set(0, cy + R * 0.72, -0.05);
    g.add(horns);
  }
  if (chance(rng, 0.35)) {
    for (let i = 0; i < 7; i += 1) {
      const c = cone(0.045, 0.16 - Math.abs(i - 3) * 0.02, mats.accent, 4);
      c.position.set(0, cy + R * 0.98 - Math.abs(i - 3) * 0.035, R * 0.45 - i * 0.15);
      c.rotation.x = -0.3 - (i - 3) * 0.05;
      g.add(c);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const th = between(rng, 0.4, 1.3);
    const ph = rng() * TAU;
    const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    if (n.z > 0.35) continue;
    const s = cone(0.05, 0.14, mats.accent, 4);
    s.position.set(n.x * R * 0.98, cy + n.y * R * 0.98, n.z * R * 0.93);
    s.quaternion.copy(surfaceUp(n));
    g.add(s);
  }

  const eyeR = single ? 0.34 : 0.22;
  const eyeY = cy + (single ? 0.02 : 0.1);
  const eye = eyeball(ctx, eyeR, iris);
  eye.position.set(0, eyeY, R * 0.82);
  g.add(eye);
  const lid = ball(eyeR * 1.02, mats.skin, 1, 0.55, 1, 12);
  lid.position.set(0, eyeY + eyeR * 0.35, R * 0.82);
  lid.visible = false;
  g.add(lid);

  // Wide toothy mouth under the eye.
  const my = cy - (single ? 0.28 : 0.2);
  const surfZ = (x: number) => Math.sqrt(Math.max(0.01, R * R - x * x - (my - cy) * (my - cy))) * 0.95;
  const mouth = ball(0.3, mats.dark, 1, 0.26, 0.5, 12);
  mouth.position.set(0, my, surfZ(0) - 0.03);
  g.add(mouth);
  for (let i = 0; i < 11; i += 1) {
    const x = (i - 5) * 0.05;
    const up = cone(0.016, 0.06, mats.white, 4);
    up.rotation.x = Math.PI;
    up.position.set(x, my + 0.05, surfZ(x) + 0.005);
    const lo = cone(0.016, 0.06, mats.white, 4);
    lo.position.set(x, my - 0.05, surfZ(x) + 0.005);
    g.add(up, lo);
  }

  if (stalks > 0) eyeStalks(ctx, g, new Vector3(0, cy, 0), R, stalks, 0.5, iris);

  tick(ctx, (time) => {
    g.position.y = 0.05 * Math.sin(time * 1.2 + ctx.phase);
    g.rotation.y = 0.3 * Math.sin(time * 0.5 + ctx.phase);
    g.rotation.z = 0.03 * Math.sin(time * 0.8 + ctx.phase);
    const s = Math.sin(time * 1.6 + ctx.phase);
    body.scale.set(wideBody * (1 + 0.012 * s), 1 - 0.015 * s, 0.95);
    lid.visible = (time + ctx.phase) % 5.3 < 0.14;
  });
}

function buildWisp(ctx: Ctx): void {
  const { mats, rng, root, spec } = ctx;
  const name = spec.name.toLowerCase();
  const g = new Group();
  root.add(g);
  const skull = /skull/.test(name);
  const lantern = /lantern/.test(name);
  const fire = skull || /fire|flame|spark|ember|geist|blaze|burn|sun|torch/.test(name);
  const glowCol = spec.palette.glow;
  const cy = 0.65;

  if (skull) {
    const head = makeHead(ctx, { r: 0.22, style: "skull" });
    head.position.set(0, cy, 0);
    g.add(head);
  } else {
    const core = ball(lantern ? 0.2 : 0.16, mats.glow, 1, 1, 1, 14);
    core.position.y = cy;
    g.add(core);
  }
  const halo = ball(skull ? 0.42 : 0.34, haze(glowCol, 0.22), 1, 1, 1, 14);
  halo.position.y = cy;
  g.add(halo);

  // Flames lick upward from the top of the orb.
  const flames: Mesh[] = [];
  if (fire && !lantern) {
    const count = skull ? 6 : 5;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU;
      const centre = i === 0 && !skull;
      const f = cone(skull ? 0.07 : centre ? 0.15 : 0.09, between(rng, 0.3, 0.5) * (centre ? 1.4 : 1), mats.glow, 6);
      if (skull) {
        f.position.set(Math.cos(a) * 0.14, cy + 0.28, Math.sin(a) * 0.14 - 0.05);
        f.rotation.x = Math.sin(a) * 0.3;
      } else {
        const r = centre ? 0 : 0.1;
        f.position.set(Math.cos(a) * r, cy + 0.2 + (centre ? 0.12 : 0), Math.sin(a) * r);
        f.rotation.z = centre ? 0 : -Math.cos(a) * 0.35;
        f.rotation.x = centre ? 0 : Math.sin(a) * 0.35;
      }
      g.add(f);
      flames.push(f);
    }
  }
  const rays: Group[] = [];
  if (lantern) {
    for (let i = 0; i < 14; i += 1) {
      const th = Math.acos(1 - 2 * ((i + 0.5) / 14));
      const ph = i * 2.399963;
      const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      const ray = cone(0.03, 0.34, mats.glow, 4);
      ray.position.copy(n).multiplyScalar(0.25).add(new Vector3(0, cy, 0));
      ray.quaternion.copy(surfaceUp(n));
      g.add(ray);
    }
    const ring = torus(0.32, 0.018, mats.glow, TAU, 5, 28);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = cy;
    const holder = new Group();
    holder.add(ring);
    g.add(holder);
    rays.push(holder);
  }
  // Orbiting motes for the plain wisp.
  const motes: Array<{ m: Mesh; r: number; sp: number; ph: number; y: number }> = [];
  if (!fire && !lantern) {
    for (let i = 0; i < 6; i += 1) {
      const m = ball(between(rng, 0.03, 0.055), mats.glow, 1, 1, 1, 8);
      g.add(m);
      motes.push({ m, r: between(rng, 0.25, 0.42), sp: between(rng, 0.8, 1.8) * (i % 2 ? -1 : 1), ph: rng() * TAU, y: between(rng, -0.15, 0.2) });
    }
  }

  tick(ctx, (time) => {
    g.position.y = 0.09 * Math.sin(time * 1.6 + ctx.phase);
    halo.scale.setScalar(1 + 0.08 * Math.sin(time * 3.1 + ctx.phase));
    flames.forEach((f, i) => {
      f.scale.y = 1 + 0.35 * Math.sin(time * 7 + i * 1.7);
      f.scale.x = f.scale.z = 1 - 0.15 * Math.sin(time * 6 + i);
    });
    rays.forEach((r) => { r.rotation.y = time * 0.9; r.rotation.z = 0.5 * Math.sin(time * 0.6); });
    motes.forEach((q) => {
      const a = q.ph + time * q.sp;
      q.m.position.set(Math.cos(a) * q.r, cy + q.y + 0.05 * Math.sin(time * 2 + q.ph), Math.sin(a) * q.r);
    });
    if (lantern) g.rotation.y = time * 0.3;
  });
}

// ---------------------------------------------------------------------------
// tentacled: kraken, roper, aboleth, cloaker, grell, grick, otyugh, star spawn

export function buildTentacled(ctx: Ctx): void {
  const name = ctx.spec.name.toLowerCase();
  if (/kraken|octopus|squid|nautiloid/.test(name)) return octopus(ctx);
  if (/roper/.test(name)) return roper(ctx);
  if (/aboleth/.test(name)) return aboleth(ctx);
  if (/cloaker/.test(name)) return cloaker(ctx);
  if (/grell|darkmantle/.test(name)) return jellyfish(ctx);
  if (/grick|carrion crawler/.test(name)) return grick(ctx);
  if (/otyugh/.test(name)) return otyugh(ctx);
  const form = pick(ctx.rng, [octopus, jellyfish, otyugh, roper] as const);
  return form(ctx);
}

function extraStalks(ctx: Ctx, g: Group, center: Vector3, radius: number): void {
  if (ctx.t.eyestalks > 0) eyeStalks(ctx, g, center, radius, ctx.t.eyestalks, 0.45, irisMat(ctx));
}

function octopus(ctx: Ctx): void {
  const { mats, root, spec } = ctx;
  const name = spec.name.toLowerCase();
  const g = new Group();
  root.add(g);
  const mantle = ball(0.4, mats.skin, 0.9, 1.45, 0.9, 16);
  mantle.position.set(0, 1.0, -0.15);
  mantle.rotation.x = -0.4;
  const head = ball(0.4, mats.skin, 1.15, 0.95, 1.1, 16);
  head.position.set(0, 0.62, 0.05);
  g.add(mantle, head);
  for (const side of [1, -1]) {
    const eye = eyeball(ctx, 0.12, mats.eye);
    eye.position.set(0.37 * side, 0.68, 0.22);
    eye.rotation.y = side * 1.0;
    g.add(eye);
  }
  const big = /kraken|squid/.test(name);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + 0.2;
    const long = big && i % 4 === 0;
    const c = strand(6, long ? 1.8 : 1.2, 0.12, 0.014, mats.skin, 8);
    c.root.position.set(Math.cos(a) * 0.3, 0.46, Math.sin(a) * 0.3 + 0.05);
    orient(c.root, new Vector3(Math.cos(a), -0.5, Math.sin(a)));
    g.add(c.root);
    sway(ctx, c, { yaw: 0.26, pitch: 0.2, curl: long ? 2.4 : 1.9, speed: 1.1, lag: 0.5, phase: i * 0.8 });
  }
  extraStalks(ctx, g, new Vector3(0, 0.75, 0), 0.4);
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.4 + ctx.phase);
    mantle.scale.set(0.9 * (1 + 0.04 * s), 1.45 * (1 - 0.05 * s), 0.9 * (1 + 0.04 * s));
    g.position.y = 0.025 * s;
    g.rotation.y = 0.12 * Math.sin(time * 0.5 + ctx.phase);
  });
}

function roper(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const g = new Group();
  root.add(g);
  const radii = [0.5, 0.42, 0.36, 0.3, 0.24];
  radii.forEach((r, i) => {
    const seg = cyl(radii[i + 1] ?? 0.16, r, 0.34, mats.skin, 9);
    seg.position.set(between(rng, -0.03, 0.03), 0.17 + i * 0.32, between(rng, -0.03, 0.03));
    seg.rotation.y = rng() * TAU;
    g.add(seg);
  });
  for (let i = 0; i < 7; i += 1) {
    const a = rng() * TAU;
    const y = between(rng, 0.1, 1.4);
    const rr = 0.5 - y * 0.17;
    const nub = ball(between(rng, 0.06, 0.12), mats.skin, 1, 0.8, 1, 6);
    nub.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    g.add(nub);
  }
  const eye = eyeball(ctx, 0.15, irisMat(ctx));
  eye.position.set(0, 1.2, 0.27);
  g.add(eye);
  const maw = ball(0.09, mats.dark, 0.8, 3.0, 0.4, 8);
  maw.position.set(0, 0.8, 0.37);
  g.add(maw);
  for (let k = 0; k < 5; k += 1) {
    for (const side of [1, -1]) {
      const tooth = cone(0.014, 0.06, mats.white, 4);
      tooth.rotation.z = -side * Math.PI / 2;
      tooth.position.set(0.05 * side, 0.64 + k * 0.08, 0.38);
      g.add(tooth);
    }
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU + 0.3;
    const c = strand(6, 1.5, 0.04, 0.01, mats.skin, 6);
    c.root.position.set(Math.cos(a) * 0.22, 1.35, Math.sin(a) * 0.22);
    orient(c.root, new Vector3(Math.cos(a), i % 2 ? 0.1 : 0.5, Math.sin(a)));
    g.add(c.root);
    c.tip.add(ball(0.03, mats.skin, 1, 1, 1, 6));
    sway(ctx, c, { yaw: 0.22, pitch: 0.16, curl: -1.0, speed: 1.0, lag: 0.5, phase: i * 1.4 });
  }
  extraStalks(ctx, g, new Vector3(0, 1.3, 0), 0.24);
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.5 + ctx.phase);
    g.scale.set(1 + 0.01 * s, 1 + 0.015 * s, 1 + 0.01 * s);
    eye.rotation.y = 0.35 * Math.sin(time * 0.8 + ctx.phase);
  });
}

function aboleth(ctx: Ctx): void {
  const { mats, root } = ctx;
  const g = new Group();
  root.add(g);
  const body = ball(0.5, mats.skin, 0.85, 0.8, 1.9, 18);
  body.position.set(0, 0.85, -0.1);
  const belly = ball(0.44, mats.belly, 0.85, 0.45, 1.6, 14);
  belly.position.set(0, 0.62, 0.0);
  g.add(body, belly);
  const iris = irisMat(ctx);
  for (let k = 0; k < 3; k += 1) {
    const eye = eyeball(ctx, 0.085, iris);
    eye.position.set(0, 0.85 + (k - 1) * 0.16, k === 1 ? 0.83 : 0.78);
    eye.rotation.x = -(k - 1) * 0.3;
    g.add(eye);
  }
  const maw = ball(0.16, mats.dark, 1.3, 0.4, 0.6, 10);
  maw.position.set(0, 0.55, 0.78);
  g.add(maw);
  for (let i = 0; i < 5; i += 1) {
    const f = cone(0.012, 0.07, mats.white, 4);
    f.position.set((i - 2) * 0.05, 0.58, 0.86);
    f.rotation.x = Math.PI;
    g.add(f);
  }
  const tail = strand(7, 1.4, 0.34, 0.03, mats.skin, 10);
  tail.root.position.set(0, 0.82, -0.98);
  orient(tail.root, new Vector3(0, -0.1, -1));
  g.add(tail.root);
  tail.tip.add(ball(1, mats.belly, 0.03, 0.42, 0.3, 8));
  sway(ctx, tail, { yaw: 0.3, pitch: 0.1, speed: 1.2, lag: 0.5 });
  for (let i = 0; i < 6; i += 1) {
    const s = cone(0.06, 0.26, mats.belly, 4);
    s.position.set(0, 1.27 - Math.abs(i - 2) * 0.03, 0.55 - i * 0.22);
    s.rotation.x = -0.3;
    g.add(s);
  }
  for (const side of [1, -1]) {
    const fl = ball(1, mats.belly, 0.4, 0.05, 0.22, 8);
    fl.position.set(0.5 * side, 0.68, 0.05);
    g.add(fl);
    tick(ctx, (time) => { fl.rotation.z = -side * (0.5 + 0.2 * Math.sin(time * 2 + ctx.phase)); });
    for (let k = 0; k < 2; k += 1) {
      const c = strand(6, 1.5, 0.085, 0.015, mats.skin, 7);
      c.root.position.set((0.28 - k * 0.12) * side, 0.62 - k * 0.04, 0.55 + k * 0.1);
      orient(c.root, new Vector3(side * (0.55 + k * 0.1), -0.35, 0.9));
      g.add(c.root);
      sway(ctx, c, { yaw: 0.35, pitch: 0.25, curl: 0.7 * side + 0.3, speed: 1.1, lag: 0.5, phase: k * 2 + side });
    }
  }
  extraStalks(ctx, g, new Vector3(0, 0.85, 0.2), 0.45);
  tick(ctx, (time) => { g.position.y = 0.05 * Math.sin(time * 1.1 + ctx.phase); });
}

function cloaker(ctx: Ctx): void {
  const { mats, root } = ctx;
  const g = new Group();
  root.add(g);
  // Two broad, mottled cloak-wings that flap slowly.
  const flaps: Group[] = [];
  for (const side of [1, -1]) {
    const pivot = new Group();
    pivot.position.set(0.1 * side, 1.0, -0.02);
    const outer = ball(1, mats.skin, 0.62, 0.03, 0.5, 14);
    outer.position.set(0.6 * side, 0, -0.1);
    const inner = ball(1, mats.belly, 0.42, 0.034, 0.32, 12);
    inner.position.set(0.55 * side, 0.004, -0.08);
    const spot = ball(1, mats.dark, 0.1, 0.036, 0.09, 8);
    spot.position.set(0.85 * side, 0.005, -0.05);
    pivot.add(outer, inner, spot);
    g.add(pivot);
    flaps.push(pivot);
  }
  const body = ball(0.22, mats.skin, 1, 2.0, 0.6, 14);
  body.position.y = 0.95;
  const head = new Group();
  head.position.set(0, 1.38, 0.06);
  head.add(ball(0.17, mats.skin, 0.9, 0.9, 1.1, 12));
  for (const side of [1, -1]) {
    const e = ball(0.035, mats.eye, 1.2, 0.8, 0.6, 8);
    e.position.set(0.075 * side, 0.03, 0.17);
    const fang = cone(0.014, 0.07, mats.white, 4);
    fang.rotation.x = Math.PI;
    fang.position.set(0.04 * side, -0.06, 0.2);
    head.add(e, fang);
  }
  const mouth = ball(0.09, mats.dark, 1.3, 0.5, 0.4, 8);
  mouth.position.set(0, -0.08, 0.18);
  head.add(mouth);
  g.add(body, head);
  const tail = strand(6, 0.9, 0.12, 0.012, mats.skin, 7);
  tail.root.position.set(0, 0.55, -0.1);
  orient(tail.root, new Vector3(0, -0.5, -1));
  g.add(tail.root);
  sway(ctx, tail, { yaw: 0.3, pitch: 0.2, speed: 1.4, lag: 0.55 });
  for (const side of [1, -1]) {
    const arm = strand(4, 0.7, 0.04, 0.012, mats.skin, 6);
    arm.root.position.set(0.2 * side, 1.1, 0.1);
    orient(arm.root, new Vector3(side * 0.5, -0.4, 0.8));
    g.add(arm.root);
    sway(ctx, arm, { yaw: 0.3, pitch: 0.3, curl: 0.8, speed: 1.3, phase: side });
  }
  extraStalks(ctx, g, new Vector3(0, 1.0, 0), 0.25);
  tick(ctx, (time) => {
    g.position.y = 0.08 * Math.sin(time * 1.3 + ctx.phase);
    head.rotation.y = 0.2 * Math.sin(time * 0.7 + ctx.phase);
    const flap = 0.35 + 0.28 * Math.sin(time * 1.6 + ctx.phase);
    flaps[0]!.rotation.z = flap;
    flaps[1]!.rotation.z = -flap;
  });
}

function jellyfish(ctx: Ctx): void {
  const { mats, rng, root, spec } = ctx;
  const name = spec.name.toLowerCase();
  const g = new Group();
  root.add(g);
  const dome = ball(0.55, mats.skin, 1, 0.85, 1, 20);
  dome.position.y = 1.35;
  g.add(dome);
  for (let i = 0; i < 16; i += 1) {
    const th = between(rng, 0.1, 1.1);
    const ph = rng() * TAU;
    const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const gy = ball(1, mats.belly, between(rng, 0.09, 0.14), 0.05, between(rng, 0.06, 0.1), 6);
    gy.position.set(n.x * 0.55, 1.35 + n.y * 0.47, n.z * 0.55);
    gy.quaternion.copy(surfaceUp(new Vector3(n.x, n.y * 1.2, n.z)));
    g.add(gy);
  }
  const beak = cone(0.09, 0.3, mats.accent, 4);
  beak.position.set(0, 1.0, 0.3);
  beak.rotation.x = Math.PI / 2 + 0.3;
  g.add(beak);
  if (/darkmantle|mantle/.test(name) || chance(rng, 0.3)) {
    for (const side of [1, -1]) {
      const eye = eyeball(ctx, 0.07, mats.eye);
      eye.position.set(0.22 * side, 1.35, 0.46);
      eye.rotation.y = side * 0.4;
      g.add(eye);
    }
  }
  const count = 10;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU + rng() * 0.3;
    const c = strand(5, between(rng, 0.9, 1.25), 0.05, 0.008, mats.skin, 6);
    c.root.position.set(Math.cos(a) * 0.32, 1.0, Math.sin(a) * 0.32);
    orient(c.root, new Vector3(Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35));
    g.add(c.root);
    sway(ctx, c, { yaw: 0.3, pitch: 0.3, curl: 0.2, speed: between(rng, 1.1, 1.6), lag: 0.6, phase: i * 1.3 });
  }
  extraStalks(ctx, g, new Vector3(0, 1.35, 0), 0.5);
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.5 + ctx.phase);
    dome.scale.set(1 + 0.05 * s, 0.85 * (1 - 0.07 * s), 1 + 0.05 * s);
    g.position.y = 0.06 * s;
  });
}

function grick(ctx: Ctx): void {
  const { mats, root, spec } = ctx;
  const crawler = /carrion/.test(spec.name.toLowerCase());
  const g = new Group();
  root.add(g);
  const body = strand(8, crawler ? 1.7 : 1.35, 0.2, 0.13, mats.skin, 10);
  body.root.position.set(0, 0, -0.1);
  orient(body.root, crawler ? new Vector3(0, 0.8, 0.5) : new Vector3(0, 1, 0.08));
  g.add(body.root);
  const hd = new Group();
  hd.rotation.x = -Math.PI / 2;
  hd.add(ball(0.17, mats.skin, 1, 0.9, 1.1, 12));
  const beak = cone(0.06, 0.26, mats.accent, 4);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.03, 0.22);
  hd.add(beak);
  if (crawler) {
    for (const side of [1, -1]) {
      const e = ball(0.03, mats.eye, 1, 1, 1, 6);
      e.position.set(0.09 * side, 0.06, 0.13);
      hd.add(e);
    }
  }
  body.tip.add(hd);
  const tents = crawler ? 8 : 4;
  for (let i = 0; i < tents; i += 1) {
    const a = (i / tents) * TAU;
    const c = strand(4, crawler ? 0.55 : 0.5, 0.03, 0.01, mats.skin, 5);
    c.root.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.1, 0.06);
    orient(c.root, new Vector3(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 1));
    hd.add(c.root);
    sway(ctx, c, { yaw: 0.35, pitch: 0.3, curl: 0.6, speed: 1.6, lag: 0.6, phase: i * 1.1 });
  }
  sway(ctx, body, { yaw: 0.14, pitch: 0.12, speed: 1.2, lag: 0.4 });
}

function otyugh(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const g = new Group();
  root.add(g);
  const body = ball(0.62, mats.skin, 1.2, 0.8, 1.05, 16);
  body.position.y = 0.55;
  g.add(body);
  for (let i = 0; i < 10; i += 1) {
    const th = between(rng, 0.2, 1.4);
    const ph = rng() * TAU;
    const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const wart = ball(between(rng, 0.04, 0.08), mats.belly, 1, 0.8, 1, 6);
    wart.position.set(n.x * 0.74, 0.55 + n.y * 0.5, n.z * 0.65);
    g.add(wart);
  }
  const mouth = ball(0.3, mats.dark, 1.25, 0.5, 0.5, 12);
  mouth.position.set(0, 0.42, 0.56);
  g.add(mouth);
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 10) * Math.PI;
    for (const s of [1, -1]) {
      const tooth = cone(0.02, 0.09, mats.white, 4);
      tooth.position.set(Math.cos(a) * 0.36, 0.42 + s * Math.sin(a) * 0.09, 0.6);
      tooth.rotation.x = s > 0 ? Math.PI : 0;
      g.add(tooth);
    }
  }
  for (const side of [1, -1]) {
    const c = strand(5, 1.15, 0.11, 0.07, mats.skin, 8);
    c.root.position.set(0.52 * side, 0.55, 0.2);
    orient(c.root, new Vector3(side * 0.8, -0.1, 0.9));
    g.add(c.root);
    c.tip.add(ball(0.13, mats.skin, 1, 0.5, 1, 8));
    for (let k = 0; k < 4; k += 1) {
      const sp = cone(0.018, 0.09, mats.accent, 4);
      const a = (k / 4) * TAU;
      sp.position.set(Math.cos(a) * 0.09, 0.03, Math.sin(a) * 0.09);
      c.tip.add(sp);
    }
    sway(ctx, c, { yaw: 0.3, pitch: 0.2, curl: 0.6, speed: 1.1, lag: 0.5, phase: side });
  }
  const stalk = strand(4, 0.5, 0.045, 0.03, mats.skin, 6);
  stalk.root.position.set(0, 1.0, 0.05);
  orient(stalk.root, new Vector3(0.15, 1, 0.5));
  g.add(stalk.root);
  const eye = eyeball(ctx, 0.08, mats.eye);
  eye.rotation.y = Math.PI;
  stalk.tip.add(eye);
  sway(ctx, stalk, { yaw: 0.3, pitch: 0.3, curl: 0.2, speed: 1.2, lag: 0.5 });
  for (const [x, z] of [[0.4, 0.2], [-0.4, 0.2], [0, -0.45]] as const) {
    const foot = ball(0.16, mats.skin, 1, 0.5, 1.2, 8);
    foot.position.set(x, 0.1, z);
    g.add(foot);
  }
  extraStalks(ctx, g, new Vector3(0, 0.6, 0), 0.5);
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.4 + ctx.phase);
    g.scale.set(1 - 0.015 * s, 1 + 0.03 * s, 1 - 0.015 * s);
  });
}

// ---------------------------------------------------------------------------
// cube: gelatinous cube and mimics

export function buildCube(ctx: Ctx): void {
  if (/mimic|chest/.test(ctx.spec.name.toLowerCase())) buildMimic(ctx);
  else buildGelatinousCube(ctx);
}

function buildGelatinousCube(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const S = 1.25;
  const g = new Group();
  root.add(g);
  const shell = box(S, S, S, glass(mats.skin.color, 0.34, 0.3));
  shell.position.y = S / 2;
  g.add(shell);
  const edgeMat = glass(mats.skin.color.clone().offsetHSL(0, 0, 0.12), 0.85, 0.5);
  const t = 0.05;
  for (const y of [0, S]) {
    for (const s of [1, -1]) {
      const a = box(S + t, t, t, edgeMat);
      a.position.set(0, y, s * S / 2);
      const b = box(t, t, S + t, edgeMat);
      b.position.set(s * S / 2, y, 0);
      g.add(a, b);
    }
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const v = box(t, S + t, t, edgeMat);
      v.position.set(sx * S / 2, S / 2, sz * S / 2);
      g.add(v);
    }
  }
  const gold = goldMat();
  const items: Array<{ m: Group; y: number; ph: number; sp: number }> = [];
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i += 1) {
    const m = new Group();
    const kind = pick(rng, ["skull", "bone", "coin", "coin", "sword", "helm"] as const);
    if (kind === "skull") {
      m.add(ball(0.09, mats.white, 1, 1, 1, 8));
      const jaw = box(0.09, 0.035, 0.06, mats.white);
      jaw.position.set(0, -0.08, 0.04);
      m.add(jaw);
    } else if (kind === "bone") {
      const b = capsule(0.022, 0.2, mats.white, 6);
      b.rotation.z = 1.2;
      m.add(b);
    } else if (kind === "coin") {
      const c = cyl(0.07, 0.07, 0.018, gold, 10);
      c.rotation.x = 1.2;
      m.add(c);
    } else if (kind === "sword") {
      m.add(box(0.04, 0.32, 0.01, mats.metal));
      const guard = box(0.14, 0.025, 0.03, gold);
      guard.position.y = -0.12;
      m.add(guard);
    } else {
      m.add(new Mesh(new SphereGeometry(0.1, 10, 6, 0, TAU, 0, Math.PI * 0.6), mats.metal));
    }
    const y = S * between(rng, 0.25, 0.85);
    m.position.set(between(rng, -0.4, 0.4), y, between(rng, -0.4, 0.4));
    g.add(m);
    items.push({ m, y, ph: rng() * TAU, sp: between(rng, 0.3, 0.8) });
  }
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.6 + ctx.phase);
    g.scale.set(1 + 0.025 * s, 1 - 0.04 * s, 1 + 0.025 * Math.sin(time * 1.3 + 1));
    for (const it of items) {
      it.m.position.y = it.y + 0.05 * Math.sin(time * 0.9 + it.ph);
      it.m.rotation.y = time * it.sp + it.ph;
      it.m.rotation.z = 0.3 * Math.sin(time * 0.6 + it.ph);
    }
  });
}

function buildMimic(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const g = new Group();
  root.add(g);
  const wood = new MeshStandardMaterial({ color: new Color().setHSL(0.07, 0.5, between(rng, 0.2, 0.3)), roughness: 0.85 });
  const gold = goldMat();
  const W = 1.0;
  const D = 0.68;
  const H = 0.45;
  const baseBox = box(W, H, D, wood);
  baseBox.position.y = H / 2 + 0.08;
  g.add(baseBox);
  const cavity = box(W - 0.1, 0.02, D - 0.1, mats.dark);
  cavity.position.y = H + 0.081;
  g.add(cavity);
  for (const x of [-0.32, 0.32]) {
    const band = box(0.08, H + 0.02, D + 0.02, mats.metal);
    band.position.set(x, H / 2 + 0.08, 0);
    g.add(band);
  }
  for (const [x, z] of [[0.5, 0.34], [-0.5, 0.34], [0.5, -0.34], [-0.5, -0.34]] as const) {
    const rivet = ball(0.05, gold, 1, 1, 1, 6);
    rivet.position.set(x, 0.1, z);
    g.add(rivet);
  }

  const hinge = new Group();
  hinge.position.set(0, H + 0.08, -D / 2);
  const lid = new Mesh(new CylinderGeometry(D / 2, D / 2, W, 14, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.set(0, 0, D / 2);
  hinge.add(lid);
  for (const x of [-0.32, 0.32]) {
    const lb = new Mesh(new CylinderGeometry(D / 2 + 0.012, D / 2 + 0.012, 0.08, 14, 1, false, 0, Math.PI), mats.metal);
    lb.rotation.z = Math.PI / 2;
    lb.position.set(x, 0, D / 2);
    hinge.add(lb);
  }
  const lock = box(0.1, 0.12, 0.03, gold);
  lock.position.set(0, 0.04, D);
  hinge.add(lock);
  for (let i = 0; i < 9; i += 1) {
    const x = (i - 4) * 0.105;
    const tooth = cone(0.025, 0.11, mats.white, 4);
    tooth.rotation.x = Math.PI;
    tooth.position.set(x, 0.0, D - 0.02);
    hinge.add(tooth);
    const low = cone(0.025, 0.11, mats.white, 4);
    low.position.set(x, H + 0.13, D / 2 - 0.03);
    g.add(low);
  }
  g.add(hinge);
  const tongueMat = new MeshStandardMaterial({ color: "#c2506b", roughness: 0.5 });
  const tongue = strand(5, 0.8, 0.08, 0.03, tongueMat, 6);
  tongue.root.position.set(0, H + 0.1, 0.05);
  orient(tongue.root, new Vector3(0, 0.15, 1));
  g.add(tongue.root);
  sway(ctx, tongue, { yaw: 0.2, pitch: 0.25, curl: -0.6, speed: 2.4, lag: 0.4 });
  for (const side of [1, -1]) {
    const eye = eyeball(ctx, 0.05, mats.eye);
    eye.position.set(0.22 * side, H + 0.16, -0.12);
    eye.rotation.x = -0.5;
    g.add(eye);
  }
  for (let i = 0; i < 4; i += 1) {
    const side = i % 2 ? 1 : -1;
    const foot = strand(3, 0.34, 0.06, 0.025, tongueMat, 6);
    foot.root.position.set(0.4 * side, 0.14, i < 2 ? 0.2 : -0.2);
    orient(foot.root, new Vector3(side * 0.7, -0.8, i < 2 ? 0.4 : -0.4));
    g.add(foot.root);
    sway(ctx, foot, { yaw: 0.3, pitch: 0.3, curl: 0.4, speed: 1.6, phase: i * 1.5 });
  }
  tick(ctx, (time) => {
    hinge.rotation.x = -(0.22 + 0.2 * Math.sin(time * 2.2 + ctx.phase));
    g.position.y = 0.012 * Math.sin(time * 4.4 + ctx.phase);
  });
}

// ---------------------------------------------------------------------------
// vortex: air elementals, dust devils, whirlwinds

export function buildVortex(ctx: Ctx): void {
  const { mats, rng, root, spec } = ctx;
  const flame = spec.look === "flame";
  const g = new Group();
  root.add(g);
  const stretch = between(rng, 0.85, 1.2);
  g.scale.y = stretch;
  const widest = between(rng, 0.42, 0.66);
  const count = 2 + Math.floor(rng() * 3);
  const thick = between(rng, 0.024, 0.042);
  const helices: Array<{ g: Group; speed: number }> = [];
  for (let k = 0; k < count; k += 1) {
    const pts: Vector3[] = [];
    const turns = between(rng, 1.8, 3.2);
    const phase = rng() * TAU;
    for (let i = 0; i <= 44; i += 1) {
      const f = i / 44;
      const a = phase + f * turns * TAU;
      const r = 0.07 + widest * Math.pow(f, 0.85);
      pts.push(new Vector3(Math.cos(a) * r, 0.05 + f * 1.78, Math.sin(a) * r));
    }
    const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 70, thick + k * 0.005, 5, false), mats.skin);
    const hg = new Group();
    hg.rotation.y = (k / count) * TAU;
    hg.add(tube);
    g.add(hg);
    helices.push({ g: hg, speed: between(rng, 0.9, 1.9) });
  }
  const glowTint = new Color(spec.palette.glow).offsetHSL(between(rng, -0.06, 0.06), 0, 0);
  const funnel = cone(widest * 0.85, 1.8, haze(glowTint, 0.1), 14);
  funnel.rotation.x = Math.PI;
  funnel.position.y = 0.96;
  g.add(funnel);
  const core = ball(0.13, new MeshBasicMaterial({ color: glowTint, toneMapped: false }), 0.8, 3.0, 0.8, 10);
  core.position.y = 0.95;
  g.add(core);
  if (chance(rng, 0.6)) {
    for (const side of [1, -1]) {
      const e = ball(0.045, mats.eye, 1.2, 0.8, 0.6, 8);
      e.position.set(0.1 * side, 1.34, 0.27 * (widest / 0.5));
      g.add(e);
    }
    const mouth = ball(0.06, mats.dark, 1.5, 0.6, 0.4, 8);
    mouth.position.set(0, 1.2, 0.29 * (widest / 0.5));
    g.add(mouth);
  }

  const debrisMat = flame ? mats.glow : new MeshStandardMaterial({ color: mats.skin.color.clone().multiplyScalar(0.55), roughness: 1 });
  const debris: Array<{ m: Mesh; y: number; sp: number; ph: number }> = [];
  const debrisCount = 8 + Math.floor(rng() * 12);
  for (let i = 0; i < debrisCount; i += 1) {
    const m = shard(between(rng, 0.028, 0.06), debrisMat);
    g.add(m);
    debris.push({ m, y: between(rng, 0.15, 1.75), sp: between(rng, 1.2, 2.6) * (rng() > 0.5 ? 1 : -1), ph: rng() * TAU });
  }
  tick(ctx, (time) => {
    for (let i = 0; i < helices.length; i += 1) {
      const h = helices[i]!;
      h.g.rotation.y = (i / helices.length) * TAU + time * h.speed;
    }
    for (const d of debris) {
      const a = d.ph + time * d.sp;
      const rad = 0.1 + widest * Math.pow(d.y / 1.8, 0.85) + 0.09;
      d.m.position.set(Math.cos(a) * rad, d.y + 0.05 * Math.sin(time * 2 + d.ph), Math.sin(a) * rad);
      d.m.rotation.set(time * 2 + d.ph, time * 1.5, 0);
    }
    core.scale.set(0.8, 3.0 + 0.3 * Math.sin(time * 4 + ctx.phase), 0.8);
    g.rotation.z = 0.05 * Math.sin(time * 0.9 + ctx.phase);
  });
}

// ---------------------------------------------------------------------------
// fungus: myconids, shriekers, violet fungus, mould clusters

export function buildFungus(ctx: Ctx): void {
  const name = ctx.spec.name.toLowerCase();
  if (/myconid|mycolid|mushroom|marcher|lord/.test(name)) return myconid(ctx);
  if (/shrieker/.test(name)) return shrieker(ctx);
  if (/violet/.test(name)) return violet(ctx);
  return fungusCluster(ctx);
}

function capMaterial(ctx: Ctx): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: ctx.mats.skin.color.clone().offsetHSL(0, 0.18, 0.04), roughness: 0.75 });
}

function makeCap(ctx: Ctx, r: number, capMat: Material, spots: number): Group {
  const { mats, rng } = ctx;
  const cap = new Group();
  const dome = new Mesh(new SphereGeometry(r, 18, 10, 0, TAU, 0, Math.PI * 0.52), capMat);
  dome.scale.y = 0.7;
  cap.add(dome);
  const under = cyl(r * 0.98, r * 0.98, 0.02, mats.belly, 18);
  under.position.y = -0.01;
  cap.add(under);
  for (let i = 0; i < spots; i += 1) {
    const th = between(rng, 0.2, 0.95);
    const ph = rng() * TAU;
    const p = new Vector3(Math.sin(th) * Math.cos(ph) * r, Math.cos(th) * 0.7 * r, Math.sin(th) * Math.sin(ph) * r);
    const spot = ball(1, mats.white, r * between(rng, 0.07, 0.13), r * 0.02, r * between(rng, 0.07, 0.11), 6);
    spot.position.copy(p).multiplyScalar(1.005);
    spot.quaternion.copy(surfaceUp(new Vector3(p.x / (r * r), p.y / (0.49 * r * r), p.z / (r * r))));
    cap.add(spot);
  }
  return cap;
}

function myconid(ctx: Ctx): void {
  const { mats, root } = ctx;
  const g = new Group();
  root.add(g);
  const h = 0.95;
  const stalk = cyl(0.11, 0.18, h, mats.belly, 10);
  stalk.position.y = h / 2;
  g.add(stalk);
  const cap = makeCap(ctx, 0.36, capMaterial(ctx), 8);
  cap.position.y = h;
  g.add(cap);
  for (const side of [1, -1]) {
    const eye = ball(0.028, mats.dark, 1, 1.2, 0.6, 6);
    eye.position.set(0.05 * side, h - 0.1, 0.108);
    g.add(eye);
    const foot = ball(0.09, mats.belly, 1, 0.6, 1.4, 8);
    foot.position.set(0.11 * side, 0.05, 0.07);
    g.add(foot);
    const arm = strand(3, 0.55, 0.05, 0.03, mats.belly, 6);
    arm.root.position.set(0.14 * side, h - 0.28, 0.02);
    orient(arm.root, new Vector3(side * 0.6, -0.6, 0.5));
    g.add(arm.root);
    arm.tip.add(ball(0.045, mats.belly, 1, 1, 1, 6));
    sway(ctx, arm, { yaw: 0.3, pitch: 0.3, curl: 0.5, speed: 1.3, phase: side });
  }
  const mouth = ball(0.03, mats.dark, 1.6, 0.5, 0.5, 6);
  mouth.position.set(0, h - 0.2, 0.113);
  g.add(mouth);
  spores(ctx, g, new Vector3(0, h + 0.05, 0), 0.35, 0.6, 9);
  tick(ctx, (time) => {
    cap.rotation.z = 0.05 * Math.sin(time * 1.1 + ctx.phase);
    cap.rotation.x = 0.04 * Math.sin(time * 0.8 + ctx.phase + 1);
    g.rotation.z = 0.02 * Math.sin(time * 1.3 + ctx.phase);
  });
}

function shrieker(ctx: Ctx): void {
  const { mats, root } = ctx;
  const g = new Group();
  root.add(g);
  const stalk = cyl(0.2, 0.3, 0.5, mats.belly, 10);
  stalk.position.y = 0.25;
  g.add(stalk);
  const cap = makeCap(ctx, 0.5, capMaterial(ctx), 9);
  cap.position.y = 0.5;
  g.add(cap);
  const mouth = ball(0.17, mats.dark, 1, 0.3, 1, 12);
  mouth.position.set(0, 0.485, 0);
  g.add(mouth);
  for (const [x, z, s] of [[0.5, 0.2, 0.6], [-0.42, 0.3, 0.45], [0.1, -0.5, 0.5]] as const) {
    const st = cyl(0.1 * s, 0.14 * s, 0.6 * s, mats.belly, 8);
    st.position.set(x, 0.3 * s, z);
    const c = makeCap(ctx, 0.32 * s, capMaterial(ctx), 3);
    c.position.set(x, 0.6 * s, z);
    g.add(st, c);
  }
  spores(ctx, g, new Vector3(0, 0.7, 0), 0.45, 0.6, 9);
  tick(ctx, (time) => {
    const shriek = Math.pow(Math.max(0, Math.sin(time * 1.3 + ctx.phase)), 6);
    cap.scale.set(1 + 0.08 * shriek, 1 - 0.1 * shriek, 1 + 0.08 * shriek);
    cap.rotation.z = 0.02 * Math.sin(time * 14) * shriek;
  });
}

function violet(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const g = new Group();
  root.add(g);
  const stalk = cyl(0.14, 0.2, 0.55, mats.skin, 10);
  stalk.position.y = 0.275;
  g.add(stalk);
  const bulb = ball(0.27, mats.skin, 1, 0.85, 1, 14);
  bulb.position.y = 0.66;
  g.add(bulb);
  for (let i = 0; i < 9; i += 1) {
    const th = between(rng, 0.2, 1.2);
    const ph = rng() * TAU;
    const n = new Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const s = ball(0.045, mats.belly, 1, 0.4, 1, 6);
    s.position.set(n.x * 0.27, 0.66 + n.y * 0.23, n.z * 0.27);
    s.quaternion.copy(surfaceUp(n));
    g.add(s);
  }
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + 0.4;
    const c = strand(5, 0.95, 0.065, 0.02, mats.skin, 6);
    c.root.position.set(Math.cos(a) * 0.14, 0.78, Math.sin(a) * 0.14);
    orient(c.root, new Vector3(Math.cos(a) * 0.7, 0.8, Math.sin(a) * 0.7));
    g.add(c.root);
    c.tip.add(ball(0.045, mats.glow, 1, 1, 1, 6));
    sway(ctx, c, { yaw: 0.26, pitch: 0.2, curl: -0.8, speed: 1.2, lag: 0.5, phase: i * 1.7 });
  }
  spores(ctx, g, new Vector3(0, 0.9, 0), 0.4, 0.5, 8);
  tick(ctx, (time) => {
    const s = Math.sin(time * 1.5 + ctx.phase);
    bulb.scale.set(1 + 0.03 * s, 0.85 * (1 - 0.04 * s), 1 + 0.03 * s);
  });
}

function fungusCluster(ctx: Ctx): void {
  const { mats, rng, root } = ctx;
  const g = new Group();
  root.add(g);
  const clump = ball(0.36, mats.belly, 1.3, 0.35, 1.2, 12);
  clump.position.y = 0.1;
  g.add(clump);
  const capMat = capMaterial(ctx);
  const caps: Array<{ c: Group; ph: number }> = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU + rng() * 0.8;
    const rr = i === 0 ? 0 : between(rng, 0.15, 0.4);
    const sh = i === 0 ? between(rng, 0.65, 0.95) : between(rng, 0.25, 0.7);
    const cr = i === 0 ? between(rng, 0.28, 0.38) : between(rng, 0.14, 0.26);
    const lean = new Group();
    lean.position.set(Math.cos(a) * rr, 0.08, Math.sin(a) * rr);
    lean.rotation.set(between(rng, -0.15, 0.15), 0, between(rng, -0.15, 0.15));
    const st = cyl(cr * 0.28, cr * 0.4, sh, mats.belly, 8);
    st.position.y = sh / 2;
    const cap = makeCap(ctx, cr, capMat, 5);
    cap.position.y = sh;
    lean.add(st, cap);
    g.add(lean);
    caps.push({ c: cap, ph: rng() * TAU });
  }
  spores(ctx, g, new Vector3(0, 0.6, 0), 0.4, 0.6, 8);
  tick(ctx, (time) => {
    for (const c of caps) {
      c.c.rotation.z = 0.06 * Math.sin(time * 1.2 + c.ph);
      c.c.rotation.x = 0.04 * Math.sin(time * 0.9 + c.ph);
    }
  });
}

// ---------------------------------------------------------------------------
// object: floating sword, flying rug, book, animated armour

export function buildObject(ctx: Ctx): void {
  switch (ctx.t.shape) {
    case "sword": return flyingSword(ctx);
    case "rug": return flyingRug(ctx);
    case "book": return flyingBook(ctx);
    case "armor": return animatedArmor(ctx);
    case "chest": return buildMimic(ctx);
    default: return runedObject(ctx);
  }
}

function flyingSword(ctx: Ctx): void {
  const { mats, root } = ctx;
  const gold = goldMat();
  const g = new Group();
  root.add(g);
  const sword = new Group();
  const blade = box(0.12, 1.1, 0.025, mats.skin);
  blade.position.y = 0.72;
  const tip = cone(0.085, 0.26, mats.skin, 4);
  tip.rotation.y = Math.PI / 4;
  tip.scale.z = 0.3;
  tip.position.y = 1.4;
  const edge = box(0.025, 1.05, 0.03, mats.glow);
  edge.position.y = 0.72;
  const guard = box(0.5, 0.06, 0.09, gold);
  guard.position.y = 0.14;
  const grip = cyl(0.035, 0.035, 0.28, mats.cloth, 8);
  const pommel = ball(0.06, gold, 1, 1, 1, 8);
  pommel.position.y = -0.17;
  const runes: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const rn = ball(0.02, mats.glow, 1, 2.2, 0.4, 6);
    rn.position.set(0, 0.45 + i * 0.28, 0.02);
    runes.push(rn);
    sword.add(rn);
  }
  sword.add(blade, tip, edge, guard, grip, pommel);
  sword.rotation.x = 1.05;
  sword.position.y = 0.55;
  g.add(sword);
  tick(ctx, (time) => {
    g.position.y = 0.07 * Math.sin(time * 1.7 + ctx.phase);
    g.rotation.z = 0.12 * Math.sin(time * 1.1 + ctx.phase);
    sword.rotation.y = 0.15 * Math.sin(time * 0.9);
    runes.forEach((r, i) => r.scale.set(1, 2.2 * (0.8 + 0.3 * Math.sin(time * 4 + i)), 0.4));
  });
}

function flyingRug(ctx: Ctx): void {
  const { mats, root } = ctx;
  const W = 1.7;
  const D = 1.1;
  const base = new PlaneGeometry(W, D, 16, 10);
  const inner = new PlaneGeometry(W * 0.78, D * 0.68, 16, 10);
  const trim = new PlaneGeometry(W * 0.5, D * 0.4, 8, 6);
  const outer = new Mesh(base, new MeshStandardMaterial({ color: ctx.spec.palette.cloth, roughness: 0.95, side: DoubleSide }));
  const mid = new Mesh(inner, new MeshStandardMaterial({ color: mats.accent.color, roughness: 0.9, side: DoubleSide }));
  const centre = new Mesh(trim, new MeshStandardMaterial({ color: mats.skin.color, roughness: 0.9, side: DoubleSide }));
  mid.position.z = 0.006;
  centre.position.z = 0.012;
  const rug = new Group();
  rug.add(outer, mid, centre);
  rug.rotation.x = -Math.PI / 2;
  const g = new Group();
  g.position.y = 0.35;
  g.add(rug);
  root.add(g);
  const store = [base, inner, trim].map((geo) => {
    const p = geo.attributes.position!;
    return {
      geo,
      ox: Float32Array.from({ length: p.count }, (_, i) => p.getX(i)),
      oy: Float32Array.from({ length: p.count }, (_, i) => p.getY(i)),
    };
  });
  const disp = (x: number, y: number, time: number) => {
    const lift = Math.max(0, y / (D / 2)) * 0.1;
    return 0.06 * Math.sin(x * 3.4 - time * 2.4 + ctx.phase) + 0.035 * Math.sin(y * 4 + time * 1.7) + lift * (0.6 + 0.4 * Math.sin(time * 1.2));
  };
  tick(ctx, (time) => {
    for (const s of store) {
      const p = s.geo.attributes.position!;
      for (let i = 0; i < p.count; i += 1) p.setZ(i, disp(s.ox[i]!, s.oy[i]!, time));
      p.needsUpdate = true;
      s.geo.computeVertexNormals();
    }
    g.position.y = 0.35 + 0.05 * Math.sin(time * 1.4 + ctx.phase);
  });
}

function flyingBook(ctx: Ctx): void {
  const { mats, root } = ctx;
  const gold = goldMat();
  const g = new Group();
  g.position.y = 0.75;
  root.add(g);
  g.add(box(0.06, 0.66, 0.06, mats.cloth));
  const halves: Group[] = [];
  for (const side of [1, -1]) {
    const pivot = new Group();
    const cover = box(0.5, 0.68, 0.03, mats.cloth);
    cover.position.set(0.25 * side, 0, -0.04);
    const pages = box(0.46, 0.62, 0.05, mats.white);
    pages.position.set(0.24 * side, 0, 0);
    const emblem = ball(0.08, gold, 1, 1, 0.3, 8);
    emblem.position.set(0.25 * side, 0, -0.065);
    const rune = ball(0.03, mats.glow, 1, 2, 0.4, 6);
    rune.position.set(0.24 * side, 0.1, 0.03);
    pivot.add(cover, pages, emblem, rune);
    for (let i = 0; i < 7; i += 1) {
      const line = box(0.3 - (i % 3) * 0.05, 0.012, 0.006, mats.dark);
      line.position.set((0.22 - (i % 3) * 0.025) * side, -0.2 + i * 0.075, 0.028);
      pivot.add(line);
    }
    g.add(pivot);
    halves.push(pivot);
  }
  const flaps: Group[] = [];
  for (let i = 0; i < 4; i += 1) {
    const p = new Group();
    const leaf = box(0.44, 0.6, 0.006, mats.white);
    leaf.position.x = 0.22;
    p.add(leaf);
    p.position.z = 0.03 + i * 0.006;
    g.add(p);
    flaps.push(p);
  }
  tick(ctx, (time) => {
    const fold = 0.5 + 0.35 * Math.sin(time * 1.8 + ctx.phase);
    halves[0]!.rotation.y = fold;
    halves[1]!.rotation.y = -fold;
    flaps.forEach((f, i) => { f.rotation.y = fold * 0.9 * (0.5 + 0.5 * Math.sin(time * 3.2 + i * 1.3)); });
    g.position.y = 0.75 + 0.06 * Math.sin(time * 1.3 + ctx.phase);
    g.rotation.y = 0.2 * Math.sin(time * 0.6 + ctx.phase);
    g.rotation.z = 0.05 * Math.sin(time * 0.8);
  });
}

function animatedArmor(ctx: Ctx): void {
  const { mats, root } = ctx;
  const gold = goldMat();
  const g = new Group();
  root.add(g);
  const pieces: Array<{ m: Object3D; y: number; ph: number }> = [];
  const add = (m: Object3D, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    g.add(m);
    pieces.push({ m, y, ph: pieces.length * 1.3 });
  };
  for (const s of [1, -1]) {
    add(ball(0.075, mats.skin, 0.9, 0.6, 1.9, 8), 0.13 * s, 0.05, 0.05);
    add(cyl(0.07, 0.06, 0.4, mats.skin, 8), 0.13 * s, 0.3, 0);
    add(ball(0.085, mats.metal, 1, 1, 1, 8), 0.13 * s, 0.53, 0.02);
    add(cyl(0.09, 0.075, 0.34, mats.skin, 8), 0.13 * s, 0.74, 0);
    add(ball(0.13, mats.skin, 1, 0.85, 0.9, 10), 0.34 * s, 1.42, 0);
    add(cyl(0.055, 0.05, 0.3, mats.skin, 8), 0.4 * s, 1.15, 0.02);
    add(ball(0.06, mats.metal, 1, 1, 1, 8), 0.4 * s, 0.94, 0.06);
  }
  add(box(0.36, 0.13, 0.22, mats.skin), 0, 0.98, 0);
  add(ball(0.21, mats.skin, 1.05, 1.15, 0.72, 12), 0, 1.24, 0);
  add(cyl(0.08, 0.1, 0.1, mats.metal, 8), 0, 1.5, 0);
  const helm = new Group();
  helm.add(ball(0.14, mats.skin, 1, 1.1, 1.05, 12));
  const visor = box(0.16, 0.03, 0.05, mats.dark);
  visor.position.set(0, 0.02, 0.135);
  helm.add(visor);
  for (const s of [1, -1]) {
    const e = ball(0.018, mats.glow, 1.4, 1, 1, 6);
    e.position.set(0.04 * s, 0.02, 0.14);
    helm.add(e);
  }
  const plume = cone(0.05, 0.3, mats.cloth, 6);
  plume.position.set(0, 0.22, -0.02);
  plume.rotation.x = -0.4;
  helm.add(plume);
  add(helm, 0, 1.68, 0.01);
  const sword = new Group();
  const blade = box(0.06, 0.8, 0.015, mats.metal);
  blade.position.y = 0.4;
  const guard = box(0.2, 0.03, 0.04, gold);
  guard.position.y = 0.02;
  sword.add(blade, guard);
  sword.rotation.x = -0.5;
  add(sword, -0.4, 0.95, 0.15);
  tick(ctx, (time) => {
    for (const p of pieces) p.m.position.y = p.y + 0.012 * Math.sin(time * 1.8 + p.ph);
    helm.rotation.y = 0.35 * Math.sin(time * 0.7 + ctx.phase);
  });
}

function runedObject(ctx: Ctx): void {
  const { mats, root } = ctx;
  const g = new Group();
  root.add(g);
  const cube = box(0.5, 0.5, 0.5, mats.skin);
  cube.rotation.set(0.6, 0.7, 0);
  cube.position.y = 0.75;
  const core = ball(0.16, mats.glow, 1, 1, 1, 10);
  core.position.y = 0.75;
  const ring = torus(0.5, 0.02, mats.glow, TAU, 5, 28);
  ring.position.y = 0.75;
  g.add(cube, core, ring);
  tick(ctx, (time) => {
    cube.rotation.y = 0.7 + time * 0.6;
    ring.rotation.set(Math.PI / 2 + 0.4 * Math.sin(time * 0.8), time * 0.9, 0);
    g.position.y = 0.06 * Math.sin(time * 1.4 + ctx.phase);
  });
}
