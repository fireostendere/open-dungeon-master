"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    title: "Join with a room code",
    help: "A friend running a table gives you an eight-letter sigil.",
    joining: "Joining...",
    join: "Join",
    failed: "Could not join.",
  },
  ru: {
    title: "Присоединиться по коду комнаты",
    help: "Друг, ведущий стол, даст вам восьмизначный код приглашения.",
    joining: "Подключение...",
    join: "Войти",
    failed: "Не удалось присоединиться.",
  },
  pl: {
    title: "Dołącz kodem pokoju",
    help: "Znajomy prowadzący stół poda ci ośmioznakowy kod zaproszenia.",
    joining: "Dołączanie...",
    join: "Dołącz",
    failed: "Nie udało się dołączyć.",
  },
} as const;

export function JoinCard({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
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
        setJoinError(copy.failed);
        return;
      }
      navigateTo(`/campaigns/${data.campaign.id}`);
    } catch {
      setJoinError(copy.failed);
    } finally {
      setJoining(false);
    }
  }

  return (
    <section id="join" className={cn(ui.card, "ornate scroll-mt-6 p-5")}>
      <h2 className="eyebrow mb-1 text-sm text-amber-200/90">{copy.title}</h2>
      <p className="mb-3 text-sm text-stone-500">{copy.help}</p>
      <form onSubmit={join} className="flex gap-2">
        <input
          ref={inputRef}
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
          placeholder="K7WQ2MNP"
          required
          maxLength={12}
          className={cn(ui.input, "w-52 font-mono uppercase tracking-[0.25em]")}
        />
        <button type="submit" disabled={joining} className={ui.btnSecondary}>
          {joining ? copy.joining : copy.join}
        </button>
      </form>
      {joinError ? <p className="mt-2 text-sm text-red-400">{joinError}</p> : null}
    </section>
  );
}
