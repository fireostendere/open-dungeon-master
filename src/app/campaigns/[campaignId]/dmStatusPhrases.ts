import type { DmStatus } from "./useCampaignStream";
import type { Locale } from "@/lib/i18n";

type StatusPhrases = Record<Exclude<DmStatus, "idle">, string[]>;
// Chosen deterministically by message ID and status, never at render-time random.
export const DM_STATUS_PHRASES: StatusPhrases = {
  thinking: [
    "The DM weighs the outcome…", "The DM consults the whims of fate…",
    "Somewhere, a d20 holds its breath…", "The DM strokes an imaginary beard…",
    "The DM ponders your fate…", "Buffering vibes…",
    "Rolling a Wisdom check to make good decisions…",
  ],
  rolling: [
    "The dice clatter across the table…", "The dice tumble into the dark…",
    "Bones are cast…", "Fate rattles in the cup…", "The dice go bouncing off the pizza box…",
    "Yeeting the dice…", "Praying to the RNG gods…",
  ],
  awaiting_rolls: [
    "The table waits on real dice…", "Grab your dice, the table waits…",
    "The DM taps the table, waiting on a roll…", "The party holds its breath for a roll…",
    "Real dice required, no pressure…", "Someone find the d20 that rolled under the couch…",
  ],
  narrating: [
    "The next passage is forming…", "The story draws its next breath…",
    "The tale continues to unspool…", "Words gather at the edge of the page…",
    "The DM finds the next words…", "The scene shimmers into focus…",
  ],
  writing_chapter: [
    "The DM writes the chapter into the record…", "Ink meets parchment…",
    "The chronicle gains another page…", "The scribe dips the quill…",
    "The DM seals the chapter with wax…", "This tale is committed to the annals…",
  ],
  plotting_arc: [
    "The DM plots the road ahead…", "The DM unrolls a suspiciously large map…",
    "Threads of destiny are being tied…", "Storm clouds gather on the horizon…",
    "The DM adds another red string to the murder board…", "The DM plots something you'll regret…",
  ],
};

export const DM_STATUS_PHRASES_BY_LOCALE: Record<Locale, StatusPhrases> = {
  en: DM_STATUS_PHRASES,
  ru: {
    thinking: ["Ведущий обдумывает исход…", "Ведущий советуется с судьбой…", "Где-то d20 затаил дыхание…", "Ведущий гладит воображаемую бороду…", "Ведущий размышляет о вашей судьбе…", "Атмосфера загружается…", "Проверяем мудрость перед важным решением…"],
    rolling: ["Кости стучат по столу…", "Кости катятся во тьму…", "Жребий брошен…", "Судьба гремит в стакане…", "Кости отскакивают от коробки с пиццей…", "Кости летят…", "Взываем к богам случайности…"],
    awaiting_rolls: ["Стол ждёт настоящих костей…", "Берите кости, все ждут…", "Ведущий постукивает по столу в ожидании броска…", "Отряд затаил дыхание перед броском…", "Нужны настоящие кости. Не волнуйтесь…", "Найдите d20, укатившийся под диван…"],
    narrating: ["Складывается следующий фрагмент…", "История делает новый вдох…", "Рассказ продолжает разворачиваться…", "Слова собираются у края страницы…", "Ведущий подбирает следующие слова…", "Сцена обретает ясность…"],
    writing_chapter: ["Ведущий записывает главу в летопись…", "Чернила касаются пергамента…", "В хронике появляется новая страница…", "Летописец макает перо…", "Ведущий скрепляет главу восковой печатью…", "Эта история войдёт в летопись…"],
    plotting_arc: ["Ведущий намечает дальнейший путь…", "Ведущий разворачивает подозрительно большую карту…", "Нити судьбы сплетаются…", "На горизонте собираются тучи…", "Ведущий соединяет ещё две улики красной нитью…", "Ведущий замышляет то, о чём вы ещё пожалеете…"],
  },
};
