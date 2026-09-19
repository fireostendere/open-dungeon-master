"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import type { Note } from "@/lib/db/notes";

// Uses the canonical notes API. Receipts, not the browser's selected tab,
// decide whether a note version is visible. Key this component by identity/room.
export function LocationNotes({ campaignId, userId, roomId, active, isDm }: {
  campaignId: string; userId: string; roomId: string; active: boolean; isDm: boolean;
}) {
  const { locale } = useI18n();
  const t = localeText(locale, {
    en: { title: "Location notes", archive: "Last observed versions; unseen changes are not included.", empty: "No notes known to you here.", heading: "Title", body: "Note text", create: "Add location note", save: "Save", edit: "Edit", cancel: "Cancel", approve: "Approve for this location", remove: "Delete", pending: "Awaiting DM approval", error: "The request failed. Refresh the list before repeating a write.", refresh: "Refresh", local: "This is a location note, not a global party note. Players' suggestions need DM approval." },
    ru: { title: "Заметки локации", archive: "Последние наблюдавшиеся версии, без изменений за время отсутствия.", empty: "Здесь нет известных вам заметок.", heading: "Заголовок", body: "Текст заметки", create: "Добавить заметку локации", save: "Сохранить", edit: "Изменить", cancel: "Отмена", approve: "Одобрить для этой локации", remove: "Удалить", pending: "Ожидает одобрения ведущего", error: "Запрос завершился ошибкой. Обновите список перед повторной записью.", refresh: "Обновить", local: "Это заметка локации, не общая заметка группы. Предложения игроков требуют одобрения ведущего." },
    pl: { title: "Notatki lokacji", archive: "Ostatnio zaobserwowane wersje, bez zmian podczas nieobecności.", empty: "Nie znasz tu żadnych notatek.", heading: "Tytuł", body: "Treść notatki", create: "Dodaj notatkę lokacji", save: "Zapisz", edit: "Edytuj", cancel: "Anuluj", approve: "Zatwierdź dla tej lokacji", remove: "Usuń", pending: "Czeka na zatwierdzenie MG", error: "Żądanie nie powiodło się. Odśwież listę przed ponownym zapisem.", refresh: "Odśwież", local: "To notatka lokacji, nie wspólna notatka drużyny. Propozycje graczy wymagają zatwierdzenia MG." },
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const life = useRef<AbortController | null>(null);
  const endpoint = `/api/campaigns/${encodeURIComponent(campaignId)}/notes`;
  const mayWrite = active || isDm;
  const refresh = () => setVersion(value => value + 1);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    return () => { controller.abort(); if (life.current === controller) life.current = null; };
  }, [campaignId, userId, roomId]);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`${endpoint}?roomId=${encodeURIComponent(roomId)}`, {
          cache: "no-store", signal: abort.signal, headers: { "X-ODM-Actor": userId },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(t.error);
        if (!abort.signal.aborted) setNotes(data.notes);
      } catch { if (!abort.signal.aborted) setError(t.error); }
      finally { if (!abort.signal.aborted) timer = setTimeout(poll, 3000); }
    };
    void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [endpoint, roomId, userId, version, t.error]);
  async function write(method: "POST" | "PATCH" | "DELETE", id: string | null, payload?: Record<string, unknown>) {
    const current = life.current;
    if (!current || current.signal.aborted || busy || !mayWrite) return false;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint + (id ? `/${encodeURIComponent(id)}` : ""), {
        method, signal: current.signal, headers: { "Content-Type": "application/json", "X-ODM-Actor": userId },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) throw new Error(t.error);
      if (life.current !== current || current.signal.aborted) return false;
      refresh(); return true;
    } catch { if (!current.signal.aborted) setError(t.error); return false; }
    finally { if (life.current === current && !current.signal.aborted) setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    if (await write(editing ? "PATCH" : "POST", editing, editing ? { title, body } : { title, body, visibility: "public", roomId })) {
      setTitle(""); setBody(""); setEditing(null);
    }
  }
  const button = "rounded border border-stone-700 px-2 py-1 text-xs disabled:opacity-40";
  return <details data-testid="location-notes" className="m-3 rounded border border-stone-800 p-3 text-sm text-stone-300">
    <summary>{t.title}</summary>
    {!active && !isDm ? <p className="my-2 text-xs">{t.archive}</p> : null}
    {error ? <p role="alert">{error} <button type="button" className={button} onClick={refresh}>{t.refresh}</button></p> : null}
    {!notes.length ? <p className="my-2 text-xs">{t.empty}</p> : null}
    {notes.map(note => <article key={note.id} data-testid={`location-note-${note.id}`} className="my-2 border-b border-stone-800 pb-2">
      <h4>{note.title}</h4><p className="whitespace-pre-wrap break-words">{note.body}</p>
      {note.status === "pending" ? <p className="text-xs">{t.pending}</p> : null}
      {mayWrite && (isDm || note.authorUserId === userId) ? <div className="mt-1 flex gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => { setEditing(note.id); setTitle(note.title); setBody(note.body); }}>{t.edit}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void write("DELETE", note.id)}>{t.remove}</button>
        {isDm && note.status === "pending" ? <button type="button" className={button} disabled={busy} onClick={() => void write("PATCH", note.id, { status: "active" })}>{t.approve}</button> : null}
      </div> : null}
    </article>)}
    {mayWrite ? <form className="mt-2 flex flex-col gap-2" onSubmit={submit}>
      <p className="text-xs">{t.local}</p>
      <input aria-label={t.heading} className="rounded bg-stone-950 p-2" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} disabled={busy} />
      <textarea aria-label={t.body} className="rounded bg-stone-950 p-2" value={body} onChange={event => setBody(event.target.value)} maxLength={2000} required disabled={busy} />
      <button className={button} disabled={busy || !body.trim()}>{editing ? t.save : t.create}</button>
      {editing ? <button type="button" className={button} disabled={busy} onClick={() => { setEditing(null); setTitle(""); setBody(""); }}>{t.cancel}</button> : null}
    </form> : null}
  </details>;
}
