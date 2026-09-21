"use client";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import type { LocationChatController } from "./useLocationChat";
import type { GlobalTurnState } from "@/lib/campaign-types";
import { WebMcpLocationTools } from "./WebMcpLocationTools";

type Member = { userId: string; username: string };
const field = "rounded border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-100";
const button = "rounded border border-stone-600 px-3 py-1 text-sm hover:bg-stone-800 disabled:opacity-40";

export function LocationChat({
  chat,
  members,
  dmUserId,
  globalTurnState,
  globalTurnEnabled = false,
}: {
  chat: LocationChatController;
  members: Member[];
  dmUserId?: string | null;
  globalTurnState?: GlobalTurnState | null;
  globalTurnEnabled?: boolean;
}) {
  const { locale } = useI18n();
  const t = localeText(locale, {
    en: { title: "Locations", locked: "Input locked while the MCP Dungeon Master is finishing the turn.", ooc: "OOC · everyone", archive: "Archive — you are not here. New messages are not available unless the DM grants perception.", live: "You are here", observing: "Perception granted", empty: "No messages you witnessed here yet.", send: "Send", say: "Say", do: "Do", narration: "Narrate", travel: "Go to", older: "Older", newest: "Latest", retry: "Retry unconfirmed command", controls: "DM location controls", create: "Create location", link: "Connect locations", move: "Move players", observe: "Grant perception", revoke: "Revoke", propagate: "Loud / visible incident", perceive: "Private perceived fragment", name: "Location name", source: "Source location", target: "Destination", players: "Players", walk: "Open passage", sound: "Sound can cross", sight: "Visible across boundary", speech: "Eavesdropping: future speech only", scry: "Magic: future scene", reason: "Adjudication / reason", seconds: "Duration in seconds", summary: "Only what the recipients perceive, not the private source conversation", apply: "Apply", who: "Present", noPosition: "Ask the DM to place your character. OOC is available.", draft: "Message", global: "OOC is global and does not advance the story.", bounded: "History contains only messages delivered to you. Entering does not unlock earlier visits or absence gaps.", stealth: "Stealth", stealthNotice: "Hidden action: only you see this until DM adjudication. Observers with high Passive Perception may notice.", stealthPending: "Stealth (Pending)", stealthConfirmed: "Stealth (Hidden)", stealthRevealed: "Revealed", stealthFailed: "Stealth Failed", perceptionBadge: "Perception", resolveStealth: "Resolve Stealth", outcome: "Outcome", confirmed: "Confirmed (Remains hidden)", revealed: "Revealed to all in room", failed: "Failed (Action aborted)", detectingPlayers: "Detecting players", perceivedFragment: "Perceived description for detectors", sense: "Sense" },
    ru: { title: "Локации", locked: "Ввод закрыт, пока MCP-Мастер завершает ход.", ooc: "OOC · для всех", archive: "Архив — вас здесь нет. Новые сообщения недоступны без разрешённого ведущим восприятия.", live: "Вы здесь", observing: "Разрешено восприятие", empty: "Здесь пока нет сообщений, свидетелем которых вы были.", send: "Отправить", say: "Речь", do: "Действие", narration: "Повествование", travel: "Перейти", older: "Раньше", newest: "Последние", retry: "Повторить неподтверждённую команду", controls: "Управление локациями для ведущего", create: "Создать локацию", link: "Соединить локации", move: "Переместить игроков", observe: "Разрешить восприятие", revoke: "Отозвать", propagate: "Громкое / видимое событие", perceive: "Приватный фрагмент восприятия", name: "Название локации", source: "Исходная локация", target: "Куда", players: "Игроки", walk: "Открытый проход", sound: "Звук проходит", sight: "Есть видимость", speech: "Подслушивание: только будущая речь", scry: "Магия: будущие события сцены", reason: "Решение ведущего / причина", seconds: "Длительность в секундах", summary: "Только то, что воспринимают получатели, без приватного разговора внутри", apply: "Применить", who: "Присутствуют", noPosition: "Попросите ведущего разместить вашего персонажа. OOC доступен.", draft: "Сообщение", global: "OOC общий для всех и не продвигает сюжет.", bounded: "В истории только сообщения, доступные лично вам. Вход не открывает прошлые разговоры или пропущенные события.", stealth: "Скрытно", stealthNotice: "Скрытное действие: видите только вы до решения ведущего. Персонажи с высоким пассивным восприятием могут заметить.", stealthPending: "Скрытно (Ожидание)", stealthConfirmed: "Скрытно (Успех)", stealthRevealed: "Раскрыто", stealthFailed: "Провал скрытности", perceptionBadge: "Замечено", resolveStealth: "Разрешить скрытность", outcome: "Исход", confirmed: "Подтверждено (Скрыт)", revealed: "Раскрыто для всей комнаты", failed: "Провал (Действие сорвано)", detectingPlayers: "Заметившие игроки", perceivedFragment: "Что замечают наблюдатели", sense: "Чувство" },
    pl: { title: "Lokacje", locked: "Wejście zablokowane, dopóki MCP MG kończy turę.", ooc: "OOC · wszyscy", archive: "Archiwum — nie ma cię tutaj. Nowe wiadomości wymagają percepcji przyznanej przez MG.", live: "Jesteś tutaj", observing: "Przyznana percepcja", empty: "Nie masz jeszcze wiadomości z tej lokacji.", send: "Wyślij", say: "Mowa", do: "Działanie", narration: "Narracja", travel: "Przejdź", older: "Starsze", newest: "Najnowsze", retry: "Ponów niepotwierdzone polecenie", controls: "Zarządzanie lokacjami MG", create: "Utwórz lokację", link: "Połącz lokacje", move: "Przenieś graczy", observe: "Przyznaj percepcję", revoke: "Cofnij", propagate: "Głośne / widoczne zdarzenie", perceive: "Prywatny fragment percepcji", name: "Nazwa lokacji", source: "Lokacja źródłowa", target: "Cel", players: "Gracze", walk: "Otwarte przejście", sound: "Dźwięk przenika", sight: "Widoczność przez granicę", speech: "Podsłuch: tylko przyszła mowa", scry: "Magia: przyszłe zdarzenia", reason: "Rozstrzygnięcie / powód", seconds: "Czas w sekundach", summary: "Tylko to, co odbiorcy postrzegają, bez prywatnej rozmowy", apply: "Zastosuj", who: "Obecni", noPosition: "Poproś MG o umieszczenie postaci. OOC jest dostępny.", draft: "Wiadomość", global: "OOC jest wspólny i nie rozwija fabuły.", bounded: "Historia zawiera tylko wiadomości dostępne tobie. Wejście nie ujawnia przeszłości ani przerw w obecności.", stealth: "Ukrycie", stealthNotice: "Działanie w ukryciu: widzisz tylko ty do rozstrzygnięcia przez MG. Postacie z wysoką Percepcją Pasywną mogą cię zauważyć.", stealthPending: "Ukrycie (Oczekuje)", stealthConfirmed: "Ukrycie (Udane)", stealthRevealed: "Ujawnione", stealthFailed: "Nieudane ukrycie", perceptionBadge: "Dostrzeżone", resolveStealth: "Rozstrzygnij ukrycie", outcome: "Wynik", confirmed: "Potwierdzone (Ukryty)", revealed: "Ujawnione dla wszystkich w pokoju", failed: "Niepowodzenie (Przerwane)", detectingPlayers: "Gracze, którzy dostrzegli", perceivedFragment: "Opis dla obserwatorów", sense: "Zmysł" },
  });
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("say");
  const [isStealth, setIsStealth] = useState(false);
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
  const [stealthMsgId, setStealthMsgId] = useState("");
  const [outcome, setOutcome] = useState("confirmed");
  const [perceivedText, setPerceivedText] = useState("");
  const [sense, setSense] = useState("sight");
  const view = chat.view;
  const webMcp = <WebMcpLocationTools campaignId={chat.campaignId} userId={chat.userId} />;
  if (!view?.enabled) return webMcp;
  const selected = view.rooms.find(room => room.id === chat.selected);
  const ooc = chat.selected === "ooc";
  const active = view.current?.roomId === chat.selected;
  const observing = view.grants.some(grant => grant.roomId === chat.selected);
  const globalTurnLocked = Boolean(
    globalTurnEnabled &&
      !view.isDm &&
      globalTurnState &&
      ["waiting", "ready", "resolving"].includes(globalTurnState.phase),
  );
  const canSend =
    !globalTurnLocked && (ooc || Boolean(selected && (view.isDm || active)));
  const memberName = (id: string | null) => members.find(member => member.userId === id)?.username ?? "—";
  const roomName = (id: string) => view.rooms.find(room => room.id === id)?.name ?? "—";
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !content.trim()) return;
    const isDm = Boolean(view?.enabled && view.isDm);
    const revision = view?.enabled ? view.current?.revision : undefined;
    if (await chat.command({ operation: "send", roomId: ooc ? null : chat.selected,
      kind: ooc ? "ooc" : isDm ? "narration" : kind,
      content,
      ...(isStealth && !ooc && !isDm ? { stealth: true } : {}),
      ...(!ooc && !isDm && revision !== undefined ? { expectedRevision: revision } : {}) })) {
      setContent("");
      setIsStealth(false);
    }
  }
  async function control(event: FormEvent) {
    event.preventDefault();
    let input: Record<string, unknown>;
    if (operation === "create_room") input = { operation, name, ...(source ? { connectTo: source } : {}), walkable, sound, sight };
    else if (operation === "link") input = { operation, sourceId: source, targetId: target, walkable, sound, sight };
    else if (operation === "move") input = { operation, roomId: target, userIds: targets };
    else if (operation === "observe") input = { operation, roomId: source, userId: targets[0], mode, seconds, reason };
    else if (operation === "propagate") input = { operation, roomId: source, medium, content: summary };
    else if (operation === "stealth_resolve") input = { operation, messageId: stealthMsgId, outcome, ...(targets.length ? { detectedByUserIds: targets } : {}), ...(perceivedText.trim() ? { perceivedText: perceivedText.trim() } : {}), sense };
    else input = { operation, roomId: source, userIds: targets, content: summary };
    await chat.command(input);
  }
  const roomSelect = (value: string, change: (id: string) => void, label: string, required = true) => (
    <label className="flex flex-col gap-1 text-xs">{label}<select className={field} value={value} required={required} onChange={event => change(event.target.value)}>
      <option value="">—</option>{view.rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}
    </select></label>
  );
  return <><>{webMcp}</><section data-testid="location-chat" className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-stone-200" aria-label={t.title}>
    <nav className="flex flex-wrap gap-1" aria-label={t.title}>
      <button type="button" className={button} aria-pressed={ooc} onClick={() => chat.select("ooc")}>{t.ooc}</button>
      {view.rooms.map(room => <button data-testid={`location-room-${room.id}`} type="button" key={room.id} className={button} aria-pressed={chat.selected === room.id}
        onClick={() => chat.select(room.id)}>{room.active ? "● " : ""}{room.name}</button>)}
    </nav>
    <p className="text-xs text-stone-400">
      {globalTurnLocked
        ? t.locked
        : ooc
          ? t.global
          : active
            ? t.live
            : observing
              ? t.observing
              : view.isDm
                ? t.narration
                : t.archive}
    </p>
    {!view.current && !view.isDm ? <p className="text-xs">{t.noPosition}</p> : null}
    {selected?.occupants.length ? <p className="text-xs">{t.who}: {selected.occupants.map(memberName).join(", ")}</p> : null}
    {!view.isDm && view.exits.length ? <div className="flex flex-wrap gap-1">{view.exits.map(exit => <button type="button" className={button} key={exit.id} disabled={chat.busy || chat.pending || globalTurnLocked}
      onClick={async () => { if (await chat.command({ operation: "move", roomId: exit.id, expectedRevision: view.current?.revision })) chat.select(exit.id); }}>{t.travel}: {exit.name}</button>)}</div> : null}
    {chat.error ? <p role="alert" className="text-sm text-red-300">{chat.error}</p> : null}
    {chat.pending ? <button type="button" className={button} disabled={chat.busy} onClick={() => void chat.retry()}>{t.retry}</button> : null}
    <div className="min-h-36 flex-1 space-y-3 overflow-y-auto rounded border border-stone-800 p-3" aria-label={selected?.name ?? t.ooc}>
      <div className="flex gap-2">{chat.page.nextBefore ? <button type="button" className={button} onClick={chat.older}>{t.older}</button> : null}
        {chat.showingOlder ? <button type="button" className={button} onClick={chat.newest}>{t.newest}</button> : null}</div>
      {!chat.page.messages.length ? <p className="text-sm text-stone-500">{t.empty}</p> : null}
      {chat.page.messages.map(message => {
        const isHaze = Boolean(message.stealth);
        const isPerception = message.kind === "perception";
        return (
          <article key={message.id} className={`border-b border-stone-800 pb-2 ${isHaze ? "rounded bg-indigo-950/20 border-l-2 border-indigo-500/60 pl-2 shadow-[0_0_12px_rgba(99,102,241,0.08)]" : isPerception ? "rounded bg-amber-950/20 border-l-2 border-amber-500/60 pl-2 shadow-[0_0_12px_rgba(245,158,11,0.08)]" : ""}`}>
            <header className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
              <span>{memberName(message.authorUserId)} · {message.kind === "ooc" ? "OOC" : message.kind === "say" ? t.say : message.kind === "do" ? t.do : isPerception ? t.observing : t.narration}</span>
              {isHaze ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                  {message.stealthStatus === "confirmed" ? t.stealthConfirmed : message.stealthStatus === "revealed" ? t.stealthRevealed : message.stealthStatus === "failed" ? t.stealthFailed : t.stealthPending}
                </span>
              ) : null}
              {isPerception ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950/80 text-amber-300 border border-amber-700/50">
                  [{t.perceptionBadge}]
                </span>
              ) : null}
            </header>
            <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
          </article>
        );
      })}
    </div>
    <p className="text-xs text-stone-500">{t.bounded}</p>
    <form onSubmit={send} className="flex flex-col gap-2">
      {!ooc && !view.isDm ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select className={field} aria-label={t.draft} value={kind} onChange={event => setKind(event.target.value)} disabled={!canSend}>
            <option value="say">{t.say}</option>
            <option value="do">{t.do}</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer text-stone-300 select-none">
            <input
              type="checkbox"
              checked={isStealth}
              onChange={event => setIsStealth(event.target.checked)}
              disabled={!canSend}
              className="rounded border-stone-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span className={isStealth ? "font-semibold text-indigo-300" : ""}>{t.stealth}</span>
          </label>
        </div>
      ) : null}
      {isStealth && !ooc && !view.isDm ? (
        <p className="text-[11px] text-indigo-300/80 italic">{t.stealthNotice}</p>
      ) : null}
      <textarea
        className={`${field} ${isStealth && !ooc && !view.isDm ? "ring-1 ring-indigo-500/50 border-indigo-500/50 bg-gradient-to-r from-stone-950 via-slate-900/60 to-stone-950 shadow-[0_0_12px_rgba(99,102,241,0.15)] motion-safe:transition-all" : ""}`}
        aria-label={t.draft}
        value={content}
        onChange={event => setContent(event.target.value)}
        maxLength={view.isDm && !ooc ? 8000 : 2000}
        rows={3}
        disabled={!canSend || chat.busy || chat.pending}
      />
      <button className={button} disabled={!canSend || chat.busy || chat.pending || !content.trim()}>{t.send}</button>
    </form>
    {view.isDm ? <details className="rounded border border-stone-700 p-2"><summary>{t.controls}</summary>
      <form onSubmit={control} className="mt-2 flex flex-col gap-2">
        <select className={field} value={operation} onChange={event => setOperation(event.target.value)} aria-label={t.controls}>
          <option value="create_room">{t.create}</option><option value="link">{t.link}</option><option value="move">{t.move}</option>
          <option value="observe">{t.observe}</option><option value="propagate">{t.propagate}</option><option value="perceive">{t.perceive}</option>
          <option value="stealth_resolve">{t.resolveStealth}</option>
        </select>
        {operation === "create_room" ? <input className={field} aria-label={t.name} placeholder={t.name} value={name} onChange={event => setName(event.target.value)} maxLength={80} required /> : null}
        {operation !== "move" && operation !== "stealth_resolve" ? roomSelect(source, setSource, t.source, operation !== "create_room") : null}
        {["link", "move"].includes(operation) ? roomSelect(target, setTarget, t.target) : null}
        {["link", "create_room"].includes(operation) ? <div className="flex flex-wrap gap-3 text-xs">
          <label><input type="checkbox" checked={walkable} onChange={event => setWalkable(event.target.checked)} /> {t.walk}</label>
          <label><input type="checkbox" checked={sound} onChange={event => setSound(event.target.checked)} /> {t.sound}</label>
          <label><input type="checkbox" checked={sight} onChange={event => setSight(event.target.checked)} /> {t.sight}</label>
        </div> : null}
        {["move", "observe", "perceive", "stealth_resolve"].includes(operation) ? <label className="flex flex-col text-xs">{operation === "stealth_resolve" ? t.detectingPlayers : t.players}
          <select className={field} multiple={operation !== "observe"} value={operation === "observe" ? targets[0] ?? "" : targets} onChange={event => setTargets(Array.from(event.target.selectedOptions, option => option.value))} required={operation !== "stealth_resolve"}>
            {members.filter(member => member.userId !== dmUserId).map(member => <option key={member.userId} value={member.userId}>{member.username}</option>)}
          </select></label> : null}
        {operation === "observe" ? <>
          <select className={field} value={mode} onChange={event => setMode(event.target.value)} aria-label={t.observe}><option value="speech">{t.speech}</option><option value="scry">{t.scry}</option></select>
          <input className={field} type="number" aria-label={t.seconds} min={1} max={3600} value={seconds} onChange={event => setSeconds(Number(event.target.value))} required />
          <input className={field} aria-label={t.reason} placeholder={t.reason} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required />
        </> : null}
        {operation === "stealth_resolve" ? <>
          <input className={field} aria-label="Message ID" placeholder="Message ID (UUID)" value={stealthMsgId} onChange={event => setStealthMsgId(event.target.value)} required />
          <select className={field} value={outcome} onChange={event => setOutcome(event.target.value)} aria-label={t.outcome}>
            <option value="confirmed">{t.confirmed}</option>
            <option value="revealed">{t.revealed}</option>
            <option value="failed">{t.failed}</option>
          </select>
          <select className={field} value={sense} onChange={event => setSense(event.target.value)} aria-label={t.sense}>
            <option value="sight">Sight</option>
            <option value="sound">Sound</option>
            <option value="both">Both</option>
          </select>
          <textarea className={field} aria-label={t.perceivedFragment} placeholder={t.perceivedFragment} value={perceivedText} onChange={event => setPerceivedText(event.target.value)} maxLength={2000} />
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
  </section></>;
}
