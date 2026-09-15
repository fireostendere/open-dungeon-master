import {
  buildDmMessages as buildCoreDmMessages,
  buildDmSystem as buildCoreDmSystem,
} from "@/lib/dm/prompt-core";

export * from "@/lib/dm/prompt-core";

type CampaignLanguage = "ru" | "en";

const LANGUAGE_BLOCK = /Language and Measurement Units:\n[\s\S]*?(?=\n\n|$)/;

function languageStandards(language: CampaignLanguage): string {
  if (language === "ru") {
    return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in Russian (на русском языке), unless players explicitly write in English.
- Always use the metric system for distances, sizes, ranges, and weights: 5 feet = 1.5 метра, 10 feet = 3 метра, 30 feet = 9 метров, and 1 lb ≈ 0.45 кг.
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional forms.
- Preserve proper nouns, spell names, and official D&D terms in English when there is no established Russian equivalent.`;
  }

  return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in English. Keep the session consistently in English unless a player explicitly asks for another language in-character or out-of-character.
- Use metric units by default for distances, sizes, ranges, and weights: 5 feet = 1.5 meters, 10 feet = 3 meters, 30 feet = 9 meters, and 1 pound is approximately 0.45 kilograms.
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional English forms.
- Keep proper nouns, spell names, class names, conditions, and official D&D terminology in their standard English forms. Do not introduce Cyrillic text into English narration unless you are reproducing player-supplied text or a proper noun that intentionally uses Cyrillic.`;
}

function explicitLanguage(value: unknown): CampaignLanguage | null {
  return value === "en" || value === "ru" ? value : null;
}

function inferredLanguage(history: Parameters<typeof buildCoreDmMessages>[1]): CampaignLanguage {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.authorType === "dm") continue;
    if (/[А-Яа-яЁё]/.test(message.content)) return "ru";
    if (/[A-Za-z]/.test(message.content)) return "en";
  }
  return "ru";
}

function localizeLanguageBlock(text: string, language: CampaignLanguage): string {
  const replacement = languageStandards(language);
  if (LANGUAGE_BLOCK.test(text)) return text.replace(LANGUAGE_BLOCK, replacement);
  return `${text}\n\n${replacement}`;
}

export function buildDmSystem(
  ...args: Parameters<typeof buildCoreDmSystem>
): ReturnType<typeof buildCoreDmSystem> {
  const [campaign] = args;
  const language = explicitLanguage(campaign.gameSettings.language) ?? "ru";
  return localizeLanguageBlock(buildCoreDmSystem(...args), language);
}

export function buildDmMessages(
  ...args: Parameters<typeof buildCoreDmMessages>
): ReturnType<typeof buildCoreDmMessages> {
  const [state, history] = args;
  const language = explicitLanguage(state.campaign.gameSettings.language) ?? inferredLanguage(history);
  const messages = buildCoreDmMessages(...args);
  return messages.map((message) => {
    if (message.role !== "system" || typeof message.content !== "string") return message;
    return { ...message, content: localizeLanguageBlock(message.content, language) };
  }) as ReturnType<typeof buildCoreDmMessages>;
}
