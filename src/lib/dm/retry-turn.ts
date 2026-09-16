import { getCampaignById } from "@/lib/db/campaigns";
import {
  claimFailedDmTurn,
  getAwaitingTurn,
  getDmTurn,
  getLatestDmTurnId,
  listPendingForTurn,
  saveDmTurn,
  type DmTurn,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { clearMessageDmTurn, findMessageForDmTurn } from "@/lib/db/messages";
import { getRoll } from "@/lib/db/rolls";
import { publishPersisted } from "@/lib/events";
import { enqueueDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { fakeRollMarkerRegex } from "@/lib/dm/tool-text";
import { getJournaledToolResult } from "@/lib/dm/tool-execution";
import { MAX_MODEL_CALLS, reenterDmTurn } from "@/lib/dm/turn";
import {
  assistantTextOf,
  checkRetryEligible,
  danglingToolCallIds,
  retryCallIndex,
  rewindHaltedCall,
} from "@/lib/dm/retry-turn-logic";

const RETRY_NOTE =
  "[System] Your last attempt at this turn was interrupted by an internal error and nothing you wrote then reached the table. Committed tool calls have been restored from the server's execution journal and must not be repeated. A call explicitly reported as not committed may be called again if the action is still needed. Continue from the supplied tool results and narrate only the authoritative state.";

export type RetryRequest = { campaignId: string; turnId: string };
export type RetryResult = { ok: true; turnId: string } | { ok: false; status: number; error: string };

function resolvedRollResult(
  turn: DmTurn,
  pendings: PendingRoll[],
  toolCallId: string,
): string | null {
  const pending = pendings.find(
    (entry) => entry.toolCallId === toolCallId && entry.status !== "pending" && entry.rollId,
  );
  const roll = pending?.rollId ? getRoll(pending.rollId) : null;
  if (!pending || !roll) return null;
  if (!turn.rollIds.includes(roll.id)) turn.rollIds.push(roll.id);
  return JSON.stringify({
    total: roll.total,
    dice: roll.breakdown.terms,
    ...(pending.dc !== null ? { dc: pending.dc, success: roll.total >= pending.dc } : {}),
    ...(roll.breakdown.crit ? { crit: roll.breakdown.crit } : {}),
    rolledBy: pending.status === "submitted" ? "the player, with physical dice" : "the server",
    note: "Narrate this real result. Do not roll again for the same action.",
    ...(pending.combatNote ? { combat: pending.combatNote } : {}),
  });
}

function restoredJournalResult(turn: DmTurn, result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const rollId = typeof result._rollId === "string" ? result._rollId : null;
  if (rollId && !turn.rollIds.includes(rollId)) turn.rollIds.push(rollId);
  const { _rollId, ...publicResult } = result;
  return JSON.stringify(publicResult);
}

export function requestTurnRetry(request: RetryRequest): RetryResult {
  const { campaignId, turnId } = request;
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  const pendings = turn ? listPendingForTurn(turnId) : [];
  const eligibility = checkRetryEligible({
    campaignId,
    campaignActive: campaign?.status === "active",
    turn,
    latestTurnId: getLatestDmTurnId(campaignId),
    openPendingRollCount: pendings.filter((entry) => entry.status === "pending").length,
  });
  if (!eligibility.ok) return eligibility;
  if (!campaign) return { ok: false, status: 404, error: "Campaign not found." };

  const claimed = claimFailedDmTurn(turnId);
  if (!claimed) return { ok: false, status: 409, error: "That turn is already being retried." };

  const notice = findMessageForDmTurn(turnId);
  if (notice) {
    const updated = clearMessageDmTurn(notice.id, turnId);
    if (updated) publishPersisted(campaignId, "message_updated", { message: updated });
  }

  const rewind = rewindHaltedCall({
    narrationParts: claimed.narrationParts,
    callIndex: claimed.callIndex,
    assistantText: assistantTextOf(claimed.conversation).replace(fakeRollMarkerRegex(), ""),
  });
  claimed.narrationParts = rewind.narrationParts;
  claimed.callIndex = retryCallIndex(rewind.callIndex, MAX_MODEL_CALLS);

  for (const toolCallId of danglingToolCallIds(claimed.conversation)) {
    const resolvedRoll = resolvedRollResult(claimed, pendings, toolCallId);
    const journaled = restoredJournalResult(claimed, getJournaledToolResult(turnId, toolCallId));
    claimed.conversation.push({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        resolvedRoll ??
        journaled ??
        JSON.stringify({
          error:
            "This tool call did not commit before the interruption. It is safe to call it again if the action is still needed.",
          retryable: true,
        }),
    });
  }

  const lastMessage = claimed.conversation[claimed.conversation.length - 1];
  if (lastMessage?.content !== RETRY_NOTE) claimed.conversation.push({ role: "user", content: RETRY_NOTE });
  saveDmTurn(claimed);

  setDmStatus(campaignId, "thinking");
  enqueueDmJob(campaignId, async () => {
    const fresh = getDmTurn(turnId);
    const freshCampaign = getCampaignById(campaignId);
    if (
      !fresh ||
      fresh.status !== "running" ||
      freshCampaign?.status !== "active" ||
      getLatestDmTurnId(campaignId) !== turnId
    ) {
      abandonRetry(campaignId, turnId);
      return;
    }
    try {
      await reenterDmTurn(freshCampaign, fresh);
    } catch (error) {
      console.error("[dm-retry] re-entry failed", error);
      abandonRetry(campaignId, turnId);
    }
  });

  return { ok: true, turnId };
}

function abandonRetry(campaignId: string, turnId: string) {
  const turn = getDmTurn(turnId);
  if (turn && turn.status === "running") {
    turn.status = "failed";
    saveDmTurn(turn);
  }
  setDmStatus(campaignId, getAwaitingTurn(campaignId) ? "awaiting_rolls" : "idle");
}
