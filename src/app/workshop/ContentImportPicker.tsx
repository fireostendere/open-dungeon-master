"use client";

import { AlertTriangle, Hammer, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  IMPORT_KINDS,
  SINGULAR_KINDS,
  type ImportKind,
  type ImportPlan,
  type ImportWarning,
} from "@/lib/workshop/import";
import type { ImportSourceSummary } from "@/app/workshop/types";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    empty:
      "You have nothing to copy from yet. Build maps, lore and encounters in the Workshop, or run a campaign, and you can bring any of it straight in here.",
    startFrom: "Start from",
    none: "None",
    workshops: "Workshops",
    campaigns: "Campaigns",
    existingRules: "Existing house rules",
    replaceRules: "Replace them",
    appendRules: "Keep them and add these",
    importButton: "Bring it in",
    importFailed: "Could not import.",
    imported: "Brought {count} item(s) across.",
    afterCreate:
      "This lands in the campaign right after it is created. Nothing is removed from where it came from.",
    emptyWorkshop: "That workshop is still empty. Build something in it first.",
    emptyCampaign: "That campaign has no prep to copy yet.",
    lore: "World lore",
    locations: "Places",
    overworld: "Region map",
    encounters: "Prepared encounters",
    tables: "Roll tables",
    npcs: "NPCs",
    maps: "Battle maps",
    storyboard: "The storyboard",
    houseRules: "House rules and variant rules",
    warnRules:
      "This campaign already has house rules. Importing replaces them unless you choose to add.",
    warnStoryboard:
      "This campaign already has a story arc. Places, quests, fights and notes still import, but storyboard beats do not overwrite the active story spine.",
    warnMapReplace: "This campaign already has a region map. Importing replaces it.",
    warnMapMarkers:
      "Places are not included, so the region map arrives without its markers and will place them again as the party travels.",
    warnRenamed: "{count} {kind} entries already exist by name and will be numbered.",
    warnHomebrew:
      "{count} prepared encounters reference hand-built monsters. Those monsters stay in their creator's bestiary, so they resolve only when the campaign owner is the same builder.",
    warnGeneric: "This import changes or conflicts with content already in the campaign.",
  },
  ru: {
    empty:
      "Пока неоткуда копировать. Подготовьте карты, лор и встречи в Мастерской или проведите другую кампанию — затем их можно будет импортировать сюда.",
    startFrom: "Источник",
    none: "Нет",
    workshops: "Мастерские",
    campaigns: "Кампании",
    existingRules: "Существующие домашние правила",
    replaceRules: "Заменить их",
    appendRules: "Сохранить и добавить новые",
    importButton: "Импортировать",
    importFailed: "Не удалось импортировать.",
    imported: "Импортировано элементов: {count}.",
    afterCreate:
      "Данные будут добавлены в кампанию сразу после её создания. В исходном месте ничего не удаляется.",
    emptyWorkshop: "Эта мастерская пока пуста. Сначала подготовьте в ней контент.",
    emptyCampaign: "В этой кампании пока нет подготовки для копирования.",
    lore: "Лор мира",
    locations: "Места",
    overworld: "Карта региона",
    encounters: "Подготовленные встречи",
    tables: "Таблицы бросков",
    npcs: "NPC",
    maps: "Боевые карты",
    storyboard: "Сюжетная доска",
    houseRules: "Домашние и вариантные правила",
    warnRules:
      "В кампании уже есть домашние правила. При импорте они будут заменены, если не выбрать добавление.",
    warnStoryboard:
      "В кампании уже есть сюжетная арка. Места, квесты, бои и заметки импортируются, но эпизоды доски не заменят активную основу сюжета.",
    warnMapReplace: "В кампании уже есть карта региона. Импорт заменит её.",
    warnMapMarkers:
      "Места не выбраны для импорта, поэтому карта региона придёт без маркеров и расставит их заново по мере путешествия партии.",
    warnRenamed: "Совпадающих по имени записей «{kind}»: {count}. Они будут пронумерованы.",
    warnHomebrew:
      "Подготовленных встреч с созданными вручную монстрами: {count}. Такие монстры остаются в бестиарии автора и разрешаются только когда владелец кампании — тот же создатель.",
    warnGeneric: "Импорт изменяет или конфликтует с данными, уже существующими в кампании.",
  },
  pl: {
    empty:
      "Na razie nie ma skąd kopiować. Przygotuj mapy, lore i spotkania w Warsztacie albo poprowadź inną kampanię, a potem zaimportuj je tutaj.",
    startFrom: "Źródło",
    none: "Brak",
    workshops: "Warsztaty",
    campaigns: "Kampanie",
    existingRules: "Istniejące zasady domowe",
    replaceRules: "Zastąp je",
    appendRules: "Zachowaj je i dodaj nowe",
    importButton: "Importuj",
    importFailed: "Nie udało się zaimportować.",
    imported: "Zaimportowano elementów: {count}.",
    afterCreate:
      "Dane trafią do kampanii tuż po jej utworzeniu. Nic nie zostanie usunięte ze źródła.",
    emptyWorkshop: "Ten warsztat jest jeszcze pusty. Najpierw przygotuj w nim zawartość.",
    emptyCampaign: "Ta kampania nie ma jeszcze przygotowania do skopiowania.",
    lore: "Lore świata",
    locations: "Miejsca",
    overworld: "Mapa regionu",
    encounters: "Przygotowane spotkania",
    tables: "Tabele rzutów",
    npcs: "NPC",
    maps: "Mapy bitewne",
    storyboard: "Tablica fabularna",
    houseRules: "Zasady domowe i wariantowe",
    warnRules:
      "Kampania ma już zasady domowe. Import je zastąpi, chyba że wybierzesz dodawanie.",
    warnStoryboard:
      "Kampania ma już łuk fabularny. Miejsca, zadania, walki i notatki zostaną zaimportowane, ale punkty tablicy nie zastąpią aktywnego kręgosłupa historii.",
    warnMapReplace: "Kampania ma już mapę regionu. Import ją zastąpi.",
    warnMapMarkers:
      "Miejsca nie są importowane, więc mapa regionu trafi bez znaczników i doda je ponownie podczas podróży drużyny.",
    warnRenamed: "Wpisów „{kind}” o istniejących już nazwach: {count}. Zostaną ponumerowane.",
    warnHomebrew:
      "Przygotowanych spotkań korzystających z ręcznie tworzonych potworów: {count}. Te potwory pozostają w bestiariuszu autora i zadziałają tylko wtedy, gdy właściciel kampanii jest tym samym twórcą.",
    warnGeneric: "Import zmienia dane już istniejące w kampanii albo wchodzi z nimi w konflikt.",
  },
} as const;

export type ImportSelection = {
  sourceId: string;
  select: ImportKind[];
  houseRules: "replace" | "append";
};

export const EMPTY_SELECTION: ImportSelection = {
  sourceId: "",
  select: [],
  houseRules: "replace",
};

export function ContentImportPicker({
  campaignId,
  selection,
  onChange,
  onImported,
}: {
  campaignId?: string;
  selection: ImportSelection;
  onChange: (selection: ImportSelection) => void;
  onImported?: (copied: number) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const kindLabels: Record<ImportKind, string> = {
    lore: copy.lore,
    locations: copy.locations,
    overworld: copy.overworld,
    encounters: copy.encounters,
    tables: copy.tables,
    npcs: copy.npcs,
    maps: copy.maps,
    storyboard: copy.storyboard,
    houseRules: copy.houseRules,
  };
  const [sources, setSources] = useState<ImportSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import-sources")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setSources(data.sources ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const offered = sources.filter((source) => source.id !== campaignId);
  const workshops = offered.filter((source) => source.kind === "workshop");
  const campaigns = offered.filter((source) => source.kind !== "workshop");
  const chosen = offered.find((source) => source.id === selection.sourceId) ?? null;
  const available = chosen
    ? IMPORT_KINDS.filter((kind) => (chosen.contents?.[kind] ?? 0) > 0)
    : [];

  const refreshPlan = useCallback(() => {
    if (!campaignId || !selection.sourceId || !selection.select.length) {
      return Promise.resolve().then(() => setPlan(null));
    }
    const params = new URLSearchParams({ sourceId: selection.sourceId });
    for (const kind of selection.select) params.append("select", kind);
    return fetch(`/api/campaigns/${campaignId}/import?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setPlan(data?.plan ?? null))
      .catch(() => undefined);
  }, [campaignId, selection.sourceId, selection.select]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  function choose(source: ImportSourceSummary | null) {
    if (!source) {
      onChange(EMPTY_SELECTION);
      return;
    }
    onChange({
      ...selection,
      sourceId: source.id,
      select: IMPORT_KINDS.filter((kind) => (source.contents?.[kind] ?? 0) > 0),
    });
  }

  function toggle(kind: ImportKind) {
    onChange({
      ...selection,
      select: selection.select.includes(kind)
        ? selection.select.filter((entry) => entry !== kind)
        : [...selection.select, kind],
    });
  }

  function warningText(warning: ImportWarning): string {
    if (warning.kind === "houseRules") return copy.warnRules;
    if (warning.kind === "storyboard") return copy.warnStoryboard;
    if (warning.kind === "overworld") {
      return warning.message.includes("markers") ? copy.warnMapMarkers : copy.warnMapReplace;
    }
    const count = warning.message.match(/^\d+/)?.[0] ?? "";
    if (warning.kind === "encounters" && warning.message.includes("hand-built")) {
      return copy.warnHomebrew.replace("{count}", count || "?");
    }
    if (warning.message.includes("will be numbered")) {
      return copy.warnRenamed
        .replace("{count}", count || "?")
        .replace("{kind}", kindLabels[warning.kind]);
    }
    return copy.warnGeneric;
  }

  async function importNow() {
    if (!campaignId || !selection.sourceId || !selection.select.length) return;
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote(copy.importFailed);
        return;
      }
      setNote(copy.imported.replace("{count}", String(data.copied ?? 0)));
      onChange({ ...selection, select: [] });
      onImported?.(data.copied ?? 0);
      await refreshPlan();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader2 className="size-4 animate-spin text-stone-500" />;
  if (!offered.length) return <p className="text-xs text-stone-500">{copy.empty}</p>;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs text-stone-400">{copy.startFrom}</span>
        <select
          value={selection.sourceId}
          onChange={(event) =>
            choose(offered.find((source) => source.id === event.target.value) ?? null)
          }
          className={ui.input}
        >
          <option value="">{copy.none}</option>
          {workshops.length ? (
            <optgroup label={copy.workshops}>
              {workshops.map((source) => (
                <option key={source.id} value={source.id}>{source.title}</option>
              ))}
            </optgroup>
          ) : null}
          {campaigns.length ? (
            <optgroup label={copy.campaigns}>
              {campaigns.map((source) => (
                <option key={source.id} value={source.id}>{source.title}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      {chosen ? (
        available.length ? (
          <>
            <div className="space-y-1">
              {available.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={selection.select.includes(kind)}
                    onChange={() => toggle(kind)}
                    className="accent-amber-400"
                  />
                  <span>{kindLabels[kind]}</span>
                  {SINGULAR_KINDS.has(kind) ? null : (
                    <span className="text-xs text-stone-500">({chosen.contents[kind]})</span>
                  )}
                </label>
              ))}
            </div>

            {selection.select.includes("houseRules") ? (
              <label className="block">
                <span className="mb-1 block text-xs text-stone-400">{copy.existingRules}</span>
                <select
                  value={selection.houseRules}
                  onChange={(event) =>
                    onChange({
                      ...selection,
                      houseRules: event.target.value as "replace" | "append",
                    })
                  }
                  className={cn(ui.input, "py-1 text-xs")}
                >
                  <option value="replace">{copy.replaceRules}</option>
                  <option value="append">{copy.appendRules}</option>
                </select>
              </label>
            ) : null}

            {plan?.warnings.length ? (
              <ul className="space-y-1">
                {plan.warnings.map((warning, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-xs text-amber-300/90">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{warningText(warning)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {campaignId ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={importNow}
                  disabled={busy || !selection.select.length}
                  className={ui.btnSmall}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />}
                  {copy.importButton}
                </button>
                {note ? <span className="text-xs text-emerald-400">{note}</span> : null}
              </div>
            ) : (
              <p className="text-xs text-stone-500">{copy.afterCreate}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-stone-500">
            {chosen.kind === "workshop" ? copy.emptyWorkshop : copy.emptyCampaign}
          </p>
        )
      ) : null}
    </div>
  );
}

export async function submitContentImport(campaignId: string, selection: ImportSelection) {
  if (!selection.sourceId || !selection.select.length) return;
  await fetch(`/api/campaigns/${campaignId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  }).catch(() => undefined);
}
