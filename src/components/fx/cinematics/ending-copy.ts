// Finale copy: headings and the joke banners that pop over the celebration.
// YOLO 21+ campaigns get the uncensored table voice.

export const VICTORY_BANNERS_RU = {
  ru: [
    "★ НАТУРАЛЬНАЯ 20! ★",
    "⚔️ ВЕЛИКАЯ ПОБЕДА! ⚔️",
    "👑 ТРИУМФ ГЕРОЕВ! 👑",
    "🏆 ЛЕГЕНДА СВЕРШИЛАСЬ 🏆",
    "✨ СЛАВА ПОБЕДИТЕЛЯМ! ✨",
    "🐉 ЗЛО ПОВЕРЖЕНО 🐉",
    "🔥 КРИТИЧЕСКИЙ УСПЕХ 🔥",
  ],
}.ru;

export const VICTORY_BANNERS_EN = [
  "★ NATURAL 20! ★",
  "⚔️ VICTORY ⚔️",
  "👑 CRITICAL TRIUMPH 👑",
  "🏆 LEGENDARY FINALE 🏆",
  "✨ HEROES OF THE REALM ✨",
  "🐉 EVIL VANQUISHED 🐉",
  "🔥 CRITICAL SUCCESS 🔥",
];

export const DEFEAT_BANNERS_RU = {
  ru: [
    "💀 КРИТИЧЕСКИЙ ПРОВАЛ 💀",
    "🎲 НАТУРАЛЬНАЯ 1 🎲",
    "☠️ ПОЛНЫЙ ПРОЁБ ☠️",
    "⚰️ ОТРЯД ПОВЕРЖЕН (TPK) ⚰️",
    "🥀 ДА УПОКОЯТСЯ С МИРОМ... 🥀",
    "🌧️ КУБИКИ БЫЛИ НЕУМОЛИМЫ 🌧️",
    "🩸 ВАС ЗАПОМНЯТ... НО НЕ ТАК 🩸",
    "⚡ ВСЕ ПАЛИ В БОЮ ⚡",
  ],
}.ru;

export const DEFEAT_BANNERS_EN = [
  "💀 TOTAL PARTY WIPE 💀",
  "🎲 NATURAL 1 🎲",
  "☠️ CRITICAL FAILURE ☠️",
  "⚰️ DEFEAT ⚰️",
  "🥀 REST IN PEACE... 🥀",
  "🌧️ THE DICE WERE MERCILESS 🌧️",
  "🩸 A TRAGIC END 🩸",
  "⚡ FATE WAS CRUEL ⚡",
];

export const YOLO_VICTORY_BANNERS_RU = { ru: [
  "🔥 ЕБАЛИ И РАЗЪЕБАЛИ! 🔥",
  "👑 ВОТ ЭТО БЛЯТЬ ПОБЕДА! 👑",
  "★ НАТУРАЛЬНАЯ 20, СУКА! ★",
  "⚔️ ВРАГ В ГОВНЕ, МЫ В ШОКОЛАДЕ ⚔️",
  "🏆 РАЗМОТАЛИ ЭТИХ ПИДОРАСОВ 🏆",
  "✨ АБСОЛЮТНЫЙ РАЗЪЁБ! ✨",
  "🐉 ДРАКОН ОТСОСАЛ ПО ПОЛНОЙ 🐉",
  "🔥 СУПЕРКРИТ, НАХУЙ! 🔥",
] }.ru;

export const YOLO_VICTORY_BANNERS_EN = [
  "🔥 WE FUCKING DID IT! 🔥",
  "👑 ABSOLUTE BADASS VICTORY 👑",
  "★ NATURAL 20, BITCHES! ★",
  "⚔️ DESTROYED THEM COMPLETELY ⚔️",
  "🏆 LEGENDARY BADASSES 🏆",
  "✨ FUCKING GLORIOUS! ✨",
];

export const YOLO_DEFEAT_BANNERS_RU = { ru: [
  "☠️ ПОЛНЫЙ ПИЗДЕЦ И ПРОЁБ ☠️",
  "💀 ОТРЯД ОБОСРАЛСЯ (TPK) 💀",
  "🎲 НАТУРАЛЬНАЯ ЕДИНИЦА, БЛЯТЬ! 🎲",
  "⚰️ ЗАКОПАЛИ НАХУЙ ВЕСЬ ОТРЯД ⚰️",
  "🩸 ВСЁ ПОШЛО ПО ПИЗДЕ 🩸",
  "💩 УТОНУЛИ В ГОВНЕ 💩",
  "⚡ ЗАРУИНИЛИ ВСЮ КАМПАНИЮ ⚡",
  "🥀 СДОХЛИ КАК ЛОХИ 🥀",
] }.ru;

export const YOLO_DEFEAT_BANNERS_EN = [
  "☠️ TOTAL FUCKING DISASTER ☠️",
  "💀 WE SHIT THE BED (TPK) 💀",
  "🎲 NATURAL FUCKING 1 🎲",
  "⚰️ EVERYBODY DIED LIKE MORONS ⚰️",
  "🩸 EVERYTHING WENT TO HELL 🩸",
  "💩 BURIED IN SHIT 💩",
];

export function endingCopy(isYolo: boolean) {
  return {
    en: {
      concluded: isYolo ? "Adventure Fucking Concluded!" : "Adventure Concluded!",
      heroesSalute: isYolo ? "Salute to the badass legends!" : "Salute to the legendary heroes!",
      moreFireworks: isYolo ? "Fire more fucking rockets!" : "More fireworks!",
      close: "Close celebration",
      audioOn: "Mute sound",
      audioOff: "Enable sound",
      defeatConcluded: isYolo ? "Campaign Concluded: Total Party Fucking Wipe (TPK)" : "Campaign Concluded: Party Defeated (TPK)",
      defeatHeroesSalute: isYolo ? "Rolled ones across the board, shit the bed and died." : "The dice rolled ones... Rest in peace, brave adventurers.",
      dropMoreDice: isYolo ? "Drop more 1s into the mud!" : "Drop more dice!",
      readClosing: isYolo ? "Read DM's final unhinged speech" : "Read DM's closing message",
      hideClosing: "Hide message",
      defeatBadge: isYolo ? "TOTAL DISASTER / TPK" : "DEFEAT / PARTY WIPE",
      victoryBadge: isYolo ? "ABSOLUTE BADASSERY" : "VICTORY / TRIUMPH",
      storyTitleVictory: isYolo ? "Triumph of the Absolute Madmen" : "Triumph of the Heroes",
      storyTitleDefeat: isYolo ? "Epitaph for the Dumbasses" : "Epitaph of the Fallen",
      storyClose: "Collapse text",
    },
    ru: {
      concluded: isYolo ? "Приключение разъёбано!" : "Приключение завершено!",
      heroesSalute: isYolo ? "Салют бешеным героям!" : "Салют легендарным героям!",
      moreFireworks: isYolo ? "Ебануть ещё салют!" : "Запустить ещё салют!",
      close: "Закрыть финал",
      audioOn: "Выключить звук",
      audioOff: "Включить звук",
      defeatConcluded: isYolo ? "Кампания завершена: Полный проёб отряда (TPK)" : "Кампания завершена: Поражение отряда (TPK)",
      defeatHeroesSalute: isYolo ? "Кубики выпали в единицы, отряд обосрался и сдох. Земля стекловатой." : "Кубики были неумолимы... На них выпали единички. Покойтесь с миром.",
      dropMoreDice: isYolo ? "Уронить ещё единичек в говно!" : "Уронить ещё единичек!",
      readClosing: isYolo ? "Читать финальный разъёб от Мастера" : "Читать послание Мастера",
      hideClosing: "Скрыть послание",
      defeatBadge: isYolo ? "ПОЛНЫЙ ПРОЁБ / TPK" : "ПОРАЖЕНИЕ / ПРОЁБ",
      victoryBadge: isYolo ? "АБСОЛЮТНЫЙ РАЗЪЁБ" : "ПОБЕДА / ТРИУМФ",
      storyTitleVictory: isYolo ? "Триумф бешеных героев" : "Триумф легендарных героев",
      storyTitleDefeat: isYolo ? "Посмертная эпитафия долбоёбам" : "Посмертная эпитафия павшим",
      storyClose: "Свернуть текст",
    },
  };
}
