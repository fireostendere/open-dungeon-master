import { comfyStatus } from "@/lib/comfyui";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { openAiImagesConfigured } from "@/lib/openai-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Image backend options for the story authority: ComfyUI checkpoint list and
// whether OpenAI is globally configured. URL comes from stored settings/env
// only, never from the request — no SSRF surface.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const settings = context.campaign.settings;
  const comfy = await comfyStatus(settings.comfyUrl || undefined);
  const globalOpenAiImageConfigured = openAiImagesConfigured();
  const hasCampaignImageKey = settings.imageApiKey !== "";
  return Response.json({
    comfy,
    globalOpenAiImageConfigured,
    hasCampaignImageKey,
  });
}
