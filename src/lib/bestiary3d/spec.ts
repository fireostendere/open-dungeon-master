// Turns a monster's stat-block basics (name, type, size, speeds) into a
// CreatureSpec: which body plan to build, which features it gets, and what
// it is made of and coloured like. Pure data in, pure data out: no three.js
// here, so it runs in node tests and the model builder stays a dumb renderer.
//
// The matching is deliberately layered:
//   1. name rules pick a family ("wolf" -> canine quadruped, "lich" -> robed
//      skeleton) and set traits,
//   2. the creature type is the fallback ("aberration" with no known name
//      gets a seeded tentacle/eye/blob body),
//   3. speeds patch in what the name did not say (a fly speed grows wings).
// Everything random is seeded from the creature's name.

import { between, chance, hashString, makeRng, pick, type Rng } from "./rng";

export const CREATURE_TYPES = [
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey",
  "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead", "swarm",
] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan", "titanic"] as const;
export type SizeKey = (typeof SIZES)[number];

// Uniform scale applied to a model built at "medium" proportions.
export const SIZE_FACTOR: Record<SizeKey, number> = {
  tiny: 0.25, small: 0.55, medium: 1, large: 1.75, huge: 2.9, gargantuan: 4.8, titanic: 7,
};
// Battle-grid squares (5 ft) a creature of that size covers on one side.
export const SIZE_CELLS: Record<SizeKey, number> = {
  tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4, titanic: 6,
};

export const PLANS = [
  "biped", "quadruped", "theropod", "dragon", "serpent", "avian", "hexapod", "octopod",
  "fish", "blob", "spirit", "orb", "tentacled", "swarm", "taur", "cube", "vortex", "fungus", "object",
] as const;
export type Plan = (typeof PLANS)[number];

export type Look =
  | "hide" | "fur" | "scale" | "skin" | "bone" | "flesh" | "metal" | "stone" | "bark"
  | "slime" | "ghost" | "flame" | "ice" | "chitin" | "crystal" | "feather";

export interface Palette {
  skin: string;
  belly: string;
  cloth: string;
  accent: string;
  eye: string;
  glow: string;
}

export interface Traits {
  wings: "none" | "feather" | "membrane" | "insect" | "flame";
  horns: "none" | "curved" | "straight" | "antlers" | "bull" | "ram";
  tail: "none" | "short" | "long" | "fluffy" | "scorpion" | "club";
  head: "humanoid" | "beast" | "frog" | "skull" | "bird" | "insect" | "fish";
  snout: number;
  ears: "none" | "pointy" | "round" | "long";
  eyes: 1 | 2 | 3;
  heads: number;
  arms: number;
  beak: boolean;
  tusks: boolean;
  mane: boolean;
  trunk: boolean;
  spikes: boolean;
  shell: boolean;
  frill: boolean;
  plates: boolean;
  flippers: boolean;
  fins: boolean;
  beard: boolean;
  hooves: boolean;
  faceTentacles: boolean;
  glowEyes: boolean;
  skeletal: boolean;
  zombie: boolean;
  bandages: boolean;
  juvenile: boolean;
  longNeck: boolean;
  segLegs: boolean;
  crown: "none" | "flames" | "halo" | "hat" | "helm" | "crown" | "hood" | "spikes";
  weapon: "none" | "sword" | "axe" | "club" | "staff" | "spear" | "bow" | "dagger";
  shield: boolean;
  robe: boolean;
  armor: boolean;
  cape: boolean;
  stance: "upright" | "hunched" | "brute" | "lanky" | "stout";
  legs: 2 | 4;
  eyestalks: number;
  lower: "horse" | "snake" | "spider" | "fish" | "lion";
  shape: "sword" | "rug" | "book" | "chest" | "armor" | "generic";
  aura: "none" | "embers" | "frost" | "smoke" | "sparks" | "motes" | "spores";
  swarmKind: "bat" | "bird" | "insect" | "rat" | "fish" | "snake" | "generic";
  bulk: number; // 0.8 lean .. 1.3 heavy
}

export interface CreatureInput {
  slug: string;
  name: string;
  type: string;
  size: string;
  subtype?: string;
  group?: string;
  speed?: Record<string, unknown> | null;
}

export interface CreatureSpec {
  slug: string;
  name: string;
  type: CreatureType;
  size: SizeKey;
  sizeFactor: number;
  footprintCells: number;
  plan: Plan;
  look: Look;
  palette: Palette;
  traits: Traits;
  seed: number;
  // Which rule family decided the plan: "name" when a keyword matched, or
  // "type" when only the creature type did. Used to measure rule coverage.
  matchedBy: "name" | "type";
}

// ---------------------------------------------------------------------------
// small helpers

export function normalizeSize(raw: unknown): SizeKey {
  const key = String(raw ?? "").trim().toLowerCase();
  return (SIZES as readonly string[]).includes(key) ? (key as SizeKey) : "medium";
}

export function normalizeCreatureType(raw: unknown): CreatureType {
  const key = String(raw ?? "").trim().toLowerCase();
  return (CREATURE_TYPES as readonly string[]).includes(key) ? (key as CreatureType) : "monstrosity";
}

function speedOf(speed: CreatureInput["speed"], key: string): number {
  const raw = speed?.[key];
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) ? value : 0;
}

function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function defaultTraits(): Traits {
  return {
    wings: "none", horns: "none", tail: "none", head: "beast", snout: 0.4, ears: "none",
    eyes: 2, heads: 1, arms: 2, beak: false, tusks: false, mane: false, trunk: false,
    spikes: false, shell: false, frill: false, plates: false, flippers: false, fins: false,
    beard: false, hooves: false, faceTentacles: false, glowEyes: false, skeletal: false,
    zombie: false, bandages: false, juvenile: false, longNeck: false, segLegs: false,
    crown: "none", weapon: "none", shield: false, robe: false, armor: false, cape: false,
    stance: "upright", legs: 4, eyestalks: 0, lower: "horse", shape: "generic",
    aura: "none", swarmKind: "generic", bulk: 1,
  };
}

// ---------------------------------------------------------------------------
// name rules

interface Family {
  re: RegExp;
  plan: Plan;
  set?: Partial<Traits>;
  look?: Look;
}

const has = (re: RegExp, name: string) => re.test(name);

// Order matters: the first family whose pattern matches wins. Specific
// hybrids ("owlbear", "dragon turtle") sit above the animals they contain.
const FAMILIES: Family[] = [
  // Reviewed models use the anatomy and gear of their source, before loose keywords.
  { re: /^a-mi-?kuk$/, plan: "biped", look: "hide", set: { head: "humanoid", snout: 0, arms: 2, weapon: "none", stance: "hunched" } },
  { re: /^kobold$/, plan: "biped", look: "scale", set: { head: "beast", snout: 0.6, tail: "long", ears: "none", stance: "hunched", weapon: "dagger", horns: "straight" } },
  { re: /^planetar$/, plan: "biped", look: "skin", set: { head: "humanoid", snout: 0, wings: "feather", weapon: "sword", glowEyes: true, aura: "motes" } },
  { re: /medusa/, plan: "biped", look: "skin", set: { head: "humanoid", snout: 0, weapon: "bow", wings: "none", tail: "none" } },
  { re: /nothic/, plan: "biped", look: "skin", set: { head: "humanoid", eyes: 1, stance: "hunched", weapon: "none" } },
  // --- swarms
  { re: /swarm|\bhorde of\b|\bflock of\b|\bmurder of\b|\bpack of\b/, plan: "swarm" },
  { re: /naga|nagas/, plan: "taur", look: "scale", set: { lower: "snake", head: "beast", snout: 0.3, frill: true, arms: 2 } },

  // --- dragons and their kin
  { re: /dragonborn|drakkin/, plan: "biped", look: "scale", set: { head: "beast", snout: 0.55, horns: "straight", tail: "short", ears: "none", armor: true, weapon: "sword" } },
  { re: /dragonfly|dawnfly|firefly/, plan: "hexapod", look: "chitin", set: { wings: "insect" } },
  { re: /dragon turtle/, plan: "dragon", set: { shell: true, legs: 4, wings: "none", flippers: true } },
  { re: /wyvern|amphiptere/, plan: "dragon", set: { legs: 2, wings: "membrane", tail: "scorpion" } },
  { re: /pseudodragon|dragonette|faerie dragon|dragonleaf/, plan: "dragon", set: { juvenile: true, wings: "membrane" } },
  { re: /dragon|drake\b|drakes\b|wyrm\b|wyrmling|dracolich|drakon|zmey|hraesvelgr|firewyrm|dragonnel/, plan: "dragon", set: { wings: "membrane", legs: 4 } },

  // --- spirits and things that float
  { re: /ghost|specter|spectre|wraith|banshee|phantom|poltergeist|apparition|haunt\b|shade\b|spirit|edimmu|\bshadows?\b(?! (demon|dragon|mastiff|fey|giant|goblin))|umbral|shroud|\bfear\b|vengeful/, plan: "spirit", look: "ghost", set: { aura: "motes" } },
  { re: /will-o|wisp|flameskull|deathwisp|(?<!giant, )lantern(?! ?(beetle|fly|moth|fish|shark|eel|crab|bug))|firegeist|spark\b|mote\b|orb\b|beholder|gauth|spectator|death tyrant|evil eye|floating eye|eye of|watcher|gazer|observer|eyebite/, plan: "orb" },
  { re: /djinni|djinn|efreeti|efreet|ifrit|marid|dao\b|genie|jann/, plan: "spirit", look: "skin", set: { arms: 2, crown: "crown", horns: "curved" } },
  { re: /air elemental|dust devil|whirlwind|tornado|cyclone|vapor|steam\b|wind\b|storm\b(?! giant)/, plan: "vortex", look: "ghost" },

  // --- animated things and constructs with their own shape
  { re: /gelatinous cube|\bcube\b|mimic|treasure chest|\bchest\b/, plan: "cube" },
  { re: /flying sword|animated sword|\bsword\b/, plan: "object", set: { shape: "sword" }, look: "metal" },
  { re: /rug of|smothering|carpet/, plan: "object", set: { shape: "rug" }, look: "hide" },
  { re: /\bbook\b|tome\b|grimoire|paper\b/, plan: "object", set: { shape: "book" }, look: "hide" },
  { re: /animated armor|armor\b|hollow|suit of/, plan: "object", set: { shape: "armor" }, look: "metal" },

  // --- aquatic and tentacled
  { re: /aboleth|kraken|octopus|squid|roper|otyugh|grick|grell|nautiloid|elder brain|star spawn|shoggoth|neh-thalggu|cloaker|darkmantle|tentacle|nihilethic/, plan: "tentacled" },
  { re: /crab|lobster|crayfish|crawfish|chuul|reefclaw|shrimp/, plan: "octopod", look: "chitin" },
  { re: /shark(?! bowl)|piranha|quipper|\bray\b|manta|seahorse|sea horse|hippocamp|whale|orca|dolphin|megalodon|lamprey|angler|\bfish\b|\bsalmon\b|barracuda|marlin|swordfish/, plan: "fish", look: "scale", set: { fins: true } },
  { re: /merfolk|merrow|sahuagin|triton|kuo-toa|deep one|locathah|aboleth spawn|sea elf|sea hag|ixitxachitl/, plan: "biped", look: "scale", set: { head: "fish", fins: true, tail: "long", stance: "hunched", weapon: "spear" } },

  // --- snakes and worms
  { re: /couatl|amphisbaena|feathered serpent|quetzal/, plan: "serpent", look: "feather", set: { wings: "feather" } },
  { re: /snake|serpent|cobra|viper|python|constrictor|\basp\b|adder|anaconda|mamba|rattlesnake|\bboa\b|basilisk viper/, plan: "serpent", look: "scale" },
  { re: /worm|carrion crawler|remorhaz|ankheg|behir|leech|\beel\b|eels\b|centipede|millipede|caterpillar|larva|maggot|slug\b|\bslugs\b/, plan: "serpent", set: { segLegs: true } },

  // --- insects and spiders
  { re: /tosculi|myrmex|roachling|gerridae/, plan: "biped", look: "chitin", set: { head: "insect", wings: "insect", arms: 2, weapon: "spear" } },
  { re: /drider|arachnaean|lunarchidna/, plan: "taur", look: "chitin", set: { lower: "spider", head: "humanoid" } },
  { re: /spider|scorpion|\btick\b|\bmite\b|arachnid|ettercap|chelicerae|harvestman|widow\b|tarantula/, plan: "octopod", look: "chitin" },
  { re: /\bants?\b|beetle|wasp|\bbees?\b|\bfly\b|\bflies\b|mosquito|mantis|scarab|locust|cricket|grasshopper|\bmoths?\b|butterfl|cockroach|\broach\b|termite|\bbugs?\b|insect|weevil|hornet|louse|aphid|stirge|\bflea\b|intellect devourer|hoverfly|aphid|tsetse|katydid|mayfly/, plan: "hexapod", look: "chitin" },

  // --- plants and fungi
  { re: /myconid|mushroom|fungus|fungi|shrieker|toadstool|deathcap|spore|\bmold\b|puffball/, plan: "fungus", look: "flesh" },
  { re: /shambling mound|mound\b|assassin vine|\bvine\b|vines\b|bramble|briar|creeper|\bmoss\b|shrub|carnivorous plant|duskthorn|venus|hedge|topiary|thornbush|cactid|cactus|dragonleaf|pitcher/, plan: "blob", look: "bark", set: { spikes: true, aura: "spores" } },

  // --- oozes and blobs
  { re: /ooze|slime|jelly|pudding|gelatinous|sludge|gibbering mouther|\bblob\b|\btar\b|offal|flab|lurker|jelly/, plan: "blob", look: "slime" },

  // --- flying beasts and hybrids
  { re: /owlbear/, plan: "quadruped", look: "fur", set: { head: "beast", snout: 0.3, beak: true, ears: "round", bulk: 1.3, tail: "none", wings: "none" } },
  { re: /griffon|griffin|gryphon/, plan: "quadruped", look: "feather", set: { beak: true, wings: "feather", tail: "long", ears: "pointy", snout: 0.2, hooves: false } },
  { re: /hippogriff/, plan: "quadruped", look: "feather", set: { beak: true, wings: "feather", tail: "fluffy", ears: "pointy", snout: 0.2, longNeck: true } },
  { re: /peryton/, plan: "quadruped", look: "feather", set: { horns: "antlers", wings: "feather", tail: "short", snout: 0.5, longNeck: true } },
  { re: /hydra/, plan: "quadruped", look: "scale", set: { heads: 5, longNeck: true, tail: "long", snout: 0.5, ears: "none", bulk: 1.25 } },
  { re: /cerberus|orthrus|kerberos/, plan: "quadruped", look: "fur", set: { heads: 3, snout: 0.7, ears: "pointy", tail: "long", aura: "embers", bulk: 1.15 } },
  { re: /chimera/, plan: "quadruped", look: "scale", set: { heads: 3, wings: "membrane", horns: "ram", tail: "long", snout: 0.4, mane: true } },
  { re: /manticore/, plan: "quadruped", look: "fur", set: { head: "humanoid", mane: true, wings: "membrane", tail: "scorpion", snout: 0.1, ears: "pointy" } },
  { re: /sphinx/, plan: "quadruped", look: "fur", set: { head: "humanoid", mane: true, wings: "feather", tail: "long", snout: 0.1 } },
  { re: /^nightmare$/, plan: "quadruped", look: "fur", set: { snout: 0.8, ears: "pointy", tail: "fluffy", longNeck: true, hooves: true, mane: true, aura: "embers" } },
  { re: /displacer|blink dog|hell ?hound|barghest|worg|warg|winter wolf|dire wolf|phase/, plan: "quadruped", look: "fur", set: { snout: 0.7, ears: "pointy", tail: "long", aura: "embers" } },
  { re: /pegasus/, plan: "quadruped", look: "fur", set: { snout: 0.8, ears: "pointy", wings: "feather", tail: "fluffy", longNeck: true, hooves: true, mane: true } },
  { re: /unicorn|ki-rin|kirin|buraq/, plan: "quadruped", look: "fur", set: { snout: 0.8, ears: "pointy", horns: "straight", tail: "fluffy", longNeck: true, hooves: true, mane: true } },
  { re: /tarrasque/, plan: "quadruped", look: "scale", set: { horns: "curved", tail: "long", snout: 0.4, ears: "none", spikes: true, plates: true, bulk: 1.35 } },
  { re: /bulette|armadillo|dogmole|land shark|ankylosaurus/, plan: "quadruped", look: "scale", set: { shell: true, snout: 0.5, ears: "none", tail: "club" } },
  { re: /gorgon|\bbull\b|\box\b|aurochs|\byak\b|bison|buffalo|\bcow\b|minotaur lizard|carnivorous ox/, plan: "quadruped", look: "fur", set: { horns: "bull", snout: 0.45, ears: "round", tail: "short", hooves: true, bulk: 1.2 } },

  // --- birds and bats
  { re: /kenku|aarakocra|ravenfolk|harpy|gullkin|cikavak|avestruzii/, plan: "biped", look: "feather", set: { head: "bird", beak: true, wings: "feather", stance: "lanky", weapon: "spear" } },
  { re: /\bbats?\b|pteranodon|quetzalcoatlus|pterodactyl|darkling wing/, plan: "avian", look: "fur", set: { wings: "membrane", beak: false, snout: 0.3, ears: "long" } },
  { re: /eagle|hawk|owl\b|owls\b|\bravens?\b|\bcrows?\b|vulture|falcon|\broc\b|swan|parrot|pigeon|stork|heron|\bduck\b|\bgeese\b|\bgoose\b|chicken|rooster|phoenix|firebird|thunderbird|cockatrice|ostrich|\bemu\b|axe beak|archaeopteryx|terror bird|\bbird\b|cormorant|pelican|seagull|gull\b|albatross|kiwi|dodo/, plan: "avian", look: "feather", set: { beak: true, wings: "feather", tail: "short" } },

  // --- dinosaurs and reptiles
  { re: /tyrannosaurus|\brex\b|allosaurus|velociraptor|raptor|deinonychus|spinosaurus|compsognathus|carnotaurus|dilophosaurus|utahraptor|theropod|giganotosaurus|abelisaurus/, plan: "theropod", look: "scale" },
  { re: /triceratops|stegosaurus|brontosaurus|apatosaurus|brachiosaurus|plesiosaur|hadrosaur|parasaurolophus|dinosaur|sauropod|iguanodon|diplodocus|ankylo|dimetrodon/, plan: "quadruped", look: "scale", set: { snout: 0.5, tail: "long", ears: "none", bulk: 1.25 } },
  { re: /turtle|tortoise|terrapin|tortle/, plan: "quadruped", look: "scale", set: { shell: true, snout: 0.3, ears: "none", tail: "short", bulk: 1.1 } },
  { re: /grung|bullywug|boggard|cueyatl|frog-?folk|toad-?folk|frogling|slaad/, plan: "biped", look: "skin", set: { head: "frog", stance: "hunched", ears: "none", weapon: "spear" } },
  { re: /frog|toad|newt|salamander|axolotl|bullfrog|amphibian/, plan: "quadruped", look: "skin", set: { head: "frog", snout: 0.15, ears: "none", tail: "none", bulk: 0.9 } },
  { re: /\blizards?\b|crocodile|alligator|gator|iguana|gecko|komodo|monitor|basilisk|skink|caiman|chameleon|reptile/, plan: "quadruped", look: "scale", set: { snout: 0.85, ears: "none", tail: "long", bulk: 0.85 } },

  // --- generic "-folk" people with animal heads
  { re: /werewolf|wolfman|wolf-?kin|wolfen/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.75, ears: "pointy", stance: "hunched", tail: "long" } },
  { re: /wererat|ratfolk|ratling|skaven|rat-?kin|ratatosk/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.6, ears: "round", stance: "hunched", tail: "long", weapon: "dagger" } },
  { re: /weretiger|werecat|lion-?folk|leonin|catfolk|tabaxi|bouda/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.25, ears: "round", stance: "brute", tail: "long" } },
  { re: /werebear|bearfolk|grolar|bear-?kin/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.4, ears: "round", stance: "brute" } },
  { re: /wereboar|boarfolk|orc-?boar/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.45, tusks: true, ears: "pointy", stance: "brute" } },
  { re: /gnoll/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.7, ears: "round", mane: true, stance: "lanky", weapon: "spear" } },
  { re: /rakshasa/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.25, ears: "round", robe: true, crown: "crown", stance: "upright" } },
  { re: /minotaur/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.45, horns: "bull", stance: "brute", weapon: "axe", hooves: true, tail: "short" } },
  { re: /satyr|faun\b|pan\b|goatfolk|pooka|krampus/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.35, horns: "ram", hooves: true, beard: true, tail: "short", stance: "lanky" } },
  { re: /centaur|hippogriff rider/, plan: "taur", look: "fur", set: { lower: "horse", head: "humanoid", weapon: "bow" } },
  { re: /lamia|lion-?folk taur/, plan: "taur", look: "fur", set: { lower: "lion", head: "humanoid", horns: "curved" } },

  // --- mammals
  { re: /elephant|mammoth|mastodon/, plan: "quadruped", look: "hide", set: { trunk: true, tusks: true, ears: "long", snout: 0.3, tail: "short", bulk: 1.35 } },
  { re: /rhinoceros|rhino\b/, plan: "quadruped", look: "hide", set: { horns: "straight", snout: 0.4, ears: "round", tail: "short", bulk: 1.3 } },
  { re: /hippopotamus|hippo\b/, plan: "quadruped", look: "hide", set: { snout: 0.35, ears: "round", tail: "short", bulk: 1.4 } },
  { re: /giraffe/, plan: "quadruped", look: "fur", set: { longNeck: true, snout: 0.5, ears: "round", tail: "short", horns: "straight", hooves: true } },
  { re: /horse|pony|\bmule\b|donkey|warhorse|zebra|camel|llama|steed|charger|destrier|palfrey/, plan: "quadruped", look: "fur", set: { snout: 0.8, ears: "pointy", tail: "fluffy", longNeck: true, hooves: true, mane: true } },
  { re: /\belk\b|\bdeer\b|\bstag\b|moose|reindeer|caribou|antelope|gazelle/, plan: "quadruped", look: "fur", set: { snout: 0.6, ears: "pointy", horns: "antlers", tail: "short", longNeck: true, hooves: true } },
  { re: /goat|\bram\b|sheep|ibex|mouflon|chamois/, plan: "quadruped", look: "fur", set: { snout: 0.45, ears: "pointy", horns: "ram", tail: "short", hooves: true, bulk: 0.9 } },
  { re: /\bboar\b|\bhog\b|\bpig\b|warthog|peccary|swine/, plan: "quadruped", look: "fur", set: { snout: 0.45, tusks: true, ears: "pointy", tail: "short", hooves: true, bulk: 1.15 } },
  { re: /\bbears?\b|grolar|panda|polar/, plan: "quadruped", look: "fur", set: { snout: 0.4, ears: "round", tail: "none", bulk: 1.3 } },
  { re: /sabertooth|saber-tooth|smilodon/, plan: "quadruped", look: "fur", set: { snout: 0.25, ears: "round", tail: "short", tusks: true, bulk: 1.2 } },
  { re: /\blions?\b|lioness|\btigers?\b|panther|leopard|\bcats?\b|cheetah|lynx|jaguar|cougar|puma|bastet|bouda|kitten|catfolk|tabaxi/, plan: "quadruped", look: "fur", set: { snout: 0.25, ears: "round", tail: "long", bulk: 1 } },
  { re: /wolf|wolves|\bdogs?\b|hound|jackal|hyena|\bfox|coyote|mastiff|dingo|dhole|hellhound|corgi/, plan: "quadruped", look: "fur", set: { snout: 0.7, ears: "pointy", tail: "long", bulk: 0.95 } },
  { re: /\brats?\b|mouse|mice|squirrel|beaver|rabbit|\bhare\b|hamster|porcupine|rodent|chipmunk|marmot|lemming|capybara|doppelrat|vole|shrew|\bmole\b/, plan: "quadruped", look: "fur", set: { snout: 0.55, ears: "round", tail: "long", bulk: 0.85 } },
  { re: /weasel|badger|wolverine|otter|skunk|mongoose|ferret|stoat|erina|marten|raccoon|\bseal\b|walrus|sea lion|opossum|possum/, plan: "quadruped", look: "fur", set: { snout: 0.5, ears: "round", tail: "long", bulk: 0.85 } },
  { re: /\bapes?\b|gorilla|baboon|monkey|chimp|orangutan|yeti|bigfoot|sasquatch|abominable|kong|sloth/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.3, ears: "round", stance: "brute" } },

  // --- goblins, orcs, trolls and other stock monsters
  { re: /hobgoblin/, plan: "biped", set: { head: "humanoid", ears: "pointy", armor: true, weapon: "sword", shield: true, crown: "helm" } },
  { re: /gnome|halfling|dwarf|duergar|derro/, plan: "biped", set: { head: "humanoid", ears: "round", stance: "stout" } },
  { re: /goblin|gremlin|grimlock|boggle|redcap|trollkin|brownie/, plan: "biped", set: { head: "humanoid", ears: "pointy", stance: "hunched", weapon: "dagger" } },
  { re: /bugbear/, plan: "biped", look: "fur", set: { head: "beast", snout: 0.3, ears: "round", stance: "brute", weapon: "club" } },
  { re: /\borcs?\b|orcish|half-orc|ork\b|uruk/, plan: "biped", set: { head: "humanoid", tusks: true, ears: "pointy", stance: "brute", weapon: "axe" } },
  { re: /kobold|lizardfolk|crocodile ?folk|salamanderfolk|cockatrice folk/, plan: "biped", look: "scale", set: { head: "beast", snout: 0.6, tail: "long", ears: "none", stance: "hunched", weapon: "spear", horns: "straight" } },
  { re: /\btrolls?\b|scrag|jotun|thursir|ettin|ogre|oni\b|cyclops|hill giant|frost giant|fire giant|cloud giant|storm giant|stone giant|titan|goliath|giant\b|colossus/, plan: "biped", look: "skin", set: { head: "humanoid", stance: "brute", weapon: "club", tusks: true, bulk: 1.15 } },
  { re: /vampire|dhampir|strigoi|nosferatu/, plan: "biped", look: "flesh", set: { head: "humanoid", cape: true, stance: "upright", ears: "pointy", armor: false, aura: "smoke" } },
  { re: /\blich\b|demilich|archlich/, plan: "biped", look: "bone", set: { skeletal: true, head: "skull", robe: true, crown: "crown", weapon: "staff", glowEyes: true, aura: "smoke" } },
  { re: /skeleton|skeletal|\bbone\b|bones\b|skull|bonepowder/, plan: "biped", look: "bone", set: { skeletal: true, head: "skull", weapon: "sword" } },
  { re: /zombie|ghoul|ghast|corpse|thrall|drowned|darakhul|mohrg|abomination|flesh|walking dead|risen/, plan: "biped", look: "flesh", set: { head: "humanoid", zombie: true, stance: "hunched" } },
  { re: /mummy|ushabti|edjet|anubian/, plan: "biped", look: "flesh", set: { head: "humanoid", bandages: true, stance: "upright", zombie: true, crown: "crown" } },
  { re: /wight|revenant|death knight|draugr|einherjar|dullahan|fellforged|deathless|barrow/, plan: "biped", look: "bone", set: { head: "humanoid", skeletal: false, armor: true, weapon: "sword", glowEyes: true, crown: "helm", stance: "upright", aura: "smoke" } },
  { re: /treant|\btree\b|awakened tree|\bent\b|blight|dryad|alseid|arboreal|briarwood|woodwose|wood woad|barkskin|bark\b|root\b|twig|needle/, plan: "biped", look: "bark", set: { head: "humanoid", stance: "brute", ears: "none", aura: "spores" } },
  { re: /\bhags?\b|baba yaga|annis|witch|crone|coven|yaga|nightmare hag|sea hag|green hag|night hag/, plan: "biped", set: { head: "humanoid", stance: "hunched", crown: "hat", robe: true, weapon: "staff", ears: "pointy", beard: false } },
  { re: /mephit/, plan: "biped", set: { head: "humanoid", ears: "pointy", wings: "membrane", stance: "hunched", horns: "straight", tail: "long", glowEyes: true } },
  { re: /sprite|pixie|fairy|faerie|grig|quickling|nixie|will|dawn dryad|butterfly folk|nymph|fey wing/, plan: "biped", set: { head: "humanoid", ears: "pointy", wings: "insect", stance: "lanky" } },
  { re: /angel|deva|planetar|solar\b|archon|seraph|celestial|empyrean|lammasu|couatl|herald|nkosi|guardian of|valkyrie|paladin of/, plan: "biped", look: "skin", set: { head: "humanoid", wings: "feather", crown: "halo", robe: true, weapon: "sword", aura: "motes", glowEyes: true } },
  { re: /balor|marilith|glabrezu|hezrou|nalfeshnee|vrock|demon|devil|erinyes|fiend|pit fiend|cambion|lemure|manes|dretch|chort|abyssal|infernal|barbed|bone devil|horned devil|ice devil|imp\b|quasit|succubus|incubus|yugoloth|mezzoloth|nycaloth|arcanaloth|ultroloth|oni\b|bearded devil|spined devil|malebranche|hellcat|arbeyach|aeshma|shadow demon/, plan: "biped", look: "hide", set: { head: "beast", snout: 0.3, horns: "curved", wings: "membrane", tail: "long", stance: "brute", aura: "embers", glowEyes: true, ears: "pointy" } },
  { re: /mind flayer|illithid|ulitharid|nothic|umber hulk|intellect|neogi|grimlock|gug\b|slaad|kuo|flumph|gibbering/, plan: "biped", look: "skin", set: { head: "humanoid", faceTentacles: true, robe: true, stance: "upright" } },
  { re: /\bxorn\b|golem|clockwork|automaton|construct|juggernaut|monolith|statue|shield guardian|helmed horror|modron|gearforged|necrotech|servitor|drudge|myrmidon|sentinel|guardian|defender|watchman|colossal|homunculus|scarecrow|gargoyle|caryatid|totem|idol|obelisk|cannon|siege|engine|mechanical|robot|steam|gear/, plan: "biped", look: "metal", set: { head: "humanoid", stance: "brute", glowEyes: true, crown: "helm", bulk: 1.15 } },
  { re: /elemental|salamander|magmin|azer|galeb duhr|invisible stalker|firenewt|earth elemental|water elemental|fire elemental|magma|molten|lava|ember|ice mephit|ice elemental|frost|rime|glacial|\bice\b|snow/, plan: "biped", look: "stone", set: { head: "humanoid", stance: "brute", glowEyes: true } },
  { re: /crystal|prismatic|gem|amethyst|sapphire|emerald|glass|crystalline|shard/, plan: "biped", look: "crystal", set: { head: "humanoid", stance: "brute", glowEyes: true } },
];

// --- gear picked from job titles, applied to any biped
const GEAR: Array<{ re: RegExp; set: Partial<Traits> }> = [
  { re: /mage|wizard|sorcerer|warlock|priest|acolyte|cultist|druid|shaman|witch|alchemist|archmage|necromancer|illusionist|enchantress|cleric|diviner|savant|apprentice|oracle|seer|mystic|ringmage|initiate|fanatic|arcane|conjurer|warmage|abjurer|evoker|hierophant/, set: { robe: true, weapon: "staff", crown: "hood" } },
  { re: /knight|guard\b|guards\b|soldier|warrior|gladiator|veteran|champion|captain|commander|paladin|templar|defender|watch\b|sentinel|duelist|centurion|legion|warlord|chieftain|general|imperator|marauder|reaver|raider|myrmidon|man-at-arms|cavalier|lancer|guardian/, set: { armor: true, weapon: "sword", shield: true, crown: "helm" } },
  { re: /berserker|thug|bandit|brute|pirate|barbarian|ruffian|enforcer|mercenary|outlaw|highwayman|smuggler|deckhand|sailor/, set: { weapon: "axe", armor: false } },
  { re: /archer|scout|ranger|hunter|huntsman|sniper|skirmisher|bowman|trapper|forester/, set: { weapon: "bow", crown: "hood" } },
  { re: /assassin|spy|rogue|thief|cutpurse|garroter|skulker|infiltrator|cat burglar|shadowdancer|ninja/, set: { weapon: "dagger", crown: "hood", cape: true } },
  { re: /king|queen|monarch|emperor|empress|lord|lady|prince|princess|sovereign|noble|baron|duke|count\b|regent|imperial|royal/, set: { crown: "crown", cape: true, robe: true } },
  { re: /pugilist|monk|brawler|boxer|wrestler/, set: { weapon: "none", stance: "stout" } },
];

const PLAN_BY_TYPE_LOOK: Record<CreatureType, Look> = {
  aberration: "hide", beast: "fur", celestial: "skin", construct: "metal", dragon: "scale",
  elemental: "stone", fey: "skin", fiend: "hide", giant: "skin", humanoid: "skin",
  monstrosity: "hide", ooze: "slime", plant: "bark", undead: "flesh", swarm: "fur",
};

// ---------------------------------------------------------------------------
// colours

interface Tone { h: number; s: number; l: number }
const TONES: Array<[RegExp, Tone]> = [
  [/elephant|mammoth|mastodon|rhino|hippo|gargoyle|granite/, { h: 25, s: 0.06, l: 0.46 }],
  [/\btigers?\b|sabertooth|saber-tooth|smilodon|tabaxi|weretiger/, { h: 28, s: 0.82, l: 0.5 }],
  [/\blions?\b|lioness|cougar|\bpuma\b|cheetah|leonin|griffon|griffin|sphinx|manticore/, { h: 38, s: 0.5, l: 0.5 }],
  [/panther|black bear|\bshadow cat|nightmare/, { h: 260, s: 0.08, l: 0.13 }],
  [/\bred\b|crimson|scarlet|ruby|blood|infernal|fire|flame|magma|ember|lava|efreeti|magmin|hell|balor|sanguine|rust\b|cinder/, { h: 4, s: 0.7, l: 0.42 }],
  [/orange|amber|topaz|sunset|autumn/, { h: 26, s: 0.8, l: 0.5 }],
  [/\bgold|golden|solar|radiant|sun\b|sunlit|brass|dawn|honey/, { h: 46, s: 0.8, l: 0.52 }],
  [/yellow|sulfur|sulphur|saffron/, { h: 56, s: 0.75, l: 0.5 }],
  [/emerald|\bgreen\b|forest|jungle|venom|poison|acid|moss|leaf|swamp|bog|verdant|toxic|plague|blight|rot\b|sickly|goblin|hag\b/, { h: 118, s: 0.45, l: 0.36 }],
  [/marid|teal|turquoise|aqua|sea\b|reef|coral|marine|deep\b|abyss|kelp|tide|ocean|water|river|lake/, { h: 178, s: 0.5, l: 0.36 }],
  [/djinni|djinn|air genie|sapphire|\bblue\b|storm|lightning|thunder|sky|azure|cobalt|cloud|frost|ice\b|glacial|rime|winter|boreal|snow/, { h: 214, s: 0.6, l: 0.5 }],
  [/purple|amethyst|violet|void|shadow|night|dusk|twilight|umbral|leng|nightmare|dream|astral|dark\b|gloom|dread|death|umbra|abyss/, { h: 276, s: 0.4, l: 0.28 }],
  [/pink|rose|blossom|cherry|faerie|fey|sprite|pixie|dryad/, { h: 322, s: 0.5, l: 0.6 }],
  [/\bwhite\b|albino|pale|bleached|ivory|polar|arctic|silver|mithral|steel|iron|moon|lunar|ghost|specter/, { h: 210, s: 0.08, l: 0.82 }],
  [/\bblack\b|obsidian|onyx|coal|charcoal|soot|ash\b|shade|raven|crow|pitch|ink\b/, { h: 260, s: 0.12, l: 0.13 }],
  [/\bdao\b|shaitan|earth genie/, { h: 30, s: 0.5, l: 0.36 }],
  [/gr[ae]y|stone|rock|granite|slate|dust|gravel|cave|mountain|hill\b|clay|earth|sand|desert/, { h: 34, s: 0.1, l: 0.45 }],
  [/brown|bronze|copper|mud|wood|oak|tree|bark|mole|badger|bear/, { h: 26, s: 0.45, l: 0.33 }],
];

// Wolves are grey, lions are gold, and so on: family fallback by the look
// and type when no colour word appears in the name.
function baseTone(type: CreatureType, look: Look, rng: Rng, name: string): Tone {
  for (const [re, tone] of TONES) {
    if (re.test(name)) {
      return {
        h: tone.h + between(rng, -6, 6),
        s: Math.max(0, Math.min(1, tone.s + between(rng, -0.06, 0.06))),
        l: Math.max(0.05, Math.min(0.95, tone.l + between(rng, -0.04, 0.05))),
      };
    }
  }
  switch (look) {
    case "bone": return { h: 40, s: 0.18, l: 0.78 };
    case "flesh": return { h: pick(rng, [95, 70, 40, 160]), s: 0.22, l: 0.42 };
    case "metal": return { h: pick(rng, [210, 30, 40, 200]), s: 0.14, l: 0.52 };
    case "stone": return { h: pick(rng, [30, 20, 215, 35]), s: 0.12, l: 0.42 };
    case "bark": return { h: pick(rng, [26, 95, 120]), s: 0.35, l: 0.3 };
    case "slime": return { h: pick(rng, [110, 300, 190, 60, 340]), s: 0.55, l: 0.5 };
    case "ghost": return { h: 205, s: 0.3, l: 0.8 };
    case "flame": return { h: 18, s: 0.9, l: 0.5 };
    case "ice": return { h: 200, s: 0.55, l: 0.7 };
    case "crystal": return { h: pick(rng, [300, 190, 140, 350, 55]), s: 0.55, l: 0.6 };
    case "chitin": return { h: pick(rng, [28, 100, 5, 260, 45, 350]), s: 0.4, l: 0.28 };
    case "feather": return { h: pick(rng, [28, 35, 0, 40, 210]), s: 0.3, l: 0.42 };
    case "scale": return { h: pick(rng, [110, 85, 25, 140, 30, 60]), s: 0.35, l: 0.36 };
    case "fur": {
      if (chance(rng, 0.28)) return { h: 220, s: between(rng, 0.02, 0.08), l: between(rng, 0.2, 0.55) };
      return { h: pick(rng, [22, 28, 34, 38, 44]), s: between(rng, 0.25, 0.5), l: between(rng, 0.26, 0.48) };
    }
    case "hide": return { h: pick(rng, [24, 30, 20, 220]), s: between(rng, 0.06, 0.28), l: between(rng, 0.3, 0.46) };
    default: break;
  }
  switch (type) {
    case "humanoid":
    case "giant":
      return { h: pick(rng, [22, 26, 30, 18, 24]), s: between(rng, 0.25, 0.45), l: between(rng, 0.35, 0.68) };
    case "fiend": return { h: pick(rng, [2, 8, 350, 14]), s: 0.55, l: 0.32 };
    case "celestial": return { h: 45, s: 0.35, l: 0.86 };
    case "fey": return { h: pick(rng, [140, 300, 180, 60, 340]), s: 0.4, l: 0.6 };
    case "aberration": return { h: pick(rng, [290, 330, 170, 260]), s: 0.35, l: 0.4 };
    default: return { h: pick(rng, [30, 100, 200, 350]), s: 0.3, l: 0.4 };
  }
}

function derivePalette(type: CreatureType, look: Look, plan: Plan, traits: Traits, rng: Rng, name: string): Palette {
  const tone = baseTone(type, look, rng, name);
  if (/vampire|dhampir|nosferatu|strigoi/.test(name)) Object.assign(tone, { h: 18, s: 0.1, l: 0.8 });
  if (traits.bandages) Object.assign(tone, { h: 40, s: 0.28, l: 0.66 });
  const skin = hslHex(tone.h, tone.s, tone.l);
  const belly = hslHex(tone.h + 4, tone.s * 0.75, Math.min(0.9, tone.l + 0.16));
  const clothHue = pick(rng, [8, 28, 48, 110, 170, 215, 265, 320]);
  let cloth = hslHex(clothHue, between(rng, 0.3, 0.55), between(rng, 0.22, 0.4));
  if (type === "celestial") cloth = hslHex(45, 0.3, 0.9);
  else if (type === "fiend") cloth = hslHex(pick(rng, [0, 350, 270]), 0.35, 0.16);
  else if (/vampire/.test(name)) cloth = hslHex(350, 0.5, 0.2);
  else if (type === "undead") cloth = hslHex(pick(rng, [30, 260, 120]), 0.12, 0.2);
  const accentLight = look === "bone" || type === "undead" ? 0.86 : look === "metal" ? 0.7 : 0.82;
  const accent = hslHex(38, look === "metal" ? 0.05 : 0.2, accentLight);
  const glowHue = look === "ice" ? 200 : look === "flame" ? 22 : look === "ghost" ? 190
    : type === "undead" ? pick(rng, [140, 95, 190]) : type === "fiend" ? 12 : type === "celestial" ? 48
    : type === "aberration" ? 300 : tone.h;
  const glow = hslHex(glowHue, 0.9, 0.58);
  const darkBody = tone.l < 0.3;
  const eye = look === "ghost" || traits.glowEyes ? glow
    : hslHex(darkBody ? pick(rng, [50, 12, 100]) : 30, darkBody ? 0.85 : 0.6, darkBody ? 0.6 : 0.12);
  void plan;
  return { skin, belly, cloth, accent, eye, glow };
}

// ---------------------------------------------------------------------------
// per-type fallbacks when no name rule matched

function typeFallback(type: CreatureType, size: SizeKey, rng: Rng, t: Traits): { plan: Plan; look?: Look } {
  switch (type) {
    case "beast":
      Object.assign(t, { snout: between(rng, 0.25, 0.7), ears: pick(rng, ["round", "pointy"] as const), tail: "long" });
      return { plan: "quadruped", look: "fur" };
    case "humanoid":
      t.stance = pick(rng, ["upright", "upright", "lanky", "stout"] as const);
      t.head = "humanoid";
      t.weapon = pick(rng, ["sword", "axe", "club", "spear", "dagger", "none"] as const);
      t.armor = chance(rng, 0.3);
      t.shield = t.armor && chance(rng, 0.5);
      return { plan: "biped", look: "skin" };
    case "monstrosity": {
      const roll = rng();
      Object.assign(t, {
        snout: between(rng, 0.2, 0.6), ears: pick(rng, ["round", "pointy", "none"] as const),
        horns: pick(rng, ["none", "curved", "straight", "bull", "ram"] as const),
        tail: pick(rng, ["long", "scorpion", "club", "fluffy"] as const),
        spikes: chance(rng, 0.4), mane: chance(rng, 0.3), tusks: chance(rng, 0.25),
        wings: chance(rng, 0.35) ? pick(rng, ["membrane", "feather"] as const) : "none",
        heads: chance(rng, 0.12) ? 2 : 1, bulk: between(rng, 0.9, 1.3),
      });
      if (roll < 0.62) return { plan: "quadruped", look: pick(rng, ["hide", "scale", "fur"] as const) };
      if (roll < 0.82) { t.head = "beast"; t.stance = "brute"; return { plan: "biped", look: pick(rng, ["hide", "scale", "skin"] as const) }; }
      if (roll < 0.92) return { plan: "serpent", look: "scale" };
      return { plan: "hexapod", look: "chitin" };
    }
    case "dragon":
      Object.assign(t, { wings: "membrane", legs: 4, horns: "curved" });
      return { plan: "dragon", look: "scale" };
    case "undead":
      if (chance(rng, 0.45)) { Object.assign(t, { skeletal: true, head: "skull", weapon: pick(rng, ["sword", "spear", "axe"] as const) }); return { plan: "biped", look: "bone" }; }
      Object.assign(t, { head: "humanoid", zombie: true, stance: "hunched" });
      return { plan: "biped", look: "flesh" };
    case "fiend":
      Object.assign(t, { head: "beast", snout: 0.3, horns: pick(rng, ["curved", "ram", "straight"] as const), wings: chance(rng, 0.55) ? "membrane" : "none", tail: "long", stance: "brute", aura: "embers", glowEyes: true, ears: "pointy" });
      return { plan: "biped", look: "hide" };
    case "fey":
      Object.assign(t, { head: "humanoid", ears: "pointy", stance: "lanky", wings: chance(rng, 0.5) ? "insect" : "none", horns: chance(rng, 0.3) ? "antlers" : "none", crown: chance(rng, 0.3) ? "crown" : "none", aura: "motes" });
      return { plan: "biped", look: "skin" };
    case "construct":
      Object.assign(t, { head: "humanoid", stance: "brute", glowEyes: true, crown: "helm", bulk: 1.15 });
      return { plan: "biped", look: "metal" };
    case "aberration": {
      const roll = rng();
      t.eyestalks = 3 + Math.floor(rng() * 5);
      if (roll < 0.34) return { plan: "tentacled", look: "hide" };
      if (roll < 0.58) return { plan: "orb", look: "hide" };
      if (roll < 0.8) return { plan: "blob", look: "slime" };
      return { plan: "hexapod", look: "chitin" };
    }
    case "elemental": {
      const roll = rng();
      Object.assign(t, { head: "humanoid", stance: "brute", glowEyes: true });
      if (roll < 0.28) return { plan: "vortex", look: "ghost" };
      return { plan: "biped", look: pick(rng, ["stone", "flame", "ice", "crystal"] as const) };
    }
    case "plant":
      if (chance(rng, 0.45)) { Object.assign(t, { spikes: true, aura: "spores" }); return { plan: "blob", look: "bark" }; }
      Object.assign(t, { head: "humanoid", stance: "brute", aura: "spores" });
      return { plan: "biped", look: "bark" };
    case "giant":
      Object.assign(t, { head: "humanoid", stance: "brute", weapon: pick(rng, ["club", "axe", "sword"] as const), bulk: 1.15 });
      return { plan: "biped", look: "skin" };
    case "celestial":
      Object.assign(t, { head: "humanoid", wings: "feather", crown: "halo", robe: true, aura: "motes", glowEyes: true, weapon: pick(rng, ["sword", "staff", "spear"] as const) });
      return { plan: "biped", look: "skin" };
    case "ooze":
      return { plan: "blob", look: "slime" };
    case "swarm":
      return { plan: "swarm" };
    default:
      void size;
      return { plan: "quadruped" };
  }
}

// ---------------------------------------------------------------------------

export function deriveCreatureSpec(input: CreatureInput): CreatureSpec {
  const name = input.name.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  const type = normalizeCreatureType(input.type);
  const size = normalizeSize(input.size);
  const seed = hashString(name);
  const rng = makeRng(seed);
  const traits = defaultTraits();
  const subtype = `${input.subtype ?? ""} ${input.group ?? ""}`.toLowerCase();
  // Search text for family rules: the name, plus the subtype for the cases
  // where the name alone says nothing ("Chained Wretch" / subtype "demon").
  const haystack = type === "swarm" ? `swarm ${name}` : name;

  let plan: Plan | null = null;
  let look: Look | undefined;
  let matchedBy: CreatureSpec["matchedBy"] = "name";

  for (const family of FAMILIES) {
    if (has(family.re, haystack)) {
      plan = family.plan;
      look = family.look;
      Object.assign(traits, family.set ?? {});
      break;
    }
  }

  // A type that contradicts the family rule wins where the rule was a loose
  // keyword: "Giant Rat" is a beast, so a "giant" rule must not catch it.
  if (plan && type === "humanoid" && ["quadruped", "avian", "hexapod", "octopod", "fish", "serpent", "theropod", "swarm"].includes(plan)) {
    plan = null; look = undefined; Object.assign(traits, defaultTraits());
  }
  if (plan === "biped" && (type === "beast" || type === "swarm") && !/\bapes?\b|gorilla|baboon|monkey|chimp|orangutan|yeti|bigfoot|sasquatch|abominable|kong|sloth|kenku|aarakocra|ravenfolk|harpy/.test(name)) {
    plan = null; look = undefined; Object.assign(traits, defaultTraits());
  }

  if (!plan) {
    matchedBy = "type";
    const fallback = typeFallback(type, size, rng, traits);
    plan = fallback.plan;
    look = fallback.look;
    // Subtype hints the name lacked ("demon", "devil", "shapechanger").
    if (/demon|devil|fiend|chort/.test(subtype) && plan === "biped") {
      Object.assign(traits, { horns: "curved", wings: "membrane", tail: "long", aura: "embers", glowEyes: true });
    }
  }
  look = look ?? PLAN_BY_TYPE_LOOK[type];

  // Type overrides for undead variants of animals: "Zombie Bear", "Skeletal Dragon".
  if (type === "undead" && look !== "bone" && look !== "ghost" && !["biped", "spirit", "orb", "vortex", "swarm", "blob", "cube", "object"].includes(plan)) {
    look = /skelet|bone|dracolich|lich/.test(name) ? "bone" : "flesh";
    traits.glowEyes = true;
    traits.aura = "smoke";
  }
  if (type === "undead" && /skelet|bone|dracolich/.test(name) && plan !== "biped") look = "bone";

  // Jobs and ranks give a biped its gear.
  if (plan === "biped" || plan === "taur") {
    for (const gear of GEAR) {
      if (has(gear.re, name)) Object.assign(traits, gear.set);
    }
    if (type === "humanoid" && traits.weapon === "none" && !/monk|pugilist/.test(name) && chance(rng, 0.6)) {
      traits.weapon = pick(rng, ["sword", "axe", "club", "spear", "dagger"] as const);
    }
  }

  // Speeds: what the name did not say, the stat block can.
  const fly = speedOf(input.speed, "fly");
  const swim = speedOf(input.speed, "swim");
  const walk = speedOf(input.speed, "walk");
  if (fly > 0 && traits.wings === "none" && (plan === "biped" || plan === "quadruped" || plan === "taur" || plan === "serpent")) {
    if (look === "ghost" || look === "flame") traits.wings = "none";
    else if (type === "fiend" || type === "dragon" || type === "undead") traits.wings = "membrane";
    else if (type === "fey" || look === "chitin") traits.wings = "insect";
    else traits.wings = "feather";
  }
  if (swim > 0 && walk === 0 && plan === "quadruped") { plan = "fish"; traits.fins = true; }

  // Type-level seasoning: every fiend gets a glow, celestials get a halo.
  if (type === "celestial" && plan === "biped" && traits.crown === "none") traits.crown = "halo";
  if (type === "fiend") traits.glowEyes = true;
  if (type === "undead" && plan === "biped" && look !== "bone") traits.glowEyes = traits.glowEyes || chance(rng, 0.5);

  // Look wins for elementals: name-driven material.
  if (type === "elemental" && plan === "biped") {
    if (/fire|flame|magma|magmin|lava|ember|efreeti|salamander|azer|smoke|ash/.test(name)) { look = "flame"; traits.aura = "embers"; traits.crown = "flames"; }
    else if (/ice|frost|rime|glacial|snow|cold/.test(name)) { look = "ice"; traits.aura = "frost"; }
    else if (/water|tide|sea|river|ocean|rain|mud/.test(name)) { look = "ice"; }
    else if (/earth|stone|rock|clay|salt|sand|dust|xorn|galeb/.test(name)) look = "stone";
    else if (/crystal|gem|glass|prismatic/.test(name)) look = "crystal";
  }
  if (plan === "spirit" && /fire|flame|efreeti|ifrit/.test(name)) { look = "flame"; traits.aura = "embers"; }
  if (plan === "vortex" && /fire|flame|ember/.test(name)) { look = "flame"; traits.aura = "embers"; }

  // Swarms: what they are made of.
  if (plan === "swarm") {
    const kind: Traits["swarmKind"] =
      /bat/.test(name) ? "bat" : /raven|crow|bird|hawk|owl|gull|starling|pigeon|vulture/.test(name) ? "bird"
      : /rat|mice|mouse|lemming|rodent|weasel/.test(name) ? "rat" : /fish|quipper|piranha|eel|shark|sardine/.test(name) ? "fish"
      : /snake|serpent|viper|worm|leech/.test(name) ? "snake" : /insect|beetle|wasp|bee|spider|ant|centipede|scarab|locust|roach|fly|flies|mosquito|scorpion|stirge|cobble/.test(name) ? "insect" : "generic";
    traits.swarmKind = kind;
    look = kind === "insect" ? "chitin" : kind === "bird" ? "feather" : kind === "fish" || kind === "snake" ? "scale" : "fur";
  }

  if (/cyclops/.test(name)) traits.eyes = 1;
  // Juvenile dragons have oversized heads.
  if (/wyrmling|whelp|young|pseudo|dragonette|hatchling/.test(name)) traits.juvenile = true;
  // "Ancient" and "elder" things: spikes and horns.
  if (/ancient|elder|great|greater|imperial|mature/.test(name) && plan === "dragon") traits.spikes = true;
  if (plan === "dragon") traits.spikes = traits.spikes || chance(rng, 0.6);

  // Fusions of named element to aura, even outside the elemental type.
  if (/fire|flame|magma|ember|infernal|hell|lava|burning|blazing/.test(name) && traits.aura === "none" && look !== "flame") traits.aura = "embers";
  if (/frost|ice\b|snow|winter|rime|glacial|freezing|boreal/.test(name) && traits.aura === "none") traits.aura = "frost";
  if (/lightning|thunder|storm|spark|shock|tempest/.test(name) && traits.aura === "none") traits.aura = "sparks";

  const palette = derivePalette(type, look, plan, traits, rng, name);
  if (name === "a-mi-kuk") Object.assign(palette, { skin: "#782839", belly: "#ad5360", eye: "#08080b", accent: "#d7bba1" });
  if (name === "kobold") Object.assign(palette, { skin: "#a65030", belly: "#d59b62", cloth: "#423026", eye: "#edb536", accent: "#e3cfab" });
  if (name === "planetar") Object.assign(palette, { skin: "#6caa96", belly: "#90c5ad", cloth: "#ded8c4", eye: "#fff2b9", glow: "#ffe5a0", accent: "#cba45e" });

  return {
    slug: input.slug,
    name: input.name,
    type,
    size,
    sizeFactor: SIZE_FACTOR[size],
    footprintCells: SIZE_CELLS[size],
    plan,
    look,
    palette,
    traits,
    seed,
    matchedBy,
  };
}
