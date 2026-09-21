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

// In-memory timer references are only a latency optimization. jobs.ts also
// scans persisted deadlines, so a process restart cannot lose a timed round.
const activeTurnTimers = new Map<string, NodeJS.Timeout>();
// ponytail: deduplicate within one app process; use a DB lease before adding workers.
const resolvingGlobalTurns = new Map<string, Promise<GlobalTurnState | null>>();

type ReadinessResult = {
  state: GlobalTurnState;
  shouldResolve: boolean;
};

function playerSheets(campaignId: string, dmUserId: string | null) {
  return listSheets(campaignId).filter((sheet) => !sheet.isCompanion && sheet.userId !== dmUserId);
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

function evaluateReadiness(
  campaignId: string,
  inputState: GlobalTurnState,
  now = Date.now(),
): ReadinessResult {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !campaign.gameSettings.globalTurn?.enabled || getActiveEncounter(campaignId)) {
    return { state: inputState, shouldResolve: false };
  }

  // A sealed round belongs to the MCP narrator. Player ingress must not reopen
  // it or move its deadline while the narrator is adjudicating it.
  if (inputState.phase === "ready" || inputState.phase === "resolving") {
    return { state: inputState, shouldResolve: false };
  }

  const settings = campaign.gameSettings.globalTurn;
  let firstActionAt = inputState.firstActionAt;
  let deadlineAt = inputState.deadlineAt;
  let quorumReachedAt = inputState.quorumReachedAt;
  let phase: GlobalTurnState["phase"] = inputState.phase;

  // A skip is a response too, so this function may be called without a player
  // message. The first response starts the round. 0 collection minutes means
  // no absolute timeout: only quorum/all-answered can seal it.
  if (!firstActionAt) {
    firstActionAt = new Date(now).toISOString();
    deadlineAt =
      settings.turnCollectionMinutes > 0
        ? new Date(now + settings.turnCollectionMinutes * 60_000).toISOString()
        : null;
    phase = "active";
  }

  const counts = respondedCount(campaignId, inputState, campaign.dmUserId);
  const quorumTarget = Math.min(counts.total, settings.quorumPlayers);
  const quorumReached = counts.responded >= quorumTarget;
  const allAnswered = counts.responded >= counts.total;
  let shouldResolve = false;

  if (quorumReached) {
    if (!quorumReachedAt) quorumReachedAt = new Date(now).toISOString();

    // Every player answered, or the configured grace is literally zero:
    // freeze the collection immediately after the triggering message/skip is
    // persisted. We still persist an immediate deadline as a crash/restart
    // fallback until resolveGlobalTurn seals the round.
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

  // Even the zero-grace path gets a persisted/timer fallback. The action route
  // normally seals synchronously after writing the triggering player message.
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
 * The caller must persist the accepted player message before calling
 * resolveGlobalTurn when shouldResolve=true.
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
  if (state.phase === "ready" || state.phase === "resolving") {
    return {
      allowed: false,
      error: "Раунд уже передан Мастеру на разрешение. Дождитесь следующего хода.",
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
 * Re-evaluates quorum after a non-message response such as "skip this turn".
 * The skip itself remains in member state; it is materialized as a player
 * message only when the round is sealed, so the MCP batch contains it exactly once.
 */
export function refreshGlobalTurnReadiness(campaignId: string): ReadinessResult {
  return evaluateReadiness(campaignId, getGlobalTurnState(campaignId));
}

/**
 * Seal a collected round for the external MCP narrator.
 *
 * This intentionally DOES NOT advance roundNumber. The server only collects
 * and freezes input. The MCP narrator reads global_turn_ready, adjudicates the
 * whole batch, writes narration through narrator.narrate, and that confirmed
 * MCP write calls completeGlobalTurn.
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
  if (state.phase === "ready") return state;

  cancelGlobalTurnTimer(campaignId);

  // Materialize every committed skip before the ready event. The narrator's
  // batch boundary is the ready event seq, so these messages are guaranteed to
  // be inside the same round and never appear as a later stray input.
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
    message: "Раунд собран и передан внешнему MCP Мастеру.",
  });

  return readyState;
}

/**
 * Advance a round only after a confirmed MCP narrator write.
 * This is the second half of the round barrier: server seals -> MCP resolves ->
 * server advances. Players have no manual "finish round" authority.
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
  const nextState: GlobalTurnState = {
    roundNumber: state.roundNumber + 1,
    phase: "waiting",
    firstActionAt: null,
    deadlineAt: null,
    quorumReachedAt: null,
    actionsByCharacter: {},
  };
  setGlobalTurnState(campaignId, nextState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: nextState });
  publishPersisted(campaignId, "global_turn_resolved", {
    resolvedRound: state.roundNumber,
    nextRound: nextState.roundNumber,
    resolvedBy: "mcp_narrator",
  });

  // Multi-turn skip commitments count as responses in the fresh round too.
  // This can start a deadline (or a zero-grace immediate seal) without waiting
  // for another active player to type first.
  if (listMembers(campaignId).some((member) => member.skipTurnsCount > 0)) {
    refreshGlobalTurnReadiness(campaignId);
  }

  return nextState;
}
