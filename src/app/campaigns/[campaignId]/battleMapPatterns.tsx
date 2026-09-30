import type { ReactNode } from "react";
import { seeded, shade } from "@/lib/battlemap/map-geometry";

// The repeating textures of the painted battle-map styles. Each is an SVG
// <pattern> three tiles square, so a mortar line or a stone edge always lands
// on a tile line, drawn once and tiled by the browser: a texture costs one
// node however large the map is, and never a filter.
//
// Everything is seeded, so a floor looks the same on every render and on
// every device, and shapes that cross the pattern's edge are drawn again on
// the far side so the repeat has no visible seam.

export const PATTERN = 96;

type Offsets = Array<[number, number]>;

// Where a shape of radius `r` at (x, y) must also be drawn so it wraps.
function offsets(x: number, y: number, r: number): Offsets {
  const xs = [0];
  const ys = [0];
  if (x - r < 0) xs.push(PATTERN);
  if (x + r > PATTERN) xs.push(-PATTERN);
  if (y - r < 0) ys.push(PATTERN);
  if (y + r > PATTERN) ys.push(-PATTERN);
  return xs.flatMap((ox) => ys.map((oy) => [ox, oy] as [number, number]));
}

const f = (n: number) => Math.round(n * 10) / 10;

export type Material = "slab" | "rock" | "grass" | "meadow" | "moss" | "pebble";

export type FloorColors = { base: string; dark: string; light: string; accent: string };

type PatternProps = { id: string; colors: FloorColors; seed: number };

function Tile({ id, size = PATTERN, children }: { id: string; size?: number; children: ReactNode }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
      {children}
    </pattern>
  );
}

// Dressed flagstones, three tiles square, some split in two.
function slab({ id, colors, seed }: PatternProps) {
  const rnd = seeded(seed);
  const t = PATTERN / 3;
  const slabs: ReactNode[] = [];
  let mortar = "";
  let lit = "";
  let dim = "";
  let chips = "";
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 3; gx += 1) {
      const x = gx * t;
      const y = gy * t;
      const split = rnd() < 0.4 ? (rnd() < 0.5 ? "v" : "h") : null;
      const parts: Array<[number, number, number, number]> = split === "v"
        ? [[x, y, t / 2, t], [x + t / 2, y, t / 2, t]]
        : split === "h"
          ? [[x, y, t, t / 2], [x, y + t / 2, t, t / 2]]
          : [[x, y, t, t]];
      for (const [px, py, pw, ph] of parts) {
        const tone = (rnd() - 0.5) * 26;
        slabs.push(<rect key={`${gx}-${gy}-${px}-${py}`} x={px} y={py} width={pw} height={ph} fill={shade(colors.base, tone)} />);
        mortar += `M${px} ${py}h${pw}v${ph}h${-pw}z`;
        lit += `M${px + 1.5} ${py + ph - 1.5}V${py + 1.5}H${px + pw - 1.5}`;
        dim += `M${px + 1.5} ${py + ph - 1}H${px + pw - 1}V${py + 1.5}`;
      }
      if (rnd() < 0.55) {
        const cx = x + 5 + rnd() * (t - 10);
        const cy = y + 5 + rnd() * (t - 10);
        chips += `M${f(cx)} ${f(cy)}l${f(3 + rnd() * 6)} ${f(2 + rnd() * 5)}l${f(-2 - rnd() * 3)} ${f(3 + rnd() * 4)}`;
      }
    }
  }
  return (
    <Tile id={id} key={id}>
      {slabs}
      <path d={lit} fill="none" stroke="#fff" strokeOpacity={0.1} strokeWidth={1} />
      <path d={dim} fill="none" stroke="#000" strokeOpacity={0.16} strokeWidth={1.4} />
      <path d={chips} fill="none" stroke="#000" strokeOpacity={0.3} strokeWidth={0.9} strokeLinecap="round" />
      <path d={mortar} fill="none" stroke="#000" strokeOpacity={0.55} strokeWidth={1.8} strokeLinejoin="round" />
    </Tile>
  );
}

// Rough cave floor: a jumble of flat rock plates and cracks.
function rock({ id, colors, seed }: PatternProps) {
  const rnd = seeded(seed);
  const plates: ReactNode[] = [];
  let cracks = "";
  for (let i = 0; i < 26; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const r = 8 + rnd() * 9;
    const n = 6 + Math.floor(rnd() * 3);
    const tone = (rnd() - 0.5) * 30;
    for (const [ox, oy] of offsets(x, y, r + 2)) {
      let d = "";
      for (let k = 0; k < n; k += 1) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.5;
        const rr = r * (0.7 + rnd() * 0.4);
        d += `${k ? "L" : "M"}${f(x + ox + Math.cos(a) * rr)} ${f(y + oy + Math.sin(a) * rr)}`;
      }
      plates.push(
        <path
          key={`${i}-${ox}-${oy}`}
          d={`${d}z`}
          fill={shade(colors.base, tone)}
          fillOpacity={0.75}
          stroke="#000"
          strokeOpacity={0.32}
          strokeWidth={1}
          strokeLinejoin="round"
        />,
      );
    }
  }
  for (let i = 0; i < 6; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    let d = `M${f(x)} ${f(y)}`;
    let cx = x;
    let cy = y;
    for (let k = 0; k < 4; k += 1) {
      cx += (rnd() - 0.4) * 9;
      cy += (rnd() - 0.4) * 9;
      d += `L${f(cx)} ${f(cy)}`;
    }
    cracks += d;
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.dark} />
      {plates}
      <path d={cracks} fill="none" stroke="#000" strokeOpacity={0.4} strokeWidth={0.9} strokeLinecap="round" />
    </Tile>
  );
}

// Grass, meadow and moss share a scatter of blades over soft patches; they
// differ in colour and in what grows among them.
function turf(kind: "grass" | "meadow" | "moss", { id, colors, seed }: PatternProps) {
  const rnd = seeded(seed);
  const patches: ReactNode[] = [];
  for (let i = 0; i < 9; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const r = 10 + rnd() * 16;
    const dark = rnd() < 0.55;
    for (const [ox, oy] of offsets(x, y, r)) {
      patches.push(<circle key={`${i}-${ox}-${oy}`} cx={f(x + ox)} cy={f(y + oy)} r={f(r)} fill={dark ? colors.dark : colors.light} opacity={dark ? 0.32 : 0.2} />);
    }
  }
  const blades = { dark: "", mid: "", light: "" };
  const count = kind === "moss" ? 110 : 170;
  for (let i = 0; i < count; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const len = 4 + rnd() * 6;
    const lean = (rnd() - 0.5) * 5;
    const tone = rnd();
    const key = tone < 0.4 ? "dark" : tone < 0.8 ? "mid" : "light";
    for (const [ox, oy] of offsets(x, y, 10)) {
      blades[key] += `M${f(x + ox)} ${f(y + oy)}q${f(lean * 0.2)} ${f(-len * 0.6)} ${f(lean)} ${f(-len)}`;
    }
  }
  const flowers: ReactNode[] = [];
  if (kind === "meadow") {
    const petals = ["#fff7d6", "#fde68a", "#fbcfe8", "#ddd6fe"];
    for (let i = 0; i < 14; i += 1) {
      const x = rnd() * PATTERN;
      const y = rnd() * PATTERN;
      for (const [ox, oy] of offsets(x, y, 3)) {
        flowers.push(<circle key={`${i}-${ox}-${oy}`} cx={f(x + ox)} cy={f(y + oy)} r={1.3} fill={petals[i % petals.length]} opacity={0.85} />);
      }
    }
  }
  if (kind === "moss") {
    // Wet, dark pockets among the moss.
    for (let i = 0; i < 5; i += 1) {
      const x = rnd() * PATTERN;
      const y = rnd() * PATTERN;
      for (const [ox, oy] of offsets(x, y, 12)) {
        flowers.push(<ellipse key={`w${i}-${ox}-${oy}`} cx={f(x + ox)} cy={f(y + oy)} rx={f(6 + rnd() * 6)} ry={f(3 + rnd() * 3)} fill="#0b1a12" opacity={0.28} />);
      }
    }
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.base} />
      {patches}
      <path d={blades.dark} fill="none" stroke={colors.dark} strokeWidth={1.1} strokeLinecap="round" />
      <path d={blades.mid} fill="none" stroke={colors.accent} strokeWidth={1} strokeLinecap="round" />
      <path d={blades.light} fill="none" stroke={colors.light} strokeWidth={1} strokeLinecap="round" />
      {flowers}
    </Tile>
  );
}

// Shingle and gravel for a river bank.
function pebble({ id, colors, seed }: PatternProps) {
  const rnd = seeded(seed);
  const stones: ReactNode[] = [];
  for (let i = 0; i < 70; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const rx = 2 + rnd() * 4.5;
    const ry = rx * (0.55 + rnd() * 0.3);
    const rot = f(rnd() * 180);
    const tone = (rnd() - 0.5) * 44;
    for (const [ox, oy] of offsets(x, y, rx + 1)) {
      stones.push(
        <g key={`${i}-${ox}-${oy}`} transform={`translate(${f(x + ox)} ${f(y + oy)}) rotate(${rot})`}>
          <ellipse cx={0.6} cy={0.9} rx={rx} ry={ry} fill="#000" opacity={0.28} />
          <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={shade(colors.base, tone)} />
          <ellipse cx={-rx * 0.25} cy={-ry * 0.3} rx={rx * 0.5} ry={ry * 0.35} fill="#fff" opacity={0.16} />
        </g>,
      );
    }
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.dark} />
      {stones}
    </Tile>
  );
}

export function floorPattern(material: Material, props: PatternProps): ReactNode {
  switch (material) {
    case "slab":
      return slab(props);
    case "rock":
      return rock(props);
    case "pebble":
      return pebble(props);
    default:
      return turf(material, props);
  }
}

export type WallColors = { base: string; face: string; light: string };

// Cut stone in courses of brick, for built walls.
export function brickWallPattern({ id, colors, seed }: { id: string; colors: WallColors; seed: number }) {
  const rnd = seeded(seed);
  const bricks: ReactNode[] = [];
  let mortar = "";
  const rowH = 8;
  for (let row = 0; row < PATTERN / rowH; row += 1) {
    let x = -(rnd() * 12);
    while (x < PATTERN) {
      const w = 14 + rnd() * 12;
      const x0 = Math.max(0, x);
      const x1 = Math.min(PATTERN, x + w);
      if (x1 > x0) {
        bricks.push(<rect key={`${row}-${f(x)}`} x={f(x0)} y={row * rowH} width={f(x1 - x0)} height={rowH} fill={shade(colors.face, (rnd() - 0.5) * 22)} />);
        mortar += `M${f(x1)} ${row * rowH}v${rowH}`;
      }
      x += w;
    }
    mortar += `M0 ${row * rowH}h${PATTERN}`;
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.base} />
      {bricks}
      <path d={mortar} fill="none" stroke={colors.base} strokeOpacity={0.85} strokeWidth={1.2} />
    </Tile>
  );
}

// Cliff and boulder: big lit facets over shadow.
export function rockWallPattern({ id, colors, seed }: { id: string; colors: WallColors; seed: number }) {
  const rnd = seeded(seed);
  const facets: ReactNode[] = [];
  for (let i = 0; i < 20; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const r = 9 + rnd() * 12;
    const n = 5 + Math.floor(rnd() * 3);
    const tone = (rnd() - 0.35) * 30;
    for (const [ox, oy] of offsets(x, y, r + 2)) {
      let d = "";
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < n; k += 1) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.5;
        const rr = r * (0.65 + rnd() * 0.45);
        pts.push([x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr]);
      }
      d = pts.map(([px, py], k) => `${k ? "L" : "M"}${f(px)} ${f(py)}`).join("");
      // The upper-left run of each facet catches the light.
      const lit = pts.slice(0, Math.ceil(n / 2) + 1).map(([px, py], k) => `${k ? "L" : "M"}${f(px)} ${f(py)}`).join("");
      facets.push(
        <g key={`${i}-${ox}-${oy}`}>
          <path d={`${d}z`} fill={shade(colors.face, tone)} stroke="#000" strokeOpacity={0.5} strokeWidth={1.2} strokeLinejoin="round" />
          <path d={lit} fill="none" stroke={colors.light} strokeOpacity={0.3} strokeWidth={1.1} strokeLinecap="round" />
        </g>,
      );
    }
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.base} />
      {facets}
    </Tile>
  );
}

// Leaf litter under a tree line. Mostly hidden by the canopies.
export function litterPattern({ id, colors, seed }: { id: string; colors: WallColors; seed: number }) {
  const rnd = seeded(seed);
  const spots: ReactNode[] = [];
  for (let i = 0; i < 16; i += 1) {
    const x = rnd() * PATTERN;
    const y = rnd() * PATTERN;
    const r = 4 + rnd() * 9;
    for (const [ox, oy] of offsets(x, y, r)) {
      spots.push(<circle key={`${i}-${ox}-${oy}`} cx={f(x + ox)} cy={f(y + oy)} r={f(r)} fill={rnd() < 0.5 ? colors.face : "#000"} opacity={0.35} />);
    }
  }
  return (
    <Tile id={id} key={id}>
      <rect width={PATTERN} height={PATTERN} fill={colors.base} />
      {spots}
    </Tile>
  );
}

// Water: a body gradient plus a repeating ripple, both defined by the
// caller's colours.
export function ripplePattern(id: string, tint: string) {
  const size = 32;
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" key={id}>
      <path d="M2 9q5-4 10 0t10 0t9 0" fill="none" stroke={tint} strokeOpacity={0.3} strokeWidth={1.3} strokeLinecap="round" />
      <path d="M-4 24q5 4 10 0t10 0t10 0t9 0" fill="none" stroke={tint} strokeOpacity={0.18} strokeWidth={1.3} strokeLinecap="round" />
    </pattern>
  );
}
