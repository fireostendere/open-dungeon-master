"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Loader2, Save, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { ui } from "@/lib/ui";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function CharacterBackstoryDialog({
  campaignId,
  sheet,
  onClose,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Edit backstory",
      subtitle: "Update your character's backstory. Changes will be visible to the party and the DM.",
      placeholder: "Write your character's backstory here...",
      cancel: "Cancel",
      save: "Save backstory",
      saving: "Saving...",
      failed: "Could not save backstory.",
      offline: "Could not reach the server.",
      charsRemaining: "{count} characters remaining",
    },
    ru: {
      title: "Редактировать предысторию",
      subtitle: "Обновите предысторию персонажа. Изменения будут видны отряду и Ведущему.",
      placeholder: "Напишите предысторию вашего персонажа...",
      cancel: "Отмена",
      save: "Сохранить",
      saving: "Сохранение...",
      failed: "Не удалось сохранить предысторию.",
      offline: "Не удалось связаться с сервером.",
      charsRemaining: "Осталось символов: {count}",
    },
    pl: {
      title: "Edytuj historię",
      subtitle: "Zaktualizuj historię postaci. Zmiany będą widoczne dla drużyny i MG.",
      placeholder: "Napisz historię swojej postaci tutaj...",
      cancel: "Anuluj",
      save: "Zapisz",
      saving: "Zapisywanie...",
      failed: "Nie udało się zapisać historii.",
      offline: "Nie udało się połączyć z serwerem.",
      charsRemaining: "Pozostało znaków: {count}",
    },
  });

  const [backstory, setBackstory] = useState(sheet.backstory ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const maxLength = 2000;
  const remaining = maxLength - backstory.length;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backstory: backstory.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.failed);
        return;
      }
      onClose();
    } catch {
      setError(copy.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(32rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 sm:p-6",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-50">
              <BookOpen className="size-4 text-amber-300" /> {copy.title} · {sheet.name}
            </Dialog.Title>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <p className="mb-3 text-xs text-stone-400">{copy.subtitle}</p>

          <div className="space-y-1.5">
            <textarea
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={8}
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

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-stone-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              className={ui.btnSmall}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className={ui.btnPrimary}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {busy ? copy.saving : copy.save}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
