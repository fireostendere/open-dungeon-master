"use client";

import { Bot, Clock, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { globalTurnSubmitted, type CampaignMember, type GlobalTurnState } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { LeadCampaign } from "@/app/campaigns/[campaignId]/LeadPanel";

export function GlobalTurnCard({
  campaignId,
  campaign,
  members,
  sheets,
  isLead,
  meUserId,
}: {
  campaignId: string;
  campaign: LeadCampaign & { globalTurnState?: GlobalTurnState };
  members: CampaignMember[];
  sheets: CharacterSheet[];
  isLead: boolean;
  meUserId: string;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Global Turn & Cadence",
      enabled: "Enable global turn mode",
      desc: "Synchronizes party turns: one submission per hero per round.",
      slider1: "Turn collection window",
      slider1Hint: "0 = no timeout; the round then closes only by quorum.",
      slider2: "Quorum of players",
      slider2Hint: "When Y players answer, deadline accelerates",
      slider3: "Input grace delay",
      slider3Hint: "0 = close immediately when quorum is reached.",
      min: "min",
      players: "players",
      round: "Round",
      waitingTrigger: "Input locked — waiting for the MCP Dungeon Master to open the round.",
      waitingFirst: "Round open — waiting for any player's first action...",
      waitingQuorum: "No time limit — waiting for quorum.",
      mcpResolving: "Round sealed — MCP Dungeon Master is resolving it.",
      unlimited: "∞",
      timeRemaining: "Time remaining",
      responded: "Answered",
      startRound: "Start round",
      reopenRound: "Re-open input",
      startingRound: "Starting...",
      startRoundHint: "Recovery control: opens the current round without changing its number. If already open, it re-publishes the round and clears a stale non-combat floor lock.",
      startRoundError: "Could not start the round.",
      respondNow: "Request response now",
      respondError: "Could not request a response.",
      optInSelf: "Only this player can enable autopilot",
      autopilotTitle: "Party Autopilot (Doppelganger)",
      autopilotHint: "Players opt in for themselves; the lead may switch it off. In sequential mode, AI acts when spotlighted.",
      on: "ON",
      off: "Off",
      acted: "Acted",
      waiting: "Waiting",
      skipped: "Skipping",
      playerFallback: "player",
    },
    ru: {
      title: "Общий ход стола",
      enabled: "Включить общий ход",
      desc: "Синхронизирует ходы отряда: одна отправка от героя за раунд.",
      slider1: "Время сбора хода",
      slider1Hint: "0 = без лимита времени: раунд закрывается только по кворуму.",
      slider2: "Кворум игроков",
      slider2Hint: "При ответе Y игроков таймер сокращается до задержки ввода",
      slider3: "Задержка ввода",
      slider3Hint: "0 = сразу закрыть ввод и передать раунд MCP-Мастеру.",
      min: "мин",
      players: "игроков",
      round: "Раунд",
      waitingTrigger: "Ввод закрыт — ждём, пока MCP-Мастер откроет раунд.",
      waitingFirst: "Раунд открыт — ожидание первого действия игрока...",
      waitingQuorum: "Лимита времени нет — ждём кворум.",
      mcpResolving: "Раунд закрыт — MCP-Мастер разрешает действия.",
      unlimited: "∞",
      timeRemaining: "До конца хода",
      responded: "Ответили",
      startRound: "Стартовать раунд",
      reopenRound: "Переоткрыть ввод",
      startingRound: "Запускаем...",
      startRoundHint: "Аварийная кнопка: открывает текущий раунд без смены номера. Если он уже открыт, повторно публикует состояние и снимает зависший внебоевой lock ввода.",
      startRoundError: "Не удалось стартовать раунд.",
      respondNow: "Ответить сейчас",
      respondError: "Не удалось запросить ответ.",
      optInSelf: "Включить автопилот может только сам игрок",
      autopilotTitle: "Автопилот игроков (Доппельгангер)",
      autopilotHint: "Игрок включает автопилот сам; лидер может его выключить. При очередном ходе ИИ действует, когда игроку дано слово.",
      on: "ВКЛ",
      off: "Выкл",
      acted: "Сходил",
      waiting: "Ждёт",
      skipped: "Пропуск",
      playerFallback: "игрок",
    },
  });

  const globalTurnSettings = campaign.gameSettings?.globalTurn ?? {
    enabled: false,
    turnCollectionMinutes: 10,
    quorumPlayers: 2,
    quorumDelayMinutes: 2,
  };

  const settingsKey = [
    globalTurnSettings.enabled,
    globalTurnSettings.turnCollectionMinutes,
    globalTurnSettings.quorumPlayers,
    globalTurnSettings.quorumDelayMinutes,
  ].join(":");
  const [draft, setDraft] = useState(globalTurnSettings);
  const [previousSettingsKey, setPreviousSettingsKey] = useState(settingsKey);
  if (settingsKey !== previousSettingsKey) {
    setPreviousSettingsKey(settingsKey);
    setDraft(globalTurnSettings);
  }
  const { enabled, turnCollectionMinutes: collectionMins, quorumPlayers: quorum, quorumDelayMinutes: graceMins } = draft;
  const [saving, setSaving] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const [startRoundError, setStartRoundError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Real-time ticker for deadline
  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, []);

  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);
  const maxPartySize = Math.max(1, playerSheets.length);
  const turnState = campaign.globalTurnState ?? {
    roundNumber: 1,
    phase: "waiting",
    startedAt: null,
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };

  // Count responded players
  const respondedCount = playerSheets.filter((s) => {
    const u = turnState.actionsByCharacter?.[s.id];
    if (globalTurnSubmitted(u)) return true;
    const m = members.find((mem) => mem.userId === s.userId);
    return Boolean(m && m.skipTurnsCount > 0);
  }).length;

  // Compute countdown
  const msRemaining = turnState.deadlineAt && now !== null
    ? Math.max(0, new Date(turnState.deadlineAt).getTime() - now)
    : null;
  const secsTotal = msRemaining === null ? Number.POSITIVE_INFINITY : Math.floor(msRemaining / 1000);
  const countdownMinutes = Math.floor(secsTotal / 60);
  const countdownSeconds = secsTotal % 60;
  const formattedCountdown = msRemaining === null
    ? "--:--"
    : `${String(countdownMinutes).padStart(2, "0")}:${String(countdownSeconds).padStart(2, "0")}`;
  const canStartRound =
    isLead &&
    (turnState.phase === "waiting" ||
      turnState.phase === "active" ||
      turnState.phase === "quorum_delay");

  async function updateTurnSettings(patch: {
    enabled?: boolean;
    turnCollectionMinutes?: number;
    quorumPlayers?: number;
    quorumDelayMinutes?: number;
  }) {
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalTurn: {
            enabled: patch.enabled ?? enabled,
            turnCollectionMinutes: patch.turnCollectionMinutes ?? collectionMins,
            quorumPlayers: patch.quorumPlayers ?? quorum,
            quorumDelayMinutes: patch.quorumDelayMinutes ?? graceMins,
          },
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function startRound() {
    if (!canStartRound || startingRound) return;

    setStartingRound(true);
    setStartRoundError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/global-turn/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundNumber: turnState.roundNumber }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || copy.startRoundError);
      }
    } catch (error) {
      setStartRoundError(error instanceof Error ? error.message : copy.startRoundError);
    } finally {
      setStartingRound(false);
    }
  }

  async function toggleAutopilot(userId: string, current: boolean) {
    setBusyUser(userId);
    try {
      await fetch(`/api/campaigns/${campaignId}/members/${userId}/autopilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autopilot: !current }),
      });
    } finally {
      setBusyUser(null);
    }
  }

  async function respondNow() {
    if (responding) return;
    setResponding(true);
    setRespondError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/global-turn/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled ? { roundNumber: turnState.roundNumber } : {}),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || copy.respondError);
      }
    } catch (error) {
      setRespondError(error instanceof Error ? error.message : copy.respondError);
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <Clock className="size-4 text-amber-400" /> {copy.title}
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium border",
            enabled
              ? "border-emerald-600/50 bg-emerald-950/60 text-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.3)]"
              : "border-stone-700 bg-stone-900 text-stone-400",
          )}
        >
          {enabled ? copy.on : copy.off}
        </span>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-200">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => {
            const value = e.target.checked;
            setDraft((current) => ({ ...current, enabled: value }));
            void updateTurnSettings({ enabled: value });
          }}
          className="size-4 rounded border-stone-700 bg-stone-900 text-amber-500 focus:ring-amber-500"
        />
        <span>{copy.enabled}</span>
      </label>
      <p className="mt-1 text-[11px] text-stone-400">{copy.desc}</p>
      {isLead ? (
        <div className="mt-2">
          <button type="button" disabled={responding || enabled && !["active", "quorum_delay"].includes(turnState.phase)}
            onClick={() => void respondNow()} className={cn("rounded border border-amber-700 px-2 py-1 text-xs text-amber-200", (responding || enabled && !["active", "quorum_delay"].includes(turnState.phase)) && "opacity-50")}>
            {responding ? <Loader2 className="inline size-3 animate-spin" /> : <Play className="inline size-3" />} {copy.respondNow}
          </button>
          {respondError ? <p role="alert" className="mt-1 text-xs text-red-400">{respondError}</p> : null}
        </div>
      ) : null}

      {enabled ? (
        <div className="mt-3 space-y-3.5 border-t border-stone-800/80 pt-3">
          {/* Slider 1: Turn collection minutes */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-stone-300">{copy.slider1}</span>
              <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-amber-300">
                {collectionMins === 0 ? copy.unlimited : `${collectionMins} ${copy.min}`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={120}
              step={1}
              value={collectionMins}
              onChange={(e) => setDraft((current) => ({ ...current, turnCollectionMinutes: Number(e.target.value) }))}
              onMouseUp={() => void updateTurnSettings({ turnCollectionMinutes: collectionMins })}
              onTouchEnd={() => void updateTurnSettings({ turnCollectionMinutes: collectionMins })}
              className="mt-1.5 h-1.5 w-full cursor-pointer accent-amber-400"
            />
            <p className="mt-0.5 text-[10px] text-stone-500">{copy.slider1Hint}</p>
          </div>

          {/* Slider 2: Quorum players */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-stone-300">{copy.slider2}</span>
              <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-amber-300">
                {quorum} / {maxPartySize} {copy.players}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={maxPartySize}
              step={1}
              value={Math.min(quorum, maxPartySize)}
              onChange={(e) => setDraft((current) => ({ ...current, quorumPlayers: Number(e.target.value) }))}
              onMouseUp={() => void updateTurnSettings({ quorumPlayers: quorum })}
              onTouchEnd={() => void updateTurnSettings({ quorumPlayers: quorum })}
              className="mt-1.5 h-1.5 w-full cursor-pointer accent-amber-400"
            />
            <p className="mt-0.5 text-[10px] text-stone-500">{copy.slider2Hint}</p>
          </div>

          {/* Slider 3: Quorum input grace delay */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-stone-300">{copy.slider3}</span>
              <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-amber-300">
                {graceMins} {copy.min}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={graceMins}
              onChange={(e) => setDraft((current) => ({ ...current, quorumDelayMinutes: Number(e.target.value) }))}
              onMouseUp={() => void updateTurnSettings({ quorumDelayMinutes: graceMins })}
              onTouchEnd={() => void updateTurnSettings({ quorumDelayMinutes: graceMins })}
              className="mt-1.5 h-1.5 w-full cursor-pointer accent-amber-400"
            />
            <p className="mt-0.5 text-[10px] text-stone-500">{copy.slider3Hint}</p>
          </div>

          {/* Live Turn Status Card */}
          <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-200">
                {copy.round} #{turnState.roundNumber}
              </span>
              <span className="text-[11px] text-amber-300/80">
                {copy.responded}: {respondedCount} / {maxPartySize}
              </span>
            </div>

            {turnState.phase === "waiting" ? (
              <p className="mt-1.5 text-[11px] font-medium text-amber-200">
                {copy.waitingTrigger}
              </p>
            ) : turnState.phase === "ready" || turnState.phase === "resolving" ? (
              <p className="mt-1.5 text-[11px] font-medium text-amber-200">
                {copy.mcpResolving}
              </p>
            ) : turnState.deadlineAt ? (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-stone-400">{copy.timeRemaining}:</span>
                <span
                  className={cn(
                    "font-mono font-bold tracking-wider",
                    secsTotal <= 60 ? "text-red-400 animate-pulse" : "text-amber-300",
                  )}
                >
                  {formattedCountdown}
                </span>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] italic text-stone-400">
                {turnState.firstActionAt ? copy.waitingQuorum : copy.waitingFirst}
              </p>
            )}

            {isLead ? (
              <div className="mt-2 border-t border-amber-900/30 pt-2">
                <button
                  type="button"
                  disabled={!canStartRound || startingRound}
                  onClick={() => void startRound()}
                  className={cn(
                    "flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold transition-colors",
                    canStartRound
                      ? "border-emerald-700/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50"
                      : "cursor-not-allowed border-stone-800 bg-stone-900/50 text-stone-600",
                  )}
                >
                  {startingRound ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {startingRound
                    ? copy.startingRound
                    : turnState.phase === "waiting"
                      ? copy.startRound
                      : copy.reopenRound}
                </button>
                <p className="mt-1 text-[10px] text-stone-500">{copy.startRoundHint}</p>
                {startRoundError ? (
                  <p className="mt-1 text-[10px] text-red-400" role="alert">
                    {startRoundError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

        </div>
      ) : null}

          {/* Autopilot Delegation Section */}
          <div className="mt-3 border-t border-stone-800/80 pt-2.5">
            <div className="mb-1.5">
              <p className="flex items-center gap-1 text-xs font-medium text-stone-300">
                <Bot className="size-3.5 text-sky-400" /> {copy.autopilotTitle}
              </p>
              <p className="text-[10px] text-stone-500">{copy.autopilotHint}</p>
            </div>

            <ul className="space-y-1.5">
              {playerSheets.map((sheet) => {
                const member = members.find((m) => m.userId === sheet.userId);
                const hasAutopilot = Boolean(member?.autopilot);
                const skips = member?.skipTurnsCount ?? 0;
                const usage = turnState.actionsByCharacter?.[sheet.id];
                const acted = globalTurnSubmitted(usage);

                return (
                  <li
                    key={sheet.id}
                    className="flex items-center justify-between gap-2 rounded border border-stone-800/60 bg-stone-900/40 px-2 py-1 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-stone-200">
                        {sheet.name}{" "}
                        <span className="text-[10px] text-stone-500">({member?.username ?? copy.playerFallback})</span>
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {acted ? (
                          <span className="text-emerald-400">✓ {copy.acted}</span>
                        ) : skips > 0 ? (
                          <span className="text-amber-400">
                            ⏭️ {copy.skipped} ({skips})
                          </span>
                        ) : (
                          <span className="text-stone-500">{copy.waiting}</span>
                        )}
                        {hasAutopilot ? (
                          <span className="rounded bg-sky-950/80 px-1 text-sky-300">🤖 AI</span>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyUser === sheet.userId || !hasAutopilot && sheet.userId !== meUserId}
                      title={!hasAutopilot && sheet.userId !== meUserId ? copy.optInSelf : undefined}
                      onClick={() => toggleAutopilot(sheet.userId, hasAutopilot)}
                      className={cn(
                        "shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors",
                        hasAutopilot
                          ? "border-sky-700 bg-sky-950/60 text-sky-200 hover:bg-sky-900/60"
                          : "border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-white",
                      )}
                    >
                      {busyUser === sheet.userId ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : hasAutopilot ? (
                        "🤖 " + copy.on
                      ) : (
                        "🤖 " + copy.off
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
    </div>
  );
}
