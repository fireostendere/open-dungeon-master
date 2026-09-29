// Procedural face textures for the 3D dice.
//
// Each die gets one atlas with a cell per face. Three canvases share the same
// layout: the colour map (resin, bevel light, gilded numerals), an emissive
// mask (numerals only, so they can glow on a crit without lighting the whole
// die) and a bump map (numerals engraved into the face).

import { cross, dot, sub, type DieShape, type Vec3 } from "./geometry";

export type DicePalette = {
  id: string;
  /** Resin gradient: centre → rim. */
  face: [string, string];
  /** Soft clouds suspended in the resin (galaxy / marble look). */
  swirl: string[];
  /** Metallic flecks; empty for none. */
  fleck: string;
  /** Numeral gradient and outline. */
  ink: [string, string];
  inkStroke: string;
  /** Polished edge highlight and the shadow just inside it. */
  edge: string;
  shade: string;
  /** Colour of the glow the numerals emit. */
  glow: string;
  material: {
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    iridescence?: number;
    sheen?: number;
  };
};

export const DICE_PALETTES = {
  arcane: {
    id: "arcane",
    face: ["#2d2160", "#120c2b"],
    swirl: ["rgba(132, 92, 255, 0.34)", "rgba(56, 189, 248, 0.16)", "rgba(236, 72, 153, 0.14)"],
    fleck: "rgba(255, 226, 150, 0.9)",
    ink: ["#fff3c4", "#d6a53b"],
    inkStroke: "rgba(24, 12, 2, 0.85)",
    edge: "rgba(214, 196, 255, 0.55)",
    shade: "rgba(4, 2, 16, 0.55)",
    glow: "#ffcf6b",
    material: { roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.25 },
  },
  crimson: {
    id: "crimson",
    face: ["#9b1c2e", "#3a0610"],
    swirl: ["rgba(255, 120, 80, 0.26)", "rgba(80, 0, 20, 0.4)"],
    fleck: "rgba(255, 210, 160, 0.7)",
    ink: ["#fff0d6", "#f2b25a"],
    inkStroke: "rgba(40, 4, 8, 0.85)",
    edge: "rgba(255, 190, 170, 0.5)",
    shade: "rgba(20, 0, 4, 0.55)",
    glow: "#ff9d5c",
    material: { roughness: 0.25, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.1 },
  },
  frost: {
    id: "frost",
    face: ["#2b6aa8", "#0b2447"],
    swirl: ["rgba(186, 230, 253, 0.34)", "rgba(99, 102, 241, 0.2)"],
    fleck: "rgba(224, 242, 254, 0.9)",
    ink: ["#ffffff", "#bae6fd"],
    inkStroke: "rgba(4, 16, 36, 0.85)",
    edge: "rgba(224, 242, 254, 0.6)",
    shade: "rgba(2, 8, 24, 0.5)",
    glow: "#8fd8ff",
    material: { roughness: 0.18, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.35 },
  },
  verdant: {
    id: "verdant",
    face: ["#1f7a55", "#07291b"],
    swirl: ["rgba(190, 242, 100, 0.22)", "rgba(20, 184, 166, 0.22)"],
    fleck: "rgba(250, 240, 180, 0.8)",
    ink: ["#fdf6d8", "#e0b84a"],
    inkStroke: "rgba(2, 20, 12, 0.85)",
    edge: "rgba(200, 255, 220, 0.45)",
    shade: "rgba(0, 12, 6, 0.55)",
    glow: "#b8f59a",
    material: { roughness: 0.24, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.1 },
  },
  bone: {
    id: "bone",
    face: ["#f3ead6", "#c9b894"],
    swirl: ["rgba(120, 90, 50, 0.12)"],
    fleck: "",
    ink: ["#3b2412", "#1a0e06"],
    inkStroke: "rgba(255, 250, 235, 0.35)",
    edge: "rgba(255, 255, 255, 0.55)",
    shade: "rgba(90, 64, 30, 0.35)",
    glow: "#ff9a3c",
    material: { roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 },
  },
  gilded: {
    id: "gilded",
    face: ["#f6d77c", "#9a6b17"],
    swirl: ["rgba(255, 255, 255, 0.18)", "rgba(120, 70, 0, 0.2)"],
    fleck: "",
    ink: ["#2a1802", "#120a00"],
    inkStroke: "rgba(255, 244, 200, 0.4)",
    edge: "rgba(255, 250, 220, 0.7)",
    shade: "rgba(70, 40, 0, 0.45)",
    glow: "#fff1b8",
    material: { roughness: 0.2, metalness: 0.85, clearcoat: 0.8, clearcoatRoughness: 0.12 },
  },
  cursed: {
    id: "cursed",
    face: ["#3a3440", "#141117"],
    swirl: ["rgba(220, 38, 38, 0.18)", "rgba(0, 0, 0, 0.4)"],
    fleck: "",
    ink: ["#ff6b6b", "#b91c1c"],
    inkStroke: "rgba(0, 0, 0, 0.9)",
    edge: "rgba(255, 140, 140, 0.35)",
    shade: "rgba(0, 0, 0, 0.6)",
    glow: "#ff3b3b",
    material: { roughness: 0.55, metalness: 0.1, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  },
} satisfies Record<string, DicePalette>;

export type DicePaletteId = keyof typeof DICE_PALETTES;

export type DiceAtlas = {
  map: HTMLCanvasElement;
  emissive: HTMLCanvasElement;
  bump: HTMLCanvasElement;
  /** UVs per face, parallel to `face.verts`. */
  uvs: [number, number][][];
};

type Pt = { x: number; y: number };

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Tiny deterministic PRNG so atlases look identical on every client. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FALLBACK_STACK = "'Cinzel', 'Trajan Pro', 'Palatino Linotype', Georgia, serif";
let FONT_STACK = FALLBACK_STACK;

/**
 * next/font renames Cinzel to a hashed family ("__Cinzel_4c4b5d"), so canvas
 * text has to find the real name among the loaded font faces at runtime.
 */
export function displayFontStack(): string {
  if (typeof document === "undefined" || !("fonts" in document)) return FALLBACK_STACK;
  for (const face of document.fonts) {
    if (/cinzel/i.test(face.family) && !/fallback/i.test(face.family)) {
      return `${JSON.stringify(face.family.replace(/^["']|["']$/g, ""))}, ${FALLBACK_STACK}`;
    }
  }
  return FALLBACK_STACK;
}

function polygonPath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** Distance from `c` to the nearest polygon edge. */
function inradius2d(pts: Pt[], c: Pt): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l = Math.hypot(ex, ey) || 1;
    const d = Math.abs((c.x - a.x) * ey - (c.y - a.y) * ex) / l;
    best = Math.min(best, d);
  }
  return best;
}

function drawNumeral(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  angle: number,
  mode: "color" | "emissive" | "bump",
  palette: DicePalette,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `900 ${size}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // 6 and 9 get a bar so they can't be confused upside down.
  const underline = text === "6" || text === "9";
  const w = ctx.measureText(text).width;
  if (mode === "color") {
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, palette.ink[0]);
    g.addColorStop(1, palette.ink[1]);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeStyle = palette.inkStroke;
    ctx.strokeText(text, 0, size * 0.04);
    ctx.fillStyle = g;
    ctx.fillText(text, 0, size * 0.04);
    if (underline) {
      ctx.fillRect(-w * 0.42, size * 0.46, w * 0.84, size * 0.08);
    }
  } else {
    ctx.fillStyle = mode === "emissive" ? "#ffffff" : "#000000";
    if (mode === "emissive") {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = size * 0.12;
    }
    ctx.fillText(text, 0, size * 0.04);
    if (underline) ctx.fillRect(-w * 0.42, size * 0.46, w * 0.84, size * 0.08);
  }
  ctx.restore();
}

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function drawPips(
  ctx: CanvasRenderingContext2D,
  value: number,
  c: Pt,
  half: number,
  mode: "color" | "emissive" | "bump",
  palette: DicePalette,
) {
  const spread = half * 0.52;
  const r = half * (value === 1 ? 0.24 : 0.15);
  for (const [px, py] of PIP_LAYOUT[value] ?? []) {
    const x = c.x + px * spread;
    const y = c.y + py * spread;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (mode === "color") {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, palette.ink[0]);
      g.addColorStop(1, palette.ink[1]);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.18);
      ctx.strokeStyle = palette.inkStroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = mode === "emissive" ? "#ffffff" : "#000000";
      ctx.fill();
    }
  }
}

function drawCracks(ctx: CanvasRenderingContext2D, pts: Pt[], c: Pt, radius: number, rng: () => number, color: string, width: number) {
  ctx.save();
  polygonPath(ctx, pts);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const branches = 3 + Math.floor(rng() * 3);
  for (let b = 0; b < branches; b++) {
    let x = c.x + (rng() - 0.5) * radius * 0.4;
    let y = c.y + (rng() - 0.5) * radius * 0.4;
    let a = rng() * Math.PI * 2;
    ctx.lineWidth = width * (0.7 + rng() * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 5 + Math.floor(rng() * 4);
    for (let s = 0; s < steps; s++) {
      a += (rng() - 0.5) * 1.1;
      const step = radius * (0.12 + rng() * 0.14);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      ctx.lineTo(x, y);
      if (rng() < 0.3) {
        // Hairline side fracture.
        const sa = a + (rng() < 0.5 ? 1 : -1) * (0.6 + rng() * 0.6);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(sa) * step * 0.8, y + Math.sin(sa) * step * 0.8);
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

const ATLAS_CACHE = new Map<string, DiceAtlas>();

/**
 * Builds (or returns the cached) atlas for one die shape in one palette.
 * `cracked` adds glowing fractures for a natural 1.
 */
export function buildDiceAtlas(shape: DieShape, palette: DicePalette, cracked = false): DiceAtlas {
  const key = `${shape.kind}:${palette.id}:${cracked ? 1 : 0}`;
  const cached = ATLAS_CACHE.get(key);
  if (cached) return cached;

  const n = shape.faces.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = shape.kind === "d20" ? 288 : 256;
  const W = cols * cell;
  const H = rows * cell;
  const map = makeCanvas(W, H);
  const emissive = makeCanvas(W, H);
  const bump = makeCanvas(W, H);
  const mc = map.getContext("2d")!;
  const ec = emissive.getContext("2d")!;
  const bc = bump.getContext("2d")!;
  ec.fillStyle = "#000";
  ec.fillRect(0, 0, W, H);
  bc.fillStyle = "#fff";
  bc.fillRect(0, 0, W, H);

  const rng = mulberry32(shape.sides * 7919 + palette.id.length * 31 + (cracked ? 17 : 0));
  const uvs: [number, number][][] = [];
  const pad = 0.9;

  shape.faces.forEach((face, fi) => {
    const col = fi % cols;
    const row = Math.floor(fi / cols);
    const ox = col * cell;
    const oy = row * cell;
    const right: Vec3 = cross(face.up, face.normal);
    const local = face.verts.map((vi) => {
      const d = sub(shape.vertices[vi], face.center);
      return { x: dot(d, right), y: dot(d, face.up) };
    });
    const R = Math.max(...local.map((p) => Math.hypot(p.x, p.y)));
    const half = (cell / 2) * pad;
    const pts: Pt[] = local.map((p) => ({ x: ox + cell / 2 + (p.x / R) * half, y: oy + cell / 2 - (p.y / R) * half }));
    uvs.push(pts.map((p) => [p.x / W, 1 - p.y / H]));
    const c: Pt = { x: ox + cell / 2, y: oy + cell / 2 };

    // Resin body: fill the whole cell so mip-mapping never bleeds a seam.
    const body = mc.createRadialGradient(c.x - half * 0.25, c.y - half * 0.3, half * 0.05, c.x, c.y, half * 1.25);
    body.addColorStop(0, palette.face[0]);
    body.addColorStop(1, palette.face[1]);
    mc.fillStyle = body;
    mc.fillRect(ox, oy, cell, cell);

    mc.save();
    polygonPath(mc, pts);
    mc.clip();
    mc.globalCompositeOperation = "lighter";
    for (const tint of palette.swirl) {
      for (let k = 0; k < 3; k++) {
        const sx = ox + rng() * cell;
        const sy = oy + rng() * cell;
        const sr = cell * (0.18 + rng() * 0.35);
        const g = mc.createRadialGradient(sx, sy, 0, sx, sy, sr);
        g.addColorStop(0, tint);
        g.addColorStop(1, "rgba(0,0,0,0)");
        mc.fillStyle = g;
        mc.fillRect(ox, oy, cell, cell);
      }
    }
    mc.globalCompositeOperation = "source-over";
    if (palette.fleck) {
      mc.fillStyle = palette.fleck;
      for (let k = 0; k < 26; k++) {
        const s = rng() < 0.85 ? 0.8 + rng() * 1.1 : 1.8 + rng() * 1.4;
        mc.globalAlpha = 0.35 + rng() * 0.6;
        mc.beginPath();
        mc.arc(ox + rng() * cell, oy + rng() * cell, s, 0, Math.PI * 2);
        mc.fill();
      }
      mc.globalAlpha = 1;
    }
    // Bevel: dark band just inside the rim, then a bright polished edge.
    polygonPath(mc, pts);
    mc.lineJoin = "round";
    mc.lineWidth = cell * 0.075;
    mc.strokeStyle = palette.shade;
    mc.stroke();
    mc.lineWidth = cell * 0.028;
    mc.strokeStyle = palette.edge;
    mc.stroke();
    mc.restore();

    const r = inradius2d(pts, c);
    if (shape.kind === "d4") {
      // Three numerals per face, each near the vertex it names, reading
      // upright when that vertex points to the sky.
      face.verts.forEach((vi, k) => {
        const p = pts[k];
        const x = c.x + (p.x - c.x) * 0.52;
        const y = c.y + (p.y - c.y) * 0.52;
        const angle = Math.atan2(p.x - c.x, -(p.y - c.y));
        const label = String(shape.vertexValues![vi]);
        const size = r * 0.95;
        drawNumeral(mc, label, x, y, size, angle, "color", palette);
        drawNumeral(ec, label, x, y, size, angle, "emissive", palette);
        drawNumeral(bc, label, x, y, size, angle, "bump", palette);
      });
    } else if (shape.kind === "d6") {
      drawPips(mc, face.value, c, r, "color", palette);
      drawPips(ec, face.value, c, r, "emissive", palette);
      drawPips(bc, face.value, c, r, "bump", palette);
    } else {
      const twoDigits = face.label.length > 1;
      const base = shape.kind === "d20" || shape.kind === "d8" ? 1.3 : shape.kind === "d12" ? 1.02 : 1.05;
      const size = r * base * (twoDigits ? 0.86 : 1);
      // Kites carry their numeral nearer the wide equator than the pole.
      const shift = shape.kind === "d10" || shape.kind === "d10x" ? r * 0.28 : shape.kind === "d20" || shape.kind === "d8" ? r * 0.08 : 0;
      drawNumeral(mc, face.label, c.x, c.y + shift, size, 0, "color", palette);
      drawNumeral(ec, face.label, c.x, c.y + shift, size, 0, "emissive", palette);
      drawNumeral(bc, face.label, c.x, c.y + shift, size, 0, "bump", palette);
    }

    if (cracked) {
      const crackSeed = mulberry32(fi * 104729 + 7);
      drawCracks(mc, pts, c, half, crackSeed, "rgba(10, 0, 0, 0.85)", cell * 0.018);
      const glowSeed = mulberry32(fi * 104729 + 7);
      ec.save();
      ec.shadowColor = "#ffffff";
      ec.shadowBlur = cell * 0.02;
      drawCracks(ec, pts, c, half, glowSeed, "rgba(255, 255, 255, 0.9)", cell * 0.012);
      ec.restore();
    }
  });

  const atlas = { map, emissive, bump, uvs };
  ATLAS_CACHE.set(key, atlas);
  return atlas;
}

/** Waits (briefly) for the display font so numerals don't render in a fallback. */
export async function ensureDiceFont(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  FONT_STACK = displayFontStack();
  try {
    await Promise.race([
      document.fonts.load(`900 64px ${FONT_STACK}`),
      new Promise((resolve) => setTimeout(resolve, 900)),
    ]);
  } catch {
    // A fallback serif is acceptable.
  }
}
