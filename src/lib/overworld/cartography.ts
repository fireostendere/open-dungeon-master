import type { XY, OverworldTile } from "./logic.ts";

export const TERRAIN_ASSETS = {
  mountains: "/assets/maps/terrain-mountains.webp", forest: "/assets/maps/terrain-forest.webp",
  plains: "/assets/maps/terrain-plains.webp", water: "/assets/maps/terrain-water.webp",
  hills: "/assets/maps/terrain-hills.webp", swamp: "/assets/maps/terrain-swamp.webp",
  broadleaf: "/assets/maps/terrain-broadleaf.webp", autumn: "/assets/maps/terrain-autumn.webp",
  jungle: "/assets/maps/terrain-jungle.webp", deadwood: "/assets/maps/terrain-deadwood.webp",
  enchanted: "/assets/maps/terrain-enchanted.webp", desert: "/assets/maps/terrain-desert.webp",
  tundra: "/assets/maps/terrain-tundra.webp", snow: "/assets/maps/terrain-snow.webp",
  canyon: "/assets/maps/terrain-canyon.webp", volcanic: "/assets/maps/terrain-volcanic.webp",
  shallows: "/assets/maps/terrain-shallows.webp", ice: "/assets/maps/terrain-ice.webp",
  lava: "/assets/maps/terrain-lava.webp",
};
export type TerrainMaterial = keyof typeof TERRAIN_ASSETS;
export const MATERIAL_NAMES = Object.keys(TERRAIN_ASSETS) as TerrainMaterial[];
export const materialAt = (grid: string, index: number) => MATERIAL_NAMES[(grid.charCodeAt(index) || 97) - 97];
export const BIOME_MATERIALS: Record<OverworldTile, TerrainMaterial> = { m: "mountains", f: "forest", p: "plains", w: "water", h: "hills", s: "swamp" };
export const LANDMARK_SHEETS = { settlements: "/assets/maps/landmarks-settlements.webp", adventure: "/assets/maps/landmarks-adventure.webp" };
export const LANDMARK_ASSETS = {
  village: ["settlements", 0, "settlement"], town: ["settlements", 1, "settlement"], city: ["settlements", 2, "settlement"],
  elvenCity: ["settlements", 3, "settlement"], dwarvenHold: ["settlements", 4, "fort"], castle: ["settlements", 5, "fort"],
  ruinedCastle: ["settlements", 6, "ruin"], watchtower: ["settlements", 7, "fort"], temple: ["settlements", 8, "shrine"],
  shrine: ["settlements", 9, "shrine"], monastery: ["settlements", 10, "shrine"], port: ["settlements", 11, "port"],
  cave: ["adventure", 0, "dungeon"], mine: ["adventure", 1, "dungeon"], dungeon: ["adventure", 2, "dungeon"],
  ruins: ["adventure", 3, "ruin"], pyramid: ["adventure", 4, "ruin"], wizardTower: ["adventure", 5, "fort"],
  volcano: ["adventure", 6, "mountain"], waterfall: ["adventure", 7, "port"], camp: ["adventure", 8, "camp"],
  graveyard: ["adventure", 9, "ruin"], bridge: ["adventure", 10, "port"], portal: ["adventure", 11, "neutral"],
} as const;
export type LandmarkAsset = keyof typeof LANDMARK_ASSETS;
export const LANDMARK_NAMES: Record<LandmarkAsset, [string, string]> = {
  village: ["Деревня", "Village"], town: ["Городок", "Town"], city: ["Город", "City"], elvenCity: ["Эльфийский город", "Elven city"],
  dwarvenHold: ["Дварфийская крепость", "Dwarven stronghold"], castle: ["Замок", "Castle"], ruinedCastle: ["Разрушенный замок", "Ruined castle"],
  watchtower: ["Сторожевая башня", "Watchtower"], temple: ["Храм", "Temple"], shrine: ["Святилище", "Shrine"], monastery: ["Монастырь", "Monastery"], port: ["Порт", "Port"],
  cave: ["Пещера", "Cave"], mine: ["Шахта", "Mine"], dungeon: ["Подземелье", "Dungeon"], ruins: ["Руины", "Ruins"], pyramid: ["Пирамида", "Pyramid"],
  wizardTower: ["Башня мага", "Wizard tower"], volcano: ["Вулкан", "Volcano"], waterfall: ["Водопад", "Waterfall"], camp: ["Лагерь", "Camp"],
  graveyard: ["Кладбище", "Graveyard"], bridge: ["Мост", "Bridge"], portal: ["Портал", "Portal"],
};
export const TERRAIN_NAMES: Record<TerrainMaterial, [string, string]> = {
  mountains: ["Горы", "Mountains"], forest: ["Хвойный лес", "Pine forest"], plains: ["Равнина", "Plains"], water: ["Озеро", "Lake"],
  hills: ["Холмы", "Hills"], swamp: ["Болото", "Swamp"], broadleaf: ["Лиственный лес", "Broadleaf forest"], autumn: ["Осенний лес", "Autumn forest"],
  jungle: ["Джунгли", "Jungle"], deadwood: ["Мёртвый лес", "Dead forest"], enchanted: ["Зачарованный лес", "Enchanted forest"], desert: ["Пустыня", "Desert"],
  tundra: ["Тундра", "Tundra"], snow: ["Снежные горы", "Snow mountains"], canyon: ["Каньон", "Canyon"], volcanic: ["Вулканическая местность", "Volcanic terrain"],
  shallows: ["Мелководье", "Shallows"], ice: ["Ледяное озеро", "Ice lake"], lava: ["Лавовое озеро", "Lava lake"],
};
type Place = { name: string; layoutDescription?: string };

// Specific names win over generic types. An incidental forest in a town's
// description must not change its symbol. Unknown names keep a neutral pin.
const LANDMARK_RULES: Array<[LandmarkAsset, RegExp]> = [
  ["ruinedCastle", /(?:руин|разрушенн|abandoned|ruined).*(?:зам|крепост|castle|keep)|(?:зам|крепост|castle|keep).*(?:руин|разрушенн|ruin)/iu],
  ["wizardTower", /(?:башн|tower).*(?:маг|волшеб|wizard|mage)|(?:маг|волшеб|wizard|mage).*(?:башн|tower)/iu],
  ["dwarvenHold", /(?:дварф|дворф|гном|dwarv).*(?:город|крепост|цитадел|hold|city|fort)|(?:город|крепост|city|hold).*(?:дварф|гном|dwarv)/iu],
  ["elvenCity", /(?:эльф|elven).*(?:город|city|поселен)|(?:город|city).*(?:эльф|elves)/iu],
  ["portal", /портал|portal/iu], ["volcano", /вулкан(?:\s|$|[.!?,])|\bvolcano\b/iu], ["waterfall", /водопад|waterfall/iu],
  ["bridge", /(?:^|\s)мост|\bbridge\b/iu], ["port", /пристан|гаван|(?:^|\s)порт(?:\s|$)|\b(?:port|harbou?r|wharf|dock)\b/iu],
  ["mine", /шахт|рудник|\bmine\b/iu], ["cave", /пещер|\bcavern?\b|\bcave\b/iu], ["dungeon", /подземел|dungeon/iu],
  ["graveyard", /кладбищ|гробниц|склеп|graveyard|cemetery|tomb|crypt/iu], ["pyramid", /пирамид|pyramid/iu],
  ["ruins", /руин|ruins?/iu], ["castle", /замок|крепост|цитадел|\b(?:castle|fort|fortress|keep|citadel)\b/iu],
  ["watchtower", /башн|tower/iu], ["monastery", /монастыр|monastery|abbey/iu], ["shrine", /святилищ|shrine/iu],
  ["temple", /храм|temple/iu], ["camp", /лагер|стоянк|\bcamp\b/iu], ["village", /деревн|село(?:\s|$)|village|hamlet/iu],
  ["town", /городок|пос[её]лок|\btown\b/iu], ["city", /город|\bcity\b/iu],
];

export function landmarkForLocation(place: Place): LandmarkAsset | null {
  const explicit = place.layoutDescription?.match(/^(?:Тип места|Place type):\s*([^.!?]+)/iu)?.[1];
  if (explicit) return LANDMARK_RULES.find(([, rule]) => rule.test(explicit))?.[0] ?? null;
  const named = LANDMARK_RULES.find(([, rule]) => rule.test(place.name));
  if (named) return named[0];
  const opening = (place.layoutDescription ?? "").split(/[.!?;,]|\s(?:у|возле|около|beside|near|by)\s/iu)[0].trim();
  // Only an explicit leading type identifies a place with a proper name.
  const leading = opening.replace(/^(?:это\s+|an?\s+|the\s+)/iu, "").split(/\s+/).slice(0, 3).join(" ");
  return LANDMARK_RULES.find(([, rule]) => rule.test(leading))?.[0] ?? null;
}

export type PlaceEnvironment = { ground: OverworldTile; material: TerrainMaterial; radius: number; water?: "coast" | "lake" | "river" | "ice" | "lava" };
const ENVIRONMENT_RULES: Array<[RegExp, PlaceEnvironment]> = [
  [/(?:лавов|lava).*(?:озер|озёр|lake)|(?:озер|озёр|lake).*лав|озеро лавы/iu, { ground: "h", material: "lava", radius: 6, water: "lava" }],
  [/вулкан|лавов|озеро лавы|volcan|lava/iu, { ground: "m", material: "volcanic", radius: 7, water: "lava" }],
  [/ледник|ледян(?:ое|ая|ые)|зам[её]рз|glacier|frozen|ice lake/iu, { ground: "w", material: "ice", radius: 6, water: "ice" }],
  [/снеж|snow/iu, { ground: "m", material: "snow", radius: 6 }],
  [/тундр|tundra/iu, { ground: "p", material: "tundra", radius: 7 }],
  [/пустын|дюн|desert|dunes/iu, { ground: "p", material: "desert", radius: 7 }],
  [/каньон|ущель|canyon|gorge/iu, { ground: "h", material: "canyon", radius: 6 }],
  [/джунгл|тропическ|jungle|tropical forest/iu, { ground: "f", material: "jungle", radius: 7 }],
  [/(?:м[её]ртв|выжжен|dead|burnt).*(?:лес|рощ|forest|wood)/iu, { ground: "f", material: "deadwood", radius: 6 }],
  [/(?:зачарован|волшебн|enchanted|magical).*(?:лес|рощ|forest|wood)/iu, { ground: "f", material: "enchanted", radius: 6 }],
  [/осенн|autumn/iu, { ground: "f", material: "autumn", radius: 6 }],
  [/листвен|дубов|бер[её]з|broadleaf|deciduous|oak grove/iu, { ground: "f", material: "broadleaf", radius: 6 }],
  [/болот|топь|трясин|swamp|marsh|bog/iu, { ground: "s", material: "swamp", radius: 6 }],
  [/лес|рощ|forest|woods?|grove/iu, { ground: "f", material: "forest", radius: 6 }],
  [/перевал|хребет|вершин|(?:^|\s)гор(?:а|ы|ах|ный)|mountain|\bpass\b|\bpeak\b/iu, { ground: "m", material: "mountains", radius: 6 }],
  [/рек[аи]|river|stream/iu, { ground: "w", material: "water", radius: 5, water: "river" }],
  [/мелковод|shallows/iu, { ground: "w", material: "shallows", radius: 5, water: "lake" }],
  [/озер|озёр|lake|море|морск|океан|sea\b|ocean/iu, { ground: "w", material: "water", radius: 6, water: "lake" }],
  [/холм|hill/iu, { ground: "h", material: "hills", radius: 5 }],
  [/долин|равнин|луг|valley|plains?|meadow/iu, { ground: "p", material: "plains", radius: 5 }],
];

export function environmentForLocation(place: Place): PlaceEnvironment | null {
  const landmark = landmarkForLocation(place);
  const nameRule = ENVIRONMENT_RULES.find(([rule]) => rule.test(place.name));
  const leading = (place.layoutDescription ?? "").split(/[.!?;]/u).slice(0, 2).join(". ");
  const specified = place.layoutDescription?.match(/(?:^|[.!?])\s*(?:Окружение|Environment):\s*([^.!?]+)/iu)?.[1];
  const explicit = (specified ? ENVIRONMENT_RULES.find(([rule]) => rule.test(specified))?.[1] : undefined)
    ?? nameRule?.[1] ?? ENVIRONMENT_RULES.find(([rule]) => rule.test(leading))?.[1];
  if (landmark === "port" || landmark === "bridge" || landmark === "waterfall") {
    const material = !explicit || ["water", "ice", "shallows"].includes(explicit.material) ? "plains" : explicit.material === "lava" ? "volcanic" : explicit.material;
    return { ground: landmark === "waterfall" ? "h" : "p", material, radius: 4,
      water: explicit?.water === "lava" ? "lava" : explicit?.water === "ice" ? "ice" : landmark === "bridge" ? "river" : "coast" };
  }
  if (explicit) {
    if (landmark && landmark !== "volcano") {
      // A settlement/entrance has a dry footprint even on a lake shore;
      // named surrounding terrain remains visible outside that footprint.
      return { ...explicit, ground: explicit.ground === "w" ? "p" : explicit.ground, radius: Math.max(4, explicit.radius) };
    }
    return explicit;
  }
  if (!landmark || landmark === "portal") return null;
  if (["cave", "mine", "dwarvenHold"].includes(landmark)) return { ground: "h", material: "hills", radius: 3 };
  if (["castle", "ruinedCastle", "watchtower", "wizardTower"].includes(landmark)) return { ground: "h", material: "hills", radius: 3 };
  return { ground: "p", material: "plains", radius: 2.5 };
}

// Native sprite-sheet coordinates. No generated artwork is duplicated to
// pad the asset count; the two sheets contain 24 different miniatures.
export function landmarkSprite(asset: LandmarkAsset) {
  const [sheet, cell] = LANDMARK_ASSETS[asset];
  return { backgroundImage: `url('${LANDMARK_SHEETS[sheet]}')`, backgroundSize: "400% 300%", backgroundPosition: `${cell % 4 / 3 * 100}% ${Math.floor(cell / 4) / 2 * 100}%` };
}

// A scoped, deterministic cartographic projection, not a rules-engine
// mutation. Rebuild only from locations this viewer is allowed to know.
// Stored anchors never move when a party/quest changes or a place is added.
export function atlasTerrain(map: { seed: number; width: number; height: number; terrain: string }, places: Array<Place & { id: string; anchor: XY | null }>) {
  const tiles = map.terrain.split("");
  const materials = tiles.map(tile => BIOME_MATERIALS[tile as OverworldTile] ?? "water");
  const distance = new Float64Array(tiles.length).fill(Infinity);
  const protectedCells = new Map(places.filter(place => place.anchor).map(place => [place.anchor!.y * map.width + place.anchor!.x, place.id]));
  const conflicts: string[] = [];
  for (const place of [...places].sort((a, b) => a.id.localeCompare(b.id))) {
    const env = environmentForLocation(place), at = place.anchor;
    if (!env || !at) continue;
    let shore = { x: 1, y: 0 }, nearest = Infinity;
    if (env.water === "coast") {
      for (let i = 0; i < tiles.length; i++) {
        if (map.terrain[i] !== "w") continue;
        const dx = i % map.width - at.x, dy = Math.floor(i / map.width) - at.y, d = dx * dx + dy * dy;
        if (d && d < nearest) { nearest = d; shore = { x: dx / Math.sqrt(d), y: dy / Math.sqrt(d) }; }
      }
      if (!Number.isFinite(nearest)) shore = { x: at.x < map.width / 2 ? -1 : 1, y: 0 };
    }
    const r = Math.ceil(env.radius + 1);
    for (let y = Math.max(0, at.y - r); y <= Math.min(map.height - 1, at.y + r); y++) {
      for (let x = Math.max(0, at.x - r); x <= Math.min(map.width - 1, at.x + r); x++) {
        const dx = x - at.x, dy = y - at.y, index = y * map.width + x;
        if (protectedCells.has(index) && protectedCells.get(index) !== place.id) continue;
        const noise = Math.sin(x * 1.7 + y * 2.1 + map.seed % 997) * 0.1;
        const d = Math.hypot(dx, dy) / (env.radius * (1 + noise));
        if (d > 1 || d >= distance[index]) continue;
        distance[index] = d;
        let ground = env.ground, material = env.material;
        if (env.water === "lava") {
          // No blue water/snow in a volcanic zone. A volcano has a rocky
          // summit and nearby lava basin; a named lava lake has a lava core.
          const lavaLake = env.material === "lava";
          const molten = lavaLake ? d < 0.65 : Math.hypot(dx - 2, dy) < 1.6;
          ground = molten ? "h" : d < 0.28 ? env.ground : "h";
          material = molten ? "lava" : "volcanic";
        } else if (env.water === "coast") {
          const water = dx * shore.x + dy * shore.y >= 1;
          ground = water ? "w" : env.ground;
          material = water ? "shallows" : env.material;
        } else if (env.water === "river") {
          ground = Math.abs(dx) <= 1 && !(env.ground !== "w" && dx === 0 && dy === 0) ? "w" : "p";
          material = ground === "w" ? "water" : env.material;
        } else if (env.water === "lake" || env.water === "ice") {
          const drySite = env.ground !== "w" && Math.hypot(dx, dy) < 1.4;
          ground = drySite ? env.ground : "w";
          material = drySite ? "plains" : env.water === "ice" ? "ice" : env.material;
        }
        tiles[index] = ground; materials[index] = material;
      }
    }
  }
  for (const place of places) {
    const env = environmentForLocation(place), at = place.anchor;
    if (!env || !at) continue;
    const neighbours = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ x: at.x + dx, y: at.y + dy })))
      .filter(p => p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height);
    if (env.water === "coast" && !neighbours.some(p => tiles[p.y * map.width + p.x] === "w")) conflicts.push(place.id);
    if (places.some(other => other.id !== place.id && other.anchor?.x === at.x && other.anchor?.y === at.y &&
      environmentForLocation(other)?.material !== env.material)) conflicts.push(place.id);
  }
  return { terrain: tiles.join(""), materialGrid: materials.map(material => String.fromCharCode(97 + MATERIAL_NAMES.indexOf(material))).join(""), conflicts: [...new Set(conflicts)] };
}
