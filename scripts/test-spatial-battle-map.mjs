import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSpatialStore, SpatialError } from "../src/lib/spatial/store.mjs";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperFile = path.join(root, "src/lib/spatial/battle-map.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    INSERT INTO campaigns(id) VALUES('c');
    INSERT INTO users VALUES('dm'),('a'),('b');
  `);
  const db = sqliteAdapter(sqlite);
  const nextSeq = id =>
    sqlite.prepare("UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq").get(id).seq;
  const store = createSpatialStore(db, { nextSeq });
  const actor = userId => ({
    campaignId: "c",
    userId,
    isDm: userId === "dm",
    memberIds: ["dm", "a", "b"],
    playerIds: ["a", "b"],
  });
  let request = 0;
  const command = (operation, input) =>
    store.command(actor("dm"), `r-${++request}`, operation, input);
  const tavern = command("enable", { name: "Tavern" }).roomId;
  const street = command("create_room", { name: "Street", connectTo: tavern, walkable: true }).roomId;
  command("move", { roomId: street, userIds: ["b"] });

  let board = { id: "board-1", roomId: tavern };
  let map = { id: "map-1" };
  let version = 1;
  const mod = loadReviewModule(helperFile, {
    "@/lib/spatial/service": {
      spatialEnabled: campaignId => store.enabled(campaignId),
      spatialStore: () => store,
      SpatialError,
      spatialContext: (campaignId, userId) => ({
        campaign: { id: campaignId, dmUserId: "dm" },
        actor: actor(userId),
      }),
    },
    "@/lib/db/encounters": { getActiveBoard: (_campaignId, roomId) => roomId === undefined || roomId === board.roomId ? board : null },
    "@/lib/db/battle-maps": { getBattleMapForEncounter: () => map },
    "@/lib/battlemap/view": {
      buildPlayerMapView: (_campaignId, userId, options = {}) => ({
        mapId: map.id,
        width: 3,
        height: 1,
        ambient: "bright",
        theme: "dungeon",
        terrain: version === 1 ? "..." : version === 2 ? ".#." : "##.",
        backdrop: null,
        visible: [0],
        explored: [0],
        tokens: [{
          id: "token",
          kind: "pc",
          refId: userId,
          name: `${userId}-v${version}`,
          x: version,
          y: 0,
          mine: true,
          down: false,
          hidden: false,
        }],
        lights: [],
        reachable: [1, 2],
        budgetLeft: 6,
        myTokenId: "token",
        round: version,
        currentTurnName: `turn-${version}`,
        board: "fight",
        fullVision: options.fullVision === true,
        labels: [],
      }),
    },
  });
  return {
    sqlite, store, actor, command, tavern, street, mod,
    setVersion: value => { version = value; },
    replaceBoard: (boardId, mapId, roomId = tavern) => { board = { id: boardId, roomId }; map = { id: mapId }; },
  };
}

test("R02: start_encounter requires an explicit spatial room and retains it for engine validation", t => {
  const f = fixture(t);
  assert.throws(
    () => f.mod.scopeBattleMapInvocation("c", "dm", "start_encounter", { enemies: [] }),
    /requires roomId/,
  );
  const scoped = f.mod.scopeBattleMapInvocation("c", "dm", "start_encounter", {
    roomId: f.tavern,
    enemies: [{ monster: "goblin" }],
  });
  assert.equal(scoped.roomId, f.tavern);
  assert.deepEqual(scoped.args, { roomId: f.tavern, enemies: [{ monster: "goblin" }] });
  assert.equal(
    f.mod.scopeBattleMapInvocation("c", "dm", "damage_enemy", { amount: 1 }).roomId,
    null,
  );
});

test("R02: direct map reads freeze at the viewer's last observed version after leaving", t => {
  const f = fixture(t);
  f.mod.bindActiveBattleMapToRoom("c", "dm", f.tavern);

  const first = f.mod.spatialBattleMapView("c", "a");
  assert.equal(first.terrain, "...");
  assert.equal(first.tokens[0].name, "a-v1");

  f.command("move", { roomId: f.street, userIds: ["a"] });
  f.setVersion(2);

  assert.equal(f.mod.spatialBattleMapView("c", "b"), null);

  f.command("move", { roomId: f.tavern, userIds: ["b"] });
  const bLive = f.mod.spatialBattleMapView("c", "b");
  assert.equal(bLive.terrain, ".#.");

  const aArchived = f.mod.spatialBattleMapView("c", "a");
  assert.equal(aArchived.terrain, "...");
  assert.equal(aArchived.tokens[0].name, "a-v1");
  assert.deepEqual(aArchived.reachable, []);
  assert.equal(aArchived.budgetLeft, 0);

  f.command("move", { roomId: f.tavern, userIds: ["a"] });
  const aReturned = f.mod.spatialBattleMapView("c", "a");
  assert.equal(aReturned.terrain, ".#.");
  assert.equal(aReturned.tokens[0].name, "a-v2");

  const versions = f.sqlite.prepare(
    "SELECT version FROM spatial_object_versions WHERE campaign_id='c' AND object_type='battle-map-view' AND object_id=? ORDER BY version"
  ).all("map-1:a").map(row => row.version);
  assert.deepEqual(versions, [1, 2]);
});

test("R02: an unbound active board fails closed for players while the DM retains full vision", t => {
  const f = fixture(t);
  f.replaceBoard("board-2", "map-2");
  f.setVersion(3);
  assert.equal(f.mod.spatialBattleMapView("c", "a"), null);
  const dm = f.mod.spatialBattleMapView("c", "dm", { fullVision: true });
  assert.equal(dm.mapId, "map-2");
  assert.equal(dm.fullVision, true);
});

test("R03: a player cannot receive a board from another spatial room", t => {
  const f = fixture(t);
  f.mod.bindActiveBattleMapToRoom("c", "dm", f.tavern);
  assert.equal(f.mod.spatialBattleMapView("c", "b"), null);
});
