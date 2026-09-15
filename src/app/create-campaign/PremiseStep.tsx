"use client";

import { useMemo } from "react";
import OptionPicker, { type PickerGroup } from "@/app/characters/builder/OptionPicker";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { DM_MODES } from "@/lib/schemas/game-settings-options";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { useI18n } from "@/lib/i18n";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    noPackInfo:
      "A pre-built world is a coat of paint over the same 5e rules. It renames the races, classes, spells and monsters to fit its setting, tells the Dungeon Master how the place sounds, and floats the peoples and callings that belong there to the top of every picker in the character builder. Nothing is locked: you can still play a wizard in a world that calls them something else.\n\nWithout one you get the plain setting your genre implies, with the whole catalog offered in its own words.",
    noPack: "No pack (plain setting)",
    title: "Title",
    titlePlaceholder: "Curse of the Ash Kingdom",
    whoRuns: "Who runs this table?",
    modeLabels: {
      ai: "AI Dungeon Master",
      human: "I run the game",
      assisted: "I run the game, with AI help",
    },
    modeHints: {
      ai: "The AI narrates, adjudicates and runs the world. The party lead steers it.",
      human: "You narrate. The server still enforces every rule and rolls every die.",
      assisted: "You own the story; hand the AI the monsters, the prose, or a stretch of turns.",
    },
    noAi: "This server has no AI storyteller, so a human runs the table.",
    aiOffline:
      "The AI backend is not answering right now. You can still create this campaign, but AI turns will fail until it is back.",
    humanSeat:
      "You take the Dungeon Master seat: no character, no party slot, and you see the sheets, the stat blocks and the whole map. The server still rolls every die and holds every number.",
    prebuiltWorld: "Pre-built world (optional)",
    noPackHelp:
      "A pre-built world renames the races, classes, spells and monsters to fit it, and tells the DM how it sounds. Every rule stays 5e.",
  },
  ru: {
    noPackInfo:
      "Готовый мир — это новое оформление поверх тех же правил 5e. Он переименовывает расы, классы, заклинания и монстров под свой сеттинг, объясняет Мастеру, как должен звучать этот мир, и поднимает подходящие народы и архетипы выше в списках мастера персонажа. Ничего не блокируется: вы всё равно можете сыграть волшебником даже в мире, где эта роль называется иначе.\n\nБез пакета вы получите обычный сеттинг выбранного жанра и полный каталог под стандартными названиями.",
    noPack: "Без пакета (обычный сеттинг)",
    title: "Название",
    titlePlaceholder: "Проклятие Пепельного королевства",
    whoRuns: "Кто ведёт эту игру?",
    modeLabels: {
      ai: "ИИ-Мастер",
      human: "Игру веду я",
      assisted: "Игру веду я, с помощью ИИ",
    },
    modeHints: {
      ai: "ИИ ведёт повествование, принимает решения по правилам и управляет миром. Лидер группы направляет его.",
      human: "Вы ведёте повествование. Сервер по-прежнему применяет правила и бросает все кости.",
      assisted: "История остаётся за вами; ИИ можно поручить монстров, текст повествования или несколько ходов.",
    },
    noAi: "На этом сервере нет ИИ-рассказчика, поэтому игру должен вести человек.",
    aiOffline:
      "ИИ-бэкенд сейчас не отвечает. Кампанию можно создать, но ходы ИИ не будут работать, пока соединение не восстановится.",
    humanSeat:
      "Вы занимаете место Мастера: у вас нет собственного персонажа и слота в группе, зато вы видите листы, статблоки и всю карту. Сервер всё равно бросает кости и хранит игровые значения.",
    prebuiltWorld: "Готовый мир (необязательно)",
    noPackHelp:
      "Готовый мир переименовывает расы, классы, заклинания и монстров под выбранный сеттинг и задаёт его тон для Мастера. Все правила остаются 5e.",
  },
  pl: {
    noPackInfo:
      "Gotowy świat to nowa warstwa fabularna na tych samych zasadach 5e. Zmienia nazwy ras, klas, czarów i potworów tak, aby pasowały do settingu, podpowiada Mistrzowi Gry, jak ma brzmieć ten świat, oraz przesuwa pasujące ludy i archetypy na początek list w kreatorze postaci. Niczego nie blokuje: nadal możesz zagrać czarodziejem w świecie, który nazywa tę rolę inaczej.\n\nBez pakietu otrzymujesz zwykły setting wynikający z wybranego gatunku i pełny katalog pod standardowymi nazwami.",
    noPack: "Bez pakietu (zwykły setting)",
    title: "Tytuł",
    titlePlaceholder: "Klątwa Popielnego Królestwa",
    whoRuns: "Kto prowadzi ten stół?",
    modeLabels: {
      ai: "Mistrz Gry AI",
      human: "Ja prowadzę grę",
      assisted: "Ja prowadzę grę, z pomocą AI",
    },
    modeHints: {
      ai: "AI prowadzi narrację, rozstrzyga zasady i zarządza światem. Lider drużyny nadaje kierunek.",
      human: "Ty prowadzisz narrację. Serwer nadal egzekwuje zasady i wykonuje wszystkie rzuty.",
      assisted: "Historia należy do ciebie; AI możesz przekazać potwory, narrację lub serię tur.",
    },
    noAi: "Ten serwer nie ma narratora AI, więc stół musi prowadzić człowiek.",
    aiOffline:
      "Backend AI obecnie nie odpowiada. Nadal możesz utworzyć kampanię, ale tury AI nie zadziałają, dopóki połączenie nie wróci.",
    humanSeat:
      "Zajmujesz miejsce Mistrza Gry: nie masz własnej postaci ani miejsca w drużynie, za to widzisz karty, bloki statystyk i całą mapę. Serwer nadal wykonuje wszystkie rzuty i przechowuje wartości mechaniczne.",
    prebuiltWorld: "Gotowy świat (opcjonalnie)",
    noPackHelp:
      "Gotowy świat zmienia nazwy ras, klas, czarów i potworów tak, aby pasowały do settingu, oraz określa jego ton dla Mistrza Gry. Wszystkie zasady pozostają 5e.",
  },
} as const;

// Step 1: the name, who holds the DM seat, and an optional pre-built world.
// The pack select is hidden outright when the server has none installed.
export function PremiseStep({
  draft,
  patch,
  gates,
  packs,
  franchises,
  selectedPack,
  onChoosePack,
  onClearPack,
}: StepProps & {
  packs: WorldPackSummary[];
  franchises: FranchiseGroup[];
  selectedPack: WorldPackSummary | null;
  onChoosePack: (pack: WorldPackSummary) => void;
  onClearPack: () => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const { storyKnownMissing, storyUnreachable, aiNarrates } = gates;
  // Every pack, each with its own blurb behind a ⓘ, so a world can be read
  // before it is chosen instead of after. A franchise with several eras keeps
  // them grouped under its name, exactly as the old <optgroup> did.
  const packGroups = useMemo<PickerGroup[]>(
    () => [
      {
        label: null,
        options: [{ id: "", name: copy.noPack, infoText: copy.noPackInfo }],
      },
      ...franchises.map((group) => ({
        label: group.editions.length === 1 ? null : group.franchise,
        options: group.editions.map((edition) => ({
          id: edition.id,
          name: group.editions.length === 1 ? edition.name : edition.edition || edition.name,
          infoText: edition.blurb,
        })),
      })),
    ],
    [copy.noPack, copy.noPackInfo, franchises],
  );
  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <FieldLabel>{copy.title}</FieldLabel>
        <input
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          required
          maxLength={80}
          placeholder={copy.titlePlaceholder}
          className={inputClass}
        />
      </label>

      <div>
        <FieldLabel className="mb-1.5">{copy.whoRuns}</FieldLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DM_MODES.filter(
            // A server that positively has no AI DM (provider "none")
            // offers only the human seat; "assisted" leans on the same
            // missing backend, so it goes too.
            (mode) => mode === "human" || !storyKnownMissing,
          ).map((mode) => (
            <ToggleCard
              key={mode}
              active={draft.dmMode === mode}
              onClick={() => patch({ dmMode: mode })}
              label={copy.modeLabels[mode]}
              hint={copy.modeHints[mode]}
            />
          ))}
        </div>
        {storyKnownMissing ? (
          <p className="mt-1.5 text-xs text-stone-500">{copy.noAi}</p>
        ) : null}
        {storyUnreachable && aiNarrates ? (
          <p className="mt-1.5 text-xs text-amber-300">{copy.aiOffline}</p>
        ) : null}
        {draft.dmMode !== "ai" ? (
          <p className="mt-1.5 text-xs text-stone-500">{copy.humanSeat}</p>
        ) : null}
      </div>

      {franchises.length ? (
        <div>
          <FieldLabel>{copy.prebuiltWorld}</FieldLabel>
          <OptionPicker
            value={draft.worldPack}
            groups={packGroups}
            placeholder={copy.noPack}
            className={inputClass}
            onChange={(id) => {
              const next = packs.find((pack) => pack.id === id);
              if (next) {
                onChoosePack(next);
              } else {
                onClearPack();
              }
            }}
          />
          {selectedPack ? (
            <>
              {selectedPack.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedPack.cover}
                  alt=""
                  className="mt-2 aspect-video w-full max-w-sm rounded-lg border border-stone-800 object-cover"
                />
              ) : null}
              <p className="mt-1 text-xs text-stone-500">{selectedPack.blurb}</p>
              <UnofficialPackNotice
                rightsHolder={selectedPack.rightsHolder}
                inspiredBy={selectedPack.inspiredBy}
                className="mt-1.5"
              />
            </>
          ) : (
            <p className="mt-1 text-xs text-stone-500">{copy.noPackHelp}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
