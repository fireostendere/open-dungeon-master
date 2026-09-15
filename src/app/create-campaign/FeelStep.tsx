"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { InfoButton } from "@/components/ui/InfoDialog";
import { ToggleCard } from "@/app/create-campaign/fields";
import { NarratorFields } from "@/app/create-campaign/NarratorFields";
import type { CampaignDraft, StepProps, WizardGates } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    aiSetup: "AI story setup",
    aiSetupHint: "The DM invents the plot",
    narration: "Voice narration",
    narrationHint: "Spoken DM narration",
    narrationUnavailable: "No speech service on this server",
    maps: "Maps",
    mapsHint: "AI-drawn area maps",
    mapsUnavailable: "No image service on this server",
    ambience: "Ambience",
    ambienceHint: "Room tone, music and stings",
    ambienceAuto: "Sound follows the scene",
    ambienceAutoHint: "Off leaves it to the DM",
    multiclassing: "Multiclassing",
    multiclassingHint: "Second classes at level-up",
    livingWorld: "Living world",
    livingWorldHint: "Off-screen schemes and rumors advance on their own",
    livingWorldLabel: "What does Living World do?",
    livingWorldInfo:
      "On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.\n\nNPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.\n\nThe DM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are DM-only until the party discovers them in play.\n\nOff: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.\n\nYou can switch this at any time. Turning it back on resumes from the world as it currently stands.",
    itemOffers: "Item offers",
    itemOffersHint: "Players confirm DM loot and gold changes",
    bonds: "Bonds",
    bondsHint: "NPCs remember how each character treated them",
    bondsLabel: "What are Bonds?",
    bondsInfo:
      "How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted.\n\nDeeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary.\n\nStanding shows in the Bonds tab and colors how the DM plays them. Off: the DM tracks no personal standing and NPCs react to the party as a whole.",
    romance: "Romance",
    romanceHint: "Bonds can grow into a relationship",
    romanceLabel: "How does Romance work?",
    romanceInfo:
      "The romance ladder on top of the bond meter: interested, courting, together, betrothed, married.\n\nNobody can be romanced who does not already like the character, players always make the first move, and intimate scenes always fade to black.\n\nRequires Bonds to be on.",
    outcome: "Outcome check",
    outcomeHint: "Narration that contradicts the dice is rewritten",
    outcomeLabel: "What is the outcome check?",
    outcomeInfo:
      "After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled.\n\nA contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.\n\nOff costs nothing but the check, and the narration is persisted exactly as written.",
    midJoin: "Mid-game joining",
    midJoinHint: "New players can use the invite code after the start",
    held: "Held responses",
    heldHint: "Nobody acts until the party lead opens the floor",
  },
  ru: {
    aiSetup: "ИИ создаёт сюжет",
    aiSetupHint: "Мастер самостоятельно придумывает основную историю",
    narration: "Голосовая озвучка",
    narrationHint: "Мастер читает повествование вслух",
    narrationUnavailable: "На сервере не настроен синтез речи",
    maps: "Карты",
    mapsHint: "ИИ рисует карты местности",
    mapsUnavailable: "На сервере не настроена генерация изображений",
    ambience: "Атмосфера",
    ambienceHint: "Фоновые звуки, музыка и короткие акценты",
    ambienceAuto: "Звук следует за сценой",
    ambienceAutoHint: "Если выключить, выбор останется за Мастером",
    multiclassing: "Мультиклассирование",
    multiclassingHint: "Можно брать уровни второго класса",
    livingWorld: "Живой мир",
    livingWorldHint: "Закулисные планы и слухи развиваются сами",
    livingWorldLabel: "Как работает живой мир?",
    livingWorldInfo:
      "Включено: мир движется и без участия группы. В каждом ходу фоновые сюжетные линии развиваются скрытыми бросками, поэтому соперничающие фракции, угрозы и далёкие события продолжают жить своей жизнью.\n\nNPC преследуют собственные цели между главами, во время отдыха и путешествий. Заговоры продвигаются, давление растёт, а соперники могут столкнуться друг с другом.\n\nМастер незаметно записывает произошедшее за кадром и вплетает последствия в будущие сцены, засады и слухи. Эти заметки видит только Мастер, пока группа не узнает о событиях в игре.\n\nВыключено: всё это ставится на паузу. Мир меняется только из-за действий группы или требований основной сюжетной арки. Главная история, главы, квесты и опыт работают одинаково в обоих режимах.\n\nНастройку можно менять в любой момент. После повторного включения симуляция продолжится из текущего состояния мира.",
    itemOffers: "Подтверждение добычи",
    itemOffersHint: "Игроки подтверждают изменения предметов и золота от Мастера",
    bonds: "Отношения",
    bondsHint: "NPC помнят, как каждый персонаж с ними обращался",
    bondsLabel: "Как работают отношения?",
    bondsInfo:
      "Сервер отдельно отслеживает отношение каждого NPC и ИИ-компаньона к каждому персонажу по шкале от враждебности через нейтралитет до преданности.\n\nПоступки двигают эту шкалу, причём одно действие по-разному воспринимается разными людьми: милосердие расположит доброго лекаря и может раздражить сурового наёмника.\n\nОтношение видно на вкладке «Связи» и влияет на то, как Мастер отыгрывает NPC. Если функцию выключить, личные отношения не отслеживаются и NPC реагируют на группу в целом.",
    romance: "Романтика",
    romanceHint: "Отношения могут перерасти в романтическую связь",
    romanceLabel: "Как работает романтика?",
    romanceInfo:
      "Поверх шкалы отношений действует романтическая лестница: интерес, ухаживание, пара, помолвка, брак.\n\nРомантика возможна только с персонажем, который уже хорошо относится к герою; первый шаг всегда делает игрок, а интимные сцены всегда затемняются без подробностей.\n\nТребует включённых отношений.",
    outcome: "Проверка исхода",
    outcomeHint: "Повествование, противоречащее костям, переписывается",
    outcomeLabel: "Что такое проверка исхода?",
    outcomeInfo:
      "После каждого хода сервер сверяет текст Мастера с тем, что реально разрешили кости и инструменты: например, описанный успех при промахе, смерть при оставшихся HP или урон, которого не было в броске.\n\nПри противоречии текст один раз отправляется Мастеру на переписывание. Значения в листах при этом не меняются.\n\nЕсли проверку выключить, дополнительный запрос не выполняется, а повествование сохраняется ровно таким, каким его написал Мастер.",
    midJoin: "Подключение по ходу игры",
    midJoinHint: "Новые игроки могут использовать код приглашения после старта",
    held: "Отложенные действия",
    heldHint: "Никто не действует, пока лидер группы не откроет ход",
  },
  pl: {
    aiSetup: "AI tworzy fabułę",
    aiSetupHint: "Mistrz Gry sam wymyśla główną historię",
    narration: "Narracja głosowa",
    narrationHint: "Mistrz Gry czyta narrację na głos",
    narrationUnavailable: "Na tym serwerze nie ma usługi syntezy mowy",
    maps: "Mapy",
    mapsHint: "Mapy obszarów rysowane przez AI",
    mapsUnavailable: "Na tym serwerze nie ma usługi generowania obrazów",
    ambience: "Dźwięki otoczenia",
    ambienceHint: "Tło, muzyka i krótkie akcenty dźwiękowe",
    ambienceAuto: "Dźwięk podąża za sceną",
    ambienceAutoHint: "Po wyłączeniu wybór pozostaje Mistrzowi Gry",
    multiclassing: "Wieloklasowość",
    multiclassingHint: "Można brać poziomy w drugiej klasie",
    livingWorld: "Żyjący świat",
    livingWorldHint: "Plany poza sceną i plotki rozwijają się samodzielnie",
    livingWorldLabel: "Jak działa Żyjący świat?",
    livingWorldInfo:
      "Włączone: świat porusza się bez ciebie. W każdej turze wątki poza sceną rozwijają się przez ukryte rzuty, więc rywalizujące frakcje, zagrożenia i odległe wydarzenia nadal się zmieniają.\n\nNPC realizują własne cele między rozdziałami oraz podczas odpoczynku i podróży. Intrygi postępują, presja rośnie, a rywale mogą wejść ze sobą w konflikt.\n\nMistrz Gry po cichu zapisuje to, co wydarzyło się poza sceną, i wplata konsekwencje w przyszłe sceny, zasadzki i plotki. Te notatki są widoczne tylko dla Mistrza Gry, dopóki drużyna nie odkryje ich w grze.\n\nWyłączone: wszystko to zostaje wstrzymane. Świat zmienia się tylko wtedy, gdy działa drużyna albo wymaga tego główny wątek. Główna fabuła, rozdziały, zadania i PD działają tak samo w obu trybach.\n\nUstawienie można zmienić w dowolnej chwili. Po ponownym włączeniu symulacja rusza od obecnego stanu świata.",
    itemOffers: "Potwierdzanie łupów",
    itemOffersHint: "Gracze zatwierdzają zmiany przedmiotów i złota od Mistrza Gry",
    bonds: "Relacje",
    bondsHint: "NPC pamiętają, jak każda postać ich traktowała",
    bondsLabel: "Jak działają relacje?",
    bondsInfo:
      "Serwer osobno śledzi stosunek każdego NPC i towarzysza AI do każdej postaci na jednej skali od wrogości przez neutralność do oddania.\n\nCzyny przesuwają tę skalę, a to samo działanie może zostać różnie odebrane przez różne osoby: miłosierdzie zyska sympatię dobrego uzdrowiciela, ale może zirytować zahartowanego najemnika.\n\nRelacja jest widoczna na karcie „Relacje” i wpływa na sposób odgrywania NPC przez Mistrza Gry. Po wyłączeniu osobiste relacje nie są śledzone, a NPC reagują na drużynę jako całość.",
    romance: "Romans",
    romanceHint: "Relacja może rozwinąć się w związek",
    romanceLabel: "Jak działa romans?",
    romanceInfo:
      "Na skali relacji działa dodatkowa drabina romansu: zainteresowanie, zaloty, związek, zaręczyny, małżeństwo.\n\nRomans jest możliwy tylko z osobą, która już lubi postać; pierwszy krok zawsze wykonuje gracz, a intymne sceny zawsze kończą się dyskretnym fade-to-black.\n\nWymaga włączonych relacji.",
    outcome: "Kontrola wyniku",
    outcomeHint: "Narracja sprzeczna z kośćmi zostaje przepisana",
    outcomeLabel: "Czym jest kontrola wyniku?",
    outcomeInfo:
      "Po każdej turze serwer porównuje narrację Mistrza Gry z tym, co naprawdę rozstrzygnęły kości i narzędzia: trafienie opisane po pudle, śmierć mimo pozostałych PW albo obrażenia, których nie było w rzucie.\n\nSprzeczność jest raz odsyłana do Mistrza Gry do poprawy. Żadna wartość na karcie postaci nie zmienia się przez tę kontrolę.\n\nPo wyłączeniu nie ma dodatkowego sprawdzenia, a narracja zostaje zapisana dokładnie tak, jak została napisana.",
    midJoin: "Dołączanie w trakcie gry",
    midJoinHint: "Nowi gracze mogą użyć kodu zaproszenia po rozpoczęciu kampanii",
    held: "Wstrzymane działania",
    heldHint: "Nikt nie działa, dopóki lider drużyny nie otworzy możliwości ruchu",
  },
} as const;

// Which of the table features are switched on, counting only the ones the
// wizard actually showed: a hidden toggle is not a choice the table made.
// The review step reads this so its "n on" agrees with the grid.
export function featuresOn(draft: CampaignDraft, gates: WizardGates): number {
  const { aiNarrates, solo } = gates;
  const bonds = draft.relationships !== "off";
  return [
    aiNarrates && draft.aiStorySetup,
    draft.ttsEnabled,
    draft.mapsEnabled,
    draft.ambienceEnabled,
    draft.ambienceEnabled && draft.ambienceAuto,
    draft.multiclassingEnabled,
    aiNarrates && draft.worldSimulation,
    draft.inventoryApprovals,
    bonds,
    bonds && draft.romance !== "off",
    aiNarrates && draft.narrationGuard,
    !solo && draft.midGameJoinOpen,
    !solo && draft.holdSubmissions,
  ].filter(Boolean).length;
}

// Step 4: the toggle grid, then the AI allies and narrator voice. Voice
// narration and maps stay visible but disabled when the server lacks the
// backend, because they are one server switch away rather than a feature
// this install can never have; the AI-only rows hide when a human narrates.
export function FeelStep(props: StepProps) {
  const { draft, patch, gates } = props;
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { aiNarrates, solo, ttsAvailable, mapsAvailable } = gates;
  const bonds = draft.relationships !== "off";
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {aiNarrates ? (
          <ToggleCard
            active={draft.aiStorySetup}
            onClick={() => patch({ aiStorySetup: !draft.aiStorySetup })}
            label={copy.aiSetup}
            hint={copy.aiSetupHint}
          />
        ) : null}
        <ToggleCard
          active={draft.ttsEnabled}
          disabled={!ttsAvailable}
          onClick={() => patch({ ttsEnabled: !draft.ttsEnabled })}
          label={copy.narration}
          hint={ttsAvailable ? copy.narrationHint : copy.narrationUnavailable}
        />
        <ToggleCard
          active={draft.mapsEnabled}
          disabled={!mapsAvailable}
          onClick={() => patch({ mapsEnabled: !draft.mapsEnabled })}
          label={copy.maps}
          hint={mapsAvailable ? copy.mapsHint : copy.mapsUnavailable}
        />
        <ToggleCard
          active={draft.ambienceEnabled}
          onClick={() => patch({ ambienceEnabled: !draft.ambienceEnabled })}
          label={copy.ambience}
          hint={copy.ambienceHint}
        />
        {draft.ambienceEnabled ? (
          <ToggleCard
            active={draft.ambienceAuto}
            onClick={() => patch({ ambienceAuto: !draft.ambienceAuto })}
            label={copy.ambienceAuto}
            hint={copy.ambienceAutoHint}
          />
        ) : null}
        <ToggleCard
          active={draft.multiclassingEnabled}
          onClick={() => patch({ multiclassingEnabled: !draft.multiclassingEnabled })}
          label={copy.multiclassing}
          hint={copy.multiclassingHint}
        />
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.worldSimulation}
              onClick={() => patch({ worldSimulation: !draft.worldSimulation })}
              label={copy.livingWorld}
              hint={copy.livingWorldHint}
            />
            <InfoButton
              label={copy.livingWorldLabel}
              text={copy.livingWorldInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        <ToggleCard
          active={draft.inventoryApprovals}
          onClick={() => patch({ inventoryApprovals: !draft.inventoryApprovals })}
          label={copy.itemOffers}
          hint={copy.itemOffersHint}
        />
        <div className="relative flex">
          <ToggleCard
            active={bonds}
            onClick={() => patch({ relationships: bonds ? "off" : "on" })}
            label={copy.bonds}
            hint={copy.bondsHint}
          />
          <InfoButton label={copy.bondsLabel} text={copy.bondsInfo} className="absolute right-1.5 top-1.5" />
        </div>
        {bonds ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.romance !== "off"}
              onClick={() => patch({ romance: draft.romance === "off" ? "on" : "off" })}
              label={copy.romance}
              hint={copy.romanceHint}
            />
            <InfoButton
              label={copy.romanceLabel}
              text={copy.romanceInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.narrationGuard}
              onClick={() => patch({ narrationGuard: !draft.narrationGuard })}
              label={copy.outcome}
              hint={copy.outcomeHint}
            />
            <InfoButton
              label={copy.outcomeLabel}
              text={copy.outcomeInfo}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.midGameJoinOpen}
            onClick={() => patch({ midGameJoinOpen: !draft.midGameJoinOpen })}
            label={copy.midJoin}
            hint={copy.midJoinHint}
          />
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.holdSubmissions}
            onClick={() => patch({ holdSubmissions: !draft.holdSubmissions })}
            label={copy.held}
            hint={copy.heldHint}
          />
        ) : null}
      </div>

      <NarratorFields {...props} className={cn(!aiNarrates && !draft.ttsEnabled && "hidden")} />
    </div>
  );
}
