import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewModule } from "./lib/review-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const board = loadReviewModule(path.join(root, "src/lib/dm/board.ts"), {
  "@/lib/db/encounters": { getActiveBoard: () => null, listEnemies: () => [] },
  "@/lib/db/sheets": { listSheets: () => [] },
  "@/lib/db/battle-maps": { deleteToken: () => {}, getBattleMapForEncounter: () => null, getToken: () => null, insertToken: () => {}, listTokens: () => [], placeToken: () => {}, setTokenHidden: () => {} },
  "@/lib/battlemap/template": { templateTiles: () => [], tokensInTemplate: () => [] },
  "@/lib/battlemap/types": { tileIndex: () => 0 },
  "@/lib/dm/board-logic": { adhocRefId: () => "", checkAdhocName: () => null, checkAdhocRoom: () => null, checkPlacement: () => null, isAdhocRef: () => false },
  "@/lib/dm/map-tools": { publishBattleMapUpdate: () => {} },
  "@/lib/dm/enemy-damage": { publishEncounter: () => {} },
  "@/lib/events": { publishEphemeral: (...args) => { published = args; }, publishPersisted: () => {} },
});
let published;
board.pingBoard({ id: "c" }, { x: 1, y: 2, byName: "Hero", focus: false, roomId: "room-a" });
assert.deepEqual(published.slice(0, 2), ["c", "map_ping"]);
assert.deepEqual(published[3], { kind: "room", roomId: "room-a" });
console.log("battlemap-ping-privacy: 1 test passed");
