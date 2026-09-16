"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { TEMPLATE_NAME_MAX } from "@/lib/dm/encounter-template-logic";
import { MonsterRosterPicker } from "@/app/campaigns/[campaignId]/MonsterRosterPicker";
import { EncounterExtras } from "@/app/workshop/encounters/EncounterExtras";
import type { EncounterDraft, MapOption } from "@/app/workshop/encounters/types";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The prepared-encounter form: a name, the roster (picked or typed), where it
// happens, which map, and the notes. Split out of DmEncounterPrepPanel so
// the workshop can show the same fields in a sheet over a row; the "card"
// variant is byte-for-byte what the DM console has always shown under its
// list, and the "sheet" variant is the same fields without the frame,
// because the sheet is the frame.

const field =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200";

export function EncounterForm({
  campaignId,
  value,
  onChange,
  maps,
  busy,
  submitLabel,
  onSubmit,
  variant = "card",
}: {
  campaignId: string;
  value: EncounterDraft;
  onChange: (next: EncounterDraft) => void;
  maps: MapOption[];
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  variant?: "card" | "sheet";
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { name: "Encounter name", roster: "Roster", battle: "Battlefield", map: "On which map", generator: "Generator's choice", notes: "Notes", note: "One per line, name or slug, optional xN. Picking above and typing here are the same thing." }, ru: { name: "Название встречи", roster: "Состав", battle: "Поле боя", map: "На какой карте", generator: "Выбор генератора", notes: "Заметки", note: "По одному в строке: имя или идентификатор, можно xN. Выбор выше и ввод здесь означают одно и то же." }, pl: { name: "Nazwa spotkania", roster: "Skład", battle: "Pole bitwy", map: "Na której mapie", generator: "Wybór generatora", notes: "Notatki", note: "Po jednym w wierszu: nazwa lub identyfikator, opcjonalnie xN. Wybór powyżej i wpisywanie tutaj działają tak samo." } });
  const set = (patch: Partial<EncounterDraft>) => onChange({ ...value, ...patch });
  return (
    <section
      className={cn(
        variant === "card"
          ? "space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2"
          : "space-y-2",
      )}
    >
      <input
        value={value.name}
        maxLength={TEMPLATE_NAME_MAX}
        onChange={(event) => set({ name: event.target.value })}
        placeholder="Ambush at the ford"
        aria-label={copy.name}
        className={field}
      />
      <div data-tour="encounters-picker">
        <MonsterRosterPicker
          campaignId={campaignId}
          roster={value.enemies}
          onChange={(enemies) => set({ enemies })}
        />
      </div>
      <textarea
        value={value.enemies}
        onChange={(event) => set({ enemies: event.target.value })}
        rows={3}
        placeholder={"goblin x4\nhobgoblin"}
        aria-label={copy.roster}
        className={field}
      />
      <p className="text-[10px] text-stone-600">
        {copy.note}
      </p>
      <input
        value={value.battlefield}
        onChange={(event) => set({ battlefield: event.target.value })}
        placeholder="a rope bridge over a gorge"
        aria-label={copy.battle}
        className={field}
      />
      <label className="block" data-tour="encounters-map">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">{copy.map}</span>
        <select
          value={value.mapId}
          onChange={(event) => set({ mapId: event.target.value })}
          className={cn(field, "mt-0.5")}
        >
          <option value="">{copy.generator}</option>
          {maps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.name}
            </option>
          ))}
        </select>
      </label>
      <EncounterExtras
        campaignId={campaignId}
        roster={value.enemies}
        map={maps.find((map) => map.id === value.mapId) ?? null}
        value={value.extras}
        onChange={(extras) => set({ extras })}
      />
      <textarea
        value={value.notes}
        onChange={(event) => set({ notes: event.target.value })}
        rows={2}
        placeholder="Tactics, what they want, when they run."
        aria-label={copy.notes}
        className={field}
      />
      <button
        type="button"
        disabled={busy || !value.name.trim() || !value.enemies.trim()}
        onClick={onSubmit}
        data-tour="encounters-save"
        className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        {submitLabel}
      </button>
    </section>
  );
}
