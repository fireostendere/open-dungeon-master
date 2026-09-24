"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Loader2, Plus, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { TargetParty } from "@/lib/workshop/kind";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The Party system (docs/workshop-parity-audit.md phase 15): the party a
// workshop is built for, already declared in the pinned bar above, and the
// pregenerated characters that stand in for players who arrive without a
// sheet. A pregen is one of the DM's own library characters filed under
// this workshop; it is built and edited where every character is, and it
// travels in the bundle.

type Pregen = {
  id: string;
  name: string;
  role: "pc" | "companion";
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
};

type LibraryEntry = Pregen & { workshopId: string };

const chip = "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]";

function describe(character: Pregen, level: string): string {
  const parts = [character.race, character.class];
  if (character.subclass) {
    parts.push(`(${character.subclass})`);
  }
  return `${level} ${character.level} ${parts.filter(Boolean).join(" ")}`;
}

export function PartyPanel({
  workshopId,
  targetParty,
  onChanged,
}: {
  workshopId: string;
  targetParty: TargetParty;
  onChanged: () => void;
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { level: "Level", companion: "Companion", reading: "Reading the roster...", add: "Add to the roster", library: "A character from your library", from: "From your library...", addIt: "Add it", build: "Build a new one", none: "No pregens yet. Pick one from your library below, or build one and come back." }, ru: { level: "Уровень", companion: "Спутник", reading: "Загрузка списка...", add: "Добавить в список", library: "Персонаж из вашей библиотеки", from: "Из вашей библиотеки...", addIt: "Добавить", build: "Создать нового", none: "Пока нет готовых персонажей. Выберите одного из библиотеки ниже или создайте нового." } });
  const intro = localeText(locale, { en: "Built for {size} at level {level}; every encounter and odds preview budgets against that. The characters below are pregens: sheets ready for anyone who sits down without one. They ride along in the bundle.", ru: "Подготовлено для группы из {size} персонажей уровня {level}; все встречи и прогнозы шансов рассчитываются по ней. Ниже — готовые персонажи для тех, кто приходит без листа. Они входят в набор." });
  const [pregens, setPregens] = useState<Pregen[] | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Bumped after a change so the roster and the library are read again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/workshops/${workshopId}/pregens`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/characters").then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([roster, shelf]) => {
        if (cancelled) {
          return;
        }
        if (roster?.pregens) {
          setPregens(roster.pregens);
        }
        if (shelf?.characters) {
          setLibrary(shelf.characters);
        }
      })
      .catch(() => {
        // transient; the next action reloads
      });
    return () => {
      cancelled = true;
    };
  }, [workshopId, version]);

  async function change(method: "POST" | "DELETE", characterId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/workshops/${workshopId}/pregens`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not work.");
        return;
      }
      setPregens((payload as { pregens: Pregen[] }).pregens);
      setPicked("");
      setVersion((current) => current + 1);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const rostered = new Set((pregens ?? []).map((character) => character.id));
  const available = library.filter((character) => !rostered.has(character.id));

  return (
    <section className="space-y-4">
      <p className="text-sm text-stone-400">
        {intro.replace("{size}", String(targetParty.size)).replace("{level}", String(targetParty.level))}
      </p>

      {pregens === null ? (
        <p className="flex items-center gap-1 text-[11px] text-stone-500">
          <Loader2 className="size-3 animate-spin" /> {copy.reading}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-tour="party-roster">
          {pregens.map((character) => {
            const offLevel = character.level !== targetParty.level;
            return (
              <li key={character.id} className={cn(ui.card, "flex items-start gap-3 p-3")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-700 text-stone-400">
                  <UserRound className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/characters/${character.id}`}
                    className="font-display tracking-wide text-amber-50 hover:text-amber-200"
                  >
                    {character.name}
                  </Link>
                  <span className="block text-sm text-stone-400">{describe(character, copy.level)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {character.role === "companion" ? (
                      <span className={cn(chip, "border-stone-700 text-stone-400")}>{copy.companion}</span>
                    ) : null}
                    {offLevel ? (
                      <span className={cn(chip, "border-amber-800 text-amber-300/90")}>
                        {uiText("Level")} {character.level}{uiText(", the party is built for")} {targetParty.level}
                      </span>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change("DELETE", character.id)}
                  title={uiText("Take it off the roster. It stays in your library.")}
                  className="rounded-md border border-stone-700 p-1 text-stone-400 hover:bg-stone-900 disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
          {pregens.length === 0 ? (
            <li className="text-[11px] italic text-stone-600 sm:col-span-2">
              {copy.none}
            </li>
          ) : null}
        </ul>
      )}

      <div className={cn(ui.card, "space-y-2 p-3")} data-tour="party-add">
        <span className="text-[11px] uppercase tracking-wide text-stone-500">{copy.add}</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            aria-label={copy.library}
            className={`${ui.input} w-auto min-w-48 py-1 pr-7`}
          >
            <option value="">{copy.from}</option>
            {available.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}, {describe(character, copy.level).toLowerCase()}
                {character.workshopId && character.workshopId !== workshopId ? uiText(" (in another workshop)") : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !picked}
            onClick={() => void change("POST", picked)}
            className={ui.btnPrimary}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {copy.addIt}
          </button>
          <Link href="/characters/new" className={ui.btnSecondary}>
            {copy.build}
          </Link>
        </div>
        {available.length === 0 && library.length > 0 ? (
          <p className="text-[11px] text-stone-500">{uiText("Every character in your library is already on the roster.")}</p>
        ) : null}
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      </div>
    </section>
  );
}
