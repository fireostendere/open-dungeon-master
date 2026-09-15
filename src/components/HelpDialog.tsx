"use client";

import Link from "next/link";
import {
  BookOpen,
  Brain,
  CircleHelp,
  Compass,
  Footprints,
  Crown,
  Dices,
  DoorOpen,
  Gavel,
  MessageSquareText,
  Mic,
  Music,
  PanelRight,
  Puzzle,
  RefreshCw,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    title: "Help",
    toursTitle: "Guided tours",
    toursText:
      "A spotlight walk through the table's controls, one at a time. Each tour ran once when you first sat down; take it again whenever you like.",
    gettingTitle: "Getting started",
    getting1:
      "Create a campaign from the home page, or join a friend's with their invite code or a /join link. Build a character in the creation wizard, or reuse one saved to your library under Characters in the account menu. When everyone in the lobby is ready, the owner starts the adventure.",
    getting2:
      "If the server has campaign plugins installed, the create form also offers a pre-built world to run the campaign in. See Campaign plugins below for what that changes.",
    lobbyTitle: "The lobby",
    lobby:
      "Before the game begins, each player readies up and whoever steers the story (the party lead, or the DM when a person runs the table) can adjust the game settings: genre, an optional secret story setup for the DM, dice policy, narration voice, and maps. Share the room code or copy the invite link to bring in more players; the owner or the DM opens the table once everyone is ready.",
    talkingTitle: "Talking to the DM",
    talkingIntro: "The buttons above the message box change what your message means:",
    doLabel: "Do",
    doText:
      "Describe what your character does. The DM narrates the outcome and asks for dice rolls when the rules call for them.",
    sayLabel: "Say",
    sayText: "Speak in character. Your text is sent as spoken dialogue, in quotes.",
    oocLabel: "OOC",
    oocText:
      "Out-of-character table talk. The DM does not respond to it, and it stays available even when the floor is locked during narration or a spotlight.",
    directLabel: "Direct",
    directText:
      "Party lead only. Send the DM an authoritative story direction it must weave into the tale, or arm one of the seven canned events: Combat, Place, Social, Romance, Mystery, Weird or Windfall. Turn on Private and the direction goes to the DM alone: no character hears it, it never enters the transcript, and it steers the next turn instead of this one. The table still sees that something is armed, just never what.",
    ask1:
      "Questions are not one of these buttons. Open the Ask the DM strip just above the message box and use its own question box. Set About to Auto, Story, Rules or My sheet to say where the answer should come from, and Seen by to Just me or The table to say who reads it. Answers quote what the campaign has on record under From the record.",
    ask2:
      "Asking writes nothing to the transcript and never moves the story on, so it works during narration, during someone else's spotlight, and while the floor is locked. Collapsing the strip keeps a half-typed question and your place in the thread.",
    ask3:
      "Sometimes the DM puts one player in the spotlight and waits for them to act. While the floor is locked for you, a banner explains why, and OOC and the Ask strip still work. Small chips above the message box name the background work the engine is doing between turns, such as compacting history, sealing a chapter, running the world tick or answering an Ask, with how long it has been going.",
    wrongTitle: "When the DM gets it wrong",
    wrongIntro:
      "Hover a DM message and a row of actions appears above it. None of them advance the story or change a single number the rules produced. Rewriting the narration belongs to the party lead, since everyone reads the same transcript:",
    rerollLabel: "Reroll",
    reroll:
      "Lead only. Have the DM write that moment again with the same dice and the same outcome, optionally with a note on what to do differently. Only the prose changes.",
    takesLabel: "Takes",
    takes:
      "Lead only. Once a second version exists, arrows and a counter appear in the message header. Paging between takes swaps the message for the whole table.",
    continueLabel: "Continue",
    continueText:
      "Lead only. Have the DM keep writing from where a reply stopped short, without moving the story on.",
    editLabel: "Edit",
    edit:
      "Lead only. Fix what the DM said by hand. Mechanics are untouched and every dice marker in the passage has to survive the edit.",
    loreCheckLabel: "Lore check",
    loreCheck:
      "Anyone. Flag the passage, or just the text you selected, against the campaign record and see whether it contradicts anything already established.",
    failedTurn:
      "If a DM turn fails outright, a banner offers to send it back in from where it stopped. It resumes the turn that was already running, so nobody has to retype an action and nothing lands in the transcript twice.",
    memoryTitle: "What the DM remembers",
    memoryIntro:
      "Recent turns are in front of the DM word for word. Older ones are compacted into a rolling summary, and closed chapters become chapter summaries it can search and re-read when the table brings up something from long ago.",
    rememberLabel: "Remember",
    remember:
      "Any player can select text in a DM message and press the bookmark icon, or press it with nothing selected to keep the whole message. Pinned memories ride in every prompt from then on. There is a size budget, and the Pinned memories list under Story, Facts shows how much of it the table has spent.",
    canonLabel: "Pin as canon",
    canon:
      "Party lead only, because it writes to the campaign record. Keeps a passage in front of the DM permanently as established fact.",
    factsLabel: "Facts and lore",
    facts:
      "Story, Facts also holds DM secrets the DM must never contradict and the lore entries the table has written up.",
    bondsLabel: "Bonds",
    bonds: "Under Party, where each character stands with the people they have dealt with.",
    memoryOutro:
      "NPCs the party stops mentioning are archived so they do not crowd out the ones in play, and the party lead can see exactly what the DM was sent on the last turn, plus anything the budget cut, in the Context tab.",
    panelTitle: "The side panel",
    partyLabel: "Party",
    party:
      "The roster, with character sheets, HP and conditions for the whole party, and the active encounter during combat. A Bonds sub-tab appears when relationships are on. The room code is in the lead's tab.",
    battleLabel: "Battle",
    battle:
      "The tactical battle map, while a fight with a map is running. Move your token on your turn.",
    mapLabel: "Map",
    map: "The scene map, the overworld and discovered locations, when maps are enabled.",
    storyLabel: "Story",
    story:
      "Three sub-tabs. Chapters is the tale so far and the arc in play, and it is where you export the story. Facts holds pinned memories, DM secrets and lore. Log is the audited record of every dice roll and every stat change the DM makes.",
    notesLabel: "Notes",
    notes: "Suggest campaign notes for the story; the party lead approves them.",
    chatLabel: "Chat",
    chat:
      "Private whispers between you and the DM, and side chat between players that the DM and the campaign transcript never see.",
    contextLabel: "Context",
    context:
      "Party lead only. What the DM was actually sent last turn, and anything the token budget dropped.",
    setupLabel: "Setup",
    setup: "Campaign settings, invites and game toggles.",
    diceTitle: "Dice",
    dice1:
      "Every check, save, and attack is rolled by the server, never invented by the AI. The dice button in the header toggles the 3D dice animation. If you opt into real dice in the game settings, the DM waits for you to enter your physical roll, with a digital fallback button if you would rather let the server roll.",
    dice2:
      "Once you have opted in, the Dice sources button in the Party tab lets you decide per die which happens: type the physical roll yourself, let the server roll that die for you, or read it straight from a connected Pixels Bluetooth die. Pairing a Pixel needs a Chromium-based browser and a secure (https) connection, because that is what Web Bluetooth requires. When every die in a request is covered by a Pixel or the server, the roll submits itself the moment the last die lands. These choices are saved in the browser you set them in, so set them again if you switch devices.",
    narrationTitle: "Voice and narration",
    narration:
      "When narration is enabled, the DM reads its replies aloud. Use the speaker button in the header to unmute (browsers require one click before audio can play) and the slider to set the volume. Hover a DM message to replay its narration. Push-to-talk, when configured, lets you hold the microphone button to dictate your message.",
    liveVoiceTitle: "Live voice chat",
    liveVoice1:
      "When the server and the campaign both have voice chat switched on, a Voice card appears in the lobby, and during play a headphones button sits in the top bar with the full voice menu under it. Join and you are talking to the table; no other app needed, and the call stays up whatever panel you switch to. The microphone needs a secure (https) connection, and your browser will ask permission the first time.",
    liveVoice2:
      "Whoever runs the story can open side rooms for a split party or a private word, and can hold the floor: soft enforcement marks who should be talking, strict actually mutes everyone else, and a raised-hand queue keeps it civil. A table can also opt into rules that make the call behave like the world: proximity hearing, whisper and shout ranges, walls muffling speech, and downed characters going deaf. All of that lives under voice settings in Setup and is off by default, so a plain group call is what you get until the table asks for more.",
    ambienceTitle: "Ambience and music",
    ambience1:
      "With ambience enabled in the game settings, the table shares a soundtrack: a background bed for where the party is, a music layer for what the scene is doing, and one-shot stings for dramatic moments. The DM changes it as the story moves, and combat brings its own sound. Whoever runs the story can also hold a layer on a chosen cue so the auto-picker leaves it alone. Your speaker button and volume slider in the header control it for you alone, and it ducks automatically while narration speaks.",
    ambience2:
      "The sounds themselves are public-domain and Creative Commons recordings the server admin installs; see the licenses page for who made what. If ambience is on but silent, the server simply has no audio installed yet.",
    humanDmTitle: "Playing with a human DM",
    humanDm1:
      "A campaign does not have to be run by the AI. Created with a person in the DM seat, the table works the way a kitchen-table game does: the DM narrates in their own words, and the app keeps the sheets, dice, maps and record straight underneath them. Your Do and Say messages still land in the transcript, but instead of waking the AI they queue as intents for the DM to answer. The DM holds no party slot, holds the story secrets the party lead would hold at an AI table, and gets a console of tools: initiative, monsters, maps, NPCs, roll tables and rulings, with an AI assistant one click away for stat blocks and suggestions if wanted.",
    humanDm2:
      "The in-between setting, assisted mode, lets the DM keep the story and hand bookkeeping to the AI a piece at a time: it can run the monsters' turns, read the DM's notes aloud as full prose, or cover the table for a counted stretch of answers while the DM steps away, following the outline they left behind.",
    humanDm3:
      "Because the narration happens out loud, the app nudges the DM every so often to jot down a story beat, a line or two about what just happened. Beats are what chapter summaries, recaps and the exported story are built from, so a table that never writes any ends up with a transcript of intents and no tale. Players can help by keeping their actions in the composer rather than only in the call.",
    leadTitle: "Party lead",
    lead1:
      "The campaign owner starts as party lead and can pass the role from a party member's menu. The lead steers the table: the Direct message mode with its event presets and private directions, approving suggested notes, releasing a stuck spotlight, retrying a halted turn, rerolling or editing narration, letting new players join mid-game, and editing campaign settings and house rules.",
    lead2:
      "The lead also owns the story spine, under Story, Chapters. A single beat can be reworded, skipped or promoted to the one in play without regenerating the whole arc, a chapter can be sealed early, and the whole campaign can be rewound to the start of a chapter. A rewind is destructive: it asks for confirmation and lists what it will undo first, then puts sheets, NPCs, locations, maps and quest state back the way they were.",
    lead3:
      "Where the engine spots two NPC names that might be the same person but refuses to merge them on a guess, the lead is the one who settles it.",
    lead4:
      "At a table with a human DM the split is different: the lead keeps the invites and campaign details but is otherwise a player, because the story powers above exist to steer the AI and there is no AI to steer. Story secrets, settings, rules, floor control, narration fixes and the DM seats belong to the person in the DM seat instead.",
    pluginsTitle: "Campaign plugins",
    plugins1:
      "A campaign can run in a world pack: a pre-built setting with its own races, classes, spells, gear, monsters, factions and lore, and a brief telling the DM how that world should sound. Picking one at creation also sets the campaign's genre and can fill in its theme and premise.",
    plugins2:
      "A pack renames things; it never changes a rule. Everything underneath is still 5e, your sheet still stores the canonical names, and a character built in a pack campaign can be brought into a plain one and simply reads under its ordinary names again.",
    plugins3:
      "Server admins install and remove packs under Admin, Campaign plugins, from a registry or from a file. A pack built on somebody else's setting carries an unofficial-work notice wherever it appears: it is fan-made and is not affiliated with, sponsored by or endorsed by the rights holder.",
    newTitle: "New to D&D?",
    new1:
      "You do not need to know the rules to play; the DM and the server handle them. When a term comes up that you do not recognize, look for the small info button next to it: every feature, spell and stat on your sheet explains itself.",
    rulesReference: "rules reference",
    new2:
      "collects the basics in plain language and lets you search every spell, feat, item and condition the app knows about.",
    aboutTitle: "About",
    about1:
      "Open Dungeon Master is a self-hosted, multiplayer Dungeons & Dragons 5e platform run by an AI Dungeon Master. Server admins manage users, models, images, voice and campaign plugins from the Admin panel. Game content comes from the SRD 5.1 and Open5e; see",
    licenses: "licenses and attribution",
  },
  ru: {
    title: "Справка",
    toursTitle: "Интерактивные туры",
    toursText:
      "Пошаговый обзор элементов управления игрового стола с подсветкой каждого элемента. Каждый тур запускается один раз при первом входе, но здесь его можно повторить в любой момент.",
    gettingTitle: "С чего начать",
    getting1:
      "Создайте кампанию на главной странице или присоединитесь к кампании друга по коду приглашения либо ссылке /join. Создайте персонажа в мастере или используйте сохранённого из раздела «Персонажи» в меню аккаунта. Когда все в лобби готовы, владелец начинает приключение.",
    getting2:
      "Если на сервере установлены плагины кампаний, форма создания также предложит готовый мир. Подробнее о том, что он меняет, см. ниже в разделе «Плагины кампаний».",
    lobbyTitle: "Лобби",
    lobby:
      "До начала игры каждый игрок отмечается как готовый, а тот, кто ведёт историю — лидер партии или человек-DM — может настроить жанр, скрытую завязку для мастера, правила бросков, голос повествования и карты. Поделитесь кодом комнаты или ссылкой-приглашением, чтобы добавить игроков; владелец или DM открывает стол, когда все готовы.",
    talkingTitle: "Общение с мастером",
    talkingIntro: "Кнопки над полем сообщения определяют смысл вашего текста:",
    doLabel: "Действие",
    doText:
      "Опишите, что делает персонаж. Мастер расскажет результат и запросит бросок, если этого требуют правила.",
    sayLabel: "Речь",
    sayText: "Говорите от лица персонажа. Текст отправляется как его реплика в кавычках.",
    oocLabel: "OOC",
    oocText:
      "Разговор игроков вне персонажей. Мастер на него не отвечает; канал остаётся доступным даже во время заблокированного повествования или фокуса на другом игроке.",
    directLabel: "Указание",
    directText:
      "Только для лидера партии. Отправьте мастеру обязательное сюжетное указание, которое он должен вплести в историю, либо подготовьте одно из семи событий: Бой, Место, Общение, Романтика, Тайна, Странность или Удача. Включите «Приватно», и указание увидит только мастер: персонажи его не услышат, оно не попадёт в стенограмму и повлияет на следующий ход, а не на текущий. Стол увидит лишь то, что что-то подготовлено, но не содержание.",
    ask1:
      "Вопросы задаются отдельно от этих режимов. Откройте панель «Спросить мастера» над полем сообщения. В «О чём» выберите Авто, История, Правила или Мой лист, чтобы указать источник ответа, а в «Кому видно» — Только мне или Всему столу. Ответ цитирует зафиксированные данные кампании в разделе «Из записей».",
    ask2:
      "Вопрос ничего не добавляет в стенограмму и не двигает сюжет, поэтому им можно пользоваться во время повествования, чужого фокуса и блокировки действий. Если свернуть панель, недописанный вопрос и место в ветке сохранятся.",
    ask3:
      "Иногда мастер отдаёт сцену одному игроку и ждёт его действия. Если из-за этого ваши действия заблокированы, баннер объяснит причину; OOC и панель вопросов продолжат работать. Небольшие индикаторы над полем сообщения показывают фоновые задачи между ходами — например, сжатие истории, закрытие главы, обновление мира или ответ на вопрос — и длительность их выполнения.",
    wrongTitle: "Если мастер ошибся",
    wrongIntro:
      "Наведите курсор на сообщение мастера — над ним появится ряд действий. Ни одно из них не продвигает сюжет и не меняет числа, рассчитанные правилами. Поскольку стенограмма общая, переписывать повествование может лидер партии:",
    rerollLabel: "Переписать",
    reroll:
      "Только лидер. Попросите мастера заново описать момент с теми же кубиками и тем же исходом, при желании добавив указание, что изменить. Меняется только текст.",
    takesLabel: "Варианты",
    takes:
      "Только лидер. После появления второго варианта в заголовке сообщения появятся стрелки и счётчик. Переключение варианта меняет сообщение для всего стола.",
    continueLabel: "Продолжить",
    continueText:
      "Только лидер. Попросите мастера продолжить оборвавшийся ответ с того же места, не продвигая сюжет отдельным ходом.",
    editLabel: "Изменить",
    edit:
      "Только лидер. Исправьте слова мастера вручную. Механика не меняется, а все маркеры бросков в тексте должны сохраниться.",
    loreCheckLabel: "Проверка лора",
    loreCheck:
      "Доступно всем. Сверьте весь фрагмент или только выделенный текст с записями кампании и проверьте, не противоречит ли он уже установленным фактам.",
    failedTurn:
      "Если ход мастера завершился ошибкой, баннер предложит возобновить его с места остановки. Продолжается уже начатый ход, поэтому никому не нужно повторно вводить действие, а в стенограмме не появляются дубликаты.",
    memoryTitle: "Что помнит мастер",
    memoryIntro:
      "Недавние ходы передаются мастеру дословно. Более старые постепенно сжимаются в сводку, а закрытые главы превращаются в отдельные резюме, которые мастер может искать и перечитывать, когда стол возвращается к давним событиям.",
    rememberLabel: "Запомнить",
    remember:
      "Любой игрок может выделить текст в сообщении мастера и нажать закладку либо нажать её без выделения, чтобы сохранить сообщение целиком. Закреплённые воспоминания после этого попадают в каждый запрос к мастеру. Для них есть ограничение размера; список «Закреплённые воспоминания» в «История → Факты» показывает, сколько бюджета уже использовано.",
    canonLabel: "Закрепить как канон",
    canon:
      "Только лидер партии, потому что действие изменяет постоянные записи кампании. Фрагмент навсегда остаётся перед мастером как установленный факт.",
    factsLabel: "Факты и лор",
    facts:
      "В «История → Факты» также хранятся секреты мастера, которым он не должен противоречить, и записи лора, созданные столом.",
    bondsLabel: "Связи",
    bonds: "На вкладке «Партия» показаны отношения каждого персонажа с людьми, которых он встречал.",
    memoryOutro:
      "NPC, которых партия давно не упоминает, архивируются и не вытесняют активных персонажей. На вкладке «Контекст» лидер может увидеть, что именно было отправлено мастеру в последнем ходу и что пришлось исключить из-за лимита контекста.",
    panelTitle: "Боковая панель",
    partyLabel: "Партия",
    party:
      "Состав группы, листы персонажей, HP и состояния всей партии, а во время боя — активная встреча. При включённых отношениях появляется подвкладка «Связи». Код комнаты находится во вкладке лидера.",
    battleLabel: "Бой",
    battle: "Тактическая карта сражения. Во время своего хода перемещайте фишку персонажа.",
    mapLabel: "Карта",
    map: "Карта сцены, карта мира и открытые локации, если карты включены.",
    storyLabel: "История",
    story:
      "Три подвкладки. «Главы» содержат историю кампании и текущую сюжетную арку, оттуда же экспортируется рассказ. «Факты» хранят закреплённые воспоминания, секреты мастера и лор. «Журнал» — проверяемая запись каждого броска и каждого изменения характеристик, сделанного мастером.",
    notesLabel: "Заметки",
    notes: "Предлагайте заметки для истории кампании; лидер партии решает, какие принять.",
    chatLabel: "Чат",
    chat:
      "Приватный шёпот между вами и мастером и отдельный чат игроков, которого не видят ни мастер, ни стенограмма кампании.",
    contextLabel: "Контекст",
    context:
      "Только лидер партии. Показывает, что реально было отправлено мастеру в прошлом ходу и что не поместилось в лимит контекста.",
    setupLabel: "Настройка",
    setup: "Параметры кампании, приглашения и игровые переключатели.",
    diceTitle: "Кубики",
    dice1:
      "Каждая проверка, спасбросок и атака бросается сервером, а не придумывается ИИ. Кнопка кубиков в заголовке включает и выключает 3D-анимацию. Если в настройках выбраны реальные кубики, мастер ждёт ввода физического результата; при желании можно нажать цифровой запасной вариант и поручить бросок серверу.",
    dice2:
      "После включения реальных кубиков кнопка «Источники кубиков» на вкладке «Партия» позволяет выбрать источник для каждого кубика: вручную ввести физический результат, поручить бросок серверу или считать его с подключённого Bluetooth-кубика Pixels. Для подключения Pixels нужен браузер на Chromium и безопасное HTTPS-соединение — этого требует Web Bluetooth. Если все кубики запроса обслуживаются Pixels или сервером, результат отправится автоматически после последнего броска. Настройки сохраняются в текущем браузере и на другом устройстве задаются заново.",
    narrationTitle: "Голос и озвучка",
    narration:
      "Когда озвучка включена, мастер читает ответы вслух. Кнопка динамика в заголовке снимает заглушение — браузеру нужен хотя бы один клик перед воспроизведением звука — а ползунок задаёт громкость. Наведите курсор на сообщение мастера, чтобы воспроизвести его снова. Если настроен push-to-talk, удерживайте кнопку микрофона и диктуйте сообщение.",
    liveVoiceTitle: "Голосовой чат",
    liveVoice1:
      "Если голосовой чат включён и на сервере, и в кампании, в лобби появляется карточка «Голос», а во время игры — кнопка наушников с полным голосовым меню. Подключитесь и сразу говорите со столом: отдельное приложение не требуется, а звонок не прерывается при переключении панелей. Для микрофона нужен HTTPS, и при первом использовании браузер запросит разрешение.",
    liveVoice2:
      "Ведущий может создавать отдельные комнаты для разделившейся партии или приватного разговора и управлять очередностью речи: мягкий режим лишь показывает, кто должен говорить, строгий заглушает остальных, а очередь поднятых рук помогает соблюдать порядок. Можно включить правила, связывающие голос с миром игры: слышимость по расстоянию, дальность шёпота и крика, приглушение стенами и потерю слуха у выведенных из строя персонажей. Всё это настраивается в голосовом разделе «Настройки» и по умолчанию выключено, поэтому без дополнительных настроек это обычный групповой звонок.",
    ambienceTitle: "Атмосфера и музыка",
    ambience1:
      "Если в настройках включён ambience, стол получает общий саундтрек: фоновый слой для текущего места, музыкальный слой под настроение сцены и короткие эффекты для драматических моментов. Мастер меняет звук по ходу истории, а бой использует отдельное сопровождение. Ведущий может закрепить выбранный трек, чтобы автоматический подбор его не менял. Кнопка динамика и ползунок громкости управляют звуком только для вас; во время озвучки повествования громкость автоматически снижается.",
    ambience2:
      "Звуки — записи из общественного достояния и под Creative Commons, установленные администратором сервера. Авторы перечислены на странице лицензий. Если ambience включён, но ничего не слышно, значит на сервере пока не установлены аудиофайлы.",
    humanDmTitle: "Игра с человеком-DM",
    humanDm1:
      "Кампанию не обязательно должен вести ИИ. Если место DM занимает человек, стол работает как обычная настольная сессия: мастер рассказывает своими словами, а приложение ведёт листы, кубики, карты и журнал. Сообщения «Действие» и «Речь» по-прежнему попадают в стенограмму, но вместо запуска ИИ становятся намерениями, на которые отвечает мастер. DM не занимает место игрока, хранит сюжетные секреты, которые за AI-столом доступны лидеру, и получает консоль инструментов: инициативу, монстров, карты, NPC, таблицы бросков и решения по правилам; при желании AI-помощник в один клик подскажет статблоки и идеи.",
    humanDm2:
      "Промежуточный «ассистируемый режим» оставляет сюжет человеку, но позволяет по частям отдавать ИИ рутину: проводить ходы монстров, превращать заметки DM в полноценную озвученную прозу или временно «прикрыть стол» на заданное число ответов, пока мастер отошёл, следуя оставленному им плану.",
    humanDm3:
      "Поскольку основное повествование звучит вслух, приложение периодически напоминает DM записать сюжетный эпизод — одну-две строки о произошедшем. Из этих эпизодов строятся резюме глав, повторы и экспортируемая история. Если их никогда не записывать, останется стенограмма намерений без полноценного рассказа. Игроки помогают, если вводят действия в поле сообщений, а не сообщают их только голосом.",
    leadTitle: "Лидер партии",
    lead1:
      "Владелец кампании изначально становится лидером и может передать роль через меню участника. Лидер управляет AI-столом: использует режим «Указание» с событиями и приватными направлениями, утверждает предложенные заметки, снимает зависший фокус, повторяет остановившийся ход, переписывает или редактирует повествование, разрешает новым игрокам входить по ходу игры и меняет настройки кампании и домашние правила.",
    lead2:
      "Лидер также управляет основой сюжета в «История → Главы». Отдельный эпизод можно переформулировать, пропустить или сделать текущим без полной перегенерации арки; главу можно закрыть досрочно, а кампанию — откатить к началу главы. Откат разрушителен: сначала он запрашивает подтверждение и перечисляет последствия, затем возвращает листы, NPC, локации, карты и состояние квестов к прежнему виду.",
    lead3:
      "Если движок замечает два имени NPC, которые могут обозначать одного персонажа, но не решается объединить их автоматически, окончательное решение принимает лидер.",
    lead4:
      "За столом с человеком-DM разделение другое: лидер сохраняет управление приглашениями и общими данными кампании, но в остальном остаётся обычным игроком. Сюжетные полномочия нужны для управления ИИ, которого здесь нет. Секреты, настройки, правила, контроль очереди, исправление повествования и инструменты DM принадлежат человеку в кресле мастера.",
    pluginsTitle: "Плагины кампаний",
    plugins1:
      "Кампания может проходить в world pack — готовом сеттинге со своими расами, классами, заклинаниями, снаряжением, монстрами, фракциями и лором, а также инструкцией о стиле повествования для мастера. Выбор набора при создании задаёт жанр кампании и может заполнить тему и завязку.",
    plugins2:
      "Набор переименовывает сущности, но никогда не меняет правила. Под ним всё равно работает 5e, лист хранит канонические названия, а персонажа из такой кампании можно перенести в обычную — там он снова будет отображаться стандартными именами.",
    plugins3:
      "Администраторы устанавливают и удаляют наборы в «Администрирование → Плагины кампаний» из реестра или файла. Набор, основанный на чужом сеттинге, везде помечается как неофициальная фанатская работа и не считается связанным с правообладателем, спонсируемым или одобренным им.",
    newTitle: "Впервые в D&D?",
    new1:
      "Чтобы играть, не обязательно знать правила: мастер и сервер возьмут их на себя. Если встретился незнакомый термин, ищите маленькую информационную кнопку рядом — каждое умение, заклинание и характеристика в листе умеют объяснять себя.",
    rulesReference: "справочник правил",
    new2:
      "собирает основы простым языком и позволяет искать все заклинания, черты, предметы и состояния, известные приложению.",
    aboutTitle: "О проекте",
    about1:
      "Open Dungeon Master — самостоятельно размещаемая многопользовательская платформа Dungeons & Dragons 5e с AI Dungeon Master. Администраторы сервера управляют пользователями, моделями, изображениями, голосом и плагинами кампаний через панель Admin. Игровой контент основан на SRD 5.1 и Open5e; см.",
    licenses: "лицензии и атрибуцию",
  },
  pl: {
    title: "Pomoc",
    toursTitle: "Samouczki z przewodnikiem",
    toursText:
      "Krok po kroku przejdź przez elementy sterowania stołem, podświetlane po kolei. Każdy samouczek uruchomił się przy pierwszym wejściu do stołu, ale tutaj możesz powtórzyć go w dowolnym momencie.",
    gettingTitle: "Jak zacząć",
    getting1:
      "Utwórz kampanię na stronie głównej albo dołącz do kampanii znajomego kodem zaproszenia lub linkiem /join. Zbuduj postać w kreatorze albo użyj zapisanej wcześniej postaci z sekcji „Postacie” w menu konta. Gdy wszyscy w lobby są gotowi, właściciel rozpoczyna przygodę.",
    getting2:
      "Jeśli serwer ma zainstalowane dodatki kampanii, formularz tworzenia zaoferuje również gotowy świat. Poniżej, w sekcji „Dodatki kampanii”, opisano, co to zmienia.",
    lobbyTitle: "Lobby",
    lobby:
      "Przed rozpoczęciem gry każdy gracz oznacza gotowość, a osoba prowadząca historię — lider drużyny albo ludzki MG — może zmienić ustawienia: gatunek, opcjonalny tajny zarys fabuły dla MG, zasady kości, głos narracji i mapy. Udostępnij kod pokoju lub link z zaproszeniem, aby dodać graczy; właściciel albo MG otwiera stół, gdy wszyscy są gotowi.",
    talkingTitle: "Rozmowa z Mistrzem Gry",
    talkingIntro: "Przyciski nad polem wiadomości określają znaczenie wysyłanego tekstu:",
    doLabel: "Akcja",
    doText:
      "Opisz, co robi twoja postać. MG opisze rezultat i poprosi o rzut, gdy wymagają tego zasady.",
    sayLabel: "Mowa",
    sayText: "Mów jako postać. Tekst zostanie wysłany jako wypowiadany dialog w cudzysłowie.",
    oocLabel: "OOC",
    oocText:
      "Rozmowa graczy poza postaciami. MG na nią nie odpowiada; kanał pozostaje dostępny także podczas zablokowanej narracji lub skupienia na innym graczu.",
    directLabel: "Reżyseruj",
    directText:
      "Tylko lider drużyny. Wyślij MG wiążącą wskazówkę fabularną, którą ma wpleść w opowieść, albo przygotuj jedno z siedmiu zdarzeń: Walka, Miejsce, Relacje, Romans, Tajemnica, Dziwność lub Szczęśliwy traf. Włącz opcję Prywatne, aby wskazówkę zobaczył wyłącznie MG: postacie jej nie słyszą, nie trafia do transkrypcji i steruje następną turą zamiast bieżącej. Stół widzi jedynie, że coś jest przygotowane, ale nigdy co.",
    ask1:
      "Pytania nie są jednym z tych trybów. Otwórz pasek „Zapytaj MG” nad polem wiadomości i użyj osobnego pola pytania. W opcji „Temat” wybierz Auto, Fabuła, Zasady lub Moja karta, aby wskazać źródło odpowiedzi, a w „Widoczne dla” — Tylko ja lub Cały stół. Odpowiedź cytuje informacje zapisane w kampanii w sekcji „Z zapisu”.",
    ask2:
      "Pytanie niczego nie dopisuje do transkrypcji i nie przesuwa fabuły, dlatego działa podczas narracji, skupienia na innym graczu i blokady działań. Zwinięcie paska zachowuje niedokończone pytanie i miejsce w wątku.",
    ask3:
      "Czasami MG oddaje scenę jednemu graczowi i czeka na jego ruch. Gdy przez to nie możesz działać, baner wyjaśnia powód; OOC i pasek pytań nadal działają. Małe znaczniki nad polem wiadomości pokazują zadania wykonywane w tle między turami — np. skracanie historii, zamykanie rozdziału, aktualizację świata lub odpowiedź na pytanie — oraz czas ich trwania.",
    wrongTitle: "Gdy MG się pomyli",
    wrongIntro:
      "Najedź na wiadomość MG, aby zobaczyć zestaw akcji. Żadna z nich nie przesuwa fabuły ani nie zmienia liczb wyliczonych przez zasady. Ponieważ wszyscy widzą tę samą transkrypcję, przepisywaniem narracji zarządza lider drużyny:",
    rerollLabel: "Przepisz",
    reroll:
      "Tylko lider. Poproś MG o ponowne opisanie chwili z tymi samymi kośćmi i tym samym wynikiem, opcjonalnie dodając wskazówkę, co zrobić inaczej. Zmienia się wyłącznie tekst.",
    takesLabel: "Wersje",
    takes:
      "Tylko lider. Gdy istnieje druga wersja, w nagłówku wiadomości pojawiają się strzałki i licznik. Przełączanie wersji zmienia wiadomość dla całego stołu.",
    continueLabel: "Kontynuuj",
    continueText:
      "Tylko lider. Poproś MG o dalsze pisanie od miejsca, w którym odpowiedź się urwała, bez przesuwania historii osobną turą.",
    editLabel: "Edytuj",
    edit:
      "Tylko lider. Popraw tekst MG ręcznie. Mechanika pozostaje bez zmian, a wszystkie znaczniki kości w fragmencie muszą przetrwać edycję.",
    loreCheckLabel: "Sprawdź lore",
    loreCheck:
      "Dostępne dla wszystkich. Porównaj cały fragment albo wybrany tekst z zapisem kampanii i sprawdź, czy nie przeczy wcześniej ustalonym faktom.",
    failedTurn:
      "Jeśli tura MG zakończy się błędem, baner pozwoli wznowić ją od miejsca zatrzymania. Kontynuowana jest ta sama rozpoczęta tura, więc nikt nie musi ponownie wpisywać akcji, a transkrypcja nie dostaje duplikatów.",
    memoryTitle: "Co pamięta MG",
    memoryIntro:
      "Najnowsze tury MG otrzymuje słowo w słowo. Starsze są stopniowo skracane do bieżącego podsumowania, a zamknięte rozdziały stają się osobnymi streszczeniami, które MG może przeszukiwać i czytać ponownie, gdy stół wraca do dawnych wydarzeń.",
    rememberLabel: "Zapamiętaj",
    remember:
      "Każdy gracz może zaznaczyć tekst w wiadomości MG i nacisnąć ikonę zakładki albo użyć jej bez zaznaczenia, aby zachować całą wiadomość. Przypięte wspomnienia trafiają odtąd do każdego zapytania do MG. Mają limit rozmiaru; lista „Przypięte wspomnienia” w „Historia → Fakty” pokazuje, ile budżetu stół już wykorzystał.",
    canonLabel: "Przypnij jako kanon",
    canon:
      "Tylko lider drużyny, ponieważ zapisuje fakt w trwałym rejestrze kampanii. Fragment pozostaje przed MG na stałe jako ustalony fakt.",
    factsLabel: "Fakty i lore",
    facts:
      "W „Historia → Fakty” znajdują się również sekrety MG, którym nie wolno mu przeczyć, oraz wpisy lore przygotowane przez stół.",
    bondsLabel: "Relacje",
    bonds: "Na karcie „Drużyna” pokazują stosunek każdej postaci do osób, z którymi miała do czynienia.",
    memoryOutro:
      "NPC, o których drużyna przestaje mówić, są archiwizowani, aby nie wypierać aktywnych postaci. Lider drużyny może na karcie „Kontekst” zobaczyć dokładnie, co wysłano MG w ostatniej turze oraz co odrzucono z powodu limitu kontekstu.",
    panelTitle: "Panel boczny",
    partyLabel: "Drużyna",
    party:
      "Skład grupy, karty postaci, PW i stany całej drużyny, a podczas walki także aktywne starcie. Gdy relacje są włączone, pojawia się podkarta „Relacje”. Kod pokoju znajduje się na karcie lidera.",
    battleLabel: "Walka",
    battle: "Taktyczna mapa bitwy podczas starcia. W swojej turze przesuwaj znacznik postaci.",
    mapLabel: "Mapa",
    map: "Mapa sceny, mapa świata i odkryte miejsca, gdy mapy są włączone.",
    storyLabel: "Historia",
    story:
      "Trzy podkarty. „Rozdziały” pokazują dotychczasową opowieść i bieżący łuk fabularny oraz pozwalają eksportować historię. „Fakty” przechowują przypięte wspomnienia, sekrety MG i lore. „Dziennik” to audytowalny zapis każdego rzutu i każdej zmiany statystyk wykonanej przez MG.",
    notesLabel: "Notatki",
    notes: "Proponuj notatki do historii kampanii; lider drużyny zatwierdza je.",
    chatLabel: "Czat",
    chat:
      "Prywatne szepty między tobą a MG oraz boczny czat graczy, którego nie widzą ani MG, ani transkrypcja kampanii.",
    contextLabel: "Kontekst",
    context:
      "Tylko lider drużyny. Pokazuje, co faktycznie wysłano MG w ostatniej turze i co nie zmieściło się w budżecie tokenów.",
    setupLabel: "Ustawienia",
    setup: "Ustawienia kampanii, zaproszenia i przełączniki rozgrywki.",
    diceTitle: "Kości",
    dice1:
      "Każdy test, rzut obronny i atak jest rzucany przez serwer, a nie wymyślany przez AI. Przycisk kości w nagłówku włącza i wyłącza animację 3D. Jeśli w ustawieniach wybierzesz prawdziwe kości, MG poczeka na wprowadzenie fizycznego wyniku; zawsze możesz użyć cyfrowego przycisku awaryjnego i pozwolić rzucić serwerowi.",
    dice2:
      "Po włączeniu prawdziwych kości przycisk „Źródła kości” na karcie „Drużyna” pozwala wybrać źródło dla każdej kości: ręcznie wpisać wynik, pozwolić serwerowi rzucić za ciebie albo odczytać wynik z połączonej kości Bluetooth Pixels. Parowanie Pixels wymaga przeglądarki opartej na Chromium i bezpiecznego połączenia HTTPS, ponieważ wymaga tego Web Bluetooth. Gdy wszystkie kości w żądaniu obsługuje Pixels lub serwer, wynik wysyła się automatycznie po ostatnim rzucie. Ustawienia zapisują się w bieżącej przeglądarce i trzeba je ustawić ponownie po zmianie urządzenia.",
    narrationTitle: "Głos i narracja",
    narration:
      "Gdy narracja głosowa jest włączona, MG odczytuje swoje odpowiedzi. Użyj przycisku głośnika w nagłówku, aby włączyć dźwięk — przeglądarka wymaga jednego kliknięcia przed odtwarzaniem — oraz suwaka do ustawienia głośności. Najedź na wiadomość MG, aby odtworzyć narrację ponownie. Jeśli skonfigurowano push-to-talk, przytrzymaj przycisk mikrofonu i podyktuj wiadomość.",
    liveVoiceTitle: "Czat głosowy na żywo",
    liveVoice1:
      "Gdy czat głosowy jest włączony zarówno na serwerze, jak i w kampanii, w lobby pojawia się karta „Głos”, a podczas gry w górnym pasku znajduje się przycisk słuchawek z pełnym menu. Dołącz i od razu rozmawiasz ze stołem; nie potrzeba innej aplikacji, a połączenie trwa niezależnie od zmiany paneli. Mikrofon wymaga HTTPS i przy pierwszym użyciu przeglądarka poprosi o zgodę.",
    liveVoice2:
      "Osoba prowadząca może tworzyć osobne pokoje dla podzielonej drużyny lub prywatnej rozmowy i kontrolować kolejność mówienia: tryb łagodny tylko wskazuje, kto powinien mówić, ścisły wycisza pozostałych, a kolejka podniesionych rąk utrzymuje porządek. Można też włączyć reguły wiążące rozmowę ze światem gry: słyszalność zależną od odległości, zasięg szeptu i krzyku, tłumienie przez ściany oraz głuchotę powalonych postaci. Wszystko znajduje się w ustawieniach głosu i domyślnie jest wyłączone, więc bez dodatkowej konfiguracji otrzymujesz zwykłą rozmowę grupową.",
    ambienceTitle: "Atmosfera i muzyka",
    ambience1:
      "Po włączeniu dźwięków tła stół dzieli wspólną ścieżkę: warstwę otoczenia odpowiadającą miejscu drużyny, muzykę pasującą do sceny i krótkie efekty dramatycznych momentów. MG zmienia je wraz z historią, a walka ma własne brzmienie. Prowadzący może też zablokować warstwę na wybranym utworze, aby automat jej nie zmieniał. Przycisk głośnika i suwak w nagłówku sterują dźwiękiem tylko dla ciebie, a podczas narracji głośność tła automatycznie spada.",
    ambience2:
      "Dźwięki to nagrania z domeny publicznej i na licencjach Creative Commons instalowane przez administratora serwera; autorów znajdziesz na stronie licencji. Jeśli tło jest włączone, ale nic nie słychać, serwer po prostu nie ma jeszcze zainstalowanego audio.",
    humanDmTitle: "Gra z ludzkim MG",
    humanDm1:
      "Kampanii nie musi prowadzić AI. Gdy miejsce MG zajmuje człowiek, stół działa jak klasyczna sesja: MG opowiada własnymi słowami, a aplikacja pilnuje kart postaci, kości, map i zapisu. Wiadomości „Akcja” i „Mowa” nadal trafiają do transkrypcji, ale zamiast uruchamiać AI ustawiają się jako zamiary oczekujące na odpowiedź MG. MG nie zajmuje miejsca gracza, przechowuje sekrety fabuły należące przy stole AI do lidera i otrzymuje konsolę z inicjatywą, potworami, mapami, NPC, tabelami rzutów i rozstrzygnięciami; jednym kliknięciem może też poprosić asystenta AI o statbloki i sugestie.",
    humanDm2:
      "Pośredni tryb wspomagany pozwala człowiekowi zachować kontrolę nad historią, a obowiązki przekazywać AI po kawałku: AI może prowadzić tury potworów, rozwijać notatki MG w pełną narrację głosową albo przejąć stół na określoną liczbę odpowiedzi, gdy MG na chwilę odchodzi, trzymając się pozostawionego planu.",
    humanDm3:
      "Ponieważ narracja dzieje się głównie na głos, aplikacja co jakiś czas przypomina MG o zapisaniu punktu fabularnego — jednej lub dwóch linijek o tym, co właśnie się wydarzyło. Z takich punktów powstają streszczenia rozdziałów, przypomnienia i eksportowana historia. Stół, który nigdy ich nie zapisuje, zostaje z transkrypcją zamiarów bez pełnej opowieści. Gracze pomagają, wpisując działania w pole wiadomości zamiast przekazywać je wyłącznie głosem.",
    leadTitle: "Lider drużyny",
    lead1:
      "Właściciel kampanii zaczyna jako lider drużyny i może przekazać rolę z menu członka drużyny. Lider steruje stołem AI: korzysta z trybu „Reżyseruj”, gotowych zdarzeń i prywatnych wskazówek, zatwierdza sugerowane notatki, zwalnia zablokowane skupienie, ponawia zatrzymaną turę, przepisuje lub edytuje narrację, wpuszcza nowych graczy w trakcie gry oraz zmienia ustawienia kampanii i zasady domowe.",
    lead2:
      "Lider zarządza także kręgosłupem fabuły w „Historia → Rozdziały”. Pojedynczy punkt można przeredagować, pominąć lub ustawić jako aktywny bez ponownego generowania całego łuku; rozdział można zamknąć wcześniej, a kampanię cofnąć do jego początku. Cofnięcie jest destrukcyjne: najpierw prosi o potwierdzenie i pokazuje listę zmian, a następnie przywraca karty, NPC, miejsca, mapy i stan zadań do wcześniejszej wersji.",
    lead3:
      "Gdy silnik zauważy dwa imiona NPC, które mogą oznaczać tę samą osobę, ale nie chce ich połączyć na podstawie zgadywania, ostateczną decyzję podejmuje lider.",
    lead4:
      "Przy stole z ludzkim MG podział jest inny: lider zachowuje zaproszenia i ogólne dane kampanii, ale poza tym jest zwykłym graczem, ponieważ opisane wyżej uprawnienia fabularne służą do sterowania AI, którego tutaj nie ma. Sekrety, ustawienia, zasady, kontrola kolejności, poprawianie narracji i narzędzia MG należą do osoby prowadzącej.",
    pluginsTitle: "Dodatki kampanii",
    plugins1:
      "Kampania może działać w pakiecie świata: gotowym settingu z własnymi rasami, klasami, czarami, wyposażeniem, potworami, frakcjami i lore oraz instrukcją dla MG dotyczącą stylu tego świata. Wybranie pakietu podczas tworzenia ustawia także gatunek kampanii i może uzupełnić jej motyw oraz założenie.",
    plugins2:
      "Pakiet zmienia nazwy, ale nigdy zasady. Pod spodem nadal działa 5e, karta postaci przechowuje nazwy kanoniczne, a postać utworzoną w kampanii z pakietem można przenieść do zwykłej kampanii, gdzie znów będzie wyświetlana pod standardowymi nazwami.",
    plugins3:
      "Administratorzy serwera instalują i usuwają pakiety w „Administracja → Dodatki kampanii” z rejestru lub pliku. Pakiet oparty na cudzym settingu jest wszędzie oznaczony jako nieoficjalna praca fanowska i nie jest powiązany z właścicielem praw, sponsorowany ani przez niego zatwierdzony.",
    newTitle: "Pierwszy raz w D&D?",
    new1:
      "Nie musisz znać zasad, aby grać; MG i serwer zajmują się nimi za ciebie. Gdy pojawi się nieznany termin, poszukaj małego przycisku informacji: każda cecha, czar i statystyka na karcie postaci potrafi się wyjaśnić.",
    rulesReference: "kompendium zasad",
    new2:
      "zbiera podstawy prostym językiem i pozwala wyszukiwać każdy czar, atut, przedmiot i stan znany aplikacji.",
    aboutTitle: "O projekcie",
    about1:
      "Open Dungeon Master to samodzielnie hostowana, wieloosobowa platforma Dungeons & Dragons 5e prowadzona przez AI Dungeon Master. Administratorzy serwera zarządzają użytkownikami, modelami, obrazami, głosem i dodatkami kampanii w panelu Admin. Zawartość gry pochodzi z SRD 5.1 i Open5e; zobacz",
    licenses: "licencje i informacje o autorach",
  },
} as const;

// Exported for HowToPlayDialog, which is the short orientation read to this
// dialog's full reference.
export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm tracking-wide text-amber-200/90">
        <Icon className="size-4 text-amber-500/80" />
        {title}
      </h3>
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">{children}</div>
    </section>
  );
}

export function ModeRow({
  label,
  lead,
  children,
}: {
  label: string;
  lead?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          lead
            ? "mt-0.5 w-14 shrink-0 rounded-full bg-gradient-to-b from-ember-400 to-ember-600 px-2 py-0.5 text-center text-xs font-medium text-stone-950"
            : "mt-0.5 w-14 shrink-0 rounded-full bg-gradient-to-b from-amber-100 to-amber-400 px-2 py-0.5 text-center text-xs font-medium text-amber-950"
        }
      >
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <span className="text-stone-300">{label}:</span> {children}
    </li>
  );
}

// One walkthrough of the whole app: menus, side-panel tabs, composer modes,
// asking the DM, fixing narration, memory, dice, voice, lead powers and packs.
export function HelpDialog({
  open,
  onOpenChange,
  tours,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tours?: { label: string; detail: string; onStart: () => void }[];
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      icon={<CircleHelp className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      {tours && tours.length ? (
        <Section icon={Footprints} title={copy.toursTitle}>
          <p>{copy.toursText}</p>
          <div className="flex flex-wrap gap-2">
            {tours.map((tour) => (
              <button
                key={tour.label}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  tour.onStart();
                }}
                className={ui.btnSmall}
                title={tour.detail}
              >
                <Footprints className="size-4" /> {tour.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section icon={Compass} title={copy.gettingTitle}>
        <p>{copy.getting1}</p>
        <p>{copy.getting2}</p>
      </Section>

      <Section icon={DoorOpen} title={copy.lobbyTitle}>
        <p>{copy.lobby}</p>
      </Section>

      <Section icon={MessageSquareText} title={copy.talkingTitle}>
        <p>{copy.talkingIntro}</p>
        <ModeRow label={copy.doLabel}>{copy.doText}</ModeRow>
        <ModeRow label={copy.sayLabel}>{copy.sayText}</ModeRow>
        <ModeRow label={copy.oocLabel}>{copy.oocText}</ModeRow>
        <ModeRow label={copy.directLabel} lead>{copy.directText}</ModeRow>
        <p>{copy.ask1}</p>
        <p>{copy.ask2}</p>
        <p>{copy.ask3}</p>
      </Section>

      <Section icon={RefreshCw} title={copy.wrongTitle}>
        <p>{copy.wrongIntro}</p>
        <ul className="list-none space-y-1.5">
          <Item label={copy.rerollLabel}>{copy.reroll}</Item>
          <Item label={copy.takesLabel}>{copy.takes}</Item>
          <Item label={copy.continueLabel}>{copy.continueText}</Item>
          <Item label={copy.editLabel}>{copy.edit}</Item>
          <Item label={copy.loreCheckLabel}>{copy.loreCheck}</Item>
        </ul>
        <p>{copy.failedTurn}</p>
      </Section>

      <Section icon={Brain} title={copy.memoryTitle}>
        <p>{copy.memoryIntro}</p>
        <ul className="list-none space-y-1.5">
          <Item label={copy.rememberLabel}>{copy.remember}</Item>
          <Item label={copy.canonLabel}>{copy.canon}</Item>
          <Item label={copy.factsLabel}>{copy.facts}</Item>
          <Item label={copy.bondsLabel}>{copy.bonds}</Item>
        </ul>
        <p>{copy.memoryOutro}</p>
      </Section>

      <Section icon={PanelRight} title={copy.panelTitle}>
        <ul className="list-none space-y-1.5">
          <Item label={copy.partyLabel}>{copy.party}</Item>
          <Item label={copy.battleLabel}>{copy.battle}</Item>
          <Item label={copy.mapLabel}>{copy.map}</Item>
          <Item label={copy.storyLabel}>{copy.story}</Item>
          <Item label={copy.notesLabel}>{copy.notes}</Item>
          <Item label={copy.chatLabel}>{copy.chat}</Item>
          <Item label={copy.contextLabel}>{copy.context}</Item>
          <Item label={copy.setupLabel}>{copy.setup}</Item>
        </ul>
      </Section>

      <Section icon={Dices} title={copy.diceTitle}>
        <p>{copy.dice1}</p>
        <p>{copy.dice2}</p>
      </Section>

      <Section icon={Volume2} title={copy.narrationTitle}>
        <p>{copy.narration}</p>
      </Section>

      <Section icon={Mic} title={copy.liveVoiceTitle}>
        <p>{copy.liveVoice1}</p>
        <p>{copy.liveVoice2}</p>
      </Section>

      <Section icon={Music} title={copy.ambienceTitle}>
        <p>{copy.ambience1}</p>
        <p>{copy.ambience2}</p>
      </Section>

      <Section icon={Gavel} title={copy.humanDmTitle}>
        <p>{copy.humanDm1}</p>
        <p>{copy.humanDm2}</p>
        <p>{copy.humanDm3}</p>
      </Section>

      <Section icon={Crown} title={copy.leadTitle}>
        <p>{copy.lead1}</p>
        <p>{copy.lead2}</p>
        <p>{copy.lead3}</p>
        <p>{copy.lead4}</p>
      </Section>

      <Section icon={Puzzle} title={copy.pluginsTitle}>
        <p>{copy.plugins1}</p>
        <p>{copy.plugins2}</p>
        <p>{copy.plugins3}</p>
      </Section>

      <Section icon={BookOpen} title={copy.newTitle}>
        <p>{copy.new1}</p>
        <p>
          <Link href="/reference" className="text-amber-300 underline-offset-2 hover:underline">
            {copy.rulesReference}
          </Link>{" "}
          {copy.new2}
        </p>
      </Section>

      <Section icon={BookOpen} title={copy.aboutTitle}>
        <p>
          {copy.about1}{" "}
          <Link href="/licenses" className="text-amber-300 underline-offset-2 hover:underline">
            {copy.licenses}
          </Link>
          .
        </p>
      </Section>
    </Dialog>
  );
}
