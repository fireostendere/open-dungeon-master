"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { describeHomebrew } from "@/lib/homebrew/gear";
import type { VariantRules } from "@/lib/rulesets/logic";
import { Sheet } from "@/components/ui/Sheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTourPrepare } from "@/lib/tours/prepare";
import { HomebrewEditor } from "@/app/workshop/homebrew/HomebrewEditor";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import { blankDraft, type HomebrewDraft } from "@/app/workshop/homebrew/draft";
import {
  HOMEBREW_EDITOR_KINDS,
  type EditorKind,
  type HomebrewEntryView,
} from "@/app/workshop/homebrew/types";

// The Homebrew system: the user's items, spells and character options, one
// kind at a time, with the editor in a sheet. User-scoped like the bestiary,
// so an item written in one workshop is there in the next; nothing here
// needs importing into a campaign because every picker already searches it.

export function HomebrewPanel({
  variantRules,
  onChanged,
}: {
  variantRules: Partial<VariantRules>;
  onChanged?: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      kind: "Kind of homebrew",
      search: "Search your {kind}",
      empty: "Nothing of your own yet. Start from something in the books and change what you like.",
      noMatch: "Nothing by that name.",
      kindPlural: { item: "Items", spell: "Spells", feat: "Feats", background: "Backgrounds", race: "Species", archetype: "Subclasses" },
      kindSingular: { item: "item", spell: "spell", feat: "feat", background: "background", race: "species", archetype: "subclass" },
      newKind: { item: "New item", spell: "New spell", feat: "New feat", background: "New background", race: "New species", archetype: "New subclass" },
      kindBlurb: {
        item: "Weapons the attack roll reads, armour the AC engine wears, magic items whose effects apply while attuned.",
        spell: "Spells the cast tools resolve: the save, the damage and the condition come from the block, not from memory.",
        feat: "Feats the character builder offers beside the SRD ones.",
        background: "Backgrounds the builder offers, with the skills they grant.",
        race: "Species the builder offers, with their speed and ability bonuses.",
        archetype: "Subclasses the builder offers under a class, with their features by level.",
      },
    },
    ru: {
      kind: "Тип хоумбрю",
      search: "Поиск: {kind}",
      empty: "Пока нет ваших материалов. Начните с чего-то из книг и измените как хотите.",
      noMatch: "Ничего с таким названием нет.",
      kindPlural: { item: "Предметы", spell: "Заклинания", feat: "Черты", background: "Предыстории", race: "Происхождения", archetype: "Подклассы" },
      kindSingular: { item: "предмет", spell: "заклинание", feat: "черта", background: "предыстория", race: "происхождение", archetype: "подкласс" },
      newKind: { item: "Новый предмет", spell: "Новое заклинание", feat: "Новая черта", background: "Новая предыстория", race: "Новое происхождение", archetype: "Новый подкласс" },
      kindBlurb: {
        item: "Оружие используется при броске атаки, доспехи влияют на КД, а магические предметы дают эффекты при настройке.",
        spell: "Движок разрешает сотворение заклинания по его описанию: спасбросок, урон и состояние берутся из записи.",
        feat: "Черты, которые конструктор персонажа предлагает наряду с вариантами SRD.",
        background: "Предыстории, доступные в конструкторе персонажа, с предоставляемыми навыками.",
        race: "Происхождения из конструктора персонажа с указанными скоростью и бонусами характеристик.",
        archetype: "Подклассы для каждого класса и их умения по уровням.",
      },
    },
  });
  const [entries, setEntries] = useState<HomebrewEntryView[]>([]);
  const [kind, setKind] = useState<EditorKind>("item");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: HomebrewDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The tour's "open the editor" step.
  useTourPrepare((name) => {
    if (name === "open-homebrew-editor" && !editing) {
      setError("");
      setEditing({ id: null, draft: blankDraft(kind) });
    }
  });

  const load = useCallback(
    () =>
      fetch("/api/homebrew")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { entries?: HomebrewEntryView[] } | null) => {
          if (payload?.entries) {
            setEntries(payload.entries.filter((entry) => entry.kind !== "monster"));
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const ofKind = entries.filter((entry) => entry.kind === kind);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? ofKind.filter((entry) =>
        [entry.name, String(entry.data.desc ?? ""), describeHomebrew(entry.kind, entry.data)].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : ofKind;
  const kindSearch = copy.search.replace("{kind}", copy.kindPlural[kind].toLowerCase());

  function open(entry: HomebrewEntryView) {
    setError("");
    setEditing({ id: entry.id, draft: { kind: entry.kind as EditorKind, name: entry.name, data: entry.data } });
  }

  async function save() {
    if (!editing) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { id, draft } = editing;
      const response = await fetch(id ? `/api/homebrew/${id}` : "/api/homebrew", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          id ? { name: draft.name.trim(), data: draft.data } : { kind: draft.kind, name: draft.name.trim(), data: draft.data },
        ),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That was refused.");
        return;
      }
      await load();
      onChanged?.();
      const saved = (payload as { entry?: HomebrewEntryView }).entry;
      setEditing(saved ? { id: saved.id, draft: { kind: saved.kind as EditorKind, name: saved.name, data: saved.data } } : null);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!editing?.id) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { draft } = editing;
      const response = await fetch("/api/homebrew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: draft.kind, name: `${draft.name} (copy)`.slice(0, 80), data: draft.data }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "The copy was refused.");
        return;
      }
      await load();
      onChanged?.();
      const saved = (payload as { entry?: HomebrewEntryView }).entry;
      if (saved) {
        setEditing({ id: saved.id, draft: { kind: saved.kind as EditorKind, name: saved.name, data: saved.data } });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing?.id) {
      return;
    }
    if (!window.confirm(`Forget "${editing.draft.name}"? Sheets that carry it keep their last copy of it.`)) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/homebrew/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div data-tour="homebrew-kinds" className="w-fit max-w-full">
        <SegmentedControl
          options={HOMEBREW_EDITOR_KINDS.map((value) => ({
            value,
            label: `${copy.kindPlural[value]}${entries.some((entry) => entry.kind === value) ? ` ${entries.filter((entry) => entry.kind === value).length}` : ""}`,
          }))}
          value={kind}
          onChange={setKind}
          size="sm"
          label={copy.kind}
        />
      </div>

      <p className="text-[11px] text-stone-500">{copy.kindBlurb[kind]}</p>

      <label className="relative block" data-tour="homebrew-search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kindSearch}
          aria-label={kindSearch}
          className={`${ui.input} pl-9`}
        />
      </label>

      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => open(entry)}
              className={cn(
                ui.cardHover,
                "flex h-full w-full flex-col gap-1 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              )}
            >
              <span className="font-display tracking-wide text-amber-50">{entry.name}</span>
              <span className="line-clamp-1 text-[11px] text-stone-400">{describeHomebrew(entry.kind, entry.data)}</span>
              {entry.data.desc ? (
                <span className="line-clamp-1 text-sm text-stone-300">{String(entry.data.desc)}</span>
              ) : null}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              setError("");
              setEditing({ id: null, draft: blankDraft(kind) });
            }}
            data-tour="homebrew-new"
            className={cn(
              ui.cardHover,
              "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-600">
              <Plus className="size-4" />
            </span>
            <span className="font-display tracking-wide">{copy.newKind[kind]}</span>
          </button>
        </li>
      </ul>

      {ofKind.length === 0 ? (
        <p className="text-[11px] italic text-stone-600">
          {copy.empty}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-stone-500">{copy.noMatch}</p>
      ) : null}

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        title={editing?.id ? editing.draft.name || copy.kindSingular[kind] : copy.newKind[editing?.draft.kind ?? kind]}
        className="top-0 h-dvh max-h-none rounded-none lg:top-1/2 lg:h-auto lg:max-h-[92vh] lg:w-[min(96vw,56rem)] lg:rounded-xl"
      >
        {editing ? (
          <div className="overflow-y-auto pb-2">
            <HomebrewEditor
              draft={editing.draft}
              isNew={editing.id === null}
              busy={busy}
              error={error}
              variantRules={variantRules}
              onDraft={(draft) => setEditing({ ...editing, draft })}
              onSave={() => void save()}
              onDuplicate={() => void duplicate()}
              onDelete={() => void remove()}
            />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
