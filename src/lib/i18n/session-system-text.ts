import type { Locale } from "./translations";
import { GAME_TEXT, gameText, type GameTextKey } from "./game-text";
import { characterDisplay } from "./character-display";

const KNOWN: Record<string, Record<Locale, string>> = {
  "This world has no AI storyteller configured.": {
    en: "This world has no AI storyteller configured.", ru: "Для этого мира не настроен ИИ-ведущий.",
  },
  "The party is assembled and the adventure begins. The Dungeon Master opens the scene.": {
    en: "The party is assembled and the adventure begins. The Dungeon Master opens the scene.", ru: "Отряд собран, и приключение начинается. Мастер открывает первую сцену.",
  },
  "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.": {
    en: "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.", ru: "Отряд собран, и приключение начинается. Представьте первую сцену, завязку и первый выбор отряда.",
  },
};
const PROBLEM_PREFIX = "The DM ran into a problem: ";

function known(value: string, locale: Locale): string | null {
  if (Object.hasOwn(KNOWN, value)) return KNOWN[value][locale];
  for (const key of Object.keys(GAME_TEXT.en) as GameTextKey[]) {
    // Static, server-generated notices only. Never translate a player's prose.
    if (!GAME_TEXT.en[key].includes("{") && Object.values(GAME_TEXT).some(catalog => catalog[key] === value)) return gameText(locale, key);
  }
  return null;
}

/** UI-only projection: persisted content and retry/lead markers stay untouched. */
export function displaySystemText(value: string, locale: Locale): string {
  if (value.startsWith(PROBLEM_PREFIX)) {
    const detail = value.slice(PROBLEM_PREFIX.length);
    const prefix = locale === "ru" ? "Мастер столкнулся с проблемой: " : PROBLEM_PREFIX;
    // Unknown provider diagnostics remain in the stored notice, not as an
    // unlocalized internal error in player chat. The retry link is unchanged.
    return prefix + (known(detail, locale) ?? (locale === "en" ? detail : gameText(locale, "unknownFailure")));
  }
  const exact = known(value, locale);
  if (exact) return exact;
  const next = /^It is now (.+)'s turn \(round (\d+)\)\.$/.exec(value);
  if (next) return gameText(locale, "nextTurn", { name: next[1], round: next[2] });
  const end = /^(.+?) ends their turn\.(?: It is now (.+)'s turn\.)?$/.exec(value);
  if (end) return gameText(locale, "endTurn", { name: end[1] }) + (end[2] ? " " + gameText(locale, "nextTurnShort", { name: end[2] }) : "");
  const skip = /^The party lead skipped (.+?)'s turn\.(?: It is now (.+)'s turn\.)?$/.exec(value);
  if (skip) return gameText(locale, "skipTurn", { name: skip[1] }) + (skip[2] ? " " + gameText(locale, "nextTurnShort", { name: skip[2] }) : "");
  const left = /^(.+?) left the fight\.(?: It is now (.+)'s turn\.)?$/.exec(value);
  if (left) return gameText(locale, "leftFight", { name: left[1] }) + (left[2] ? " " + gameText(locale, "nextTurnShort", { name: left[2] }) : "");
  // Timed conditions running out, several sentences to one notice.
  if (locale !== "en" && / \(the effect ran its course\)\.| save \d+ vs DC \d+\)\./.test(value)) {
    const condition = (name: string) => characterDisplay(name, locale);
    return value
      .replace(/(\s*)([^.]+?) is no longer ([\w -]+?) \(the effect ran its course\)\./g, (_, space, name, cond) =>
        space + gameText(locale, "conditionEnded", { name, condition: condition(cond) }))
      .replace(/(\s*)([^.]+?) stays ([\w -]+?) \((\w+) save (\d+) vs DC (\d+)\)\./g, (_, space, name, cond, ability, total, dc) =>
        space + gameText(locale, "conditionStays", { name, condition: condition(cond), ability: characterDisplay(ability.toLowerCase(), locale), total, dc }));
  }
  return value;
}
