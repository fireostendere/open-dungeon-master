import {
  buildDmMessages as buildCoreDmMessages,
  buildDmSystem as buildCoreDmSystem,
} from "@/lib/dm/prompt-core";

export * from "@/lib/dm/prompt-core";

type CampaignLanguage = "ru" | "en" | "pl";
type CampaignUnitSystem = "metric" | "imperial";

const LANGUAGE_BLOCK = /Language and Measurement Units:\n[\s\S]*?(?=\n\n|$)/;

function languageStandards(language: CampaignLanguage, unitSystem: CampaignUnitSystem = "metric"): string {
  if (unitSystem === "imperial") {
    if (language === "ru") {
      return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in Russian (на русском языке), unless players explicitly write in another language.
- Use the IMPERIAL SYSTEM for distances, sizes, ranges, and weights: feet (футы, 5 футов = 1 клетка на карте, 30 футов = скорость) and pounds (фунты/lbs).
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional forms.
- Preserve proper nouns, spell names, and official D&D terms in English when there is no established Russian equivalent.`;
    }

    if (language === "pl") {
      return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in Polish (po polsku). Keep the session consistently in Polish unless a player explicitly asks for another language in-character or out-of-character.
- Use imperial units for distances, sizes, ranges, and weights: feet (stopy, 5 stóp = 1 kratka na mapie, 30 stóp = standardowa prędkość) and pounds (funty).
- Use established Polish D&D terminology where it exists. Standard mechanical abbreviations and proper nouns may remain in their conventional forms when translating them would make the rules less clear.
- Do not introduce Russian or Cyrillic text into Polish narration unless you are reproducing player-supplied text or a proper noun that intentionally uses Cyrillic.`;
    }

    return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in English. Keep the session consistently in English unless a player explicitly asks for another language in-character or out-of-character.
- Use imperial units for distances, sizes, ranges, and weights: feet (5 feet = 1 map tile, 30 feet = standard speed) and pounds (lbs).
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional English forms.
- Keep proper nouns, spell names, class names, conditions, and official D&D terminology in their standard English forms. Do not introduce Cyrillic text into English narration unless you are reproducing player-supplied text or a proper noun that intentionally uses Cyrillic.`;
  }

  // Metric system (default: meters and kilograms)
  if (language === "ru") {
    return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in Russian (на русском языке), unless players explicitly write in another language.
- Always use the METRIC SYSTEM for distances, sizes, ranges, and weights: 5 feet = 1.5 метра (1 клетка), 10 feet = 3 метра, 30 feet = 9 метров, and 1 lb ≈ 0.45 кг.
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional forms.
- Preserve proper nouns, spell names, and official D&D terms in English when there is no established Russian equivalent.`;
  }

  if (language === "pl") {
    return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in Polish (po polsku). Keep the session consistently in Polish unless a player explicitly asks for another language in-character or out-of-character.
- Use metric units by default for distances, sizes, ranges, and weights: 5 feet = 1.5 metra, 10 feet = 3 metry, 30 feet = 9 metrów, and 1 pound is approximately 0.45 kilograma.
- Use established Polish D&D terminology where it exists. Standard mechanical abbreviations and proper nouns may remain in their conventional forms when translating them would make the rules less clear.
- Do not introduce Russian or Cyrillic text into Polish narration unless you are reproducing player-supplied text or a proper noun that intentionally uses Cyrillic.`;
  }

  return `Language and Measurement Units:
- Always narrate, describe scenes, answer actions, and voice NPCs in English. Keep the session consistently in English unless a player explicitly asks for another language in-character or out-of-character.
- Use metric units by default for distances, sizes, ranges, and weights: 5 feet = 1.5 meters, 10 feet = 3 meters, 30 feet = 9 meters, and 1 pound is approximately 0.45 kilograms.
- Standard D&D abbreviations such as HP, AC, DC, STR, DEX, CON, INT, WIS, and CHA may stay in their conventional English forms.
- Keep proper nouns, spell names, class names, conditions, and official D&D terminology in their standard English forms. Do not introduce Cyrillic text into English narration unless you are reproducing player-supplied text or a proper noun that intentionally uses Cyrillic.`;
}

function explicitLanguage(value: unknown): CampaignLanguage | null {
  return value === "en" || value === "ru" || value === "pl" ? value : null;
}

function inferredLanguage(history: Parameters<typeof buildCoreDmMessages>[1]): CampaignLanguage {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.authorType === "dm") continue;
    if (/[А-Яа-яЁё]/.test(message.content)) return "ru";
    if (/[ĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(message.content)) return "pl";
    if (/[A-Za-z]/.test(message.content)) return "en";
  }
  return "ru";
}

function localizeLanguageBlock(
  text: string,
  language: CampaignLanguage,
  unitSystem: CampaignUnitSystem = "metric"
): string {
  const replacement = languageStandards(language, unitSystem);
  if (LANGUAGE_BLOCK.test(text)) return text.replace(LANGUAGE_BLOCK, replacement);
  return `${text}\n\n${replacement}`;
}

export function buildDmSystem(
  ...args: Parameters<typeof buildCoreDmSystem>
): ReturnType<typeof buildCoreDmSystem> {
  const [campaign] = args;
  const language = explicitLanguage(campaign.gameSettings.language) ?? "ru";
  const unitSystem = campaign.gameSettings.unitSystem === "imperial" ? "imperial" : "metric";
  return localizeLanguageBlock(buildCoreDmSystem(...args), language, unitSystem);
}

export function buildDmMessages(
  ...args: Parameters<typeof buildCoreDmMessages>
): ReturnType<typeof buildCoreDmMessages> {
  const [state, history] = args;
  const language = explicitLanguage(state.campaign.gameSettings.language) ?? inferredLanguage(history);
  const unitSystem = state.campaign.gameSettings.unitSystem === "imperial" ? "imperial" : "metric";
  const messages = buildCoreDmMessages(...args);
  return messages.map((message) => {
    if (message.role !== "system" || typeof message.content !== "string") return message;
    return { ...message, content: localizeLanguageBlock(message.content, language, unitSystem) };
  }) as ReturnType<typeof buildCoreDmMessages>;
}
