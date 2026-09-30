// The battle map's camera: zoom, pan and pinch arithmetic, in map units.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const cam = await import("../src/lib/battlemap/camera.ts");
const T = 32;
const W = 20 * T; // 640
const H = 14 * T; // 448
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// A phone: a narrow, tall window. A desk: a window in the board's own shape.
const phone = { w: 358, h: 540 };
const desk = { w: 640, h: 448 };

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("zoom 1 fits the whole board in the window, whatever its shape", () => {
  assert.equal(cam.fitScale(desk, W, H), 1);
  close(cam.fitScale(phone, W, H), 358 / 640);
  const v = cam.viewBoxOf(cam.centred(W, H), phone, W, H);
  close(v.w, W, 1e-6);
  assert.ok(v.h > H, "a tall window sees more than the board's height");
  close(v.x + v.w / 2, W / 2);
  close(v.y + v.h / 2, H / 2);
});

test("the viewBox always has the window's own aspect, so nothing is letterboxed", () => {
  for (const box of [phone, desk, { w: 1000, h: 300 }]) {
    for (const zoom of [1, 1.7, 3]) {
      const v = cam.viewBoxOf({ zoom, cx: 300, cy: 200 }, box, W, H);
      close(v.w / v.h, box.w / box.h, 1e-9);
    }
  }
});

test("the board cannot be dragged off its window, and is centred where it is smaller", () => {
  const zoomed = cam.clampCam({ zoom: 3, cx: -500, cy: 9999 }, desk, W, H, T);
  const v = cam.viewBoxOf(zoomed, desk, W, H);
  close(v.x, 0);
  close(v.y + v.h, H);
  // At zoom 1 in a tall window there is nowhere to drag: it stays centred.
  const still = cam.clampCam({ zoom: 1, cx: 10, cy: 10 }, phone, W, H, T);
  close(still.cx, W / 2);
  close(still.cy, H / 2);
});

test("zoom stays between the whole board and a finger-sized tile", () => {
  assert.equal(cam.clampCam({ zoom: 0.2, cx: 0, cy: 0 }, desk, W, H, T).zoom, 1);
  const top = cam.clampCam({ zoom: 999, cx: 0, cy: 0 }, desk, W, H, T).zoom;
  close(top, Math.max(4, cam.MAX_TILE_PX / (1 * T)));
  assert.ok(top * T * cam.fitScale(desk, W, H) <= cam.MAX_TILE_PX + 1e-6 || top === 4);
});

test("zooming at a point keeps the map under that point where it was", () => {
  const start = cam.clampCam({ zoom: 2, cx: 300, cy: 200 }, phone, W, H, T);
  const px = { x: 90, y: 400 };
  const before = cam.worldAt(start, phone, W, H, px);
  for (const factor of [1.4, 0.8, 2]) {
    const next = cam.zoomAt(start, factor, px, phone, W, H, T);
    const after = cam.worldAt(next, phone, W, H, px);
    // Where clamping did not have to move it: an axis the window has grown
    // past the board on is centred instead, which is the point of the clamp.
    const v = cam.viewBoxOf(next, phone, W, H);
    if (v.w < W) close(after.x, before.x, 1e-6);
    if (v.h < H) close(after.y, before.y, 1e-6);
  }
});

test("panning moves the board with the finger", () => {
  const start = cam.clampCam({ zoom: 3, cx: 320, cy: 224 }, desk, W, H, T);
  const s = cam.fitScale(desk, W, H) * start.zoom;
  const moved = cam.panBy(start, 30, -20, desk, W, H, T);
  close(moved.cx, start.cx - 30 / s);
  close(moved.cy, start.cy + 20 / s);
  assert.equal(moved.zoom, start.zoom);
});

test("a pinch scales by the spread and the point between the fingers stays between them", () => {
  const start = { cam: cam.clampCam({ zoom: 2, cx: 300, cy: 200 }, phone, W, H, T), mid: { x: 180, y: 270 }, dist: 100 };
  const world = cam.worldAt(start.cam, phone, W, H, start.mid);
  const spread = cam.pinch(start, start.mid, 150, phone, W, H, T);
  close(spread.zoom, start.cam.zoom * 1.5);
  const at = cam.worldAt(spread, phone, W, H, start.mid);
  close(at.x, world.x, 1e-6);
  close(at.y, world.y, 1e-6);
  // Moving both fingers together drags the board without changing the zoom.
  const dragged = cam.pinch(start, { x: 150, y: 270 }, 100, phone, W, H, T);
  close(dragged.zoom, start.cam.zoom);
  assert.ok(dragged.cx > start.cam.cx, "fingers moved left, so the window moved right");
  // Pinching in past the whole board stops at the whole board.
  assert.equal(cam.pinch(start, start.mid, 1, phone, W, H, T).zoom, 1);
});

test("the comfortable zoom puts a tile at about a finger's width, and is never out of range", () => {
  const z = cam.comfortZoom(phone, W, H, T, 44);
  close(z * cam.fitScale(phone, W, H) * T, 44, 1e-6);
  assert.ok(z > 1);
  // A window that already shows tiles that big needs no zoom.
  assert.equal(cam.comfortZoom({ w: 1600, h: 1120 }, W, H, T, 44), 1);
  assert.equal(cam.comfortZoom({ w: 0, h: 0 }, W, H, T, 44), 1);
});

test("a piece counts as in view only away from the window's edges", () => {
  const c = cam.clampCam({ zoom: 3, cx: 320, cy: 224 }, desk, W, H, T);
  assert.equal(cam.inView(c, { x: 320, y: 224 }, desk, W, H), true);
  assert.equal(cam.inView(c, { x: 0, y: 0 }, desk, W, H), false);
  const v = cam.viewBoxOf(c, desk, W, H);
  assert.equal(cam.inView(c, { x: v.x + 1, y: 224 }, desk, W, H), false, "at the very edge is not comfortably in view");
});

test("an unmeasured window is a safe no-op", () => {
  const c = cam.clampCam({ zoom: 3, cx: 5, cy: 5 }, { w: 0, h: 0 }, W, H, T);
  assert.deepEqual(c, { zoom: 1, cx: W / 2, cy: H / 2 });
});

console.log(`battlemap camera: ${passed} tests passed`);
