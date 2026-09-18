import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listOpenItemProposals } from "@/lib/db/item-proposals";
import { publicItemProposal } from "@/lib/dm/proposal-intercept";
import { projectSpatialUserRows, spatialLegacyPolicy } from "@/lib/spatial/legacy-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Open DM item/gold offers (inventoryApprovals). Inventory is party
// knowledge, so every member sees the pending offers.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const caps = capsFor(context);
  const policy = spatialLegacyPolicy({
    campaignId, userId: context.user.id, adjudicates: caps.adjudicates, ownedCharacterIds: [],
  });
  return Response.json({
    proposals: projectSpatialUserRows(policy, listOpenItemProposals(campaignId)).map(publicItemProposal),
  });
}
