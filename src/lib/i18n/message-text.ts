import type { Locale } from "./translations";

// Only explicit UI literals belong here. Never pass authored narration, player
// messages, names or provider diagnostics through a phrase translator.
export const MESSAGE_TEXT = {
  "Dungeon Master": { en: "Dungeon Master", ru: "Ведущий", pl: "Mistrz Gry" },
  "Player": { en: "Player", ru: "Игрок", pl: "Gracz" },
  "Scene": { en: "Scene", ru: "Сцена", pl: "Scena" },
  "Map of {name}": { en: "Map of {name}", ru: "Карта: {name}", pl: "Mapa: {name}" },
  "Previous take": { en: "Previous take", ru: "Предыдущий вариант", pl: "Poprzedni wariant" },
  "Next take": { en: "Next take", ru: "Следующий вариант", pl: "Następny wariant" },
  "Reroll this narration": { en: "Reroll this narration", ru: "Переписать рассказ", pl: "Napisz narrację ponownie" },
  "Reroll: have the DM write this moment again, with the same dice and outcome": { en: "Reroll: have the DM write this moment again, with the same dice and outcome", ru: "Переписать этот момент с теми же бросками и результатами", pl: "Napisz tę chwilę ponownie z tymi samymi rzutami i wynikami" },
  "Continue this scene": { en: "Continue this scene", ru: "Продолжить сцену", pl: "Kontynuuj scenę" },
  "Continue: have the DM keep writing from where this stopped, without moving the story on": { en: "Continue: have the DM keep writing from where this stopped, without moving the story on", ru: "Продолжить описание с места остановки, не продвигая сюжет", pl: "Kontynuuj opis od miejsca zatrzymania, bez posuwania fabuły naprzód" },
  "Edit this narration": { en: "Edit this narration", ru: "Изменить рассказ", pl: "Edytuj narrację" },
  "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive": { en: "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive", ru: "Исправить рассказ, не меняя механику и сохраняя все маркеры бросков", pl: "Popraw narrację bez zmiany mechaniki i z zachowaniem wszystkich znaczników rzutów" },
  "Pin this to the DM's memory": { en: "Pin this to the DM's memory", ru: "Закрепить в памяти ведущего", pl: "Przypnij do pamięci Mistrza Gry" },
  "Remember: keep your selected text (or this whole message) in front of the DM every turn": { en: "Remember: keep your selected text (or this whole message) in front of the DM every turn", ru: "Добавлять выделенный текст или всё сообщение в контекст каждого хода", pl: "Dodawaj zaznaczony tekst lub całą wiadomość do kontekstu każdej tury" },
  "Lore check this passage": { en: "Lore check this passage", ru: "Проверить соответствие истории мира", pl: "Sprawdź zgodność z historią świata" },
  "Lore check: flag this passage (or your selected text) against the campaign record": { en: "Lore check: flag this passage (or your selected text) against the campaign record", ru: "Сверить фрагмент или выделенный текст с записями кампании", pl: "Porównaj fragment lub zaznaczony tekst z zapisami kampanii" },
  "Pin this passage as canon": { en: "Pin this passage as canon", ru: "Закрепить как факт мира", pl: "Zapisz jako kanon" },
  "Pin as canon: keep this passage (or your selected text) in front of the DM permanently": { en: "Pin as canon: keep this passage (or your selected text) in front of the DM permanently", ru: "Постоянно сохранять фрагмент или выделенный текст в контексте ведущего", pl: "Zachowaj fragment lub zaznaczony tekst na stałe w kontekście Mistrza Gry" },
  "Replace the picture": { en: "Replace the picture", ru: "Заменить изображение", pl: "Zastąp obraz" },
  "Add a picture": { en: "Add a picture", ru: "Добавить изображение", pl: "Dodaj obraz" },
  "Replace picture: put an image of your own under this passage": { en: "Replace picture: put an image of your own under this passage", ru: "Поместить своё изображение под этим фрагментом вместо текущего", pl: "Umieść własny obraz pod tym fragmentem zamiast obecnego" },
  "Add a picture: put an image of your own under this passage": { en: "Add a picture: put an image of your own under this passage", ru: "Поместить своё изображение под этим фрагментом", pl: "Umieść własny obraz pod tym fragmentem" },
  "Read this passage aloud": { en: "Read this passage aloud", ru: "Озвучить фрагмент", pl: "Odczytaj fragment na głos" },
  "Read aloud": { en: "Read aloud", ru: "Прочитать вслух", pl: "Czytaj na głos" },
  "Report this passage": { en: "Report this passage", ru: "Пожаловаться на фрагмент", pl: "Zgłoś fragment" },
  "Report: flag this passage to the admins of this server": { en: "Report: flag this passage to the admins of this server", ru: "Сообщить администраторам сервера о проблеме с фрагментом", pl: "Zgłoś administratorom serwera problem z fragmentem" },
  "Report this message": { en: "Report this message", ru: "Пожаловаться на сообщение", pl: "Zgłoś wiadomość" },
  "Report: flag this message to the admins of this server, or block the player": { en: "Report: flag this message to the admins of this server, or block the player", ru: "Пожаловаться администраторам на сообщение или заблокировать игрока", pl: "Zgłoś wiadomość administratorom lub zablokuj gracza" },
  "A message from a player you blocked": { en: "A message from a player you blocked", ru: "Сообщение от заблокированного вами игрока", pl: "Wiadomość od zablokowanego przez ciebie gracza" },
  "Illustration failed; the story carries on.": { en: "Illustration failed; the story carries on.", ru: "Не удалось создать иллюстрацию. История продолжается.", pl: "Nie udało się stworzyć ilustracji. Opowieść trwa dalej." },
  "Waiting for the render queue...": { en: "Waiting for the render queue...", ru: "Ожидание в очереди генерации...", pl: "Oczekiwanie w kolejce generowania..." },
  "Illustrating the scene...": { en: "Illustrating the scene...", ru: "Создаётся иллюстрация сцены...", pl: "Tworzenie ilustracji sceny..." },
  "Charting the area...": { en: "Charting the area...", ru: "Создаётся карта местности...", pl: "Tworzenie mapy obszaru..." },
  "That image would not upload.": { en: "That image would not upload.", ru: "Не удалось загрузить изображение.", pl: "Nie udało się przesłać obrazu." },
  "Could not put that picture under the passage.": { en: "Could not put that picture under the passage.", ru: "Не удалось прикрепить изображение к фрагменту.", pl: "Nie udało się umieścić obrazu pod tym fragmentem." },
  "Could not read that passage aloud.": { en: "Could not read that passage aloud.", ru: "Не удалось озвучить этот фрагмент.", pl: "Nie udało się odczytać tego fragmentu na głos." },
  "Send the DM back into this turn with everything it already had": { en: "Send the DM back into this turn with everything it already had", ru: "Возобновить ход ведущего со всем сохранённым контекстом", pl: "Wznów turę Mistrza Gry z całym zachowanym kontekstem" },
} as const;
export type MessageTextKey = keyof typeof MESSAGE_TEXT;

export function messageText(locale: Locale, key: MessageTextKey, params: Record<string, unknown> = {}): string {
  const item = MESSAGE_TEXT[key];
  const template = (item as Record<string, string> | undefined)?.[locale] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name] ?? "") : placeholder);
}
