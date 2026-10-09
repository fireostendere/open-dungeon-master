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

// Places inside a settlement: its streets, squares, markets, inns, shops,
// workshops and homes. They show the town's miniature and stand on its
// ground, never on the wild region's forest. "площадь", not "площадка";
// no bare "дом", which also names a forester's hut.
const URBAN = /улиц|переул|проспект|бульвар|площад(?!к)|квартал|слобод|предмест|рын(?:ок|к)|рыночн|базар|ярмарк|лавк|магазин|мастерск|кузниц|таверн|трактир|корчм|кабак|харчевн|постоял|гостиниц|пивн|квартир|особняк|ратуш|казарм|гильди|склад|набережн|городск|канализац|трущоб|\b(?:street|alley|avenue|boulevard|square|plaza|market|bazaar|district|quarter|ward|tavern|inn|pub|alehouse|shop|store|emporium|workshop|smithy|guild(?:hall)?|warehouse|town hall|city hall|barracks|sewers?|slums|apartment|townhouse|mansion)\b/iu;

// Rooms and parts of a building or a dungeon (a throne room, a cellar, a
// gallery): they stand beside the place they open from and take its ground.
const INTERIOR = /(?:^|\s)зал(?:а|е|ы|ов)?(?:\s|$)|комнат|коридор|подвал|погреб|чердак|кухн|спальн|кабинет|(?:^|\s)поко(?:и|ев|ях)|(?:^|\s)кель[яиюе]|сокровищниц|оружейн|тронн|лестниц|галере[яиюе]|прихож|гостин(?:ая|ой|ую)|опочивальн|кладов(?:ая|ой|ую)|\b(?:hall|room|chamber|corridor|cellar|basement|attic|kitchen|bedroom|study|armou?ry|treasury|vault|cell|gallery|courtyard|stair(?:s|case|well)?|foyer|parlou?r|pantry)\b/iu;

// Specific names win over generic types, and the head of a name (its first
// words, before "у", "возле", a dash or a comma) wins over the rest: «Лавка
// у кладбища» is a shop, «Подвал замка» a room, «Лес у деревни» a forest. An
// incidental forest in a town's description must not change its symbol.
// Unknown names keep a neutral pin. Russian stems carry their own word edges
// ((?:^|\s)…): \b only knows Latin letters.
const LANDMARK_RULES: Array<[LandmarkAsset, RegExp]> = [
  ["ruinedCastle", /(?:руин|разрушенн|заброшенн|abandoned|ruined).*(?:зам|крепост|форт|castle|keep|fort)|(?:зам|крепост|castle|keep|fort).*(?:руин|разрушенн|ruin)/iu],
  ["wizardTower", /(?:башн|tower).*(?:маг(?!аз)|волшеб|чароде|колдун|некромант|wizard|mage|sorcer|necromanc)|(?:маг(?!аз)|волшеб|чароде|колдун|некромант|wizard|mage|sorcer|necromanc).*(?:башн|tower)|обсерватори|observatory/iu],
  ["dwarvenHold", /(?:дварф|дворф|гном|dwarv).*(?:город|крепост|цитадел|чертог|hold|city|fort|hall)|(?:город|крепост|чертог|city|hold|hall).*(?:дварф|гном|dwarv)/iu],
  ["elvenCity", /(?:эльф|elven).*(?:город|city|поселен|чертог)|(?:город|city).*(?:эльф|elves)/iu],
];
// The pair rules above read the whole name; these read its head first.
const PAIR_RULES = LANDMARK_RULES.length;
LANDMARK_RULES.push(
  ["portal", /портал|телепорт|portal|teleport/iu], ["volcano", /вулкан(?:\s|$|[.!?,])|\bvolcano\b/iu],
  ["waterfall", /водопад|каскад|waterfall|cascade/iu],
  ["bridge", /(?:^|\s)мост|переправ|\b(?:bridge|crossing)\b/iu],
  ["port", /пристан|гаван|(?:^|\s)порт(?:\s|$)|причал|верф|(?:^|\s)доки(?:\s|$)|\b(?:port|harbou?r|wharf|docks?|pier|shipyard)\b/iu],
  ["mine", /шахт|рудник|(?:^|\s)копи(?:\s|$)|карьер|прииск|\b(?:mine|quarry)\b/iu],
  ["cave", /пещер|грот|логов|берлог|\b(?:cavern|caverns|cave|caves|grotto|lair|den)\b/iu],
  ["dungeon", /подземел|катакомб|лабиринт|темниц|каземат|\b(?:dungeon|catacombs?|labyrinth|maze|undercroft)\b/iu],
  ["graveyard", /кладбищ|гробниц|склеп|погост|некропол|мавзоле|курган|могильник|усыпальниц|graveyard|cemetery|\b(?:tombs?|crypts?|necropolis|mausoleum|barrow|ossuary)\b/iu],
  ["pyramid", /пирамид|зиккурат|pyramid|ziggurat/iu], ["ruins", /руин|развалин|ruins?/iu],
  ["castle", /замок|крепост|цитадел|твердын|(?:^|\s)форт(?:\s|$|[.,!?])|острог|бастион|редут|донжон|гарнизон|\b(?:castle|fort|fortress|keep|citadel|stronghold|bastion|redoubt|garrison)\b/iu],
  ["watchtower", /башн|маяк|вышк|дозорн|застав|кордон|аванпост|блокпост|сторожев|tower|lighthouse|\b(?:outposts?|watch ?posts?|checkpoint)\b/iu],
  ["monastery", /монастыр|обител|аббатств|(?:^|\s)скит(?:\s|$)|приорат|monastery|abbey|priory|cloister|convent|hermitage/iu],
  ["shrine", /святилищ|часовн|алтар|капищ|менгир|мегалит|дольмен|кромлех|каменн\S* круг|(?:^|\s)идол|обелиск|священн\S* (?:рощ|дуб|древ|камен|источник|родник)|shrine|chapel|altar|stone circle|standing stones?|menhir|dolmen|obelisk|\bidol\b/iu],
  ["temple", /храм|собор|церк|костёл|костел|мечет|пагод|temple|cathedral|church|basilica|pagoda|mosque/iu],
  ["camp", /лагер|стоянк|бивак|бивуак|табор|привал|(?:^|\s)стан(?:\s|$)|\b(?:camp|encampment|bivouac|campsite)\b/iu],
  ["village", /деревн|село(?:\s|$)|сельц|хутор|ферм|мельниц|усадьб|станиц|выселк|заимк|хижин|избушк|поселени|village|hamlet|\b(?:farm|farmstead|homestead|mill|cottage|hut|settlement)\b/iu],
  ["town", /городок|пос[её]лок|местечк|\b(?:town|borough)\b/iu],
  // "городская стража" is a street-level place, not a whole city.
  ["city", /город(?!ск)|столиц|\b(?:city|capital|metropolis)\b/iu], ["town", URBAN],
);

// The first words of a name, before a dash, a comma, a quoted name or a
// "near/under/behind" phrase: the noun that says what the place is.
const nameHead = (name: string) => name.split(/[—–,«"(]|\s-\s|\s(?:у|возле|около|близ|под|над|за|beside|near|by|under|below|above|behind)\s/iu)[0].trim().split(/\s+/).slice(0, 3).join(" ");
const placeType = (place: Place) => place.layoutDescription?.match(/^(?:Тип места|Place type):\s*([^.!?]+)/iu)?.[1];

function landmarkRule(place: Place): [LandmarkAsset, RegExp] | null {
  const explicit = placeType(place);
  if (explicit) return LANDMARK_RULES.find(([, rule]) => rule.test(explicit)) ?? null;
  const pair = LANDMARK_RULES.slice(0, PAIR_RULES).find(([, rule]) => rule.test(place.name));
  if (pair) return pair;
  const head = nameHead(place.name);
  const headed = LANDMARK_RULES.find(([, rule]) => rule.test(head));
  if (headed) return headed;
  // A room, or a natural place named for its neighbour, is not that neighbour.
  if (INTERIOR.test(head) || ENVIRONMENT_RULES.some(([rule]) => rule.test(head))) return null;
  const named = LANDMARK_RULES.find(([, rule]) => rule.test(place.name));
  if (named) return named;
  const opening = (place.layoutDescription ?? "").split(/[.!?;,]|\s(?:у|возле|около|beside|near|by)\s/iu)[0].trim();
  // Only an explicit leading type identifies a place with a proper name.
  const leading = opening.replace(/^(?:это\s+|an?\s+|the\s+)/iu, "").split(/\s+/).slice(0, 3).join(" ");
  return LANDMARK_RULES.find(([, rule]) => rule.test(leading)) ?? null;
}

export function landmarkForLocation(place: Place): LandmarkAsset | null {
  return landmarkRule(place)?.[0] ?? null;
}

// A street, square, inn or home inside a settlement (not the settlement as a
// whole): it clusters with its neighbours and shares one town footprint.
export function urbanPlace(place: Place): boolean {
  return landmarkRule(place)?.[1] === URBAN;
}

// A room or a part of a building: no miniature and no ground of its own.
export function interiorPlace(place: Place): boolean {
  const explicit = placeType(place);
  return !landmarkRule(place) && INTERIOR.test(explicit ?? nameHead(place.name));
}

export type PlaceEnvironment = { ground: OverworldTile; material: TerrainMaterial; radius: number; water?: "coast" | "lake" | "river" | "ice" | "lava" | "island" | "oasis" };
const ENVIRONMENT_RULES: Array<[RegExp, PlaceEnvironment]> = [
  [/(?:лавов|lava).*(?:озер|озёр|lake)|(?:озер|озёр|lake).*лав|озеро лавы/iu, { ground: "h", material: "lava", radius: 6, water: "lava" }],
  [/вулкан|лавов|озеро лавы|volcan|lava/iu, { ground: "m", material: "volcanic", radius: 7, water: "lava" }],
  [/ледник|ледян(?:ое|ая|ые)|зам[её]рз|glacier|frozen|ice lake/iu, { ground: "w", material: "ice", radius: 6, water: "ice" }],
  [/снеж|snow/iu, { ground: "m", material: "snow", radius: 6 }],
  // Land in water, before the lake and forest rules: «Лесной остров» is an island.
  [/(?:^|\s)остров|\b(?:island|isle|islet)\b/iu, { ground: "p", material: "plains", radius: 5, water: "island" }],
  [/пляж|\bbeach\b/iu, { ground: "p", material: "desert", radius: 5, water: "coast" }],
  [/(?:^|\s)берег|побереж|бухт|залив|лагун|фьорд|\b(?:coast|shore|bay|cove|lagoon|fjord)\b/iu, { ground: "p", material: "plains", radius: 5, water: "coast" }],
  [/оазис|oasis/iu, { ground: "p", material: "desert", radius: 6, water: "oasis" }],
  [/тундр|tundra/iu, { ground: "p", material: "tundra", radius: 7 }],
  [/пустын|дюн|пески|песчан|бархан|солончак|desert|dunes|\bsands\b|salt flats?/iu, { ground: "p", material: "desert", radius: 7 }],
  [/пустош|\b(?:wasteland|badlands?|heath|moor)\b/iu, { ground: "p", material: "tundra", radius: 6 }],
  [/каньон|ущель|canyon|gorge/iu, { ground: "h", material: "canyon", radius: 6 }],
  [/джунгл|тропическ|jungle|tropical forest/iu, { ground: "f", material: "jungle", radius: 7 }],
  [/(?:м[её]ртв|выжжен|dead|burnt).*(?:лес|рощ|forest|wood)/iu, { ground: "f", material: "deadwood", radius: 6 }],
  [/(?:зачарован|волшебн|enchanted|magical).*(?:лес|рощ|forest|wood)/iu, { ground: "f", material: "enchanted", radius: 6 }],
  [/осенн|autumn/iu, { ground: "f", material: "autumn", radius: 6 }],
  [/листвен|дубов|дубрав|бер[её]з|broadleaf|deciduous|oak grove/iu, { ground: "f", material: "broadleaf", radius: 6 }],
  [/болот|топь|топи|трясин|мангр|swamp|marsh|bog|\b(?:fen|mire|mangroves?)\b/iu, { ground: "s", material: "swamp", radius: 6 }],
  [/лес|рощ|тайг|(?:^|\s)бор(?:\s|$|[.,])|чащ|дебр|forest|woods?|grove|taiga|thicket/iu, { ground: "f", material: "forest", radius: 6 }],
  [/перевал|хребет|вершин|(?:^|\s)гор(?:а|ы|ах|ный)|скал(?:а|ы|ист)|ут[ёе]с|обрыв|кряж|(?:^|\s)пик(?:\s|$)|mountain|\bpass\b|\bpeak\b|\b(?:cliffs?|crags?|ridge|summit|highlands?)\b/iu, { ground: "m", material: "mountains", radius: 6 }],
  [/рек[аи]|river|stream/iu, { ground: "w", material: "water", radius: 5, water: "river" }],
  [/мелковод|shallows/iu, { ground: "w", material: "shallows", radius: 5, water: "lake" }],
  [/озер|озёр|lake|море|морск|океан|sea\b|ocean/iu, { ground: "w", material: "water", radius: 6, water: "lake" }],
  [/холм|плато|предгор|сопк|hill|\b(?:plateau|foothills?|downs)\b/iu, { ground: "h", material: "hills", radius: 5 }],
  [/долин|равнин|луг|степ|(?:^|\s)пол[ея](?:\s|$)|пашн|(?:^|\s)нив[аы]|прери|саванн|valley|plains?|meadow|\b(?:steppe|fields?|prairie|grassland|farmland|savann?ah?)\b/iu, { ground: "p", material: "plains", radius: 5 }],
];

// The ground of a place in town; wide enough that neighbouring streets and
// inns merge into one settlement instead of clearings in a forest.
const TOWN_GROUND: PlaceEnvironment = { ground: "p", material: "plains", radius: 4 };

// The cleared ground around a settlement or a building, sized to it, when
// nothing names the land around it.
const SITE_GROUND: Partial<Record<LandmarkAsset, PlaceEnvironment>> = {
  city: { ground: "p", material: "plains", radius: 5 }, town: { ground: "p", material: "plains", radius: 3.5 },
  elvenCity: { ground: "f", material: "enchanted", radius: 5 }, pyramid: { ground: "p", material: "desert", radius: 4 },
  camp: { ground: "p", material: "plains", radius: 2 },
  cave: { ground: "h", material: "hills", radius: 3 }, mine: { ground: "h", material: "hills", radius: 3 }, dwarvenHold: { ground: "h", material: "hills", radius: 3 },
  castle: { ground: "h", material: "hills", radius: 3 }, ruinedCastle: { ground: "h", material: "hills", radius: 3 },
  watchtower: { ground: "h", material: "hills", radius: 3 }, wizardTower: { ground: "h", material: "hills", radius: 3 },
};

export function environmentForLocation(place: Place): PlaceEnvironment | null {
  const landmark = landmarkForLocation(place);
  const urban = urbanPlace(place);
  const head = nameHead(place.name);
  const nameRule = ENVIRONMENT_RULES.find(([rule]) => rule.test(head)) ?? ENVIRONMENT_RULES.find(([rule]) => rule.test(place.name));
  const leading = (place.layoutDescription ?? "").split(/[.!?;]/u).slice(0, 2).join(". ");
  const specified = place.layoutDescription?.match(/(?:^|[.!?])\s*(?:Окружение|Environment):\s*([^.!?]+)/iu)?.[1];
  // In town and indoors only a stated environment counts: «Лесная улица» is a
  // street name, and a street's description that mentions the forest beyond
  // the walls does not move the street into it.
  const indoors = urban || interiorPlace(place);
  const explicit = (specified ? ENVIRONMENT_RULES.find(([rule]) => rule.test(specified))?.[1] : undefined)
    ?? (indoors ? undefined : nameRule?.[1] ?? ENVIRONMENT_RULES.find(([rule]) => rule.test(leading))?.[1]);
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
  if (urban) return TOWN_GROUND;
  return SITE_GROUND[landmark] ?? { ground: "p", material: "plains", radius: 2.5 };
}

// Native sprite-sheet coordinates. No generated artwork is duplicated to
// pad the asset count; the two sheets contain 24 different miniatures.
export function landmarkSprite(asset: LandmarkAsset) {
  const [sheet, cell] = LANDMARK_ASSETS[asset];
  return { backgroundImage: `url('${LANDMARK_SHEETS[sheet]}')`, backgroundSize: "400% 300%", backgroundPosition: `${cell % 4 / 3 * 100}% ${Math.floor(cell / 4) / 2 * 100}%` };
}

// The terrain each place asks for. A room takes the ground of the place it
// opens from (a castle's throne room stands on the castle's hill). A place
// with no type of its own that connects straight to a place in town (an inn
// named for its owner, off the main square) stands in that town too. One hop
// only, so a road out of town keeps the region's own ground; it takes the
// ground, never the miniature.
export function placeEnvironments(places: Array<Place & { id: string; connections?: string[] }>): Map<string, PlaceEnvironment | null> {
  const key = (name: string) => name.trim().toLowerCase();
  const own = new Map(places.map((place) => [place.id, environmentForLocation(place)]));
  const town = places.filter(urbanPlace);
  const townNames = new Set(town.map((place) => key(place.name)));
  const linkedFromTown = new Set(town.flatMap((place) => (place.connections ?? []).map(key)));
  const neighbours = (place: Place & { connections?: string[] }) => {
    const links = new Set((place.connections ?? []).map(key));
    return places.filter((other) => links.has(key(other.name)) || (other.connections ?? []).some((name) => key(name) === key(place.name)));
  };
  return new Map(places.map((place) => {
    const env = own.get(place.id) ?? null;
    if (env || landmarkForLocation(place)) return [place.id, env];
    if (interiorPlace(place)) {
      const parent = neighbours(place).find((other) => own.get(other.id));
      if (parent) return [place.id, own.get(parent.id)!];
    }
    const beside = linkedFromTown.has(key(place.name)) || (place.connections ?? []).some((name) => townNames.has(key(name)));
    return [place.id, beside ? TOWN_GROUND : null];
  }));
}

// Places in town that stand near each other are one settlement on the map:
// each group of two or more (every member within reach of another) gets one
// large miniature under its pins, centred on the group and sized to cover it.
export function atlasTowns(places: Array<Place & { id: string; anchor: XY | null; connections?: string[] }>): Array<{ ids: string[]; x: number; y: number; size: number }> {
  const environments = placeEnvironments(places);
  const town = places.filter((place): place is typeof place & { anchor: XY } => Boolean(place.anchor) && environments.get(place.id) === TOWN_GROUND);
  const groups: Array<typeof town> = [];
  for (const place of town) {
    const joined = groups.filter((group) => group.some((other) => Math.hypot(other.anchor.x - place.anchor.x, other.anchor.y - place.anchor.y) <= 8));
    const merged = [place, ...joined.flat()];
    for (const group of joined) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.filter((group) => group.length > 1).map((group) => {
    const xs = group.map((place) => place.anchor.x), ys = group.map((place) => place.anchor.y);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return {
      ids: group.map((place) => place.id).sort(),
      x: xs.reduce((sum, x) => sum + x, 0) / group.length,
      y: ys.reduce((sum, y) => sum + y, 0) / group.length,
      size: Math.min(16, Math.max(7, extent + 5)),
    };
  });
}

// How many tiles a place's miniature covers on the map: a city spreads, a
// shrine is a speck. Crowded places shrink to about one and a half times the
// distance to their nearest neighbour, never below three tiles.
const ART_TILES: Record<LandmarkAsset, number> = {
  city: 6.5, elvenCity: 6.5, dwarvenHold: 5.5, volcano: 5.5, town: 5, castle: 5, ruinedCastle: 5, port: 5, pyramid: 5,
  monastery: 4.5, temple: 4.5, village: 4, wizardTower: 4, ruins: 4, waterfall: 4,
  watchtower: 3.5, graveyard: 3.5, shrine: 3.5, camp: 3.5, cave: 3.5, mine: 3.5, dungeon: 3.5, bridge: 3.5, portal: 3.5,
};

export type AtlasArt = { key: string; asset: LandmarkAsset; ids: string[]; x: number; y: number; size: number; visited: boolean };

// Every typed place drawn on the map as its miniature, under its pin: the
// map shows the villages, towns, outposts and temples the heroes found. A
// town's streets and inns share one settlement miniature. Sorted top to
// bottom so nearer miniatures overlap farther ones.
export function atlasArt(places: Array<Place & { id: string; anchor: XY | null; connections?: string[]; visited?: boolean }>): AtlasArt[] {
  const visited = (ids: string[]) => ids.some((id) => places.find((place) => place.id === id)?.visited !== false);
  const towns = atlasTowns(places);
  const grouped = new Set(towns.flatMap((town) => town.ids));
  const art: AtlasArt[] = towns.map((town) => ({ key: `town:${town.ids.join(",")}`, asset: town.ids.length >= 5 ? "city" : "town",
    ids: town.ids, x: town.x, y: town.y, size: town.size, visited: visited(town.ids) }));
  const anchors = places.flatMap((place) => place.anchor ? [{ id: place.id, ...place.anchor }] : []);
  for (const place of places) {
    const asset = place.anchor && !grouped.has(place.id) ? landmarkForLocation(place) : null;
    if (!asset || !place.anchor) continue;
    const { x, y } = place.anchor;
    const nearest = Math.min(Infinity, ...anchors.filter((other) => other.id !== place.id).map((other) => Math.hypot(other.x - x, other.y - y)));
    const size = Math.min(urbanPlace(place) ? 4 : ART_TILES[asset], Math.max(3, nearest * 1.5));
    art.push({ key: place.id, asset, ids: [place.id], x, y, size, visited: visited([place.id]) });
  }
  return art.sort((a, b) => a.y - b.y || a.x - b.x);
}

// A scoped, deterministic cartographic projection, not a rules-engine
// mutation. Rebuild only from locations this viewer is allowed to know.
// Stored anchors never move when a party/quest changes or a place is added.
export function atlasTerrain(map: { seed: number; width: number; height: number; terrain: string }, places: Array<Place & { id: string; anchor: XY | null; connections?: string[] }>) {
  const tiles = map.terrain.split("");
  const materials = tiles.map(tile => BIOME_MATERIALS[tile as OverworldTile] ?? "water");
  const distance = new Float64Array(tiles.length).fill(Infinity);
  const protectedCells = new Map(places.filter(place => place.anchor).map(place => [place.anchor!.y * map.width + place.anchor!.x, place.id]));
  const conflicts: string[] = [];
  const environments = placeEnvironments(places);
  for (const place of [...places].sort((a, b) => a.id.localeCompare(b.id))) {
    const env = environments.get(place.id), at = place.anchor;
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
        } else if (env.water === "island") {
          // Dry land in the middle, open water all round it.
          const dry = d < 0.6;
          ground = dry ? env.ground : "w";
          material = dry ? env.material : "water";
        } else if (env.water === "oasis") {
          // A pool, a ring of palms, then the desert.
          ground = d < 0.22 ? "w" : d < 0.45 ? "f" : env.ground;
          material = d < 0.22 ? "shallows" : d < 0.45 ? "jungle" : env.material;
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
    const env = environments.get(place.id), at = place.anchor;
    if (!env || !at) continue;
    const neighbours = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ x: at.x + dx, y: at.y + dy })))
      .filter(p => p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height);
    if (env.water === "coast" && !neighbours.some(p => tiles[p.y * map.width + p.x] === "w")) conflicts.push(place.id);
    if (places.some(other => other.id !== place.id && other.anchor?.x === at.x && other.anchor?.y === at.y &&
      environments.get(other.id)?.material !== env.material)) conflicts.push(place.id);
  }
  return { terrain: tiles.join(""), materialGrid: materials.map(material => String.fromCharCode(97 + MATERIAL_NAMES.indexOf(material))).join(""), conflicts: [...new Set(conflicts)] };
}
