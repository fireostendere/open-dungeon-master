"use client";

import { useMemo } from "react";
import OptionPicker, { type PickerGroup } from "@/app/characters/builder/OptionPicker";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
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
        <ToggleCard
          active
          onClick={() => patch({ dmMode: "human" })}
          label={locale === "ru" ? "Человек / внешний рассказчик" : "Human / external narrator"}
          hint={locale === "ru"
            ? "Сервер хранит состояние и применяет правила; повествование ведёт человек или внешний MCP narrator."
            : "The server owns state and rules; narration is supplied by a human or external MCP narrator."}
        />
        <p className="mt-1.5 text-xs text-stone-500">{copy.humanSeat}</p>
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
