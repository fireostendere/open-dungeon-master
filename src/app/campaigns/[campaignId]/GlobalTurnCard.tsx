"use client";

import { Bot, Check, Clock, FastForward, Loader2, Play, Power, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import type { CampaignMember, GlobalTurnState } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { LeadCampaign } from "@/app/campaigns/[campaignId]/LeadPanel";

export function GlobalTurnCard({
  campaignId,
  campaign,
  members,
  sheets,
  isLead,
}: {
  campaignId: string;
  campaign: LeadCampaign & { globalTurnState?: GlobalTurnState };
  members: CampaignMember[];
  sheets: CharacterSheet[];
  isLead: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Global Turn & Cadence",
      enabled: "Enable global turn mode",
      desc: "Synchronizes party turns: 1 action + 1 phrase per hero per round.",
      slider1: "Turn collection window",
      slider1Hint: "Timer starts on first player message (N minutes)",
      slider2: "Quorum of players",
      slider2Hint: "When Y players answer, deadline accelerates",
      slider3: "Input grace delay",
      slider3Hint: "Time window after quorum before turn closes (Z minutes)",
      min: "min",
      players: "players",
      round: "Round",
      waitingFirst: "Waiting for any player's first action...",
      timeRemaining: "Time remaining",
      responded: "Answered",
      forceResolve: "Force resolve turn now",
      resolving: "Resolving turn...",
      autopilotTitle: "Party Autopilot (Doppelganger)",
      autopilotHint: "Hand character control to AI to wake up sleepy players.",
      on: "ON",
      off: "Off",
      acted: "Acted",
      waiting: "Waiting",
      skipped: "Skipping",
    },
    ru: {
      title: "Общий ход стола",
      enabled: "Включить общий ход",
      desc: "Синхронизирует ходы отряда: 1 действие + 1 фраза за ход от героя.",
      slider1: "Время сбора хода",
      slider1Hint: "Таймер после первого сообщения любого игрока (N минут)",
      slider2: "Кворум игроков",
      slider2Hint: "При ответе Y игроков таймер сокращается до задержки ввода",
      slider3: "Задержка ввода",
      slider3Hint: "Окно на завершение ввода после кворума (Z минут)",
      min: "мин",
      players: "игроков",
      round: "Раунд",
      waitingFirst: "Ожидание первого действия от любого игрока...",
      timeRemaining: "До конца хода",
      responded: "Ответили",
      forceResolve: "Завершить ход сейчас",
      resolving: "Завершение хода...",
      autopilotTitle: "Автопилот игроков (Доппельгангер)",
      autopilotHint: "Передайте руление ИИ, чтобы не задерживать партию и растормошить спящих.",
      on: "ВКЛ",
      off: "Выкл",
      acted: "Сходил",
      waiting: "Ждёт",
      skipped: "Пропуск",
    },
    pl: {
      title: "Wspólna tura drużyny",
      enabled: "Włącz wspólną turę",
      desc: "Synchronizuje tury drużyny: 1 akcja + 1 wypowiedź na postać w turze.",
      slider1: "Czas zbierania tury",
      slider1Hint: "Licznik po pierwszej wiadomości gracza (N minut)",
      slider2: "Kworum graczy",
      slider2Hint: "Gdy odpowie Y graczy, czas skraca się do opóźnienia",
      slider3: "Opóźnienie wprowadzania",
      slider3Hint: "Dodatkowy czas po kworum na dokończenie pisania (Z minut)",
      min: "min",
      players: "graczy",
      round: "Runda",
      waitingFirst: "Oczekiwanie na pierwszą akcję gracza...",
      timeRemaining: "Pozostały czas",
      responded: "Odpowiedziało",
      forceResolve: "Zakończ turę teraz",
      resolving: "Kończenie tury...",
      autopilotTitle: "Autopilot postaci (Doppelganger)",
      autopilotHint: "Przekaż postać pod kontrolę SI, aby rozruszać śpiących graczy.",
      on: "WŁ",
      off: "Wył",
      acted: "Wykonał",
      waiting: "Czeka",
      skipped: "Pominięcie",
    },
  });

  const globalTurnSettings = campaign.gameSettings?.globalTurn ?? {
    enabled: false,
    turnCollectionMinutes: 10,
    quorumPlayers: 2,
    quorumDelayMinutes: 2,
  };

  const [enabled, setEnabled] = useState(globalTurnSettings.enabled);
  const [collectionMins, setCollectionMins] = useState(globalTurnSettings.turnCollectionMinutes);
  const [quorum, setQuorum] = useState(globalTurnSettings.quorumPlayers);
  const [graceMins, setGraceMins] = useState(globalTurnSettings.quorumDelayMinutes);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Real-time ticker for deadline
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync props to state if updated remotely
  useEffect(() => {
    setEnabled(globalTurnSettings.enabled);
    setCollectionMins(globalTurnSettings.turnCollectionMinutes);
    setQuorum(globalTurnSettings.quorumPlayers);
    setGraceMins(globalTurnSettings.quorumDelayMinutes);
  }, [
    globalTurnSettings.enabled,
    globalTurnSettings.turnCollectionMinutes,
    globalTurnSettings.quorumPlayers,
    globalTurnSettings.quorumDelayMinutes,
  ]);

  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);
  const maxPartySize = Math.max(1, playerSheets.length);
  const turnState = campaign.globalTurnState ?? {
    roundNumber: 1,
    phase: "waiting",
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };

  // Count responded players
  const respondedCount = playerSheets.filter((s) => {
    const u = turnState.actionsByCharacter?.[s.id];
    if (u && (u.actionsCount > 0 || u.phrasesCount > 0)) return true;
    const m = members.find((mem) => mem.userId === s.userId);
    return Boolean(m && m.skipTurnsCount > 0);
  }).length;

  // Compute countdown
  const msRemaining = turnState.deadlineAt ? Math.max(0, new Date(turnState.deadlineAt).getTime() - now) : 0;
  const secsTotal = Math.floor(msRemaining / 1000);
  const countdownMinutes = Math.floor(secsTotal / 60);
  const countdownSeconds = secsTotal % 60;
  const formattedCountdown = `${String(countdownMinutes).padStart(2, "0")}:${String(countdownSeconds).padStart(2, "0")}`;

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

  async function forceResolve() {
    setResolving(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/global-turn/resolve`, {
        method: "POST",
      });
    } finally {
      setResolving(false);
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
            setEnabled(e.target.checked);
            void updateTurnSettings({ enabled: e.target.checked });
          }}
          className="size-4 rounded border-stone-700 bg-stone-900 text-amber-500 focus:ring-amber-500"
        />
        <span>{copy.enabled}</span>
      </label>
      <p className="mt-1 text-[11px] text-stone-400">{copy.desc}</p>

      {enabled ? (
        <div className="mt-3 space-y-3.5 border-t border-stone-800/80 pt-3">
          {/* Slider 1: Turn collection minutes */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-stone-300">{copy.slider1}</span>
              <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-amber-300">
                {collectionMins} {copy.min}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={120}
              step={1}
              value={collectionMins}
              onChange={(e) => setCollectionMins(Number(e.target.value))}
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
              onChange={(e) => setQuorum(Number(e.target.value))}
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
              min={1}
              max={30}
              step={1}
              value={graceMins}
              onChange={(e) => setGraceMins(Number(e.target.value))}
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

            {turnState.deadlineAt ? (
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
              <p className="mt-1.5 text-[11px] italic text-stone-400">{copy.waitingFirst}</p>
            )}

            {isLead ? (
              <button
                type="button"
                disabled={resolving}
                onClick={forceResolve}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded border border-amber-700/60 bg-amber-950/40 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/40 disabled:opacity-50"
              >
                {resolving ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> {copy.resolving}
                  </>
                ) : (
                  <>
                    <FastForward className="size-3 text-amber-300" /> {copy.forceResolve}
                  </>
                )}
              </button>
            ) : null}
          </div>

          {/* Autopilot Delegation Section */}
          <div className="border-t border-stone-800/80 pt-2.5">
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
                const acted = Boolean(usage && (usage.actionsCount > 0 || usage.phrasesCount > 0));

                return (
                  <li
                    key={sheet.id}
                    className="flex items-center justify-between gap-2 rounded border border-stone-800/60 bg-stone-900/40 px-2 py-1 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-stone-200">
                        {sheet.name}{" "}
                        <span className="text-[10px] text-stone-500">({member?.username ?? "player"})</span>
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
                      disabled={busyUser === sheet.userId}
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
      ) : null}
    </div>
  );
}
