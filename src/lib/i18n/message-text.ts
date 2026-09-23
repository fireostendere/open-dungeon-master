import type { Locale } from "./translations";

// Only explicit UI literals belong here. Never pass authored narration, player
// messages, names or provider diagnostics through a phrase translator.
export const MESSAGE_TEXT = {
  "Dungeon Master": { en: "Dungeon Master", ru: "Ведущий" },
  "Party Lead": { en: "Party Lead", ru: "Лидер отряда" },
  "DM's Closing Message · Adventure Finale": { en: "DM's Closing Message · Adventure Finale", ru: "Заключительное послание Мастера · Финал приключения" },
  "Salute & Finale": { en: "Salute & Finale", ru: "Салют и финал" },
  "Load older messages": { en: "Load older messages", ru: "Загрузить ранние сообщения" },
  "Player": { en: "Player", ru: "Игрок" },
  "Scene": { en: "Scene", ru: "Сцена" },
  "Map of {name}": { en: "Map of {name}", ru: "Карта: {name}" },
  "Previous take": { en: "Previous take", ru: "Предыдущий вариант" },
  "Next take": { en: "Next take", ru: "Следующий вариант" },
  "Reroll this narration": { en: "Reroll this narration", ru: "Переписать рассказ" },
  "Reroll: have the DM write this moment again, with the same dice and outcome": { en: "Reroll: have the DM write this moment again, with the same dice and outcome", ru: "Переписать этот момент с теми же бросками и результатами" },
  "Continue this scene": { en: "Continue this scene", ru: "Продолжить сцену" },
  "Continue: have the DM keep writing from where this stopped, without moving the story on": { en: "Continue: have the DM keep writing from where this stopped, without moving the story on", ru: "Продолжить описание с места остановки, не продвигая сюжет" },
  "Edit this narration": { en: "Edit this narration", ru: "Изменить рассказ" },
  "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive": { en: "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive", ru: "Исправить рассказ, не меняя механику и сохраняя все маркеры бросков" },
  "Pin this to the DM's memory": { en: "Pin this to the DM's memory", ru: "Закрепить в памяти ведущего" },
  "Remember: keep your selected text (or this whole message) in front of the DM every turn": { en: "Remember: keep your selected text (or this whole message) in front of the DM every turn", ru: "Добавлять выделенный текст или всё сообщение в контекст каждого хода" },
  "Lore check this passage": { en: "Lore check this passage", ru: "Проверить соответствие истории мира" },
  "Lore check: flag this passage (or your selected text) against the campaign record": { en: "Lore check: flag this passage (or your selected text) against the campaign record", ru: "Сверить фрагмент или выделенный текст с записями кампании" },
  "Pin this passage as canon": { en: "Pin this passage as canon", ru: "Закрепить как факт мира" },
  "Pin as canon: keep this passage (or your selected text) in front of the DM permanently": { en: "Pin as canon: keep this passage (or your selected text) in front of the DM permanently", ru: "Постоянно сохранять фрагмент или выделенный текст в контексте ведущего" },
  "Replace the picture": { en: "Replace the picture", ru: "Заменить изображение" },
  "Add a picture": { en: "Add a picture", ru: "Добавить изображение" },
  "Replace picture: put an image of your own under this passage": { en: "Replace picture: put an image of your own under this passage", ru: "Поместить своё изображение под этим фрагментом вместо текущего" },
  "Add a picture: put an image of your own under this passage": { en: "Add a picture: put an image of your own under this passage", ru: "Поместить своё изображение под этим фрагментом" },
  "Read this passage aloud": { en: "Read this passage aloud", ru: "Озвучить фрагмент" },
  "Read aloud": { en: "Read aloud", ru: "Прочитать вслух" },
  "Report this passage": { en: "Report this passage", ru: "Пожаловаться на фрагмент" },
  "Report: flag this passage to the admins of this server": { en: "Report: flag this passage to the admins of this server", ru: "Сообщить администраторам сервера о проблеме с фрагментом" },
  "Report this message": { en: "Report this message", ru: "Пожаловаться на сообщение" },
  "Report: flag this message to the admins of this server, or block the player": { en: "Report: flag this message to the admins of this server, or block the player", ru: "Пожаловаться администраторам на сообщение или заблокировать игрока" },
  "A message from a player you blocked": { en: "A message from a player you blocked", ru: "Сообщение от заблокированного вами игрока" },
  "Illustration failed; the story carries on.": { en: "Illustration failed; the story carries on.", ru: "Не удалось создать иллюстрацию. История продолжается." },
  "Waiting for the render queue...": { en: "Waiting for the render queue...", ru: "Ожидание в очереди генерации..." },
  "Illustrating the scene...": { en: "Illustrating the scene...", ru: "Создаётся иллюстрация сцены..." },
  "Charting the area...": { en: "Charting the area...", ru: "Создаётся карта местности..." },
  "That image would not upload.": { en: "That image would not upload.", ru: "Не удалось загрузить изображение." },
  "Could not put that picture under the passage.": { en: "Could not put that picture under the passage.", ru: "Не удалось прикрепить изображение к фрагменту." },
  "Could not read that passage aloud.": { en: "Could not read that passage aloud.", ru: "Не удалось озвучить этот фрагмент." },
  "Send the DM back into this turn with everything it already had": { en: "Send the DM back into this turn with everything it already had", ru: "Возобновить ход ведущего со всем сохранённым контекстом" },
} as const;
export type MessageTextKey = keyof typeof MESSAGE_TEXT;

export function messageText(locale: Locale, key: MessageTextKey, params: Record<string, unknown> = {}): string {
  const item = MESSAGE_TEXT[key];
  const template = (item as Record<string, string> | undefined)?.[locale] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name] ?? "") : placeholder);
}
