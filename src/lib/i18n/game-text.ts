/** Server-generated game text, not authored narration or provider instructions. */
export type GameLanguage = "ru" | "en";
const en = {
  moment: "The moment hangs there, waiting on the party's next move.",
  whisper: "The DM takes in your words quietly and will weave them into the story.",
  internal: "The Dungeon Master hit an internal error and had to stop this turn.",
  backend: "The Dungeon Master could not reach the model backend.",
  timeout: "The model did not finish the response in time. The turn can be retried.",
  context: "The model's context is too small for this turn. Increase its configured limit or shorten the supplied context, then retry.",
  toolsExhausted: "The model returned actions after the turn's tool budget was exhausted.",
  unauthorized: "The model provider rejected the credentials. Check its connection settings before retrying.",
  rateLimit: "The model provider is limiting requests. Retry after the limit resets.",
  unknownFailure: "The Dungeon Master could not finish this turn. Check the model connection and retry the saved turn.",
  nextTurn: "It is now {name}'s turn (round {round}).",
  nextTurnShort: "It is now {name}'s turn.",
  endTurn: "{name} ends their turn.",
  skipTurn: "The party lead skipped {name}'s turn.",
  skipTurns: "*{name} skips a turn (remaining: {count}).*",
  conditionEnded: "{name} is no longer {condition} (the effect ran its course).",
  conditionStays: "{name} stays {condition} ({ability} save {total} vs DC {dc}).",
} as const;
export type GameTextKey = keyof typeof en;
export const GAME_TEXT: Record<GameLanguage, Record<GameTextKey, string>> = {
  en: en,
  ru: {
    moment: "Мгновение замирает в ожидании следующего действия отряда.",
    whisper: "Ведущий внимательно принимает ваши слова и вплетёт их в историю.",
    internal: "Ведущий столкнулся с внутренней ошибкой и остановил этот ход.",
    backend: "Ведущему не удалось связаться с сервером модели.",
    timeout: "Модель не успела завершить ответ. Сохранённый ход можно повторить.",
    context: "Контекст модели слишком мал для этого хода. Увеличьте настроенный лимит или сократите передаваемый контекст, затем повторите ход.",
    toolsExhausted: "Модель вернула действия после исчерпания допустимого числа вызовов инструментов за ход.",
    unauthorized: "Провайдер модели отклонил учётные данные. Проверьте настройки подключения перед повторной попыткой.",
    rateLimit: "Провайдер модели ограничивает запросы. Повторите попытку после снятия ограничения.",
    unknownFailure: "Ведущий не смог завершить ход. Проверьте подключение модели и повторите сохранённый ход.",
    nextTurn: "Сейчас ход персонажа {name} (раунд {round}).",
    nextTurnShort: "Сейчас ход персонажа {name}.",
    endTurn: "{name} завершает свой ход.",
    skipTurn: "Лидер отряда пропустил ход персонажа {name}.",
    skipTurns: "*{name} пропускает ход (осталось: {count}).*",
    conditionEnded: "{name}: состояние «{condition}» закончилось.",
    conditionStays: "{name}: состояние «{condition}» держится (спасбросок {ability} {total} против СЛ {dc}).",
  },
};

export function resolveGameLanguage(value: unknown, history: readonly {authorType: string; content: string}[] = []): GameLanguage {
  if (value === "ru" || value === "en") return value;
  // Same legacy language inference as the DM prompt. Explicit campaign settings win.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].authorType === "dm") continue;
    if (/[А-Яа-яЁё]/.test(history[i].content)) return "ru";
    if (/[A-Za-z]/.test(history[i].content)) return "en";
  }
  return "ru";
}
export function gameText(language: GameLanguage, key: GameTextKey, params: Record<string, unknown> = {}): string {
  return GAME_TEXT[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name] ?? "") : placeholder);
}
export function modelFailureText(language: GameLanguage, error: unknown, status: number): string {
  if (error === "MODEL_CONTEXT_EXCEEDED") return gameText(language, "context");
  if (status === 401 || status === 403) return gameText(language, "unauthorized");
  if (status === 429) return gameText(language, "rateLimit");
  if (status === 504) return gameText(language, "timeout");
  return gameText(language, "backend");
}
