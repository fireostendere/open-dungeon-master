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

type PartySyncResult = ReturnType<typeof syncPartyProgress>;

class FinishSyncBlocked extends Error {
  constructor(readonly sync: PartySyncResult) {
    super("Not every selected party member synchronized successfully.");
    this.name = "FinishSyncBlocked";
  }
}

function emptyPartySync(campaignId: string): PartySyncResult {
  return {
    campaignId,
    synced: [],
    skipped: [],
    failed: [],
    totals: { candidates: 0, synced: 0, skipped: 0, failed: 0 },
  };
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

  // Repeating a successful finish is idempotent. In particular, it must not
  // create another progress revision for every hero just because a client
  // retried after losing the first response.
  if (campaign.status === "ended") {
    return {
      campaignId: input.campaignId,
      ended: true,
      status: "ended" as const,
      alreadyEnded: true,
      sync: emptyPartySync(input.campaignId),
    };
  }

  const requireAllSynced = input.requireAllSynced ?? true;
  const syncOptions = {
    includeCompanions: input.includeCompanions ?? false,
    skipUnlinked: input.skipUnlinked ?? true,
  };
  const db = getDatabase();

  if (requireAllSynced) {
    try {
      // better-sqlite3 nests the per-character transactions as savepoints.
      // Throwing on any blocker rolls back every earlier character revision
      // and the campaign status together, giving requireAllSynced its literal
      // all-or-nothing meaning.
      return db.transaction(() => {
        const sync = syncPartyProgress(input.campaignId, syncOptions);
        const blockers = sync.totals.failed + sync.totals.skipped;
        if (blockers > 0) throw new FinishSyncBlocked(sync);

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

        return {
          campaignId: input.campaignId,
          ended: true,
          status: "ended" as const,
          sync,
        };
      })();
    } catch (error) {
      if (!(error instanceof FinishSyncBlocked)) throw error;
      // Publish only after the rollback so the failure event itself survives
      // while all attempted character revisions remain absent.
      publishPersisted(input.campaignId, "campaign.finish_sync_blocked", {
        campaignId: input.campaignId,
        requireAllSynced,
        totals: error.sync.totals,
        failed: error.sync.failed,
        skipped: error.sync.skipped,
      });
      return {
        campaignId: input.campaignId,
        ended: false,
        status: campaign.status,
        reason: error.message,
        sync: error.sync,
      };
    }
  }

  // Partial mode is intentionally different: successful characters are kept
  // and the result explicitly reports failures/skips before ending the table.
  const sync = syncPartyProgress(input.campaignId, syncOptions);
  db.transaction(() => {
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
