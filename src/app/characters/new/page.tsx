"use client";

import Link from "next/link";
import { useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import CharacterBuilder, { type BuilderResult } from "../builder/CharacterBuilder";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export default function NewCharacterPage() {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { back: "Back to your characters", title: "Create a character", subtitle: "Saved to your library; bring them into any campaign later.", save: "Save to library", saveFailed: "Could not save the character.", offline: "Could not reach the server." },
    ru: { back: "Назад к персонажам", title: "Новый персонаж", subtitle: "Сохранится в библиотеке — затем его можно взять в любую кампанию.", save: "Сохранить в библиотеку", saveFailed: "Не удалось сохранить персонажа.", offline: "Не удалось связаться с сервером." },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The same sheet either way, and the same adaptation on the way into a
  // campaign (src/lib/characters/adapt.ts). What the role decides is which
  // door they come through: a player character joins a table as yours, a
  // companion joins it as an ally the DM plays. The wizard's first step
  // holds the toggle.
  const [role, setRole] = useState<"pc" | "companion">("pc");

  async function submit(result: BuilderResult) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.saveFailed);
        return;
      }
      navigateTo("/characters");
    } catch {
      setError(copy.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; {copy.back}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">{copy.title}</h1>
            <p className="text-sm text-stone-400">
              {copy.subtitle}
            </p>
          </div>
        </div>
      </header>
      <CharacterBuilder
         submitLabel={copy.save}
        onSubmit={submit}
        busy={busy}
        error={error}
        role={{ value: role, onChange: setRole }}
      />
    </main>
  );
}
