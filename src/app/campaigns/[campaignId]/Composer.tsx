"use client";

import { ChevronDown, Clock, Eye, EyeOff, Loader2, Send, SkipForward, Swords } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { D20Spinner } from "@/components/ui/D20Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { FloorBanners } from "@/app/campaigns/[campaignId]/FloorBanners";
import { NewAdventurerBanner } from "@/app/campaigns/[campaignId]/NewAdventurerBanner";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import { PendingRollCard } from "@/app/campaigns/[campaignId]/PendingRollCard";
import { ActionPreviewDialog } from "@/app/campaigns/[campaignId]/ActionPreviewDialog";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import { StoryNudge } from "@/app/campaigns/[campaignId]/StoryNudge";
import { AskOptions } from "@/app/campaigns/[campaignId]/AskPanel";
import type { CombatChoice, CombatTurnIntent } from "@/lib/dm/combat-turn-intent";
import type { BeatCadence } from "@/lib/dm/beat-cadence";
import type { AskScope, AskVisibility } from "@/lib/dm/ask-logic";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

import { globalTurnSubmitted, type CampaignMember, type GlobalTurnState, type InputKind } from "@/lib/campaign-types";
import type { CombatInputModeSetting } from "@/lib/schemas/game-settings-options";
import type { Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n";
import { avatarPlaceholder, characterPlaceholder } from "@/lib/placeholders";

export type { InputKind };

const KIND_TIPS: Record<Locale, Record<InputKind, string>> = {
  en: {
    do: "Describe what your character does or says. The DM narrates what happens.",
    ooc: "Table talk. The DM does not respond, and it works even when the floor is locked.",
    ask: "Ask the DM without using a turn. Choose who can see the question and answer.",
    lead: "Party lead only. Send the DM an authoritative story direction.",
    narrate: "Dungeon Master only. Write the passage the table reads.",
  },
  ru: {
    do: "Опишите, что персонаж делает или говорит. Мастер опишет последствия.",
    ooc: "Внеигровое обсуждение. Мастер не отвечает; режим работает даже при заблокированном ходе.",
    ask: "Задайте вопрос Мастеру без траты хода. Выберите, кому видны вопрос и ответ.",
    lead: "Только лидер группы. Отправьте Мастеру обязательное направление сюжета.",
    narrate: "Только Мастер. Напишите фрагмент повествования, который увидит стол.",
  },
};

const COPY = {
  en: {
    hideChat: "Hide chat",
    showChat: "Show chat",
    kinds: { do: "Do", ooc: "OOC", ask: "Ask DM", lead: "Direct", narrate: "Narrate" },
    statuses: {
      rolling: "DM rolling dice...",
      awaiting_rolls: "Waiting on real dice...",
      narrating: "DM narrating...",
      writing_chapter: "DM writing the chapter...",
      plotting_arc: "DM plotting the story arc...",
      default: "DM at work...",
    },
    privateOn: "Only the DM sees this. It steers the next turn and never enters the transcript.",
    privateOff: "The table sees this direction, and the DM acts on it now.",
    private: "Private",
    round: "Round #", acted: "acted", skip: "Skip", cancel: "Cancel", skipCount: "Number of turns to skip (1–99)", skipN: "Skip N turns",
    combatLocked: "The DM is resolving and narrating the turn. Ask DM and OOC are available.", skipTurns: "Skip turns", cancelSkips: "Cancel skips",
    skipFailed: "Could not change skipped turns.", waiting: "MCP DM is finishing the turn — input locked", resolving: "MCP DM is resolving the round — input locked", remaining: "Remaining", noTimer: "(no timer, waiting for quorum)", firstAction: "(waiting for first action)",
    yourCombatTurn: "Your combat turn!",
    openBattleTab: "Battle Tab",
    combatTurns: {
      builder: "Configure actions and attacks in the Battle tab",
      freeform: "Describe your action in chat below or switch to the Battle tab",
      hybrid: "Configure in Battle tab or describe your action in chat below",
      queued: (n: number) => `${n} action${n === 1 ? "" : "s"} queued. Send here or in Battle tab`,
    },
  },
  ru: {
    hideChat: "Скрыть чат",
    showChat: "Показать чат",
    kinds: { do: "Действие", ooc: "Вне игры", ask: "Спросить Мастера", lead: "Указание", narrate: "Повествование" },
    statuses: {
      rolling: "Мастер бросает кости...",
      awaiting_rolls: "Ожидание реальных бросков...",
      narrating: "Мастер ведёт повествование...",
      writing_chapter: "Мастер пишет главу...",
      plotting_arc: "Мастер планирует сюжетную арку...",
      default: "Мастер работает...",
    },
    privateOn: "Это видит только Мастер. Указание направляет следующий ход и не попадает в стенограмму.",
    privateOff: "Указание видит весь стол, и Мастер применяет его прямо сейчас.",
    private: "Приватно",
    round: "Раунд №", acted: "сходили", skip: "Пропуск", cancel: "Отмена", skipCount: "Количество ходов для пропуска (1–99)", skipN: "Пропустить N ходов",
    combatLocked: "Мастер разрешает ход и готовит повествование. Пока доступны вопросы Мастеру и режим «Вне игры».", skipTurns: "Пропустить ходов", cancelSkips: "Отменить пропуск",
    skipFailed: "Не удалось изменить пропуск ходов.", waiting: "Внешний мастер завершает ход — ввод закрыт", resolving: "Внешний мастер разрешает раунд — ввод закрыт", remaining: "Осталось", noTimer: "(без таймера, ждём кворум)", firstAction: "(ждём первого хода)",
    yourCombatTurn: "Ваш боевой ход!",
    openBattleTab: "Вкладка «Бой»",
    combatTurns: {
      builder: "Действия и атаки настраиваются во вкладке «Бой»",
      freeform: "Опишите действие в чате ниже или перейдите во вкладку «Бой»",
      hybrid: "Настройте кнопки во вкладке «Бой» или опишите ход текстом ниже",
      queued: (n: number) => `Запланировано действий: ${n}. Отправьте здесь или во вкладке «Бой»`,
    },
  },
} as const;

// The action composer at the bottom of the game chat: pending-roll cards,
// floor banners, the join notice, kind pills and the input row.
function ComposerInner({
  campaignId,
  sheets,
  meUserId,
  steersStory,
  isDm,
  needsCharacter = false,
  kind,
  onKindChange,
  input,
  setInput,
  sending,
  error,
  inputBlocked,
  placeholder,
  dmStatus,
  pendingRolls,
  floor,
  spotlighted,
  heldSpotlightNames,
  encounter,
  onReleaseFloor,
  joinBanner,
  leadPrivate,
  onLeadPrivateChange,
  composerRef,
  directorArm,
  storyCadence,
  onCaptureStory,
  onSnoozeStory,
  members = [],
  globalTurnEnabled = false,
  globalTurnState = null,
  combatInputMode = "hybrid",
  combatChoices = [],
  onSubmit,
  onCombatSubmit,
  onOpenBattleTab,
  askScope,
  onAskScopeChange,
  askVisibility,
  onAskVisibilityChange,
}: {
  campaignId: string;
  sheets: CampaignState["sheets"];
  meUserId: string;
  steersStory: boolean;
  // The DM seat: narrates instead of acting, and never runs a character.
  isDm: boolean;
  needsCharacter?: boolean;
  members?: CampaignMember[];
  globalTurnEnabled?: boolean;
  globalTurnState?: GlobalTurnState | null;
  combatInputMode?: CombatInputModeSetting;
  combatChoices?: CombatChoice[];
  kind: InputKind;
  onKindChange: (kind: InputKind) => void;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  sending: boolean;
  error: string;
  inputBlocked: boolean;
  placeholder: string;
  dmStatus: CampaignState["dmStatus"];
  pendingRolls: CampaignState["pendingRolls"];
  floor: Parameters<typeof FloorBanners>[0]["floor"];
  spotlighted: CampaignState["sheets"];
  heldSpotlightNames: string[];
  encounter: CampaignState["encounter"];
  onReleaseFloor: () => Promise<void>;
  joinBanner: { text: string; onWriteIntro: () => void; onDismiss: () => void } | null;
  leadPrivate: boolean;
  onLeadPrivateChange: (leadPrivate: boolean) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  directorArm: CampaignState["directorArm"];
  storyCadence: BeatCadence;
  onCaptureStory: () => void;
  onSnoozeStory: () => void;
  onSubmit: (event: FormEvent | null, confirmedContent?: string) => void;
  onCombatSubmit?: (turn: CombatTurnIntent) => void;
  onOpenBattleTab?: () => void;
  askScope: AskScope | "auto";
  onAskScopeChange: (scope: AskScope | "auto") => void;
  askVisibility: AskVisibility;
  onAskVisibilityChange: (visibility: AskVisibility) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [chatExpanded, setChatExpanded] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);

  const dmStatusText =
    dmStatus === "rolling"
      ? copy.statuses.rolling
      : dmStatus === "awaiting_rolls"
        ? copy.statuses.awaiting_rolls
        : dmStatus === "narrating"
          ? copy.statuses.narrating
          : dmStatus === "writing_chapter"
            ? copy.statuses.writing_chapter
            : dmStatus === "plotting_arc"
              ? copy.statuses.plotting_arc
              : copy.statuses.default;

  const mySheet = sheets.find((s) => s.userId === meUserId && !s.isCompanion);
  const myMember = members.find((m) => m.userId === meUserId);
  const portraitUrl = mySheet?.portrait?.url ?? myMember?.avatar?.url ?? (mySheet
    ? characterPlaceholder({ race: mySheet.race, class: mySheet.class, gender: mySheet.gender })
    : avatarPlaceholder(meUserId));
  const [now, setNow] = useState(() => new Date().getTime());
  const [skipCount, setSkipCount] = useState(1);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipError, setSkipError] = useState("");

  useEffect(() => {
    if (!globalTurnEnabled || !globalTurnState?.deadlineAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [globalTurnEnabled, globalTurnState?.deadlineAt]);

  const msRemaining = globalTurnState?.deadlineAt
    ? Math.max(0, new Date(globalTurnState.deadlineAt).getTime() - now)
    : 0;
  const secsTotal = Math.floor(msRemaining / 1000);
  const countdownMinutes = Math.floor(secsTotal / 60);
  const countdownSeconds = secsTotal % 60;
  const formattedCountdown = `${String(countdownMinutes).padStart(2, "0")}:${String(countdownSeconds).padStart(2, "0")}`;

  const playerSheets = sheets.filter((s) => !s.isCompanion);
  const respondedPlayersCount = playerSheets.filter((s) => {
    const u = globalTurnState?.actionsByCharacter?.[s.id];
    if (globalTurnSubmitted(u)) return true;
    const mem = members.find((m) => m.userId === s.userId);
    return Boolean(mem && mem.skipTurnsCount > 0);
  }).length;

  const globalTurnLocked = Boolean(
    globalTurnEnabled &&
      globalTurnState &&
      ["waiting", "ready", "resolving"].includes(globalTurnState.phase),
  );
  const usage = mySheet && globalTurnState ? globalTurnState.actionsByCharacter[mySheet.id] : null;
  const heroResponded = globalTurnSubmitted(usage);
  const combatFloor = floor.mode === "hold" ? floor.next : floor;
  const initiativeFloor = combatFloor.mode === "initiative" ? combatFloor : null;
  const combatActive = Boolean(encounter?.orderReady && initiativeFloor);
  const ownCombatTurn = Boolean(initiativeFloor && mySheet && encounter?.currentActorId === mySheet.id && initiativeFloor.userIds.includes(meUserId));
  const combatLocked = floor.mode === "hold" && Boolean(floor.combat);
  const composerOptions = needsCharacter
    ? (["ask"] as const)
    : isDm
    ? (["narrate", "ooc"] as const)
    : combatActive || combatLocked
      ? (["do", "ask", "ooc"] as const)
      : (["do", "ask", "ooc", ...(steersStory ? (["lead"] as const) : [])] as const);

  async function handleSetSkip(count: number) {
    setSkipBusy(true);
    setSkipError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/members/me/skip-turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      if (!response.ok) throw new Error("skip refused");
    } catch {
      setSkipError(copy.skipFailed);
    } finally {
      setSkipBusy(false);
    }
  }

  const optionLabel = (opt: InputKind) => {
    const base = copy.kinds[opt];
    if (!globalTurnEnabled || isDm || combatActive) return base;
    if (opt === "do") return `${base} (${heroResponded ? 1 : 0}/1${heroResponded ? " ✓" : ""})`;
    return base;
  };

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (kind === "do" && !sending && !inputBlocked && (input.trim() || (ownCombatTurn && combatChoices.length > 0))) {
      setPreview(input.trim());
      return;
    }
    onSubmit(event);
  }

  function editPreview() {
    setPreview(null);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  // Native disclosure keeps the form and pending dice mounted while hidden.
  return (
    <details
      open={chatExpanded}
      onToggle={(event) => setChatExpanded(event.currentTarget.open)}
      className="shrink-0 border-t border-stone-700/40 bg-stone-950/80"
      data-tour="table-chat-toggle"
    >
      <summary className="flex min-h-11 cursor-pointer select-none list-none items-center justify-end gap-2 px-4 py-2 text-xs font-medium text-amber-200 hover:bg-stone-900/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 [&::-webkit-details-marker]:hidden">
        {chatExpanded ? copy.hideChat : copy.showChat}
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0", !chatExpanded && "rotate-180")} />
      </summary>
    <form onSubmit={handleSubmit} className="glass max-h-[75dvh] overflow-y-auto border-t border-stone-700/40 px-3 pb-3 pt-2.5">
      <div className="mx-auto max-w-3xl sm:px-3">
        {pendingRolls.map((pending) => (
          <PendingRollCard
            key={pending.id}
            campaignId={campaignId}
            pending={pending}
            sheets={sheets}
            meUserId={meUserId}
            steersStory={steersStory}
          />
        ))}
        <FloorBanners
          floor={floor}
          spotlighted={spotlighted}
          heldSpotlightNames={heldSpotlightNames}
          encounter={encounter}
          steersStory={steersStory}
          onRelease={onReleaseFloor}
        />
        <DirectorArmedBanner campaignId={campaignId} steersStory={steersStory} armed={directorArm} />
        <StoryNudge cadence={storyCadence} onCapture={onCaptureStory} onSnooze={onSnoozeStory} />
        {joinBanner ? (
          <NewAdventurerBanner
            campaignId={campaignId}
            text={joinBanner.text}
            onWriteIntro={joinBanner.onWriteIntro}
            onDismiss={joinBanner.onDismiss}
          />
        ) : null}

        {/* Global Turn Player Banner */}
        {globalTurnEnabled && !isDm && !combatActive ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/50 bg-amber-950/25 px-2.5 py-1.5 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-medium">
              <Clock className="size-3.5 text-amber-400" />
              <span>{copy.round}{globalTurnState?.roundNumber ?? 1}</span>
              <span className="text-[11px] text-stone-400">
                ({respondedPlayersCount}/{Math.max(1, playerSheets.length)} {copy.acted})
              </span>
              {globalTurnState?.phase === "waiting" ? (
                <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[11px] text-amber-200">
                  {copy.waiting}
                </span>
              ) : globalTurnState?.phase === "ready" || globalTurnState?.phase === "resolving" ? (
                <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[11px] text-amber-200">
                  {copy.resolving}
                </span>
              ) : globalTurnState?.deadlineAt ? (
                <span
                  className={cn(
                    "rounded bg-stone-900/90 px-1.5 py-0.5 font-mono text-[11px]",
                    secsTotal <= 60 ? "text-red-400 animate-pulse" : "text-amber-300",
                  )}
                >
                  {copy.remaining}: {formattedCountdown}
                </span>
              ) : (
                <span className="text-[11px] italic text-stone-400">
                  {globalTurnState?.firstActionAt ? copy.noTimer : copy.firstAction}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Skip turns controls */}
              {myMember && myMember.skipTurnsCount > 0 ? (
                <div className="flex items-center gap-1 rounded border border-amber-700/60 bg-amber-950/50 px-1.5 py-0.5 text-[11px]">
                  <span>⏭️ {copy.skip} ({myMember.skipTurnsCount})</span>
                  <button
                    type="button"
                    disabled={skipBusy || globalTurnLocked}
                    onClick={() => void handleSetSkip(0)}
                    className="text-[10px] text-stone-400 hover:text-red-300 underline"
                  >
                    {copy.cancel}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={skipCount}
                    disabled={globalTurnLocked}
                    onChange={(e) => setSkipCount(Math.max(1, Math.min(99, Number(e.target.value))))}
                    className="w-10 rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-center text-[11px] text-stone-200"
                    title={copy.skipCount}
                  />
                  <button
                    type="button"
                    disabled={skipBusy || globalTurnLocked}
                    onClick={() => void handleSetSkip(skipCount)}
                    className="flex items-center gap-0.5 rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-[11px] text-stone-300 hover:text-stone-100"
                    title={copy.skipN}
                  >
                    <SkipForward className="size-3" /> {copy.skip}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="mb-2 flex flex-wrap gap-1.5" data-tour="composer-modes">
          {composerOptions.map((option) => (
            <Tooltip key={option} content={KIND_TIPS[locale][option]}>
              <button
                type="button"
                onClick={() => onKindChange(option)}
                data-tour={option === "ask" ? "ask-dm" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-xs font-medium transition-all duration-150 ease-snap active:scale-95 sm:px-3 sm:py-1",
                  kind === option
                    ? option === "lead"
                      ? "bg-gradient-to-b from-ember-400 to-ember-600 text-stone-950 shadow-glow-ember"
                      : "bg-gradient-to-b from-amber-100 to-amber-400 text-amber-950 shadow-glow-gold"
                    : "bg-stone-900/80 text-stone-400 hover:bg-stone-800 hover:text-stone-200",
                  globalTurnEnabled && !isDm && option === "do" && heroResponded && "opacity-60",
                )}
              >
                {optionLabel(option)}
              </button>
            </Tooltip>
          ))}
          {dmStatus !== "idle" ? (
            <span role="status" aria-live="polite" className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
              <D20Spinner className="size-3.5 shrink-0 text-amber-600" />
              {dmStatusText}
            </span>
          ) : null}
        </div>
        {kind === "ask" ? (
          <div className="mb-2">
            <AskOptions scope={askScope} onScopeChange={onAskScopeChange} visibility={askVisibility} onVisibilityChange={onAskVisibilityChange} />
          </div>
        ) : null}
        {kind === "lead" && steersStory ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <DirectorPresets campaignId={campaignId} />
            <Tooltip content={leadPrivate ? copy.privateOn : copy.privateOff}>
              <button
                type="button"
                role="switch"
                aria-checked={leadPrivate}
                onClick={() => onLeadPrivateChange(!leadPrivate)}
                className={cn(
                  ui.btnSmall,
                  "ml-auto px-2 py-1 text-[11px]",
                  leadPrivate && "border-amber-500/50 bg-amber-500/10 text-amber-100",
                )}
              >
                {leadPrivate ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                {copy.private}
              </button>
            </Tooltip>
          </div>
        ) : null}
        {combatLocked && !isDm ? <p role="status" className="mb-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-200">{copy.combatLocked}</p> : null}
        {combatActive && !isDm ? <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2">{copy.skipTurns}<input type="number" min={1} max={20} value={skipCount} onChange={(event) => setSkipCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} className="w-14 rounded border border-stone-700 bg-stone-900 p-1.5" /></label>
          <button type="button" disabled={skipBusy || (floor.mode === "hold" && !!floor.combat)} onClick={() => void handleSetSkip(skipCount)} className={ui.btnSmall}><SkipForward className="size-3" />{copy.skip}</button>
          {myMember && myMember.skipTurnsCount > 0 ? <button type="button" disabled={skipBusy} onClick={() => void handleSetSkip(0)} className={ui.btnSmall}>{copy.cancelSkips} ({myMember.skipTurnsCount})</button> : null}
        </div> : null}
        {skipError ? <p role="alert" className="mb-2 text-xs text-red-300">{skipError}</p> : null}
        {ownCombatTurn && encounter && mySheet ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-600/60 bg-gradient-to-r from-amber-950/80 via-stone-900/90 to-amber-950/80 p-2.5 text-xs text-amber-100 shadow-elev-1">
            <div className="flex items-center gap-2 min-w-0">
              <Swords className="size-4 shrink-0 text-amber-400 animate-pulse" />
              <span className="truncate">
                <strong className="text-amber-200">{copy.yourCombatTurn}</strong> —{" "}
                {combatChoices && combatChoices.length > 0
                  ? copy.combatTurns.queued(combatChoices.length)
                  : copy.combatTurns[combatInputMode ?? "hybrid"]}
              </span>
            </div>
            {onOpenBattleTab ? (
              <button
                type="button"
                onClick={onOpenBattleTab}
                className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-400 px-2.5 py-1 text-xs font-semibold text-stone-950 hover:bg-amber-300 transition-colors shadow-sm"
              >
                <Swords className="size-3" />
                {copy.openBattleTab} ↗
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          data-tour="composer-input"
          className="texture-noise flex items-end gap-2 rounded-2xl border border-stone-700/70 bg-stone-950/90 p-2 shadow-elev-1 transition-[border-color,box-shadow] duration-200 focus-within:border-amber-400/60 focus-within:shadow-[0_0_0_3px_rgba(212,171,58,0.1),0_2px_12px_rgba(4,2,12,0.5)]"
        >
          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
            maxLength={kind === "ask" ? 500 : undefined}
            rows={2}
            disabled={inputBlocked}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-stone-200 outline-none disabled:opacity-50"
          />
          <PushToTalk
            disabled={inputBlocked}
            onTranscript={(text) => setInput((current) => (current ? `${current} ${text}` : text))}
          />
          <button
            type="submit"
            disabled={
              sending ||
              (!input.trim() && !(ownCombatTurn && combatChoices && combatChoices.length > 0)) ||
              inputBlocked
            }
            className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 p-2.5 text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all duration-150 ease-snap hover:-translate-y-px hover:shadow-glow-gold-strong active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        {error ? <p className="mt-1.5 text-sm text-red-400">{error}</p> : null}
      </div>
    </form>
    {preview !== null ? (
      <ActionPreviewDialog
        content={preview}
        name={mySheet?.name ?? myMember?.username ?? (locale === "ru" ? "Игрок" : "Player")}
        portraitUrl={portraitUrl}
        locale={locale}
        queuedActions={ownCombatTurn ? combatChoices.length : 0}
        onEdit={editPreview}
        onSend={() => { setPreview(null); onSubmit(null, preview); }}
        disabled={sending || inputBlocked}
      />
    ) : null}
    </details>
  );
}

export const Composer = memo(ComposerInner);
