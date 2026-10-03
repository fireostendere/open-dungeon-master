import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getMember, setMemberSkipTurns } from "@/lib/db/campaigns";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { refreshGlobalTurnReadiness, resolveGlobalTurn } from "@/lib/dm/global-turn-logic";
import { skipOwnTurn } from "@/lib/dm/encounter-tools";
import { fightOwnsTable } from "@/lib/dm/team-round";
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
    /(?:^|;\s*)odm_locale=(ru|en)(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1]
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
    return Response.json({ ok: true, member: updated });
  }
  if (fightOwnsTable(campaignId)) return Response.json({ ok: true, member });

  // In global-turn mode a skip is a quorum response, but it is not written as
  // a player message yet. The server materializes it exactly once when the
  // round is sealed, immediately before global_turn_ready, so the MCP narrator
  // receives one coherent round batch.
  const sheet = getSheetForUser(campaignId, context.user.id);
  if (sheet && count > 0 && context.campaign.gameSettings?.globalTurn?.enabled) {
    const readiness = refreshGlobalTurnReadiness(campaignId);
    if (readiness.shouldResolve) {
      await resolveGlobalTurn(campaignId, readiness.state.roundNumber);
    }
  }

  return Response.json({ ok: true, member });
}
