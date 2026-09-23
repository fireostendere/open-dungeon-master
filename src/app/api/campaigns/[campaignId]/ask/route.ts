import { z } from "zod";
import { isErrorResponse, requireMember, requireVoice } from "@/lib/campaign-api";
import { insertAsk, listAsksForUser, AskQueueFull } from "@/lib/db/asks";
import { getSheetForUser } from "@/lib/db/sheets";
import { publishEphemeral, publishUserEphemeral } from "@/lib/events";
import { ASK_SCOPES, ASK_VISIBILITIES, QUESTION_MAX_CHARS, clampQuestion, inferScope } from "@/lib/dm/ask-logic";
import { enforcePlayerIngress } from "@/lib/ingress-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const askSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX_CHARS),
  scope: z.enum(["auto", ...ASK_SCOPES]).default("auto"),
  visibility: z.enum(ASK_VISIBILITIES).default("private"),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) return context;
  const { campaign, user } = context;
  const parsed = askSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid question." }, { status: 400 });
  const limited = enforcePlayerIngress(campaignId, user.id, "ask");
  if (limited) return limited;

  const question = clampQuestion(parsed.data.question);
  const scope = parsed.data.scope === "auto" ? inferScope(question) : parsed.data.scope;
  const sheet = getSheetForUser(campaignId, user.id);
  const language = /(?:^|;\s*)odm_locale=(ru|en)(?:;|$)/.exec(request.headers.get("cookie") ?? "")?.[1]
    ?? campaign.gameSettings.language ?? "ru";
  const acknowledgement: Record<string, string> = {
    en: "Your question has been sent to the Dungeon Master…",
    ru: "Вопрос передан Мастеру стола…",
  };

  try {
    const ask = insertAsk({
      campaignId,
      userId: user.id,
      characterId: sheet?.id ?? null,
      visibility: parsed.data.visibility,
      scope,
      question,
      answer: acknowledgement[language] ?? acknowledgement.en,
      citations: [],
      status: "pending",
    });
    if (ask.visibility === "table") publishEphemeral(campaignId, "ask_activity", {});
    else {
      publishUserEphemeral(campaignId, user.id, "ask_activity", {});
      if (campaign.dmUserId && campaign.dmUserId !== user.id) publishUserEphemeral(campaignId, campaign.dmUserId, "ask_activity", {});
    }
    return Response.json({ ask }, { status: 202 });
  } catch (error) {
    if (error instanceof AskQueueFull) return Response.json({ error: error.message }, { status: 429 });
    throw error;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ asks: listAsksForUser(campaignId, context.user.id) });
}
