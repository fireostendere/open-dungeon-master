// Polyhedral dice geometry, framework-free.
//
// Every die is described as a convex polyhedron centred on the origin with
// labelled faces. The renderer never relabels faces per roll: a roll for value
// v is shown by *orienting* the die so the face carrying v points up, which is
// what `restPose` answers. That keeps the dice honest (opposite faces still sum
// to n + 1) and lets the same meshes be reused across rolls.

export type Vec3 = [number, number, number];

export type DieKind = "d4" | "d6" | "d8" | "d10" | "d10x" | "d12" | "d20";

export type DieFace = {
  /** Vertex indices, counter-clockwise when viewed from outside. */
  verts: number[];
  center: Vec3;
  normal: Vec3;
  /** Tangent that points "up" for the printed label. */
  up: Vec3;
  /** Face value (d4: unused, see `vertexValues`). */
  value: number;
  label: string;
};

export type DieShape = {
  kind: DieKind;
  sides: number;
  vertices: Vec3[];
  faces: DieFace[];
  /** d4 only: the value read at each vertex when that vertex points up. */
  vertexValues?: number[];
  /** Distance from the centre to a face plane: the resting height. */
  inradius: number;
  /** Largest vertex distance, used for spacing and camera framing. */
  circumradius: number;
};

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function centroid(points: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return scale(c, 1 / points.length);
}

/** Orders an unordered convex face counter-clockwise around its outward normal. */
function orderFace(vertices: Vec3[], indices: number[]): { verts: number[]; center: Vec3; normal: Vec3 } {
  const center = centroid(indices.map((i) => vertices[i]));
  // Every die is centred on the origin, so the centroid direction is outward.
  const normalGuess = norm(center);
  const ref = norm(sub(vertices[indices[0]], center));
  const side = cross(normalGuess, ref);
  const sorted = [...indices].sort((a, b) => {
    const da = sub(vertices[a], center);
    const db = sub(vertices[b], center);
    return Math.atan2(dot(da, side), dot(da, ref)) - Math.atan2(dot(db, side), dot(db, ref));
  });
  const n = norm(
    cross(sub(vertices[sorted[1]], vertices[sorted[0]]), sub(vertices[sorted[2]], vertices[sorted[0]])),
  );
  return { verts: sorted, center, normal: dot(n, normalGuess) >= 0 ? n : scale(n, -1) };
}

function projectTangent(v: Vec3, normal: Vec3): Vec3 {
  return norm(sub(v, scale(normal, dot(v, normal))));
}

function labelFor(kind: DieKind, value: number): string {
  // Physical d10s print 0 for ten; the tens die of a d100 pair prints 00-90.
  if (kind === "d10x") return value === 10 ? "00" : `${value}0`;
  if (kind === "d10") return value === 10 ? "0" : String(value);
  return String(value);
}

/**
 * Pairs opposite faces and numbers them so each pair sums to n + 1, the way
 * physical dice are made. `order` spreads low and high numbers around the die
 * instead of clustering 1, 2, 3 on neighbouring faces.
 */
function numberOppositePairs(faces: { normal: Vec3 }[], sides: number): number[] {
  const values = new Array<number>(faces.length).fill(0);
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  for (let i = 0; i < faces.length; i++) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDot = 2;
    for (let j = 0; j < faces.length; j++) {
      if (j === i || used.has(j)) continue;
      const d = dot(faces[i].normal, faces[j].normal);
      if (d < bestDot) {
        bestDot = d;
        best = j;
      }
    }
    used.add(i);
    used.add(best);
    pairs.push([i, best]);
  }
  const half = pairs.length;
  // A stride coprime with the pair count scatters consecutive values.
  const stride = [5, 7, 3, 2].find((s) => half % s !== 0 && s < half) ?? 1;
  pairs.forEach(([a, b], k) => {
    const low = ((k * stride) % half) + 1;
    const flip = k % 2 === 1;
    values[flip ? b : a] = low;
    values[flip ? a : b] = sides + 1 - low;
  });
  return values;
}

function finish(
  kind: DieKind,
  sides: number,
  vertices: Vec3[],
  rawFaces: number[][],
  upFor: (face: { verts: number[]; center: Vec3; normal: Vec3 }) => Vec3,
  values?: number[],
): DieShape {
  const ordered = rawFaces.map((f) => orderFace(vertices, f));
  const vals = values ?? numberOppositePairs(ordered, sides);
  const faces: DieFace[] = ordered.map((f, i) => ({
    ...f,
    up: upFor(f),
    value: vals[i],
    label: labelFor(kind, vals[i]),
  }));
  const inradius = Math.min(...faces.map((f) => dot(f.center, f.normal)));
  const circumradius = Math.max(...vertices.map(len));
  return { kind, sides, vertices, faces, inradius, circumradius };
}

/** Normalises vertex positions so every die has a circumradius of 1. */
function unit(vertices: Vec3[]): Vec3[] {
  const r = Math.max(...vertices.map(len));
  return vertices.map((v) => scale(v, 1 / r));
}

const PHI = (1 + Math.sqrt(5)) / 2;

const ICOSA_VERTS: Vec3[] = unit([
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
]);
const ICOSA_FACES: number[][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Label points at the face vertex that lies furthest along `axis`. */
function towardVertex(vertices: Vec3[], axis: Vec3) {
  return (f: { verts: number[]; center: Vec3; normal: Vec3 }) => {
    let best = f.verts[0];
    let bestScore = -Infinity;
    for (const i of f.verts) {
      const t = projectTangent(sub(vertices[i], f.center), f.normal);
      const score = dot(t, axis) + 1e-3 * i;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return projectTangent(sub(vertices[best], f.center), f.normal);
  };
}

function buildD20(): DieShape {
  return finish("d20", 20, ICOSA_VERTS, ICOSA_FACES, towardVertex(ICOSA_VERTS, [0.3, 1, 0.2]));
}

function buildD12(): DieShape {
  // The dodecahedron is the icosahedron's dual: one pentagon per icosahedron
  // vertex, whose corners are the centroids of the five triangles around it.
  const triCenters = ICOSA_FACES.map((f) => norm(centroid(f.map((i) => ICOSA_VERTS[i]))));
  const faces = ICOSA_VERTS.map((_, vi) =>
    ICOSA_FACES.map((f, fi) => (f.includes(vi) ? fi : -1)).filter((fi) => fi >= 0),
  );
  return finish("d12", 12, triCenters, faces, towardVertex(triCenters, [0.2, 1, 0.3]));
}

function buildD8(): DieShape {
  const v: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  return finish("d8", 8, v, f, (face) => {
    // Point the label at the polar vertex (±Y) so every number reads the same way.
    const pole = face.verts.find((i) => Math.abs(v[i][1]) > 0.5) ?? face.verts[0];
    return projectTangent(sub(v[pole], face.center), face.normal);
  });
}

function buildD6(): DieShape {
  const v = unit([
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]);
  const f = [[4, 5, 6, 7], [0, 3, 2, 1], [1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4]];
  return finish("d6", 6, v, f, (face) => {
    // Up is toward +Y on the sides, toward -Z on the top/bottom caps.
    const axis: Vec3 = Math.abs(face.normal[1]) > 0.5 ? [0, 0, -1] : [0, 1, 0];
    return projectTangent(axis, face.normal);
  }, [1, 6, 2, 5, 3, 4]);
}

function buildD10(kind: "d10" | "d10x"): DieShape {
  // Pentagonal trapezohedron. Ring vertices alternate ±e in height; the pole
  // height H follows from requiring each kite to be planar.
  const e = 0.105;
  const c36 = Math.cos(Math.PI / 5);
  const H = e + (2 * e * c36) / (1 - c36);
  const raw: Vec3[] = [[0, H, 0], [0, -H, 0]];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    raw.push([Math.cos(a), i % 2 === 0 ? e : -e, Math.sin(a)]);
  }
  const v = unit(raw);
  const ring = (i: number) => 2 + (((i % 10) + 10) % 10);
  const f: number[][] = [];
  for (let k = 0; k < 5; k++) f.push([0, ring(2 * k), ring(2 * k + 1), ring(2 * k + 2)]);
  for (let k = 0; k < 5; k++) f.push([1, ring(2 * k + 1), ring(2 * k + 2), ring(2 * k + 3)]);
  const shape = finish(kind, 10, v, f, (face) => {
    const pole = face.verts.includes(0) ? 0 : 1;
    return projectTangent(sub(v[pole], face.center), face.normal);
  }, [1, 7, 3, 9, 5, 0, 0, 0, 0, 0]);
  // Opposite faces of a d10 sum to 11: number the lower ring from the upper.
  for (let k = 0; k < 5; k++) {
    const upper = shape.faces[k];
    let best = 5;
    let bestDot = 2;
    for (let j = 5; j < 10; j++) {
      const d = dot(upper.normal, shape.faces[j].normal);
      if (d < bestDot) {
        bestDot = d;
        best = j;
      }
    }
    shape.faces[best].value = 11 - upper.value;
    shape.faces[best].label = labelFor(kind, shape.faces[best].value);
  }
  return shape;
}

function buildD4(): DieShape {
  const v = unit([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]);
  const f = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  const shape = finish("d4", 4, v, f, (face) => projectTangent(sub(v[face.verts[0]], face.center), face.normal), [0, 0, 0, 0]);
  shape.vertexValues = [4, 1, 3, 2];
  shape.faces.forEach((face) => {
    face.label = "";
  });
  return shape;
}

const CACHE = new Map<DieKind, DieShape>();

export function dieShape(kind: DieKind): DieShape {
  let shape = CACHE.get(kind);
  if (!shape) {
    shape =
      kind === "d4" ? buildD4()
      : kind === "d6" ? buildD6()
      : kind === "d8" ? buildD8()
      : kind === "d10" || kind === "d10x" ? buildD10(kind)
      : kind === "d12" ? buildD12()
      : buildD20();
    CACHE.set(kind, shape);
  }
  return shape;
}

/** Maps a die size from the rules engine to the mesh used to show it. */
export function kindForSides(sides: number): DieKind | null {
  switch (sides) {
    case 4: return "d4";
    case 6: return "d6";
    case 8: return "d8";
    case 10: return "d10";
    case 12: return "d12";
    case 20: return "d20";
    default: return null;
  }
}

/**
 * The local-space directions that must end up pointing world-up (+Y) and
 * toward the camera (+Z) for the die to show `value` readably.
 */
export function restPose(shape: DieShape, value: number): { up: Vec3; toward: Vec3 } {
  if (shape.kind === "d4") {
    const vi = Math.max(0, shape.vertexValues!.indexOf(value));
    const up = norm(shape.vertices[vi]);
    // Turn one of the three faces around the top vertex toward the viewer.
    const face = shape.faces.find((f) => f.verts.includes(vi)) ?? shape.faces[0];
    return { up, toward: projectTangent(face.normal, up) };
  }
  const face = shape.faces.find((f) => f.value === value) ?? shape.faces[0];
  // The label's up should read as screen-up, i.e. point away from the camera.
  return { up: face.normal, toward: scale(face.up, -1) };
}

/** The face index showing `value` (d4: the face opposite the top vertex). */
export function faceIndexFor(shape: DieShape, value: number): number {
  if (shape.kind === "d4") {
    const vi = shape.vertexValues!.indexOf(value);
    return shape.faces.findIndex((f) => !f.verts.includes(vi));
  }
  return Math.max(0, shape.faces.findIndex((f) => f.value === value));
}

/**
 * Splits a d100 result into face values for the tens die ("00"-"90") and the
 * units die ("0"-"9"), both valued 1..10 with 10 printed as a zero. 100 reads
 * "00" + "0", exactly as the pair is read at a table.
 */
export function splitPercentile(value: number): { tens: number; units: number } {
  const v = Math.min(100, Math.max(1, Math.round(value)));
  const tensDigit = Math.floor((v % 100) / 10);
  const unitsDigit = v % 10;
  return { tens: tensDigit === 0 ? 10 : tensDigit, units: unitsDigit === 0 ? 10 : unitsDigit };
}
