"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

export function JoinCard({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Join with a room code",
      body: "A friend running a table gives you an eight-letter sigil.",
      joining: "Joining...",
      join: "Join",
      failed: "Could not join.",
    },
    ru: {
      title: "Войти по коду комнаты",
      body: "Друг, который ведёт игру, даст вам восьмибуквенный код.",
      joining: "Подключение...",
      join: "Войти",
      failed: "Не удалось присоединиться.",
    },
  });
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      const response = await fetch("/api/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode.trim().toUpperCase() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setJoinError(data.error || copy.failed);
        return;
      }
      navigateTo(`/campaigns/${data.campaign.id}`);
    } finally {
      setJoining(false);
    }
  }

  return (
    <section id="join" className={cn(ui.card, "ornate scroll-mt-6 p-5")}>
      <h2 className="eyebrow mb-1 text-sm text-amber-200/90">{copy.title}</h2>
      <p className="mb-3 text-sm text-stone-500">{copy.body}</p>
      <form onSubmit={join} className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
          placeholder="K7WQ2MNP"
          aria-label={copy.title}
          required
          maxLength={12}
          className={cn(ui.input, "min-w-0 w-full font-mono uppercase tracking-[0.25em] sm:w-52")}
        />
        <button type="submit" disabled={joining} className={ui.btnSecondary}>
          {joining ? copy.joining : copy.join}
        </button>
      </form>
      {joinError ? <p className="mt-2 text-sm text-red-400">{joinError}</p> : null}
    </section>
  );
}
