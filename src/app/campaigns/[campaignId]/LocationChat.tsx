"use client";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import type { LocationChatController } from "./useLocationChat";
import type { GlobalTurnState } from "@/lib/campaign-types";
import { WebMcpLocationTools } from "./WebMcpLocationTools";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { AskChatEntry, AskOptions } from "@/app/campaigns/[campaignId]/AskPanel";
import type { CampaignAsk } from "@/lib/db/asks";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";

type Member = { userId: string; username: string };
const field = "rounded border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-100";
const button = cn(ui.btnSmall, "min-w-0");

export function LocationChat({
  chat,
  members,
  oocMessages,
  asks,
  refreshAsks,
  dmUserId,
  globalTurnState,
  globalTurnEnabled = false,
}: {
  chat: LocationChatController;
  members: Member[];
  oocMessages: LocationChatController["page"]["messages"];
  asks: CampaignAsk[];
  refreshAsks: () => Promise<void>;
  dmUserId?: string | null;
  globalTurnState?: GlobalTurnState | null;
  globalTurnEnabled?: boolean;
}) {
  const { locale } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const selectedRef = useRef(chat.selected);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (selectedRef.current !== chat.selected || nearBottomRef.current) el.scrollTop = el.scrollHeight;
    selectedRef.current = chat.selected;
  }, [chat.selected, chat.page.messages, oocMessages, asks]);
  const t = localeText(locale, {
    en: { title: "Locations", locked: "Input locked while the MCP Dungeon Master is finishing the turn.", ooc: "OOC · everyone", oocShort: "OOC", archive: "Archive — you are not here. New messages are not available unless the DM grants perception.", live: "You are here", observing: "Perception granted", empty: "No messages you witnessed here yet.", send: "Send", do: "Do", ask: "Ask DM", narration: "Narrate", travel: "Go to", older: "Older", newest: "Latest", retry: "Retry unconfirmed command", controls: "DM location controls", create: "Create location", link: "Connect locations", move: "Move players", observe: "Grant perception", revoke: "Revoke", propagate: "Loud / visible incident", perceive: "Private perceived fragment", name: "Location name", source: "Source location", target: "Destination", players: "Players", walk: "Open passage", sound: "Sound can cross", sight: "Visible across boundary", speech: "Eavesdropping: future speech only", scry: "Magic: future scene", reason: "Adjudication / reason", seconds: "Duration in seconds", summary: "Only what the recipients perceive, not the private source conversation", apply: "Apply", who: "Present", noPosition: "Ask the DM to place your character. OOC is available.", draft: "Message", global: "OOC is global and does not advance the story.", bounded: "History contains only messages delivered to you. Entering does not unlock earlier visits or absence gaps.", stealth: "Stealth", stealthNotice: "Hidden action: only you see this until DM adjudication. Observers with high Passive Perception may notice.", stealthPending: "Stealth (Pending)", stealthConfirmed: "Stealth (Hidden)", stealthRevealed: "Revealed", stealthFailed: "Stealth Failed", perceptionBadge: "Perception", resolveStealth: "Resolve Stealth", outcome: "Outcome", confirmed: "Confirmed (Remains hidden)", revealed: "Revealed to all in room", failed: "Failed (Action aborted)", detectingPlayers: "Detecting players", perceivedFragment: "Perceived description for detectors", sense: "Sense", messageId: "Message ID (UUID)", both: "Both" },
    ru: { title: "Локации", locked: "Ввод закрыт, пока MCP-Мастер завершает ход.", ooc: "Вне игры · для всех", oocShort: "Вне игры", archive: "Архив — вас здесь нет. Новые сообщения недоступны без разрешённого ведущим восприятия.", live: "Вы здесь", observing: "Разрешено восприятие", empty: "Здесь пока нет сообщений, свидетелем которых вы были.", send: "Отправить", do: "Действие", ask: "Спросить Мастера", narration: "Повествование", travel: "Перейти", older: "Раньше", newest: "Последние", retry: "Повторить неподтверждённую команду", controls: "Управление локациями для ведущего", create: "Создать локацию", link: "Соединить локации", move: "Переместить игроков", observe: "Разрешить восприятие", revoke: "Отозвать", propagate: "Громкое / видимое событие", perceive: "Приватный фрагмент восприятия", name: "Название локации", source: "Исходная локация", target: "Куда", players: "Игроки", walk: "Открытый проход", sound: "Звук проходит", sight: "Есть видимость", speech: "Подслушивание: только будущая речь", scry: "Магия: будущие события сцены", reason: "Решение ведущего / причина", seconds: "Длительность в секундах", summary: "Только то, что воспринимают получатели, без приватного разговора внутри", apply: "Применить", who: "Присутствуют", noPosition: "Попросите ведущего разместить вашего персонажа. Режим «Вне игры» доступен.", draft: "Сообщение", global: "Режим «Вне игры» общий для всех и не продвигает сюжет.", bounded: "В истории только сообщения, доступные лично вам. Вход не открывает прошлые разговоры или пропущенные события.", stealth: "Скрытно", stealthNotice: "Скрытное действие: видите только вы до решения ведущего. Персонажи с высоким пассивным восприятием могут заметить.", stealthPending: "Скрытно (Ожидание)", stealthConfirmed: "Скрытно (Успех)", stealthRevealed: "Раскрыто", stealthFailed: "Провал скрытности", perceptionBadge: "Замечено", resolveStealth: "Разрешить скрытность", outcome: "Исход", confirmed: "Подтверждено (Скрыт)", revealed: "Раскрыто для всей комнаты", failed: "Провал (Действие сорвано)", detectingPlayers: "Заметившие игроки", perceivedFragment: "Что замечают наблюдатели", sense: "Чувство", messageId: "Идентификатор сообщения (UUID)", both: "Оба" },
  });
  const askText = localeText(locale, {
    en: { available: "Ask the DM without using a turn.", sendFailed: "Could not send your question.", networkFailed: "Could not reach the server." },
    ru: { available: "Вопрос Мастеру не тратит ход.", sendFailed: "Не удалось отправить вопрос.", networkFailed: "Не удалось связаться с сервером." },
  });
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("do");
  const [askScope, setAskScope] = useState<AskScope | "auto">("auto");
  const [askVisibility, setAskVisibility] = useState<AskVisibility>("private");
  const [askSending, setAskSending] = useState(false);
  const [askError, setAskError] = useState("");
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
  const canSend = kind === "ask" ? !view.isDm : !globalTurnLocked && (ooc || Boolean(selected && (view.isDm || active)));
  const memberName = (id: string | null) => members.find(member => member.userId === id)?.username ?? "—";
  const roomName = (id: string) => view.rooms.find(room => room.id === id)?.name ?? "—";
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !content.trim()) return;
    if (kind === "ask") {
      setAskSending(true);
      setAskError("");
      try {
        const response = await fetch(`/api/campaigns/${chat.campaignId}/ask`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: content, scope: askScope, visibility: askVisibility }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setAskError(data.error || askText.sendFailed);
          return;
        }
        setContent("");
        await refreshAsks();
      } catch {
        setAskError(askText.networkFailed);
      } finally {
        setAskSending(false);
      }
      return;
    }
    const isDm = Boolean(view?.enabled && view.isDm);
    const sendOoc = ooc || kind === "ooc";
    const revision = view?.enabled ? view.current?.revision : undefined;
    if (await chat.command({ operation: "send", roomId: sendOoc ? null : chat.selected,
      kind: sendOoc ? "ooc" : isDm ? "narration" : kind,
      content,
      ...(isStealth && !sendOoc && !isDm ? { stealth: true } : {}),
      ...(!sendOoc && !isDm && revision !== undefined ? { expectedRevision: revision } : {}) })) {
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
  const timeline = ooc
    ? [
        ...chat.page.messages.map(message => ({ kind: "message" as const, time: Date.parse(message.createdAt), message })),
        ...oocMessages.map(message => ({ kind: "message" as const, time: Date.parse(message.createdAt), message })),
        ...(!chat.showingOlder ? asks.map(ask => ({ kind: "ask" as const, time: Date.parse(ask.answeredAt ?? ask.createdAt), ask })) : []),
      ].sort((left, right) => left.time - right.time)
    : chat.page.messages.map(message => ({ kind: "message" as const, time: Date.parse(message.createdAt), message }));
  const renderMessage = (message: (typeof chat.page.messages)[number]) => {
    const isHaze = Boolean(message.stealth);
    const isPerception = message.kind === "perception";
    return (
      <article key={message.id} className={`border-b border-stone-800 pb-2 ${isHaze ? "rounded bg-indigo-950/20 border-l-2 border-indigo-500/60 pl-2 shadow-[0_0_12px_rgba(99,102,241,0.08)]" : isPerception ? "rounded bg-amber-950/20 border-l-2 border-amber-500/60 pl-2 shadow-[0_0_12px_rgba(245,158,11,0.08)]" : ""}`}>
        <header className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
          <span>{memberName(message.authorUserId)} · {message.kind === "ooc" ? t.oocShort : message.kind === "say" || message.kind === "do" ? t.do : isPerception ? t.observing : t.narration}</span>
          {isHaze ? <span className="inline-flex items-center rounded border border-indigo-700/50 bg-indigo-950/80 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
            {message.stealthStatus === "confirmed" ? t.stealthConfirmed : message.stealthStatus === "revealed" ? t.stealthRevealed : message.stealthStatus === "failed" ? t.stealthFailed : t.stealthPending}
          </span> : null}
          {isPerception ? <span className="inline-flex items-center rounded border border-amber-700/50 bg-amber-950/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">[{t.perceptionBadge}]</span> : null}
        </header>
        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
      </article>
    );
  };
  const sendBlocked = !canSend || (kind === "ask" ? askSending : chat.busy || chat.pending);
  return <><>{webMcp}</><section data-testid="location-chat" className="flex min-h-0 flex-1 flex-col gap-2 p-3 text-stone-200" aria-label={t.title}>
    <nav className="flex flex-wrap gap-2" aria-label={t.title}>
      <button type="button" className={cn(button, ooc && "border-amber-500/50 bg-amber-500/15 text-amber-100")} aria-pressed={ooc} onClick={() => { chat.select("ooc"); setKind("ooc"); }}>{t.ooc}</button>
      {view.rooms.map(room => <button data-testid={`location-room-${room.id}`} type="button" key={room.id} className={cn(button, chat.selected === room.id && "border-amber-500/50 bg-amber-500/15 text-amber-100")} aria-pressed={chat.selected === room.id}
        onClick={() => { chat.select(room.id); setKind(current => current === "ask" || current === "ooc" ? "do" : current); }}>{room.active ? "● " : ""}{room.name}</button>)}
    </nav>
    <p className="text-xs text-stone-400">
      {kind === "ask"
        ? askText.available
        : globalTurnLocked
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
    <div ref={scrollRef} onScroll={event => { const el = event.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }} className="min-h-36 flex-1 space-y-3 overflow-y-auto rounded border border-stone-800 p-3" aria-label={selected?.name ?? t.ooc}>
      <div className="flex gap-2">{chat.page.nextBefore ? <button type="button" className={button} onClick={chat.older}>{t.older}</button> : null}
        {chat.showingOlder ? <button type="button" className={button} onClick={chat.newest}>{t.newest}</button> : null}</div>
      {!timeline.length ? <p className="text-sm text-stone-500">{t.empty}</p> : null}
      {timeline.map(item => item.kind === "ask"
        ? <AskChatEntry key={`ask-${item.ask.id}`} ask={item.ask} askerName={memberName(item.ask.userId)} />
        : renderMessage(item.message))}
    </div>
    <p className="text-xs text-stone-500">{t.bounded}</p>
    <form onSubmit={send} className="flex flex-col gap-2">
      {!view.isDm ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select className={field} aria-label={t.draft} data-tour="ask-dm" value={kind} onChange={event => {
            const next = event.target.value;
            setKind(next);
            if (next === "ask" || next === "ooc") chat.select("ooc");
            if (next === "ask") setIsStealth(false);
          }}>
            {ooc ? <option value="ooc">{t.ooc}</option> : <option value="do">{t.do}</option>}
            <option value="ask">{t.ask}</option>
          </select>
          {kind === "do" ? <label className="flex items-center gap-1.5 text-xs cursor-pointer text-stone-300 select-none">
            <input
              type="checkbox"
              checked={isStealth}
              onChange={event => setIsStealth(event.target.checked)}
              disabled={!canSend}
              className="rounded border-stone-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span className={isStealth ? "font-semibold text-indigo-300" : ""}>{t.stealth}</span>
          </label> : null}
        </div>
      ) : null}
      {kind === "ask" ? <AskOptions scope={askScope} onScopeChange={setAskScope} visibility={askVisibility} onVisibilityChange={setAskVisibility} /> : null}
      {isStealth && !ooc && !view.isDm && kind === "do" ? (
        <p className="text-[11px] text-indigo-300/80 italic">{t.stealthNotice}</p>
      ) : null}
      <textarea
        className={`${field} ${isStealth && !ooc && !view.isDm ? "ring-1 ring-indigo-500/50 border-indigo-500/50 bg-gradient-to-r from-stone-950 via-slate-900/60 to-stone-950 shadow-[0_0_12px_rgba(99,102,241,0.15)] motion-safe:transition-all" : ""}`}
        aria-label={t.draft}
        value={content}
        onChange={event => setContent(event.target.value)}
        maxLength={kind === "ask" ? 500 : view.isDm && !ooc ? 8000 : 2000}
        rows={3}
        disabled={sendBlocked}
      />
      {askError ? <p role="alert" className="text-sm text-red-300">{askError}</p> : null}
      <button className={button} disabled={sendBlocked || !content.trim()}>{kind === "ask" ? t.ask : t.send}</button>
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
          <input className={field} aria-label={t.messageId} placeholder={t.messageId} value={stealthMsgId} onChange={event => setStealthMsgId(event.target.value)} required />
          <select className={field} value={outcome} onChange={event => setOutcome(event.target.value)} aria-label={t.outcome}>
            <option value="confirmed">{t.confirmed}</option>
            <option value="revealed">{t.revealed}</option>
            <option value="failed">{t.failed}</option>
          </select>
          <select className={field} value={sense} onChange={event => setSense(event.target.value)} aria-label={t.sense}>
            <option value="sight">{t.sight}</option>
            <option value="sound">{t.sound}</option>
            <option value="both">{t.both}</option>
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
