import { getCampaignById, setCampaignStatus } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { getUserById, getUserByUsername } from "@/lib/db/users";
import { syncCharacterProgress, syncPartyProgress } from "@/lib/db/progress-sync";
import { publishPersisted } from "@/lib/events";

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

export function finishAndSyncParty(input: {
  campaignId: string;
  includeCompanions?: boolean;
  skipUnlinked?: boolean;
  requireAllSynced?: boolean;
  confirm: boolean;
}) {
  if (!input.confirm) throw new Error("finish_and_sync_party requires confirm=true.");
  const campaign = getCampaignById(input.campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.kind !== "campaign") throw new Error("Workshops cannot be finished as campaigns.");

  const sync = syncPartyProgress(input.campaignId, {
    includeCompanions: input.includeCompanions ?? false,
    skipUnlinked: input.skipUnlinked ?? true,
  });
  const requireAllSynced = input.requireAllSynced ?? true;
  const blockers = sync.totals.failed + sync.totals.skipped;

  if (requireAllSynced && blockers > 0) {
    publishPersisted(input.campaignId, "campaign.finish_sync_blocked", {
      campaignId: input.campaignId,
      requireAllSynced,
      totals: sync.totals,
      failed: sync.failed,
      skipped: sync.skipped,
    });
    return {
      campaignId: input.campaignId,
      ended: false,
      status: campaign.status,
      reason: "Not every selected party member synchronized successfully.",
      sync,
    };
  }

  getDatabase().transaction(() => {
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
  })();

  return {
    campaignId: input.campaignId,
    ended: true,
    status: "ended" as const,
    sync,
  };
}
