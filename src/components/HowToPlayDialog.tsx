"use client";

import {
  CircleHelp,
  Compass,
  Dices,
  Hourglass,
  MessageSquareText,
  RefreshCw,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { ModeRow, Section } from "@/components/HelpDialog";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    title: "How to play",
    whatTitle: "What this is",
    whatP1:
      "Open Dungeon Master is a Dungeons & Dragons 5e table where an AI sits in the Dungeon Master's chair, or a friend does with the AI as their assistant. You and your friends play the adventurers. The app is the rulebook and the dice.",
    whatP2:
      "Every table runs on the 5e rules. Where it is set is up to you: a genre of your choosing, or one of the pre-built worlds your server has installed.",
    gettingTitle: "Getting started",
    newCampaign: "New campaign",
    gettingP1a: " creates the world: pick a genre, difficulty and starting level, and optionally give the DM a secret story setup only it will know. If the server has campaign plugins installed, you can pick a pre-built world here instead of a bare genre, which brings its own races, classes, monsters and lore without changing a rule. You get an eight-letter invite code to share with your friends.",
    soloAdventure: "Solo adventure",
    gettingP2a: " is the same thing for one player. To join someone else's table, paste their code into \"Join with a room code\" or open the invite link they send you.",
    gettingP3:
      "Then build a character in the creation wizard, or reuse one saved under Characters in the account menu. Everyone readies up in the lobby, and the campaign owner starts the adventure.",
    runTitle: "How the game is run",
    runP1:
      "The app does all the calculation and gives the result to the DM, who weaves it into the story. Attack rolls, damage, saving throws, death saves, conditions, spell slots, rests, XP and level-ups are all resolved by the server against the 5e rules and written straight to your character sheet.",
    runP2:
      "The DM narrates what those results mean. It cannot invent a roll or quietly hand you a bonus, so play the story rather than arguing the numbers. Every roll and stat change is recorded in the Log, under the Story tab, if you want to check the maths.",
    turnTitle: "Taking your turn",
    turnIntro: "The buttons above the message box change what your message means:",
    doLabel: "Do",
    doText:
      "Describe what your character does. The DM narrates the outcome and asks for a roll when the rules call for one.",
    sayLabel: "Say",
    sayText: "Speak in character. Your text is sent as spoken dialogue.",
    oocLabel: "OOC",
    oocText: "Out-of-character table talk. The DM does not read it or respond to it.",
    askDm: "Ask the DM",
    turnP2a: "To ask the DM a question about the story, the world, the rules, or your sheet, open the ",
    turnP2b:
      " strip just above the message box. The answer quotes what the campaign has on record, and you choose whether it is just for you or for the whole table. Asking never moves the story on, so it works even while the floor is locked.",
    oneTurnTitle: "One turn at a time",
    oneTurnP1:
      "When the DM starts thinking, it reads everything sent up to that moment and writes one reply for the whole table. Anything you send while it is still thinking will not change that reply. It is picked up on the next turn, together with whatever everyone else sent.",
    oneTurnP2a: "So if you are playing with others, ",
    oneTurnEmphasis: "talk your options over before someone sends, then send one clear action each",
    oneTurnP2b:
      ". Piling on more messages mid-narration does not speed the DM up or steer the reply already in progress.",
    oneTurnP3:
      "OOC is the safe channel for that discussion: it never wakes the DM, and it still works while the floor is locked during narration. Sometimes the DM puts one player in the spotlight and waits for them, and a banner will tell you when that is why you cannot act.",
    badReplyTitle: "If a reply lands badly",
    badReplyP1a:
      "Nothing the DM writes is final. Hovering one of its messages shows a row of actions. The party lead can have it ",
    reroll: "reroll",
    badReplyP1b:
      " that moment, with the same dice and the same outcome and only the wording changed, then page between the takes and leave the best one up for the table. The lead can also have it ",
    continue: "continue",
    badReplyP1c: " a reply that stopped short, or edit the wording by hand.",
    badReplyP2:
      "Two of those actions are open to everyone. Anyone can check a passage against what the campaign has already established, and anyone can select a line and press the bookmark to keep that detail in front of the DM for the rest of the campaign.",
    stuckTitle: "If you get stuck",
    stuckP1:
      "The Help entry, in the account menu here and in the header during a session, walks through every button and panel: the side panel tabs, the Ask strip, the per-message actions, dice options, narration voice, notes, whispers, world packs and the party lead's powers. If a spotlight leaves the table stuck, the party lead can release it.",
  },
  ru: {
    title: "Как играть",
    whatTitle: "Что это такое",
    whatP1:
      "Open Dungeon Master — это стол для Dungeons & Dragons 5e, где место Мастера подземелий занимает ИИ, либо ваш друг ведёт игру с ИИ-помощником. Вы и ваши друзья играете искателями приключений. Приложение берёт на себя правила и броски костей.",
    whatP2:
      "Все игры используют правила 5e. А сеттинг выбираете вы: собственный жанр или один из готовых миров, установленных на сервере.",
    gettingTitle: "С чего начать",
    newCampaign: "Новая кампания",
    gettingP1a: " создаёт мир: выберите жанр, сложность и начальный уровень, а при желании задайте тайную завязку сюжета, известную только Мастеру. Если на сервере установлены плагины кампаний, вместо свободного жанра можно выбрать готовый мир со своими расами, классами, монстрами и лором — сами правила при этом не меняются. Вы получите восьмисимвольный код приглашения, которым можно поделиться с друзьями.",
    soloAdventure: "Одиночное приключение",
    gettingP2a: " — то же самое, но для одного игрока. Чтобы присоединиться к чужому столу, вставьте код в поле «Присоединиться по коду комнаты» или откройте присланную ссылку-приглашение.",
    gettingP3:
      "Затем создайте персонажа в мастере создания или используйте сохранённого из раздела «Персонажи» в меню аккаунта. В лобби все отмечаются готовыми, после чего владелец кампании начинает приключение.",
    runTitle: "Как проходит игра",
    runP1:
      "Приложение выполняет все расчёты и передаёт результат Мастеру, который вплетает его в историю. Броски атаки, урон, спасброски, спасброски от смерти, состояния, ячейки заклинаний, отдыхи, опыт и повышение уровня сервер рассчитывает по правилам 5e и сразу записывает в лист персонажа.",
    runP2:
      "Мастер описывает, что означают эти результаты в истории. Он не может придумать бросок или незаметно выдать бонус, поэтому играйте в сюжет, а не спорьте с числами. Каждый бросок и изменение характеристик записываются в журнал на вкладке «История», где при желании можно проверить расчёты.",
    turnTitle: "Ваш ход",
    turnIntro: "Кнопки над полем сообщения определяют, что означает ваше сообщение:",
    doLabel: "Действие",
    doText:
      "Опишите, что делает персонаж. Мастер расскажет о результате и попросит бросок, когда этого требуют правила.",
    sayLabel: "Речь",
    sayText: "Говорите от лица персонажа. Текст отправляется как произнесённая реплика.",
    oocLabel: "OOC",
    oocText: "Внеигровое обсуждение за столом. Мастер его не читает и не отвечает на него.",
    askDm: "Спросить Мастера",
    turnP2a: "Чтобы задать Мастеру вопрос о сюжете, мире, правилах или своём листе, откройте панель «",
    turnP2b:
      "» прямо над полем сообщения. Ответ опирается на сведения, сохранённые в кампании, а вы выбираете, увидите его только вы или весь стол. Вопрос не продвигает сюжет, поэтому работает даже при заблокированном ходе.",
    oneTurnTitle: "По одному ходу",
    oneTurnP1:
      "Когда Мастер начинает обдумывать ответ, он читает всё, что было отправлено к этому моменту, и пишет одну реплику для всего стола. Сообщения, отправленные во время генерации, уже не изменят этот ответ: они попадут в следующий ход вместе с сообщениями остальных игроков.",
    oneTurnP2a: "Поэтому в группе ",
    oneTurnEmphasis: "сначала обсудите варианты, а затем отправьте по одному ясному действию от каждого",
    oneTurnP2b:
      ". Дополнительные сообщения во время повествования не ускорят Мастера и не изменят уже готовящийся ответ.",
    oneTurnP3:
      "Для такого обсуждения безопаснее использовать OOC: он не запускает ответ Мастера и доступен даже тогда, когда ход заблокирован во время повествования. Иногда Мастер передаёт сцену одному игроку и ждёт его действия — баннер сообщит, если именно поэтому вы пока не можете действовать.",
    badReplyTitle: "Если ответ Мастера не подошёл",
    badReplyP1a:
      "Ни один текст Мастера не является необратимым. Наведите курсор на его сообщение — появится ряд действий. Лидер группы может попросить ",
    reroll: "перегенерировать",
    badReplyP1b:
      " этот момент с теми же костями и тем же исходом, изменив только формулировку, затем переключаться между вариантами и оставить лучший для всего стола. Лидер также может попросить ",
    continue: "продолжить",
    badReplyP1c: " оборвавшийся ответ или отредактировать текст вручную.",
    badReplyP2:
      "Два действия доступны всем. Любой игрок может сверить фрагмент с уже установленными фактами кампании, а также выделить строку и нажать закладку, чтобы эта деталь оставалась перед Мастером до конца кампании.",
    stuckTitle: "Если вы запутались",
    stuckP1:
      "Раздел «Помощь» в меню аккаунта и в заголовке игровой сессии объясняет каждую кнопку и панель: вкладки боковой панели, вопросы Мастеру, действия над сообщениями, настройки костей, голос повествования, заметки, шёпот, наборы миров и возможности лидера группы. Если сцена с фокусом на одном персонаже остановила игру, лидер группы может снять этот фокус.",
  },
  pl: {
    title: "Jak grać",
    whatTitle: "Czym jest ta aplikacja",
    whatP1:
      "Open Dungeon Master to stół do Dungeons & Dragons 5e, przy którym rolę Mistrza Gry pełni AI albo znajomy prowadzący sesję z AI jako asystentem. Ty i twoi znajomi gracie poszukiwaczami przygód. Aplikacja zajmuje się zasadami i kośćmi.",
    whatP2:
      "Każda sesja korzysta z zasad 5e. Miejsce akcji wybieracie sami: może to być wybrany przez was gatunek albo jeden z gotowych światów zainstalowanych na serwerze.",
    gettingTitle: "Pierwsze kroki",
    newCampaign: "Nowa kampania",
    gettingP1a: " tworzy świat: wybierz gatunek, poziom trudności i poziom początkowy, a opcjonalnie podaj Mistrzowi Gry tajny zarys fabuły, który będzie znał tylko on. Jeśli serwer ma zainstalowane wtyczki kampanii, zamiast samego gatunku możesz wybrać gotowy świat z własnymi rasami, klasami, potworami i lore — bez zmiany zasad. Otrzymasz ośmioznakowy kod zaproszenia do udostępnienia znajomym.",
    soloAdventure: "Przygoda solo",
    gettingP2a: " działa tak samo, ale dla jednego gracza. Aby dołączyć do czyjegoś stołu, wklej kod w polu „Dołącz za pomocą kodu pokoju” albo otwórz przesłany link z zaproszeniem.",
    gettingP3:
      "Następnie utwórz postać w kreatorze albo użyj ponownie postaci zapisanej w sekcji „Postacie” w menu konta. W lobby wszyscy oznaczają gotowość, a właściciel kampanii rozpoczyna przygodę.",
    runTitle: "Jak prowadzona jest gra",
    runP1:
      "Aplikacja wykonuje wszystkie obliczenia i przekazuje wynik Mistrzowi Gry, który wplata go w opowieść. Rzuty ataku, obrażenia, rzuty obronne, rzuty przeciw śmierci, stany, komórki czarów, odpoczynki, PD i awanse są rozstrzygane przez serwer zgodnie z zasadami 5e i od razu zapisywane na karcie postaci.",
    runP2:
      "Mistrz Gry opisuje, co te wyniki oznaczają w fabule. Nie może wymyślić rzutu ani po cichu przyznać bonusu, więc skupcie się na historii zamiast spierać się o liczby. Każdy rzut i każda zmiana statystyk trafiają do Dziennika na karcie „Historia”, gdzie można sprawdzić obliczenia.",
    turnTitle: "Rozgrywanie swojej tury",
    turnIntro: "Przyciski nad polem wiadomości określają znaczenie wysyłanego tekstu:",
    doLabel: "Akcja",
    doText:
      "Opisz, co robi twoja postać. Mistrz Gry opisze rezultat i poprosi o rzut, gdy wymagają tego zasady.",
    sayLabel: "Mowa",
    sayText: "Mów jako postać. Tekst zostanie wysłany jako wypowiedziana kwestia.",
    oocLabel: "OOC",
    oocText: "Rozmowa poza postacią przy stole. Mistrz Gry jej nie czyta ani na nią nie odpowiada.",
    askDm: "Zapytaj Mistrza Gry",
    turnP2a: "Aby zapytać Mistrza Gry o fabułę, świat, zasady lub swoją kartę postaci, otwórz pasek „",
    turnP2b:
      "” tuż nad polem wiadomości. Odpowiedź odwołuje się do informacji zapisanych w kampanii, a ty wybierasz, czy zobaczysz ją tylko ty, czy cały stół. Pytanie nigdy nie przesuwa fabuły do przodu, więc działa nawet wtedy, gdy możliwość działania jest zablokowana.",
    oneTurnTitle: "Jedna tura naraz",
    oneTurnP1:
      "Gdy Mistrz Gry zaczyna przygotowywać odpowiedź, czyta wszystko wysłane do tego momentu i tworzy jedną odpowiedź dla całego stołu. Wiadomości wysłane w trakcie generowania nie zmienią już tej odpowiedzi — zostaną uwzględnione w następnej turze razem z wiadomościami pozostałych graczy.",
    oneTurnP2a: "Dlatego podczas gry w grupie ",
    oneTurnEmphasis: "najpierw omówcie możliwości, a potem niech każdy wyśle jedno jasne działanie",
    oneTurnP2b:
      ". Dosyłanie kolejnych wiadomości w trakcie narracji nie przyspieszy Mistrza Gry ani nie wpłynie na odpowiedź, która już powstaje.",
    oneTurnP3:
      "OOC jest bezpiecznym kanałem do takiej rozmowy: nie uruchamia odpowiedzi Mistrza Gry i działa również wtedy, gdy podczas narracji możliwość działania jest zablokowana. Czasem Mistrz Gry skupia scenę na jednym graczu i czeka na jego ruch — baner wyjaśni, jeśli właśnie dlatego nie możesz teraz działać.",
    badReplyTitle: "Gdy odpowiedź nie pasuje",
    badReplyP1a:
      "Nic, co napisze Mistrz Gry, nie jest nieodwracalne. Po najechaniu na jego wiadomość pojawia się rząd działań. Lider drużyny może poprosić o ",
    reroll: "ponowne wygenerowanie",
    badReplyP1b:
      " tego momentu z tymi samymi kośćmi i tym samym wynikiem, zmieniając wyłącznie sposób opisu, a następnie przełączać się między wersjami i zostawić najlepszą dla całego stołu. Lider może też polecić ",
    continue: "kontynuowanie",
    badReplyP1c: " urwanej odpowiedzi albo ręcznie poprawić jej treść.",
    badReplyP2:
      "Dwie z tych czynności są dostępne dla wszystkich. Każdy może sprawdzić fragment względem faktów już ustalonych w kampanii, a także zaznaczyć zdanie i nacisnąć zakładkę, aby Mistrz Gry pamiętał ten szczegół przez resztę kampanii.",
    stuckTitle: "Gdy nie wiesz, co zrobić",
    stuckP1:
      "Pozycja „Pomoc” w menu konta oraz w nagłówku podczas sesji objaśnia każdy przycisk i panel: karty panelu bocznego, pasek pytań do Mistrza Gry, działania na wiadomościach, opcje kości, głos narracji, notatki, szepty, pakiety światów i uprawnienia lidera drużyny. Jeśli skupienie sceny na jednej postaci zatrzymało grę, lider drużyny może je zwolnić.",
  },
} as const;

// Onboarding read for newcomers: what the app is, how to get a table running,
// who does the maths, and the table etiquette that follows from coalesced DM
// turns. HelpDialog stays the button-by-button reference.
export function HowToPlayDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      icon={<ScrollText className="size-5 text-amber-500/80" />}
      width="w-[min(94vw,44rem)]"
    >
      <Section icon={Sparkles} title={copy.whatTitle}>
        <p>{copy.whatP1}</p>
        <p>{copy.whatP2}</p>
      </Section>

      <Section icon={Compass} title={copy.gettingTitle}>
        <p>
          <span className="text-stone-300">{copy.newCampaign}</span>
          {copy.gettingP1a}
        </p>
        <p>
          <span className="text-stone-300">{copy.soloAdventure}</span>
          {copy.gettingP2a}
        </p>
        <p>{copy.gettingP3}</p>
      </Section>

      <Section icon={Dices} title={copy.runTitle}>
        <p>{copy.runP1}</p>
        <p>{copy.runP2}</p>
      </Section>

      <Section icon={MessageSquareText} title={copy.turnTitle}>
        <p>{copy.turnIntro}</p>
        <ModeRow label={copy.doLabel}>{copy.doText}</ModeRow>
        <ModeRow label={copy.sayLabel}>{copy.sayText}</ModeRow>
        <ModeRow label={copy.oocLabel}>{copy.oocText}</ModeRow>
        <p>
          {copy.turnP2a}
          <span className="text-stone-300">{copy.askDm}</span>
          {copy.turnP2b}
        </p>
      </Section>

      <Section icon={Hourglass} title={copy.oneTurnTitle}>
        <p>{copy.oneTurnP1}</p>
        <p>
          {copy.oneTurnP2a}
          <span className="text-stone-300">{copy.oneTurnEmphasis}</span>
          {copy.oneTurnP2b}
        </p>
        <p>{copy.oneTurnP3}</p>
      </Section>

      <Section icon={RefreshCw} title={copy.badReplyTitle}>
        <p>
          {copy.badReplyP1a}
          <span className="text-stone-300">{copy.reroll}</span>
          {copy.badReplyP1b}
          <span className="text-stone-300">{copy.continue}</span>
          {copy.badReplyP1c}
        </p>
        <p>{copy.badReplyP2}</p>
      </Section>

      <Section icon={CircleHelp} title={copy.stuckTitle}>
        <p>{copy.stuckP1}</p>
      </Section>
    </Dialog>
  );
}
