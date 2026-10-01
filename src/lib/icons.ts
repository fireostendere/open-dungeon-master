// Painted icons (public/assets/icons, ported from upstream's icon set).
//
// An icon is addressed by what it is and what it is called, the same way the
// catalogue keys it: a spell or a class feature by its name, an item by its
// name, an option by its kind and name, a condition or an action by its id.
// The path is computed, not looked up in the full manifest; a small index of
// the painted slugs (painted-icons.json, every folder including the glyphs)
// says which files exist, so a name with no painting (homebrew, a Russian
// name the narrator made up, a pack item beyond the SRD) is skipped for its
// family's icon, then for nothing, and never asked of the server. A file
// that still fails to load is remembered for the session (markIconFailed),
// so the next row naming it does not ask again.
// Pure, so scripts/test-icons.mjs drives it.

import paintedIcons from "@/lib/painted-icons.json";

export type IconKind = "spell" | "item" | "feature" | "option" | "feat" | "condition" | "action" | "glyph" | "family";

// The catalogue's slug rule, kept identical to upstream's scripts/icon-set.mjs.
export function iconSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Things the engine offers that the catalogue never painted, each lent the
// painting closest in meaning so the screen does not ask for a file that is
// not there.
const ICON_ALIASES: Record<string, { kind: IconKind; slug: string }> = {
  "action/search": { kind: "glyph", slug: "skill-perception" },
  "action/escape": { kind: "feature", slug: "escape-artist" },
  "feature/flurry-of-blows": { kind: "feature", slug: "martial-arts" },
};

export function iconPath(kind: IconKind, key: string): string {
  const slug = iconSlug(key);
  const alias = ICON_ALIASES[`${kind}/${slug}`];
  return alias ? `/assets/icons/${alias.kind}/${alias.slug}.webp` : `/assets/icons/${kind}/${slug}.webp`;
}

// Families: spell-<school>, item-<kind>, class-<classId>, option-<kind>, damage-<type>.
export function familyIconPath(family: string): string {
  return iconPath("family", family);
}

export type IconRef = { kind: IconKind; key: string; family?: string | null };

const PAINTED: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(paintedIcons as Record<string, string[]>).map(([kind, slugs]) => [kind, new Set(slugs)]),
);

// Whether the file an icon path names is one the catalogue painted.
export function isPainted(src: string): boolean {
  const match = /^\/assets\/icons\/([a-z]+)\/([^/]*)\.webp$/.exec(src);
  if (!match) return true;
  return PAINTED[match[1]]?.has(match[2]) ?? false;
}

// Paths that failed to load this session (a deploy in flight, a proxy
// hiccup). A list of thirty rows naming one broken file asks for it once.
const FAILED = new Set<string>();

export function markIconFailed(src: string): void {
  FAILED.add(src);
}

// The paths to try, in order: only the paintings that exist and have not
// already failed.
export function iconCandidates(ref: IconRef): string[] {
  const paths = [iconPath(ref.kind, ref.key)];
  if (ref.family) paths.push(familyIconPath(ref.family));
  return paths.filter((src) => isPainted(src) && !FAILED.has(src));
}

// Conditions arrive as free text: "exhaustion 2", "Hidden", "poisoned by the
// dart", or a Russian word the narrator chose. The painted condition whose
// id the text starts with, else a Russian stem of a condition, else the text
// itself (which then finds no painting and draws nothing).
const RU_CONDITION_STEMS: Array<[string, string]> = [
  ["ослеп", "blinded"],
  ["очаров", "charmed"],
  ["оглох", "deafened"],
  ["истощ", "exhaustion"],
  ["испуг", "frightened"],
  ["напуг", "frightened"],
  ["схвач", "grappled"],
  ["недеесп", "incapacitated"],
  ["невидим", "invisible"],
  ["парализ", "paralyzed"],
  ["окамен", "petrified"],
  ["отравл", "poisoned"],
  ["сбит", "prone"],
  ["опутан", "restrained"],
  ["ошелом", "stunned"],
  ["оглуш", "stunned"],
  ["без сознания", "unconscious"],
  ["бессозн", "unconscious"],
  ["концентр", "concentrating"],
  ["ярост", "raging"],
  ["спрят", "hidden"],
  ["скрыт", "hidden"],
  ["уклон", "dodging"],
  ["благослов", "blessed"],
  ["проклят", "cursed"],
  ["ускорен", "hasted"],
  ["замедл", "slowed"],
  ["полёт", "flying"],
  ["полет", "flying"],
];

export function conditionIconKey(condition: string): string {
  const text = condition.trim().toLowerCase();
  const head = text.split(/[\s:(,]/)[0] ?? "";
  if (PAINTED.condition?.has(head)) return head;
  for (const [stem, id] of RU_CONDITION_STEMS) {
    if (text.startsWith(stem)) return id;
  }
  return text;
}

// A plain system line in the chat carries no type, only its words, so its
// painting is picked from them (upstream's sessionGlyphs.ts, with Russian
// words beside the English). A die is matched after a count too ("2d6").
// The first match wins; the bell is the catch-all.
const SYSTEM_LINE_RULES: Array<[RegExp, string]> = [
  [/(?<![a-z])d100\b|\bpercentile\b/i, "die-d100"],
  [/(?<![a-z])d12\b/i, "die-d12"],
  [/(?<![a-z])d10\b/i, "die-d10"],
  [/(?<![a-z])d8\b/i, "die-d8"],
  [/(?<![a-z])d6\b/i, "die-d6"],
  [/(?<![a-z])d4\b/i, "die-d4"],
  [/(?<![a-z])d20\b|\b(rolls?|rolled|rerolls?|dice|saving throw|check)\b|бросок|бросил|бросает|кубик|кост[иья]|спасбросок|проверк/i, "die-d20"],
  [/\blevel(s|ed)? up\b|\breach(es|ed)? level\b|нов(ый|ого) уров|уровень повышен|достиг(ает|ла|ли)? \d+ уров/i, "rest-level-up"],
  [/\blong rest\b|долг(ий|ого|им) отдых/i, "rest-long"],
  [/\bshort rest\b|\brests?\b|коротк(ий|ого|им) отдых|отдых/i, "rest-short"],
  [/\b(dies|died|death|slain|falls unconscious|fallen)\b|погиб|умер|смерт|теряет сознание/i, "cue-death"],
  [/\b(heals?|healed|recovers?|stabili[sz]ed?)\b|исцел|лечени|восстанавлива|стабилиз/i, "cue-heal"],
  [/\b(combat|initiative|encounter|battle|ambush|fight)\b|бой|боя|инициатив|сражени|засад/i, "cue-battle"],
  [/\b(gold|coins?|gp|sp|cp|paid|buys?|sells?|sold|bought)\b|золот|монет|купил|продал|заплатил/i, "cue-coin"],
  [/\b(travel(s|led)?|arrives?|arrived|journey|sets? out|departs?)\b|путешеств|прибы|отправля|в путь/i, "cue-travel"],
  [/\b(x-card|paused|pause)\b|пауза|приостанов/i, "cue-calm"],
];

export function systemLineGlyph(content: string): string {
  for (const [pattern, glyph] of SYSTEM_LINE_RULES) {
    if (pattern.test(content)) return glyph;
  }
  return "cue-bell";
}
