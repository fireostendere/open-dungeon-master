// A believable battle at a table, built from the real generator, for the
// map lab (battlemap-lab.html). Nothing here touches the database: it makes
// the same PlayerMapView the server would send a player, with the party's
// surroundings explored, part of that in sight, and the rest still fog.

import { fnv1a, generateBattleMap, type MapTheme } from "@/lib/battlemap/generate";
import { TERRAIN, tileIndex, type AmbientLight, type TokenKind } from "@/lib/battlemap/types";
import type { PlayerMapView } from "@/lib/battlemap/view";

const PCS = ["Эйра", "Торин", "Мира", "Гром"];
const ENEMIES = ["Гоблин", "Волк", "Огр", "Скелет", "Паук-охотник"];

// A stand-in for a DM's painted picture: a flagged hall in flat colour.
const ART = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="896" viewBox="0 0 1280 896"><defs><pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill="#8c7d68"/><rect x="2" y="2" width="60" height="60" fill="#9a8a73"/><circle cx="20" cy="24" r="3" fill="#7d6f5c"/></pattern><radialGradient id="g" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient></defs><rect width="1280" height="896" fill="url(#p)"/><rect width="1280" height="896" fill="url(#g)"/></svg>`,
)}`;

export function sampleView(
  theme: MapTheme,
  opts: { ambient?: AmbientLight; fog?: boolean; seed?: string; art?: boolean; foes?: string[] } = {},
): PlayerMapView {
  const enemies = opts.foes?.length ? opts.foes : ENEMIES;
  const width = 20;
  const height = 14;
  const map = generateBattleMap({
    seed: fnv1a(opts.seed ?? `lab-${theme}`),
    width,
    height,
    theme,
    ambient: opts.ambient,
    pcCount: PCS.length,
    enemyCount: enemies.length,
  });
  const terrain = map.terrain.split("");
  const at = (x: number, y: number) => terrain[tileIndex(width, x, y)];

  // A door in the middle of a wall run, so the style can be judged on one.
  if (theme === "interior") {
    outer: for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        if (at(x, y - 1) === "#" && at(x, y + 1) === "#" && at(x - 1, y) === "." && at(x + 1, y) === ".") {
          terrain[tileIndex(width, x, y)] = TERRAIN.door;
          break outer;
        }
      }
    }
  }

  const open = (x: number, y: number) => x > 0 && y > 0 && x < width - 1 && y < height - 1 && at(x, y) !== "#" && at(x, y) !== "~";
  const pcs = map.pcSpawns.slice(0, PCS.length);
  const foes = map.enemySpawns.slice(0, enemies.length);
  const taken = new Set([...pcs, ...foes].map((p) => tileIndex(width, p.x, p.y)));
  const spare: Array<{ x: number; y: number }> = [];
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  for (let r = 0; r < 8 && spare.length < 2; r += 1) {
    for (let y = cy - r; y <= cy + r && spare.length < 2; y += 1) {
      for (let x = cx - r; x <= cx + r && spare.length < 2; x += 1) {
        if (open(x, y) && !taken.has(tileIndex(width, x, y)) && (x + y) % 2 === 0) {
          taken.add(tileIndex(width, x, y));
          spare.push({ x, y });
        }
      }
    }
  }

  const tokens: PlayerMapView["tokens"] = [];
  const add = (kind: TokenKind, name: string, p: { x: number; y: number }, extra: Partial<PlayerMapView["tokens"][number]> = {}) =>
    tokens.push({ id: `${kind}-${tokens.length}`, kind, refId: `${kind}-${tokens.length}`, name, x: p.x, y: p.y, mine: false, down: false, hidden: false, ...extra });
  pcs.forEach((p, i) => add("pc", PCS[i], p, { mine: i === 0, down: i === 3 }));
  foes.forEach((p, i) => add("enemy", enemies[i], p));
  if (spare[0]) add("npc", "Трактирщик", spare[0]);
  if (spare[1]) add("prop", "Бочка", spare[1]);

  // What the party has seen: a disc round them, and a smaller one in sight.
  const focus = pcs[0] ?? { x: cx, y: cy };
  const near = (x: number, y: number, r: number) => (x - focus.x) ** 2 + (y - focus.y) ** 2 <= r * r;
  const fog = opts.fog ?? true;
  const explored: number[] = [];
  const visible: number[] = [];
  const shown = terrain.map((ch, idx) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (!fog || near(x, y, 13)) {
      explored.push(idx);
      if (!fog || near(x, y, 8)) visible.push(idx);
      return ch;
    }
    return " ";
  });

  // Anyone the party has not reached is not on their board.
  const seen = new Set(explored);
  // and an enemy outside their sight is not on it either.
  const sight = new Set(visible);
  const visibleTokens = tokens.filter((t) =>
    t.kind === "enemy" ? sight.has(tileIndex(width, t.x, t.y)) : seen.has(tileIndex(width, t.x, t.y)),
  );

  // Lights: the generator's own, or two braziers so a lit style has something to show.
  const lights = (map.lights.length ? map.lights : [
    { x: pcs[1]?.x ?? 6, y: (pcs[1]?.y ?? 5) - 1, brightRadius: 3, dimRadius: 6 },
    { x: foes[0]?.x ?? 14, y: (foes[0]?.y ?? 6) + 1, brightRadius: 3, dimRadius: 6 },
  ])
    .filter((l) => seen.has(tileIndex(width, l.x, l.y)))
    .map((l) => ({ x: l.x, y: l.y, radius: l.brightRadius }));

  // Where the first party member could walk this turn.
  const reachable: number[] = [];
  const dist = new Map<number, number>([[tileIndex(width, focus.x, focus.y), 0]]);
  const queue = [focus];
  while (queue.length) {
    const p = queue.shift()!;
    const d = dist.get(tileIndex(width, p.x, p.y)) ?? 0;
    if (d >= 4) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      const idx = tileIndex(width, nx, ny);
      if (!open(nx, ny) || dist.has(idx) || !seen.has(idx)) continue;
      dist.set(idx, d + 1);
      queue.push({ x: nx, y: ny });
      if (!taken.has(idx) || !visibleTokens.some((t) => t.x === nx && t.y === ny)) reachable.push(idx);
    }
  }

  return {
    mapId: `lab-${theme}-${opts.ambient ?? "auto"}-${fog}`,
    width,
    height,
    ambient: opts.ambient ?? map.ambient,
    theme: map.theme,
    terrain: shown.join(""),
    backdrop: opts.art ? { path: ART, transform: { offsetX: 0, offsetY: 0, scale: 1, opacity: 1 } } : null,
    visible,
    explored,
    tokens: visibleTokens,
    lights,
    reachable,
    budgetLeft: 4,
    myTokenId: tokens[0]?.id ?? null,
    round: 2,
    currentTurnName: PCS[0],
    board: "fight",
    fullVision: !fog,
    labels: [],
  };
}
