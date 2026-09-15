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
    what1:
      "Open Dungeon Master is a Dungeons & Dragons 5e table where an AI sits in the Dungeon Master's chair, or a friend does with the AI as their assistant. You and your friends play the adventurers. The app is the rulebook and the dice.",
    what2:
      "Every table runs on the 5e rules. Where it is set is up to you: a genre of your choosing, or one of the pre-built worlds your server has installed.",
    gettingTitle: "Getting started",
    getting1:
      "New campaign creates the world: pick a genre, difficulty and starting level, and optionally give the DM a secret story setup only it will know. If the server has campaign plugins installed, you can pick a pre-built world here instead of a bare genre, which brings its own races, classes, monsters and lore without changing a rule. You get an eight-letter invite code to share with your friends.",
    getting2:
      "Solo adventure is the same thing for one player. To join someone else's table, paste their code into “Join with a room code” or open the invite link they send you.",
    getting3:
      "Then build a character in the creation wizard, or reuse one saved under Characters in the account menu. Everyone readies up in the lobby, and the campaign owner starts the adventure.",
    runTitle: "How the game is run",
    run1:
      "The app does all the calculation and gives the result to the DM, who weaves it into the story. Attack rolls, damage, saving throws, death saves, conditions, spell slots, rests, XP and level-ups are all resolved by the server against the 5e rules and written straight to your character sheet.",
    run2:
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
    ask:
      "To ask the DM a question about the story, the world, the rules, or your sheet, open the Ask the DM strip just above the message box. The answer quotes what the campaign has on record, and you choose whether it is just for you or for the whole table. Asking never moves the story on, so it works even while the floor is locked.",
    oneTurnTitle: "One turn at a time",
    oneTurn1:
      "When the DM starts thinking, it reads everything sent up to that moment and writes one reply for the whole table. Anything you send while it is still thinking will not change that reply. It is picked up on the next turn, together with whatever everyone else sent.",
    oneTurn2:
      "When playing with others, discuss your options before someone sends, then send one clear action each. Piling on more messages during narration does not speed the DM up or steer the reply already in progress.",
    oneTurn3:
      "OOC is the safe channel for that discussion: it never wakes the DM, and it still works while the floor is locked during narration. Sometimes the DM puts one player in the spotlight and waits for them, and a banner will tell you when that is why you cannot act.",
    badReplyTitle: "If a reply lands badly",
    badReply1:
      "Nothing the DM writes is final. Hovering one of its messages shows a row of actions. The party lead can reroll that moment, keeping the same dice and outcome while changing only the wording, then page between the takes and leave the best one up for the table. The lead can also continue a reply that stopped short, or edit the wording by hand.",
    badReply2:
      "Two of those actions are open to everyone. Anyone can check a passage against what the campaign has already established, and anyone can select a line and press the bookmark to keep that detail in front of the DM for the rest of the campaign.",
    stuckTitle: "If you get stuck",
    stuck:
      "The Help entry, in the account menu here and in the header during a session, walks through every button and panel: the side panel tabs, the Ask strip, the per-message actions, dice options, narration voice, notes, whispers, world packs and the party lead's powers. If a spotlight leaves the table stuck, the party lead can release it.",
  },
  ru: {
    title: "Как играть",
    whatTitle: "Что это такое",
    what1:
      "Open Dungeon Master — это стол для Dungeons & Dragons 5e, где место Dungeon Master занимает ИИ, либо игру ведёт ваш друг, используя ИИ как помощника. Вы и ваши друзья играете за искателей приключений. Приложение берёт на себя правила и кубики.",
    what2:
      "Каждая партия работает по правилам 5e. Мир выбираете вы: это может быть любой жанр или один из готовых миров, установленных на сервере.",
    gettingTitle: "С чего начать",
    getting1:
      "Новая кампания создаёт мир: выберите жанр, сложность и начальный уровень, а при желании дайте мастеру скрытую завязку сюжета, которую будет знать только он. Если на сервере установлены плагины кампаний, вместо обычного жанра можно выбрать готовый мир со своими расами, классами, монстрами и лором — правила при этом не меняются. После создания вы получите восьмизначный код приглашения, которым можно поделиться с друзьями.",
    getting2:
      "Одиночное приключение — тот же режим, но для одного игрока. Чтобы присоединиться к чужому столу, вставьте код в поле «Присоединиться по коду комнаты» или откройте присланную ссылку-приглашение.",
    getting3:
      "Затем создайте персонажа в мастере создания или используйте уже сохранённого в разделе «Персонажи» меню аккаунта. В лобби все отмечаются как готовые, после чего владелец кампании начинает приключение.",
    runTitle: "Как работает игра",
    run1:
      "Все расчёты выполняет приложение и передаёт результат мастеру, который вплетает его в историю. Атаки, урон, спасброски, спасброски от смерти, состояния, ячейки заклинаний, отдых, опыт и повышение уровня рассчитываются сервером по правилам 5e и сразу записываются в лист персонажа.",
    run2:
      "Мастер описывает, что означают эти результаты в мире игры. Он не может придумать бросок или незаметно выдать вам бонус, поэтому играйте историю, а не спорьте с числами. Каждый бросок и изменение характеристик записываются в журнал на вкладке «История», где расчёты всегда можно проверить.",
    turnTitle: "Ваш ход",
    turnIntro: "Кнопки над полем ввода определяют смысл сообщения:",
    doLabel: "Действие",
    doText:
      "Опишите, что делает ваш персонаж. Мастер расскажет результат и запросит бросок, если этого требуют правила.",
    sayLabel: "Речь",
    sayText: "Говорите от лица персонажа. Текст отправляется как его реплика.",
    oocLabel: "OOC",
    oocText: "Разговор игроков вне персонажей. Мастер его не читает и не отвечает на него.",
    ask:
      "Чтобы задать мастеру вопрос о сюжете, мире, правилах или своём листе, откройте панель «Спросить мастера» прямо над полем сообщения. Ответ опирается на факты, уже записанные в кампании, а вы выбираете, увидите его только вы или весь стол. Такой вопрос не двигает сюжет вперёд и работает даже тогда, когда во время повествования действия игроков заблокированы.",
    oneTurnTitle: "По одному ходу",
    oneTurn1:
      "Когда мастер начинает обдумывать ответ, он читает всё, что было отправлено к этому моменту, и пишет одну общую реакцию для всего стола. Сообщения, отправленные во время генерации, уже не изменят этот ответ: они попадут в следующий ход вместе с сообщениями остальных игроков.",
    oneTurn2:
      "Если вы играете компанией, сначала обсудите варианты, а затем отправьте по одному понятному действию от каждого. Дополнительные сообщения во время повествования не ускорят мастера и не изменят уже формируемый ответ.",
    oneTurn3:
      "OOC — безопасный канал для такого обсуждения: сообщения в нём не вызывают ответ мастера и остаются доступны, пока игровое поле заблокировано во время повествования. Иногда мастер отдаёт сцену одному игроку и ждёт именно его; баннер сообщит, если действовать нельзя по этой причине.",
    badReplyTitle: "Если ответ получился неудачным",
    badReply1:
      "Ни один текст мастера не является окончательным. При наведении на его сообщение появляется ряд действий. Лидер партии может перебросить этот момент: кубики и исход останутся прежними, изменится только формулировка. После этого можно переключаться между вариантами и оставить лучший. Лидер также может продолжить оборвавшийся ответ или вручную отредактировать текст.",
    badReply2:
      "Два действия доступны всем игрокам. Любой может проверить фрагмент по уже установленным фактам кампании, а также выделить строку и добавить её в закладки, чтобы мастер учитывал эту деталь до конца кампании.",
    stuckTitle: "Если вы застряли",
    stuck:
      "Раздел «Справка» в меню аккаунта и в заголовке сессии описывает каждую кнопку и панель: вкладки боковой панели, «Спросить мастера», действия над сообщениями, варианты бросков, озвучку повествования, заметки, шёпот, наборы миров и полномочия лидера партии. Если режим фокуса заблокировал стол, лидер партии может снять его.",
  },
  pl: {
    title: "Jak grać",
    whatTitle: "Czym jest ta aplikacja",
    what1:
      "Open Dungeon Master to stół do Dungeons & Dragons 5e, przy którym rolę Dungeon Mastera pełni AI albo znajomy korzystający z AI jako asystenta. Ty i twoi znajomi gracie poszukiwaczami przygód. Aplikacja zajmuje się zasadami i kośćmi.",
    what2:
      "Każda rozgrywka korzysta z zasad 5e. Miejsce akcji wybieracie sami: może to być dowolny gatunek albo jeden z gotowych światów zainstalowanych na serwerze.",
    gettingTitle: "Jak zacząć",
    getting1:
      "Nowa kampania tworzy świat: wybierz gatunek, poziom trudności i poziom początkowy, a opcjonalnie przekaż Mistrzowi Gry tajny zarys fabuły, którego gracze nie poznają. Jeśli serwer ma zainstalowane dodatki kampanii, zamiast samego gatunku możesz wybrać gotowy świat z własnymi rasami, klasami, potworami i lore, bez zmieniania zasad. Otrzymasz ośmioznakowy kod zaproszenia do udostępnienia znajomym.",
    getting2:
      "Przygoda solo działa tak samo, ale dla jednej osoby. Aby dołączyć do stołu innego gracza, wklej jego kod w polu „Dołącz kodem pokoju” albo otwórz otrzymany link z zaproszeniem.",
    getting3:
      "Następnie utwórz postać w kreatorze albo użyj ponownie postaci zapisanej w sekcji „Postacie” w menu konta. W lobby wszyscy oznaczają gotowość, a właściciel kampanii rozpoczyna przygodę.",
    runTitle: "Jak prowadzona jest gra",
    run1:
      "Aplikacja wykonuje wszystkie obliczenia i przekazuje wynik Mistrzowi Gry, który wplata go w opowieść. Rzuty ataku, obrażenia, rzuty obronne, rzuty przeciw śmierci, stany, komórki czarów, odpoczynki, PD i awanse są rozstrzygane przez serwer zgodnie z zasadami 5e i od razu zapisywane na karcie postaci.",
    run2:
      "Mistrz Gry opisuje, co te wyniki oznaczają w świecie gry. Nie może wymyślić rzutu ani po cichu przyznać ci premii, więc skup się na historii zamiast spierać się z liczbami. Każdy rzut i zmiana statystyk są zapisane w dzienniku na karcie „Historia”, gdzie można sprawdzić obliczenia.",
    turnTitle: "Wykonywanie tury",
    turnIntro: "Przyciski nad polem wiadomości określają znaczenie wysyłanego tekstu:",
    doLabel: "Akcja",
    doText:
      "Opisz, co robi twoja postać. Mistrz Gry opisze rezultat i poprosi o rzut, gdy wymagają tego zasady.",
    sayLabel: "Mowa",
    sayText: "Mów jako postać. Tekst zostanie wysłany jako wypowiadany dialog.",
    oocLabel: "OOC",
    oocText: "Rozmowa graczy poza postaciami. Mistrz Gry jej nie czyta ani na nią nie odpowiada.",
    ask:
      "Aby zapytać Mistrza Gry o fabułę, świat, zasady lub kartę postaci, otwórz pasek „Zapytaj MG” tuż nad polem wiadomości. Odpowiedź opiera się na informacjach zapisanych w kampanii, a ty wybierasz, czy zobaczysz ją tylko ty, czy cały stół. Pytanie nie przesuwa fabuły do przodu, więc działa także wtedy, gdy podczas narracji możliwość działania jest zablokowana.",
    oneTurnTitle: "Jedna tura naraz",
    oneTurn1:
      "Gdy Mistrz Gry zaczyna przygotowywać odpowiedź, czyta wszystko wysłane do tej chwili i tworzy jedną reakcję dla całego stołu. Wiadomości wysłane w trakcie generowania nie zmienią tej odpowiedzi. Zostaną uwzględnione w następnej turze razem z wiadomościami pozostałych graczy.",
    oneTurn2:
      "Grając z innymi, omówcie możliwości przed wysłaniem wiadomości, a następnie niech każdy wyśle jedną jasną akcję. Dodawanie kolejnych wiadomości podczas narracji nie przyspieszy MG ani nie zmieni odpowiedzi, która już powstaje.",
    oneTurn3:
      "OOC jest bezpiecznym kanałem do takich rozmów: nie uruchamia odpowiedzi MG i działa również wtedy, gdy podczas narracji stół jest zablokowany. Czasami MG oddaje scenę jednemu graczowi i czeka właśnie na niego; baner poinformuje cię, jeśli z tego powodu nie możesz działać.",
    badReplyTitle: "Gdy odpowiedź nie pasuje",
    badReply1:
      "Żaden tekst Mistrza Gry nie jest ostateczny. Po najechaniu na jego wiadomość pojawia się zestaw akcji. Lider drużyny może przerzucić dany moment, zachowując te same kości i wynik, a zmieniając tylko sposób opisania wydarzenia. Potem można przełączać się między wersjami i zostawić najlepszą. Lider może też kontynuować urwaną odpowiedź albo ręcznie ją edytować.",
    badReply2:
      "Dwie z tych akcji są dostępne dla wszystkich. Każdy może sprawdzić fragment względem faktów ustalonych wcześniej w kampanii oraz zaznaczyć linię i dodać ją do zakładek, aby MG pamiętał o tym szczególe do końca kampanii.",
    stuckTitle: "Gdy utkniesz",
    stuck:
      "Sekcja „Pomoc” w menu konta i w nagłówku podczas sesji opisuje wszystkie przyciski i panele: zakładki panelu bocznego, pasek pytań do MG, akcje przy wiadomościach, opcje kości, głos narracji, notatki, szepty, pakiety światów i uprawnienia lidera drużyny. Jeśli tryb skupienia zablokuje stół, lider drużyny może go zwolnić.",
  },
} as const;

// Onboarding read for newcomers: what the app is, how to get a table running,
// who does the maths, and the table etiquette that follows from coalesced DM turns.
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
        <p>{copy.what1}</p>
        <p>{copy.what2}</p>
      </Section>

      <Section icon={Compass} title={copy.gettingTitle}>
        <p>{copy.getting1}</p>
        <p>{copy.getting2}</p>
        <p>{copy.getting3}</p>
      </Section>

      <Section icon={Dices} title={copy.runTitle}>
        <p>{copy.run1}</p>
        <p>{copy.run2}</p>
      </Section>

      <Section icon={MessageSquareText} title={copy.turnTitle}>
        <p>{copy.turnIntro}</p>
        <ModeRow label={copy.doLabel}>{copy.doText}</ModeRow>
        <ModeRow label={copy.sayLabel}>{copy.sayText}</ModeRow>
        <ModeRow label={copy.oocLabel}>{copy.oocText}</ModeRow>
        <p>{copy.ask}</p>
      </Section>

      <Section icon={Hourglass} title={copy.oneTurnTitle}>
        <p>{copy.oneTurn1}</p>
        <p>{copy.oneTurn2}</p>
        <p>{copy.oneTurn3}</p>
      </Section>

      <Section icon={RefreshCw} title={copy.badReplyTitle}>
        <p>{copy.badReply1}</p>
        <p>{copy.badReply2}</p>
      </Section>

      <Section icon={CircleHelp} title={copy.stuckTitle}>
        <p>{copy.stuck}</p>
      </Section>
    </Dialog>
  );
}
