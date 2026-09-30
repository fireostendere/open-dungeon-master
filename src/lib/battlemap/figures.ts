// Which miniature stands in for a token on the battle map.
//
// The models come from the 3D bestiary (src/lib/bestiary3d), which picks a
// body plan from a monster's English name and type. The table names its
// creatures in Russian and whatever the narrator likes ("Тёмный культист"),
// so this turns a token's name into the input the bestiary understands: a
// few Russian stems are given their English name, the size the word implies
// is set, and a name nothing matches becomes a person of that name rather than
// an arbitrary beast.
//
// Pure data in, pure data out: no three.js and no DOM, so the node tests can
// check every mapping (scripts/test-battlemap-figures.mjs).

import { deriveCreatureSpec, type CreatureInput } from "@/lib/bestiary3d/spec";

export type FigureKind = "enemy" | "npc";

type Hint = {
  // Russian stem, matched anywhere in the lower-cased name.
  ru: RegExp;
  // What the bestiary calls it.
  en: string;
  type?: string;
  size?: string;
};

// JavaScript's \b only knows Latin letters, so Cyrillic word edges are spelled
// out. `stem` may start a word and run on ("гоблин" in "гоблины", "гоблин-лучник");
// `word` is a short word that must stand alone, in any case ("маг", "магом"),
// so it does not catch "магистр" or "левша".
const stem = (src: string) => new RegExp(`(?<![а-я])(?:${src})`);
const word = (src: string) => new RegExp(`(?<![а-я])(?:${src})(?:а|у|ы|ом|ов|е|и|ой|ам|ами)?(?![а-я])`);

// Order matters: the first rule that matches wins, so the specific comes
// before the general ("костяной дракон" before "дракон"). The name has had
// "ё" written as "е" before it is matched.
const HINTS: Hint[] = [
  { ru: stem("костян\\S* дракон|драколич"), en: "skeletal dragon", type: "undead", size: "huge" },
  { ru: stem("дракончик|драконид"), en: "pseudodragon", type: "dragon", size: "small" },
  { ru: stem("дракон|виверн"), en: "dragon", type: "dragon", size: "large" },
  { ru: stem("кобольд"), en: "kobold", type: "humanoid", size: "small" },
  { ru: stem("гоблин|хобгоблин"), en: "goblin", type: "humanoid", size: "small" },
  { ru: stem("полуорк|орк"), en: "orc", type: "humanoid" },
  { ru: stem("огр"), en: "ogre", type: "giant", size: "large" },
  { ru: stem("тролл"), en: "troll", type: "giant", size: "large" },
  { ru: stem("великан|гигант|титан|циклоп"), en: "giant", type: "giant", size: "huge" },
  { ru: stem("скелет|костяк"), en: "skeleton", type: "undead" },
  { ru: stem("зомби|мертвец|мертвяк|упыр|гуль"), en: "zombie", type: "undead" },
  { ru: stem("вампир"), en: "vampire", type: "undead" },
  { ru: word("лич"), en: "lich", type: "undead" },
  { ru: stem("призрак|привидени|банши|фантом"), en: "ghost", type: "undead" },
  { ru: word("тень|дух"), en: "ghost", type: "undead" },
  { ru: stem("мумия|мумии"), en: "mummy", type: "undead" },
  { ru: stem("волк|волч|варг|шакал|гиен|собак|гончая|гончие"), en: "wolf", type: "beast" },
  { ru: word("пес|псы"), en: "wolf", type: "beast" },
  { ru: stem("медвед"), en: "bear", type: "beast", size: "large" },
  { ru: stem("кабан|вепр"), en: "boar", type: "beast" },
  { ru: stem("льв|тигр|пантер|рысь|леопард"), en: "lion", type: "beast" },
  { ru: word("лев"), en: "lion", type: "beast" },
  { ru: stem("крыс"), en: "giant rat", type: "beast", size: "small" },
  { ru: stem("летуч\\S* мыш|нетопыр"), en: "giant bat", type: "beast" },
  { ru: stem("паук|тарантул"), en: "giant spider", type: "monstrosity" },
  { ru: stem("змея|змеи|змей|гадюк|кобра|питон"), en: "giant snake", type: "beast" },
  { ru: stem("скорпион"), en: "giant scorpion", type: "monstrosity" },
  { ru: stem("жук|скарабе|муравь"), en: "giant beetle", type: "beast" },
  { ru: stem("ворон|ястреб|орел|орлы|сова|птиц"), en: "raven", type: "beast", size: "small" },
  { ru: stem("слизь|слизен|студень|желе"), en: "ooze", type: "ooze" },
  { ru: stem("гриб|мицелий"), en: "myconid", type: "plant" },
  { ru: stem("древень|энты"), en: "treant", type: "plant", size: "huge" },
  { ru: stem("голем|конструкт"), en: "golem", type: "construct", size: "large" },
  { ru: stem("элементал"), en: "earth elemental", type: "elemental", size: "large" },
  { ru: stem("демон|тифлинг"), en: "demon", type: "fiend" },
  { ru: word("бес"), en: "demon", type: "fiend" },
  { ru: stem("дьявол|инфернал"), en: "devil", type: "fiend" },
  { ru: stem("гидра"), en: "hydra", type: "monstrosity", size: "huge" },
  { ru: stem("химер|мантикор"), en: "manticore", type: "monstrosity", size: "large" },
  { ru: stem("минотавр"), en: "minotaur", type: "monstrosity", size: "large" },
  { ru: stem("гарпи"), en: "harpy", type: "monstrosity" },
  { ru: stem("бехолдер|созерцател"), en: "beholder", type: "aberration", size: "large" },
  { ru: stem("мимик"), en: "mimic", type: "monstrosity" },
  { ru: stem("культист|фанатик|жрец|послушник|шаман"), en: "cultist", type: "humanoid" },
  { ru: stem("волшебник|чародей|колдун|ведьм|чернокнижник|некромант|алхимик"), en: "mage", type: "humanoid" },
  { ru: word("маг"), en: "mage", type: "humanoid" },
  { ru: stem("стражник|солдат|воин|наемник|гвардеец|легионер"), en: "guard", type: "humanoid" },
  { ru: word("страж"), en: "guard", type: "humanoid" },
  { ru: stem("бандит|разбойник|грабител|контрабандист|пират"), en: "bandit", type: "humanoid" },
  { ru: word("вор"), en: "bandit", type: "humanoid" },
  { ru: stem("лучник|стрелок|арбалетчик"), en: "scout", type: "humanoid" },
  { ru: stem("убийца|ассасин|шпион"), en: "assassin", type: "humanoid" },
  { ru: stem("рыцарь|паладин|капитан|командир|вожак|предводитель"), en: "knight", type: "humanoid" },
  { ru: stem("эльф|дроу"), en: "drow", type: "humanoid" },
  { ru: stem("дварф|гном"), en: "dwarf", type: "humanoid", size: "small" },
];

// The English names the bestiary's own rules already read; a token named in
// English passes straight through.
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/g, "-")
      .replace(/^-+|-+$/g, "") || "creature"
  );
}

// What a person at the table might type: the case and the stray marks off.
function clean(name: string): string {
  return name.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function figureInput(kind: FigureKind, name: string): CreatureInput {
  const text = clean(name);
  const hint = HINTS.find((h) => h.ru.test(text));
  if (hint) {
    return {
      slug: slugify(name),
      // English first, so the bestiary's keyword rules read it; the original
      // follows so two differently named goblins still differ a little.
      name: `${hint.en} ${text}`,
      type: hint.type ?? "humanoid",
      size: hint.size ?? "medium",
    };
  }
  // Nothing matched. An English name may still be one the bestiary knows
  // ("Giant Spider", "Wolf"), so try the kinds of creature it could be until
  // one of its own name rules recognises it; the type it needs to agree with
  // is not known here.
  for (const type of GUESS_TYPES) {
    const probe = deriveCreatureSpec({ slug: slugify(name), name: text, type, size: "medium" });
    if (probe.matchedBy === "name") {
      return { slug: slugify(name), name: text, type, size: "medium" };
    }
  }
  // Still nothing: it is a person, which reads as a figure and never as a
  // random eyeball or ooze.
  return {
    slug: slugify(name),
    name: text,
    type: "humanoid",
    size: "medium",
  };
}

// In the order a stray English name most likely belongs: animals first, then
// people, then the rest.
const GUESS_TYPES = ["beast", "humanoid", "undead", "giant", "dragon", "fiend", "elemental", "monstrosity", "aberration", "ooze", "plant", "construct"] as const;

// How large the figure draws next to a one-square medium creature.
const DRAW_SCALE: Record<string, number> = {
  tiny: 0.6,
  small: 0.8,
  medium: 1,
  large: 1.3,
  huge: 1.6,
  gargantuan: 1.9,
  titanic: 2.2,
};

export function figureScale(size: string): number {
  return DRAW_SCALE[size] ?? 1;
}

// One sprite per creature the bestiary would build the same way: two
// goblins are one model, and the cache is keyed to match.
export function figureKey(kind: FigureKind, name: string): string {
  const input = figureInput(kind, name);
  return `${kind}:${input.name}:${input.type}:${input.size}`;
}
