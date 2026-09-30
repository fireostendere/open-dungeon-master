// The painted battle-map styles: the region geometry they are built from, the
// per-device style choice, and the two things a style must never get wrong,
// whatever it looks like. Every colour it prints is a real colour, and fog
// is opaque over exactly the tiles the player has not explored.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(import.meta.dirname, "..");

const store = new Map();
const events = [];
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: (e) => events.push(e.type),
};

const bundle = await build({
  stdin: {
    contents: `
      export * as geo from "@/lib/battlemap/map-geometry";
      export * from "@/lib/battlemap/map-style";
      export { buildPaintedCells } from "@/app/campaigns/[campaignId]/battleMapStyles";
      export { PALETTES } from "@/app/campaigns/[campaignId]/battleMapCells";
      export { sampleView } from "./src/battlemap-lab/sample";
      export { MAP_THEMES } from "@/lib/battlemap/generate";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "error",
});
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { geo } = m;
const T = 32;

// The tiles a path made of "M x y h w v h h -w z" runs covers.
function covered(d) {
  const tiles = new Set();
  for (const run of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)) {
    const [x, y, w] = [Number(run[1]), Number(run[2]), Number(run[3])];
    for (let cx = x; cx < x + w - 0.5; cx += T) tiles.add(`${Math.round(cx / T)},${Math.round(y / T)}`);
  }
  return tiles;
}

test("tilesPath covers exactly the tiles it is given, merged into runs", () => {
  const set = new Set(["0,0", "1,0", "2,0", "1,2", "3,2"]);
  const d = geo.tilesPath(4, 3, T, (x, y) => set.has(`${x},${y}`));
  assert.deepEqual([...covered(d)].sort(), [...set].sort());
  assert.equal((d.match(/M/g) ?? []).length, 3, "three runs: one of three tiles and two singles");
  assert.equal(geo.tilesPath(4, 3, T, () => false), "");
});

test("tilesPath insets a run on every side and never goes negative for a tile", () => {
  const d = geo.tilesPath(2, 1, T, () => true, 9);
  assert.match(d, /^M9 9h46v14h-46z$/);
});

test("edgesPath draws only the sides that face an open neighbour", () => {
  const solid = (x, y) => x === 1 && y === 1;
  const open = (x, y) => !(x === 1 && y === 1);
  const all = geo.edgesPath(3, 3, T, solid, open);
  assert.equal((all.match(/M/g) ?? []).length, 4);
  const north = geo.edgesPath(3, 3, T, solid, open, ["n"]);
  assert.equal(north, `M${T} ${T}h${T}`);
  const south = geo.edgesPath(3, 3, T, solid, open, ["s"]);
  assert.equal(south, `M${T} ${2 * T}h${T}`);
  // A wall that meets nothing open has no edge.
  assert.equal(geo.edgesPath(3, 3, T, solid, () => false), "");
  // A run of wall along one face is one stroke.
  const row = geo.edgesPath(4, 2, T, (x, y) => y === 1, (x, y) => y === 0, ["n"]);
  assert.equal(row, `M0 ${T}h${4 * T}`);
});

test("shade always prints a valid colour, even for a fractional step", () => {
  for (const amt of [-30, -13.6, 0, 7.4, 26.9, 300, -300]) {
    assert.match(geo.shade("#92866d", amt), /^#[0-9a-f]{6}$/, `step ${amt}`);
  }
});

test("hashNoise and seeded are stable, so a texture never changes between renders", () => {
  assert.equal(geo.hashNoise(3, 4, 5), geo.hashNoise(3, 4, 5));
  const a = geo.seeded(9);
  const b = geo.seeded(9);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("the style choice is per device, validated, and announced", () => {
  assert.equal(m.readMapStyle(), m.DEFAULT_MAP_STYLE);
  m.writeMapStyle("parchment");
  assert.equal(store.get(m.MAP_STYLE_KEY), "parchment");
  assert.equal(m.readMapStyle(), "parchment");
  assert.ok(events.includes(m.MAP_STYLE_EVENT));
  store.set(m.MAP_STYLE_KEY, "graffiti");
  assert.equal(m.readMapStyle(), m.DEFAULT_MAP_STYLE, "an unknown stored value falls back");
  assert.equal(m.sanitizeMapStyle(42), m.DEFAULT_MAP_STYLE);
  assert.ok(m.MAP_STYLES.includes(m.DEFAULT_MAP_STYLE));
});

const PAINTED = m.MAP_STYLES.filter((s) => s !== "classic");
const FOG = { flagstone: "#040406", relief: "#040406", torchlit: "#040406", parchment: "#1c150e", blueprint: "#050b13" };

function render(view, style) {
  const { defs, cells } = m.buildPaintedCells(view, m.PALETTES[view.theme], style, "t", false);
  // A plain svg stand-in for the grid that hosts the layers.
  return renderToStaticMarkup(createElement("svg", null, createElement("defs", null, defs), cells));
}

for (const style of PAINTED) {
  test(`${style}: prints only valid numbers and colours on every theme, fogged, clear and over art`, () => {
    for (const theme of m.MAP_THEMES) {
      for (const opts of [{ fog: true }, { fog: false }, { fog: true, art: true }, { fog: true, ambient: "dark" }]) {
        const svg = render(m.sampleView(theme, opts), style);
        const where = `${style}/${theme}/${JSON.stringify(opts)}`;
        assert.doesNotMatch(svg, /NaN|undefined|\[object|Infinity/, where);
        for (const attr of svg.matchAll(/\s(?:fill|stroke|stop-color|flood-color)="([^"]*)"/g)) {
          assert.match(attr[1], /^(#[0-9a-fA-F]{3,8}|none|url\(#[\w-]+\)|currentColor)$/, `${where}: ${attr[0]}`);
        }
        // Every reachable tile is a click target carrying its coordinates.
        const view = m.sampleView(theme, opts);
        assert.equal((svg.match(/data-tile-x=/g) ?? []).length, view.reachable.length, where);
      }
    }
  });

  test(`${style}: fog is opaque over exactly the tiles the player has not explored`, () => {
    for (const theme of m.MAP_THEMES) {
      for (const art of [false, true]) {
        const view = m.sampleView(theme, { fog: true, art });
        const svg = render(view, style);
        const explored = new Set(view.explored);
        const unexplored = new Set();
        for (let idx = 0; idx < view.width * view.height; idx += 1) {
          if (!explored.has(idx)) unexplored.add(`${idx % view.width},${Math.floor(idx / view.width)}`);
        }
        assert.ok(unexplored.size > 0, "the sample really has fog");
        const fog = [...svg.matchAll(new RegExp(`<path d="([^"]*)" fill="${FOG[style]}"></path>`, "g"))];
        assert.equal(fog.length, 1, `${style}/${theme}: one opaque fog path`);
        assert.deepEqual([...covered(fog[0][1])].sort(), [...unexplored].sort(), `${style}/${theme}/art=${art}`);
      }
    }
  });
}

test("the tilt is a per-device switch, off unless chosen, and never leaves the board's box", () => {
  assert.equal(m.readMapTilt(), false);
  m.writeMapTilt(true);
  assert.equal(store.get(m.MAP_TILT_KEY), "1");
  assert.equal(m.readMapTilt(), true);
  assert.ok(events.includes(m.MAP_TILT_EVENT));
  m.writeMapTilt(false);
  assert.equal(m.readMapTilt(), false);
  store.set(m.MAP_TILT_KEY, "banana");
  assert.equal(m.readMapTilt(), false, "an unknown stored value is off");
  // Tilting about the bottom edge keeps the far side inside the near side's width,
  // measured in the board's own width so every size leans alike.
  const wide = m.mapTiltStyle(0.7);
  assert.equal(wide.transformOrigin, "50% 100%");
  assert.match(wide.transform, /perspective\(\d+cqw\) rotateX\((\d+)deg\)/);
  assert.ok(Number(wide.transform.match(/rotateX\((\d+)deg\)/)[1]) <= 25, "a little, not a lot");
  assert.equal(m.MAP_TILT_HOST_STYLE.containerType, "inline-size");
  // The band above the far edge is taken back, and is always less than the board.
  for (const aspect of [0.4, 0.5, 0.7, 0.9, 1.25]) {
    const margin = parseFloat(m.mapTiltStyle(aspect).marginTop);
    assert.ok(margin < 0 && -margin < aspect * 100 * 0.25, `aspect ${aspect}: ${margin}cqw`);
  }
  assert.ok(parseFloat(m.mapTiltStyle(1.25).marginTop) < parseFloat(m.mapTiltStyle(0.5).marginTop), "a taller board leaves a bigger band");
});

test("the painted layers are a few dozen nodes, not one per tile", () => {
  const view = m.sampleView("forest", { fog: false });
  for (const style of PAINTED) {
    const svg = render(view, style);
    const nodes = (svg.match(/<[a-zA-Z]/g) ?? []).length;
    // The reachable squares are the one per-tile layer, and they are few.
    assert.ok(nodes < 900, `${style}: ${nodes} nodes`);
  }
});
