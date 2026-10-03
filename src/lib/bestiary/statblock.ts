import { isValidExpression } from "@/lib/dice";
import { xpForCr } from "@/lib/srd/encounter-math";

// Compacts a raw Open5e monster blob into the snapshot an encounter stores
// per enemy (stat_json). Snapshotting at spawn means a live fight never
// depends on the content pack being present.

export type EnemyAttack = {
  name: string;
  toHit: number;
  // A dice expression src/lib/dice.ts rollExpression accepts, e.g. "1d8+3"
  // or "2d10+8+2d6" when the attack carries rider damage. Empty when a hit
  // deals no damage and only does what onHit says (a web, a grab).
  damage: string;
  type: string;
  // Feet, from the printed block. A melee attack has reach, a ranged one
  // range (and longRange, at disadvantage); a thrown weapon has both.
  // Absent on synthesized and homebrew blocks: the name decides there
  // (src/lib/dm/map-tools.ts).
  reach?: number;
  range?: number;
  longRange?: number;
  // Limited use: back on a d6 of `recharge` or more at the start of a round,
  // or `uses` times per fight ("3/Day", "Recharges after a Short Rest").
  recharge?: number;
  uses?: number;
  onHit?: EnemyHitEffect;
};

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type EnemySaveMods = Record<SaveAbility, number>;

// A saving throw the block forces: after a hit (a spider's poison, a
// ghoul's paralysis) or as the whole action (a breath weapon).
export type EnemySave = {
  ability: SaveAbility;
  dc: number;
  damage?: string;
  damageType?: string;
  // Half damage on a success; otherwise a success takes nothing.
  half?: boolean;
  condition?: string;
  // Absent = the target re-saves each round to end it.
  rounds?: number;
};

// What a landed hit does beyond its damage: a condition with no save (the
// web restrains, the jaws grapple, with the DC to break free), a save.
export type EnemyHitEffect = {
  condition?: string;
  escapeDc?: number;
  save?: EnemySave;
};

// An action that is a saving throw rather than an attack roll.
export type EnemySaveAction = EnemySave & {
  name: string;
  // "30-foot cone", as printed; the narrator picks who is in it.
  area?: string;
  recharge?: number;
  uses?: number;
};

export type EnemyStats = {
  ac: number;
  maxHp: number;
  dexMod: number;
  // Saving-throw modifiers per ability. Optional: stat_json rows snapshotted
  // before this field existed lack it; saveModFor() covers the fallback.
  saveMods?: EnemySaveMods;
  speed: string;
  attacks: EnemyAttack[];
  // Save actions the engine resolves itself (breath weapons, gazes).
  // Optional: synthesized blocks and old snapshots lack it.
  saves?: EnemySaveAction[];
  // Non-attack actions and special abilities as one-line rules text, e.g.
  // "Fire Breath (Recharge 5-6): DC 12 Dex save, 6d6 fire, half on success".
  traits: string[];
  resist: string;
  immune: string;
  vulnerable: string;
  conditionImmune: string;
  cr: number;
  xp: number;
  // Attacks per turn from the Multiattack action (1 when absent). Optional:
  // stat_json rows snapshotted before this field existed lack it.
  attacksPerTurn?: number;
  // Creature size (Tiny..Gargantuan). Optional: synthesized stats and old
  // snapshots lack it and are treated as Medium.
  size?: string;
  // SRD creature type in lowercase ("undead"). Optional: synthesized stats
  // and old snapshots lack it; creatureTypeOf() covers the fallback.
  type?: string;
  // The rest of a printed stat block (docs/workshop-parity-audit.md phase
  // 12). All optional: synthesized blocks and old snapshots lack them, and
  // every reader falls back to the field it read before. Scores are the six
  // raw ability scores; skills are bonuses by lowercase name ("perception":
  // 5); senses are in feet, with the passive Perception the block prints.
  abilities?: Partial<Record<SaveAbility, number>>;
  skills?: Record<string, number>;
  senses?: EnemySenses;
  languages?: string;
  alignment?: string;
  // Spells by name. The engine runs the attack list, not these; the DM
  // prompt prints them so whoever is running the monster knows they exist,
  // and the rating counts them through extraDamagePerRound.
  spells?: string[];
  environment?: string[];
};

export type EnemySenses = {
  darkvision?: number;
  blindsight?: number;
  tremorsense?: number;
  truesight?: number;
  passivePerception?: number;
};

// The fourteen SRD creature types. They are also the bestiary thumbnail
// plates in public/assets/placeholders/monster, which is why the list is
// closed: a type with no plate would be a monster with no picture.
export const CREATURE_TYPES = [
  "aberration",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "elemental",
  "fey",
  "fiend",
  "giant",
  "humanoid",
  "monstrosity",
  "ooze",
  "plant",
  "undead",
] as const;

export type CreatureType = (typeof CREATURE_TYPES)[number];

// "Humanoid (goblinoid)" -> "humanoid". Open5e files swarms under their own
// type, which has no plate; a swarm of rats is drawn as the beast it is.
export function normalizeCreatureType(raw: unknown): CreatureType | null {
  const word = String(raw ?? "").trim().toLowerCase().split(/[\s(]/)[0];
  if (word === "swarm") {
    return "beast";
  }
  return (CREATURE_TYPES as readonly string[]).includes(word) ? (word as CreatureType) : null;
}

// The type to draw or print for a stat block: its own when it carries one,
// and monstrosity for a synthesized block or a pre-type snapshot, the plate
// that promises the least about what is under it.
export function creatureTypeOf(stats: Pick<EnemyStats, "type">): CreatureType {
  return normalizeCreatureType(stats.type) ?? "monstrosity";
}

// "The wolf makes two bite attacks." -> 2, clamped to 3 so a bad parse can
// never flood a turn with swings.
export function parseMultiattackCount(description: string): number | null {
  const match = /makes?\s+(two|three|four|2|3|4)\b[^.]*attack/i.exec(description);
  if (!match) {
    return null;
  }
  const word = match[1].toLowerCase();
  const count = word === "two" || word === "2" ? 2 : word === "three" || word === "3" ? 3 : 4;
  return Math.min(3, count);
}

const MAX_ATTACKS = 4;
const MAX_SAVES = 3;
const MAX_TRAITS = 4;
const TRAIT_CHARS = 140;

type RawAction = {
  name?: unknown;
  desc?: unknown;
  attack_bonus?: unknown;
  damage_dice?: unknown;
  damage_bonus?: unknown;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ---- reading the printed action ----
//
// The text is the source of truth. Half the pack (A5E, Black Flag, Tome of
// Beasts 2023) has no attack_bonus or damage_dice fields at all, and where
// the fields exist they are sometimes wrong (a vampire spawn's bite at +61)
// or already include the rider dice the text prints again.

const CONDITIONS =
  "blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious";
const ATTACK_RE = /(Melee or Ranged|Melee|Ranged) (?:Weapon|Spell) Attack[:.]?\s*([+-]\s?\d+) to hit/i;
// "DC 11 Constitution saving throw", or Black Flag's "DC 12 CON save".
const SAVE_RE = /DC (\d+) (Str(?:ength)?|Dex(?:terity)?|Con(?:stitution)?|Int(?:elligence)?|Wis(?:dom)?|Cha(?:risma)?) sav(?:ing throw|e)\b/i;
// "7 (1d8 + 3) piercing damage"; a few blocks drop the word "damage". The
// word after the dice has to be a damage type (or "damage"): dice followed by
// "hit points" or "rounds" are not damage.
const DAMAGE_WORD = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder|damage";
const DICE_DAMAGE_RE = new RegExp(`\\d+ \\((\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\) (${DAMAGE_WORD})\\b`, "i");
const RIDER_RE = new RegExp(`plus \\d+ \\((\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\) (${DAMAGE_WORD})\\b`, "gi");
// "...or be paralyzed", "On a failure, the target is frightened", within one sentence.
const FAILED_CONDITION_RE = new RegExp(
  `(?:\\bor|on a fail(?:ed save|ure),?)[^.]*?\\b(?:be|is|becomes?) (?:knocked )?(${CONDITIONS})\\b`,
  "i",
);
// "the target is grappled (escape DC 13)", "The target is restrained by
// webbing". Only these three: a hit that blinds or poisons outright is
// nearly always conditional prose (swallowed, attached, "if the target is
// paralyzed") the narrator has to read anyway.
const HIT_CONDITION_RE = /\b(if )?(?:the )?(?:target|creature|it) is (?:also )?(?:knocked )?(grappled|restrained|prone)\b/gi;

// Open5e prose comes plain or as markdown ("_Hit:_"), with the odd
// typographic minus.
function prose(desc: unknown): string {
  return asString(desc).replace(/[_*]/g, "").replace(/−/g, "-").replace(/\s+/g, " ").trim();
}

function compact(expression: string): string {
  return expression.replace(/\s+/g, "");
}

// "(Recharge 5-6)" -> 5; "(3/Day)" -> 3 uses; "(Recharges after a Short or
// Long Rest)" -> once a fight.
function limitOf(name: string): { recharge?: number; uses?: number } {
  const recharge = /\(Recharge (\d)/i.exec(name);
  if (recharge) {
    return { recharge: Number(recharge[1]) };
  }
  const perDay = /\((\d+)\/Day/i.exec(name);
  if (perDay) {
    return { uses: Number(perDay[1]) };
  }
  return /Recharges? after/i.test(name) ? { uses: 1 } : {};
}

// How long a failed save lasts. A repeated save wins over the printed cap:
// that is how it actually ends at the table.
function roundsOf(text: string): number | undefined {
  if (/repeat the saving throw/i.test(text)) {
    return undefined;
  }
  if (/until the (?:end|start) of (?:its|the target's|the [a-z]+'s) next turn/i.test(text)) {
    return 1;
  }
  const minutes = /for (\d+) minutes?/i.exec(text);
  if (minutes) {
    return Math.min(100, Number(minutes[1]) * 10);
  }
  return /for \d+ (?:hours?|days?)/i.test(text) ? 100 : undefined;
}

// The save in this text, with what failing it costs. Null when the text
// names a save the engine cannot resolve (a disease, a pull, a swallow).
function parseSave(text: string): EnemySave | null {
  const match = SAVE_RE.exec(text);
  if (!match) {
    return null;
  }
  const rest = text.slice(match.index);
  const damage = DICE_DAMAGE_RE.exec(rest);
  const condition = FAILED_CONDITION_RE.exec(rest)?.[1].toLowerCase();
  if ((!damage || !isValidExpression(compact(damage[1]))) && !condition) {
    return null;
  }
  const rounds = condition && condition !== "prone" ? roundsOf(rest) : undefined;
  return {
    ability: match[2].slice(0, 3).toLowerCase() as SaveAbility,
    dc: Number(match[1]),
    ...(damage && isValidExpression(compact(damage[1]))
      ? { damage: compact(damage[1]), ...(/^damage$/i.test(damage[2]) ? {} : { damageType: damage[2].toLowerCase() }) }
      : {}),
    ...(damage && /\bhalf (?:as much|damage|the damage|on a success)/i.test(rest) ? { half: true } : {}),
    ...(condition ? { condition } : {}),
    ...(rounds ? { rounds } : {}),
  };
}

// Damage and effects after "Hit:". Whatever comes after the save belongs to
// the save, so the hit's own dice are read from before it.
function parseHit(hit: string): { damage: string; type: string; onHit?: EnemyHitEffect } {
  const saveAt = hit.search(SAVE_RE);
  const before = saveAt < 0 ? hit : hit.slice(0, saveAt);
  const main = DICE_DAMAGE_RE.exec(before);
  const flat = main ? null : new RegExp(`^\\s*(\\d+) (${DAMAGE_WORD})\\b`, "i").exec(before);
  const riders = [...before.matchAll(RIDER_RE)];
  const parts = [main?.[1] ?? flat?.[1], ...riders.map((rider) => rider[1])].filter(
    (part): part is string => Boolean(part),
  );
  const damage = parts.map(compact).join("+");
  const types = [...new Set([main?.[2] ?? flat?.[2], ...riders.map((rider) => rider[2])].map((type) => type?.toLowerCase()))]
    .filter((type): type is string => Boolean(type) && type !== "damage");

  const condition = [...before.matchAll(HIT_CONDITION_RE)].find((match) => !match[1])?.[2].toLowerCase();
  const escape = /escape DC (\d+)|DC (\d+) Strength(?: \(Athletics\))? check/i.exec(hit);
  const save = saveAt < 0 ? null : parseSave(hit.slice(saveAt));
  const onHit: EnemyHitEffect = {
    ...(condition ? { condition } : {}),
    ...(condition && escape ? { escapeDc: Number(escape[1] ?? escape[2]) } : {}),
    ...(save ? { save } : {}),
  };
  return {
    damage: isValidExpression(damage) ? damage : "",
    type: types.join("/"),
    ...(Object.keys(onHit).length ? { onHit } : {}),
  };
}

// The old field-only reading, for rows whose text names no attack.
function fieldAttack(action: RawAction): EnemyAttack | null {
  const toHit = asNumber(action.attack_bonus);
  const dice = compact(asString(action.damage_dice));
  if (toHit === null || toHit <= 0 || !dice) {
    return null;
  }
  const bonus = asNumber(action.damage_bonus) ?? 0;
  const damage = bonus > 0 ? `${dice}+${bonus}` : bonus < 0 ? `${dice}-${Math.abs(bonus)}` : dice;
  if (!isValidExpression(damage)) {
    return null;
  }
  return { name: asString(action.name) || "Attack", toHit, damage, type: "untyped" };
}

function parseAttack(action: RawAction): EnemyAttack | null {
  const name = asString(action.name) || "Attack";
  const text = prose(action.desc);
  const header = ATTACK_RE.exec(text);
  const hitAt = text.search(/\bHit:/i);
  if (!header && hitAt < 0) {
    return fieldAttack(action);
  }
  // A block printed without "Melee Weapon Attack: +5 to hit" keeps its to-hit in the field.
  const toHit = header ? Number(header[2].replace(/\s+/g, "")) : asNumber(action.attack_bonus);
  if (toHit === null || (!header && toHit <= 0)) {
    return null;
  }
  const head = hitAt < 0 ? text : text.slice(0, hitAt);
  const hit = parseHit(hitAt < 0 ? text.slice(header!.index + header![0].length) : text.slice(hitAt + 4));
  const fallback = hit.damage || hit.onHit ? null : fieldAttack(action);
  if (!hit.damage && !hit.onHit && !fallback) {
    return null;
  }
  const kind = header?.[1].toLowerCase() ?? "";
  // Some blocks print the distance bare: "+8 to hit, 10 ft., one target".
  const bare = /to hit, (\d+) ft/i.exec(head);
  const reach = /reach (\d+) ft/i.exec(head) ?? (kind === "melee" ? bare : null);
  const range = /range (\d+)(?:\/(\d+))? ft/i.exec(head) ?? (kind === "ranged" ? bare : null);
  return {
    name,
    toHit,
    damage: hit.damage || fallback?.damage || "",
    type: hit.type || "untyped",
    ...(reach ? { reach: Number(reach[1]) } : {}),
    ...(range ? { range: Number(range[1]) } : {}),
    ...(range?.[2] ? { longRange: Number(range[2]) } : {}),
    ...limitOf(name),
    ...(hit.onHit ? { onHit: hit.onHit } : {}),
  };
}

// A breath weapon, a gaze, a frightful roar: an action that is a save.
function parseSaveAction(action: RawAction): EnemySaveAction | null {
  const name = asString(action.name);
  const text = prose(action.desc);
  const save = name ? parseSave(text) : null;
  if (!save) {
    return null;
  }
  const area = /(\d+)-foot[- ](cone|line|cube|sphere|radius|emanation)/i.exec(text);
  return {
    name,
    ...save,
    ...(area ? { area: `${area[1]}-foot ${area[2].toLowerCase()}` } : {}),
    ...limitOf(name),
  };
}

function traitLine(entry: RawAction): string | null {
  const name = asString(entry.name);
  const desc = asString(entry.desc).replace(/\s+/g, " ").trim();
  if (!name || !desc) {
    return null;
  }
  return `${name}: ${desc.length > TRAIT_CHARS ? `${desc.slice(0, TRAIT_CHARS - 3)}...` : desc}`;
}

function formatSpeed(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => typeof value === "number")
      .map(([mode, value]) => (mode === "walk" ? String(value) : `${mode} ${value}`))
      .join(", ");
  }
  return "30";
}

export function parseMonster(data: Record<string, unknown>, crFromRow: number): EnemyStats {
  const actions = Array.isArray(data.actions) ? (data.actions as RawAction[]) : [];
  const specials = Array.isArray(data.special_abilities)
    ? (data.special_abilities as RawAction[])
    : [];

  const attacks: EnemyAttack[] = [];
  const saves: EnemySaveAction[] = [];
  const nonAttackActions: RawAction[] = [];
  let attacksPerTurn = 1;
  for (const action of actions) {
    const attack = parseAttack(action);
    if (attack && attacks.length < MAX_ATTACKS) {
      attacks.push(attack);
    } else if (!attack) {
      if (/multiattack/i.test(String(action.name ?? ""))) {
        attacksPerTurn = parseMultiattackCount(String(action.desc ?? "")) ?? 2;
      }
      const save = parseSaveAction(action);
      if (save && saves.length < MAX_SAVES) {
        saves.push(save);
      }
      nonAttackActions.push(action);
    }
  }

  const traits: string[] = [];
  for (const entry of [...nonAttackActions, ...specials]) {
    if (traits.length >= MAX_TRAITS) {
      break;
    }
    const line = traitLine(entry);
    if (line) {
      traits.push(line);
    }
  }

  const dexterity = asNumber(data.dexterity) ?? 10;
  const cr = asNumber(data.cr) ?? crFromRow;
  const type = normalizeCreatureType(data.type);

  // Save modifiers: an explicit *_save field wins; otherwise the ability
  // modifier from the raw score.
  const abilityFields: Record<SaveAbility, [score: string, save: string]> = {
    str: ["strength", "strength_save"],
    dex: ["dexterity", "dexterity_save"],
    con: ["constitution", "constitution_save"],
    int: ["intelligence", "intelligence_save"],
    wis: ["wisdom", "wisdom_save"],
    cha: ["charisma", "charisma_save"],
  };
  const saveMods = Object.fromEntries(
    (Object.entries(abilityFields) as Array<[SaveAbility, [string, string]]>).map(
      ([ability, [scoreField, saveField]]) => {
        const explicit = asNumber(data[saveField]);
        if (explicit !== null) {
          return [ability, explicit];
        }
        const score = asNumber(data[scoreField]) ?? 10;
        return [ability, Math.floor((score - 10) / 2)];
      },
    ),
  ) as EnemySaveMods;

  return {
    ac: asNumber(data.armor_class) ?? 12,
    maxHp: Math.max(1, asNumber(data.hit_points) ?? 10),
    dexMod: Math.floor((dexterity - 10) / 2),
    saveMods,
    speed: formatSpeed(data.speed),
    attacks,
    ...(saves.length ? { saves } : {}),
    traits,
    resist: asString(data.damage_resistances),
    immune: asString(data.damage_immunities),
    vulnerable: asString(data.damage_vulnerabilities),
    conditionImmune: asString(data.condition_immunities),
    cr,
    xp: xpForCr(cr),
    attacksPerTurn,
    ...(asString(data.size) ? { size: asString(data.size) } : {}),
    ...(type ? { type } : {}),
    ...parseBlockExtras(data, abilityFields),
  };
}

// The rest of an Open5e block: scores, skills, senses, languages and
// alignment, so a monster started from the pack arrives with the whole
// printed block rather than the half the engine runs.
function parseBlockExtras(
  data: Record<string, unknown>,
  abilityFields: Record<SaveAbility, [score: string, save: string]>,
): Pick<EnemyStats, "abilities" | "skills" | "senses" | "languages" | "alignment"> {
  const abilities: Partial<Record<SaveAbility, number>> = {};
  for (const [ability, [scoreField]] of Object.entries(abilityFields) as Array<[SaveAbility, [string, string]]>) {
    const score = asNumber(data[scoreField]);
    if (score !== null) {
      abilities[ability] = score;
    }
  }
  const skills: Record<string, number> = {};
  const rawSkills = data.skills;
  if (rawSkills && typeof rawSkills === "object" && !Array.isArray(rawSkills)) {
    for (const [name, bonus] of Object.entries(rawSkills as Record<string, unknown>)) {
      const value = asNumber(bonus);
      if (value !== null) {
        skills[name.trim().toLowerCase().replace(/_/g, " ")] = value;
      }
    }
  }
  const sensesText = asString(data.senses);
  const senses: EnemySenses = {};
  for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"] as const) {
    const match = new RegExp(`${sense}\\s*(\\d+)`, "i").exec(sensesText);
    if (match) {
      senses[sense] = Number(match[1]);
    }
  }
  const passive = /passive perception\s*(\d+)/i.exec(sensesText);
  if (passive) {
    senses.passivePerception = Number(passive[1]);
  }
  return {
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
    ...(Object.keys(senses).length ? { senses } : {}),
    ...(asString(data.languages) ? { languages: asString(data.languages).slice(0, 200) } : {}),
    ...(asString(data.alignment) ? { alignment: asString(data.alignment).slice(0, 40) } : {}),
  };
}

// Size comparison for the grapple/shove cap: a creature can only grab or
// push a target at most one size larger than itself. Unknown sizes read as
// Medium so old stat snapshots stay grabbable.
const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

export function sizeRank(size: string | undefined): number {
  const index = SIZE_ORDER.indexOf((size ?? "").trim().toLowerCase());
  return index === -1 ? SIZE_ORDER.indexOf("medium") : index;
}

// Save modifier for an enemy, with a fallback for stat snapshots taken
// before saveMods existed: dex maps to the stored dexMod, everything else
// scales with CR.
export function saveModFor(stats: EnemyStats, ability: SaveAbility): number {
  const explicit = stats.saveMods?.[ability];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  if (ability === "dex") {
    return stats.dexMod;
  }
  return Math.min(5, Math.round(stats.cr * 0.3));
}

// An enemy's passive Perception: the 5e formula against its Wisdom. Used by
// the Hide action so a stealth roll is compared to something real rather
// than left to the model's judgement.
// The number a hiding character has to beat. The block's own printed
// passive Perception wins; then its Perception skill; then, for a block
// that says nothing, the Wisdom modifier as before.
export function passivePerceptionFor(stats: EnemyStats): number {
  const printed = stats.senses?.passivePerception;
  if (typeof printed === "number" && Number.isFinite(printed)) {
    return printed;
  }
  const perception = stats.skills?.perception;
  if (typeof perception === "number" && Number.isFinite(perception)) {
    return 10 + perception;
  }
  return 10 + saveModFor(stats, "wis");
}
