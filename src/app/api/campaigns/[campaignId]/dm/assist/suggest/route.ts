import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getActiveEncounter } from "@/lib/db/encounters";
import { suggestAdjudication } from "@/lib/dm/assist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "The player said this; what am I supposed to press?"
//
// Deterministic keyword/rules shortlist. Applies nothing: the DM opens a
// proposed form and confirms it themselves.
const suggestSchema = z.object({
  intent: z.string().trim().min(1).max(1000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = suggestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say what the player is trying to do." }, { status: 400 });
  }

  const inEncounter = Boolean(getActiveEncounter(campaignId));
  const { suggestions, picked } = await suggestAdjudication(
    context.campaign,
    parsed.data.intent,
    { inEncounter },
  );
  return Response.json({ suggestions, picked });
}
