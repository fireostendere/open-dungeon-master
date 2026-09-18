"use client";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import type { LocationChatController } from "./useLocationChat";

type Member = { userId: string; username: string };
const field = "rounded border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-100";
const button = "rounded border border-stone-600 px-3 py-1 text-sm hover:bg-stone-800 disabled:opacity-40";

export function LocationChat({ chat, members, dmUserId }: { chat: LocationChatController; members: Member[]; dmUserId?: string | null }) {
  const { locale } = useI18n();
  const t = localeText(locale, {
    en: { title: "Locations", ooc: "OOC · everyone", archive: "Archive — you are not here. New messages are not available unless the DM grants perception.", live: "You are here", observing: "Perception granted", empty: "No messages you witnessed here yet.", send: "Send", say: "Say", do: "Do", narration: "Narrate", travel: "Go to", older: "Older", newest: "Latest", retry: "Retry unconfirmed command", controls: "DM location controls", create: "Create location", link: "Connect locations", move: "Move players", observe: "Grant perception", revoke: "Revoke", propagate: "Loud / visible incident", perceive: "Private perceived fragment", name: "Location name", source: "Source location", target: "Destination", players: "Players", walk: "Open passage", sound: "Sound can cross", sight: "Visible across boundary", speech: "Eavesdropping: future speech only", scry: "Magic: future scene", reason: "Adjudication / reason", seconds: "Duration in seconds", summary: "Only what the recipients perceive, not the private source conversation", apply: "Apply", who: "Present", noPosition: "Ask the DM to place your character. OOC is available.", draft: "Message", global: "OOC is global and does not advance the story.", bounded: "History contains only messages delivered to you. Entering does not unlock earlier visits or absence gaps." },
    ru: { title: "Локации", ooc: "OOC · для всех", archive: "Архив — вас здесь нет. Новые сообщения недоступны без разрешённого ведущим восприятия.", live: "Вы здесь", observing: "Разрешено восприятие", empty: "Здесь пока нет сообщений, свидетелем которых вы были.", send: "Отправить", say: "Речь", do: "Действие", narration: "Повествование", travel: "Перейти", older: "Раньше", newest: "Последние", retry: "Повторить неподтверждённую команду", controls: "Управление локациями для ведущего", create: "Создать локацию", link: "Соединить локации", move: "Переместить игроков", observe: "Разрешить восприятие", revoke: "Отозвать", propagate: "Громкое / видимое событие", perceive: "Приватный фрагмент восприятия", name: "Название локации", source: "Исходная локация", target: "Куда", players: "Игроки", walk: "Открытый проход", sound: "Звук проходит", sight: "Есть видимость", speech: "Подслушивание: только будущая речь", scry: "Магия: будущие события сцены", reason: "Решение ведущего / причина", seconds: "Длительность в секундах", summary: "Только то, что воспринимают получатели, без приватного разговора внутри", apply: "Применить", who: "Присутствуют", noPosition: "Попросите ведущего разместить вашего персонажа. OOC доступен.", draft: "Сообщение", global: "OOC общий для всех и не продвигает сюжет.", bounded: "В истории только сообщения, доступные лично вам. Вход не открывает прошлые разговоры или пропущенные события." },
    pl: { title: "Lokacje", ooc: "OOC · wszyscy", archive: "Archiwum — nie ma cię tutaj. Nowe wiadomości wymagają percepcji przyznanej przez MG.", live: "Jesteś tutaj", observing: "Przyznana percepcja", empty: "Nie masz jeszcze wiadomości z tej lokacji.", send: "Wyślij", say: "Mowa", do: "Działanie", narration: "Narracja", travel: "Przejdź", older: "Starsze", newest: "Najnowsze", retry: "Ponów niepotwierdzone polecenie", controls: "Zarządzanie lokacjami MG", create: "Utwórz lokację", link: "Połącz lokacje", move: "Przenieś graczy", observe: "Przyznaj percepcję", revoke: "Cofnij", propagate: "Głośne / widoczne zdarzenie", perceive: "Prywatny fragment percepcji", name: "Nazwa lokacji", source: "Lokacja źródłowa", target: "Cel", players: "Gracze", walk: "Otwarte przejście", sound: "Dźwięk przenika", sight: "Widoczność przez granicę", speech: "Podsłuch: tylko przyszła mowa", scry: "Magia: przyszłe zdarzenia", reason: "Rozstrzygnięcie / powód", seconds: "Czas w sekundach", summary: "Tylko to, co odbiorcy postrzegają, bez prywatnej rozmowy", apply: "Zastosuj", who: "Obecni", noPosition: "Poproś MG o umieszczenie postaci. OOC jest dostępny.", draft: "Wiadomość", global: "OOC jest wspólny i nie rozwija fabuły.", bounded: "Historia zawiera tylko wiadomości dostępne tobie. Wejście nie ujawnia przeszłości ani przerw w obecności." },
  });
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("say");
  const [operation, setOperation] = useState("create_room");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [walkable, setWalkable] = useState(true);
  const [sound, setSound] = useState(false);
  const [sight, setSight] = useState(false);
  const [mode, setMode] = useState("speech");
  const [seconds, setSeconds] = useState(60);
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [medium, setMedium] = useState("sound");
  const view = chat.view;
  if (!view?.enabled) return null;
  const selected = view.rooms.find(room => room.id === chat.selected);
  const ooc = chat.selected === "ooc";
  const active = view.current?.roomId === chat.selected;
  const observing = view.grants.some(grant => grant.roomId === chat.selected);
  const canSend = ooc || Boolean(selected && (view.isDm || active));
  const memberName = (id: string | null) => members.find(member => member.userId === id)?.username ?? "—";
  const roomName = (id: string) => view.rooms.find(room => room.id === id)?.name ?? "—";
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !content.trim()) return;
    if (await chat.command({ operation: "send", roomId: ooc ? null : chat.selected,
      kind: ooc ? "ooc" : view?.enabled && view.isDm ? "narration" : kind,
      content, ...(!ooc && view?.enabled && !view.isDm ? { expectedRevision: view.current?.revision } : {}) })) setContent("");
  }
  async function control(event: FormEvent) {
    event.preventDefault();
    let input: Record<string, unknown>;
    if (operation === "create_room") input = { operation, name, ...(source ? { connectTo: source } : {}), walkable, sound, sight };
    else if (operation === "link") input = { operation, sourceId: source, targetId: target, walkable, sound, sight };
    else if (operation === "move") input = { operation, roomId: target, userIds: targets };
    else if (operation === "observe") input = { operation, roomId: source, userId: targets[0], mode, seconds, reason };
    else if (operation === "propagate") input = { operation, roomId: source, medium, content: summary };
    else input = { operation, roomId: source, userIds: targets, content: summary };
    await chat.command(input);
  }
  const roomSelect = (value: string, change: (id: string) => void, label: string, required = true) => (
    <label className="flex flex-col gap-1 text-xs">{label}<select className={field} value={value} required={required} onChange={event => change(event.target.value)}>
      <option value="">—</option>{view.rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}
    </select></label>
  );
  return <section className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-stone-200" aria-label={t.title}>
    <nav className="flex flex-wrap gap-1" aria-label={t.title}>
      <button type="button" className={button} aria-pressed={ooc} onClick={() => chat.select("ooc")}>{t.ooc}</button>
      {view.rooms.map(room => <button type="button" key={room.id} className={button} aria-pressed={chat.selected === room.id}
        onClick={() => chat.select(room.id)}>{room.active ? "● " : ""}{room.name}</button>)}
    </nav>
    <p className="text-xs text-stone-400">{ooc ? t.global : active ? t.live : observing ? t.observing : view.isDm ? t.narration : t.archive}</p>
    {!view.current && !view.isDm ? <p className="text-xs">{t.noPosition}</p> : null}
    {selected?.occupants.length ? <p className="text-xs">{t.who}: {selected.occupants.map(memberName).join(", ")}</p> : null}
    {!view.isDm && view.exits.length ? <div className="flex flex-wrap gap-1">{view.exits.map(exit => <button type="button" className={button} key={exit.id} disabled={chat.busy || chat.pending}
      onClick={async () => { if (await chat.command({ operation: "move", roomId: exit.id, expectedRevision: view.current?.revision })) chat.select(exit.id); }}>{t.travel}: {exit.name}</button>)}</div> : null}
    {chat.error ? <p role="alert" className="text-sm text-red-300">{chat.error}</p> : null}
    {chat.pending ? <button type="button" className={button} disabled={chat.busy} onClick={() => void chat.retry()}>{t.retry}</button> : null}
    <div className="min-h-36 flex-1 space-y-3 overflow-y-auto rounded border border-stone-800 p-3" aria-label={selected?.name ?? t.ooc}>
      <div className="flex gap-2">{chat.page.nextBefore ? <button type="button" className={button} onClick={chat.older}>{t.older}</button> : null}
        {chat.showingOlder ? <button type="button" className={button} onClick={chat.newest}>{t.newest}</button> : null}</div>
      {!chat.page.messages.length ? <p className="text-sm text-stone-500">{t.empty}</p> : null}
      {chat.page.messages.map(message => <article key={message.id} className="border-b border-stone-800 pb-2">
        <header className="text-xs text-stone-400">{memberName(message.authorUserId)} · {message.kind === "ooc" ? "OOC" : message.kind === "say" ? t.say : message.kind === "do" ? t.do : message.kind === "perception" ? t.observing : t.narration}</header>
        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
      </article>)}
    </div>
    <p className="text-xs text-stone-500">{t.bounded}</p>
    <form onSubmit={send} className="flex flex-col gap-2">
      {!ooc && !view.isDm ? <select className={field} aria-label={t.draft} value={kind} onChange={event => setKind(event.target.value)} disabled={!canSend}><option value="say">{t.say}</option><option value="do">{t.do}</option></select> : null}
      <textarea className={field} aria-label={t.draft} value={content} onChange={event => setContent(event.target.value)} maxLength={view.isDm && !ooc ? 8000 : 2000} rows={3} disabled={!canSend || chat.busy || chat.pending} />
      <button className={button} disabled={!canSend || chat.busy || chat.pending || !content.trim()}>{t.send}</button>
    </form>
    {view.isDm ? <details className="rounded border border-stone-700 p-2"><summary>{t.controls}</summary>
      <form onSubmit={control} className="mt-2 flex flex-col gap-2">
        <select className={field} value={operation} onChange={event => setOperation(event.target.value)} aria-label={t.controls}>
          <option value="create_room">{t.create}</option><option value="link">{t.link}</option><option value="move">{t.move}</option>
          <option value="observe">{t.observe}</option><option value="propagate">{t.propagate}</option><option value="perceive">{t.perceive}</option>
        </select>
        {operation === "create_room" ? <input className={field} aria-label={t.name} placeholder={t.name} value={name} onChange={event => setName(event.target.value)} maxLength={80} required /> : null}
        {operation !== "move" ? roomSelect(source, setSource, t.source, operation !== "create_room") : null}
        {["link", "move"].includes(operation) ? roomSelect(target, setTarget, t.target) : null}
        {["link", "create_room"].includes(operation) ? <div className="flex flex-wrap gap-3 text-xs">
          <label><input type="checkbox" checked={walkable} onChange={event => setWalkable(event.target.checked)} /> {t.walk}</label>
          <label><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} /> {t.sound}</label>
          <label><input type="checkbox" checked={sight} onChange={event => setSight(event.target.checked)} /> {t.sight}</label>
        </div> : null}
        {["move", "observe", "perceive"].includes(operation) ? <label className="flex flex-col text-xs">{t.players}
          <select className={field} multiple={operation !== "observe"} value={operation === "observe" ? targets[0] ?? "" : targets} onChange={event => setTargets(Array.from(event.target.selectedOptions, option => option.value))} required>
            {members.filter(member => member.userId !== dmUserId).map(member => <option key={member.userId} value={member.userId}>{member.username}</option>)}
          </select></label> : null}
        {operation === "observe" ? <>
          <select className={field} value={mode} onChange={event => setMode(event.target.value)} aria-label={t.observe}><option value="speech">{t.speech}</option><option value="scry">{t.scry}</option></select>
          <input className={field} type="number" aria-label={t.seconds} min={1} max={3600} value={seconds} onChange={event => setSeconds(Number(event.target.value))} required />
          <input className={field} aria-label={t.reason} placeholder={t.reason} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required />
        </> : null}
        {["propagate", "perceive"].includes(operation) ? <textarea className={field} aria-label={t.summary} placeholder={t.summary} value={summary} onChange={event => setSummary(event.target.value)} maxLength={2000} required /> : null}
        {operation === "propagate" ? <select className={field} value={medium} onChange={event => setMedium(event.target.value)} aria-label={t.propagate}><option value="sound">{t.sound}</option><option value="sight">{t.sight}</option></select> : null}
        <button className={button} disabled={chat.busy || chat.pending}>{t.apply}</button>
      </form>
      <div className="mt-2 space-y-1">{view.grants.map(grant => <div className="flex flex-wrap items-center gap-2 text-xs" key={grant.id}>
        <span>{memberName(grant.userId)} · {roomName(grant.roomId)} · {grant.mode === "speech" ? t.speech : t.scry}</span>
        <button type="button" className={button} disabled={chat.busy || chat.pending} onClick={() => void chat.command({ operation: "revoke", grantId: grant.id })}>{t.revoke}</button>
      </div>)}</div>
    </details> : null}
  </section>;
}
