import { rm } from "node:fs/promises";
import { fightSummaries, viewerFights } from "@/lib/dm/team-round";
import { withFight } from "@/lib/spatial/publication-scope.mjs";
import path from "node:path";
import { z } from "zod";
import { capsFor, isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { CAMPAIGN_DIFFICULTIES, CAMPAIGN_OUTCOMES } from "@/lib/campaign-types";
import { closeCampaignNow } from "@/lib/dm/campaign-ending";
import {
  allocateSeq,
  campaignSeats,
  countPartySlots,
  deleteCampaign,
  getFightFloor,
  latestSeq,
  listMembers,
  publicCampaign,
  setCampaignStatus,
  updateCampaignInfo,
} from "@/lib/db/campaigns";
import { ensureOpenChapter, listChapters } from "@/lib/db/chapters";
import { getAmbience } from "@/lib/db/ambience";
import { captureBoundarySnapshot } from "@/lib/db/snapshots";
import { listRecentCampaignEvents } from "@/lib/db/character-events";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { listNotesVisibleTo } from "@/lib/db/notes";
import { listOpenPendingRolls, publicPendingRoll } from "@/lib/db/dm-turns";
import { listDmBeats } from "@/lib/db/dm-beats";
import { listOpenItemProposals } from "@/lib/db/item-proposals";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { listLocations } from "@/lib/db/locations";
import { listRecentAudit } from "@/lib/db/sheet-audit";
import { listThreadsForUser } from "@/lib/db/side-chat";
import { countUnreadWhispers, listWhispersForUser } from "@/lib/db/dm-whispers";
import { listAsksForUser } from "@/lib/db/asks";
import { listFactsVisibleTo } from "@/lib/db/facts";
import { insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { listRollsVisibleTo } from "@/lib/db/rolls";
import { listSheets } from "@/lib/db/sheets";
import { projectSheetsForViewer } from "@/lib/sheet-privacy";
import { isPrimaryDm, lobbyBlocker } from "@/lib/dm/viewer";
import { listBlockedUserIds } from "@/lib/db/moderation";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { getDmStatus } from "@/lib/dm/status";
import { getNarratorPresence } from "@/lib/dm/narrator-presence";
import { spatialEnabled, spatialContext, spatialStore } from "@/lib/spatial/service";
import { spatialBattleMapView } from "@/lib/spatial/battle-map";
import {
  projectSpatialCampaign, projectSpatialChapters, projectSpatialFacts, projectSpatialNotes, projectSpatialRolls,
  projectSpatialUserRows, spatialLegacyPolicy,
} from "@/lib/spatial/legacy-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  const caps = capsFor(context);
  // Capture the replay watermark BEFORE assembling the multi-query snapshot.
  // If a write lands while the snapshot is being built, the browser reconnects
  // from this earlier seq and receives that event again (idempotent). Reading
  // latestSeq at the end could instead acknowledge an event whose changed row
  // was read before the write and permanently skip it.
  const snapshotSeq = latestSeq(campaignId);
  const spatial = spatialEnabled(campaignId);
  const spatialActor = spatial ? spatialContext(campaignId, user.id).actor : null;
  const spatialView = spatialActor ? spatialStore().view(spatialActor) : null;
  const sheets = listSheets(campaignId);
  // Their own characters, for the rolls only they and the DM may read.
  const ownedCharacterIds = sheets
    .filter((sheet) => sheet.userId === user.id)
    .map((sheet) => sheet.id);
  const visibleSheets = projectSheetsForViewer(sheets, user.id, {
    adjudicates: caps.adjudicates,
    // Presence already accounts for location, stealth and invisibility.
    ...(spatial ? { visibleUserIds: spatialView?.enabled
      ? spatialView.rooms.filter(room => room.active).flatMap(room => room.occupants) : [] } : {}),
  });
  const legacyPolicy = spatialLegacyPolicy({ campaignId, userId: user.id, adjudicates: caps.adjudicates, ownedCharacterIds });
  const visibleRolls = projectSpatialRolls(legacyPolicy, listRollsVisibleTo(campaignId, caps, ownedCharacterIds, 20));
  const visiblePendingRolls = listOpenPendingRolls(campaignId)
    .filter((roll) => !spatial || caps.adjudicates || roll.userId === user.id)
    .map(publicPendingRoll);
  const visibleCharacterEvents = listRecentCampaignEvents(campaignId, 30)
    .filter((event) => !spatial || caps.adjudicates || ownedCharacterIds.includes(event.campaignCharacterId));
  const recentMessages = spatial
    ? spatialStore().messages(spatialActor!, { roomId: null, limit: 100 }).messages
    : listRecentMessages(campaignId, 101);
  const visibleMessages = recentMessages.slice(-100);
  const visibleFacts = projectSpatialFacts(
    legacyPolicy,
    listFactsVisibleTo(campaignId, ownedCharacterIds, false),
  );
  const whispers = listWhispersForUser(campaignId, user.id);
  // Without rooms: the fight this player stands in owns their floor, and the
  // fight on screen is theirs or the first running (src/lib/dm/team-round.ts).
  const fightsView = spatial ? null : viewerFights(campaignId, user.id);
  const watch = <T>(work: () => T): T => (fightsView ? withFight(campaignId, fightsView.shown?.id ?? null, work) : work());
  const fights = spatial ? [] : fightSummaries(campaignId);
  return Response.json({
    campaign: projectSpatialCampaign(legacyPolicy, {
      ...publicCampaign(campaign),
      ...(fightsView?.own ? { floor: getFightFloor(campaignId, fightsView.own) } : {}),
    }),
    ...(fightsView ? { fights, ownFightId: fightsView.own?.id ?? null } : {}),
    me: { id: user.id, username: user.username, avatar: user.avatar },
    members: listMembers(campaignId),
    // Players this user has blocked; their table messages fold away.
    blockedUserIds: listBlockedUserIds(user.id),
    sheets: visibleSheets,
    // In spatial mode campaign_messages is not a scene history. The only
    // player-visible transcript here is the separately authorized OOC ledger;
    // room prose is served by location-chat and never enters this snapshot.
    messages: visibleMessages,
    hasOlderMessages: !spatial && recentMessages.length > 100,
    // Blind and DM-only rolls are redacted or dropped here, not in the UI;
    // a player's snapshot must never carry a number they are not meant to
    // have (src/lib/dm/viewer.ts).
    rolls: visibleRolls,
    pendingRolls: visiblePendingRolls,
    characterEvents: visibleCharacterEvents,
    auditLog: spatial && !caps.adjudicates ? [] : listRecentAudit(campaignId, 50),
    // Legacy location/map IDs are not interchangeable with spatial room IDs.
    // Until a room-scoped map projection is attached, never leak the current
    // campaign-wide map to a player in spatial mode.
    locations: spatial && !caps.adjudicates ? [] : listLocations(campaignId),
    chapters: projectSpatialChapters(legacyPolicy, listChapters(campaignId)),
    notes: projectSpatialNotes(legacyPolicy, listNotesVisibleTo(campaignId, user.id, caps.steersStory)),
    // Per-user private projections ride the authenticated bootstrap once.
    // Contentless SSE nudges still refetch only the projection that changed.
    sideThreads: listThreadsForUser(campaignId, user.id),
    whispers,
    whisperUnread: countUnreadWhispers(campaignId, user.id),
    asks: listAsksForUser(campaignId, user.id),
    facts: visibleFacts,
    battleMap: watch(() => spatialBattleMapView(campaignId, user.id, { fullVision: caps.fullMap })),
    itemProposals: projectSpatialUserRows(
      legacyPolicy,
      listOpenItemProposals(campaignId),
    ).map(publicItemProposal),
    encounter: legacyPolicy.scoped
      ? activePublicEncounter(campaignId, {
          enemyNumbers: caps.enemyNumbers,
          viewerUserId: user.id,
          roomId: spatialStore().getUserRoom(campaignId, user.id),
        })
      : watch(() => activePublicEncounter(campaignId, {
          enemyNumbers: caps.enemyNumbers,
          viewerUserId: user.id,
        })),
    // Story the DM has written down. A DM tool, so only the DM seat is
    // served the list; the text itself is public either way, because a beat
    // is published as an ordinary DM passage (src/lib/dm/beats.ts).
    beats: caps.adjudicates ? listDmBeats(campaignId, 20) : [],
    latestSeq: snapshotSeq,
    // Which messages already have narration on disk, so read-aloud plays them
    // straight from a fresh load instead of rendering a second take.
    // What is playing. The ambience_changed event keeps it live from here;
    // without the snapshot a reload mid-scene would sit in silence until the
    // next place or fight changed it.
    ambience: legacyPolicy.scoped ? null : getAmbience(campaignId),
    // What this seat may see and do, so the client never re-derives it from
    // ids and never shows a control the server would refuse.
    caps,
    // In-memory status so a reload mid-turn still shows the DM at work.
    dmStatus: getDmStatus(campaignId),
    // Whether the external narrator's doorbell is connected, for the header
    // lamp; narrator_presence keeps it live from here.
    narratorPresence: getNarratorPresence(campaignId),
    // Same reason, for background work: utility_calls is ephemeral, so a
    // client that reloads mid-compaction would otherwise see an empty strip.
    utilityCalls: [],
    spatial: spatialView,
  });
}

const patchSchema = z.object({
  status: z.enum(["active", "ended"]).optional(),
  // With status "ended": how it ended. Closing with an outcome also cleans
  // up running fights, dice and Asks (src/lib/dm/campaign-ending.ts).
  outcome: z.enum(CAMPAIGN_OUTCOMES).optional(),
  epilogue: z.string().trim().max(12000).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  theme: z.string().trim().max(120).optional(),
  maxPlayers: z.number().int().min(1).max(8).optional(),
  startingLevel: z.number().int().min(1).max(20).optional(),
  difficulty: z.enum(CAMPAIGN_DIFFICULTIES).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }

  const { status: nextStatus, outcome, epilogue, ...info } = parsed.data;
  const infoKeys = Object.keys(info) as Array<keyof typeof info>;

  // Campaign info edits: party lead only, any time before the campaign
  // ends. The DM prompt reads title/theme/difficulty/description fresh each
  // turn, so mid-game changes steer the very next narration; startingLevel
  // only seeds sheets for future joiners.
  if (infoKeys.length) {
    if (!isLead(context)) {
      return Response.json({ error: "Only the party lead can edit the campaign." }, { status: 403 });
    }
    if (campaign.status === "ended") {
      return Response.json({ error: "The campaign has ended." }, { status: 400 });
    }
    if (info.maxPlayers !== undefined && info.maxPlayers < countPartySlots(campaignId)) {
      return Response.json(
        { error: "Max players cannot drop below the current party size." },
        { status: 400 },
      );
    }
    updateCampaignInfo(campaignId, info);
    publishPersisted(campaignId, "campaign_updated", info);
    if (!nextStatus) {
      return Response.json({ ok: true, ...info });
    }
  }

  if (!nextStatus) {
    return Response.json({ error: "Invalid update." }, { status: 400 });
  }
  // The owner, or the person in the DM seat: a DM who was handed a table they
  // do not own still has to be able to open it (the lobby's Begin button asks
  // the same two, LobbyActions.tsx).
  const seats = campaignSeats(campaign);
  if (campaign.ownerUserId !== user.id && !isPrimaryDm(seats, user.id)) {
    return Response.json({ error: "Only the campaign owner or the DM can do that." }, { status: 403 });
  }
  if (nextStatus === "active") {
    if (campaign.status !== "lobby") {
      return Response.json({ error: "Campaign has already started." }, { status: 400 });
    }
    // One rule, shared with the lobby's Begin button (lobbyBlocker in
    // src/lib/dm/viewer.ts), so this route never refuses a start the UI just
    // offered. Asking seat by seat also closes a hole the old sheet count
    // had: a companion's sheet made up the numbers for a player who had none.
    const lobbySheets = listSheets(campaignId);
    const blocker = lobbyBlocker(
      seats,
      listMembers(campaignId).map((member) => ({
        userId: member.userId,
        ready: member.ready,
        hasSheet: lobbySheets.some((sheet) => sheet.userId === member.userId),
      })),
    );
    if (blocker) {
      return Response.json({ error: blocker }, { status: 400 });
    }
  }

  if (nextStatus === "ended") {
    // Victory or defeat (a table closed without choosing counts as a win, as
    // the old finale guessed): everything still open is closed with it, and
    // progression goes back to the library inside closeCampaign.
    const endedBy = isPrimaryDm(seats, user.id) ? "dm" : "owner";
    try {
      const closed = await closeCampaignNow(campaignId, { outcome: outcome ?? "victory", epilogue, endedBy });
      return Response.json({ ok: true, status: "ended", outcome: closed.outcome });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not end the campaign." }, { status: 500 });
    }
  }

  setCampaignStatus(campaignId, nextStatus);
  publishPersisted(campaignId, "campaign_updated", { status: nextStatus });

  // Campaign activation is deterministic. The external MCP narrator reads
  // this marker and the same campaign state; the server never invokes a model.
  if (nextStatus === "active") {
    const seq = allocateSeq(campaignId);
    const message = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "system",
      content: "The party is assembled and the adventure begins. The Dungeon Master opens the scene.",
    });
    publishWithSeq(campaignId, seq, "message_added", { message });
    ensureOpenChapter(campaignId);
    captureBoundarySnapshot(campaignId, 1, latestSeq(campaignId));

    // Global-turn tables start locked. This persisted narrator trigger wakes
    // the external MCP host for the opening scene; only that narration commit
    // opens round #1 and unlocks player input.
    if (campaign.gameSettings.globalTurn?.enabled) {
      publishPersisted(campaignId, "global_turn_narrator_trigger", {
        kind: "opening",
        roundNumber: campaign.globalTurnState.roundNumber,
      });
    }
  }

  return Response.json({ ok: true, status: nextStatus });
}

// Deletes the campaign and everything under it. Rows cascade via foreign
// keys; the per-campaign narration audio directory goes with them.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.ownerUserId !== user.id) {
    return Response.json({ error: "Only the campaign owner can delete it." }, { status: 403 });
  }

  deleteCampaign(campaignId);
  await rm(path.join(process.cwd(), "public", "generated-audio", campaignId), {
    recursive: true,
    force: true,
  });
  return Response.json({ ok: true });
}
