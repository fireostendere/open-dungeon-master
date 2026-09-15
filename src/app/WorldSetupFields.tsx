"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  WORLD_LORE_CATEGORIES,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";
import { useI18n } from "@/lib/i18n";

export type LoreDraft = {
  category: WorldLoreCategory;
  title: string;
  body: string;
};

const COPY = {
  en: {
    worldBuilding: "World building",
    optional: "optional",
    filled: "entries",
    houseRules: "House rules",
    rulesPlaceholder:
      "Your table's rulings, grouped under headings, e.g.\n\nPotions:\nDrinking a potion is a bonus action.",
    rulesHelp: "The DM is reminded of relevant rules each turn. Editable later in Setup.",
    worldLore: "World lore",
    titlePlaceholder: "Title (The Ashen League, The Sundering...)",
    remove: "Remove this entry",
    bodyPlaceholder: "What is established about it...",
    addLore: "Add lore entry",
    loreHelp:
      "Places, factions and history the DM treats as canon. Add or edit them later from the lobby and the Facts tab.",
    geography: "Geography",
    factions: "Factions",
    history: "History",
    magic: "Magic",
    culture: "Culture",
    religion: "Religion",
    other: "Other",
  },
  ru: {
    worldBuilding: "Создание мира",
    optional: "необязательно",
    filled: "зап.",
    houseRules: "Домашние правила",
    rulesPlaceholder:
      "Правила вашего стола по разделам, например:\n\nЗелья:\nВыпить зелье можно бонусным действием.",
    rulesHelp: "Мастер получает напоминание о подходящих правилах каждый ход. Позже их можно изменить в «Настройках».",
    worldLore: "Лор мира",
    titlePlaceholder: "Название (Пепельная лига, Раскол...)",
    remove: "Удалить эту запись",
    bodyPlaceholder: "Что об этом уже установлено...",
    addLore: "Добавить запись лора",
    loreHelp:
      "Места, фракции и история, которые мастер считает каноном. Их можно добавлять и менять позже из лобби и вкладки «Факты».",
    geography: "География",
    factions: "Фракции",
    history: "История",
    magic: "Магия",
    culture: "Культура",
    religion: "Религия",
    other: "Другое",
  },
  pl: {
    worldBuilding: "Budowanie świata",
    optional: "opcjonalnie",
    filled: "wpisów",
    houseRules: "Zasady domowe",
    rulesPlaceholder:
      "Ustalenia waszego stołu pogrupowane nagłówkami, np.\n\nMikstury:\nWypicie mikstury jest akcją dodatkową.",
    rulesHelp: "MG otrzymuje przypomnienie o odpowiednich zasadach w każdej turze. Później można je zmienić w Ustawieniach.",
    worldLore: "Lore świata",
    titlePlaceholder: "Tytuł (Popielata Liga, Rozdarcie...)",
    remove: "Usuń ten wpis",
    bodyPlaceholder: "Co zostało już o tym ustalone...",
    addLore: "Dodaj wpis lore",
    loreHelp:
      "Miejsca, frakcje i historia traktowane przez MG jako kanon. Możesz je później dodawać i edytować w lobby oraz na karcie Fakty.",
    geography: "Geografia",
    factions: "Frakcje",
    history: "Historia",
    magic: "Magia",
    culture: "Kultura",
    religion: "Religia",
    other: "Inne",
  },
} as const;

export async function submitWorldSetup(
  campaignId: string,
  houseRules: string,
  loreDrafts: LoreDraft[],
) {
  const jobs: Promise<unknown>[] = [];
  if (houseRules.trim()) {
    jobs.push(
      fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: houseRules }),
      }).catch(() => undefined),
    );
  }
  for (const draft of loreDrafts) {
    if (!draft.title.trim() || !draft.body.trim()) continue;
    jobs.push(
      fetch(`/api/campaigns/${campaignId}/lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: draft.category, title: draft.title, body: draft.body }),
      }).catch(() => undefined),
    );
  }
  await Promise.all(jobs);
}

export function WorldSetupFields({
  houseRules,
  setHouseRules,
  loreDrafts,
  setLoreDrafts,
}: {
  houseRules: string;
  setHouseRules: (text: string) => void;
  loreDrafts: LoreDraft[];
  setLoreDrafts: (drafts: LoreDraft[]) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const filled =
    (houseRules.trim() ? 1 : 0) + loreDrafts.filter((draft) => draft.title.trim()).length;
  const categoryLabels: Record<WorldLoreCategory, string> = {
    geography: copy.geography,
    factions: copy.factions,
    history: copy.history,
    magic: copy.magic,
    culture: copy.culture,
    religion: copy.religion,
    other: copy.other,
  };

  function patchDraft(index: number, patch: Partial<LoreDraft>) {
    setLoreDrafts(
      loreDrafts.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-stone-300"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-stone-500" />
        ) : (
          <ChevronRight className="size-3.5 text-stone-500" />
        )}
        <span className="font-medium">{copy.worldBuilding}</span>
        <span className="text-xs text-stone-500">
          {copy.optional}{filled ? ` · ${filled} ${copy.filled}` : ""}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-stone-800/70 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-stone-400">{copy.houseRules}</span>
            <textarea
              value={houseRules}
              onChange={(event) => setHouseRules(event.target.value)}
              rows={4}
              maxLength={20_000}
              placeholder={copy.rulesPlaceholder}
              className={ui.input}
            />
            <span className="mt-1 block text-xs text-stone-500">{copy.rulesHelp}</span>
          </label>

          <div>
            <span className="mb-1 block text-xs text-stone-400">{copy.worldLore}</span>
            <div className="space-y-2">
              {loreDrafts.map((draft, index) => (
                <div
                  key={index}
                  className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 p-2"
                >
                  <div className="flex gap-1.5">
                    <select
                      value={draft.category}
                      onChange={(event) =>
                        patchDraft(index, { category: event.target.value as WorldLoreCategory })
                      }
                      className={cn(ui.input, "w-32 shrink-0")}
                    >
                      {WORLD_LORE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{categoryLabels[category]}</option>
                      ))}
                    </select>
                    <input
                      value={draft.title}
                      onChange={(event) => patchDraft(index, { title: event.target.value })}
                      maxLength={120}
                      placeholder={copy.titlePlaceholder}
                      className={ui.input}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLoreDrafts(loreDrafts.filter((_, draftIndex) => draftIndex !== index))
                      }
                      title={copy.remove}
                      aria-label={copy.remove}
                      className="shrink-0 rounded p-1 text-stone-500 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={draft.body}
                    onChange={(event) => patchDraft(index, { body: event.target.value })}
                    rows={2}
                    maxLength={4000}
                    placeholder={copy.bodyPlaceholder}
                    className={ui.input}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setLoreDrafts([...loreDrafts, { category: "geography", title: "", body: "" }])
                }
                className="flex items-center gap-1 rounded border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900"
              >
                <Plus className="size-3" /> {copy.addLore}
              </button>
            </div>
            <span className="mt-1 block text-xs text-stone-500">{copy.loreHelp}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
