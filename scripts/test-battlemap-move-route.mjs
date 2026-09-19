import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewModule } from "./lib/review-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src/app/api/campaigns/[campaignId]/battle-map/move/route.ts");

let room = "room-a";
let budgetInput;
const budgetMoves = [];
let bindingRoom = "room-a";
const boards = new Map([
  ["room-a", { id: "board-a", kind: "fight", orderReady: false, order: [], turnIndex: 0, round: 2, turnBudget: { ownerId: "sheet", round: 2, dashed: true } }],
  ["room-b", { id: "board-b", kind: "fight", orderReady: false, order: [], turnIndex: 0, round: 2, turnBudget: null }],
]);
const map = { id: "map-a", width: 3, height: 1, terrain: "..." };
const token = { id: "token", x: 0, y: 0, movedThisRound: 0 };
const sheet = { id: "sheet", currentHp: 10, conditions: [], exhaustion: 0 };

const route = loadReviewModule(file, {
  "@/lib/campaign-api": { requireMember: async () => ({ user: { id: "player" } }), isErrorResponse: () => false },
  "@/lib/db/campaigns": { getFloor: () => ({ mode: "open" }), getCampaignById: () => ({ gameSettings: { variantRules: { encumbrance: false } } }) },
  "@/lib/db/encounters": { getActiveBoard: (_campaignId, roomId) => boards.get(roomId) ?? null },
  "@/lib/db/sheets": { getSheetForUser: () => sheet },
  "@/lib/db/battle-maps": {
    getBattleMapForEncounter: boardId => boardId === "board-a" ? map : { ...map, id: "map-b" },
    getTokenByRef: mapId => mapId === "map-a" ? token : null,
    listTokens: () => [token],
    moveToken: (_id, _x, _y, moved) => { token.movedThisRound = moved; },
  },
  "@/lib/battlemap/view": { occupiedTiles: () => new Set(), buildPlayerMapView: (_campaignId, _userId, options) => ({ boardId: options.encounter.id }) },
  "@/lib/battlemap/movement": { reachableTiles: () => new Map([[1, 1]]) },
  "@/lib/battlemap/movement-budget": { movementBudget: input => { budgetInput = input; budgetMoves.push(input.movedThisRound); return { speed: 30, remaining: 12 }; } },
  "@/lib/battlemap/types": { tileIndex: (_width, x) => x },
  "@/lib/dm/map-tools": { publishBattleMapUpdate: () => {} },
  "@/lib/dm/action-budget": { budgetApplies: (budget, owner, round) => budget?.ownerId === owner && budget.round === round },
  "@/lib/dm/opportunity": { resolveOpportunityAttacks: () => ({ notes: [], downed: false }) },
  "@/lib/spatial/service": { spatialEnabled: () => true, spatialStore: () => ({ getUserRoom: () => room }) },
  "@/lib/spatial/battle-map": { boundBattleMapRoom: () => bindingRoom },
  "@/lib/db/core": { getDatabase: () => ({ transaction: work => () => work() }) },
  "@/lib/db/commit-effects": { withCommittedEffects: work => work() },
});

const post = () => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ x: 1, y: 0 }) }), { params: Promise.resolve({ campaignId: "c" }) });

let response = await post();
assert.equal(response.status, 200);
assert.equal((await response.json()).view.boardId, "board-a");
assert.equal(budgetInput.dashed, true, "the room-local turn budget drives Dash movement");

bindingRoom = "room-b";
response = await post();
assert.equal(response.status, 404, "an incorrectly bound board cannot be moved through");
bindingRoom = "room-a";

token.movedThisRound = 0;
budgetMoves.length = 0;
let releaseFirst;
let releaseSecond;
const delayed = release => ({ json: () => new Promise(resolve => release(resolve)) });
const first = route.POST(delayed(resolve => { releaseFirst = resolve; }), { params: Promise.resolve({ campaignId: "c" }) });
const second = route.POST(delayed(resolve => { releaseSecond = resolve; }), { params: Promise.resolve({ campaignId: "c" }) });
await Promise.resolve();
await Promise.resolve();
releaseFirst({ x: 1, y: 0 });
releaseSecond({ x: 1, y: 0 });
assert.equal((await first).status, 200);
assert.equal((await second).status, 200);
assert.deepEqual(budgetMoves, [0, 1], "each move reads the token after its request body resolves");

room = "room-b";
response = await post();
assert.equal(response.status, 404, "a token in room A cannot move on room B's board");

room = "room-without-board";
response = await post();
assert.equal(response.status, 404, "an unscoped room cannot fall back to another room's board");
console.log("battlemap-move-route: 5 tests passed");
