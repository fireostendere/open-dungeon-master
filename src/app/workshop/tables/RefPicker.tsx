"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ROLL_REF_KINDS, type RollRefKind } from "@/lib/dm/roll-table-logic";
import type { RollTable } from "@/lib/db/roll-tables";
import { AddFromList } from "@/components/ui/AddFromList";
import { ContentPick } from "@/components/ui/ContentPick";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// A row that IS a thing: "@monster: wolf", "@table: Gems". The table body
// takes them typed, which means knowing the exact name of everything in the
// workshop. This picks instead: choose what kind of thing, then the thing
// itself from what this world actually holds (its tables, the DM's own
// monsters and the catalogue's, the content pack's items, the cast, the
// lore), and the row lands in the body.

// The painted glyph for the kind of thing a row points at. The native select
// cannot carry pictures, so the chosen kind's glyph leads the picker.
const KIND_GLYPHS: Record<RollRefKind, string> = {
  table: "system-tables",
  monster: "system-bestiary",
  item: "tab-loot",
  npc: "system-cast",
  lore: "system-lore",
};

const KIND_LABELS: Record<RollRefKind, string> = {
  table: "Another table",
  monster: "A monster",
  item: "An item",
  npc: "Someone from the cast",
  lore: "A lore entry",
};

const select =
  "rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300 focus:border-amber-500/50 focus:outline-none";

type Named = { name: string };

export function RefPicker({
  campaignId,
  tables,
  editingId,
  onInsert,
}: {
  campaignId: string;
  // The world's tables when the caller already holds them (the tables tool
  // does); otherwise read here the first time that kind is chosen.
  tables?: RollTable[];
  // The table being edited, kept out of its own list.
  editingId: string;
  onInsert: (line: string) => void;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { kind: "What kind of thing the row is", item: "Find an item to add as a row", monster: "Find a monster in the catalogue to add as a row", yours: "One of yours", add: "Add a row for", reading: "Reading...", empty: "Nothing of that kind in this workshop yet." }, ru: { kind: "Что представляет строка", item: "Найти предмет для добавления строкой", monster: "Найти монстра в каталоге для добавления строкой", yours: "Один из ваших", add: "Добавить строку для", reading: "Загрузка...", empty: "В этой мастерской пока нет ничего такого типа." } });
  const [kind, setKind] = useState<RollRefKind>("table");
  const [npcs, setNpcs] = useState<Named[] | null>(null);
  const [lore, setLore] = useState<Named[] | null>(null);
  const [monsters, setMonsters] = useState<Named[] | null>(null);
  const [fetchedTables, setFetchedTables] = useState<RollTable[] | null>(null);

  // Each list is fetched once, the first time its kind is chosen; the
  // state lands in .then so the effect reads as a subscription.
  useEffect(() => {
    if (kind === "table" && !tables && fetchedTables === null) {
      fetch(`/api/campaigns/${campaignId}/dm/roll-tables`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { tables?: RollTable[] } | null) => setFetchedTables(data?.tables ?? []))
        .catch(() => setFetchedTables([]));
    }
    if (kind === "npc" && npcs === null) {
      fetch(`/api/campaigns/${campaignId}/dm/npcs`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { npcs?: Named[] } | null) => setNpcs(data?.npcs ?? []))
        .catch(() => setNpcs([]));
    }
    if (kind === "lore" && lore === null) {
      fetch(`/api/campaigns/${campaignId}/lore`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { entries?: Array<{ title: string }> } | null) =>
          setLore((data?.entries ?? []).map((entry) => ({ name: entry.title }))),
        )
        .catch(() => setLore([]));
    }
    if (kind === "monster" && monsters === null) {
      fetch(`/api/campaigns/${campaignId}/dm/bestiary`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { monsters?: Array<{ draft: { name: string } }> } | null) =>
          setMonsters((data?.monsters ?? []).map((monster) => ({ name: monster.draft.name }))),
        )
        .catch(() => setMonsters([]));
    }
  }, [kind, campaignId, npcs, lore, monsters, tables, fetchedTables]);

  const insert = (name: string) => onInsert(`@${kind}: ${name}`);

  const listFor = (): Named[] | null => {
    switch (kind) {
      case "table":
        return (tables ?? fetchedTables)?.filter((table) => table.id !== editingId) ?? null;
      case "npc":
        return npcs;
      case "lore":
        return lore;
      case "monster":
        return monsters;
      default:
        return null;
    }
  };
  const list = listFor();

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="tables-ref">
      <GameIcon icon={{ kind: "glyph", key: KIND_GLYPHS[kind] }} size="size-6" />
      <select
        value={kind}
        aria-label={copy.kind}
        onChange={(event) => setKind(event.target.value as RollRefKind)}
        className={select}
      >
        {ROLL_REF_KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABELS[option]}
          </option>
        ))}
      </select>
      {kind === "item" ? (
        <ContentPick
          kind="items"
          label={copy.item}
          placeholder={uiText("Potion of Healing")}
          onPick={(entry) => insert(entry.name)}
          className="min-w-44 flex-1"
        />
      ) : kind === "monster" ? (
        <>
          <AddFromList
            prompt={copy.yours}
            options={(list ?? []).map((entry) => entry.name)}
            onPick={insert}
          />
          <ContentPick
            kind="monsters"
            label={copy.monster}
            placeholder={uiText("wolf")}
            onPick={(entry) => insert(entry.name)}
            className="min-w-44 flex-1"
          />
        </>
      ) : list && list.length ? (
        <AddFromList
          prompt={copy.add}
          options={list.map((entry) => entry.name)}
          onPick={insert}
          className={cn("min-w-44")}
        />
      ) : (
        <span className="text-[11px] text-stone-600">
          {list === null ? copy.reading : copy.empty}
        </span>
      )}
    </div>
  );
}
