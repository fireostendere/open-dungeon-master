"use client";

import Link from "next/link";
import {
  BookOpen,
  Brain,
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
import { GameIcon } from "@/components/ui/GameIcon";
import { useI18n } from "@/lib/i18n";
import { ui } from "@/lib/ui";

const COPY = {
  en: {
    title: "Help",
    toursTitle: "Guided tours",
    toursText:
      "A spotlight walk through the table's controls, one at a time. Each tour ran once when you first sat down; take it again whenever you like.",
    gettingTitle: "Getting started",
    getting: [
      "Create a campaign from the home page, or join a friend's with their invite code or a /join link. Build a character in the creation wizard, or reuse one saved to your library under Characters in the account menu. When everyone in the lobby is ready, the owner starts the adventure.",
      "If the server has campaign plugins installed, the create form also offers a pre-built world to run the campaign in. See Campaign plugins below for what that changes.",
    ],
    lobbyTitle: "The lobby",
    lobby: [
      "Before the game begins, each player readies up and whoever steers the story (the party lead, or the DM when a person runs the table) can adjust the game settings: genre, an optional secret story setup for the DM, dice policy, narration voice, and maps. Share the room code or copy the invite link to bring in more players; the owner or the DM opens the table once everyone is ready.",
    ],
    talkingTitle: "Talking to the DM",
    talkingIntro: "The buttons above the message box change what your message means:",
    doLabel: "Do",
    doText:
      "Describe what your character does or says. The DM narrates the outcome and asks for dice rolls when the rules call for them.",
    oocLabel: "OOC",
    oocText:
      "Out-of-character table talk. The DM does not respond to it, and it stays available even when the floor is locked during narration or a spotlight.",
    directLabel: "Direct",
    directText:
      "Party lead only. Send the DM an authoritative story direction it must weave into the tale, or arm one of the seven canned events: Combat, Place, Social, Romance, Mystery, Weird or Windfall. Turn on Private and the direction goes to the DM alone: no character hears it, it never enters the transcript, and it steers the next turn instead of this one. The table still sees that something is armed, just never what.",
    talking: [
      "Questions are separate from these modes. Open the Ask the DM strip above the message box and use its question box. Set About to Auto, Story, Rules or My sheet to choose where the answer comes from, and Seen by to Just me or The table to choose who reads it. Answers quote the campaign record under From the record.",
      "Asking writes nothing to the transcript and never moves the story on, so it works during narration, during someone else's spotlight, and while the floor is locked. Collapsing the strip keeps a half-typed question and your place in the thread.",
      "Sometimes the DM puts one player in the spotlight and waits for them to act. While the floor is locked for you, a banner explains why, and OOC and the Ask strip still work. Small chips above the message box name background jobs between turns, such as compacting history, sealing a chapter, running the world tick or answering an Ask, with how long they have been running.",
    ],
    wrongTitle: "When the DM gets it wrong",
    wrongIntro:
      "Hover a DM message and a row of actions appears above it. None of them advance the story or change a number produced by the rules. Rewriting narration belongs to the party lead, since everyone reads the same transcript:",
    wrongItems: [
      ["Reroll", "Lead only. Have the DM write that moment again with the same dice and outcome, optionally with a note about what to do differently. Only the prose changes."],
      ["Takes", "Lead only. Once a second version exists, arrows and a counter appear in the message header. Paging between takes swaps the message for the whole table."],
      ["Continue", "Lead only. Have the DM keep writing from where a reply stopped short, without moving the story on."],
      ["Edit", "Lead only. Fix what the DM said by hand. Mechanics are untouched and every dice marker in the passage must survive the edit."],
      ["Lore check", "Anyone. Check the passage, or selected text, against the campaign record to see whether it contradicts anything already established."],
    ],
    wrongOutro:
      "If a DM turn fails outright, a banner offers to resume it from where it stopped. It continues the turn that was already running, so nobody has to retype an action and nothing lands in the transcript twice.",
    memoryTitle: "What the DM remembers",
    memoryIntro:
      "Recent turns are in front of the DM word for word. Older ones are compacted into a rolling summary, and closed chapters become chapter summaries it can search and re-read when the table brings up something from long ago.",
    memoryItems: [
      ["Remember", "Any player can select text in a DM message and press the bookmark icon, or press it with nothing selected to keep the whole message. Pinned memories ride in every prompt from then on. There is a size budget, and the Pinned memories list under Story, Facts shows how much the table has spent."],
      ["Pin as canon", "Party lead only, because it writes to the campaign record. Keeps a passage permanently in front of the DM as established fact."],
      ["Facts and lore", "Story, Facts also holds DM secrets the DM must never contradict and lore entries written by the table."],
      ["Bonds", "Under Party, this shows where each character stands with the people they have dealt with."],
    ],
    memoryOutro:
      "NPCs the party stops mentioning are archived so they do not crowd out the ones in play, and the party lead can see exactly what the DM received on the last turn, plus anything the token budget cut, in the Context tab.",
    sideTitle: "The side panel",
    sideItems: [
      ["Party", "The roster, with character sheets, HP and conditions for the whole party, plus the active encounter during combat. A Bonds sub-tab appears when relationships are enabled. The room code is in the lead's tab."],
      ["Battle", "The tactical battle map while a mapped fight is running. Move your token on your turn."],
      ["Map", "The scene map, overworld and discovered locations when maps are enabled."],
      ["Story", "Three sub-tabs. Chapters is the tale so far and the current arc, and is where you export the story. Facts holds pinned memories, DM secrets and lore. Log is the audited record of every dice roll and every stat change the DM makes."],
      ["Notes", "Suggest campaign notes for the story; the party lead approves them."],
      ["Chat", "Private whispers between you and the DM, and side chat between players that the DM and campaign transcript never see."],
      ["Context", "Party lead only. Shows what the DM was actually sent last turn and anything the token budget dropped."],
      ["Setup", "Campaign settings, invites and game toggles."],
    ],
    diceTitle: "Dice",
    dice: [
      "Every check, save and attack is rolled by the server, never invented by the AI. The dice button in the header toggles the 3D dice animation. If you opt into real dice in game settings, the DM waits for you to enter your physical roll, with a digital fallback if you would rather let the server roll.",
      "Once opted in, Dice sources in the Party tab lets you decide per die whether to type the physical roll yourself, let the server roll it, or read it from a connected Pixels Bluetooth die. Pairing a Pixel requires a Chromium-based browser and a secure HTTPS connection because Web Bluetooth requires both. When every die is covered by a Pixel or the server, the roll submits itself as soon as the last die lands. These choices are saved in the current browser, so set them again on another device.",
    ],
    narrationTitle: "Voice and narration",
    narration: [
      "When narration is enabled, the DM reads its replies aloud. Use the speaker button in the header to unmute (browsers require one click before audio can play) and the slider to set volume. Hover a DM message to replay its narration. Push-to-talk, when configured, lets you hold the microphone button to dictate your message.",
    ],
    liveVoiceTitle: "Live voice chat",
    liveVoice: [
      "When the server and campaign both have voice chat enabled, a Voice card appears in the lobby, and during play a headphones button sits in the top bar with the full voice menu below it. Join and you are talking to the table; no other app is needed, and the call stays up whichever panel you switch to. The microphone needs a secure HTTPS connection, and your browser asks permission the first time.",
      "Whoever runs the story can open side rooms for a split party or a private word, and can hold the floor: soft enforcement marks who should be talking, strict enforcement actually mutes everyone else, and a raised-hand queue keeps order. A table can also enable world-like voice rules: proximity hearing, whisper and shout ranges, walls muffling speech, and downed characters going deaf. These options live under voice settings in Setup and are off by default, so a normal group call is what you get until the table asks for more.",
    ],
    ambienceTitle: "Ambience and music",
    ambience: [
      "With ambience enabled in game settings, the table shares a soundtrack: a background bed for the party's location, a music layer for the scene, and one-shot stings for dramatic moments. The DM changes it as the story moves, and combat has its own sound. Whoever runs the story can pin a layer to a chosen cue so the auto-picker leaves it alone. Your speaker button and volume slider control it only for you, and it ducks automatically while narration speaks.",
      "The sounds themselves are public-domain and Creative Commons recordings installed by the server admin; see the licenses page for attribution. If ambience is enabled but silent, the server simply has no audio installed yet.",
    ],
    humanTitle: "Playing with a human DM",
    human: [
      "A campaign does not have to be run by AI. With a person in the DM seat, the table works like a kitchen-table game: the DM narrates in their own words, while the app keeps sheets, dice, maps and records straight underneath. Do messages still enter the transcript, but instead of waking the AI they queue as intents for the DM. The DM occupies no party slot, owns the story secrets, and gets a console for initiative, monsters, maps, NPCs, roll tables and rulings, with an optional AI assistant for stat blocks and suggestions.",
      "Assisted mode sits in between: the human DM keeps the story while handing bookkeeping to AI piece by piece. It can run monster turns, read the DM's notes as full prose, or cover the table for a counted stretch of replies while the DM steps away, following the outline left behind.",
      "Because narration happens out loud, the app occasionally nudges the DM to write a story beat: a line or two about what just happened. Chapter summaries, recaps and exported stories are built from beats, so a table that never writes them ends up with a transcript of intents but no narrative. Players can help by keeping actions in the composer rather than only in the voice call.",
    ],
    leadTitle: "Party lead",
    lead: [
      "The campaign owner starts as party lead and can pass the role from a party member's menu. The lead steers the table: Direct messages and event presets, private directions, approving suggested notes, releasing a stuck spotlight, retrying a halted turn, rerolling or editing narration, letting players join mid-game, and editing campaign settings and house rules.",
      "The lead also owns the story spine under Story, Chapters. A beat can be reworded, skipped or promoted without regenerating the whole arc, a chapter can be sealed early, and the campaign can be rewound to the start of a chapter. Rewind is destructive: it asks for confirmation and lists what will be undone first, then restores sheets, NPCs, locations, maps and quest state.",
      "When the engine spots two NPC names that may refer to the same person but refuses to merge them on a guess, the lead decides.",
      "At a table with a human DM the split is different: the lead keeps invites and campaign details but is otherwise a player. Story secrets, settings, rules, floor control, narration fixes and DM seats belong to the person in the DM seat instead.",
    ],
    pluginsTitle: "Campaign plugins",
    plugins: [
      "A campaign can run in a world pack: a pre-built setting with its own races, classes, spells, gear, monsters, factions and lore, plus a brief telling the DM how that world should sound. Picking one at creation also sets the campaign genre and can fill in its theme and premise.",
      "A pack renames things; it never changes a rule. Everything underneath is still 5e, character sheets still store canonical names, and a character built in a pack campaign can enter a plain campaign and simply display ordinary names again.",
      "Server admins install and remove packs under Admin, Campaign plugins, from a registry or file. A pack built on somebody else's setting carries an unofficial-work notice wherever it appears: it is fan-made and not affiliated with, sponsored by or endorsed by the rights holder.",
    ],
    newTitle: "New to D&D?",
    newP1:
      "You do not need to know the rules to play; the DM and server handle them. When an unfamiliar term appears, look for the small info button next to it: every feature, spell and stat on your sheet explains itself.",
    referenceBefore: "The ",
    referenceLabel: "rules reference",
    referenceAfter:
      " collects the basics in plain language and lets you search every spell, feat, item and condition the app knows about.",
    aboutTitle: "About",
    aboutBefore:
      "Open Dungeon Master is a self-hosted multiplayer Dungeons & Dragons 5e platform run by an AI Dungeon Master. Server admins manage users, models, images, voice and campaign plugins from the Admin panel. Game content comes from the SRD 5.1 and Open5e; see ",
    licensesLabel: "licenses and attribution",
    aboutAfter: ".",
  },
  ru: {
    title: "Помощь",
    toursTitle: "Обучающие туры",
    toursText:
      "Пошаговое знакомство с элементами игрового стола. Каждый тур запускается один раз при первом посещении, но его можно повторить в любой момент.",
    gettingTitle: "С чего начать",
    getting: [
      "Создайте кампанию на главной странице или присоединитесь к кампании друга по коду приглашения либо ссылке /join. Создайте персонажа в мастере или возьмите сохранённого из раздела «Персонажи» в меню аккаунта. Когда все в лобби готовы, владелец начинает приключение.",
      "Если на сервере установлены плагины кампаний, форма создания также предложит готовый мир. Ниже, в разделе «Плагины кампаний», описано, что именно при этом меняется.",
    ],
    lobbyTitle: "Лобби",
    lobby: [
      "До начала игры каждый отмечается готовым, а тот, кто управляет историей — лидер группы или человек-Мастер — настраивает жанр, необязательную тайную завязку для Мастера, правила бросков, голос повествования и карты. Отправьте код комнаты или ссылку приглашения другим игрокам; когда все готовы, владелец или Мастер открывает игровой стол.",
    ],
    talkingTitle: "Общение с Мастером",
    talkingIntro: "Кнопки над полем сообщения определяют смысл вашего сообщения:",
    doLabel: "Действие",
    doText:
      "Опишите, что делает или говорит персонаж. Мастер расскажет результат и попросит бросок, когда этого требуют правила.",
    oocLabel: "OOC",
    oocText:
      "Внеигровое обсуждение. Мастер на него не отвечает; OOC остаётся доступным даже во время повествования или сцены с фокусом на другом игроке.",
    directLabel: "Указание",
    directText:
      "Только для лидера группы. Отправьте Мастеру обязательное направление сюжета или подготовьте одно из семи событий: бой, место, социальную сцену, романтику, тайну, странность или удачу. В приватном режиме указание видит только Мастер: персонажи его не слышат, оно не попадает в стенограмму и влияет на следующий ход. Стол видит лишь сам факт подготовленного события, но не его содержимое.",
    talking: [
      "Вопросы задаются отдельно от этих режимов. Откройте панель «Спросить Мастера» над полем сообщения. В поле «О чём» выберите «Авто», «Сюжет», «Правила» или «Мой лист», чтобы указать источник ответа, а в «Кому видно» — «Только мне» или «Всему столу». Ответы ссылаются на сохранённые сведения кампании в блоке «Из записей».",
      "Вопрос ничего не пишет в стенограмму и не продвигает сюжет, поэтому его можно задавать во время повествования, чужой сцены или блокировки хода. Сворачивание панели сохраняет недописанный вопрос и позицию в переписке.",
      "Иногда Мастер выделяет одного игрока и ждёт его действия. Если ваш ход из-за этого заблокирован, баннер объяснит причину, а OOC и вопросы останутся доступны. Небольшие метки над полем сообщения показывают фоновые задачи движка между ходами: сжатие истории, закрытие главы, шаг мира, ответ на вопрос и время их выполнения.",
    ],
    wrongTitle: "Если Мастер ошибся",
    wrongIntro:
      "Наведите курсор на сообщение Мастера — над ним появится ряд действий. Они не продвигают сюжет и не меняют числа, рассчитанные правилами. Поскольку стенограмма общая, переписывать повествование может лидер группы:",
    wrongItems: [
      ["Перегенерировать", "Только лидер. Мастер переписывает этот момент с теми же костями и тем же исходом; можно добавить подсказку, что изменить. Меняется только текст."],
      ["Варианты", "Только лидер. После появления второй версии в заголовке сообщения появляются стрелки и счётчик. Переключение варианта меняет сообщение для всего стола."],
      ["Продолжить", "Только лидер. Мастер продолжает с места, где ответ оборвался, не продвигая игровой ход."],
      ["Редактировать", "Только лидер. Исправьте текст Мастера вручную. Механика не меняется, а все маркеры бросков должны сохраниться."],
      ["Проверить лор", "Доступно всем. Сверьте весь фрагмент или выделенный текст с записями кампании и проверьте, не противоречит ли он установленным фактам."],
    ],
    wrongOutro:
      "Если ход Мастера полностью сорвался, баннер предложит продолжить с места остановки. Возобновляется уже начатый ход, поэтому никому не нужно повторять действие и в стенограмме не появятся дубликаты.",
    memoryTitle: "Что помнит Мастер",
    memoryIntro:
      "Последние ходы Мастер видит дословно. Более старые сворачиваются в обновляемое резюме, а закрытые главы становятся отдельными сводками, которые можно найти и перечитать, когда стол возвращается к давним событиям.",
    memoryItems: [
      ["Запомнить", "Любой игрок может выделить текст в сообщении Мастера и нажать закладку либо сохранить сообщение целиком без выделения. Закреплённые воспоминания затем попадают в каждый запрос. Их объём ограничен; расход бюджета виден в списке закреплённых воспоминаний в «История → Факты»."],
      ["Закрепить как канон", "Только лидер, поскольку действие записывает факт в кампанию. Фрагмент постоянно остаётся перед Мастером как установленный факт."],
      ["Факты и лор", "В «История → Факты» также хранятся тайны Мастера, которым он не должен противоречить, и записи лора, созданные игроками."],
      ["Связи", "На вкладке «Группа» показывают отношения каждого персонажа с встреченными людьми."],
    ],
    memoryOutro:
      "NPC, которых группа давно не упоминает, архивируются и не вытесняют активных персонажей. Лидер группы может на вкладке «Контекст» увидеть, что именно было отправлено Мастеру на прошлом ходу и что не поместилось в бюджет токенов.",
    sideTitle: "Боковая панель",
    sideItems: [
      ["Группа", "Состав группы, листы персонажей, HP и состояния, а во время боя — текущее столкновение. При включённых отношениях появляется подвкладка «Связи». Код комнаты находится во вкладке лидера."],
      ["Бой", "Тактическая карта боя, когда столкновение проходит на карте. В свой ход перемещайте свой жетон."],
      ["Карта", "Карта сцены, глобальная карта и открытые места, если карты включены."],
      ["История", "Три подвкладки. «Главы» показывают пройденную историю и текущую арку и позволяют экспортировать рассказ. «Факты» хранят закреплённые воспоминания, тайны Мастера и лор. «Журнал» — проверяемая запись всех бросков и изменений характеристик."],
      ["Заметки", "Предлагайте сюжетные заметки для кампании; лидер группы утверждает их."],
      ["Чат", "Приватный шёпот между вами и Мастером, а также отдельный чат игроков, которого не видит ни Мастер, ни стенограмма кампании."],
      ["Контекст", "Только лидер. Показывает, что реально было отправлено Мастеру на прошлом ходу и что было отброшено из-за бюджета токенов."],
      ["Настройка", "Настройки кампании, приглашения и игровые переключатели."],
    ],
    diceTitle: "Кости",
    dice: [
      "Все проверки, спасброски и атаки бросает сервер — ИИ не придумывает результаты. Кнопка костей в заголовке включает и выключает 3D-анимацию. Если в настройках включены реальные кости, Мастер ждёт ввода физического результата; при желании можно воспользоваться цифровым запасным броском сервера.",
      "После включения реальных костей кнопка «Источники костей» на вкладке «Группа» позволяет отдельно для каждого кубика выбрать источник: ввести физический результат вручную, поручить бросок серверу или считать его с подключённого Bluetooth-кубика Pixels. Для сопряжения Pixels нужен браузер на Chromium и защищённое HTTPS-соединение из-за требований Web Bluetooth. Когда все кости закрыты Pixels или сервером, результат отправится автоматически после падения последней кости. Выбор хранится в текущем браузере и на другом устройстве его нужно настроить заново.",
    ],
    narrationTitle: "Голос и озвучка",
    narration: [
      "Если озвучка включена, Мастер читает ответы вслух. Кнопка динамика в заголовке снимает заглушение — браузеру нужен хотя бы один пользовательский клик перед воспроизведением — а ползунок задаёт громкость. Наведите курсор на сообщение Мастера, чтобы повторить озвучку. В режиме push-to-talk можно удерживать кнопку микрофона и диктовать сообщение.",
    ],
    liveVoiceTitle: "Голосовой чат",
    liveVoice: [
      "Если голосовой чат включён и на сервере, и в кампании, в лобби появляется карточка «Голос», а во время игры — кнопка наушников в верхней панели с полным голосовым меню. Подключитесь — и говорите со всем столом без сторонних приложений; звонок не прерывается при переключении панелей. Микрофону нужно защищённое HTTPS-соединение, а при первом использовании браузер попросит разрешение.",
      "Ведущий историю может создавать отдельные голосовые комнаты для разделившейся группы или приватного разговора и управлять очередностью речи. Мягкий режим лишь отмечает, кому следует говорить; строгий реально заглушает остальных; очередь поднятых рук поддерживает порядок. При желании голос можно связать с миром: слышимостью по расстоянию, диапазонами шёпота и крика, приглушением через стены и глухотой персонажей без сознания. Всё это находится в голосовых настройках раздела «Настройка» и по умолчанию выключено, поэтому обычный групповой звонок работает без дополнительных правил.",
    ],
    ambienceTitle: "Атмосфера и музыка",
    ambience: [
      "При включённой атмосфере весь стол слышит общий саундтрек: фон локации, музыкальный слой сцены и разовые акценты для драматичных моментов. Мастер меняет их вместе с сюжетом, а у боя есть собственное звучание. Ведущий может закрепить слой на выбранном треке, чтобы автоматический подбор его не менял. Кнопка динамика и ползунок громкости управляют звуком только для вас; во время голосового повествования фон автоматически приглушается.",
      "Сами звуки — записи из общественного достояния и Creative Commons, которые устанавливает администратор сервера; авторство указано на странице лицензий. Если атмосфера включена, но ничего не слышно, значит на сервере пока не установлены аудиофайлы.",
    ],
    humanTitle: "Игра с человеком-Мастером",
    human: [
      "Кампанию не обязательно должен вести ИИ. Если место Мастера занимает человек, стол работает как обычная настольная сессия: Мастер говорит своими словами, а приложение ведёт листы, кости, карты и журнал. Сообщения «Действие» всё так же попадают в стенограмму, но вместо запуска ИИ становятся намерениями, на которые отвечает человек-Мастер. Мастер не занимает слот группы, владеет сюжетными тайнами и получает консоль инициативы, монстров, карт, NPC, таблиц бросков и решений, а при желании — ИИ-помощника для статблоков и идей.",
      "Промежуточный вариант — режим с помощником: человек сохраняет контроль над историей, но по частям передаёт ИИ рутину. ИИ может проводить ходы монстров, превращать заметки Мастера в полноценное повествование или на ограниченное число ответов подменить Мастера, пока тот отошёл, следуя оставленному плану.",
      "Поскольку основное повествование звучит голосом, приложение время от времени предлагает Мастеру записать «сюжетный такт» — одну-две строки о произошедшем. Из них строятся сводки глав, пересказы и экспорт истории. Если такты никогда не записывать, останется стенограмма намерений без связного рассказа. Игроки помогают, если отправляют действия через поле ввода, а не только произносят их в звонке.",
    ],
    leadTitle: "Лидер группы",
    lead: [
      "Владелец кампании изначально становится лидером и может передать роль через меню участника. Лидер направляет стол: использует режим «Указание» и пресеты событий, отправляет приватные направления, утверждает предложенные заметки, снимает зависший фокус сцены, повторяет оборвавшийся ход, перегенерирует или редактирует повествование, разрешает подключение новых игроков по ходу игры и меняет настройки кампании и домашние правила.",
      "Лидер также управляет каркасом сюжета в «История → Главы». Отдельный такт можно переформулировать, пропустить или сделать активным без пересоздания всей арки; главу можно завершить досрочно; кампанию можно откатить к началу главы. Откат разрушителен: сначала он запрашивает подтверждение и показывает список отменяемых изменений, затем возвращает листы, NPC, локации, карты и состояние квестов к прежнему состоянию.",
      "Если движок замечает два имени NPC, которые, возможно, относятся к одному человеку, но не решается объединять их автоматически, окончательное решение принимает лидер.",
      "За столом с человеком-Мастером разделение другое: лидер сохраняет приглашения и общие сведения кампании, но в остальном остаётся игроком. Сюжетные тайны, настройки, правила, управление очередью, исправления повествования и места Мастера принадлежат человеку, который ведёт игру.",
    ],
    pluginsTitle: "Плагины кампаний",
    plugins: [
      "Кампания может работать в «пакете мира» — готовом сеттинге со своими расами, классами, заклинаниями, снаряжением, монстрами, фракциями и лором, а также инструкцией для Мастера о тоне этого мира. Выбор пакета при создании задаёт жанр и может заполнить тему и завязку кампании.",
      "Пакет меняет названия и оформление, но не правила. Под капотом всё остаётся 5e, в листе хранятся канонические названия, а персонажа из кампании с пакетом можно перенести в обычную — там сущности снова будут показаны под стандартными именами.",
      "Администраторы устанавливают и удаляют пакеты в «Администрирование → Плагины кампаний» из реестра или файла. Пакет, основанный на чужом сеттинге, везде помечается как неофициальная фанатская работа, не связанная с правообладателем и не одобренная им.",
    ],
    newTitle: "Впервые в D&D?",
    newP1:
      "Знать правила заранее не обязательно — Мастер и сервер применяют их сами. Если встретился незнакомый термин, ищите рядом маленькую кнопку информации: особенности, заклинания и характеристики в листе персонажа имеют пояснения.",
    referenceBefore: "В ",
    referenceLabel: "справочнике правил",
    referenceAfter:
      " основные механики объяснены простым языком; там же можно найти любое известное приложению заклинание, черту, предмет или состояние.",
    aboutTitle: "О проекте",
    aboutBefore:
      "Open Dungeon Master — самостоятельно размещаемая многопользовательская платформа Dungeons & Dragons 5e с ИИ-Мастером. Администратор сервера управляет пользователями, моделями, изображениями, голосом и плагинами кампаний через панель администратора. Игровой контент основан на SRD 5.1 и Open5e; см. ",
    licensesLabel: "лицензии и указание авторства",
    aboutAfter: ".",
  },
} as const;

// Exported for HowToPlayDialog, which is the short orientation read to this
// dialog's full reference. Both used to carry byte-identical private copies,
// so a styling change had to be made twice or the two drifted apart.
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

function Paragraphs({ items }: { items: readonly string[] }) {
  return items.map((item) => <p key={item}>{item}</p>);
}

function LabeledList({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <ul className="list-none space-y-1.5">
      {items.map(([label, text]) => (
        <li key={label}>
          <span className="text-stone-300">{label}:</span> {text}
        </li>
      ))}
    </ul>
  );
}

// One walkthrough of the whole app: menus, side-panel tabs, composer modes,
// asking the DM, fixing a bad narration, what the DM remembers, dice, voice,
// lead powers and world packs. Opened from the home account menu and the
// in-session header.
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
      icon={<GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-7" />}
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
        <Paragraphs items={copy.getting} />
      </Section>

      <Section icon={DoorOpen} title={copy.lobbyTitle}>
        <Paragraphs items={copy.lobby} />
      </Section>

      <Section icon={MessageSquareText} title={copy.talkingTitle}>
        <p>{copy.talkingIntro}</p>
        <ModeRow label={copy.doLabel}>{copy.doText}</ModeRow>
        <ModeRow label={copy.oocLabel}>{copy.oocText}</ModeRow>
        <ModeRow label={copy.directLabel} lead>
          {copy.directText}
        </ModeRow>
        <Paragraphs items={copy.talking} />
      </Section>

      <Section icon={RefreshCw} title={copy.wrongTitle}>
        <p>{copy.wrongIntro}</p>
        <LabeledList items={copy.wrongItems} />
        <p>{copy.wrongOutro}</p>
      </Section>

      <Section icon={Brain} title={copy.memoryTitle}>
        <p>{copy.memoryIntro}</p>
        <LabeledList items={copy.memoryItems} />
        <p>{copy.memoryOutro}</p>
      </Section>

      <Section icon={PanelRight} title={copy.sideTitle}>
        <LabeledList items={copy.sideItems} />
      </Section>

      <Section icon={Dices} title={copy.diceTitle}>
        <Paragraphs items={copy.dice} />
      </Section>

      <Section icon={Volume2} title={copy.narrationTitle}>
        <Paragraphs items={copy.narration} />
      </Section>

      <Section icon={Mic} title={copy.liveVoiceTitle}>
        <Paragraphs items={copy.liveVoice} />
      </Section>

      <Section icon={Music} title={copy.ambienceTitle}>
        <Paragraphs items={copy.ambience} />
      </Section>

      <Section icon={Gavel} title={copy.humanTitle}>
        <Paragraphs items={copy.human} />
      </Section>

      <Section icon={Crown} title={copy.leadTitle}>
        <Paragraphs items={copy.lead} />
      </Section>

      <Section icon={Puzzle} title={copy.pluginsTitle}>
        <Paragraphs items={copy.plugins} />
      </Section>

      <Section icon={BookOpen} title={copy.newTitle}>
        <p>{copy.newP1}</p>
        <p>
          {copy.referenceBefore}
          <Link href="/reference" className="text-amber-300 underline-offset-2 hover:underline">
            {copy.referenceLabel}
          </Link>
          {copy.referenceAfter}
        </p>
      </Section>

      <Section icon={BookOpen} title={copy.aboutTitle}>
        <p>
          {copy.aboutBefore}
          <Link href="/licenses" className="text-amber-300 underline-offset-2 hover:underline">
            {copy.licensesLabel}
          </Link>
          {copy.aboutAfter}
        </p>
      </Section>
    </Dialog>
  );
}
