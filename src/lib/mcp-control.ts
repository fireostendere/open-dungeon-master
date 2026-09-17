// Cross-cutting control-plane policy lives at the public boundary. The action
// registry retains its existing schemas, masking rules and authorization.
export * from "@/lib/mcp-control-actions";
import { executeMcpControl as executeAction } from "@/lib/mcp-control-actions";
import { getSheetById } from "@/lib/db/sheets";
import { latestSeq, listMembers } from "@/lib/db/campaigns";
import { listEventsSince, publishPersisted, type StoredEvent } from "@/lib/events";
import { isNarratorEvent } from "@/lib/mcp-event-filter";

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
  if (action === "campaigns.events") {
    // The action above has already validated the UUID, cursor and page limit.
    // Cursor progression uses the unfiltered page: an OOC-only page must not
    // trap an agent in a loop or hide the first in-character event after it.
    const input = params as { campaignId: string; afterSeq?: number };
    const page = result as { events: StoredEvent[] };
    const cursor = input.afterSeq ?? 0;
    const last = page.events.at(-1)?.seq ?? cursor;
    const hasMore = listEventsSince(input.campaignId, last, 1).length > 0;
    const currentSeq = latestSeq(input.campaignId);
    return { ...page, events: page.events.filter(isNarratorEvent), cursor,
      nextCursor: hasMore ? last : Math.max(last, currentSeq), currentSeq, hasMore };
  }
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
