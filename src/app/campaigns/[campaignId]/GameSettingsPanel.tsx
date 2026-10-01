"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoButton } from "@/components/ui/InfoDialog";
import { GENRE_PRESETS, genrePreset } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { WorldPackGallery } from "@/components/WorldPackGallery";
import type { GameSettings } from "@/lib/schemas/game-settings";
import {
  CAMPAIGN_LENGTHS,
  COMBAT_MODES,
  DM_DIFFICULTY_LEVELS,
  type CampaignLengthSetting,
  type CombatModeSetting,
  type DicePolicy,
  type Genre,
  type UnitSystemSetting,
} from "@/lib/schemas/game-settings-options";

// Kept exported for callers that use these explainers directly. The panel
// itself renders localized copies below.
export const LIVING_WORLD_INFO = [
  "On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.",
  "NPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.",
  "The DM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are DM-only until the party discovers them in play.",
  "Off: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.",
  "You can switch this at any time. Turning it back on resumes from the world as it currently stands.",
].join("\n\n");

export const BONDS_INFO = [
  "How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted.",
  "Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary.",
  "Standing shows in the Bonds tab and colors how the DM plays them. Off: the DM tracks no personal standing and NPCs react to the party as a whole.",
].join("\n\n");

export const ROMANCE_INFO = [
  "The romance ladder on top of the bond meter: interested, courting, together, betrothed, married.",
  "Nobody can be romanced who does not already like the character, players always make the first move, and intimate scenes always fade to black.",
  "Requires Bonds to be on.",
].join("\n\n");

export const NARRATION_GUARD_INFO = [
  "After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled.",
  "A contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.",
  "Off costs nothing but the check, and the narration is persisted exactly as written.",
].join("\n\n");

const COPY = {
  en: {
    gameSettings: "Game settings",
    saveFailed: "That change was not saved.",
    serverFailed: "Could not reach the server.",
    humanDm: "human DM",
    campaignWord: "campaign",
    lengths: {
      short: "Short (3 acts, a focused adventure)",
      standard: "Standard (4-5 acts)",
      epic: "Epic (6-8 acts, a sprawling saga)",
    },
    diceReal: "Real dice allowed",
    diceDigital: "Digital dice only",
    ambienceOn: "Ambience on",
    ambienceFollows: "follows the scene",
    ambienceOff: "Ambience off",
    multiclassOn: "Multiclassing allowed",
    multiclassOff: "Multiclassing off",
    joiningOpen: "Mid-game joining open",
    joiningClosed: "Mid-game joining closed",
    held: "Lead opens responses each turn",
    responsesOpen: "Responses always open",
    worldOn: "Living world on",
    worldOff: "Living world off",
    itemsApproval: "Item offers need approval",
    itemsAuto: "Item changes auto-apply",
    bondsOff: "Bonds off",
    bondsRomance: "Bonds and romance tracked",
    bondsOnly: "Bonds tracked, romance off",
    companionsPrefix: "AI companions",
    companions: {
      auto: "Auto (solo: full; multiplayer: guests only)",
      full: "Party members and guests",
      guests: "Temporary guests only",
      off: "Off",
    },
    worldPack: "World",
    noPack: "No pack (plain setting)",
    packHelp: "Pick a pre-built universe to rename races, classes, spells and monsters to fit it.",
    setting: "Setting",
    genres: {
      high_fantasy: { name: "High fantasy", blurb: "Classic swords, sorcery, and shining kingdoms." },
      dark_fantasy: { name: "Dark fantasy", blurb: "Grim lands where hope is scarce and victories cost." },
      mystery: { name: "Mystery", blurb: "Clues, suspects, and secrets behind every door." },
      horror: { name: "Horror", blurb: "Dread, isolation, and things best left unseen." },
      cyberpunk: { name: "Cyberpunk", blurb: "Neon streets, chrome bodies, corporate gods. 5e reskinned." },
      steampunk: { name: "Steampunk", blurb: "Brass, steam, airships, and impossible machines." },
      post_apocalyptic: { name: "Post-apocalyptic", blurb: "Scavenge, survive, and rebuild among the ruins." },
      custom: { name: "Custom", blurb: "Describe your own world and tone." },
    },
    customWorld: "World",
    customPlaceholder: "Describe the world and tone...",
    length: "Length",
    lengthTip: "How far the DM plans the story ahead (acts, bosses, side quests). Changing it mid-campaign applies when the next saga is planned; any length continues with a sequel saga if you play past the finale.",
    dmDifficulty: "DM strictness",
    dmDifficultyTip: "Separate from encounter difficulty. 1 is forgiving; 10 is pedantic, adversarial, and makes mistakes cost their full price. Dice are never fudged.",
    dmDifficultyHint: (value: number) => value <= 2 ? "Very forgiving" : value <= 4 ? "Fair and forgiving" : value <= 6 ? "Firm" : value <= 8 ? "Hard-nosed" : "Pedantic and adversarial",
    dice: "Dice",
    diceTip: "Real dice lets each player opt in to rolling at their table: the game parks until they type the result, read it from a paired Pixels Bluetooth die, or let the server roll per die (Dice sources, in the Party tab).",
    dicePolicy: "Dice policy",
    units: "Units",
    unitsTip: "Measurement units used in narration, battle map distances, and descriptions. Metric (meters, kg) is the standard default.",
    unitsPolicy: "Measurement units",
    unitsMetric: "Metric (m, kg)",
    unitsImperial: "Imperial (ft, lb)",
    combat: "Combat",
    combatTip: "Classical uses encounter position. JRPG is a campaign house-rule mode: targets in one encounter ignore distance, line of sight, cover, and opportunity-attack gates; initiative, dice, resources, HP, conditions, and privacy remain enforced.",
    combatClassical: "Classical",
    combatJrpg: "JRPG",
    enemyHp: "Enemy HP",
    enemyHpTip: "Controls what players see for enemy durability. The DM always sees exact HP.",
    enemyHpState: "State only",
    enemyHpBar: "Health bar",
    enemyHpExact: "Exact HP",
    enemyEffects: "Enemy effects",
    enemyEffectsTip: "Controls whether players see active enemy conditions and their remaining server-tracked duration.",
    enemyEffectsHidden: "Do not show",
    enemyEffectsStatus: "Show status",
    enemyEffectsTurns: "Status + duration",
    on: "On",
    off: "Off",
    ambience: "Ambience",
    ambienceAutoTip: "Pick a bed from each new place and switch to combat music when a fight starts. Off leaves every change to the DM.",
    followsScene: "Follows the scene",
    dmSets: "DM sets it",
    noAmbience: "No ambience audio is installed yet, so this plays silence. Run npm run fetch-ambience on the server; setting a FREESOUND_API_KEY first widens the sources.",
    extras: "Extras",
    multiclassing: "Multiclassing",
    multiclassTip: "Let characters take levels in a second or third class at level-up (5e multiclassing, prerequisites enforced)",
    midJoin: "Mid-game joining",
    midJoinTip: "Allow new players to join with the invite code after the adventure starts",
    open: "open",
    closed: "closed",
    heldResponses: "Held responses",
    heldTip: "After each DM narration, players cannot act until you allow responses. OOC stays open.",
    remind: "Remind",
    remindTip: "How much play may pass with nothing written down before the console nudges you to record what happened. Your own typed narration counts, so a DM who writes their scenes is never nudged.",
    neverActions: "never by actions",
    afterActions: (count: number) => `after ${count} actions`,
    rollsTip: "The combat tempo: twelve rolls is roughly two rounds of a four-person fight.",
    neverRolls: "never by rolls",
    afterRolls: (count: number) => `after ${count} rolls`,
    livingWorld: "Living world",
    livingWorldTip: "The world moves on its own: off-screen storylines advance on background dice, surprises and encounters build up over quiet stretches, and NPC schemes progress between chapters and during rests and travel. The story arc itself is unaffected either way.",
    livingWorldLabel: "What does Living World do?",
    livingWorldInfo: LIVING_WORLD_INFO,
    livingOnHelp: "Rumors, surprises, and off-screen schemes advance between turns.",
    livingOffHelp: "Nothing happens unless the party or the story arc makes it happen.",
    items: "Items",
    itemOffers: "Item offers",
    itemTip: "When on, DM-granted loot, item removals, and gold changes become offers the owning player accepts or declines before they land on the sheet. Damage, healing, XP, and conditions still apply normally.",
    itemOnHelp: "Players confirm DM item and gold changes before they apply.",
    itemOffHelp: "DM item and gold changes apply immediately (lead can undo).",
    voice: "Voice",
    voiceChat: "Voice chat",
    voiceTip: "Live voice chat for this table, in the lobby and during play. The server also has its own switch, and needs a media port open; if voice is off server-wide this has no effect.",
    floorTip: "How hard the floor is enforced on microphones. Soft shows whose turn it is without muting anyone. Strict pauses a player's microphone on the server, so the mute is real rather than a greyed-out button. Off ignores the floor entirely. The DM is never muted by any of these.",
    turnsOff: "Turns: ignored",
    turnsSoft: "Turns: shown",
    turnsStrict: "Turns: enforced",
    proximity: "Proximity",
    proximityTip: "Distance decides who hears whom, using the battle map. Outside combat, or with no map, everyone hears everyone as usual. The DM always hears everyone and is always heard.",
    speakingRange: "How far a normal speaking voice carries",
    feet: (value: number) => `${value} ft`,
    whisperShout: "Whisper/shout",
    whisperTip: "Lets each player pick whisper (5 ft), normal, or shout (120 ft). The range is the speaker's, because shouting is something you do rather than something done to you.",
    walls: "Walls muffle",
    wallsTip: "A wall between two characters muffles the voice rather than silencing it. Hearing through a door is a real thing, and audio that vanished at a doorway would read as a bug. Fog of war never gates audio: not seeing someone has nothing to do with hearing them.",
    downed: "Downed go deaf",
    downedTip: "A character at 0 hit points stops hearing the table. They still hear the DM, and they are still heard.",
    bonds: "Bonds",
    bondsTip: BONDS_INFO,
    romance: "Romance",
    romanceTip: ROMANCE_INFO,
    bondsOffHelp: "The DM tracks no personal standing; NPCs react to the party as a whole.",
    bondsRomanceHelp: "Standing is tracked per character, and romance can grow from it.",
    bondsOnlyHelp: "Standing is tracked per character; romance is off.",
    allies: "Allies",
    alliesTip: "AI companions the DM plays: 'party members' travel with the party until dismissed; 'guests' are temporary allies for one scene or battle and leave automatically when the fight ends. Auto picks full for solo play, guests only for multiplayer.",
    maxPartyTitle: "Most lasting party companions allowed at once",
    maxGuestsTitle: "Most temporary guest allies allowed at once",
    maxParty: (count: number) => `max ${count} party`,
    maxGuests: (count: number) => `max ${count} guest${count === 1 ? "" : "s"}`,
  },
  ru: {
    gameSettings: "Настройки игры",
    saveFailed: "Не удалось сохранить изменение.",
    serverFailed: "Не удалось связаться с сервером.",
    humanDm: "Мастер-человек",
    campaignWord: "кампания",
    lengths: {
      short: "Короткая (3 акта, сфокусированное приключение)",
      standard: "Стандартная (4–5 актов)",
      epic: "Эпическая (6–8 актов, большая сага)",
    },
    diceReal: "Разрешены реальные кости",
    diceDigital: "Только цифровые кости",
    ambienceOn: "Атмосфера включена",
    ambienceFollows: "следует за сценой",
    ambienceOff: "Атмосфера выключена",
    multiclassOn: "Мультиклассирование разрешено",
    multiclassOff: "Мультиклассирование выключено",
    joiningOpen: "Подключение по ходу игры открыто",
    joiningClosed: "Подключение по ходу игры закрыто",
    held: "Лидер открывает возможность действовать каждый ход",
    responsesOpen: "Действия всегда открыты",
    worldOn: "Живой мир включён",
    worldOff: "Живой мир выключен",
    itemsApproval: "Изменения предметов требуют подтверждения",
    itemsAuto: "Изменения предметов применяются сразу",
    bondsOff: "Отношения выключены",
    bondsRomance: "Отслеживаются отношения и романтика",
    bondsOnly: "Отношения отслеживаются, романтика выключена",
    companionsPrefix: "ИИ-союзники",
    companions: {
      auto: "Авто (соло: постоянные; группа: только гости)",
      full: "Постоянные спутники и гости",
      guests: "Только временные гости",
      off: "Выкл.",
    },
    worldPack: "Мир",
    noPack: "Без пакета (обычный сеттинг)",
    packHelp: "Выберите готовую вселенную, чтобы переименовать расы, классы, заклинания и монстров под её сеттинг.",
    setting: "Сеттинг",
    genres: {
      high_fantasy: { name: "Высокое фэнтези", blurb: "Классические мечи, магия и сияющие королевства." },
      dark_fantasy: { name: "Тёмное фэнтези", blurb: "Мрачные земли, где надежда редка, а победы имеют цену." },
      mystery: { name: "Детектив", blurb: "Улики, подозреваемые и тайны за каждой дверью." },
      horror: { name: "Хоррор", blurb: "Страх, изоляция и вещи, которые лучше не видеть." },
      cyberpunk: { name: "Киберпанк", blurb: "Неоновые улицы, хромированные тела и корпоративные боги. Правила 5e в новом оформлении." },
      steampunk: { name: "Стимпанк", blurb: "Латунь, пар, дирижабли и невозможные машины." },
      post_apocalyptic: { name: "Постапокалипсис", blurb: "Ищите ресурсы, выживайте и восстанавливайте мир среди руин." },
      custom: { name: "Свой мир", blurb: "Опишите собственный мир и его настроение." },
    },
    customWorld: "Мир",
    customPlaceholder: "Опишите мир и его настроение...",
    length: "Длина",
    lengthTip: "Определяет, насколько далеко Мастер заранее планирует сюжет: акты, боссов и побочные задания. Изменение во время кампании применяется при планировании следующей саги; после финала любая длина может продолжиться новой сагой.",
    dmDifficulty: "Жёсткость Мастера",
    dmDifficultyTip: "Это не боевая сложность. 1 — мягкий Мастер, 10 — душный, придирчивый и подъёбистый; ошибки имеют полную цену. Кости не подкручиваются.",
    dmDifficultyHint: (value: number) => value <= 2 ? "Очень снисходительно" : value <= 4 ? "Честно и мягко" : value <= 6 ? "Строго" : value <= 8 ? "Жёстко" : "Душно и подъёбисто",
    dice: "Кости",
    diceTip: "Разрешить игрокам бросать физические кости: игра ждёт ввода результата вручную, считывает его с Bluetooth-кости Pixels или бросает на сервере (вкладка «Группа» -> «Источники костей»).",
    dicePolicy: "Правила костей",
    units: "Единицы измерения",
    unitsTip: "Система мер в повествовании, на тактической карте и в описаниях. Метрическая (метры, кг) используется по умолчанию.",
    combat: "Бой",
    combatTip: "Классический режим учитывает позиции встречи. JRPG — правило кампании: цели одной встречи игнорируют дальность, линию обзора, укрытие и провоцированные атаки; инициатива, кости, ресурсы, HP, состояния и приватность сохраняются.",
    combatClassical: "Классический",
    combatJrpg: "JRPG",
    enemyHp: "HP врагов",
    enemyHpTip: "Определяет, что игроки видят о здоровье противников. Мастер всегда видит точные HP.",
    enemyHpState: "Только состояние",
    enemyHpBar: "Полоска HP",
    enemyHpExact: "Точные HP",
    enemyEffects: "Эффекты врагов",
    enemyEffectsTip: "Определяет, видят ли игроки активные состояния противников и оставшуюся длительность, которую отслеживает сервер.",
    enemyEffectsHidden: "Не показывать",
    enemyEffectsStatus: "Показывать статус",
    enemyEffectsTurns: "Статус + длительность",
    unitsPolicy: "Единицы измерения",
    unitsMetric: "Метрические (м, кг)",
    unitsImperial: "Имперские (фт, фнт)",
    on: "Вкл.",
    off: "Выкл.",
    ambience: "Атмосфера",
    ambienceAutoTip: "Автоматически выбирает фон для новой локации и боевую музыку при начале боя. Если выключить, все изменения делает Мастер.",
    followsScene: "Следует за сценой",
    dmSets: "Выбирает Мастер",
    noAmbience: "На сервере пока не установлены аудиофайлы атмосферы, поэтому будет тишина. Запустите npm run fetch-ambience на сервере; FREESOUND_API_KEY расширяет доступные источники.",
    extras: "Дополнительно",
    multiclassing: "Мультиклассирование",
    multiclassTip: "Разрешить персонажам брать уровни второго или третьего класса при повышении уровня с соблюдением требований 5e.",
    midJoin: "Подключение по ходу",
    midJoinTip: "Разрешить новым игрокам присоединяться по коду приглашения после начала приключения.",
    open: "открыто",
    closed: "закрыто",
    heldResponses: "Отложенные действия",
    heldTip: "После каждого повествования Мастера игроки не могут действовать, пока вы не откроете ответы. OOC остаётся доступным.",
    remind: "Напоминать",
    remindTip: "Сколько игры может пройти без записи, прежде чем консоль напомнит сохранить произошедшее. Ваш собственный текст повествования учитывается, поэтому Мастер, который пишет сцены сам, напоминаний не увидит.",
    neverActions: "не напоминать по действиям",
    afterActions: (count: number) => `после ${count} действий`,
    rollsTip: "Темп боя: двенадцать бросков — примерно два раунда боя группы из четырёх персонажей.",
    neverRolls: "не напоминать по броскам",
    afterRolls: (count: number) => `после ${count} бросков`,
    livingWorld: "Живой мир",
    livingWorldTip: "Мир движется сам: фоновые линии развиваются скрытыми бросками, в спокойные периоды накапливаются сюрпризы и столкновения, а планы NPC продвигаются между главами, отдыхами и путешествиями. Основная сюжетная арка от этого не меняется.",
    livingWorldLabel: "Как работает живой мир?",
    livingWorldInfo: "Включено: мир движется и без группы. Фоновые линии развиваются скрытыми бросками, NPC преследуют собственные цели, а Мастер вплетает последствия в будущие сцены.\n\nВыключено: эти процессы ставятся на паузу. Мир меняется только из-за действий группы и основной сюжетной арки.\n\nНастройку можно менять в любой момент.",
    livingOnHelp: "Слухи, сюрпризы и закулисные планы развиваются между ходами.",
    livingOffHelp: "Ничего не происходит без действий группы или требований основной истории.",
    items: "Предметы",
    itemOffers: "Подтверждение предметов",
    itemTip: "Если включено, выданная Мастером добыча, удаление предметов и изменения золота становятся предложениями, которые владелец персонажа принимает или отклоняет. Урон, лечение, опыт и состояния применяются как обычно.",
    itemOnHelp: "Игроки подтверждают изменения предметов и золота до их применения.",
    itemOffHelp: "Изменения предметов и золота от Мастера применяются сразу; лидер может их отменить.",
    voice: "Голос",
    voiceChat: "Голосовой чат",
    voiceTip: "Голосовой чат для лобби и игры. На сервере есть отдельный глобальный переключатель и должен быть открыт медиапорт; если голос выключен на сервере, эта настройка не действует.",
    floorTip: "Определяет, насколько строго микрофоны следуют очередности. Мягкий режим только показывает очередь, строгий действительно приостанавливает микрофон игрока на сервере, а выключенный игнорирует очередь. Мастер никогда не заглушается.",
    turnsOff: "Ходы не учитываются",
    turnsSoft: "Ходы показываются",
    turnsStrict: "Ходы соблюдаются строго",
    proximity: "Слышимость по расстоянию",
    proximityTip: "Расстояние на боевой карте определяет, кто кого слышит. Вне боя или без карты все слышат всех как обычно. Мастер всегда слышит всех и слышен всем.",
    speakingRange: "Дальность обычной речи",
    feet: (value: number) => `${value} футов`,
    whisperShout: "Шёпот/крик",
    whisperTip: "Каждый игрок может выбрать шёпот на 5 футов, обычную речь или крик на 120 футов. Дальность относится к говорящему.",
    walls: "Стены приглушают",
    wallsTip: "Стена между персонажами приглушает голос, а не обрывает его. Туман войны не влияет на звук: невозможность видеть персонажа не означает невозможность его слышать.",
    downed: "При 0 HP не слышно",
    downedTip: "Персонаж с 0 HP перестаёт слышать стол. Он всё ещё слышит Мастера, а остальные всё ещё слышат его.",
    bonds: "Отношения",
    bondsTip: "Сервер отдельно отслеживает отношение каждого NPC и ИИ-компаньона к каждому персонажу от враждебности до преданности. Поступки меняют отношение, которое видно на вкладке связей и влияет на отыгрыш NPC.",
    romance: "Романтика",
    romanceTip: "Романтика развивается поверх отношений: интерес, ухаживание, пара, помолвка, брак. Инициатором всегда выступает игрок; интимные сцены всегда затемняются.",
    bondsOffHelp: "Личные отношения не отслеживаются; NPC реагируют на группу в целом.",
    bondsRomanceHelp: "Отношение отслеживается отдельно к каждому персонажу и может перерасти в романтику.",
    bondsOnlyHelp: "Отношение отслеживается отдельно к каждому персонажу; романтика выключена.",
    allies: "Союзники",
    alliesTip: "ИИ-компаньоны под управлением Мастера: постоянные спутники остаются с группой до увольнения, а гости приходят на одну сцену или бой и уходят автоматически. Авто выбирает постоянных спутников для соло и только гостей для группы.",
    maxPartyTitle: "Максимум постоянных спутников одновременно",
    maxGuestsTitle: "Максимум временных гостей одновременно",
    maxParty: (count: number) => `до ${count} в группе`,
    maxGuests: (count: number) => `до ${count} гостей`,
  },
} as const;

export function GameSettingsPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [ambienceInstalled, setAmbienceInstalled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) setPacks(Array.isArray(data.packs) ? data.packs : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!steersStory || !settings.ambienceEnabled) return;
    let cancelled = false;
    void fetch("/api/ambience")
      .then((response) => (response.ok ? response.json() : { tracks: {} }))
      .then((data) => {
        if (!cancelled) setAmbienceInstalled(Object.keys(data.tracks ?? {}).length > 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, settings.ambienceEnabled]);

  async function patch(update: Partial<GameSettings>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? copy.saveFailed);
      }
    } catch {
      setError(copy.serverFailed);
    } finally {
      setBusy(false);
    }
  }

  const preset = genrePreset(settings.genre);
  const selectedPack = packs.find((entry) => entry.id === settings.worldPack) ?? null;
  const selectClass =
    "min-w-0 max-w-full truncate rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";
  const genreText = copy.genres[settings.genre] ?? { name: preset.name, blurb: preset.blurb };

  if (!steersStory) {
    return (
      <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-300">{copy.gameSettings}</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-region" }} size="size-5" />
            {selectedPack?.name ?? genreText.name}
            {` · ${copy.humanDm}`}
            {` · ${copy.lengths[settings.campaignLength].split(" (")[0]} ${copy.campaignWord}`}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-dice" }} size="size-5" />
            {settings.dicePolicy === "real_allowed" ? copy.diceReal : copy.diceDigital}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-proficiency" }} size="size-5" />
            {copy.dmDifficulty} {settings.dmDifficulty}/10
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-ambience" }} size="size-5" />
            {settings.ambienceEnabled
              ? `${copy.ambienceOn}${settings.ambienceAuto ? ` (${copy.ambienceFollows})` : ""}`
              : copy.ambienceOff}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-5" />
            {settings.multiclassingEnabled ? copy.multiclassOn : copy.multiclassOff}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-friends" }} size="size-5" />
            {settings.midGameJoinOpen ? copy.joiningOpen : copy.joiningClosed}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" />
            {settings.holdSubmissions ? copy.held : copy.responsesOpen}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-storyboard" }} size="size-5" />
            {settings.worldSimulation ? copy.worldOn : copy.worldOff}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-loot" }} size="size-5" />
            {settings.inventoryApprovals ? copy.itemsApproval : copy.itemsAuto}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-bonds" }} size="size-5" />
            {settings.relationships === "off"
              ? copy.bondsOff
              : settings.romance !== "off"
                ? copy.bondsRomance
                : copy.bondsOnly}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-5" />
            {copy.companionsPrefix}: {copy.companions[settings.companions]}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-stone-300">{copy.gameSettings}</h2>
      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>

        {packs.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">{copy.worldPack}</span>
            <select
              value={settings.worldPack}
              onChange={(event) => {
                const next = packs.find((entry) => entry.id === event.target.value);
                patch(next ? { worldPack: next.id, genre: next.baseGenre } : { worldPack: "" });
              }}
              className={selectClass}
            >
              <option value="">{copy.noPack}</option>
              {packs.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
            <span className="text-stone-500">{selectedPack ? selectedPack.inspiredBy : copy.packHelp}</span>
          </div>
        ) : null}
        {selectedPack?.cover ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selectedPack.cover} alt="" className="h-20 w-36 rounded-md border border-stone-800 object-cover" />
          </div>
        ) : null}
        {selectedPack ? <WorldPackGallery packId={selectedPack.id} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.setting}</span>
          <select
            value={settings.genre}
            onChange={(event) =>
              patch({ genre: event.target.value as Genre, ...(settings.worldPack ? { worldPack: "" } : {}) })
            }
            className={selectClass}
          >
            {GENRE_PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>{copy.genres[entry.id].name}</option>
            ))}
          </select>
          <span className="text-stone-500">{genreText.blurb}</span>
        </div>
        {settings.genre === "custom" ? (
          <div className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-stone-500">{copy.customWorld}</span>
            <textarea
              defaultValue={settings.customGenreText}
              rows={2}
              maxLength={500}
              onBlur={(event) => patch({ customGenreText: event.target.value })}
              placeholder={copy.customPlaceholder}
              className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 outline-none focus:border-amber-600"
            />
          </div>
        ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">{copy.length}</span>
            <Tooltip content={copy.lengthTip}>
              <select
                value={settings.campaignLength}
                onChange={(event) => patch({ campaignLength: event.target.value as CampaignLengthSetting })}
                className={selectClass}
              >
                {CAMPAIGN_LENGTHS.map((value) => (
                  <option key={value} value={value}>{copy.lengths[value]}</option>
                ))}
              </select>
            </Tooltip>
          </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.dmDifficulty}</span>
          <Tooltip content={copy.dmDifficultyTip}>
            <select
              value={settings.dmDifficulty}
              onChange={(event) => patch({ dmDifficulty: Number(event.target.value) as GameSettings["dmDifficulty"] })}
              className={selectClass}
              aria-label={copy.dmDifficulty}
            >
              {DM_DIFFICULTY_LEVELS.map((value) => (
                <option key={value} value={value}>{value}/10</option>
              ))}
            </select>
          </Tooltip>
          <span className="text-stone-500">{copy.dmDifficultyHint(settings.dmDifficulty)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.dice}</span>
          <Tooltip content={copy.diceTip}>
            <select
              value={settings.dicePolicy}
              onChange={(event) => patch({ dicePolicy: event.target.value as DicePolicy })}
              className={selectClass}
              aria-label={copy.dicePolicy}
            >
              <option value="digital_only">{copy.diceDigital}</option>
              <option value="real_allowed">{copy.diceReal}</option>
            </select>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.units}</span>
          <Tooltip content={copy.unitsTip}>
            <select
              value={settings.unitSystem ?? "metric"}
              onChange={(event) => patch({ unitSystem: event.target.value as UnitSystemSetting })}
              className={selectClass}
              aria-label={copy.unitsPolicy}
            >
              <option value="metric">{copy.unitsMetric}</option>
              <option value="imperial">{copy.unitsImperial}</option>
            </select>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.combat}</span>
          <Tooltip content={copy.combatTip}>
            <select
              value={settings.combatMode}
              onChange={(event) => patch({ combatMode: event.target.value as CombatModeSetting })}
              className={selectClass}
              aria-label={copy.combat}
            >
              <option value={COMBAT_MODES[0]}>{copy.combatClassical}</option>
              <option value={COMBAT_MODES[1]}>{copy.combatJrpg}</option>
            </select>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.enemyHp}</span>
          <Tooltip content={copy.enemyHpTip}>
            <select
              value={settings.enemyHpVisibility}
              onChange={(event) =>
                patch({ enemyHpVisibility: event.target.value as GameSettings["enemyHpVisibility"] })
              }
              className={selectClass}
              aria-label={copy.enemyHp}
            >
              <option value="state">{copy.enemyHpState}</option>
              <option value="bar">{copy.enemyHpBar}</option>
              <option value="exact">{copy.enemyHpExact}</option>
            </select>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.enemyEffects}</span>
          <Tooltip content={copy.enemyEffectsTip}>
            <select
              value={settings.enemyConditionVisibility}
              onChange={(event) =>
                patch({
                  enemyConditionVisibility:
                    event.target.value as GameSettings["enemyConditionVisibility"],
                })
              }
              className={selectClass}
              aria-label={copy.enemyEffects}
            >
              <option value="hidden">{copy.enemyEffectsHidden}</option>
              <option value="status">{copy.enemyEffectsStatus}</option>
              <option value="status_turns">{copy.enemyEffectsTurns}</option>
            </select>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.ambience}</span>
          <button
            type="button"
            onClick={() => patch({ ambienceEnabled: !settings.ambienceEnabled })}
            className={cn("rounded-md border px-2 py-1", settings.ambienceEnabled ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}
          >
            {settings.ambienceEnabled ? copy.on : copy.off}
          </button>
          {settings.ambienceEnabled ? (
            <Tooltip content={copy.ambienceAutoTip}>
              <button
                type="button"
                onClick={() => patch({ ambienceAuto: !settings.ambienceAuto })}
                className={cn("rounded-md border px-2 py-1", settings.ambienceAuto ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}
              >
                {settings.ambienceAuto ? copy.followsScene : copy.dmSets}
              </button>
            </Tooltip>
          ) : null}
          {settings.ambienceEnabled && !ambienceInstalled ? <span className="text-stone-500">{copy.noAmbience}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.extras}</span>
          <Tooltip content={copy.multiclassTip}>
            <button type="button" onClick={() => patch({ multiclassingEnabled: !settings.multiclassingEnabled })} className={cn("rounded-md border px-2 py-1", settings.multiclassingEnabled ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.multiclassing} {settings.multiclassingEnabled ? copy.on : copy.off}
            </button>
          </Tooltip>
          <Tooltip content={copy.midJoinTip}>
            <button type="button" onClick={() => patch({ midGameJoinOpen: !settings.midGameJoinOpen })} className={cn("rounded-md border px-2 py-1", settings.midGameJoinOpen ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.midJoin} {settings.midGameJoinOpen ? copy.open : copy.closed}
            </button>
          </Tooltip>
          <Tooltip content={copy.heldTip}>
            <button type="button" onClick={() => patch({ holdSubmissions: !settings.holdSubmissions })} className={cn("rounded-md border px-2 py-1", settings.holdSubmissions ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.heldResponses} {settings.holdSubmissions ? copy.on : copy.off}
            </button>
          </Tooltip>
        </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">{copy.remind}</span>
            <Tooltip content={copy.remindTip}>
              <select
                value={settings.beatReminder.messages}
                onChange={(event) => patch({ beatReminder: { ...settings.beatReminder, messages: Number(event.target.value) } })}
                className={selectClass}
              >
                {[0, 5, 10, 20, 40].map((count) => <option key={count} value={count}>{count === 0 ? copy.neverActions : copy.afterActions(count)}</option>)}
              </select>
            </Tooltip>
            <select
              value={settings.beatReminder.rolls}
              onChange={(event) => patch({ beatReminder: { ...settings.beatReminder, rolls: Number(event.target.value) } })}
              className={selectClass}
              title={copy.rollsTip}
            >
              {[0, 6, 12, 24, 48].map((count) => <option key={count} value={count}>{count === 0 ? copy.neverRolls : copy.afterRolls(count)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">{copy.worldPack}</span>
            <Tooltip content={copy.livingWorldTip}>
              <button type="button" onClick={() => patch({ worldSimulation: !settings.worldSimulation })} className={cn("rounded-md border px-2 py-1", settings.worldSimulation ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                {copy.livingWorld} {settings.worldSimulation ? copy.on : copy.off}
              </button>
            </Tooltip>
            <InfoButton label={copy.livingWorldLabel} text={copy.livingWorldInfo} />
            <span className="text-stone-500">{settings.worldSimulation ? copy.livingOnHelp : copy.livingOffHelp}</span>
          </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.items}</span>
          <Tooltip content={copy.itemTip}>
            <button type="button" onClick={() => patch({ inventoryApprovals: !settings.inventoryApprovals })} className={cn("rounded-md border px-2 py-1", settings.inventoryApprovals ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.itemOffers} {settings.inventoryApprovals ? copy.on : copy.off}
            </button>
          </Tooltip>
          <span className="text-stone-500">{settings.inventoryApprovals ? copy.itemOnHelp : copy.itemOffHelp}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.voice}</span>
          <Tooltip content={copy.voiceTip}>
            <button type="button" onClick={() => patch({ voice: { ...settings.voice, enabled: !settings.voice.enabled } })} className={cn("rounded-md border px-2 py-1", settings.voice.enabled ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.voiceChat} {settings.voice.enabled ? copy.on : copy.off}
            </button>
          </Tooltip>
          {settings.voice.enabled ? (
            <>
              <Tooltip content={copy.floorTip}>
                <select
                  value={settings.voice.turnEnforcement}
                  onChange={(event) => patch({ voice: { ...settings.voice, turnEnforcement: event.target.value as "off" | "soft" | "strict" } })}
                  className={selectClass}
                >
                  <option value="off">{copy.turnsOff}</option>
                  <option value="soft">{copy.turnsSoft}</option>
                  <option value="strict">{copy.turnsStrict}</option>
                </select>
              </Tooltip>
              <Tooltip content={copy.proximityTip}>
                <button type="button" onClick={() => patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, proximity: !settings.voice.rules.proximity } } })} className={cn("rounded-md border px-2 py-1", settings.voice.rules.proximity ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                  {copy.proximity} {settings.voice.rules.proximity ? copy.on : copy.off}
                </button>
              </Tooltip>
              {settings.voice.rules.proximity ? (
                <>
                  <select
                    value={settings.voice.rules.hearingRangeFeet}
                    onChange={(event) => patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, hearingRangeFeet: Number(event.target.value) } } })}
                    className={selectClass}
                    aria-label={copy.speakingRange}
                    title={copy.speakingRange}
                  >
                    {[15, 30, 60, 120].map((feet) => <option key={feet} value={feet}>{copy.feet(feet)}</option>)}
                  </select>
                  <Tooltip content={copy.whisperTip}>
                    <button type="button" onClick={() => patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, sayRange: !settings.voice.rules.sayRange } } })} className={cn("rounded-md border px-2 py-1", settings.voice.rules.sayRange ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                      {copy.whisperShout} {settings.voice.rules.sayRange ? copy.on : copy.off}
                    </button>
                  </Tooltip>
                  <Tooltip content={copy.wallsTip}>
                    <button type="button" onClick={() => patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, wallsAttenuate: !settings.voice.rules.wallsAttenuate } } })} className={cn("rounded-md border px-2 py-1", settings.voice.rules.wallsAttenuate ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                      {copy.walls} {settings.voice.rules.wallsAttenuate ? copy.on : copy.off}
                    </button>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip content={copy.downedTip}>
                <button type="button" onClick={() => patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, downedGoDeaf: !settings.voice.rules.downedGoDeaf } } })} className={cn("rounded-md border px-2 py-1", settings.voice.rules.downedGoDeaf ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                  {copy.downed} {settings.voice.rules.downedGoDeaf ? copy.on : copy.off}
                </button>
              </Tooltip>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">{copy.bonds}</span>
          <Tooltip content={copy.bondsTip}>
            <button type="button" onClick={() => patch({ relationships: settings.relationships === "off" ? "on" : "off" })} className={cn("rounded-md border px-2 py-1", settings.relationships !== "off" ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
              {copy.bonds} {settings.relationships !== "off" ? copy.on : copy.off}
            </button>
          </Tooltip>
          {settings.relationships !== "off" ? (
            <Tooltip content={copy.romanceTip}>
              <button type="button" onClick={() => patch({ romance: settings.romance === "off" ? "on" : "off" })} className={cn("rounded-md border px-2 py-1", settings.romance !== "off" ? "border-amber-700 bg-amber-950/50 text-amber-200" : "border-stone-700 text-stone-400")}>
                {copy.romance} {settings.romance !== "off" ? copy.on : copy.off}
              </button>
            </Tooltip>
          ) : null}
          <span className="text-stone-500">{settings.relationships === "off" ? copy.bondsOffHelp : settings.romance !== "off" ? copy.bondsRomanceHelp : copy.bondsOnlyHelp}</span>
        </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">{copy.allies}</span>
            <Tooltip content={copy.alliesTip}>
              <select
                value={settings.companions}
                onChange={(event) => patch({ companions: event.target.value as GameSettings["companions"] })}
                className={selectClass}
              >
                {(Object.keys(copy.companions) as Array<GameSettings["companions"]>).map((mode) => <option key={mode} value={mode}>{copy.companions[mode]}</option>)}
              </select>
            </Tooltip>
            {settings.companions !== "off" ? (
              <>
                {settings.companions !== "guests" ? (
                  <select value={settings.maxCompanions} onChange={(event) => patch({ maxCompanions: Number(event.target.value) })} className={selectClass} title={copy.maxPartyTitle}>
                    {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{copy.maxParty(count)}</option>)}
                  </select>
                ) : null}
                <select value={settings.maxGuests} onChange={(event) => patch({ maxGuests: Number(event.target.value) })} className={selectClass} title={copy.maxGuestsTitle}>
                  {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{copy.maxGuests(count)}</option>)}
                </select>
              </>
            ) : null}
          </div>
      </div>
    </section>
  );
}
