import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { getCampaignById } from "@/lib/db/campaigns";
import { insertAsk, listAsksForUser } from "@/lib/db/asks";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishEphemeral, publishUserEphemeral } from "@/lib/events";
import { runAsk } from "@/lib/dm/ask";
import { ASK_SCOPES, ASK_VISIBILITIES, QUESTION_MAX_CHARS, clampQuestion, inferScope } from "@/lib/dm/ask-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Questions never take the floor, create story messages or enqueue a DM turn.
const askSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX_CHARS),
  scope: z.enum(["auto", ...ASK_SCOPES]).default("auto"),
  visibility: z.enum(ASK_VISIBILITIES).default("private"),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) return context;
  const { user } = context;
  const raw = await request.json().catch(() => ({}));
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid question." }, { status: 400 });
  const question = clampQuestion(parsed.data.question);
  const scope = parsed.data.scope === "auto" ? inferScope(question) : parsed.data.scope;
  const sheet = getSheetForUser(campaignId, user.id);
  const campaign = getCampaignById(campaignId);

  if (campaign?.gameSettings.dmMode === "human") {
    // Retain the existing database status contract (answered/failed); this
    // localized acknowledgement is replaced by the external DM's answer.
    const language = /(?:^|;\s*)odm_locale=(ru|en|pl)(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1]
      ?? campaign.gameSettings.language ?? "ru";
    const acknowledgement = language === "pl" ? "Pytanie zostało przekazane Mistrzowi Gry…" :
      language === "en" ? "Your question has been sent to the Dungeon Master…" : "Вопрос передан Мастеру стола…";
    const ask = insertAsk({ campaignId, userId: user.id, characterId: sheet?.id ?? null,
      visibility: parsed.data.visibility, scope, question, answer: acknowledgement, citations: [], status: "answered" });
    if (ask.visibility === "table") publishEphemeral(campaignId, "ask_activity", {});
    else {
      publishUserEphemeral(campaignId, user.id, "ask_activity", {});
      if (campaign.dmUserId && campaign.dmUserId !== user.id) publishUserEphemeral(campaignId, campaign.dmUserId, "ask_activity", {});
    }
    return Response.json({ ask });
  }

  const result = await runAsk({ campaignId, userId: user.id, question, scope });
  const failed = "error" in result;
  const ask = insertAsk({ campaignId, userId: user.id, characterId: sheet?.id ?? null,
    visibility: parsed.data.visibility, scope, question, answer: failed ? "" : result.answer,
    citations: failed ? [] : result.citations, status: failed ? "failed" : "answered" });
  if (!failed && parsed.data.visibility === "table") publishEphemeral(campaignId, "ask_activity", {});
  if (failed) return Response.json({ error: result.error, ask }, { status: 502 });
  return Response.json({ ask });
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ asks: listAsksForUser(campaignId, context.user.id) });
}
