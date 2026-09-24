"use client";

import { BookOpen, ChevronUp, Clock, Eye, EyeOff, Loader2, Send, SkipForward, SlidersHorizontal, Swords, X } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import { DirectorArmedBanner, DirectorPresets } from "@/app/campaigns/[campaignId]/DirectorPanel";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import { AskOptions } from "@/app/campaigns/[campaignId]/AskPanel";
import type { CombatChoice, CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import type { BeatCadence } from "@/lib/dm/beat-cadence";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CampaignMember, GlobalTurnState, InputKind } from "@/lib/campaign-types";
import type { CombatInputModeSetting } from "@/lib/schemas/game-settings-options";
import { useI18n, type Locale } from "@/lib/i18n";
import { useSessionMobile, useSessionReading } from "./SessionViewport";
import { composerHeight, shouldSubmitComposerKey } from "./session-mobile";

export type { InputKind };

const KIND_TIPS: Record<Locale, Record<InputKind, string>> = {
  en: {
    do: "Act in the world. The DM narrates what happens.",
    say: "Speak in character. Sent as dialogue in quotes.",
    ooc: "Table talk. The DM does not respond, and it works even when the floor is locked.",
    ask: "Ask the DM without using a turn. Choose who can see the question and answer.",
    lead: "Party lead only. Send the DM an authoritative story direction.",
    narrate: "Dungeon Master only. Write the passage the table reads.",
  },
  ru: {
    do: "Действуйте в мире. Мастер опишет последствия.",
    say: "Говорите от лица персонажа. Текст отправится как прямая речь.",
    ooc: "Внеигровое обсуждение. Мастер не отвечает; режим работает даже при заблокированном ходе.",
    ask: "Задайте вопрос Мастеру без траты хода. Выберите, кому видны вопрос и ответ.",
    lead: "Только лидер группы. Отправьте Мастеру обязательное направление сюжета.",
    narrate: "Только Мастер. Напишите фрагмент повествования, который увидит стол.",
  },
};

const COPY = {
  en: {
    kinds: { do: "Do", say: "Say", ooc: "OOC", ask: "Ask DM", lead: "Direct", narrate: "Narrate" },
    statuses: { rolling: "DM rolling dice...", awaiting_rolls: "Waiting on real dice...", narrating: "DM narrating...", writing_chapter: "DM writing the chapter...", plotting_arc: "DM plotting the story arc...", default: "DM at work..." },
    privateOn: "Only the DM sees this. It steers the next turn and never enters the transcript.",
    privateOff: "The table sees this direction, and the DM acts on it now.", private: "Private",
    round: "Round #", acted: "acted", skip: "Skip", cancel: "Cancel", skipCount: "Number of turns to skip", skipTurns: "Skip turns", cancelSkips: "Cancel skips",
    combatLocked: "The DM is resolving and narrating the turn. Ask DM and OOC are available.",
    skipFailed: "Could not change skipped turns.", waiting: "MCP DM is finishing the turn — input locked", resolving: "MCP DM is resolving the round — input locked", remaining: "Remaining", noTimer: "(no timer, waiting for quorum)", firstAction: "(waiting for first action)",
    yourCombatTurn: "Your combat turn!", openBattleTab: "Battle Tab",
    mode: "Message mode", tools: "Turn details and controls", close: "Close turn details", read: "Read story without panels", send: "Send message", rolls: "Pending dice", locked: "Input locked", finishing: "DM finishing turn", ready: "Turn controls", draft: "Your draft is preserved.",
    combatTurns: { builder: "Configure actions and attacks in the Battle tab", freeform: "Describe your action in chat below or switch to the Battle tab", hybrid: "Configure in Battle tab or describe your action in chat below", queued: (n: number) => `${n} action${n === 1 ? "" : "s"} queued. Send here or in Battle tab` },
  },
  ru: {
    kinds: { do: "Действие", say: "Речь", ooc: "Вне игры", ask: "Спросить Мастера", lead: "Указание", narrate: "Повествование" },
    statuses: { rolling: "Мастер бросает кости...", awaiting_rolls: "Ожидание реальных бросков...", narrating: "Мастер ведёт повествование...", writing_chapter: "Мастер пишет главу...", plotting_arc: "Мастер планирует сюжетную арку...", default: "Мастер работает..." },
    privateOn: "Это видит только Мастер. Указание направляет следующий ход и не попадает в стенограмму.",
    privateOff: "Указание видит весь стол, и Мастер применяет его прямо сейчас.", private: "Приватно",
    round: "Раунд №", acted: "сходили", skip: "Пропуск", cancel: "Отмена", skipCount: "Количество ходов для пропуска", skipTurns: "Пропустить ходов", cancelSkips: "Отменить пропуск",
    combatLocked: "Мастер разрешает ход и готовит повествование. Пока доступны вопросы Мастеру и режим «Вне игры».",
    skipFailed: "Не удалось изменить пропуск ходов.", waiting: "Внешний мастер завершает ход — ввод закрыт", resolving: "Внешний мастер разрешает раунд — ввод закрыт", remaining: "Осталось", noTimer: "(без таймера, ждём кворум)", firstAction: "(ждём первого хода)",
    yourCombatTurn: "Ваш боевой ход!", openBattleTab: "Вкладка «Бой»",
    mode: "Режим сообщения", tools: "Подробности и управление ходом", close: "Закрыть подробности хода", read: "Читать историю без панелей", send: "Отправить сообщение", rolls: "Ожидаются броски", locked: "Ввод закрыт", finishing: "Мастер завершает ход", ready: "Управление ходом", draft: "Ваш черновик сохранён.",
    combatTurns: { builder: "Действия и атаки настраиваются во вкладке «Бой»", freeform: "Опишите действие в чате ниже или перейдите во вкладку «Бой»", hybrid: "Настройте кнопки во вкладке «Бой» или опишите ход текстом ниже", queued: (n: number) => `Запланировано действий: ${n}. Отправьте здесь или во вкладке «Бой»` },
  },
} as const;

function ComposerInner({
  campaignId, sheets, meUserId, steersStory, isDm, needsCharacter = false,
  kind, onKindChange, input, setInput, sending, error, inputBlocked, placeholder,
  dmStatus, pendingRolls, floor, spotlighted, heldSpotlightNames, encounter,
  onReleaseFloor, joinBanner, leadPrivate, onLeadPrivateChange, composerRef,
  directorArm, storyCadence, onCaptureStory, onSnoozeStory,
  members = [], globalTurnEnabled = false, globalTurnState = null,
  combatInputMode = "hybrid", combatChoices = [], onSubmit, onOpenBattleTab,
  askScope, onAskScopeChange, askVisibility, onAskVisibilityChange,
}: {
  campaignId: string; sheets: CampaignState["sheets"]; meUserId: string; steersStory: boolean;
  isDm: boolean; needsCharacter?: boolean; members?: CampaignMember[];
  globalTurnEnabled?: boolean; globalTurnState?: GlobalTurnState | null;
  combatInputMode?: CombatInputModeSetting; combatChoices?: CombatChoice[];
  kind: InputKind; onKindChange: (kind: InputKind) => void; input: string;
  setInput: Dispatch<SetStateAction<string>>; sending: boolean; error: string;
  inputBlocked: boolean; placeholder: string; dmStatus: CampaignState["dmStatus"];
  pendingRolls: CampaignState["pendingRolls"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  spotlighted: CampaignState["sheets"]; heldSpotlightNames: string[]; encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  leadPrivate: boolean; onLeadPrivateChange: (leadPrivate: boolean) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>; directorArm: CampaignState["directorArm"];
  storyCadence: BeatCadence; onCaptureStory: () => void; onSnoozeStory: () => void;
  onSubmit: (event: FormEvent) => void; onCombatSubmit?: (turn: CombatTurnIntent) => void;
  onOpenBattleTab?: () => void;
  askScope: AskScope | "auto"; onAskScopeChange: (scope: AskScope | "auto") => void;
  askVisibility: AskVisibility; onAskVisibilityChange: (visibility: AskVisibility) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const mobile = useSessionMobile();
  const { setReading } = useSessionReading();
  const trayId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const trayTriggerRef = useRef<HTMLButtonElement>(null);
  const dmStatusText = dmStatus === "idle" ? "" : copy.statuses[dmStatus as keyof typeof copy.statuses] ?? copy.statuses.default;
  const mySheet = sheets.find(s => s.userId === meUserId && !s.isCompanion);
  const myMember = members.find(m => m.userId === meUserId);
  const [now, setNow] = useState(() => Date.now());
  const [skipCount, setSkipCount] = useState(1);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipError, setSkipError] = useState("");

  useEffect(() => {
    if (!globalTurnEnabled || !globalTurnState?.deadlineAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [globalTurnEnabled, globalTurnState?.deadlineAt]);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const resize = () => {
      if (!mobile) { el.style.removeProperty("height"); return; }
      if (inputBlocked) return;
      el.style.height = "0px";
      el.style.height = `${composerHeight(el.scrollHeight, window.visualViewport?.height ?? window.innerHeight)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [input, kind, mobile, inputBlocked, composerRef]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || typeof ResizeObserver === "undefined") return;
    const column = form.parentElement;
    const transcript = column?.querySelector('[data-testid="campaign-messages"]');
    const measure = () => {
      const rect = form.getBoundingClientRect();
      form.style.setProperty("--odm-composer-height", `${rect.height}px`);
      if (column) form.style.setProperty("--odm-tray-space", `${Math.max(44, rect.top - column.getBoundingClientRect().top - 12)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    if (column) observer.observe(column);
    if (transcript) observer.observe(transcript);
    measure();
    return () => observer.disconnect();
  }, []);

  // This is a non-modal disclosure, not a second form. Its contents stay
  // mounted when closed: physical dice subscriptions/entered faces must survive.
  useEffect(() => {
    if (!mobile || !trayOpen) return;
    trayRef.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === "Escape") { event.preventDefault(); setTrayOpen(false); trayTriggerRef.current?.focus({ preventScroll: true }); }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // Radix popovers from existing controls are portalled outside this region.
      if (target instanceof Element && target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      if (!trayRef.current?.contains(target) && !trayTriggerRef.current?.contains(target)) setTrayOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, [mobile, trayOpen]);

  const msRemaining = globalTurnState?.deadlineAt ? Math.max(0, Date.parse(globalTurnState.deadlineAt) - now) : 0;
  const secsTotal = Math.floor(msRemaining / 1000);
  const formattedCountdown = `${String(Math.floor(secsTotal / 60)).padStart(2, "0")}:${String(secsTotal % 60).padStart(2, "0")}`;
  const playerSheets = sheets.filter(s => !s.isCompanion);
  const respondedPlayersCount = playerSheets.filter(s => {
    const usage = globalTurnState?.actionsByCharacter?.[s.id];
    if (usage && (usage.actionsCount > 0 || usage.phrasesCount > 0)) return true;
    return Boolean(members.find(m => m.userId === s.userId)?.skipTurnsCount);
  }).length;
  const globalTurnLocked = Boolean(globalTurnEnabled && globalTurnState && ["waiting", "ready", "resolving"].includes(globalTurnState.phase));
  const usage = mySheet && globalTurnState ? globalTurnState.actionsByCharacter[mySheet.id] : null;
  const heroActionsCount = usage?.actionsCount ?? 0;
  const heroPhrasesCount = usage?.phrasesCount ?? 0;
  const combatFloor = floor.mode === "hold" ? floor.next : floor;
  const initiativeFloor = combatFloor.mode === "initiative" ? combatFloor : null;
  const combatActive = Boolean(encounter?.orderReady && initiativeFloor);
  const ownCombatTurn = Boolean(initiativeFloor && mySheet && encounter?.currentActorId === mySheet.id && initiativeFloor.userIds.includes(meUserId));
  const combatLocked = floor.mode === "hold" && Boolean(floor.combat);
  const composerOptions: readonly InputKind[] = needsCharacter ? ["ask"] : isDm ? ["narrate", "ooc"]
    : combatActive || combatLocked ? ["do", "ask", "ooc"] : ["do", "ask", "ooc", ...(steersStory ? ["lead" as const] : [])];
  const optionLabel = (option: InputKind) => {
    const base = copy.kinds[option];
    if (!globalTurnEnabled || isDm || combatActive) return base;
    if (option === "do") return `${base} (${heroActionsCount}/1${heroActionsCount >= 1 ? " ✓" : ""})`;
    if (option === "say") return `${base} (${heroPhrasesCount}/1${heroPhrasesCount >= 1 ? " ✓" : ""})`;
    return base;
  };
  const canSend = !sending && !inputBlocked && Boolean(input.trim() || (ownCombatTurn && combatChoices.length));
  const submit = (event: FormEvent) => { event.preventDefault(); if (canSend) onSubmit(event); };
  const skipLocked = combatActive ? combatLocked : globalTurnLocked;
  async function handleSetSkip(count: number) {
    if (skipBusy) return;
    setSkipBusy(true); setSkipError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/members/me/skip-turns`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }),
      });
      if (!response.ok) throw new Error("skip refused");
    } catch { setSkipError(copy.skipFailed); } finally { setSkipBusy(false); }
  }
  const compactStatus = pendingRolls.length ? `${copy.rolls} · ${pendingRolls.length}`
    : combatLocked || globalTurnLocked ? copy.finishing
    : ownCombatTurn ? copy.yourCombatTurn
    : inputBlocked ? copy.locked
    : dmStatus !== "idle" ? dmStatusText
    : globalTurnEnabled && !isDm ? `${copy.round}${globalTurnState?.roundNumber ?? 1} · ${respondedPlayersCount}/${Math.max(1, playerSheets.length)}${globalTurnState?.deadlineAt ? ` · ${formattedCountdown}` : ""}`
    : copy.ready;

  return <form ref={formRef} onSubmit={submit} noValidate className="session-composer glass border-t border-stone-700/40 px-3 pb-3 pt-2.5" data-blocked={inputBlocked} data-tray-open={trayOpen}>
    <div className="mx-auto max-w-3xl sm:px-3">
      <span className="sr-only" role="status" aria-live="polite">{pendingRolls.length ? `${copy.rolls}: ${pendingRolls.length}` : combatLocked || globalTurnLocked ? copy.finishing : ownCombatTurn ? copy.yourCombatTurn : inputBlocked ? copy.locked : ""}</span>
      <div className="composer-mobile-bar">
        <select aria-label={copy.mode} value={kind} onChange={event => onKindChange(event.target.value as InputKind)} data-tour="composer-modes">
          {composerOptions.map(option => <option key={option} value={option}>{optionLabel(option)}</option>)}
        </select>
        <button ref={trayTriggerRef} type="button" className="composer-status" aria-label={`${copy.tools}: ${compactStatus}`}
          aria-expanded={trayOpen} aria-controls={trayId} onClick={() => setTrayOpen(open => !open)}>
          {dmStatus !== "idle" ? <D20Spinner className="size-4 shrink-0" /> : <SlidersHorizontal className="size-4 shrink-0" />}
          <span>{compactStatus}</span><ChevronUp aria-hidden="true" className="size-3 shrink-0" />
        </button>
        <button type="button" className="session-icon-button" aria-label={copy.read} title={copy.read} onClick={() => { setTrayOpen(false); setReading(true); }}><BookOpen className="size-5" /></button>
      </div>

      <div id={trayId} ref={trayRef} className="composer-tray" role="region" aria-label={copy.tools} tabIndex={-1}>
        <div className="composer-tray-heading"><strong>{copy.tools}</strong><button type="button" className="session-icon-button" aria-label={copy.close}
          onClick={() => { setTrayOpen(false); trayTriggerRef.current?.focus({ preventScroll: true }); }}><X className="size-5" /></button></div>
        {inputBlocked ? <p className="composer-block-reason text-sm text-stone-300">{placeholder}{input ? ` ${copy.draft}` : ""}</p> : null}
        {pendingRolls.map(pending => <PendingRollCard key={pending.id} campaignId={campaignId} pending={pending} sheets={sheets} meUserId={meUserId} steersStory={steersStory} />)}
        <FloorBanners floor={floor} spotlighted={spotlighted} heldSpotlightNames={heldSpotlightNames} encounter={encounter} steersStory={steersStory} onRelease={onReleaseFloor} />
        <DirectorArmedBanner campaignId={campaignId} steersStory={steersStory} armed={directorArm} />
        <StoryNudge cadence={storyCadence} onCapture={onCaptureStory} onSnooze={onSnoozeStory} />
        {joinBanner ? <NewAdventurerBanner campaignId={campaignId} text={joinBanner.text} onWriteIntro={joinBanner.onWriteIntro} onDismiss={joinBanner.onDismiss} /> : null}
        {globalTurnEnabled && !isDm && !combatActive ? <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/25 px-2.5 py-1.5 text-xs text-amber-200">
          <Clock className="size-3.5" /><span>{copy.round}{globalTurnState?.roundNumber ?? 1}</span>
          <span>({respondedPlayersCount}/{Math.max(1, playerSheets.length)} {copy.acted})</span>
          <span>{globalTurnState?.phase === "waiting" ? copy.waiting : globalTurnLocked ? copy.resolving
            : globalTurnState?.deadlineAt ? `${copy.remaining}: ${formattedCountdown}` : globalTurnState?.firstActionAt ? copy.noTimer : copy.firstAction}</span>
        </div> : null}
        {combatLocked && !isDm ? <p role="status" className="mb-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-200">{copy.combatLocked}</p> : null}
        {(combatActive || globalTurnEnabled) && !isDm ? <div className="composer-skip mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2">{copy.skipTurns}<input type="number" min={1} max={combatActive ? 20 : 99} value={skipCount} disabled={skipLocked}
            aria-label={copy.skipCount} onChange={event => setSkipCount(Math.max(1, Math.min(combatActive ? 20 : 99, Number(event.target.value) || 1)))}
            className="w-14 rounded border border-stone-700 bg-stone-900 p-1.5" /></label>
          <button type="button" disabled={skipBusy || skipLocked} onClick={() => void handleSetSkip(Math.min(combatActive ? 20 : 99, skipCount))} className={ui.btnSmall}><SkipForward className="size-3" />{copy.skip}</button>
          {myMember && myMember.skipTurnsCount > 0 ? <button type="button" disabled={skipBusy || (!combatActive && globalTurnLocked)} onClick={() => void handleSetSkip(0)} className={ui.btnSmall}>{copy.cancelSkips} ({myMember.skipTurnsCount})</button> : null}
        </div> : null}
      {ownCombatTurn && !combatLocked && encounter && mySheet ? <div className="composer-battle mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-600/60 bg-amber-950/40 p-2.5 text-xs text-amber-100">
        <div className="composer-battle-description min-w-0"><strong>{copy.yourCombatTurn}</strong> — {combatChoices.length ? copy.combatTurns.queued(combatChoices.length) : copy.combatTurns[combatInputMode]}</div>
        {onOpenBattleTab ? <button type="button" onClick={onOpenBattleTab} className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-400 px-2.5 py-1 font-semibold text-stone-950"><Swords className="size-3" />{copy.openBattleTab} ↗</button> : null}
      </div> : null}
      </div>

      <div className="composer-desktop-modes mb-2 flex flex-wrap gap-1.5" data-tour="composer-modes">
        {composerOptions.map(option => <Tooltip key={option} content={KIND_TIPS[locale][option]}><button type="button" onClick={() => onKindChange(option)} aria-pressed={kind === option}
          data-tour={option === "ask" ? "ask-dm" : undefined} className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors",
            kind === option ? option === "lead" ? "bg-gradient-to-b from-ember-400 to-ember-600 text-stone-950 shadow-glow-ember" : "bg-gradient-to-b from-amber-100 to-amber-400 text-amber-950 shadow-glow-gold"
              : "bg-stone-900/80 text-stone-400 hover:bg-stone-800 hover:text-stone-200", globalTurnEnabled && !isDm && option === "do" && heroActionsCount >= 1 && "opacity-60")}>{optionLabel(option)}</button></Tooltip>)}
        {dmStatus !== "idle" ? <span className="ml-auto flex items-center gap-1.5 text-xs text-stone-500"><D20Spinner className="size-3.5 shrink-0 text-amber-600" />{dmStatusText}</span> : null}
      </div>
      {kind === "ask" ? <div className="composer-kind-options mb-2"><AskOptions scope={askScope} onScopeChange={onAskScopeChange} visibility={askVisibility} onVisibilityChange={onAskVisibilityChange} /></div> : null}
      {kind === "lead" && steersStory ? <div className="composer-kind-options mb-2 flex flex-wrap items-center gap-1.5">
        <DirectorPresets campaignId={campaignId} />
        <Tooltip content={leadPrivate ? copy.privateOn : copy.privateOff}><button type="button" role="switch" aria-checked={leadPrivate} onClick={() => onLeadPrivateChange(!leadPrivate)}
          className={cn(ui.btnSmall, "ml-auto px-2 py-1 text-[11px]", leadPrivate && "border-amber-500/50 bg-amber-500/10 text-amber-100")}>
          {leadPrivate ? <EyeOff className="size-3" /> : <Eye className="size-3" />}{copy.private}
        </button></Tooltip>
      </div> : null}
      {skipError ? <p role="alert" className="mb-2 text-xs text-red-300">{skipError}</p> : null}
      <div data-tour="composer-input" className="composer-input texture-noise flex items-end gap-2 rounded-2xl border border-stone-700/70 bg-stone-950/90 p-2 shadow-elev-1 focus-within:border-amber-400/60">
        <textarea ref={composerRef} value={input} onChange={event => setInput(event.target.value)} onFocus={() => setTrayOpen(false)}
          onKeyDown={event => {
            if (shouldSubmitComposerKey({ key: event.key, shift: event.shiftKey, modifier: event.ctrlKey || event.metaKey, composing: event.nativeEvent.isComposing || event.keyCode === 229, mobile })) submit(event);
          }} maxLength={kind === "ask" ? 500 : undefined} rows={mobile ? 1 : 2} disabled={inputBlocked} placeholder={placeholder} aria-label={copy.kinds[kind]}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-stone-200 outline-none disabled:opacity-50" />
        <PushToTalk disabled={inputBlocked} onTranscript={text => setInput(current => current ? `${current} ${text}` : text)} />
        <button type="submit" aria-label={copy.send} disabled={!canSend} className="composer-send rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 p-2.5 text-amber-950 disabled:opacity-40">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
      {error ? <p role="alert" className="mt-1.5 text-sm text-red-400">{error}</p> : null}
    </div>
  </form>;
}

export const Composer = memo(ComposerInner);
