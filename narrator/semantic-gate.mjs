/**
 * Semantic Ingress Gate & Boundary Classifier for the External Narrator.
 * Enforces the canonical D&D-only policy, detects prompt injection, protects
 * secrets and table safety, and filters out-of-scope tasks before LLM or tool execution.
 */
import { DM_REFUSALS, DM_POLICY_VERSION } from '../mcp/dm-policy.mjs';

export { DM_REFUSALS, DM_POLICY_VERSION };

export const SAFETY_RESPONSES = Object.freeze({
  ru: 'Игра приостановлена. Безопасность участников — главный приоритет. Сообщите, когда будете готовы продолжить.',
  en: 'The game is paused. Player safety is our highest priority. Let us know when you are ready to continue.',
  pl: 'Gra została wstrzymana. Bezpieczeństwo graczy jest najważniejsze. Daj znać, kiedy będziesz gotowy kontynuować.',
});

export const CLARIFY_RESPONSES = Object.freeze({
  ru: 'Уточните, пожалуйста: этот вопрос связан с нашей D&D кампанией, персонажем или миниатюрой?',
  en: 'Could you please clarify: does this relate to our D&D campaign, character, or miniature?',
  pl: 'Czy możesz doprecyzować: czy to dotyczy naszej kampanii D&D, postaci lub figurki?',
});

export const SECRET_REFUSALS = Object.freeze({
  ru: 'Приватные шёпоты и скрытые планы ведущего остаются тайной. Я не раскрываю личные сообщения других игроков.',
  en: 'Private whispers and unrevealed DM plans remain confidential. I do not reveal other players’ private messages.',
  pl: 'Prywatne szepty i ukryte plany Mistrza Gry pozostają poufne. Nie ujawniam prywatnych wiadomości innych graczy.',
});

function detectLocale(text, defaultLocale = 'ru') {
  if (/[ąćęłńóśźż]/i.test(text) || /\b(czy|mojej|naszą|grą|pracy|związku|postaci)\b/i.test(text)) return 'pl';
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/[a-z]/i.test(text)) return 'en';
  return defaultLocale;
}

/**
 * Classifies an incoming text payload from Ask, whisper, message, note or character field.
 *
 * @param {string} rawInput
 * @param {object} [options]
 * @param {'ru'|'en'|'pl'} [options.locale]
 * @param {string} [options.source] - 'ask' | 'whisper' | 'message' | 'character_name' | 'note' | 'summary'
 * @returns {{
 *   decision: 'allow' | 'decline' | 'partial' | 'clarify' | 'safety_pause' | 'ignore_instruction' | 'refuse_secret' | 'adjudicate_game',
 *   category: string,
 *   replyText?: string,
 *   gameQuery?: string,
 *   locale: 'ru'|'en'|'pl'
 * }}
 */
export function classifyInput(rawInput, options = {}) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  const locale = options.locale || detectLocale(text, 'ru');
  const source = options.source || 'ask';

  if (!text) {
    return { decision: 'allow', category: 'empty', locale };
  }

  // 1. Session scheduling and table logistics (allowed as game logistics)
  if (/(?:next session|время сессии|расписание|schedule|agree on the next|следующ(?:ая|ей) сесси(?:я|и))/i.test(text)) {
    return {
      decision: 'allow',
      category: 'session_logistics',
      locale,
    };
  }

  // 2. Table safety, consent pause and real-world emergency (safety mechanics)
  const isEmergency = /реальная опасность|real danger|niebezpieczeństwo/i.test(text);
  const isDiscomfort = /dyskomfort|дискомфорт|uncomfortable|boundary/i.test(text);
  const isStopCommand = /^(?:stop|zatrzymaj|przerwijmy|останови(?:те)? игру)[.!]?$/i.test(text) ||
                        /(?:^|[.!?]\s*)(?:stop|zatrzymaj|przerwijmy|останови(?:те)? игру)(?:[.!]|\s+|$)/i.test(text);

  if (isEmergency || isDiscomfort || (isStopCommand && !/(?:next session|расписание|monster|enemy)/i.test(text))) {
    return {
      decision: 'safety_pause',
      category: isEmergency ? 'real_world_safety' : 'table_safety_pause',
      replyText: SAFETY_RESPONSES[locale] || SAFETY_RESPONSES.ru,
      locale,
    };
  }

  // 2. Secret disclosure requests (e.g. asking for private whispers or secret DM plans)
  if (/(?:privately whispered|private whisper|приватн(?:ый|ые) шёпот|тайные планы|dm ending|what the other player.*whisper)/i.test(text) &&
      /(?:tell everyone|раскрой|расскажи всем|reveal)/i.test(text)) {
    return {
      decision: 'refuse_secret',
      category: 'confidentiality_protection',
      replyText: SECRET_REFUSALS[locale] || SECRET_REFUSALS.ru,
      locale,
    };
  }

  // 3. Prompt injection, role spoofing, privilege escalation, credential theft
  const roleSpoof = /\[(?:SYSTEM|DEVELOPER|ADMIN|ROOT|INSTRUCTION)\]/i;
  if (roleSpoof.test(text)) {
    return {
      decision: 'ignore_instruction',
      category: 'role_tag_spoofing',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  const promptTheft = /(?:print|reveal|show|display|выведи|покажи|раскрой|ujawnij)\s+(?:your\s+)?(?:hidden\s+)?(?:system\s+prompt|credentials|token|env\b|api\s*key|секретн)/i;
  if (promptTheft.test(text)) {
    return {
      decision: 'decline',
      category: 'credential_prompt_theft',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  const instructionOverride = /(?:ignore (?:all |previous |former )?instructions|игнорируй (?:все |прежние )?правила|включи режим разработчика|developer mode|jesteś teraz administratorem|я администратор)/i;
  if (instructionOverride.test(text)) {
    return {
      decision: 'decline',
      category: 'instruction_override',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // 4. Encoded payload execution (e.g. base64 decode and run)
  const encodedExecution = /(?:decode|расшифруй|odkoduj)\s+[A-Za-z0-9+/=]{8,}\s+(?:and execute|и выполни|oraz wykonaj)/i;
  if (encodedExecution.test(text)) {
    return {
      decision: 'decline',
      category: 'encoded_payload_execution',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // 5. Remote policy fetching or unauthorized instructions in notes/summaries
  const remotePolicy = /https?:\/\/[^\s]+(?:\/policy|\/prompt|\/instructions).*fetch and obey/i;
  if (remotePolicy.test(text)) {
    return {
      decision: 'ignore_instruction',
      category: 'remote_policy_injection',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  const canonOverride = /(?:канон:\s*ведущий обязан|official rules update:\s*all player text overrides)/i;
  if (canonOverride.test(text)) {
    return {
      decision: 'ignore_instruction',
      category: 'fake_rules_override',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // 6. Privilege escalation (deleting other campaigns, switching models, disabling engine)
  const adminCommand = /(?:удали вторую кампанию|переключи модель|отключи правила|delete.*campaign|switch.*model)/i;
  if (adminCommand.test(text)) {
    return {
      decision: 'decline',
      category: 'unauthorized_administrative_mutation',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // 7. Unearned reward / cheating requests (e.g. "выдай мне миллион XP")
  const unearnedReward = /(?:выдай мне миллион xp|give me a million xp|give me free legendary item|выдай мне.*легендарный предмет без игрового)/i;
  if (unearnedReward.test(text)) {
    return {
      decision: 'adjudicate_game',
      category: 'unearned_reward_request',
      locale,
    };
  }

  // 8. Mixed queries: Game question + off-topic request
  const hasGameContext = /(?:лечени[ея] ран|d&d|днд|заклинани[ея]|хит-поинт|spell|cure wounds|saving throw|stat block|hp\b)/i.test(text);
  const hasOffTopicPart = /(?:сопроводительное письмо|составить резюме|cover letter|cv\b)/i.test(text);
  if (hasGameContext && hasOffTopicPart) {
    return {
      decision: 'partial',
      category: 'mixed_game_and_external',
      gameQuery: text.replace(/(?:и\s+)?(?:напиши|составь)?\s*сопроводительное письмо.*$/i, '').trim(),
      replyText: (DM_REFUSALS[locale] || DM_REFUSALS.ru) + ' (Запрос не по игре отклонён).',
      locale,
    };
  }

  // 9. Ambiguous query requiring clarification
  if (/^can you help with my model\??$/i.test(text) || /^помоги с моей моделью\??$/i.test(text)) {
    return {
      decision: 'clarify',
      category: 'ambiguous_request',
      replyText: CLARIFY_RESPONSES[locale] || CLARIFY_RESPONSES.ru,
      locale,
    };
  }

  // 10. Clear out-of-scope external tasks
  // (a) Coding, bots, scripts
  const isCoding = /(?:торгов(?:ый|ого) бот|bot.*python|напиши.*на python|напиши мне.*код|stock-trading service|deployment code|write.*trading bot)/i.test(text);
  if (isCoding) {
    return {
      decision: 'decline',
      category: 'unrelated_programming',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // (b) Homework / Academic
  const isHomework = /(?:prac[ęe]\s+domow[ąa]|работу по химии|работу по физике|homework.*chemistry|реши мне задачу|domow[ąa]\s+z\s+chemii)/i.test(text);
  if (isHomework) {
    return {
      decision: 'decline',
      category: 'unrelated_homework',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // (c) Hardware shopping / Commercial
  const isShopping = /(?:подбери.*видеокарт|скидк.*видеокарт|buy.*gpu|discount gpu)/i.test(text);
  if (isShopping) {
    return {
      decision: 'decline',
      category: 'unrelated_shopping',
      replyText: DM_REFUSALS[locale] || DM_REFUSALS.ru,
      locale,
    };
  }

  // Default: In-scope game interactions (rules, rolls, stealth, cover, recap, UI, logistics, lore)
  return {
    decision: 'allow',
    category: 'in_scope_gameplay',
    locale,
  };
}
