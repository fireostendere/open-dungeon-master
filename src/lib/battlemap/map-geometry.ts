// Geometry for painting a battle map, kept free of React and the DOM so the
// node test suites can drive it (scripts/test-battlemap-geometry.mjs).
//
// The painted styles (src/app/campaigns/[campaignId]/battleMapStyles.tsx)
// do not emit an element per tile. They describe whole regions (all the
// floor, all the wall, all the fog) as ONE path each, so a 24x18 map costs a
// few dozen SVG nodes instead of thousands. That is both what lets a
// texture or a blur run once over the whole layer, and what keeps the
// re-render cheap in Firefox, whose per-node cost the play view already
// worked around (BattleMapGrid.tsx).

export type TilePredicate = (x: number, y: number) => boolean;

// Lighten (positive) or darken (negative) a #rrggbb color by a fixed step.
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  // Rounded: a fractional step would print as an invalid colour.
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// A second salted hash for decoration jitter and scatter, so trees, boulders,
// and rubble stay put across re-renders but don't line up with tileNoise.
export function hashNoise(x: number, y: number, salt: number): number {
  const n = Math.sin((x + salt * 57.3) * 269.5 + (y - salt * 19.7) * 183.3) * 43758.5453;
  return n - Math.floor(n);
}

const round = (value: number) => Math.round(value * 100) / 100;

// Every tile the predicate accepts, as horizontal runs of one rectangle
// each. `inset` shrinks each run on all four sides.
export function tilesPath(width: number, height: number, tile: number, test: TilePredicate, inset = 0): string {
  const parts: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!test(x, y)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && test(x, y)) {
        x += 1;
      }
      const w = (x - start) * tile - 2 * inset;
      parts.push(`M${round(start * tile + inset)} ${round(y * tile + inset)}h${round(w)}v${round(tile - 2 * inset)}h${round(-w)}z`);
    }
  }
  return parts.join("");
}

export type Side = "n" | "e" | "s" | "w";

// The sides of solid tiles that face an open neighbour: the line a wall
// draws where it meets the floor. Consecutive edges on one side join into a
// single stroke. `sides` picks which of the four to draw, so a bevel can
// light the north and west faces and shade the south and east.
export function edgesPath(
  width: number,
  height: number,
  tile: number,
  solid: TilePredicate,
  open: TilePredicate,
  sides: Side[] = ["n", "e", "s", "w"],
): string {
  const parts: string[] = [];
  const has = (side: Side) => sides.includes(side);
  const facing = (x: number, y: number, side: Side) => {
    if (!solid(x, y)) {
      return false;
    }
    const nx = side === "e" ? x + 1 : side === "w" ? x - 1 : x;
    const ny = side === "s" ? y + 1 : side === "n" ? y - 1 : y;
    return nx >= 0 && ny >= 0 && nx < width && ny < height && open(nx, ny);
  };
  for (const side of ["n", "s"] as const) {
    if (!has(side)) {
      continue;
    }
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        if (!facing(x, y, side)) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < width && facing(x, y, side)) {
          x += 1;
        }
        parts.push(`M${start * tile} ${(y + (side === "s" ? 1 : 0)) * tile}h${(x - start) * tile}`);
      }
    }
  }
  for (const side of ["w", "e"] as const) {
    if (!has(side)) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      let y = 0;
      while (y < height) {
        if (!facing(x, y, side)) {
          y += 1;
          continue;
        }
        const start = y;
        while (y < height && facing(x, y, side)) {
          y += 1;
        }
        parts.push(`M${(x + (side === "e" ? 1 : 0)) * tile} ${start * tile}v${(y - start) * tile}`);
      }
    }
  }
  return parts.join("");
}

// Grid lines at every `step` tiles across a width x height field.
export function gridPath(width: number, height: number, tile: number, step = 1, offset = 0): string {
  const parts: string[] = [];
  for (let x = offset; x <= width; x += step) {
    parts.push(`M${x * tile} 0V${height * tile}`);
  }
  for (let y = offset; y <= height; y += step) {
    parts.push(`M0 ${y * tile}H${width * tile}`);
  }
  return parts.join("");
}

// A circle as path data, so a hundred of them share one element.
export function circlePath(cx: number, cy: number, r: number): string {
  const c = round(cx);
  const y = round(cy);
  const rr = round(r);
  return `M${round(c - rr)} ${y}a${rr} ${rr} 0 1 0 ${round(rr * 2)} 0a${rr} ${rr} 0 1 0 ${round(-rr * 2)} 0z`;
}

// An ellipse as path data.
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${round(cx - rx)} ${round(cy)}a${round(rx)} ${round(ry)} 0 1 0 ${round(rx * 2)} 0a${round(rx)} ${round(ry)} 0 1 0 ${round(-rx * 2)} 0z`;
}

// A small seeded generator for the textures, so a floor pattern is the same
// on every render and on every device.
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
