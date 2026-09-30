// Where the battle map is looking: how far in, and at which point of the
// board. Pure arithmetic, no DOM, so the node tests drive it directly
// (scripts/test-battlemap-camera.mjs).
//
// The map is drawn in its own units (a tile is TILE of them) and the window
// onto it is a box of pixels. The camera is a zoom and a centre in map units;
// zoom 1 fits the whole board into the box, and everything else follows:
//
//   px per unit = fit * zoom        the window shows box / (px per unit) units
//
// The picture is made crisp at any zoom by changing the SVG's viewBox, never
// by scaling a bitmap, so a phone can go in as far as it likes.

export type Cam = { zoom: number; cx: number; cy: number };
export type Box = { w: number; h: number };
export type Point = { x: number; y: number };

// The whole board fills the box at 1; in past a tile of this many pixels is
// no help to anyone's finger.
export const MAX_TILE_PX = 110;
const MIN_ZOOM = 1;
const MAX_ZOOM_FLOOR = 4;

export function fitScale(box: Box, W: number, H: number): number {
  return Math.min(box.w / W, box.h / H);
}

export function maxZoom(box: Box, W: number, H: number, tile: number): number {
  const fit = fitScale(box, W, H);
  return fit > 0 ? Math.max(MAX_ZOOM_FLOOR, MAX_TILE_PX / (fit * tile)) : MAX_ZOOM_FLOOR;
}

// Keeps the zoom in range and the board under the window: an axis the board
// fills cannot be dragged past its edge, an axis the window is bigger than
// centres the board.
export function clampCam(cam: Cam, box: Box, W: number, H: number, tile: number): Cam {
  const fit = fitScale(box, W, H);
  if (!(fit > 0)) return { zoom: 1, cx: W / 2, cy: H / 2 };
  const zoom = Math.min(maxZoom(box, W, H, tile), Math.max(MIN_ZOOM, cam.zoom));
  const s = fit * zoom;
  const vw = box.w / s;
  const vh = box.h / s;
  const axis = (c: number, view: number, size: number) => (view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, c)));
  return { zoom, cx: axis(cam.cx, vw, W), cy: axis(cam.cy, vh, H) };
}

// The window onto the map, as an SVG viewBox.
export function viewBoxOf(cam: Cam, box: Box, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const s = fitScale(box, W, H) * cam.zoom;
  const w = box.w / s;
  const h = box.h / s;
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, w, h };
}

// The map point under a pixel of the box.
export function worldAt(cam: Cam, box: Box, W: number, H: number, px: Point): Point {
  const v = viewBoxOf(cam, box, W, H);
  const s = box.w / v.w;
  return { x: v.x + px.x / s, y: v.y + px.y / s };
}

// The camera that puts map point `world` under pixel `px` at `zoom`.
function placed(world: Point, px: Point, zoom: number, box: Box, W: number, H: number): Cam {
  const s = fitScale(box, W, H) * zoom;
  return { zoom, cx: world.x - px.x / s + box.w / (2 * s), cy: world.y - px.y / s + box.h / (2 * s) };
}

// Zooms by `factor` around a pixel, so the tile under the finger or the
// cursor stays under it.
export function zoomAt(cam: Cam, factor: number, px: Point, box: Box, W: number, H: number, tile: number): Cam {
  const world = worldAt(cam, box, W, H, px);
  const zoom = Math.min(maxZoom(box, W, H, tile), Math.max(MIN_ZOOM, cam.zoom * factor));
  return clampCam(placed(world, px, zoom, box, W, H), box, W, H, tile);
}

// Drags the board by a number of pixels.
export function panBy(cam: Cam, dx: number, dy: number, box: Box, W: number, H: number, tile: number): Cam {
  const s = fitScale(box, W, H) * cam.zoom;
  return clampCam({ ...cam, cx: cam.cx - dx / s, cy: cam.cy - dy / s }, box, W, H, tile);
}

export type PinchStart = { cam: Cam; mid: Point; dist: number };

// Two fingers: the spread scales, the movement of their midpoint drags, and
// the map point that was between them stays between them.
export function pinch(start: PinchStart, mid: Point, dist: number, box: Box, W: number, H: number, tile: number): Cam {
  const world = worldAt(start.cam, box, W, H, start.mid);
  const ratio = start.dist > 0 ? dist / start.dist : 1;
  const zoom = Math.min(maxZoom(box, W, H, tile), Math.max(MIN_ZOOM, start.cam.zoom * ratio));
  return clampCam(placed(world, mid, zoom, box, W, H), box, W, H, tile);
}

// The zoom at which a tile is about `tilePx` wide on screen, never out of
// range: the comfortable size for a finger.
export function comfortZoom(box: Box, W: number, H: number, tile: number, tilePx = 44): number {
  const fit = fitScale(box, W, H);
  if (!(fit > 0)) return 1;
  return Math.min(maxZoom(box, W, H, tile), Math.max(MIN_ZOOM, tilePx / (fit * tile)));
}

export function centred(W: number, H: number): Cam {
  return { zoom: 1, cx: W / 2, cy: H / 2 };
}

// Whether a map point sits comfortably inside the window (away from the
// edges), so following a piece does not jerk the board when it is in view.
export function inView(cam: Cam, point: Point, box: Box, W: number, H: number, margin = 0.2): boolean {
  const v = viewBoxOf(cam, box, W, H);
  return (
    point.x >= v.x + v.w * margin &&
    point.x <= v.x + v.w * (1 - margin) &&
    point.y >= v.y + v.h * margin &&
    point.y <= v.y + v.h * (1 - margin)
  );
}
