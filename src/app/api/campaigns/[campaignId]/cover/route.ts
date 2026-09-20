import { z } from "zod";
import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { setCampaignCover } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Campaign art is user-supplied. The server stores uploaded files but never
// invokes or hosts an image model.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  return Response.json({ cover: context.campaign.cover, status: null });
}

const patchSchema = z.object({
  imageUrl: z.string().refine(isUploadedImagePath, "Not an uploaded file."),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) return context;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "The cover must be an image uploaded to this server." },
      { status: 400 },
    );
  }
  const url = parsed.data.imageUrl;
  const cover = { id: url.slice("/uploads/".length).replace(/\.[a-z]+$/, ""), url };
  if (!setCampaignCover(campaignId, cover)) {
    return Response.json({ error: "Could not save the cover." }, { status: 400 });
  }
  publishPersisted(campaignId, "campaign_updated", { cover });
  return Response.json({ ok: true, cover, status: null });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) return context;
  setCampaignCover(campaignId, null);
  publishPersisted(campaignId, "campaign_updated", { cover: null });
  return Response.json({ ok: true, cover: null, status: null });
}
