import type { ReactNode } from "react";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { PlayerMapView } from "@/lib/battlemap/view";
import {
  circlePath,
  edgesPath,
  ellipsePath,
  gridPath,
  hashNoise,
  seeded,
  shade,
  tilesPath,
  type TilePredicate,
} from "@/lib/battlemap/map-geometry";
import { artTile, TILE, type Palette } from "@/app/campaigns/[campaignId]/battleMapCells";
import {
  brickWallPattern,
  floorPattern,
  litterPattern,
  ripplePattern,
  rockWallPattern,
  type FloorColors,
  type Material,
  type WallColors,
} from "@/app/campaigns/[campaignId]/battleMapPatterns";
import { tokenDefs, type PaintedStyle } from "@/app/campaigns/[campaignId]/battleMapTokens";

// The painted battle-map styles: flagstone, torchlit, parchment, blueprint.
//
// Like the classic layer (battleMapCells.tsx) this draws only what the
// projection says is true: the same terrain string, the same explored and
// visible sets, the same lights, and fog that is opaque exactly where the
// terrain was blanked. A style changes how a wall or a puddle looks, never
// which tiles are walls or puddles, and never what a player is shown.
//
// Unlike the classic layer nothing here is one element per tile. Whole
// regions are single paths and the textures are tiled patterns, so the
// style costs a few dozen SVG nodes however large the map is.

export type PaintedLayers = { defs: ReactNode; cells: ReactNode };

type Ctx = {
  view: PlayerMapView;
  uid: string;
  width: number;
  height: number;
  W: number;
  H: number;
  ex: TilePredicate;
  vis: TilePredicate;
  ch: (x: number, y: number) => string;
  wall: TilePredicate;
  water: TilePredicate;
  rough: TilePredicate;
  door: TilePredicate;
  open: TilePredicate;
};

function makeContext(view: PlayerMapView, uid: string): Ctx {
  const { width, height } = view;
  const explored = new Set(view.explored);
  const visible = new Set(view.visible);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const ex: TilePredicate = (x, y) => inside(x, y) && explored.has(y * width + x);
  const ch = (x: number, y: number) => (ex(x, y) ? (view.terrain[y * width + x] ?? " ") : " ");
  return {
    view,
    uid,
    width,
    height,
    W: width * TILE,
    H: height * TILE,
    ex,
    vis: (x, y) => inside(x, y) && visible.has(y * width + x),
    ch,
    wall: (x, y) => ch(x, y) === "#",
    water: (x, y) => ch(x, y) === "~",
    rough: (x, y) => ch(x, y) === ",",
    door: (x, y) => ch(x, y) === "+",
    open: (x, y) => ex(x, y) && ch(x, y) !== "#",
  };
}

const path = (c: Ctx, test: TilePredicate, inset = 0) => tilesPath(c.width, c.height, TILE, test, inset);

function blurDefs(c: Ctx, sizes: Record<string, number>): ReactNode {
  // b4 is the fog's own softening, so every style has it.
  return Object.entries({ b4: 4, ...sizes }).map(([name, deviation]) => (
    <filter
      key={name}
      id={`${c.uid}-${name}`}
      filterUnits="userSpaceOnUse"
      x={-40}
      y={-40}
      width={c.W + 80}
      height={c.H + 80}
    >
      <feGaussianBlur stdDeviation={deviation} />
    </filter>
  ));
}

// Soft patches of lighter and darker ground scattered over the whole map,
// blurred later, so a natural floor varies over distances longer than the
// texture repeats.
function blotches(c: Ctx, salt: number, radius: [number, number]) {
  const rnd = seeded(salt);
  const count = Math.round((c.width * c.height) / 5);
  let dark = "";
  let light = "";
  for (let i = 0; i < count; i += 1) {
    const x = rnd() * c.W;
    const y = rnd() * c.H;
    const r = (radius[0] + rnd() * (radius[1] - radius[0])) * TILE;
    if (rnd() < 0.55) {
      dark += circlePath(x, y, r);
    } else {
      light += circlePath(x, y, r);
    }
  }
  return { dark, light };
}

// Fog is the one layer that hides information, so its rules do not change
// with the style: the unexplored path is opaque, always. A blurred copy
// beneath it only bleeds a soft edge onto tiles that are already explored.
function fogLayer(
  c: Ctx,
  look: { fog: string; halo: string; haloOpacity: number; dim: string; dimOpacity: number },
): ReactNode {
  const unexplored = path(c, (x, y) => !c.ex(x, y));
  const dim = path(c, (x, y) => c.ex(x, y) && !c.vis(x, y));
  return (
    <g pointerEvents="none">
      {dim ? <path d={dim} fill={look.dim} opacity={look.dimOpacity} filter={`url(#${c.uid}-b4)`} /> : null}
      {unexplored ? (
        <>
          <path d={unexplored} fill={look.halo} opacity={look.haloOpacity} filter={`url(#${c.uid}-b6)`} />
          <path d={unexplored} fill={look.fog} />
        </>
      ) : null}
    </g>
  );
}

// The tiles a piece may move to. These carry the data attributes the click
// handler reads, so they are the one place a painted layer takes pointer
// events.
function reachLayer(c: Ctx, look: { fill: string; fillOpacity: number; stroke: string }): ReactNode {
  return c.view.reachable.map((idx) => {
    const x = idx % c.width;
    const y = Math.floor(idx / c.width);
    return (
      <rect
        key={`r-${idx}`}
        x={x * TILE + 2}
        y={y * TILE + 2}
        width={TILE - 4}
        height={TILE - 4}
        rx={5}
        fill={look.fill}
        fillOpacity={look.fillOpacity}
        stroke={look.stroke}
        strokeOpacity={0.8}
        strokeWidth={1.5}
        strokeDasharray="4 3"
        className="cursor-pointer"
        data-tile-x={x}
        data-tile-y={y}
      />
    );
  });
}

const FLICKER_CSS = `
@keyframes odm-flicker{0%,100%{opacity:1;transform:scale(1)}28%{opacity:.86;transform:scale(.97)}52%{opacity:.98;transform:scale(1.03)}76%{opacity:.9;transform:scale(.99)}}
.odm-flicker{transform-box:fill-box;transform-origin:center;animation:odm-flicker 2.7s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.odm-flicker{animation:none}}
`;

function lightDefs(c: Ctx): ReactNode {
  return (
    <>
      <style>{FLICKER_CSS}</style>
      <radialGradient id={`${c.uid}-glow`}>
        <stop offset="0%" stopColor="#ffd28a" stopOpacity={0.55} />
        <stop offset="35%" stopColor="#ff9f43" stopOpacity={0.28} />
        <stop offset="100%" stopColor="#ff8a1f" stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${c.uid}-cut`}>
        <stop offset="0%" stopColor="#000" stopOpacity={1} />
        <stop offset="45%" stopColor="#000" stopOpacity={0.85} />
        <stop offset="100%" stopColor="#000" stopOpacity={0} />
      </radialGradient>
      <radialGradient id={`${c.uid}-ember`}>
        <stop offset="0%" stopColor="#fff6c2" />
        <stop offset="45%" stopColor="#ffb02e" />
        <stop offset="100%" stopColor="#b8480f" />
      </radialGradient>
    </>
  );
}

// A static light: a warm pool on the floor and a lit brazier at its centre
// (torch), a wash and a small flame drawn in ink (parchment), or a plain
// map symbol (blueprint).
function lightsLayer(c: Ctx, mode: "torch" | "ink" | "marker", calm: boolean): ReactNode {
  return c.view.lights.map((light, i) => {
    const cx = light.x * TILE + TILE / 2;
    const cy = light.y * TILE + TILE / 2;
    const reach = Math.max(2, light.radius) * TILE;
    if (mode === "marker") {
      return (
        <g key={`l-${i}`} pointerEvents="none">
          <circle cx={cx} cy={cy} r={reach} fill="none" stroke="#fbbf24" strokeOpacity={0.35} strokeDasharray="3 4" />
          <circle cx={cx} cy={cy} r={5.5} fill="#0a1726" stroke="#fbbf24" strokeWidth={1.8} />
          <circle cx={cx} cy={cy} r={2} fill="#fbbf24" />
        </g>
      );
    }
    if (mode === "ink") {
      return (
        <g key={`l-${i}`} pointerEvents="none">
          <circle cx={cx} cy={cy} r={reach * 1.15} fill={`url(#${c.uid}-glow)`} opacity={0.55} style={{ mixBlendMode: "multiply" }} />
          <path
            d={`M${cx} ${cy - 8}c4 4 6 7 4 10a4.5 4.5 0 0 1-8 0c-2-3 0-6 4-10z`}
            fill="#e9a23b"
            stroke="#3a2412"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    return (
      <g key={`l-${i}`} pointerEvents="none">
        <circle
          cx={cx}
          cy={cy}
          r={reach * 1.7}
          fill={`url(#${c.uid}-glow)`}
          className={calm ? undefined : "odm-flicker"}
          style={{ mixBlendMode: "screen", animationDelay: `${(i * 0.7).toFixed(1)}s` }}
        />
        <circle cx={cx} cy={cy + 1.5} r={8.5} fill="#000" opacity={0.4} />
        <circle cx={cx} cy={cy} r={7.5} fill="#1d1712" stroke="#4a3a2a" strokeWidth={1.6} />
        <circle cx={cx} cy={cy} r={5} fill={`url(#${c.uid}-ember)`} className={calm ? undefined : "odm-flicker"} />
      </g>
    );
  });
}

// ---------------------------------------------------------------------------
// Stone: the textured, lit look, and its darker torch-lit sibling.

type Look = {
  material: Material;
  floor: FloorColors;
  wallKind: "brick" | "rock" | "trees";
  wall: WallColors;
  canopy: [string, string, string, string];
  water: string;
  waterDeep: string;
  rubble: string;
};

const LOOKS: Record<MapTheme, Look> = {
  cave: {
    material: "rock",
    floor: { base: "#5b5664", dark: "#3f3b48", light: "#7b7588", accent: "#6a6577" },
    wallKind: "rock",
    wall: { base: "#1a161f", face: "#3a3441", light: "#a79eb3" },
    canopy: ["#000", "#000", "#000", "#000"],
    water: "#347f9f",
    waterDeep: "#154a64",
    rubble: "#8b8172",
  },
  forest: {
    material: "grass",
    floor: { base: "#4b6b31", dark: "#2f4b21", light: "#6f9146", accent: "#5a7e39" },
    wallKind: "trees",
    wall: { base: "#10200e", face: "#1a2f14", light: "#5c8a3c" },
    canopy: ["#1a3b16", "#26531f", "#386c2a", "#519040"],
    water: "#3d81a2",
    waterDeep: "#1b4b68",
    rubble: "#7b6b3b",
  },
  swamp: {
    material: "moss",
    floor: { base: "#4c5a37", dark: "#2f3a24", light: "#6e7c4b", accent: "#57663e" },
    wallKind: "trees",
    wall: { base: "#111a10", face: "#1c2b1a", light: "#587f4a" },
    canopy: ["#1d3320", "#2b4b2d", "#3d643a", "#5a8250"],
    water: "#436f5c",
    waterDeep: "#1f3f33",
    rubble: "#6f6a44",
  },
  riverside: {
    material: "pebble",
    floor: { base: "#92866d", dark: "#635a48", light: "#b7ab8e", accent: "#a3977a" },
    wallKind: "rock",
    wall: { base: "#1a1815", face: "#3a352e", light: "#aaa18c" },
    canopy: ["#000", "#000", "#000", "#000"],
    water: "#4193c3",
    waterDeep: "#1d5b88",
    rubble: "#8a7f68",
  },
  interior: {
    material: "slab",
    floor: { base: "#7c6b59", dark: "#5c4e40", light: "#9b8871", accent: "#6d5e4d" },
    wallKind: "brick",
    wall: { base: "#1d1712", face: "#4b3d31", light: "#b39d82" },
    canopy: ["#000", "#000", "#000", "#000"],
    water: "#3f6f95",
    waterDeep: "#1b3f5f",
    rubble: "#8a7a64",
  },
  field: {
    material: "meadow",
    floor: { base: "#6f9046", dark: "#4b6b2c", light: "#96b661", accent: "#82a44f" },
    wallKind: "rock",
    wall: { base: "#1c1d16", face: "#4b4b41", light: "#b3b09d" },
    canopy: ["#000", "#000", "#000", "#000"],
    water: "#3d87b3",
    waterDeep: "#1c5583",
    rubble: "#a58f4d",
  },
};

const THEME_SEED: Record<MapTheme, number> = { cave: 11, forest: 23, swamp: 37, riverside: 41, interior: 53, field: 67 };

// The torch-lit style is the same place at night: every colour drops and
// the ambient darkness (below) does the rest.
function grade(look: Look, amt: number): Look {
  const g = (hex: string) => (hex.startsWith("#") && hex.length === 7 ? shade(hex, amt) : hex);
  return {
    ...look,
    floor: { base: g(look.floor.base), dark: g(look.floor.dark), light: g(look.floor.light), accent: g(look.floor.accent) },
    wall: { base: g(look.wall.base), face: g(look.wall.face), light: look.wall.light },
    canopy: look.canopy.map(g) as Look["canopy"],
    water: g(look.water),
    waterDeep: g(look.waterDeep),
  };
}

function stoneLayers(c: Ctx, theme: MapTheme, torch: boolean, calm: boolean): PaintedLayers {
  const { uid, width: w, height: h } = c;
  const base = LOOKS[theme] ?? LOOKS.field;
  const look = torch ? grade(base, -30) : base;
  const seed = THEME_SEED[theme] ?? 7;

  const exploredD = path(c, c.ex);
  const openD = path(c, c.open);
  const wallD = path(c, c.wall);
  const waterD = path(c, c.water);
  const roughD = path(c, c.rough);

  const natural = look.material !== "slab";
  const blot = natural ? blotches(c, seed * 131, [0.9, 2.2]) : { dark: "", light: "" };
  const toneDark = natural ? "" : path(c, (x, y) => c.open(x, y) && hashNoise(x, y, 4) > 0.72);
  const toneLight = natural ? "" : path(c, (x, y) => c.open(x, y) && hashNoise(x, y, 5) < 0.2);

  // Rubble on rough ground; canopies on tree walls.
  let stoneShadow = "";
  let stoneBody = "";
  let stoneLit = "";
  const canopy = ["", "", "", ""];
  let treeShadow = "";
  let treeOutline = "";
  let doors: ReactNode[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = x * TILE;
      const py = y * TILE;
      if (c.rough(x, y)) {
        for (let k = 0; k < 7; k += 1) {
          const gx = px + 4 + hashNoise(x, y, 10 + k) * (TILE - 8);
          const gy = py + 4 + hashNoise(x, y, 20 + k) * (TILE - 8);
          const r = 1.3 + hashNoise(x, y, 30 + k) * 2.4;
          stoneShadow += circlePath(gx + 0.7, gy + 1, r);
          stoneBody += circlePath(gx, gy, r);
          stoneLit += circlePath(gx - r * 0.25, gy - r * 0.3, r * 0.5);
        }
      } else if (c.wall(x, y) && look.wallKind === "trees") {
        const jx = (hashNoise(x, y, 1) - 0.5) * 5;
        const jy = (hashNoise(x, y, 2) - 0.5) * 5;
        const cx = px + TILE / 2 + jx;
        const cy = py + TILE / 2 + jy;
        const big = 14 + hashNoise(x, y, 6) * 4.5;
        treeShadow += ellipsePath(cx + 3, cy + 6, big * 0.95, big * 0.75);
        treeOutline += circlePath(cx, cy, big + 0.8);
        canopy[0] += circlePath(cx, cy, big);
        canopy[1] += circlePath(cx - 4.5, cy + 2.5, big * 0.7);
        canopy[2] += circlePath(cx + 5, cy - 1, big * 0.56);
        canopy[3] += circlePath(cx - 2, cy - 6, big * 0.34);
      } else if (c.door(x, y)) {
        const across = c.wall(x - 1, y) && c.wall(x + 1, y);
        const [rx, ry, rw, rh] = across ? [px + 1, py + 11, TILE - 2, 10] : [px + 11, py + 1, 10, TILE - 2];
        doors = doors.concat(
          <g key={`d-${x}-${y}`} pointerEvents="none">
            <rect x={rx + 1} y={ry + 2} width={rw} height={rh} rx={2} fill="#000" opacity={0.4} />
            <rect x={rx} y={ry} width={rw} height={rh} rx={2} fill="#8a5a2b" stroke="#2a1a0c" strokeWidth={1.4} />
            <path
              d={across ? `M${rx + 3} ${ry + 3.5}h${rw - 6}M${rx + 3} ${ry + 6.5}h${rw - 6}` : `M${rx + 3.5} ${ry + 3}v${rh - 6}M${rx + 6.5} ${ry + 3}v${rh - 6}`}
              stroke="#000"
              strokeOpacity={0.3}
              fill="none"
            />
            <circle cx={across ? rx + rw * 0.72 : rx + rw / 2} cy={across ? ry + rh / 2 : ry + rh * 0.72} r={1.7} fill="#f0c66a" stroke="#2a1a0c" strokeWidth={0.6} />
          </g>,
        );
      }
    }
  }

  const rimOf = (sides: Array<"n" | "e" | "s" | "w">) => edgesPath(w, h, TILE, c.wall, c.open, sides);
  const wallFace = look.wallKind === "brick" ? `${uid}-brick` : look.wallKind === "rock" ? `${uid}-rockwall` : `${uid}-litter`;

  const defs = (
    <>
      {floorPattern(look.material, { id: `${uid}-floor`, colors: look.floor, seed })}
      {look.wallKind === "brick"
        ? brickWallPattern({ id: `${uid}-brick`, colors: look.wall, seed: seed + 1 })
        : look.wallKind === "rock"
          ? rockWallPattern({ id: `${uid}-rockwall`, colors: look.wall, seed: seed + 1 })
          : litterPattern({ id: `${uid}-litter`, colors: look.wall, seed: seed + 1 })}
      {ripplePattern(`${uid}-ripple`, "#eaf7ff")}
      <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={shade(look.water, 14)} />
        <stop offset="100%" stopColor={shade(look.water, -14)} />
      </linearGradient>
      {blurDefs(c, { b2: 2, b3: 3, b6: 6, b9: 9 })}
      <clipPath id={`${uid}-open`}>
        <path d={openD} />
      </clipPath>
      {lightDefs(c)}
      {tokenDefs(uid, torch ? "torchlit" : "flagstone")}
    </>
  );

  const darkness = torch ? (c.view.ambient === "dark" ? 0.6 : c.view.ambient === "dim" ? 0.36 : 0.12) * (c.view.fullVision ? 0.6 : 1) : 0;

  const cells = (
    <g pointerEvents="none">
      <path d={exploredD} fill={`url(#${uid}-floor)`} />
      {blot.dark ? <path d={blot.dark} fill="#000" opacity={0.16} filter={`url(#${uid}-b9)`} /> : null}
      {blot.light ? <path d={blot.light} fill="#fff" opacity={0.08} filter={`url(#${uid}-b9)`} /> : null}
      {toneDark ? <path d={toneDark} fill="#000" opacity={0.12} /> : null}
      {toneLight ? <path d={toneLight} fill="#fff" opacity={0.055} /> : null}

      {roughD ? (
        <>
          <path d={roughD} fill={look.rubble} opacity={0.2} />
          <path d={stoneShadow} fill="#000" opacity={0.4} />
          <path d={stoneBody} fill={look.rubble} />
          <path d={stoneLit} fill="#fff" opacity={0.3} />
        </>
      ) : null}

      {waterD ? (
        <>
          <path d={waterD} fill={`url(#${uid}-water)`} />
          <path d={path(c, c.water, TILE * 0.45)} fill={look.waterDeep} opacity={0.75} filter={`url(#${uid}-b6)`} />
          <path d={waterD} fill={`url(#${uid}-ripple)`} />
          <path
            d={edgesPath(w, h, TILE, c.water, (x, y) => c.ex(x, y) && !c.water(x, y))}
            fill="none"
            stroke="#eaf7ff"
            strokeOpacity={0.2}
            strokeWidth={5}
            strokeLinecap="round"
          />
          <path
            d={edgesPath(w, h, TILE, c.water, (x, y) => c.ex(x, y) && !c.water(x, y))}
            fill="none"
            stroke="#eaf7ff"
            strokeOpacity={0.6}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </>
      ) : null}

      {openD ? (
        <path
          d={gridPath(w, h, TILE)}
          fill="none"
          stroke="#000"
          strokeOpacity={natural ? 0.16 : 0.1}
          strokeWidth={1}
          clipPath={`url(#${uid}-open)`}
        />
      ) : null}

      {wallD ? (
        <>
          <path d={wallD} fill="#000" opacity={0.5} transform="translate(2 3.5)" filter={`url(#${uid}-b3)`} />
          <path d={wallD} fill="#000" opacity={0.32} filter={`url(#${uid}-b6)`} />
          <path d={wallD} fill={`url(#${wallFace})`} />
          {look.wallKind === "brick" ? (
            <path d={path(c, c.wall, 1.5)} fill="#fff" fillOpacity={0.045} stroke="#000" strokeOpacity={0.3} strokeWidth={1} />
          ) : null}
          {look.wallKind === "trees" ? (
            <>
              <path d={treeShadow} fill="#000" opacity={0.42} filter={`url(#${uid}-b3)`} />
              <path d={treeOutline} fill="#050b04" opacity={0.7} />
              <path d={canopy[0]} fill={look.canopy[0]} />
              <path d={canopy[1]} fill={look.canopy[1]} />
              <path d={canopy[2]} fill={look.canopy[2]} />
              <path d={canopy[3]} fill={look.canopy[3]} opacity={0.85} />
            </>
          ) : (
            <>
              <path d={rimOf(["n"])} fill="none" stroke={look.wall.light} strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
              <path d={rimOf(["w"])} fill="none" stroke={look.wall.light} strokeOpacity={0.3} strokeWidth={2} strokeLinecap="round" />
              <path d={rimOf(["s"])} fill="none" stroke="#000" strokeOpacity={0.65} strokeWidth={3} strokeLinecap="round" />
              <path d={rimOf(["e"])} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />
            </>
          )}
        </>
      ) : null}

      {doors}
      {torch && darkness > 0 ? (
        <>
          <mask id={`${uid}-dark`} maskUnits="userSpaceOnUse" x={0} y={0} width={c.W} height={c.H}>
            <rect width={c.W} height={c.H} fill="#fff" />
            {c.view.lights.map((light, i) => (
              <circle
                key={`m-${i}`}
                cx={light.x * TILE + TILE / 2}
                cy={light.y * TILE + TILE / 2}
                r={Math.max(2, light.radius) * TILE * 2.3}
                fill={`url(#${uid}-cut)`}
              />
            ))}
          </mask>
          <rect width={c.W} height={c.H} fill="#080d22" opacity={darkness} mask={`url(#${uid}-dark)`} />
        </>
      ) : null}
      {lightsLayer(c, "torch", calm)}
      {fogLayer(c, { fog: "#040406", halo: "#000", haloOpacity: 0.65, dim: "#06081a", dimOpacity: torch ? 0.42 : 0.5 })}
      <g pointerEvents="auto">{reachLayer(c, { fill: "#f59e0b", fillOpacity: 0.2, stroke: "#fcd34d" })}</g>
    </g>
  );
  return { defs, cells };
}

// ---------------------------------------------------------------------------
// Parchment: a surveyor's map drawn in ink on old paper.

const WASH: Record<MapTheme, string> = {
  cave: "#b7ad9b",
  forest: "#adbb7c",
  swamp: "#a3b07e",
  riverside: "#d9c99b",
  interior: "#e2d0a8",
  field: "#bfcb84",
};

// Edges as short hand-drawn strokes: every point moves by a fixed function
// of where it is, so two strokes meeting at a corner still meet.
function inkEdges(c: Ctx, salt: number): string {
  const amp = 1.3;
  const step = TILE / 4;
  const jit = (px: number, py: number): [number, number] => [
    px + (hashNoise(px, py, salt) - 0.5) * 2 * amp,
    py + (hashNoise(px, py, salt + 1) - 0.5) * 2 * amp,
  ];
  const segments = edgesPath(c.width, c.height, TILE, c.wall, c.open);
  // edgesPath emits runs as "M x y h len" or "M x y v len"; redraw each run
  // as a wobbling polyline.
  const out: string[] = [];
  const re = /M(-?[\d.]+) (-?[\d.]+)([hv])(-?[\d.]+)/g;
  for (const m of segments.matchAll(re)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const len = Number(m[4]);
    const pts: string[] = [];
    for (let s = 0; s <= len; s += step) {
      const [jx, jy] = m[3] === "h" ? jit(x + s, y) : jit(x, y + s);
      pts.push(`${pts.length ? "L" : "M"}${jx.toFixed(1)} ${jy.toFixed(1)}`);
    }
    out.push(pts.join(""));
  }
  return out.join("");
}

function parchmentLayers(c: Ctx, theme: MapTheme, calm: boolean): PaintedLayers {
  const { uid, width: w, height: h } = c;
  const seed = THEME_SEED[theme] ?? 7;
  const exploredD = path(c, c.ex);
  const openD = path(c, c.open);
  const wallD = path(c, c.wall);
  const waterD = path(c, c.water);
  const roughD = path(c, c.rough);
  const blot = blotches(c, seed * 17, [1, 2.6]);
  const trees = LOOKS[theme]?.wallKind === "trees";

  let leafFill = "";
  let leafInk = "";
  let leafLit = "";
  let doors: ReactNode[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = x * TILE;
      const py = y * TILE;
      if (trees && c.wall(x, y)) {
        const cx = px + TILE / 2 + (hashNoise(x, y, 1) - 0.5) * 4;
        const cy = py + TILE / 2 + (hashNoise(x, y, 2) - 0.5) * 4;
        const big = 14 + hashNoise(x, y, 6) * 3.5;
        leafInk += circlePath(cx, cy, big + 1.4) + circlePath(cx - 5, cy + 3, big * 0.72 + 1.4);
        leafFill += circlePath(cx, cy, big) + circlePath(cx - 5, cy + 3, big * 0.72);
        leafLit += circlePath(cx - 3, cy - 4, big * 0.4);
      } else if (c.door(x, y)) {
        const across = c.wall(x - 1, y) && c.wall(x + 1, y);
        const [rx, ry, rw, rh] = across ? [px + 1, py + 11, TILE - 2, 10] : [px + 11, py + 1, 10, TILE - 2];
        doors = doors.concat(
          <rect key={`d-${x}-${y}`} x={rx} y={ry} width={rw} height={rh} rx={1.5} fill="#b77a3e" stroke="#2a1b0d" strokeWidth={1.6} pointerEvents="none" />,
        );
      }
    }
  }

  // Fine paper grain: a small tile of specks, repeated.
  const rnd = seeded(seed * 3);
  let specks = "";
  for (let i = 0; i < 70; i += 1) {
    specks += circlePath(rnd() * 64, rnd() * 64, 0.4 + rnd() * 0.7);
  }

  const defs = (
    <>
      <pattern id={`${uid}-grain`} width={64} height={64} patternUnits="userSpaceOnUse">
        <path d={specks} fill="#5a3d1c" opacity={0.16} />
      </pattern>
      <pattern id={`${uid}-hatch`} width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0V9" stroke="#2a1d10" strokeOpacity={0.55} strokeWidth={1.2} />
      </pattern>
      <pattern id={`${uid}-stipple`} width={16} height={16} patternUnits="userSpaceOnUse">
        <path d="M3 3.5h.1M11 2h.1M7 8h.1M14 10h.1M2 13h.1M9 14h.1" stroke="#4a3418" strokeWidth={1.8} strokeLinecap="round" />
        <path d="M5 11l1.5-2.5L8 11" fill="none" stroke="#4a3418" strokeOpacity={0.7} strokeWidth={0.9} />
      </pattern>
      {ripplePattern(`${uid}-ripple`, "#264f63")}
      {blurDefs(c, { b2: 2, b3: 3, b6: 6, b9: 9 })}
      <clipPath id={`${uid}-open`}>
        <path d={openD} />
      </clipPath>
      {lightDefs(c)}
      {tokenDefs(uid, "parchment")}
    </>
  );

  const cells = (
    <g pointerEvents="none">
      <path d={exploredD} fill="#ecdfbd" />
      <path d={blot.dark} fill="#7a5626" opacity={0.1} filter={`url(#${uid}-b9)`} />
      <path d={blot.light} fill="#fff8e0" opacity={0.28} filter={`url(#${uid}-b9)`} />
      <path d={openD} fill={WASH[theme] ?? WASH.field} opacity={0.32} />
      <path d={exploredD} fill={`url(#${uid}-grain)`} />
      {roughD ? <path d={roughD} fill={`url(#${uid}-stipple)`} /> : null}
      {waterD ? (
        <>
          <path d={waterD} fill="#8fbac6" opacity={0.92} />
          <path d={waterD} fill={`url(#${uid}-ripple)`} />
          <path
            d={inkEdges({ ...c, wall: c.water, open: (x, y) => c.ex(x, y) && !c.water(x, y) }, 5)}
            fill="none"
            stroke="#274f61"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {openD ? (
        <path d={gridPath(w, h, TILE)} fill="none" stroke="#6b4a22" strokeOpacity={0.28} strokeWidth={1} clipPath={`url(#${uid}-open)`} />
      ) : null}
      {wallD ? (
        <>
          <path d={wallD} fill="#3a2812" opacity={0.28} transform="translate(2.5 3)" filter={`url(#${uid}-b2)`} />
          {trees ? (
            <>
              <path d={wallD} fill="#c9b98f" />
              <path d={leafInk} fill="#26301a" />
              <path d={leafFill} fill="#8ea25c" />
              <path d={leafLit} fill="#c3d18a" opacity={0.7} />
            </>
          ) : (
            <>
              <path d={wallD} fill="#d3c39a" />
              <path d={wallD} fill={`url(#${uid}-hatch)`} />
              <path d={inkEdges(c, 3)} fill="none" stroke="#241a0f" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </>
      ) : null}
      {doors}
      {lightsLayer(c, "ink", calm)}
      {fogLayer(c, { fog: "#1c150e", halo: "#4a3416", haloOpacity: 0.6, dim: "#5b4020", dimOpacity: 0.4 })}
      <g pointerEvents="auto">{reachLayer(c, { fill: "#3730a3", fillOpacity: 0.18, stroke: "#4338ca" })}</g>
    </g>
  );
  return { defs, cells };
}

// ---------------------------------------------------------------------------
// Blueprint: flat, high-contrast, no textures, the cheapest to draw.

function blueprintLayers(c: Ctx, calm: boolean): PaintedLayers {
  const { uid, width: w, height: h } = c;
  const exploredD = path(c, c.ex);
  const openD = path(c, c.open);
  const wallD = path(c, c.wall);
  const waterD = path(c, c.water);
  const roughD = path(c, c.rough);
  // A door is a bar across the gap it closes.
  let doors = "";
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (c.door(x, y)) {
        const across = c.wall(x - 1, y) && c.wall(x + 1, y);
        doors += across
          ? `M${x * TILE + 2} ${y * TILE + 16}h${TILE - 4}`
          : `M${x * TILE + 16} ${y * TILE + 2}v${TILE - 4}`;
      }
    }
  }
  const defs = (
    <>
      <pattern id={`${uid}-hatch`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M0 0V8" stroke="#3da5df" strokeOpacity={0.5} strokeWidth={1.4} />
      </pattern>
      <pattern id={`${uid}-dots`} width={8} height={8} patternUnits="userSpaceOnUse">
        <circle cx={2} cy={2} r={1.2} fill="#f59e0b" />
        <circle cx={6} cy={6} r={1.2} fill="#f59e0b" />
      </pattern>
      {ripplePattern(`${uid}-ripple`, "#8fdcff")}
      {blurDefs(c, { b2: 2, b6: 6 })}
      <clipPath id={`${uid}-open`}>
        <path d={openD} />
      </clipPath>
      {lightDefs(c)}
      {tokenDefs(uid, "blueprint")}
    </>
  );
  const cells = (
    <g pointerEvents="none">
      <path d={exploredD} fill="#0d2740" />
      <path d={openD} fill="#143a5c" />
      {openD ? (
        <>
          <path d={gridPath(w, h, TILE)} fill="none" stroke="#7dc8ff" strokeOpacity={0.16} strokeWidth={1} clipPath={`url(#${uid}-open)`} />
          <path d={gridPath(w, h, TILE, 5)} fill="none" stroke="#7dc8ff" strokeOpacity={0.3} strokeWidth={1.2} clipPath={`url(#${uid}-open)`} />
        </>
      ) : null}
      {roughD ? (
        <>
          <path d={roughD} fill="#f59e0b" opacity={0.16} />
          <path d={roughD} fill={`url(#${uid}-dots)`} opacity={0.65} />
        </>
      ) : null}
      {waterD ? (
        <>
          <path d={waterD} fill="#0f5f8c" />
          <path d={waterD} fill={`url(#${uid}-ripple)`} />
          <path
            d={edgesPath(w, h, TILE, c.water, (x, y) => c.ex(x, y) && !c.water(x, y))}
            fill="none"
            stroke="#8fdcff"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </>
      ) : null}
      {wallD ? (
        <>
          <path d={wallD} fill="#08182a" />
          <path d={wallD} fill={`url(#${uid}-hatch)`} />
          <path d={edgesPath(w, h, TILE, c.wall, c.open)} fill="none" stroke="#7dd3fc" strokeWidth={2.2} strokeLinecap="round" />
        </>
      ) : null}
      {doors ? <path d={doors} fill="none" stroke="#fbbf24" strokeWidth={5} strokeLinecap="round" /> : null}
      {lightsLayer(c, "marker", calm)}
      {fogLayer(c, { fog: "#050b13", halo: "#02060c", haloOpacity: 0.6, dim: "#031019", dimOpacity: 0.5 })}
      <g pointerEvents="auto">{reachLayer(c, { fill: "#22d3ee", fillOpacity: 0.16, stroke: "#67e8f9" })}</g>
    </g>
  );
  return { defs, cells };
}

// ---------------------------------------------------------------------------
// A map with a picture under it: the art is the floor. The terrain layer is
// the classic translucent tint (see artTile in battleMapCells.tsx); the style
// only supplies the grid, the fog, the lights and the tokens.

function artLayers(c: Ctx, palette: Palette, style: PaintedStyle, calm: boolean): PaintedLayers {
  const { uid, width: w, height: h } = c;
  const openD = path(c, c.open);
  const tiles: ReactNode[] = [];
  for (let idx = 0; idx < w * h; idx += 1) {
    const x = idx % w;
    const y = Math.floor(idx / w);
    if (!c.ex(x, y)) {
      continue;
    }
    const tile = artTile(idx, x * TILE, y * TILE, c.ch(x, y), palette);
    if (tile) {
      tiles.push(tile);
    }
  }
  const fog =
    style === "parchment"
      ? { fog: "#1c150e", halo: "#4a3416", haloOpacity: 0.6, dim: "#5b4020", dimOpacity: 0.4 }
      : style === "blueprint"
        ? { fog: "#050b13", halo: "#02060c", haloOpacity: 0.6, dim: "#031019", dimOpacity: 0.5 }
        : { fog: "#040406", halo: "#000", haloOpacity: 0.65, dim: "#06081a", dimOpacity: 0.5 };
  const reach =
    style === "parchment"
      ? { fill: "#3730a3", fillOpacity: 0.2, stroke: "#4338ca" }
      : style === "blueprint"
        ? { fill: "#22d3ee", fillOpacity: 0.18, stroke: "#67e8f9" }
        : { fill: "#f59e0b", fillOpacity: 0.2, stroke: "#fcd34d" };
  const defs = (
    <>
      {blurDefs(c, { b2: 2, b6: 6 })}
      <clipPath id={`${uid}-open`}>
        <path d={openD} />
      </clipPath>
      {lightDefs(c)}
      {tokenDefs(uid, style)}
    </>
  );
  const cells = (
    <g>
      <g pointerEvents="none">
        {tiles}
        {openD ? (
          <path d={gridPath(w, h, TILE)} fill="none" stroke={style === "blueprint" ? "#7dc8ff" : "#000"} strokeOpacity={style === "blueprint" ? 0.22 : 0.2} strokeWidth={1} clipPath={`url(#${uid}-open)`} />
        ) : null}
        {lightsLayer(c, style === "parchment" ? "ink" : style === "blueprint" ? "marker" : "torch", calm)}
        {fogLayer(c, fog)}
      </g>
      {reachLayer(c, reach)}
    </g>
  );
  return { defs, cells };
}

export function buildPaintedCells(
  view: PlayerMapView,
  palette: Palette,
  style: PaintedStyle,
  uid: string,
  calm: boolean,
): PaintedLayers {
  const c = makeContext(view, uid);
  if (view.backdrop) {
    return artLayers(c, palette, style, calm);
  }
  switch (style) {
    case "flagstone":
      return stoneLayers(c, view.theme, false, calm);
    case "torchlit":
      return stoneLayers(c, view.theme, true, calm);
    case "parchment":
      return parchmentLayers(c, view.theme, calm);
    case "blueprint":
      return blueprintLayers(c, calm);
  }
}
