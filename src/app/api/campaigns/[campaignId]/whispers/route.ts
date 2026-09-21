import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { countPendingPlayerWhispers, countUnreadWhispers, insertPlayerWhisper, listWhispersForUser } from "@/lib/db/dm-whispers";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import { enforcePlayerIngress } from "@/lib/ingress-budget";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mute blocks new input, not the member's ability to read their own history.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ whispers: listWhispersForUser(campaignId, context.user.id), unread: countUnreadWhispers(campaignId, context.user.id) });
}
const playerWhisperSchema = z.object({ message: z.string().trim().min(1).max(500) });
const PENDING_PLAYER_WHISPER_CAP = 2;
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) return context;
  const { campaign, user } = context;
  if (campaign.status !== "active") return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  const sheet = getSheetForUser(campaignId, user.id);
  if (!sheet) return Response.json({ error: "You need a character to whisper to the DM." }, { status: 400 });
  const raw = await request.json().catch(() => ({}));
  const parsed = playerWhisperSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid message." }, { status: 400 });
  const limited = enforcePlayerIngress(campaignId, user.id, "whisper");
  if (limited) return limited;
  if (countPendingPlayerWhispers(campaignId, user.id) >= PENDING_PLAYER_WHISPER_CAP)
    return Response.json({ error: "The DM has not answered your last private messages yet." }, { status: 429 });
  insertPlayerWhisper(campaignId, user.id, sheet.id, parsed.data.message);
  publishEphemeral(campaignId, "whisper_activity", {});
  return Response.json({ ok: true }, { status: 202 });
}
