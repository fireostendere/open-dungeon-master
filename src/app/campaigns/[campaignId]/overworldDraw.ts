import { noiseField, skinForGenre, type XY } from "@/lib/overworld/logic";
import type { OverworldLabel, OverworldPath, PathKind } from "@/lib/overworld/features";
import { atlasQuests, isQuestPin, type AtlasCharacter, type AtlasLocation } from "@/lib/overworld/atlas";
import { atlasTerrain, BIOME_MATERIALS, materialAt, type TerrainMaterial } from "@/lib/overworld/cartography";

// Canvas drawing for the region map, lifted out of OverworldPanel so the
// panel has room for the DM's authoring controls. Nothing here touches
// React or the network: terrain, routes, pins, place markers and the party
// marker, in that order, into a context the caller has already transformed.

export const OVERWORLD_TILE = 16;

export type OverworldLocation = AtlasLocation;
export type AtlasMaterials = Partial<Record<TerrainMaterial, HTMLImageElement>>;

export type OverworldData = {
  map: {
    seed: number;
    width: number;
    height: number;
    terrain: string;
    materialGrid?: string;
    terrainConflicts?: string[];
    pins: Array<{ id: string; x: number; y: number; label: string }>;
    partyXy: { x: number; y: number } | null;
    params: Record<string, number>;
    paths: OverworldPath[];
    labels: OverworldLabel[];
    backdropPath: string;
    notes?: string;
  };
  locations: OverworldLocation[];
  party?: AtlasCharacter[];
  quests?: string[];
  scope?: "spatial" | "party";
};

export type DrawOptions = {
  genre: string;
  pulse: number;
  selectedLocationId?: string | null;
  // The backdrop, once the panel has loaded it. Drawn in place of the tiles.
  backdrop?: HTMLImageElement | null;
  // A road, river or border still being drawn: its points so far.
  pending?: { kind: PathKind; points: XY[] } | null;
  // Accessible DOM markers sit over the screen canvas; exports draw them.
  markers?: boolean;
  // The finished relief (reliefTerrain, or its cached copy). Without it and
  // without a backdrop the ground is the cheap low-poly grid, or bare.
  relief?: CanvasImageSource | null;
  lowPoly?: boolean;
};

// ponytail: one region cache; a gallery can use an LRU if multiple maps ever
// share a screen. Position/journal updates must reuse the unchanged relief.
let terrainCache: { seed: number; width: number; height: number; terrain: string; materialGrid?: string; genre: string; materials?: AtlasMaterials | null; canvas: HTMLCanvasElement } | undefined;
const materialCache = new WeakMap<HTMLImageElement, ImageData>();
const MATERIAL_COLOURS: Partial<Record<TerrainMaterial, number[]>> = {
  broadleaf: [72, 99, 54], autumn: [128, 91, 42], jungle: [34, 72, 40], deadwood: [77, 72, 62], enchanted: [42, 81, 71],
  desert: [172, 143, 83], tundra: [113, 120, 103], snow: [188, 199, 202], canyon: [137, 94, 63],
  volcanic: [53, 49, 46], shallows: [53, 118, 123], ice: [150, 183, 196], lava: [178, 70, 18],
};

// Relief is derived from the stored biome grid, including hand-painted
// changes. A generated illustration must never replace the world's facts.
export function reliefTerrain(map: Pick<OverworldData["map"], "seed" | "width" | "height" | "terrain" | "materialGrid">, genre: string, materials?: AtlasMaterials | null) {
  const cached = terrainCache;
  if (cached && cached.seed === map.seed && cached.width === map.width && cached.height === map.height && cached.terrain === map.terrain && cached.materialGrid === map.materialGrid && cached.genre === genre && cached.materials === materials) return cached.canvas;
  const canvas = document.createElement("canvas");
  const resolution = 16;
  canvas.width = map.width * resolution;
  canvas.height = map.height * resolution;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(canvas.width, canvas.height);
  const surfaces: Record<string, ImageData> = {};
  for (const [kind, bitmap] of Object.entries(materials ?? {})) {
    if (!usable(bitmap)) continue;
    const cachedMaterial = materialCache.get(bitmap);
    if (cachedMaterial) { surfaces[kind] = cachedMaterial; continue; }
    const plate = document.createElement("canvas");
    plate.width = bitmap.naturalWidth; plate.height = bitmap.naturalHeight;
    const plateContext = plate.getContext("2d")!;
    plateContext.drawImage(bitmap, 0, 0);
    const pixels = plateContext.getImageData(0, 0, plate.width, plate.height);
    materialCache.set(bitmap, pixels);
    surfaces[kind] = pixels;
  }
  const skin = skinForGenre(genre);
  const colours = Object.fromEntries(Object.entries(skin).map(([kind, entry]) => {
    const n = parseInt(entry.fill.slice(1), 16);
    const rgb = [n >> 16, (n >> 8) & 255, n & 255];
    const gray = rgb[0] * 0.3 + rgb[1] * 0.55 + rgb[2] * 0.15;
    return [kind, rgb.map(channel => channel * 0.58 + gray * 0.42)];
  })) as Record<string, number[]>;
  const heights: Record<string, number> = { w: 0, s: 0.18, p: 0.28, f: 0.38, h: 0.68, m: 1 };
  const tile = (x: number, y: number) => map.terrain[Math.max(0, Math.min(map.height - 1, y)) * map.width + Math.max(0, Math.min(map.width - 1, x))] ?? "w";
  const texture = (x: number, y: number) => map.materialGrid ? materialAt(map.materialGrid, Math.max(0, Math.min(map.height - 1, y)) * map.width + Math.max(0, Math.min(map.width - 1, x))) : BIOME_MATERIALS[tile(x, y) as keyof typeof BIOME_MATERIALS];
  const field = (x: number, y: number) => {
    let height = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      height += (texture(x + dx, y + dy) === "lava" ? 0.12 : heights[tile(x + dx, y + dy)] ?? 0) * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
    }
    return height / 16;
  };
  const elevation = Array.from({ length: map.width * map.height }, (_, i) => field(i % map.width, Math.floor(i / map.width)));
  const at = (x: number, y: number) => elevation[Math.max(0, Math.min(map.height - 1, y)) * map.width + Math.max(0, Math.min(map.width - 1, x))];
  const broad = noiseField(map.seed ^ 0x51ed270b, map.width, map.height, 1.8);
  const fine = noiseField(map.seed ^ 0x2545f491, map.width, map.height, 0.45);
  const detail = (x: number, y: number) => (1 - Math.abs(broad(x, y) * 2 - 1)) * 0.7 + fine(x, y) * 0.3;
  const phase = (map.seed % 1000) / 37;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const gx = x / resolution, gy = y / resolution, ix = Math.floor(gx), iy = Math.floor(gy);
    const tx = gx - ix, ty = gy - iy;
    const kinds = [tile(ix, iy), tile(ix + 1, iy), tile(ix, iy + 1), tile(ix + 1, iy + 1)];
    const textures = [texture(ix, iy), texture(ix + 1, iy), texture(ix, iy + 1), texture(ix + 1, iy + 1)];
    const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    const height = at(ix, iy) * weights[0] + at(ix + 1, iy) * weights[1] + at(ix, iy + 1) * weights[2] + at(ix + 1, iy + 1) * weights[3];
    const dx = (at(ix + 1, iy) - at(ix, iy)) * (1 - ty) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ty;
    const dy = (at(ix, iy + 1) - at(ix, iy)) * (1 - tx) + (at(ix + 1, iy + 1) - at(ix + 1, iy)) * tx;
    const rock = Math.max(0, height - 0.4);
    const slope = -dx * 1.1 - dy * 1.3 + (detail(gx - 0.1, gy - 0.1) - detail(gx + 0.1, gy + 0.1)) * rock * 2.2;
    const grain = Math.sin(x * 12.9898 + y * 78.233 + phase) * 0.018;
    const light = 0.96 + slope + (detail(gx, gy) - 0.5) * rock * 0.24 + grain;
    const index = (y * canvas.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      let value = 0;
      for (let corner = 0; corner < 4; corner++) {
        const kind = kinds[corner];
        const surface = textures[corner];
        const material = surfaces[surface];
        let colour = (MATERIAL_COLOURS[surface] ?? colours[kind] ?? colours.w)[channel];
        if (material) {
          const mx = Math.floor(((gx + phase) / 18 % 1) * material.width);
          const my = Math.floor(((gy + phase) / 18 % 1) * material.height);
          const materialIndex = (my * material.width + mx) * 4 + channel;
          colour = material.data[materialIndex] * 0.86 + colour * 0.14;
        }
        value += colour * weights[corner];
      }
      const snow = textures.some(value => value === "lava" || value === "volcanic") ? 0 : Math.max(0, height - 0.7) * (surfaces.mountains ? 60 : 150);
      image.data[index + channel] = Math.min(255, Math.max(0, value * light + snow));
    }
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  // Fine contour lines follow the actual elevation, like an engraved atlas.
  context.strokeStyle = "rgba(235,224,194,0.12)";
  context.lineWidth = 0.55;
  for (const level of [0.22, 0.42, 0.6, 0.78]) {
    context.beginPath();
    for (let y = 0; y < map.height - 1; y++) for (let x = 0; x < map.width - 1; x++) {
      const corners = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
      const points = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const crossings: number[][] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if ((corners[edge] < level) === (corners[next] < level)) continue;
        const t = (level - corners[edge]) / (corners[next] - corners[edge]);
        crossings.push([points[edge][0] + (points[next][0] - points[edge][0]) * t, points[edge][1] + (points[next][1] - points[edge][1]) * t]);
      }
      for (let i = 1; i < crossings.length; i += 2) {
        context.moveTo(crossings[i - 1][0] * resolution, crossings[i - 1][1] * resolution);
        context.lineTo(crossings[i][0] * resolution, crossings[i][1] * resolution);
      }
    }
    context.stroke();
  }
  terrainCache = { seed: map.seed, width: map.width, height: map.height, terrain: map.terrain, materialGrid: map.materialGrid, genre, materials, canvas };
  return canvas;
}

const PATH_STYLES: Record<PathKind, { stroke: string; width: number; dash: number[] }> = {
  road: { stroke: "rgba(214, 178, 110, 0.95)", width: 1.8, dash: [] },
  river: { stroke: "rgba(96, 168, 236, 0.95)", width: 2.4, dash: [] },
  border: { stroke: "rgba(232, 96, 96, 0.9)", width: 1.6, dash: [4, 3] },
};

function drawPath(
  context: CanvasRenderingContext2D,
  path: { kind: PathKind; points: XY[]; label?: string },
  tile: number,
  pending = false,
) {
  if (path.points.length === 0) {
    return;
  }
  const style = PATH_STYLES[path.kind];
  context.strokeStyle = style.stroke;
  context.lineWidth = style.width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(pending ? [2, 3] : style.dash);
  context.beginPath();
  path.points.forEach((point, index) => {
    const x = point.x * tile + tile / 2;
    const y = point.y * tile + tile / 2;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.setLineDash([]);
  if (pending) {
    // Handles on every point, so the DM can see what a tap added.
    context.fillStyle = style.stroke;
    for (const point of path.points) {
      context.beginPath();
      context.arc(point.x * tile + tile / 2, point.y * tile + tile / 2, 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  if (path.label) {
    const middle = path.points[Math.floor(path.points.length / 2)];
    context.font = "italic 10px sans-serif";
    context.fillStyle = "rgba(250, 240, 220, 0.85)";
    context.fillText(path.label, middle.x * tile + tile / 2 + 5, middle.y * tile + tile / 2 - 4);
  }
}

function drawLabels(context: CanvasRenderingContext2D, labels: OverworldLabel[], tile: number) {
  for (const label of labels) {
    const x = label.x * tile + tile / 2;
    const y = label.y * tile + tile / 2;
    const large = label.size === "large";
    context.font = large ? "700 20px serif" : "600 11px sans-serif";
    context.textAlign = "center";
    context.lineWidth = large ? 4 : 3;
    context.strokeStyle = "rgba(20, 16, 10, 0.75)";
    context.fillStyle = large ? "rgba(250, 236, 200, 0.9)" : "rgba(250, 240, 220, 0.95)";
    const text = large ? label.text.toUpperCase() : label.text;
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.textAlign = "start";
  }
}

// A drawn backdrop counts as loaded once the browser has its size.
function usable(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

export function drawOverworld(
  context: CanvasRenderingContext2D,
  data: OverworldData,
  options: DrawOptions,
) {
  const tile = OVERWORLD_TILE;
  const { width, height } = data.map;

  if (usable(options.backdrop)) {
    // The picture stands in for the tiles, stretched to the grid so a tap
    // lands on the same tile whichever of the two is showing.
    context.drawImage(options.backdrop, 0, 0, width * tile, height * tile);
  } else if (options.relief) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(options.relief, 0, 0, width * tile, height * tile);
  } else if (options.lowPoly) {
    const skin = skinForGenre(options.genre);
    const map = data.map.materialGrid ? data.map : { ...data.map, ...atlasTerrain(data.map, data.locations) };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const kind = map.terrain[y * width + x] as keyof typeof skin;
      const fill = skin[kind]?.fill ?? skin.w.fill;
      context.fillStyle = fill;
      context.fillRect(x * tile, y * tile, tile, tile);
      context.fillStyle = "rgba(0,0,0,0.08)";
      context.beginPath();
      context.moveTo(x * tile, y * tile);
      context.lineTo((x + 1) * tile, y * tile);
      context.lineTo(x * tile, (y + 1) * tile);
      context.fill();
    }
  }

  // Borders under rivers under roads: a road crossing a river reads as a
  // bridge, and a border is the faintest of the three.
  for (const kind of ["border", "river", "road"] as const) {
    for (const path of data.map.paths ?? []) {
      if (path.kind === kind) {
        drawPath(context, path, tile);
      }
    }
  }
  if (options.pending) {
    drawPath(context, options.pending, tile, true);
  }

  // Routes: curves between anchors of connected locations, drawn once per pair.
  const anchorById = new Map(
    data.locations
      .filter((location) => location.anchor)
      .map((location) => [location.id, location.anchor as { x: number; y: number }] as const),
  );
  const idByName = new Map(
    data.locations.map((location) => [location.name.toLowerCase(), location.id] as const),
  );
  context.strokeStyle = "rgba(240, 220, 170, 0.45)";
  context.lineWidth = 1.5;
  context.setLineDash([5, 4]);
  const drawn = new Set<string>();
  for (const location of data.locations) {
    const from = anchorById.get(location.id);
    if (!from) {
      continue;
    }
    for (const connectionName of location.connections) {
      const targetId = idByName.get(connectionName.toLowerCase());
      const to = targetId ? anchorById.get(targetId) : null;
      if (!to || !targetId) {
        continue;
      }
      const key = [location.id, targetId].sort().join("|");
      if (drawn.has(key)) {
        continue;
      }
      drawn.add(key);
      const fromX = from.x * tile + tile / 2;
      const fromY = from.y * tile + tile / 2;
      const toX = to.x * tile + tile / 2;
      const toY = to.y * tile + tile / 2;
      const midX = (fromX + toX) / 2 + (fromY - toY) * 0.15;
      const midY = (fromY + toY) / 2 + (toX - fromX) * 0.15;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.quadraticCurveTo(midX, midY, toX, toY);
      context.stroke();
    }
  }
  context.setLineDash([]);

  drawLabels(context, data.map.labels ?? [], tile);
  if (options.markers === false) return;

  // Lead pins under the location markers.
  for (const pin of data.map.pins) {
    if (isQuestPin(pin)) continue;
    const pinX = pin.x * tile + tile / 2;
    const pinY = pin.y * tile + tile / 2;
    context.fillStyle = "rgba(190, 120, 240, 0.9)";
    context.beginPath();
    context.arc(pinX, pinY, 4, 0, Math.PI * 2);
    context.fill();
    if (pin.label) {
      context.font = "10px sans-serif";
      context.fillStyle = "rgba(220, 190, 250, 0.95)";
      context.fillText(pin.label, pinX + 7, pinY + 3);
    }
  }

  // Locations: solid dots for visited, ghost dots for known-unvisited, pulse
  // ring on the party's current position, and a bright ring on whichever one
  // the DM has picked up to move.
  for (const location of data.locations) {
    const anchor = location.anchor;
    if (!anchor) {
      continue;
    }
    const markerX = anchor.x * tile + tile / 2;
    const markerY = anchor.y * tile + tile / 2;
    if (location.isCurrent) {
      const pulse = 6 + Math.sin(options.pulse / 12) * 2.5;
      context.strokeStyle = "rgba(250, 200, 90, 0.85)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(markerX, markerY, pulse, 0, Math.PI * 2);
      context.stroke();
    }
    if (options.selectedLocationId === location.id) {
      context.strokeStyle = "rgba(120, 220, 250, 0.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(markerX, markerY, 9, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = location.visited
      ? "rgba(250, 225, 160, 0.95)"
      : "rgba(250, 225, 160, 0.4)";
    context.beginPath();
    context.arc(markerX, markerY, 4.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(30, 25, 15, 0.8)";
    context.lineWidth = 1;
    context.stroke();
    context.font = "600 10px sans-serif";
    context.fillStyle = location.visited
      ? "rgba(250, 240, 220, 0.95)"
      : "rgba(250, 240, 220, 0.5)";
    context.fillText(location.name, markerX + 8, markerY - 6);
  }

  for (const quest of atlasQuests(data.quests ?? [], data.locations, data.map.pins)) {
    if (!quest.anchor) continue;
    const x = quest.anchor.x * tile + tile / 2, y = quest.anchor.y * tile - 14;
    context.fillStyle = "#f4d48f";
    context.beginPath();
    context.moveTo(x, y - 7); context.lineTo(x + 5, y); context.lineTo(x, y + 7); context.lineTo(x - 5, y);
    context.closePath(); context.fill();
    context.font = "600 11px sans-serif";
    context.fillText(quest.text, x + 10, y + 4);
  }
  for (const character of data.party ?? []) {
    const location = data.locations.find(entry => entry.id === character.locationId);
    const anchor = location?.anchor ?? data.map.partyXy;
    if (!anchor) continue;
    const siblings = (data.party ?? []).filter(entry => entry.locationId === character.locationId);
    const offset = (siblings.findIndex(entry => entry.id === character.id) - (siblings.length - 1) / 2) * 20;
    const x = anchor.x * tile + tile / 2 + offset, y = anchor.y * tile + 34;
    context.fillStyle = "#192b2b";
    context.strokeStyle = "#89cfbf";
    context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill(); context.stroke();
    context.font = "700 9px sans-serif"; context.textAlign = "center"; context.fillStyle = "#d4f4e9";
    context.fillText(character.name.slice(0, 1), x, y + 3);
    context.textAlign = "start";
  }

  // The party marker, on top of everything: a party between two places has no
  // current location, which is exactly when the table most wants to see it.
  const party = data.map.partyXy;
  if (party) {
    const partyX = party.x * tile + tile / 2;
    const partyY = party.y * tile + tile / 2;
    context.fillStyle = "rgba(120, 220, 250, 0.95)";
    context.beginPath();
    context.moveTo(partyX, partyY - 6);
    context.lineTo(partyX + 5, partyY + 5);
    context.lineTo(partyX - 5, partyY + 5);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(10, 25, 35, 0.9)";
    context.lineWidth = 1;
    context.stroke();
  }
}

// The whole map at one tile per OVERWORLD_TILE pixels, as a PNG. Drawn from
// scratch on its own canvas so the view's pan and zoom do not crop it.
export function renderOverworldPng(
  data: OverworldData,
  options: Pick<DrawOptions, "genre" | "backdrop" | "relief" | "lowPoly">,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = data.map.width * OVERWORLD_TILE;
  canvas.height = data.map.height * OVERWORLD_TILE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.resolve(null);
  }
  drawOverworld(context, data, { ...options, pulse: 0 });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

// Renders and hands the PNG to the browser as a download. Returns what went
// wrong, or null.
export async function saveOverworldPng(
  data: OverworldData,
  options: Pick<DrawOptions, "genre" | "backdrop" | "relief" | "lowPoly">,
): Promise<string | null> {
  const blob = await renderOverworldPng(data, options);
  if (!blob) {
    return "The map would not render.";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `region-map-${data.map.seed}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return null;
}
