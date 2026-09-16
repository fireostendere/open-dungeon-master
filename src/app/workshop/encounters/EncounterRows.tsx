"use client";

import { Copy, Map as MapIcon, Plus, Swords, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { formatRoster } from "@/lib/dm/encounter-template-logic";
import { budgetBarGeometry, type Thresholds } from "@/app/workshop/encounters/budget-bar";
import type { MapOption, PreparedEncounter, TemplateReadout } from "@/app/workshop/encounters/types";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The workshop's encounter list: one full-width row per prepared fight with
// what matters at a glance (the roster, where it happens, which map, and how
// hard it is), a CR budget bar under it, and the three things you can do to
// it without opening it. Tapping the row hands it to the caller, which opens
// the editor.
//
// The bar is drawn from the server's readout and the party thresholds the
// caller passes in; nothing here re-derives difficulty. The numbers are
// printed under the bar as well, because a bar a DM cannot read the value
// off is decoration.

// One tone per DMG band, matched against the readout's verdict text
// ("hard for this party"), which is the engine's own word for it.
const TONES: Array<{ match: RegExp; pill: string; bar: string }> = [
  {
    match: /^trivial/,
    pill: "border-stone-600/60 bg-stone-800/60 text-stone-400",
    bar: "bg-stone-500",
  },
  {
    match: /^easy/,
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    bar: "bg-emerald-400",
  },
  {
    match: /^medium/,
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    bar: "bg-amber-300",
  },
  {
    match: /^hard/,
    pill: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    bar: "bg-orange-400",
  },
  {
    match: /^(deadly|beyond deadly)/,
    pill: "border-red-500/40 bg-red-500/10 text-red-300",
    bar: "bg-red-400",
  },
];

function toneFor(verdict: string) {
  return (
    TONES.find((tone) => tone.match.test(verdict)) ?? {
      pill: "border-stone-600/60 bg-stone-800/60 text-stone-400",
      bar: "bg-stone-500",
    }
  );
}

export function DifficultyPill({ readout }: { readout: TemplateReadout }) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { unknown: "unknown monster", trivial: "trivial", easy: "easy", medium: "medium", hard: "hard", deadly: "deadly", beyond: "beyond deadly" }, ru: { unknown: "неизвестный монстр", trivial: "ничтожная", easy: "лёгкая", medium: "средняя", hard: "тяжёлая", deadly: "смертельная", beyond: "запредельно смертельная" }, pl: { unknown: "nieznany potwór", trivial: "błaha", easy: "łatwa", medium: "średnia", hard: "trudna", deadly: "zabójcza", beyond: "ponad zabójcza" } });
  const verdict = readout.verdict.replace(/ for this party$/, "");
  const display = (verdict === "beyond deadly" ? copy.beyond : copy[verdict as "trivial" | "easy" | "medium" | "hard" | "deadly"]) ?? verdict;
  if (readout.unknownMonster) {
    return (
      <span className="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-300">
        {copy.unknown}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
        toneFor(readout.verdict).pill,
      )}
    >
      {display}
    </span>
  );
}

export function BudgetBar({
  readout,
  thresholds,
}: {
  readout: TemplateReadout;
  thresholds: Thresholds | null;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { cannot: "Nothing in this world is called", costed: "so this cannot be costed.", adjusted: "adjusted XP against a", ceiling: "ceiling", creature: "creature", creatures: "creatures", against: "XP against a", easy: "Easy", medium: "medium", hard: "hard", deadly: "deadly", refuse: "The engine will refuse this as written." }, ru: { cannot: "В этом мире нет существа с именем", costed: "поэтому оценить его нельзя.", adjusted: "скорректированный опыт против лимита", ceiling: "лимит", creature: "существо", creatures: "существ", against: "ОП против лимита", easy: "Лёгкая", medium: "средняя", hard: "тяжёлая", deadly: "смертельная", refuse: "Движок отклонит встречу в таком виде." }, pl: { cannot: "W tym świecie nie ma stworzenia o nazwie", costed: "więc nie można go wycenić.", adjusted: "skorygowane PD wobec limitu", ceiling: "limit", creature: "stworzenie", creatures: "stworzeń", against: "PD wobec limitu", easy: "Łatwa", medium: "średnia", hard: "trudna", deadly: "zabójcza", refuse: "Silnik odrzuci spotkanie w tej postaci." } });
  if (readout.unknownMonster) {
    return (
      <p className="text-[11px] text-red-400">
        {copy.cannot} &quot;{readout.unknownMonster}&quot;, {copy.costed}
      </p>
    );
  }
  const geometry = budgetBarGeometry({
    adjustedXp: readout.adjustedXp,
    ceiling: readout.ceiling,
    thresholds,
  });
  const tone = toneFor(readout.verdict);
  return (
    <div className="space-y-1">
      <div
        className="relative h-1.5 w-full rounded-full bg-stone-800"
        role="img"
        aria-label={`${readout.adjustedXp} ${copy.adjusted} ${readout.ceiling} ${copy.ceiling}`}
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", tone.bar)}
          style={{ width: `${geometry.fillPercent}%` }}
        />
        {geometry.ticks.map((tick) => (
          <span
            key={tick.label}
            title={tick.label}
            aria-hidden="true"
            className={cn(
              "absolute -top-0.5 h-2.5 w-px",
              tick.label === "ceiling" ? "bg-red-400/70" : "bg-stone-500",
            )}
            style={{ left: `${tick.percent}%` }}
          />
        ))}
      </div>
      <p className={cn("text-[10px]", readout.tooDeadly ? "text-red-400" : "text-stone-500")}>
        {readout.count} {readout.count === 1 ? copy.creature : copy.creatures}, {readout.adjustedXp} {copy.against} {readout.ceiling} {copy.ceiling}
        {thresholds
          ? `. ${copy.easy} ${thresholds.easy}, ${copy.medium} ${thresholds.medium}, ${copy.hard} ${thresholds.hard}, ${copy.deadly} ${thresholds.deadly}.`
          : "."}
        {readout.tooDeadly ? ` ${copy.refuse}` : ""}
      </p>
    </div>
  );
}

const rowAction =
  "inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40";

export function EncounterRows({
  encounters,
  maps,
  thresholds,
  busy,
  onOpen,
  onDeploy,
  onDuplicate,
  onDelete,
}: {
  encounters: PreparedEncounter[];
  maps: MapOption[];
  thresholds: Thresholds | null;
  busy: boolean;
  onOpen: (encounter: PreparedEncounter | null) => void;
  onDeploy: (encounter: PreparedEncounter) => void;
  onDuplicate: (encounter: PreparedEncounter) => void;
  onDelete: (encounter: PreparedEncounter) => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { forgotten: "a map no longer in the drawer", generator: "Generator's choice", on: "On", deploy: "Deploy", duplicate: "Duplicate", delete: "Delete", new: "New encounter", empty: "Nothing prepared. Write a roster and it is one button at the table." }, ru: { forgotten: "карта, которой больше нет в хранилище", generator: "Выбор генератора", on: "На", deploy: "Развернуть", duplicate: "Дублировать", delete: "Удалить", new: "Новая встреча", empty: "Пока ничего не подготовлено. Заполните состав — и на столе останется одна кнопка." }, pl: { forgotten: "mapa, której nie ma już w szufladzie", generator: "Wybór generatora", on: "Na", deploy: "Rozstaw", duplicate: "Duplikuj", delete: "Usuń", new: "Nowe spotkanie", empty: "Nic nie przygotowano. Wpisz skład, a przy stole będzie jeden przycisk." } });
  // A linked map that has since been forgotten still says so, rather than
  // silently reading as the generator's choice, because deploy will fall
  // back to the generator and the DM should know before the table does.
  const mapName = (encounter: PreparedEncounter) =>
    encounter.map.mapId
       ? (maps.find((map) => map.id === encounter.map.mapId)?.name ?? copy.forgotten)
       : copy.generator;

  return (
    <div className="space-y-2">
      <ul className="grid gap-3 lg:grid-cols-2" data-tour="encounters-list">
        {encounters.map((encounter) => (
          <li key={encounter.id} className={cn(ui.cardHover, "flex flex-col gap-2 p-3")}>
            <button
              type="button"
              onClick={() => onOpen(encounter)}
              className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-display tracking-wide text-amber-50">{encounter.name}</span>
                <DifficultyPill readout={encounter.readout} />
              </div>
              <p className="mt-1 text-sm text-stone-300">
                {formatRoster(encounter.enemies).replace(/\n/g, ", ")}
              </p>
              {encounter.battlefield ? (
                 <p className="truncate text-xs text-stone-500">{copy.on} {encounter.battlefield}</p>
              ) : null}
              <p className="flex items-center gap-1 truncate text-[11px] text-stone-500">
                <MapIcon className="size-3 shrink-0" aria-hidden="true" />
                {mapName(encounter)}
              </p>
            </button>
            <BudgetBar readout={encounter.readout} thresholds={thresholds} />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeploy(encounter)}
                className="inline-flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
              >
                <Swords className="size-3" /> {copy.deploy}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`${copy.duplicate} ${encounter.name}`}
                onClick={() => onDuplicate(encounter)}
                className={rowAction}
              >
                <Copy className="size-3" /> {copy.duplicate}
              </button>
              <button
                type="button"
                aria-label={`${copy.delete} ${encounter.name}`}
                onClick={() => onDelete(encounter)}
                className={cn(rowAction, "ml-auto text-stone-500 hover:text-red-300")}
              >
                <Trash2 className="size-3" /> {copy.delete}
              </button>
            </div>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => onOpen(null)}
            data-tour="encounters-new"
            className={cn(
              ui.cardHover,
              "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-600">
              <Plus className="size-4" />
            </span>
            <span className="font-display tracking-wide">{copy.new}</span>
          </button>
        </li>
      </ul>
      {encounters.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {copy.empty}
        </p>
      ) : null}
    </div>
  );
}
