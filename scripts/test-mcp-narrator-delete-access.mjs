import test from "node:test";
import assert from "node:assert/strict";
import { authorizeMcpAction, McpAccessError } from "../src/lib/mcp-access.mjs";

const campaignId = "11111111-1111-4111-8111-111111111111";
const otherCampaignId = "22222222-2222-4222-8222-222222222222";
const narrator = Object.freeze({ role: "narrator", campaignId });

test("narrator credential may delete a message only in its bound campaign", () => {
  assert.doesNotThrow(() =>
    authorizeMcpAction(narrator, "narrator.delete_message", {
      campaignId,
      messageId: "33333333-3333-4333-8333-333333333333",
    }),
  );

  assert.throws(
    () =>
      authorizeMcpAction(narrator, "narrator.delete_message", {
        campaignId: otherCampaignId,
        messageId: "33333333-3333-4333-8333-333333333333",
      }),
    (error) => error instanceof McpAccessError && error.status === 403,
  );
});

test("narrator credential still cannot use operator administration actions", () => {
  assert.doesNotThrow(() => authorizeMcpAction(narrator, "narrator.edit_message", { campaignId }));
  assert.doesNotThrow(() => authorizeMcpAction(narrator, "narrator.finish_global_round", { campaignId }));
  assert.doesNotThrow(() => authorizeMcpAction(narrator, "narrator.set_floor", { campaignId }));
  assert.doesNotThrow(() => authorizeMcpAction(narrator, "narrator.request_response", { campaignId }));
  assert.throws(
    () => authorizeMcpAction(narrator, "campaigns.delete", { campaignId }),
    (error) => error instanceof McpAccessError && error.status === 403,
  );
});
