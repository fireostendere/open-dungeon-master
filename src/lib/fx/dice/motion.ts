// Deterministic dice throws.
//
// The server has already rolled, so the animation must land on a known face.
// Instead of a physics engine (and relabelling faces after the fact), each
// throw is planned up front: parabolic bounces with restitution, a spin that
// is integrated forward and loses energy at every impact, and a final roll
// over the last edge onto the resting face. A constant correction rotation is
// blended in while the die is still spinning fast, so the integrated spin ends
// exactly on the rest orientation without the viewer seeing a snap.
//
// Height is always derived from the die's lowest vertex in its current
// orientation, so a die never sinks into the table and visibly pivots on its
// edges as it settles.

import { Matrix4, Quaternion, Vector3 } from "three";
import type { DieShape } from "./geometry";

export const GRAVITY = 30;

export type ThrowStart = {
  pos: Vector3;
  quat: Quaternion;
  /** Linear velocity (world units / s). */
  vel?: Vector3;
  /** World-space angular velocity (rad / s). */
  omega?: Vector3;
};

export type ThrowInput = {
  shape: DieShape;
  /** World-space circumradius of the die. */
  size: number;
  /** Where the die comes to rest (y is ignored). */
  target: Vector3;
  /** Final orientation. */
  rest: Quaternion;
  start: ThrowStart;
  rng: () => number;
  delay?: number;
};

export type Impact = { t: number; strength: number };

export type ThrowPlan = {
  delay: number;
  duration: number;
  impacts: Impact[];
  /** Writes the die's transform at time `t` (seconds since the plan started). */
  sample(t: number, pos: Vector3, quat: Quaternion): void;
};

/** Exterior angle rolled when a die tips over one edge onto the next face. */
const EDGE_ROLL: Record<string, number> = {
  d4: 1.91,
  d6: Math.PI / 2,
  d8: 1.23,
  d10: 0.95,
  d10x: 0.95,
  d12: 1.11,
  d20: 0.73,
};

const tmpV = new Vector3();
const tmpQ = new Quaternion();

/** Distance from the die centre down to its lowest point in orientation `q`. */
export function supportHeight(shape: DieShape, size: number, q: Quaternion): number {
  let minY = Infinity;
  for (const v of shape.vertices) {
    tmpV.set(v[0], v[1], v[2]).applyQuaternion(q);
    if (tmpV.y < minY) minY = tmpV.y;
  }
  return -minY * size;
}

function easeOutBackSoft(s: number): number {
  const c1 = 0.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(s - 1, 3) + c1 * Math.pow(s - 1, 2);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function randomUnit(rng: () => number): Vector3 {
  const u = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new Vector3(r * Math.cos(a), u, r * Math.sin(a));
}

export function planThrow(input: ThrowInput): ThrowPlan {
  const { shape, size, rest, rng } = input;
  const delay = input.delay ?? 0;
  const g = GRAVITY;
  const inr = shape.inradius * size;

  const p0 = input.start.pos.clone();
  const target = new Vector3(input.target.x, 0, input.target.z);
  const horiz = new Vector3(target.x - p0.x, 0, target.z - p0.z);
  const distance = horiz.length();
  const dir = distance > 1e-4 ? horiz.clone().divideScalar(distance) : new Vector3(0, 0, -1);
  const rollAxis = new Vector3(0, 1, 0).cross(dir).normalize();

  // --- Vertical schedule: first fall, then bounces that lose energy. ---
  const q0 = input.start.quat.clone();
  const h0 = Math.max(0.05, p0.y - supportHeight(shape, size, q0));
  const vy0 = input.start.vel?.y ?? -1.2;
  const tFall = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0)) / g;
  const segments: { t0: number; dur: number; u: number; y0: number; vy: number }[] = [
    { t0: 0, dur: tFall, u: 0, y0: h0, vy: vy0 },
  ];
  let impactSpeed = Math.abs(vy0 - g * tFall);
  const impacts: Impact[] = [{ t: tFall, strength: Math.min(1, impactSpeed / 12) }];
  let t = tFall;
  const restitution = [0.4, 0.36, 0.3];
  for (let k = 0; k < restitution.length; k++) {
    const u = impactSpeed * restitution[k];
    if (u < 1.1) break;
    const dur = (2 * u) / g;
    segments.push({ t0: t, dur, u, y0: 0, vy: u });
    t += dur;
    impactSpeed = u;
    impacts.push({ t, strength: Math.min(1, u / 12) });
  }
  const tLand = t;
  const rollAngle = (EDGE_ROLL[shape.kind] ?? 1) * (distance > size * 2.5 && rng() < 0.6 ? 2 : 1);
  const rollDur = 0.42 + rollAngle * 0.16;
  const duration = tLand + rollDur;

  // --- Horizontal travel: speed drops at each impact, the roll covers the rest. ---
  const rollDistance = Math.min(distance * 0.45, rollAngle * inr);
  const speedFactors = segments.map((_, i) => Math.pow(0.62, i));
  const weighted = segments.reduce((acc, seg, i) => acc + seg.dur * speedFactors[i], 0);
  const baseSpeed = weighted > 0 ? (distance - rollDistance) / weighted : 0;
  const segStartDist: number[] = [];
  let acc = 0;
  segments.forEach((seg, i) => {
    segStartDist.push(acc);
    acc += seg.dur * speedFactors[i] * baseSpeed;
  });
  const flightDistance = acc;

  // --- Spin: integrate forward, losing energy and picking up roll at impacts. ---
  const omega0 = input.start.omega?.clone() ?? randomUnit(rng).multiplyScalar(15 + rng() * 7);
  const omegas: Vector3[] = [omega0];
  for (let i = 1; i < segments.length; i++) {
    const prev = omegas[i - 1];
    const hv = speedFactors[i] * baseSpeed;
    const kick = rollAxis.clone().multiplyScalar((hv / Math.max(inr, 0.05)) * 0.55);
    const jitter = randomUnit(rng).multiplyScalar(prev.length() * 0.25);
    omegas.push(prev.clone().multiplyScalar(0.5).add(kick).add(jitter));
  }
  const RATE = 240;
  const steps = Math.max(1, Math.ceil(tLand * RATE));
  const simQ: Quaternion[] = [q0.clone()];
  {
    const q = q0.clone();
    let seg = 0;
    for (let i = 1; i <= steps; i++) {
      const time = (i / steps) * tLand;
      while (seg < segments.length - 1 && time > segments[seg].t0 + segments[seg].dur) seg++;
      const w = omegas[seg];
      const angle = w.length() * (tLand / steps);
      if (angle > 1e-6) {
        tmpQ.setFromAxisAngle(tmpV.copy(w).normalize(), angle);
        q.premultiply(tmpQ).normalize();
      }
      simQ.push(q.clone());
    }
  }
  // Orientation where the final roll begins: rest, rolled back over the edge.
  const landQ = new Quaternion().setFromAxisAngle(rollAxis, -rollAngle).multiply(rest);
  const correction = landQ.clone().multiply(simQ[simQ.length - 1].clone().invert());
  const identity = new Quaternion();
  // Finish the correction while the die is still tumbling hard.
  const blendEnd = Math.min(tLand * 0.8, (segments[1]?.t0 ?? tLand) + (segments[1]?.dur ?? 0) * 0.5);

  const sampleSim = (time: number, out: Quaternion) => {
    const f = Math.min(steps, Math.max(0, (time / tLand) * steps));
    const i = Math.floor(f);
    const j = Math.min(steps, i + 1);
    out.copy(simQ[i]).slerp(simQ[j], f - i);
  };

  const blendQ = new Quaternion();
  return {
    delay,
    duration: duration + delay,
    impacts: impacts.map((im) => ({ t: im.t + delay, strength: im.strength })),
    sample(time, pos, quat) {
      const tt = time - delay;
      if (tt <= 0) {
        pos.copy(p0);
        quat.copy(q0);
        return;
      }
      let contactY = 0;
      let along = 0;
      if (tt < tLand) {
        sampleSim(tt, quat);
        blendQ.copy(identity).slerp(correction, smoothstep(0, blendEnd, tt));
        quat.premultiply(blendQ);
        let seg = 0;
        while (seg < segments.length - 1 && tt > segments[seg].t0 + segments[seg].dur) seg++;
        const s = segments[seg];
        const lt = tt - s.t0;
        contactY = Math.max(0, s.y0 + s.vy * lt - 0.5 * g * lt * lt);
        along = segStartDist[seg] + lt * speedFactors[seg] * baseSpeed;
      } else {
        const s = Math.min(1, (tt - tLand) / rollDur);
        const phi = rollAngle * easeOutBackSoft(s);
        quat.setFromAxisAngle(rollAxis, phi - rollAngle).multiply(rest);
        const progress = 1 - Math.pow(1 - s, 3);
        along = flightDistance + rollDistance * progress;
      }
      const k = distance > 1e-4 ? along / distance : 1;
      pos.set(p0.x + (target.x - p0.x) * k, 0, p0.z + (target.z - p0.z) * k);
      pos.y = contactY + supportHeight(shape, size, quat);
    },
  };
}

/**
 * Orientation that shows a labelled local frame to the world: `up` goes to +Y
 * and `toward` (orthogonalised) goes to +Z, then a twist around Y is applied.
 */
export function orientationFor(up: Vector3, toward: Vector3, twist = 0): Quaternion {
  const u = up.clone().normalize();
  const t = toward.clone().sub(u.clone().multiplyScalar(toward.dot(u))).normalize();
  const s = new Vector3().crossVectors(u, t);
  // Rows of the rotation are the local basis vectors that map to X, Y, Z.
  const m = new Matrix4().set(s.x, s.y, s.z, 0, u.x, u.y, u.z, 0, t.x, t.y, t.z, 0, 0, 0, 0, 1);
  const q = new Quaternion().setFromRotationMatrix(m);
  if (twist) q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twist));
  return q;
}
