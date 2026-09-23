"use client";

import { Loader2, Save } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { CharacterPortrait, ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";
import { AppHomeLogo } from "@/components/AccountMenu";
import type { CreateSheetInput } from "@/lib/schemas/sheet";

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
  sheet: CreateSheetInput;
};

export default function EditCharacterPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = use(params);
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      back: "Back to character",
      title: "Edit backstory",
      subtitle: "Describe your hero's origins, personality, and motivations.",
      placeholder: "Write your character's backstory here...",
      level: "Level",
      cancel: "Cancel",
      save: "Save backstory",
      saving: "Saving...",
      saveFailed: "Could not save backstory.",
      offline: "Could not reach the server.",
      notFound: "Character not found.",
      library: "Back to your library",
      charsRemaining: "{count} characters remaining",
    },
    ru: {
      back: "Назад к персонажу",
      title: "Редактировать предысторию",
      subtitle: "Опишите происхождение героя, его характер и мотивы.",
      placeholder: "Напишите предысторию персонажа здесь...",
      level: "Уровень",
      cancel: "Отмена",
      save: "Сохранить предысторию",
      saving: "Сохранение...",
      saveFailed: "Не удалось сохранить предысторию.",
      offline: "Не удалось связаться с сервером.",
      notFound: "Персонаж не найден.",
      library: "Вернуться в библиотеку",
      charsRemaining: "Осталось символов: {count}",
    },
  });

  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [backstory, setBackstory] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.character) {
          setCharacter(data.character);
          setBackstory(data.character.sheet?.backstory ?? "");
        }
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backstory: backstory.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.saveFailed);
        return;
      }
      navigateTo(`/characters/${characterId}`);
    } catch {
      setError(copy.offline);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="relative mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <AppHomeLogo className="absolute left-4 top-4" />
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!character) {
    return (
      <main className="relative mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <AppHomeLogo className="absolute left-4 top-4" />
        <p className="text-center text-stone-400">
          {copy.notFound}{" "}
          <Link href="/characters" className="text-amber-200 hover:text-amber-400">
            {copy.library}
          </Link>
        </p>
      </main>
    );
  }

  const maxLength = 2000;
  const remaining = maxLength - backstory.length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <div className="mb-2 flex items-center gap-3">
          <AppHomeLogo />
          <Link
            href={`/characters/${characterId}`}
            className="text-sm text-stone-500 hover:text-stone-300"
          >
            &larr; {copy.back}
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-4">
          {character.sheet?.portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.sheet.portrait.url}
              alt={character.name}
              className="size-14 shrink-0 rounded-xl border border-amber-500/30 object-cover shadow-glow-gold"
            />
          ) : (
            <CharacterPortrait
              look={{
                race: character.race,
                class: character.class,
                gender: character.sheet?.gender,
              }}
              alt={character.name}
              size="size-14"
              className="rounded-xl border-amber-500/30 shadow-glow-gold"
            />
          )}
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">
              {character.name}
            </h1>
            <p className="flex items-center gap-2 text-xs text-stone-400">
              <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                {copy.level} {character.level} {characterDisplay(character.class, locale)}
              </span>
              <span>·</span>
              <span>{characterDisplay(character.race, locale)}</span>
              {character.subclass ? (
                <>
                  <span>·</span>
                  <span>{characterDisplay(character.subclass, locale)}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={submit} className={cn(ui.card, "p-5 sm:p-6")}>
        <div className="mb-3">
          <h2 className="font-display text-lg tracking-wide text-amber-100">{copy.title}</h2>
          <p className="text-xs text-stone-400">{copy.subtitle}</p>
        </div>

        <div className="space-y-1.5">
          <textarea
            value={backstory}
            onChange={(e) => setBackstory(e.target.value)}
            rows={10}
            maxLength={maxLength}
            placeholder={copy.placeholder}
            className="w-full rounded-lg border border-stone-700 bg-stone-900/90 p-3 font-serif text-sm leading-relaxed text-stone-200 outline-none placeholder:text-stone-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <div className="flex justify-end text-[11px] text-stone-500">
            {copy.charsRemaining.replace("{count}", String(remaining))}
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-stone-800 pt-4">
          <Link
            href={`/characters/${characterId}`}
            className={ui.btnSmall}
          >
            {copy.cancel}
          </Link>
          <button
            type="submit"
            disabled={busy}
            className={ui.btnPrimary}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? copy.saving : copy.save}
          </button>
        </div>
      </form>
    </main>
  );
}
