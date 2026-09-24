// Pure Ask helpers; no alias imports, so regression scripts can load this directly.
export const ASK_SCOPES = ["story", "rules", "sheet"] as const;
export type AskScope = (typeof ASK_SCOPES)[number];
export const ASK_VISIBILITIES = ["private", "table"] as const;
export type AskVisibility = (typeof ASK_VISIBILITIES)[number];
export const QUESTION_MAX_CHARS = 500;
export type AskCitation = { kind: string; ref: string; quote: string };
export type AskResult = { answer: string; citations: AskCitation[] };

export function isAskScope(value: unknown): value is AskScope {
  return ASK_SCOPES.includes(value as AskScope);
}
export function clampQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX_CHARS);
}

const RULES_HINT = /\b(rule|rules|how do(es)?|mechanic|advantage|disadvantage|grapple|grappling|opportunity attack|concentration|save|saving throw|proficienc|initiative|condition|exhaustion|cover|stealth rules|resistance|attunement|short rest|long rest|spell slot|ritual|counterspell|difficulty class|dc|ac)\b/i;
const SHEET_HINT = /\b(my|mine|i have|do i|can i|am i|my character|my sheet|my spells?|my inventory|my gold|my hp|my ac|my level|know how to|proficient|trained in)\b/i;

// JavaScript \b is ASCII-based: it cannot delimit Cyrillic words. These
// classifiers only select evidence, never execute an action or finish a turn.
function russianWords(pattern: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${pattern})(?=$|[^\\p{L}\\p{N}_])`, "iu");
}
const RULES_HINT_RU = russianWords([
  "правил[а-яё]*", "механик[а-яё]*", "как\\s+работа[а-яё]*",
  "преимуществ[а-яё]*", "помех[а-яё]*", "захват[а-яё]*", "спасброс[а-яё]*",
  "концентрац[а-яё]*", "инициатив[а-яё]*", "истощени[а-яё]*", "укрыти[а-яё]*",
  "сопротивлени[а-яё]*", "настройк[а-яё]*", "ритуал[а-яё]*", "контрзаклинани[а-яё]*",
  "атак[а-яё]*\\s+по\\s+возможност[а-яё]*", "ячейк[а-яё]*\\s+заклинани[а-яё]*",
  "(?:коротк[а-яё]*|долг[а-яё]*)\\s+отдых[а-яё]*",
  "(?:основн[а-яё]*|бонусн[а-яё]*|дополнительн[а-яё]*)\\s+действи[а-яё]*",
  "класс\\s+(?:защиты|доспеха|сложности)", "сложност[а-яё]*\\s+проверк[а-яё]*",
].join("|"));
const SHEET_HINT_RU = russianWords([
  "у\\s+меня", "мо(?:й|я|ё|е|и|его|ему|им|ю|ей|их|ими)",
  "могу(?:\\s+ли)?\\s+я", "умею(?:\\s+ли)?\\s+я",
  "знаю(?:\\s+ли)?\\s+я", "владею(?:\\s+ли)?\\s+я",
  "есть\\s+ли\\s+у\\s+меня", "лист\\s+персонажа",
].join("|"));

export function inferScope(question: string): AskScope {
  // Character-specific evidence wins: available resources matter when asking
  // "Мастер, могу ли я ещё атаковать?". The question itself is not an attack.
  if (SHEET_HINT.test(question) || SHEET_HINT_RU.test(question)) return "sheet";
  if (RULES_HINT.test(question) || RULES_HINT_RU.test(question)) return "rules";
  return "story";
}

const RECALL_HINT = /\b(earlier|previous|previously|before|past|history|remember|recall|happened|ago|last time|back then|who|where|when|whose|lore|chapter|said|promised|owe)\b/i;
const RECALL_HINT_RU = russianWords([
  "раньше", "прежде", "ранее", "помни[а-яё]*", "вспомни[а-яё]*",
  "прошл[а-яё]*", "предыдущ[а-яё]*", "назад", "истори[а-яё]*",
  "произош[а-яё]*", "случил[а-яё]*", "обеща[а-яё]*", "сказа[а-яё]*",
  "кто", "где", "когда", "чей", "чья", "чьё", "чье", "чьи", "глав[а-яё]*",
].join("|"));
const QUESTION_WORDS = new Set([
  "what", "when", "where", "who", "why", "how", "can", "does", "do", "is",
  "are", "was", "were", "tell", "please", "should", "could", "would", "will",
  "may", "did", "the", "and", "but", "my", "our", "their", "his", "her",
  "что", "когда", "где", "кто", "почему", "зачем", "как", "какой", "какая",
  "какое", "какие", "можно", "могу", "умею", "знаю", "сколько", "есть",
  "мастер", "ведущий", "скажи", "расскажи", "объясни", "пожалуйста",
  "мой", "моя", "моё", "мое", "мои", "наш", "наша", "наше", "наши",
]);

export function shouldSearchArchive(question: string, force = false): boolean {
  if (force || RECALL_HINT.test(question) || RECALL_HINT_RU.test(question)) return true;
  const words = question.match(/(?<![\p{L}\p{N}_])\p{Lu}\p{Ll}{2,}(?![\p{L}\p{N}_])/gu) ?? [];
  return words.some(word => !QUESTION_WORDS.has(word.toLowerCase()));
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function parseAskJson(raw: string): AskResult | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(withoutFence.slice(start, end + 1)); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const answer = asString(record.answer, 4_000);
  if (!answer) return null;
  const rawCitations = Array.isArray(record.citations) ? record.citations : [];
  const citations: AskCitation[] = [];
  for (const entry of rawCitations.slice(0, 8)) {
    if (!entry || typeof entry !== "object") continue;
    const citation = entry as Record<string, unknown>;
    const quote = asString(citation.quote, 400);
    if (!quote) continue;
    citations.push({ kind: asString(citation.kind, 40) || "record", ref: asString(citation.ref, 120), quote });
  }
  return { answer, citations };
}
