import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewModule } from "./lib/review-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src/app/api/campaigns/[campaignId]/battle-map/ping/route.ts");
let room = "room-a";
let ping;
const route = loadReviewModule(file, {
  "@/lib/campaign-api": { requireMember: async () => ({ user: { id: "player", username: "player" }, campaign: {} }), isErrorResponse: () => false, capsFor: () => ({ role: "player", steersStory: false }) },
  "@/lib/battlemap/view": { getActiveBattleMap: (_campaignId, roomId) => roomId === "room-a" ? { width: 2, height: 2 } : null },
  "@/lib/dm/board": { pingBoard: (_campaign, input) => { ping = input; } },
  "@/lib/db/sheets": { getSheetForUser: () => ({ name: "Hero" }) },
  "@/lib/spatial/service": { spatialEnabled: () => true, spatialStore: () => ({ getUserRoom: () => room }) },
});
const post = () => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ x: 1, y: 1 }) }), { params: Promise.resolve({ campaignId: "c" }) });

assert.equal((await post()).status, 200);
assert.equal(ping.roomId, "room-a");
room = "room-b";
ping = null;
assert.equal((await post()).status, 404);
assert.equal(ping, null, "a player cannot ping coordinates on another room's board");
console.log("battlemap-ping-route: 2 tests passed");
