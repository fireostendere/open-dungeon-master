"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { reloadPage } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    scheduled: "This account is scheduled for deletion on {date}. Everything it owns goes with it.",
    error: "Could not reach the server. Try again from account settings.",
    keep: "Keep my account",
    dateLocale: "en-US",
  },
  ru: {
    scheduled: "Аккаунт будет удалён {date}. Всё принадлежащее ему содержимое будет удалено вместе с ним.",
    error: "Не удалось подключиться к серверу. Попробуйте снова в настройках аккаунта.",
    keep: "Сохранить аккаунт",
    dateLocale: "ru-RU",
  },
  pl: {
    scheduled: "Konto zostanie usunięte {date}. Cała należąca do niego zawartość zostanie usunięta razem z nim.",
    error: "Nie udało się połączyć z serwerem. Spróbuj ponownie w ustawieniach konta.",
    keep: "Zachowaj konto",
    dateLocale: "pl-PL",
  },
} as const;

export function DeletionBanner({ dueAt, className }: { dueAt: string; className?: string }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const when = new Date(dueAt).toLocaleDateString(copy.dateLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function keep() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAccount: true }),
      });
      if (!response.ok) {
        setError(copy.error);
        setBusy(false);
        return;
      }
      reloadPage();
    } catch {
      setError(copy.error);
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className={cn(
        "mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200",
        className,
      )}
    >
      <span>
        {copy.scheduled.replace("{date}", when)}
        {error ? <span className="block text-xs text-red-300">{error}</span> : null}
      </span>
      <button type="button" onClick={keep} disabled={busy} className={ui.btnSmall}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        {copy.keep}
      </button>
    </div>
  );
}
