// The two-legged body plan: people, goblins, giants, skeletons, zombies,
// fiends, golems, angels. One builder, driven by traits (stance, gear, head,
// wings, tail, skeletal, zombie pose...), because most of the bestiary is a
// variation on "creature that stands on two feet".

import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";
import {
  addPair, ball, box, chain, cone, aim, cyl, limb, makeHead, makeWings, spike, tick, torus, wave,
  type Ctx,
} from "./parts";

interface Stance {
  leg: number; torso: number; head: number; arm: number; w: number; thick: number; lean: number;
}

const STANCES: Record<string, Stance> = {
  upright: { leg: 0.84, torso: 0.58, head: 0.115, arm: 0.66, w: 1, thick: 1, lean: 0 },
  lanky: { leg: 0.92, torso: 0.58, head: 0.105, arm: 0.74, w: 0.82, thick: 0.78, lean: 0.05 },
  stout: { leg: 0.62, torso: 0.6, head: 0.13, arm: 0.55, w: 1.2, thick: 1.25, lean: 0 },
  brute: { leg: 0.74, torso: 0.64, head: 0.1, arm: 0.82, w: 1.4, thick: 1.35, lean: 0.2 },
  hunched: { leg: 0.78, torso: 0.58, head: 0.115, arm: 0.78, w: 1, thick: 1.05, lean: 0.5 },
};

function goldMat(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: "#e0b93a", roughness: 0.3, metalness: 0.85 });
}

export function buildBiped(ctx: Ctx, opts: { lowerOnly?: boolean; noLegs?: boolean; scale?: number } = {}): { upper: Group; shoulderY: number; hipY: number } {
  const { t, mats, root, spec } = ctx;
  const S = { ...STANCES[t.stance]! };
  const bulk = t.bulk;
  S.thick *= bulk * 1.12;
  S.w *= 0.5 + bulk * 0.5;
  if (t.skeletal) { S.thick *= 0.5; }
  // Small people (goblins) get a big head, giants a small one.
  if (spec.size === "small" || spec.size === "tiny") S.head *= 1.25;
  if (spec.size === "huge" || spec.size === "gargantuan") S.head *= 0.9;

  const dressed = !t.skeletal && !t.zombie && (spec.type === "humanoid" || spec.type === "fey" || t.armor || t.robe || t.cape) && t.head === "humanoid" && !t.bandages;
  const body = new Group();
  root.add(body);

  const torsoMat = t.armor ? mats.metal : t.robe || dressed ? mats.cloth : mats.skin;
  const legMat = t.skeletal ? mats.skin : dressed && !t.armor ? mats.cloth : t.zombie && spec.type === "humanoid" ? mats.cloth : mats.skin;
  const armMat = t.skeletal ? mats.skin : t.robe ? mats.cloth : t.armor ? mats.metal : dressed ? mats.cloth : mats.skin;
  const handMat = t.armor && !t.skeletal ? mats.metal : mats.skin;
  const hipY = S.leg;
  const hipW = 0.11 * S.w;

  // --- legs
  if (!opts.noLegs) {
    if (t.robe) {
      const skirt = cyl(0.17 * S.w, 0.3 * S.w * bulk, S.leg * 0.98, mats.cloth, 12);
      skirt.position.y = S.leg * 0.5;
      body.add(skirt);
      addPair(body, () => ball(0.055, mats.dark, 1, 0.6, 1.9, 6), hipW, 0.03, 0.14);
    } else {
      const flex = t.stance === "hunched" || t.stance === "brute" ? 0.07 : 0.03;
      addPair(body, (side) => {
        const g = new Group();
        const r0 = 0.075 * S.thick;
        const hip = new Vector3(0, hipY, 0);
        const knee = new Vector3(0.01 * side, hipY * 0.5, flex);
        const foot = new Vector3(0.02 * side, 0.05, 0.0);
        g.add(limb(hip, knee, foot, r0, r0 * 0.75, r0 * 0.62, legMat, t.skeletal ? 5 : 8));
        if (t.hooves) {
          const hoof = cyl(r0 * 0.8, r0 * 0.95, 0.07, mats.dark, 6);
          hoof.position.set(foot.x, 0.035, foot.z + 0.01);
          g.add(hoof);
        } else {
          const boot = ball(1, t.armor ? mats.metal : t.skeletal ? mats.skin : dressed ? mats.dark : mats.skin, r0 * 0.9, 0.055, 0.135, 8);
          boot.position.set(foot.x, 0.05, foot.z + 0.05);
          g.add(boot);
          if (!dressed && !t.skeletal && !t.armor) {
            for (const i of [-1, 0, 1]) {
              const claw = cone(0.012, 0.045, mats.accent, 4);
              claw.rotation.x = Math.PI / 2;
              claw.position.set(foot.x + i * 0.028, 0.035, foot.z + 0.18);
              g.add(claw);
            }
          }
        }
        return g;
      }, hipW, 0, 0);
    }
  }

  // --- upper body, pivoting at the pelvis so a lean bends the whole torso
  const upper = new Group();
  upper.position.y = hipY;
  upper.rotation.x = S.lean;
  body.add(upper);

  const pelvis = ball(1, t.skeletal ? mats.skin : legMat === mats.skin ? mats.skin : mats.cloth, 0.155 * S.w, 0.09, 0.1 * S.thick, 10);
  pelvis.position.y = 0.02;
  upper.add(pelvis);
  if ((spec.type === "giant" || spec.type === "humanoid") && !dressed && !t.skeletal && !t.robe && !t.armor) {
    const cloth = box(0.28 * S.w, 0.16, 0.2 * S.thick, mats.cloth);
    cloth.position.set(0, -0.06, 0.02);
    upper.add(cloth);
  }

  const shoulderY = S.torso * 0.9;
  if (t.skeletal) {
    const spine = cyl(0.02, 0.025, S.torso, mats.skin, 6);
    spine.position.y = S.torso / 2;
    upper.add(spine);
    for (let i = 0; i < 5; i += 1) {
      const rib = torus(0.13 * S.w * (1 - i * 0.07), 0.011, mats.skin, Math.PI * 1.55, 5, 12);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = Math.PI * 0.78;
      rib.position.set(0, S.torso * (0.4 + i * 0.11), 0.01);
      upper.add(rib);
    }
    const collar = box(0.36 * S.w, 0.025, 0.05, mats.skin);
    collar.position.y = shoulderY;
    upper.add(collar);
    const pelv = box(0.2, 0.09, 0.09, mats.skin);
    pelv.position.y = 0.02;
    upper.add(pelv);
  } else {
    const chest = ball(1, torsoMat, 0.2 * S.w * (t.armor ? 1.08 : 1), S.torso * 0.5, 0.125 * S.thick * (t.armor ? 1.1 : 1), 14);
    chest.position.y = S.torso * 0.55;
    upper.add(chest);
    const waist = ball(1, torsoMat, 0.155 * S.w, S.torso * 0.28, 0.105 * S.thick, 12);
    waist.position.y = S.torso * 0.2;
    upper.add(waist);
    if (bulk > 1.1 || t.stance === "stout") {
      const belly = ball(0.15 * S.thick, torsoMat, 1.15, 1.0, 0.95, 10);
      belly.position.set(0, S.torso * 0.28, 0.08);
      upper.add(belly);
    }
    if (t.robe) {
      const sash = torus(0.16 * S.w, 0.02, mats.accent, Math.PI * 2, 6, 14);
      sash.rotation.x = Math.PI / 2;
      sash.position.y = S.torso * 0.28;
      upper.add(sash);
    }
    if (t.bandages) {
      for (let i = 0; i < 5; i += 1) {
        const wrap = torus(0.16 * S.w * (1 - Math.abs(i - 2) * 0.05), 0.014, mats.accent, Math.PI * 2, 5, 14);
        wrap.rotation.x = Math.PI / 2 + 0.2 * (i % 2 ? 1 : -1);
        wrap.position.y = S.torso * (0.15 + i * 0.16);
        upper.add(wrap);
      }
    }
  }
  if (t.armor) {
    addPair(upper, () => ball(0.09 * S.thick, mats.metal, 1.15, 0.8, 1.1, 10), 0.22 * S.w, shoulderY, 0);
  }

  // --- back items
  if (t.shell) {
    const shell = new Mesh(new SphereGeometry(0.3 * S.thick, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.belly);
    shell.rotation.x = -Math.PI / 2;
    shell.scale.set(1.05, 1.05, 0.7);
    shell.position.set(0, S.torso * 0.55, -0.12);
    upper.add(shell);
  }
  if (t.spikes) {
    for (let i = 0; i < 5; i += 1) {
      const s = spike(0.09 - i * 0.008, 0.02, -0.3, mats.accent, 2, 5);
      s.rotation.x = -0.9;
      s.position.set(0, S.torso * (0.9 - i * 0.16), -0.1);
      upper.add(s);
    }
  }
  if (t.cape) {
    const cape = new Group();
    const sheet = box(0.34 * S.w, S.leg * 0.95, 0.012, mats.cloth);
    sheet.position.set(0, -S.leg * 0.475, -0.02);
    cape.add(sheet);
    cape.position.set(0, shoulderY, -0.12);
    cape.rotation.x = 0.16;
    upper.add(cape);
    tick(ctx, (time) => { cape.rotation.x = 0.16 + 0.05 * Math.sin(time * 1.3 + ctx.phase); });
  }
  if (t.wings !== "none") {
    const big = spec.type === "celestial" ? 1.25 : 1;
    const wings = makeWings(ctx, 0.85 * big, 0.5 * big, t.wings, 0.14, t.wings === "insect" ? 0.35 : 0.55);
    wings.position.set(0, shoulderY - 0.05, -0.1);
    wings.children.forEach((c, i) => { c.position.x = (i === 0 ? 1 : -1) * 0.08; });
    upper.add(wings);
  }

  // --- neck + head
  const neck = cyl(0.045 * S.thick, 0.06 * S.thick, 0.1, t.skeletal ? mats.skin : mats.skin, 6);
  neck.position.set(0, S.torso + 0.02, 0.01);
  upper.add(neck);

  const headGroup = new Group();
  const forward = (t.stance === "hunched" ? 0.05 : t.stance === "brute" ? 0.03 : 0) + 0.03;
  headGroup.position.set(0, S.torso + 0.06 + S.head, forward);
  const counterLean = -S.lean * 0.55;
  headGroup.rotation.x = counterLean;
  upper.add(headGroup);
  const headCount = Math.max(1, Math.min(3, t.heads));
  for (let i = 0; i < headCount; i += 1) {
    const h = makeHead(ctx, { r: S.head * (headCount > 1 ? 0.88 : 1) });
    const off = headCount === 1 ? 0 : (i - (headCount - 1) / 2) * S.head * 2.1;
    h.position.set(off, headCount > 1 ? Math.abs(off) * -0.15 : 0, 0);
    headGroup.add(h);
  }
  const r = S.head;
  if (t.beard) {
    const beard = cone(r * 0.75, r * 1.5, mats.dark, 7);
    beard.rotation.x = Math.PI + 0.25;
    beard.position.set(0, -r * 1.0, r * 0.5);
    headGroup.add(beard);
  }
  if (t.faceTentacles) {
    for (let i = 0; i < 4; i += 1) {
      const tent = chain(5, 0.26, 0.016, 0.006, mats.skin, 5);
      tent.root.position.set((i - 1.5) * r * 0.22, -r * 0.5, r * 0.85);
      aim(tent.root, new Vector3((i - 1.5) * 0.18, -0.85, 0.5));
      headGroup.add(tent.root);
      wave(ctx, tent, { yaw: 0.28, pitch: 0.2, speed: 2, lag: 0.7, phase: i });
    }
  }
  if (t.mane) {
    for (let i = 0; i < 9; i += 1) {
      const m = spike(r * 1.0, r * 0.14, 0.4, mats.dark, 2, 5);
      m.rotation.x = -1.9 - i * 0.05;
      m.rotation.z = (i - 4) * 0.13;
      m.position.set((i - 4) * r * 0.16, r * 0.85 - Math.abs(i - 4) * r * 0.06, -r * 0.25);
      headGroup.add(m);
    }
  }
  const gold = goldMat();
  switch (t.crown) {
    case "hat": {
      const brim = cyl(r * 1.9, r * 1.9, 0.015, mats.cloth, 14);
      brim.position.y = r * 0.68;
      const tip = spike(r * 2.6, r * 1.05, -0.9, mats.cloth, 4, 12);
      tip.position.y = r * 0.68;
      headGroup.add(brim, tip);
      break;
    }
    case "hood": {
      // Open at the front (phi = PI/2 faces +Z) so the face shows.
      const hood = new Mesh(new SphereGeometry(r * 1.22, 14, 10, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.72), mats.cloth);
      hood.position.set(0, r * 0.05, -r * 0.12);
      headGroup.add(hood);
      const shroud = ball(r * 1.05, mats.cloth, 1.05, 1.1, 0.6, 12);
      shroud.position.set(0, -r * 0.35, -r * 0.55);
      headGroup.add(shroud);
      break;
    }
    case "helm": {
      const dome = new Mesh(new SphereGeometry(r * 1.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.metal);
      dome.position.set(0, r * 0.04, -r * 0.02);
      headGroup.add(dome);
      const guard = box(r * 0.12, r * 0.85, r * 0.08, mats.metal);
      guard.position.set(0, -r * 0.1, r * 1.05);
      headGroup.add(guard);
      const crest = spike(r * 0.9, r * 0.2, -0.5, mats.cloth, 3, 5);
      crest.rotation.x = -1.1;
      crest.position.set(0, r * 0.95, -r * 0.2);
      headGroup.add(crest);
      break;
    }
    case "crown": {
      const ring = torus(r * 0.98, r * 0.09, gold, Math.PI * 2, 6, 16);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = r * 0.62;
      headGroup.add(ring);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const pt = cone(r * 0.11, r * 0.42, gold, 4);
        pt.position.set(Math.cos(a) * r * 0.98, r * 0.86, Math.sin(a) * r * 0.98);
        headGroup.add(pt);
      }
      break;
    }
    case "halo": {
      const halo = torus(r * 1.15, r * 0.06, mats.glow, Math.PI * 2, 6, 24);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = r * 2.05;
      headGroup.add(halo);
      tick(ctx, (time) => { halo.rotation.z = time * 0.8; halo.position.y = r * 2.05 + Math.sin(time * 1.6 + ctx.phase) * r * 0.06; });
      break;
    }
    case "flames": {
      const flames: Mesh[] = [];
      for (let i = 0; i < 5; i += 1) {
        const f = cone(r * 0.32, r * (1.4 + (i % 2) * 0.6), mats.glow, 6);
        f.position.set((i - 2) * r * 0.42, r * (1.15 + (i === 2 ? 0.3 : 0)), 0);
        headGroup.add(f);
        flames.push(f);
      }
      tick(ctx, (time) => flames.forEach((f, i) => { f.scale.y = 1 + 0.35 * Math.sin(time * 7 + i * 1.7); f.scale.x = 1 - 0.15 * Math.sin(time * 6 + i); }));
      break;
    }
    case "spikes": {
      for (let i = 0; i < 5; i += 1) {
        const s = cone(r * 0.12, r * 0.55, mats.accent, 4);
        s.position.set((i - 2) * r * 0.32, r * (0.85 - Math.abs(i - 2) * 0.12), -r * 0.05);
        headGroup.add(s);
      }
      break;
    }
    default: break;
  }

  // --- tail
  if (t.tail !== "none" && !opts.lowerOnly) {
    const len = t.tail === "short" ? 0.32 : t.tail === "fluffy" ? 0.5 : 0.85;
    const tail = chain(t.tail === "short" ? 4 : 7, len, 0.06 * S.thick, 0.012, mats.skin, 6);
    tail.root.position.set(0, -0.01, -0.09);
    aim(tail.root, new Vector3(0, -0.18, -1));
    upper.add(tail.root);
    wave(ctx, tail, { yaw: 0.18, pitch: 0.05, speed: 1.3, lag: 0.5 });
    if (t.tail === "club") {
      const club = ball(0.1, mats.skin, 1, 1, 1.2, 8);
      tail.tip.add(club);
    }
    if (t.tail === "fluffy") {
      const puff = ball(0.09, mats.belly, 1, 1, 1.4, 8);
      tail.tip.add(puff);
    }
  }

  // --- arms
  const pairs = Math.max(1, Math.round(t.arms / 2));
  const armRefs: Group[] = [];
  let holdR: Group | null = null;
  let holdL: Group | null = null;
  for (let pair = 0; pair < pairs; pair += 1) {
    const scale = pair === 0 ? 1 : 0.82;
    const sy = shoulderY - pair * 0.13;
    const sw = (0.2 + pair * 0.02) * S.w;
    for (const side of [1, -1] as const) {
      const shoulder = new Group();
      shoulder.position.set(sw * side, sy, 0);
      const L = S.arm * scale;
      const r0 = 0.052 * S.thick * scale;
      const bendZ = t.robe ? 0.02 : 0.0;
      const elbow = new Vector3(0.03 * side, -L * 0.5, 0.03 + bendZ);
      const hand = new Vector3(0.03 * side, -L, 0.09);
      const sleeve = t.robe ? mats.cloth : armMat;
      const arm = limb(new Vector3(0, 0, 0), elbow, hand, r0 * (t.robe ? 1.5 : 1), r0 * 0.85 * (t.robe ? 1.9 : 1), r0 * 0.7 * (t.robe ? 1.4 : 1), sleeve, t.skeletal ? 5 : 8);
      shoulder.add(arm);
      const fist = ball(r0 * (t.skeletal ? 0.9 : 1.25), handMat, 1, 1, 1, 8);
      fist.position.copy(hand);
      shoulder.add(fist);
      if (!t.skeletal && !dressed && !t.armor) {
        for (const i of [-1, 0, 1]) {
          const claw = cone(0.009, 0.05, mats.accent, 4);
          claw.rotation.x = Math.PI / 2;
          claw.position.set(hand.x + i * 0.02, hand.y - 0.02, hand.z + 0.07);
          shoulder.add(claw);
        }
      }
      shoulder.rotation.z = -0.1 * side;
      if (t.zombie) shoulder.rotation.x = -1.2 - pair * 0.1;
      upper.add(shoulder);
      armRefs.push(shoulder);
      if (pair === 0) { if (side === 1) holdR = shoulder; else holdL = shoulder; }
      const handPos = hand.clone();
      (shoulder as Group & { handPos?: Vector3 }).handPos = handPos;
    }
  }
  const restX = armRefs.map((a) => a.rotation.x);
  tick(ctx, (time) => {
    armRefs.forEach((a, i) => {
      a.rotation.x = restX[i]! + 0.045 * Math.sin(time * 1.5 + ctx.phase + i * 1.9);
    });
  });

  // --- weapon and shield
  const holdPoint = (arm: Group | null): Vector3 => (arm as (Group & { handPos?: Vector3 }) | null)?.handPos ?? new Vector3();
  if (holdR && t.weapon !== "none") {
    const w = makeWeapon(ctx, t.weapon, gold);
    w.position.copy(holdPoint(holdR));
    w.position.y += 0.02;
    w.rotation.x = t.zombie ? 0.2 : -0.5;
    holdR.add(w);
  }
  if (holdL && t.shield) {
    const shield = cyl(0.27, 0.27, 0.035, mats.cloth, 12);
    shield.rotation.x = Math.PI / 2;
    const boss = ball(0.06, mats.metal, 1, 1, 0.8, 8);
    boss.position.z = 0.03;
    boss.rotation.x = -Math.PI / 2;
    const rim = torus(0.265, 0.02, mats.metal, Math.PI * 2, 5, 18);
    const s = new Group();
    s.add(shield, rim, boss);
    s.position.copy(holdPoint(holdL)).add(new Vector3(-0.03, 0.03, 0.1));
    holdL.add(s);
  }

  // --- idle: breathing and head sway
  tick(ctx, (time) => {
    const b = Math.sin(time * 1.7 + ctx.phase);
    upper.scale.y = 1 + 0.012 * b;
    upper.scale.x = 1 - 0.006 * b;
    headGroup.rotation.y = 0.16 * Math.sin(time * 0.7 + ctx.phase);
    headGroup.rotation.x = counterLean + 0.03 * Math.sin(time * 1.1 + ctx.phase);
    body.position.y = 0.006 * b;
  });

  return { upper, shoulderY, hipY };
}

function makeWeapon(ctx: Ctx, kind: string, gold: MeshStandardMaterial): Group {
  const mats = { ...ctx.mats, cloth: new MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.9 }) };
  const g = new Group();
  switch (kind) {
    case "sword": {
      const blade = box(0.055, 0.85, 0.014, mats.metal);
      blade.position.y = 0.5;
      const guard = box(0.22, 0.03, 0.04, gold);
      guard.position.y = 0.06;
      const hilt = cyl(0.014, 0.014, 0.14, mats.cloth, 6);
      const pommel = ball(0.025, gold, 1, 1, 1, 6);
      pommel.position.y = -0.08;
      g.add(blade, guard, hilt, pommel);
      break;
    }
    case "dagger": {
      const blade = box(0.04, 0.34, 0.012, mats.metal);
      blade.position.y = 0.22;
      const guard = box(0.12, 0.02, 0.03, gold);
      guard.position.y = 0.05;
      const hilt = cyl(0.012, 0.012, 0.1, mats.cloth, 6);
      g.add(blade, guard, hilt);
      break;
    }
    case "axe": {
      const haft = cyl(0.02, 0.02, 1.0, mats.cloth, 6);
      haft.position.y = 0.35;
      const head = box(0.3, 0.22, 0.03, mats.metal);
      head.position.set(0.14, 0.72, 0);
      const back = box(0.08, 0.1, 0.05, mats.metal);
      back.position.set(-0.06, 0.72, 0);
      g.add(haft, head, back);
      break;
    }
    case "club": {
      const c = cyl(0.09, 0.03, 0.85, mats.cloth, 8);
      c.position.y = 0.35;
      const studs = [0.55, 0.65, 0.72].map((y, i) => {
        const s = cone(0.02, 0.05, mats.metal, 4);
        s.position.set(i % 2 ? 0.08 : -0.08, y, i === 1 ? 0.08 : 0);
        s.rotation.z = i % 2 ? -Math.PI / 2 : Math.PI / 2;
        return s;
      });
      g.add(c, ...studs);
      break;
    }
    case "staff": {
      const pole = cyl(0.022, 0.028, 1.75, mats.cloth, 6);
      pole.position.y = 0.6;
      const orb = ball(0.07, mats.glow, 1, 1, 1, 10);
      orb.position.y = 1.53;
      const claw = torus(0.07, 0.014, mats.cloth, Math.PI * 1.6, 5, 10);
      claw.position.y = 1.5;
      g.add(pole, claw, orb);
      tick(ctx, (time) => orb.scale.setScalar(1 + 0.12 * Math.sin(time * 3 + ctx.phase)));
      break;
    }
    case "spear": {
      const pole = cyl(0.018, 0.018, 1.9, mats.cloth, 6);
      pole.position.y = 0.55;
      const tip = cone(0.04, 0.24, mats.metal, 4);
      tip.position.y = 1.62;
      g.add(pole, tip);
      break;
    }
    case "bow": {
      const arc = torus(0.42, 0.014, mats.cloth, Math.PI, 5, 20);
      arc.rotation.z = -Math.PI / 2;
      arc.position.y = 0.05;
      const string = cyl(0.004, 0.004, 0.84, mats.white, 3);
      string.position.set(-0.0, 0.05, 0);
      string.position.x = 0.0;
      g.add(arc, string);
      g.rotation.y = Math.PI / 2;
      break;
    }
    default: break;
  }
  return g;
}
