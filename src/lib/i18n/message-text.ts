import type { Locale } from "./translations";

// Only explicit UI literals belong here. Never pass authored narration, player
// messages, names or provider diagnostics through a phrase translator.
export const MESSAGE_TEXT = {
  "Dungeon Master": ["Ведущий", "Mistrz Gry"],
  "Player": ["Игрок", "Gracz"],
  "Scene": ["Сцена", "Scena"],
  "Map of {name}": ["Карта: {name}", "Mapa: {name}"],
  "Previous take": ["Предыдущий вариант", "Poprzedni wariant"],
  "Next take": ["Следующий вариант", "Następny wariant"],
  "Reroll this narration": ["Переписать рассказ", "Napisz narrację ponownie"],
  "Reroll: have the DM write this moment again, with the same dice and outcome": ["Переписать этот момент с теми же бросками и результатами", "Napisz tę chwilę ponownie z tymi samymi rzutami i wynikami"],
  "Continue this scene": ["Продолжить сцену", "Kontynuuj scenę"],
  "Continue: have the DM keep writing from where this stopped, without moving the story on": ["Продолжить описание с места остановки, не продвигая сюжет", "Kontynuuj opis od miejsca zatrzymania, bez posuwania fabuły naprzód"],
  "Edit this narration": ["Изменить рассказ", "Edytuj narrację"],
  "Edit: fix what the DM said. Mechanics are untouched, and every dice marker must survive": ["Исправить рассказ, не меняя механику и сохраняя все маркеры бросков", "Popraw narrację bez zmiany mechaniki i z zachowaniem wszystkich znaczników rzutów"],
  "Pin this to the DM's memory": ["Закрепить в памяти ведущего", "Przypnij do pamięci Mistrza Gry"],
  "Remember: keep your selected text (or this whole message) in front of the DM every turn": ["Добавлять выделенный текст или всё сообщение в контекст каждого хода", "Dodawaj zaznaczony tekst lub całą wiadomość do kontekstu każdej tury"],
  "Lore check this passage": ["Проверить соответствие истории мира", "Sprawdź zgodność z historią świata"],
  "Lore check: flag this passage (or your selected text) against the campaign record": ["Сверить фрагмент или выделенный текст с записями кампании", "Porównaj fragment lub zaznaczony tekst z zapisami kampanii"],
  "Pin this passage as canon": ["Закрепить как факт мира", "Zapisz jako fakt świata"],
  "Pin as canon: keep this passage (or your selected text) in front of the DM permanently": ["Постоянно сохранять фрагмент или выделенный текст в контексте ведущего", "Zachowaj fragment lub zaznaczony tekst na stałe w kontekście Mistrza Gry"],
  "Replace the picture": ["Заменить изображение", "Zastąp obraz"],
  "Add a picture": ["Добавить изображение", "Dodaj obraz"],
  "Replace picture: put an image of your own under this passage": ["Поместить своё изображение под этим фрагментом вместо текущего", "Umieść własny obraz pod tym fragmentem zamiast obecnego"],
  "Add a picture: put an image of your own under this passage": ["Поместить своё изображение под этим фрагментом", "Umieść własny obraz pod tym fragmentem"],
  "Read this passage aloud": ["Озвучить фрагмент", "Odczytaj fragment na głos"],
  "Read aloud": ["Прочитать вслух", "Czytaj na głos"],
  "Report this passage": ["Пожаловаться на фрагмент", "Zgłoś fragment"],
  "Report: flag this passage to the admins of this server": ["Сообщить администраторам сервера о проблеме с фрагментом", "Zgłoś administratorom serwera problem z fragmentem"],
  "Report this message": ["Пожаловаться на сообщение", "Zgłoś wiadomość"],
  "Report: flag this message to the admins of this server, or block the player": ["Пожаловаться администраторам на сообщение или заблокировать игрока", "Zgłoś wiadomość administratorom lub zablokuj gracza"],
  "A message from a player you blocked": ["Сообщение от заблокированного вами игрока", "Wiadomość od zablokowanego przez ciebie gracza"],
  "Illustration failed; the story carries on.": ["Не удалось создать иллюстрацию. История продолжается.", "Nie udało się stworzyć ilustracji. Opowieść trwa dalej."],
  "Waiting for the render queue...": ["Ожидание в очереди генерации...", "Oczekiwanie w kolejce generowania..."],
  "Illustrating the scene...": ["Создаётся иллюстрация сцены...", "Tworzenie ilustracji sceny..."],
  "Charting the area...": ["Создаётся карта местности...", "Tworzenie mapy obszaru..."],
  "That image would not upload.": ["Не удалось загрузить изображение.", "Nie udało się przesłać obrazu."],
  "Could not put that picture under the passage.": ["Не удалось прикрепить изображение к фрагменту.", "Nie udało się dołączyć obrazu do fragmentu."],
  "Could not read that passage aloud.": ["Не удалось озвучить этот фрагмент.", "Nie udało się odczytać tego fragmentu na głos."],
  "Send the DM back into this turn with everything it already had": ["Возобновить ход ведущего со всем сохранённым контекстом", "Wznów turę Mistrza Gry z całym zachowanym kontekstem"],
} as const;
export type MessageTextKey = keyof typeof MESSAGE_TEXT;

export function messageText(locale: Locale, key: MessageTextKey, params: Record<string, unknown> = {}): string {
  const template = locale === "en" ? key : MESSAGE_TEXT[key][locale === "ru" ? 0 : 1];
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name] ?? "") : placeholder);
}
