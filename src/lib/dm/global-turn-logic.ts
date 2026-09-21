import { getCampaignById, getGlobalTurnState, listMembers, setGlobalTurnState, setMemberSkipTurns } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { GlobalTurnState } from "@/lib/campaign-types";
import { getActiveEncounter } from "@/lib/db/encounters";

// In-memory timer references to fire turn completion exactly on deadline
const activeTurnTimers = new Map<string, NodeJS.Timeout>();
// ponytail: deduplicate within one app process; use a DB lease before adding workers.
const resolvingGlobalTurns = new Map<string, Promise<GlobalTurnState | null>>();

export function scheduleGlobalTurnTimer(campaignId: string, deadlineIso: string | null) {
  const existing = activeTurnTimers.get(campaignId);
  if (existing) {
    clearTimeout(existing);
    activeTurnTimers.delete(campaignId);
  }
  if (!deadlineIso) return;

  const msRemaining = Math.max(500, new Date(deadlineIso).getTime() - Date.now());
  // Do not schedule excessively distant timers (max 2 hours in memory)
  if (msRemaining > 2 * 60 * 60 * 1000) return;

  const roundNumber = getGlobalTurnState(campaignId).roundNumber;
  const timer = setTimeout(() => {
    activeTurnTimers.delete(campaignId);
    void resolveGlobalTurn(campaignId, roundNumber).catch((err) =>
      console.error(`[global-turn] Failed to resolve turn on timer for ${campaignId}:`, err)
    );
  }, msRemaining);

  // Do not keep process open because of timer
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
 * Validates and records player action in the global turn.
 * Enforces RAW: maximum 1 do and 1 say per hero per global turn.
 */
export function recordGlobalTurnAction(
  campaignId: string,
  sheetId: string,
  userId: string,
  kind: "do" | "say" | "ooc",
): { allowed: boolean; error?: string; state?: GlobalTurnState } {
  if (kind === "ooc") {
    return { allowed: true };
  }

  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return { allowed: false, error: "Campaign not found." };
  }

  const globalTurnSettings = campaign.gameSettings.globalTurn;
  if (getActiveEncounter(campaignId)) return { allowed: true };
  if (!globalTurnSettings?.enabled) {
    return { allowed: true };
  }

  const state = getGlobalTurnState(campaignId);
  const usage = state.actionsByCharacter[sheetId] ?? { actionsCount: 0, phrasesCount: 0, updatedAt: new Date().toISOString() };

  if (kind === "do" && usage.actionsCount >= 1) {
    return {
      allowed: false,
      error: "В этом ходе вы уже совершили действие. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }

  if (kind === "say" && usage.phrasesCount >= 1) {
    return {
      allowed: false,
      error: "В этом ходе вы уже произнесли фразу. За общий ход доступно максимум 1 действие и 1 фраза (Речь).",
    };
  }

  // Update hero action counts
  const nextUsage = {
    actionsCount: kind === "do" ? usage.actionsCount + 1 : usage.actionsCount,
    phrasesCount: kind === "say" ? usage.phrasesCount + 1 : usage.phrasesCount,
    lastActionKind: kind,
    updatedAt: new Date().toISOString(),
  };

  const nextActions = {
    ...state.actionsByCharacter,
    [sheetId]: nextUsage,
  };

  const now = Date.now();
  let firstActionAt = state.firstActionAt;
  let deadlineAt = state.deadlineAt;
  let phase: GlobalTurnState["phase"] = state.phase;
  let quorumReachedAt = state.quorumReachedAt;

  // First action in round starts the collection timer (N minutes)
  if (!firstActionAt) {
    firstActionAt = new Date(now).toISOString();
    const collectionMs = globalTurnSettings.turnCollectionMinutes * 60 * 1000;
    deadlineAt = new Date(now + collectionMs).toISOString();
    phase = "active";
  }

  // Check quorum of responded players
  const sheets = listSheets(campaignId);
  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);
  const members = listMembers(campaignId);

  const respondedCount = playerSheets.filter((s) => {
    const u = nextActions[s.id];
    if (u && (u.actionsCount > 0 || u.phrasesCount > 0)) return true;
    const m = members.find((mem) => mem.userId === s.userId);
    return Boolean(m && m.skipTurnsCount > 0);
  }).length;

  const totalPlayers = Math.max(1, playerSheets.length);
  const quorumTarget = Math.min(totalPlayers, globalTurnSettings.quorumPlayers);

  // If quorum reached, accelerate deadline to (now + Z minutes grace delay)
  if (respondedCount >= quorumTarget && deadlineAt) {
    const graceDelayMs = globalTurnSettings.quorumDelayMinutes * 60 * 1000;
    const quorumDeadline = new Date(now + graceDelayMs).toISOString();
    if (!quorumReachedAt) {
      quorumReachedAt = new Date(now).toISOString();
    }
    if (new Date(quorumDeadline).getTime() < new Date(deadlineAt).getTime()) {
      deadlineAt = quorumDeadline;
      phase = "quorum_delay";
    }
  }

  // If ALL players have acted, finish promptly
  const allAnswered = respondedCount >= totalPlayers;
  if (allAnswered) {
    phase = "resolving";
  }

  const updatedState: GlobalTurnState = {
    roundNumber: state.roundNumber,
    phase,
    firstActionAt,
    deadlineAt,
    quorumReachedAt,
    actionsByCharacter: nextActions,
  };

  setGlobalTurnState(campaignId, updatedState);
  publishPersisted(campaignId, "global_turn_updated", { globalTurnState: updatedState });

  if (allAnswered) {
    // Resolve immediately on next tick
    setTimeout(() => {
      void resolveGlobalTurn(campaignId, updatedState.roundNumber).catch((err) =>
        console.error(`[global-turn] Immediate resolve failed for ${campaignId}:`, err)
      );
    }, 1000);
  } else if (deadlineAt) {
    scheduleGlobalTurnTimer(campaignId, deadlineAt);
  }

  return { allowed: true, state: updatedState };
}

/**
 * Resolves the global turn round:
 * - Records deterministic skip turns for idle players
 * - Advances the round counter
 * - Notifies the human/external Dungeon Master
 */
export function resolveGlobalTurn(campaignId: string, expectedRound?: number): Promise<GlobalTurnState | null> {
  const pending = resolvingGlobalTurns.get(campaignId);
  if (pending) return pending;
  const work = resolveGlobalTurnOnce(campaignId, expectedRound).finally(() => resolvingGlobalTurns.delete(campaignId));
  resolvingGlobalTurns.set(campaignId, work);
  return work;
}

async function resolveGlobalTurnOnce(campaignId: string, expectedRound?: number): Promise<GlobalTurnState | null> {
  const campaign = getCampaignById(campaignId);
  if (!campaign || campaign.status !== "active") return null;

  const state = getGlobalTurnState(campaignId);
  if (expectedRound !== undefined && state.roundNumber !== expectedRound) return state;
  if (getActiveEncounter(campaignId)) { cancelGlobalTurnTimer(campaignId); return state; }

  cancelGlobalTurnTimer(campaignId);

  const sheets = listSheets(campaignId);
  const playerSheets = sheets.filter((s) => !s.isCompanion && s.userId !== campaign.dmUserId);

  // 1. Apply explicit skip-turn choices for idle players
  for (const sheet of playerSheets) {
    const current = getGlobalTurnState(campaignId);
    if (current.roundNumber !== state.roundNumber) return current;
    if (getCampaignById(campaignId)?.status !== "active") return null;
    if (getActiveEncounter(campaignId)) return current;
    const usage = current.actionsByCharacter[sheet.id];
    const hasActed = Boolean(usage && (usage.actionsCount > 0 || usage.phrasesCount > 0));
    const member = listMembers(campaignId).find((m) => m.userId === sheet.userId);

    if (!hasActed && member?.skipTurnsCount > 0) {
      const remaining = member.skipTurnsCount - 1;
      setMemberSkipTurns(campaignId, member.userId, remaining);
      const seq = allocateSeq(campaignId);
      const msg = insertCampaignMessage({
        campaignId,
        seq,
        authorType: "player",
        userId: member.userId,
        characterId: sheet.id,
        content: `*${sheet.name} пропускает этот ход.*`,
      });
      publishWithSeq(campaignId, seq, "message_added", { message: msg });
    }
  }

  // 2. Prepare next round state
  const latestCampaign = getCampaignById(campaignId);
  if (!latestCampaign || latestCampaign.status !== "active") return null;
  const latestState = getGlobalTurnState(campaignId);
  if (latestState.roundNumber !== state.roundNumber) return latestState;
  const nextRoundNumber = state.roundNumber + 1;
  const nextState: GlobalTurnState = {
    roundNumber: nextRoundNumber,
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
    nextRound: nextRoundNumber,
  });

  // 3. The server never narrates. Signal that the collected round is ready
  // for the human/external MCP narrator.
  publishPersisted(campaignId, "global_turn_ended", {
    roundNumber: state.roundNumber,
    message: "Все действия раунда собраны. Мастер может взять слово.",
  });

  return nextState;
}
