import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq, getGlobalTurnState, getMember, setGlobalTurnState, setMemberSkipTurns } from "@/lib/db/campaigns";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { scheduleGlobalTurnTimer } from "@/lib/dm/global-turn-logic";
import { skipOwnTurn } from "@/lib/dm/encounter-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { getActiveEncounter } from "@/lib/db/encounters";
import { gameText, resolveGameLanguage } from "@/lib/i18n/game-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const skipSchema = z.object({
  count: z.number().int().min(0).max(99),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const locale = resolveGameLanguage(
    /(?:^|;\s*)odm_locale=(ru|en|pl)(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1]
      ?? context.campaign.gameSettings.language,
  );

  const raw = await request.json().catch(() => ({}));
  const parsed = skipSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid count (must be between 0 and 99)." }, { status: 400 });
  }

  const { count } = parsed.data;
  if (context.campaign.status !== "active" || !getSheetForUser(campaignId, context.user.id)) {
    return Response.json({ error: "An active player character is required." }, { status: 409 });
  }
  const member = setMemberSkipTurns(campaignId, context.user.id, count);
  if (!member) {
    return Response.json({ error: "Member not found." }, { status: 404 });
  }

  publishPersisted(campaignId, "member_updated", { member });

  // A newly selected skip consumes the current owner's turn only. Later
  // turns remain persisted until this player reaches initiative again.
  if (count > 0 && skipOwnTurn(campaignId, context.user.id)) {
    const updated = getMember(campaignId, context.user.id) ?? member;
    publishPersisted(campaignId, "member_updated", { member: updated });
    requestDmTurn(campaignId);
    return Response.json({ ok: true, member: updated });
  }
  if (getActiveEncounter(campaignId)) return Response.json({ ok: true, member });

  // If player set a skip and global turn is active, mark them as responded and publish note
  const sheet = getSheetForUser(campaignId, context.user.id);
  const globalTurnSettings = context.campaign.gameSettings?.globalTurn;

  if (sheet && count > 0 && globalTurnSettings?.enabled) {
    const seq = allocateSeq(campaignId);
    const msg = insertCampaignMessage({
      campaignId,
      seq,
      authorType: "player",
      userId: context.user.id,
      characterId: sheet.id,
      content: gameText(locale, "skipTurns", { name: sheet.name, count }),
    });
    publishWithSeq(campaignId, seq, "message_added", { message: msg });

    // Update global turn quorum and timer
    const state = getGlobalTurnState(campaignId);
    const now = Date.now();
    let deadlineAt = state.deadlineAt;
    let phase = state.phase;

    if (!state.firstActionAt) {
      state.firstActionAt = new Date(now).toISOString();
      deadlineAt = new Date(now + globalTurnSettings.turnCollectionMinutes * 60 * 1000).toISOString();
      phase = "active";
    }

    const sheets = listSheets(campaignId).filter((s) => !s.isCompanion && s.userId !== context.campaign.dmUserId);
    const respondedCount = sheets.filter((s) => {
      const u = state.actionsByCharacter[s.id];
      if (u && (u.actionsCount > 0 || u.phrasesCount > 0)) return true;
      if (s.id === sheet.id) return true;
      return false;
    }).length;

    const totalPlayers = Math.max(1, sheets.length);
    const quorumTarget = Math.min(totalPlayers, globalTurnSettings.quorumPlayers);

    if (respondedCount >= quorumTarget && deadlineAt) {
      const graceDelayMs = globalTurnSettings.quorumDelayMinutes * 60 * 1000;
      const quorumDeadline = new Date(now + graceDelayMs).toISOString();
      if (new Date(quorumDeadline).getTime() < new Date(deadlineAt).getTime()) {
        deadlineAt = quorumDeadline;
        phase = "quorum_delay";
      }
    }

    state.deadlineAt = deadlineAt;
    state.phase = phase;
    setGlobalTurnState(campaignId, state);
    publishPersisted(campaignId, "global_turn_updated", { globalTurnState: state });

    if (deadlineAt) {
      scheduleGlobalTurnTimer(campaignId, deadlineAt);
    }
  }

  return Response.json({ ok: true, member });
}
