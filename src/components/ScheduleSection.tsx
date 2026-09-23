"use client";

import { CalendarClock, Check, CircleHelp, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n, type Locale } from "@/lib/i18n";
import { ui } from "@/lib/ui";
import { miscPlaceholder } from "@/lib/placeholders";
import type { RsvpResponse, ScheduledSession } from "@/lib/db/scheduling";

const COPY = {
  en: {
    going: "Going",
    maybe: "Maybe",
    out: "Out",
    pickDate: "Pick a date and time.",
    planFailed: "Could not plan the session.",
    serverFailed: "Could not reach the server.",
    pickNewDate: "Pick a new date and time.",
    moveFailed: "Could not move the session.",
    cancelConfirm: "Call this session off? Everyone gets told.",
    nextSession: "Next session",
    planSession: "Plan a session",
    durationAria: "How long the session runs",
    hours: (value: number) => `${value} hour${value === 1 ? "" : "s"}`,
    titlePlaceholder: "Title (optional)",
    notePlaceholder: "Note, e.g. we pick up at the bridge (optional)",
    schedule: "Schedule",
    nothingPlanned: "Nothing planned yet.",
    someone: "someone",
    defaultSession: (hours: number) => `${hours}h session`,
    cancelled: "cancelled",
    move: "Move",
    callOff: "Call off",
    moveIt: "Move it",
  },
  ru: {
    going: "Буду",
    maybe: "Возможно",
    out: "Не буду",
    pickDate: "Выберите дату и время.",
    planFailed: "Не удалось запланировать сессию.",
    serverFailed: "Не удалось связаться с сервером.",
    pickNewDate: "Выберите новую дату и время.",
    moveFailed: "Не удалось перенести сессию.",
    cancelConfirm: "Отменить эту сессию? Все участники получат уведомление.",
    nextSession: "Следующая сессия",
    planSession: "Запланировать сессию",
    durationAria: "Продолжительность сессии",
    hours: (value: number) => `${value} ч.`,
    titlePlaceholder: "Название (необязательно)",
    notePlaceholder: "Заметка, например: продолжаем у моста (необязательно)",
    schedule: "Запланировать",
    nothingPlanned: "Пока ничего не запланировано.",
    someone: "кто-то",
    defaultSession: (hours: number) => `Сессия на ${hours} ч.`,
    cancelled: "отменена",
    move: "Перенести",
    callOff: "Отменить",
    moveIt: "Перенести",
  },
} as const;

type ScheduleCopy = (typeof COPY)[Locale];

// The out-of-game calendar: when the humans meet next. Lives in the lobby
// beside the party list. The lead plans and cancels; everyone RSVPs. The
// schedule_updated stream nudge bumps `version` and this refetches.

function whenLabel(startsAt: string, locale: Locale): string {
  return new Date(startsAt).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// datetime-local wants local wall-clock time; toISOString would shift it by
// the timezone offset, so the parts are assembled by hand.
function toLocalInput(startsAt: string): string {
  const date = new Date(startsAt);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const DURATION_CHOICES = [60, 120, 180, 240];

function rsvpChoices(copy: ScheduleCopy): Array<{
  value: RsvpResponse;
  label: string;
  icon: typeof Check;
}> {
  return [
    { value: "yes", label: copy.going, icon: Check },
    { value: "maybe", label: copy.maybe, icon: CircleHelp },
    { value: "no", label: copy.out, icon: X },
  ];
}

export function ScheduleSection({
  campaignId,
  meUserId,
  isLead,
  usernames,
  version,
}: {
  campaignId: string;
  meUserId: string;
  isLead: boolean;
  usernames: Record<string, string>;
  version: number;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const choices = rsvpChoices(copy);
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(180);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The session being rescheduled, with its own form state so moving one
  // never disturbs the plan form above.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveWhen, setMoveWhen] = useState("");
  const [moveError, setMoveError] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // Transient; the next nudge or visit retries.
    }
  }, [campaignId]);

  useEffect(() => {
    // Deferred a tick: load sets state, and state changes must not launch
    // synchronously from an effect body.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, version]);

  async function plan(event: React.FormEvent) {
    event.preventDefault();
    if (!when) {
      setError(copy.pickDate);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startsAt: new Date(when).toISOString(),
          durationMin: duration,
          note: note.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.planFailed);
        return;
      }
      setPlanning(false);
      setTitle("");
      setWhen("");
      setDuration(180);
      setNote("");
      await load();
    } catch {
      setError(copy.serverFailed);
    } finally {
      setBusy(false);
    }
  }

  async function move(event: React.FormEvent) {
    event.preventDefault();
    if (!movingId || !moveWhen) {
      setMoveError(copy.pickNewDate);
      return;
    }
    setMoveBusy(true);
    setMoveError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/schedule/${movingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: new Date(moveWhen).toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMoveError(data.error || copy.moveFailed);
        return;
      }
      setMovingId(null);
      setMoveWhen("");
      await load();
    } catch {
      setMoveError(copy.serverFailed);
    } finally {
      setMoveBusy(false);
    }
  }

  async function rsvp(sessionId: string, response: RsvpResponse) {
    await fetch(`/api/campaigns/${campaignId}/schedule/${sessionId}/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    }).catch(() => undefined);
    await load();
  }

  async function cancel(sessionId: string) {
    if (!window.confirm(copy.cancelConfirm)) {
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/schedule/${sessionId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await load();
  }

  if (sessions.length === 0 && !isLead) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="eyebrow text-sm text-amber-200/90">
          <CalendarClock className="mr-1.5 inline size-4" />
          {copy.nextSession}
        </h2>
        {isLead ? (
          <button type="button" onClick={() => setPlanning(!planning)} className={ui.btnSmall}>
            <Plus className="size-4" /> {copy.planSession}
          </button>
        ) : null}
      </div>

      {planning ? (
        <form
          onSubmit={plan}
          className="mb-3 space-y-2 rounded-xl border border-stone-800 bg-stone-900/60 p-3"
        >
          <div className="flex flex-wrap gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className={cn(ui.input, "w-auto")}
              required
            />
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              aria-label={copy.durationAria}
              title={copy.durationAria}
              className={cn(ui.input, "w-auto")}
            >
              {DURATION_CHOICES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {copy.hours(minutes / 60)}
                </option>
              ))}
            </select>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.titlePlaceholder}
              maxLength={120}
              className={cn(ui.input, "flex-1")}
            />
          </div>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.notePlaceholder}
            maxLength={500}
            className={ui.input}
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={ui.btnSmall}>
              {copy.schedule}
            </button>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
          </div>
        </form>
      ) : null}

      {sessions.length === 0 ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={miscPlaceholder("session")}
            alt=""
            loading="lazy"
            className="h-12 w-20 shrink-0 rounded-lg border border-amber-400/20 object-cover"
          />
          <p className="text-sm text-stone-500">{copy.nothingPlanned}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => {
            const mine = session.rsvps.find((entry) => entry.userId === meUserId)?.response;
            const names = (response: RsvpResponse) =>
              session.rsvps
                .filter((entry) => entry.response === response)
                .map((entry) => usernames[entry.userId] ?? copy.someone)
                .join(", ");
            return (
              <li
                key={session.id}
                className={cn(
                  "rounded-xl border border-stone-800 bg-stone-900/60 p-3",
                  session.cancelledAt && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-amber-100">
                      {whenLabel(session.startsAt, locale)}
                      <span className="ml-2 text-stone-400">
                        {session.title || copy.defaultSession(Math.round(session.durationMin / 60))}
                      </span>
                      {session.cancelledAt ? (
                        <span className="ml-2 text-red-400">{copy.cancelled}</span>
                      ) : null}
                    </p>
                    {session.note ? (
                      <p className="text-xs text-stone-500">{session.note}</p>
                    ) : null}
                    <p className="text-xs text-stone-500">
                      {choices.map((choice) => {
                        const count = session.rsvps.filter(
                          (entry) => entry.response === choice.value,
                        ).length;
                        return count > 0 ? (
                          <span
                            key={choice.value}
                            title={names(choice.value)}
                            className="mr-3"
                          >
                            {choice.label} {count}
                          </span>
                        ) : null;
                      })}
                    </p>
                  </div>
                  {!session.cancelledAt ? (
                    <div className="flex items-center gap-1">
                      {choices.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          onClick={() => void rsvp(session.id, choice.value)}
                          className={cn(
                            ui.btnSmall,
                            mine === choice.value && "border-amber-400/60 text-amber-200",
                          )}
                          title={choice.label}
                        >
                          <choice.icon className="size-4" />
                          <span className="hidden sm:inline">{choice.label}</span>
                        </button>
                      ))}
                      {isLead ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setMovingId(movingId === session.id ? null : session.id);
                              setMoveWhen(toLocalInput(session.startsAt));
                              setMoveError("");
                            }}
                            className="ml-1 text-xs text-stone-500 transition-colors hover:text-amber-300"
                          >
                            {copy.move}
                          </button>
                          <button
                            type="button"
                            onClick={() => void cancel(session.id)}
                            className="ml-1 text-xs text-stone-500 transition-colors hover:text-red-400"
                          >
                            {copy.callOff}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {movingId === session.id && !session.cancelledAt ? (
                  <form onSubmit={move} className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      value={moveWhen}
                      onChange={(event) => setMoveWhen(event.target.value)}
                      className={cn(ui.input, "w-auto")}
                      required
                    />
                    <button type="submit" disabled={moveBusy} className={ui.btnSmall}>
                      {copy.moveIt}
                    </button>
                    {moveError ? <p className="text-sm text-red-400">{moveError}</p> : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
