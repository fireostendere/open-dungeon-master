import { getCampaignById, setCampaignStatus } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getUserById, getUserByUsername } from "@/lib/db/users";
import { syncCharacterProgress, syncPartyProgress } from "@/lib/db/progress-sync";
import { publishPersisted } from "@/lib/events";
import { withCommittedEffects } from "@/lib/db/commit-effects";

export function resolveProgressSheet(input: {
  sheetId?: string;
  campaignId?: string;
  userId?: string;
  username?: string;
}) {
  if (input.sheetId) {
    const sheet = getSheetById(input.sheetId);
    if (!sheet) throw new Error("Campaign character sheet not found.");
    if (input.campaignId && sheet.campaignId !== input.campaignId) {
      throw new Error("Sheet does not belong to the requested campaign.");
    }
    return sheet;
  }
  if (!input.campaignId) throw new Error("Provide sheetId, or campaignId plus userId/username.");
  const user = input.userId
    ? getUserById(input.userId)
    : input.username
      ? getUserByUsername(input.username)
      : null;
  if (!user) throw new Error("User not found. Provide userId or username with campaignId.");
  const sheet = listSheets(input.campaignId).find((candidate) => candidate.userId === user.id);
  if (!sheet) throw new Error("Campaign character sheet not found for that user.");
  return sheet;
}

export function syncProgressLookup(input: {
  sheetId?: string;
  campaignId?: string;
  userId?: string;
  username?: string;
  expectedVersion?: number;
}) {
  const sheet = resolveProgressSheet(input);
  return syncCharacterProgress(sheet.id, input.expectedVersion);
}

type PartySync = ReturnType<typeof syncPartyProgress>;
class PartySyncBlocked extends Error {
  constructor(readonly sync: PartySync, readonly campaignStatus: string) {
    super("Not every selected party member synchronized successfully.");
  }
}

export function finishAndSyncParty(input: {
  campaignId: string;
  includeCompanions?: boolean;
  skipUnlinked?: boolean;
  requireAllSynced?: boolean;
  confirm: boolean;
}) {
  if (!input.confirm) throw new Error("finish_and_sync_party requires confirm=true.");
  const requireAllSynced = input.requireAllSynced ?? true;
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS campaign_finish_results (
    campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
    result_json TEXT NOT NULL
  )`);
  try {
    // The outer transaction owns ALL member writes, their revision events,
    // the campaign status and the completion event. Nested member transactions
    // are savepoints; a blocker rolls the entire operation back.
    return withCommittedEffects(() => getDatabase().transaction(() => {
      const campaign = getCampaignById(input.campaignId);
      if (!campaign) throw new Error("Campaign not found.");
      if (campaign.kind !== "campaign") throw new Error("Workshops cannot be finished as campaigns.");
      if (campaign.status === "ended") {
        const completed = db.prepare("SELECT result_json FROM campaign_finish_results WHERE campaign_id = ?")
          .get(input.campaignId) as { result_json: string } | undefined;
        if (completed) return JSON.parse(completed.result_json) as {
          campaignId: string; ended: true; status: "ended"; sync: PartySync;
        };
        throw new Error("Campaign already ended before finish receipts existed; use an explicit progress sync instead.");
      }
      const sync = syncPartyProgress(input.campaignId, {
        includeCompanions: input.includeCompanions ?? false,
        skipUnlinked: input.skipUnlinked ?? true,
      });
      if (requireAllSynced && sync.totals.failed + sync.totals.skipped > 0) {
        throw new PartySyncBlocked(sync, campaign.status);
      }
      setCampaignStatus(input.campaignId, "ended");
      publishPersisted(input.campaignId, "campaign.finished_progress_sync", {
        campaignId: input.campaignId,
        previousStatus: campaign.status,
        status: "ended",
        requireAllSynced,
        totals: sync.totals,
        synced: sync.synced.map((entry) => ({
          sheetId: entry.sheetId,
          libraryCharacterId: entry.libraryCharacterId,
          level: entry.level,
          xp: entry.xp,
          revision: entry.revision,
        })),
        failed: sync.failed,
        skipped: sync.skipped,
      });
      const result = { campaignId: input.campaignId, ended: true as const, status: "ended" as const, sync };
      db.prepare(`INSERT INTO campaign_finish_results (campaign_id, result_json) VALUES (?, ?)
        ON CONFLICT(campaign_id) DO UPDATE SET result_json = excluded.result_json`)
        .run(input.campaignId, JSON.stringify(result));
      return result;
    })());
  } catch (error) {
    if (!(error instanceof PartySyncBlocked)) throw error;
    // Report committed results, not the successes that the outer transaction
    // rolled back. Keep their IDs separately so an operator can see the scope.
    const sync = {
      ...error.sync,
      synced: [],
      totals: { ...error.sync.totals, synced: 0 },
      rolledBack: error.sync.synced.map((entry) => entry.sheetId),
    };
    publishPersisted(input.campaignId, "campaign.finish_sync_blocked", {
      campaignId: input.campaignId,
      requireAllSynced,
      totals: sync.totals,
      failed: sync.failed,
      skipped: sync.skipped,
      rolledBack: sync.rolledBack,
    });
    return {
      campaignId: input.campaignId,
      ended: false,
      status: error.campaignStatus,
      reason: error.message,
      sync,
    };
  }
}
