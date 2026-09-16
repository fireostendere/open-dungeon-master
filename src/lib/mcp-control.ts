// Cross-cutting control-plane policy lives at the public boundary. The action
// registry retains its existing schemas, masking rules and authorization.
export * from "@/lib/mcp-control-actions";
import { executeMcpControl as executeAction } from "@/lib/mcp-control-actions";
import { getSheetById } from "@/lib/db/sheets";
import { listMembers } from "@/lib/db/campaigns";
import { publishPersisted } from "@/lib/events";

export async function executeMcpControl(action: string, rawParams: unknown): Promise<unknown> {
  let params = rawParams;
  const connecting = action === "models.test_and_connect" || action === "models.switch_remote";
  if (connecting && rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
    const input = rawParams as Record<string, unknown>;
    if (input.campaignId !== undefined) {
      // Reuse the canonical UUID/existence validation before any network probe
      // or profile creation. A missing campaign must not spend provider quota.
      await executeAction("campaigns.get", { campaignId: input.campaignId });
      if (input.apply === false) {
        // A probe-only operation has NO campaign write target. Keeping apply
        // false also prevents global application in the provider service.
        const { campaignId: _campaignId, ...probeOnly } = input;
        params = probeOnly;
      }
    }
  }
  const result = await executeAction(action, params);
  if ((action === "sheets.patch" || action === "characters.instantiate") && result && typeof result === "object" && "sheet" in result) {
    const returned = result.sheet as { id?: unknown } | null;
    const sheet = returned && typeof returned.id === "string" ? getSheetById(returned.id) : null;
    if (sheet) {
      // This is the same replayable domain event the browser already consumes;
      // mcp_control remains an audit notice, not the UI's state protocol.
      publishPersisted(sheet.campaignId, "sheet_updated", { sheet });
      if (action === "characters.instantiate") {
        const member = listMembers(sheet.campaignId).find((entry) => entry.userId === sheet.userId);
        if (member) publishPersisted(sheet.campaignId, "member_updated", { member });
      }
    }
  }
  return result;
}
