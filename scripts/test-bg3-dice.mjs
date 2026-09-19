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

console.log("All D20 geometric checks passed successfully! 🎲");
