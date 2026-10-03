import { getCampaignById, getFightFloor, getFloor, setCampaignEnding, setFightFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { enqueueDmJob } from "@/lib/dm/queue";
import type { CampaignEnding, CampaignOutcome } from "@/lib/campaign-types";
import { getDatabase } from "@/lib/db/core";
import { endEncounter, listActiveEncounters } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { listOpenItemProposals, resolveItemProposal } from "@/lib/db/item-proposals";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { answerAsk, listPendingAsksForCampaign } from "@/lib/db/asks";
import { clearDirectorArm } from "@/lib/db/director-arms";
import { syncProgressToLibrary } from "@/lib/db/characters";
import { publishEphemeral, publishPersisted, publishUserEphemeral } from "@/lib/events";
import { cancelGlobalTurnTimer } from "@/lib/dm/global-turn-logic";
import { followCombatAmbience } from "@/lib/dm/ambience-tools";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { setDmStatus } from "@/lib/dm/status";

export type CloseCampaignInput = {
  outcome: CampaignOutcome;
  epilogue?: string;
  endedBy: CampaignEnding["endedBy"];
};

export type CloseCampaignResult = {
  status: "ended";
  outcome: CampaignOutcome;
  ending: CampaignEnding;
  closed: { encounters: number; pendingRolls: number; asks: number; itemProposals: number; floorReleased: boolean };
  alreadyEnded: boolean;
};

const ASK_CLOSED = { ru: "Кампания завершена — вопрос закрыт без ответа.", en: "The campaign has ended; this question was closed unanswered." };

/** End a campaign from whatever state it is in, synchronously, inside the
 * caller's transaction: close every running fight (no XP, the story is
 * over), drop unrolled physical dice, parked DM turns, open offers and the
 * queued Asks, open the floor, stop global-turn timers, then record the
 * outcome and epilogue with status "ended" and tell the table. Closing an
 * already-ended campaign again only corrects its outcome and epilogue.
 */
export function closeCampaign(campaign: Campaign, input: CloseCampaignInput): CloseCampaignResult {
  const db = getDatabase();
  const alreadyEnded = campaign.status === "ended";
  const closed = { encounters: 0, pendingRolls: 0, asks: 0, itemProposals: 0, floorReleased: false };

  if (!alreadyEnded) {
    for (const encounter of listActiveEncounters(campaign.id)) {
      // A fight's own floor (src/lib/db/fight-scope.ts) opens with it.
      if (getFightFloor(campaign.id, encounter).mode !== "open") {
        setFightFloor(campaign.id, encounter, { mode: "open" });
        publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" }, ...(encounter.roomId ? {} : { encounterId: encounter.id }) });
        closed.floorReleased = true;
      }
      endEncounter(encounter.id, input.outcome === "victory" ? "victory" : "party_defeated");
      closed.encounters++;
    }
    if (closed.encounters) {
      publishPersisted(campaign.id, "encounter_updated", { encounter: null });
      followCombatAmbience(campaign, false);
      publishBattleMapUpdate(campaign.id);
    }

    // Unrolled physical dice and the DM turns parked on them: nothing can
    // resume them now. The table drops its roll cards on the status change.
    closed.pendingRolls = db.prepare(`DELETE FROM pending_rolls WHERE campaign_id = ? AND status = 'pending'`).run(campaign.id).changes;
    db.prepare(`UPDATE dm_turns SET status = 'done' WHERE campaign_id = ? AND status IN ('awaiting_rolls', 'running')`).run(campaign.id);

    for (const proposal of listOpenItemProposals(campaign.id)) {
      const resolved = resolveItemProposal(proposal.id, "cancelled");
      if (resolved) {
        closed.itemProposals++;
        publishPersisted(campaign.id, "item_proposal_resolved", { proposal: publicItemProposal(resolved) });
      }
    }

    const closingNote = campaign.gameSettings.language === "en" ? ASK_CLOSED.en : ASK_CLOSED.ru;
    for (let page = 0; page < 20; page++) {
      const pending = listPendingAsksForCampaign(campaign.id, 0, 50);
      if (!pending.items.length) break;
      for (const ask of pending.items) {
        const answered = answerAsk(campaign.id, ask.id, closingNote, [], { expectedVersion: ask.version, author: "campaign_end" });
        if (!answered) continue;
        closed.asks++;
        if (answered.visibility === "table") publishEphemeral(campaign.id, "ask_activity", {});
        else publishUserEphemeral(campaign.id, answered.userId, "ask_activity", {});
      }
      if (!pending.hasMore) break;
    }

    const floor = getFloor(campaign.id);
    if (floor.mode !== "open") {
      setFloor(campaign.id, { mode: "open" });
      publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" } });
      closed.floorReleased = true;
    }
    cancelGlobalTurnTimer(campaign.id);
    clearDirectorArm(campaign.id);
  }

  const ending: CampaignEnding = {
    epilogue: (input.epilogue ?? (alreadyEnded ? campaign.ending?.epilogue : "") ?? "").trim().slice(0, 12000),
    endedAt: alreadyEnded && campaign.ending?.endedAt ? campaign.ending.endedAt : new Date().toISOString(),
    endedBy: input.endedBy,
  };
  setCampaignEnding(campaign.id, input.outcome, ending);
  publishPersisted(campaign.id, "campaign_updated", { status: "ended", outcome: input.outcome, ending });
  setDmStatus(campaign.id, "idle");

  // Durable progression goes back to each player's library character
  // (level, XP, gold, gear, spells; never HP or conditions).
  if (!alreadyEnded) {
    for (const sheet of listSheets(campaign.id)) {
      if (sheet.libraryCharacterId) syncProgressToLibrary(sheet.id);
    }
  }
  return { status: "ended", outcome: input.outcome, ending, closed, alreadyEnded };
}

/** closeCampaign for routes and operator tools: serialized with narrator
 * writes on the campaign's queue, committed atomically, events published
 * after commit. Rethrows what the queue would otherwise only log. */
export async function closeCampaignNow(campaignId: string, input: CloseCampaignInput): Promise<CloseCampaignResult> {
  let result: CloseCampaignResult | null = null;
  let failure: unknown = null;
  await enqueueDmJob(campaignId, async () => {
    try {
      result = withCommittedEffects(() => getDatabase().transaction(() => {
        const campaign = getCampaignById(campaignId);
        if (!campaign) throw new Error("Campaign not found.");
        return closeCampaign(campaign, input);
      })());
    } catch (error) { failure = error; }
  });
  if (failure) throw failure;
  if (!result) throw new Error("The campaign could not be closed.");
  return result;
}
