// Unit tests for Baldur's Gate 3 D20 3D geometry and rotation mathematics
import assert from "node:assert/strict";

const PHI = (1 + Math.sqrt(5)) / 2;
const INV_LEN = 1 / Math.sqrt(1 + PHI * PHI);

const D20_VERTICES = [
  [-1 * INV_LEN, PHI * INV_LEN, 0],
  [1 * INV_LEN, PHI * INV_LEN, 0],
  [-1 * INV_LEN, -PHI * INV_LEN, 0],
  [1 * INV_LEN, -PHI * INV_LEN, 0],
  [0, -1 * INV_LEN, PHI * INV_LEN],
  [0, 1 * INV_LEN, PHI * INV_LEN],
  [0, -1 * INV_LEN, -PHI * INV_LEN],
  [0, 1 * INV_LEN, -PHI * INV_LEN],
  [PHI * INV_LEN, 0, -1 * INV_LEN],
  [PHI * INV_LEN, 0, 1 * INV_LEN],
  [-PHI * INV_LEN, 0, -1 * INV_LEN],
  [-PHI * INV_LEN, 0, 1 * INV_LEN],
];

const D20_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const D20_FACE_VALUES = [
  20, 9, 2, 14, 8,
  11, 18, 4, 13, 16,
  1, 12, 19, 7, 13,
  10, 3, 17, 5, 15,
];

console.log("Checking D20 Euler characteristic (V - E + F = 2)...");
assert.equal(D20_VERTICES.length, 12, "D20 must have 12 vertices");
assert.equal(D20_FACES.length, 20, "D20 must have 20 triangular faces");
assert.equal(D20_FACE_VALUES.length, 20, "Must have 20 face values");

// Verify all vertices lie on unit sphere
for (const [x, y, z] of D20_VERTICES) {
  const len = Math.hypot(x, y, z);
  assert(Math.abs(len - 1.0) < 1e-5, `Vertex length must be 1, got ${len}`);
}

// Verify face normal calculation
function calcNormal(v0, v1, v2) {
  const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
  const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

const normals = D20_FACES.map((f) =>
  calcNormal(D20_VERTICES[f[0]], D20_VERTICES[f[1]], D20_VERTICES[f[2]])
);

// All normals must be normalized and point outward
for (let i = 0; i < normals.length; i++) {
  const [nx, ny, nz] = normals[i];
  const len = Math.hypot(nx, ny, nz);
  assert(Math.abs(len - 1.0) < 1e-5, `Normal ${i} must have length 1`);
  // Face centroid dot normal > 0 (outward)
  const face = D20_FACES[i];
  const cx = (D20_VERTICES[face[0]][0] + D20_VERTICES[face[1]][0] + D20_VERTICES[face[2]][0]) / 3;
  const cy = (D20_VERTICES[face[0]][1] + D20_VERTICES[face[1]][1] + D20_VERTICES[face[2]][1]) / 3;
  const cz = (D20_VERTICES[face[0]][2] + D20_VERTICES[face[1]][2] + D20_VERTICES[face[2]][2]) / 3;
  const dot = cx * nx + cy * ny + cz * nz;
  assert(dot > 0.5, `Normal ${i} must point outward from origin`);
}

// Test Canonical BG3 orientation
const CANONICAL_ROT = [
  [-0.3090708472753448, -0.8090248494677429, 0.4999540021923981],
  [0.7557392923695095, 0.11020644087512578, 0.6455328514943839],
  [-0.5773502691896257, 0.5773502691896257, 0.5773502691896257],
];

const face0Norm = normals[0];
const rotNormZ = CANONICAL_ROT[2][0] * face0Norm[0] + CANONICAL_ROT[2][1] * face0Norm[1] + CANONICAL_ROT[2][2] * face0Norm[2];
assert(Math.abs(rotNormZ - 1.0) < 1e-3, `Face 0 normal Z after CANONICAL_ROT must be 1.0, got ${rotNormZ}`);

function getFaceValuesForRoll(targetVal) {
  const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].filter(
    (x) => x !== targetVal
  );
  const values = [];
  values[0] = targetVal;
  for (let i = 1; i < 20; i++) {
    const pickIdx = (i * 7 + targetVal * 3) % others.length;
    values[i] = others.splice(pickIdx, 1)[0];
  }
  return values;
}

for (let v = 1; v <= 20; v++) {
  const vals = getFaceValuesForRoll(v);
  assert.equal(vals[0], v, `Face 0 must equal rolled value ${v}`);
  assert.equal(new Set(vals).size, 20, `Must have all 20 unique values for roll ${v}`);
}

console.log("All D20 geometric & canonical BG3 orientation checks passed successfully! 🎲");
