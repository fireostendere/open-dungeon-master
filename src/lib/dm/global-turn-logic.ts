import {
  allocateSeq,
  getCampaignById,
  getGlobalTurnState,
  listMembers,
  setGlobalTurnState,
  setMemberSkipTurns,
} from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { GlobalTurnState } from "@/lib/campaign-types";
import { getActiveEncounter } from "@/lib/db/encounters";

// In-memory timers are only a latency optimization. jobs.ts also scans
// persisted deadlines, so process restarts cannot lose a timed round.
const activeTurnTimers = new Map<string, NodeJS.Timeout>();
// ponytail: deduplicate within one app process; use a DB lease before adding workers.
const resolvingGlobalTurns = new Map<string, Promise<GlobalTurnState | null>>();

type ReadinessResult = {
  state: GlobalTurnState;
  shouldResolve: boolean;
};

function playerSheets(campaignId: string, dmUserId: string | null) {
  return listSheets(campaignId).filter(
    (sheet) => !sheet.isCompanion && sheet.userId !== dmUserId,
  );
}

function respondedCount(
  campaignId: string,
  state: GlobalTurnState,
  dmUserId: string | null,
): { responded: number; total: number } {
  const sheets = playerSheets(campaignId, dmUserId);
  const members = listMembers(campaignId);
  const responded = sheets.filter((sheet) => {
    const usage = state.actionsByCharacter[sheet.id];
    if (usage && (usage.actionsCount > 0 || usage.phrasesCount > 0)) return true;
    const member = members.find((entry) => entry.userId === sheet.userId);
    return Boolean(member && member.skipTurnsCount > 0);
  }).length;
  return { responded, total: Math.max(1, sheets.length) };
}

/**
 * The only normal entry into a collectible round.
 *
 * "waiting" means the round counter exists but input is hard-locked. A start
 * trigger moves that exact round into "active", publishes global_turn_started,
 * and only then may player actions/skips participate in quorum/timing.
 *
 * The first round is triggered when the campaign starts. Every later round is
 * triggered only after the previous MCP narration commits.
 */
export function startGlobalTurn(
  campaignId: string,
  reason: "campaign_start" | "mcp_completed" | "enabled_mid_campaign" = "mcp_completed",
): GlobalTurnState | null {
  const campaign = getCampaignById(campaignId);
  if (
    !campaign ||
    campaign.status !== "active" ||
    !campaign.gameSettings.globalTurn?.enabled ||
    getActiveEncounter(campaignId)
  ) {
    return null;
  }

  const state = getGlobalTurnState(campaignId);
  if (state.phase !== "waiting") return state;

  const startedAt = new Date().toISOString();
  const activeState: GlobalTurnState = {
    roundNumber: state.roundNumber,
    phase: "active",
    startedAt,
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };
  setGlobalTurnState(campaignId, activeState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: activeState });
  publishPersisted(campaignId, "global_turn_started", {
    roundNumber: activeState.roundNumber,
    startedAt,
    reason,
  });

  // A player may have pre-selected "skip N turns" while the table was locked.
  // That preference becomes a response only now, after the start trigger.
  if (listMembers(campaignId).some((member) => member.skipTurnsCount > 0)) {
    const readiness = refreshGlobalTurnReadiness(campaignId);
    if (readiness.shouldResolve) {
      const timer = setTimeout(() => {
        void resolveGlobalTurn(campaignId, readiness.state.roundNumber).catch((error) =>
          console.error(
            `[global-turn] Failed to seal immediately after round start in ${campaignId}:`,
            error,
          ),
        );
      }, 0);
      timer.unref?.();
    }
    return readiness.state;
  }

  return activeState;
}

function evaluateReadiness(
  campaignId: string,
  inputState: GlobalTurnState,
  now = Date.now(),
): ReadinessResult {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !campaign.gameSettings.globalTurn?.enabled || getActiveEncounter(campaignId)) {
    return { state: inputState, shouldResolve: false };
  }

  // No collection before the explicit start trigger, and no mutation after
  // the round has been sealed for MCP adjudication.
  if (
    inputState.phase === "waiting" ||
    inputState.phase === "ready" ||
    inputState.phase === "resolving"
  ) {
    return { state: inputState, shouldResolve: false };
  }

  const settings = campaign.gameSettings.globalTurn;
  let firstActionAt = inputState.firstActionAt;
  let deadlineAt = inputState.deadlineAt;
  let quorumReachedAt = inputState.quorumReachedAt;
  let phase: GlobalTurnState["phase"] = inputState.phase;

  // The collection timer starts on the first actual response, not on the
  // start trigger. 0 collection minutes means there is no absolute timeout:
  // quorum is the only closure condition.
  if (!firstActionAt) {
    firstActionAt = new Date(now).toISOString();
    deadlineAt =
      settings.turnCollectionMinutes > 0
        ? new Date(now + settings.turnCollectionMinutes * 60_000).toISOString()
        : null;
  }

  const counts = respondedCount(campaignId, inputState, campaign.dmUserId);
  const quorumTarget = Math.min(counts.total, settings.quorumPlayers);
  const quorumReached = counts.responded >= quorumTarget;
  const allAnswered = counts.responded >= counts.total;
  let shouldResolve = false;

  if (quorumReached) {
    if (!quorumReachedAt) quorumReachedAt = new Date(now).toISOString();

    // Every player answered, or grace is literally zero: seal after the
    // triggering message/skip has been persisted by its route.
    if (allAnswered || settings.quorumDelayMinutes === 0) {
      deadlineAt = new Date(now).toISOString();
      phase = "quorum_delay";
      shouldResolve = true;
    } else {
      const reachedAt = new Date(quorumReachedAt).getTime();
      const quorumDeadline = new Date(
        reachedAt + settings.quorumDelayMinutes * 60_000,
      ).toISOString();
      if (!deadlineAt || new Date(quorumDeadline).getTime() < new Date(deadlineAt).getTime()) {
        deadlineAt = quorumDeadline;
      }
      phase = "quorum_delay";
    }
  }

  const state: GlobalTurnState = {
    ...inputState,
    phase,
    firstActionAt,
    deadlineAt,
    quorumReachedAt,
  };

  setGlobalTurnState(campaignId, state);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: state });

  // Even a zero-grace round gets a persisted deadline as crash/restart
  // fallback. The triggering route normally seals synchronously.
  if (deadlineAt) scheduleGlobalTurnTimer(campaignId, deadlineAt);
  else cancelGlobalTurnTimer(campaignId);

  return { state, shouldResolve };
}

export function scheduleGlobalTurnTimer(campaignId: string, deadlineIso: string | null) {
  const existing = activeTurnTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    activeTurnTimers.delete(campaignId);
  }
  if (!deadlineIso) return;

  const msRemaining = Math.max(0, new Date(deadlineIso).getTime() - Date.now());
  // Persisted jobs own long waits; keeping a multi-hour JS timer buys nothing.
  if (msRemaining > 2 * 60 * 60 * 1000) return;

  const roundNumber = getGlobalTurnState(campaignId).roundNumber;
  const timer = setTimeout(() => {
    activeTurnTimers.delete(campaignId);
    void resolveGlobalTurn(campaignId, roundNumber).catch((error) =>
      console.error(
        `[global-turn] Failed to seal round for MCP narrator in ${campaignId}:`,
        error,
      ),
    );
  }, msRemaining);

  timer.unref?.();
  activeTurnTimers.set(campaignId, timer);
}

export function cancelGlobalTurnTimer(campaignId: string) {
  const existing = activeTurnTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    activeTurnTimers.delete(campaignId);
  }
}

/**
 * Validates and records a player action in the current global round.
 * The caller persists the accepted message before calling resolveGlobalTurn
 * when shouldResolve=true.
 */
export function recordGlobalTurnAction(
  campaignId: string,
  sheetId: string,
  _userId: string,
  kind: "do" | "say" | "ooc",
): { allowed: boolean; error?: string; state?: GlobalTurnState; shouldResolve?: boolean } {
  if (kind === "ooc") return { allowed: true };

  const campaign = getCampaignById(campaignId);
  if (!campaign) return { allowed: false, error: "Campaign not found." };
  if (getActiveEncounter(campaignId) || !campaign.gameSettings.globalTurn?.enabled) {
    return { allowed: true };
  }

  const state = getGlobalTurnState(campaignId);
  if (state.phase === "waiting") {
    return {
      allowed: false,
      error: "Ход ещё не открыт. Дождитесь сигнала начала следующего раунда.",
    };
  }
  if (state.phase === "ready" || state.phase === "resolving") {
    return {
      allowed: false,
      error: "Раунд уже передан MCP-Мастеру. Дождитесь завершения его хода.",
    };
  }

  const usage = state.actionsByCharacter[sheetId] ?? {
    actionsCount: 0,
    phrasesCount: 0,
    updatedAt: new Date().toISOString(),
  };

  if (kind === "do" && usage.actionsCount >= 1) {
    return {
      allowed: false,
      error:
        "В этом ходе вы уже совершили действие. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }
  if (kind === "say" && usage.phrasesCount >= 1) {
    return {
      allowed: false,
      error:
        "В этом ходе вы уже произнесли фразу. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }

  const nextUsage = {
    actionsCount: kind === "do" ? usage.actionsCount + 1 : usage.actionsCount,
    phrasesCount: kind === "say" ? usage.phrasesCount + 1 : usage.phrasesCount,
    lastActionKind: kind,
    updatedAt: new Date().toISOString(),
  };
  const nextState: GlobalTurnState = {
    ...state,
    actionsByCharacter: {
      ...state.actionsByCharacter,
      [sheetId]: nextUsage,
    },
  };

  const result = evaluateReadiness(campaignId, nextState);
  return { allowed: true, state: result.state, shouldResolve: result.shouldResolve };
}

/**
 * Re-evaluates quorum after a non-message response such as a preselected skip.
 * In "waiting" this is deliberately a no-op: skip preference is stored, but
 * it is not collected until the round start trigger fires.
 */
export function refreshGlobalTurnReadiness(campaignId: string): ReadinessResult {
  return evaluateReadiness(campaignId, getGlobalTurnState(campaignId));
}

/**
 * Seal a collected round for the external MCP narrator.
 *
 * This never advances roundNumber. It only freezes collection and emits the
 * exact batch barrier the MCP narrator consumes.
 */
export function resolveGlobalTurn(
  campaignId: string,
  expectedRound?: number,
): Promise<GlobalTurnState | null> {
  const pending = resolvingGlobalTurns.get(campaignId);
  if (pending) return pending;
  const work = Promise.resolve(resolveGlobalTurnOnce(campaignId, expectedRound)).finally(() =>
    resolvingGlobalTurns.delete(campaignId),
  );
  resolvingGlobalTurns.set(campaignId, work);
  return work;
}

function resolveGlobalTurnOnce(
  campaignId: string,
  expectedRound?: number,
): GlobalTurnState | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") return null;
  if (!campaign.gameSettings.globalTurn?.enabled) return getGlobalTurnState(campaignId);

  const state = getGlobalTurnState(campaignId);
  if (expectedRound !== undefined && state.roundNumber !== expectedRound) return state;
  if (getActiveEncounter(campaignId)) {
    cancelGlobalTurnTimer(campaignId);
    return state;
  }
  if (state.phase === "ready" || state.phase === "resolving") return state;
  // A stale timer/job must never manufacture a round before the start trigger.
  if (state.phase === "waiting") return state;

  cancelGlobalTurnTimer(campaignId);

  // Materialize every committed skip before the ready event. The ready seq is
  // therefore the exact end of the round batch visible to the MCP narrator.
  const sheets = playerSheets(campaignId, campaign.dmUserId);
  const members = listMembers(campaignId);
  for (const sheet of sheets) {
    const usage = state.actionsByCharacter[sheet.id];
    const hasActed = Boolean(usage && (usage.actionsCount > 0 || usage.phrasesCount > 0));
    const member = members.find((entry) => entry.userId === sheet.userId);
    if (hasActed || !member || member.skipTurnsCount <= 0) continue;

    const updated = setMemberSkipTurns(campaignId, member.userId, member.skipTurnsCount - 1);
    if (updated) publishPersisted(campaignId, "member_updated", { member: updated });

    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "player",
      userId: member.userId,
      characterId: sheet.id,
      content: `*${sheet.name} пропускает этот ход.*`,
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
  }

  const readyState: GlobalTurnState = {
    ...getGlobalTurnState(campaignId),
    roundNumber: state.roundNumber,
    phase: "ready",
    deadlineAt: null,
  };
  setGlobalTurnState(campaignId, readyState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: readyState });
  publishPersisted(campaignId, "global_turn_ready", {
    roundNumber: state.roundNumber,
    startedAt: readyState.startedAt,
    message: "Раунд собран и передан внешнему MCP Мастеру.",
  });

  return readyState;
}

/**
 * Advance the counter only after confirmed MCP narration.
 *
 * The transition is:
 *   ready/resolving(N) --MCP narration commit--> waiting(N+1)
 *   waiting(N+1) --automatic start trigger--> active(N+1)
 *
 * This means player input stays locked for the entire model/tool/narration
 * cycle and opens only after the model's final narration has committed.
 */
export function completeGlobalTurn(
  campaignId: string,
  expectedRound: number,
): GlobalTurnState | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active" || !campaign.gameSettings.globalTurn?.enabled) {
    return null;
  }
  if (getActiveEncounter(campaignId)) return getGlobalTurnState(campaignId);

  const state = getGlobalTurnState(campaignId);
  if (state.roundNumber !== expectedRound) return state;
  if (state.phase !== "ready" && state.phase !== "resolving") return state;

  cancelGlobalTurnTimer(campaignId);
  const waitingState: GlobalTurnState = {
    roundNumber: state.roundNumber + 1,
    phase: "waiting",
    startedAt: null,
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };
  setGlobalTurnState(campaignId, waitingState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: waitingState });
  publishPersisted(campaignId, "global_turn_resolved", {
    resolvedRound: state.roundNumber,
    nextRound: waitingState.roundNumber,
    resolvedBy: "mcp_narrator",
  });

  // The successful MCP narration is itself the next-round trigger. This call
  // emits global_turn_started and opens the composer only after the narration
  // write has committed inside the serialized narrator command.
  return startGlobalTurn(campaignId, "mcp_completed") ?? waitingState;
}
