import type { Locale } from "./translations";

const KNOWN: Record<string, Record<Locale, string>> = {
  "This world has no AI storyteller configured.": {
    en: "This world has no AI storyteller configured.", ru: "Для этого мира не настроен ИИ-ведущий.", pl: "Ten świat nie ma skonfigurowanego prowadzącego AI.",
  },
  "The party is assembled and the adventure begins. The Dungeon Master opens the scene.": {
    en: "The party is assembled and the adventure begins. The Dungeon Master opens the scene.", ru: "Отряд собран, и приключение начинается. Мастер открывает первую сцену.", pl: "Drużyna jest gotowa, a przygoda się zaczyna. Mistrz Gry otwiera scenę.",
  },
  "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.": {
    en: "The party is assembled and the adventure begins. Introduce the opening scene, set the premise, and give the party their first decision.", ru: "Отряд собран, и приключение начинается. Представьте первую сцену, завязку и первый выбор отряда.", pl: "Drużyna jest gotowa, a przygoda się zaczyna. Przedstaw pierwszą scenę, założenie i pierwszą decyzję drużyny.",
  },
};

const PROBLEM_PREFIX = "The DM ran into a problem: ";

export function displaySystemText(value: string, locale: Locale): string {
  const problem = value.startsWith(PROBLEM_PREFIX) ? value.slice(PROBLEM_PREFIX.length) : "";
  const key = problem || value;
  if (!Object.hasOwn(KNOWN, key)) return value;
  const translated = KNOWN[key];
  const prefix = problem
    ? locale === "ru" ? "Мастер столкнулся с проблемой: " : locale === "pl" ? "Mistrz Gry napotkał problem: " : PROBLEM_PREFIX
    : "";
  return `${prefix}${translated[locale]}`;
}
