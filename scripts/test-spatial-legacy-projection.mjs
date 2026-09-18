import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createSpatialStore, SpatialError } from "../src/lib/spatial/store.mjs";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectionFile = path.join(root, "src/lib/spatial/legacy-projection.ts");

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
  const store = createSpatialStore(db, {
    nextSeq: id => sqlite.prepare(
      "UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq"
    ).get(id).seq,
  });
  const actor = userId => ({
    campaignId: "c", userId, isDm: userId === "dm",
    memberIds: ["dm", "a", "b"], playerIds: ["a", "b"],
  });
  let request = 0;
  const command = (operation, input) => store.command(actor("dm"), `cmd-${++request}`, operation, input);
  const tavern = command("enable", { name: "Tavern" }).roomId;
  const street = command("create_room", { name: "Street", connectTo: tavern, walkable: true }).roomId;
  command("move", { roomId: street, userIds: ["b"] });
  const secret = command("send", { roomId: tavern, kind: "narration", content: "The vault combination is 314." }).message;
  const ooc = command("send", { roomId: null, kind: "ooc", content: "Global break." }).message;

  const mod = loadReviewModule(projectionFile, {
    "@/lib/spatial/service": {
      spatialEnabled: campaignId => store.enabled(campaignId),
      spatialStore: () => store,
      SpatialError,
      spatialContext: (campaignId, userId) => ({
        campaign: { id: campaignId, dmUserId: "dm" },
        actor: actor(userId),
      }),
    },
  });
  const policy = (userId, ownedCharacterIds = []) => mod.spatialLegacyPolicy({
    campaignId: "c", userId, adjudicates: userId === "dm", ownedCharacterIds,
  });
  return { store, actor, secret, ooc, mod, policy };
}

test("R03: sequence authorization follows immutable spatial receipts", t => {
  const f = fixture(t);
  assert.equal(f.store.canReadSeq(f.actor("a"), f.secret.seq), true);
  assert.equal(f.store.canReadSeq(f.actor("b"), f.secret.seq), false);
  assert.equal(f.store.canReadSeq(f.actor("a"), f.ooc.seq), true);
  assert.equal(f.store.canReadSeq(f.actor("b"), f.ooc.seq), true);
  assert.equal(f.store.canReadSeq(f.actor("a"), 99999), null);
});

test("R03: characterless and foreign rolls do not inherit campaign-global visibility", t => {
  const f = fixture(t);
  const rolls = [
    { id: "a", characterId: "pc-a", total: 17 },
    { id: "b", characterId: "pc-b", total: 4 },
    { id: "global", characterId: null, total: 99 },
  ];
  assert.deepEqual(f.mod.projectSpatialRolls(f.policy("a", ["pc-a"]), rolls).map(x => x.id), ["a"]);
  assert.deepEqual(f.mod.projectSpatialRolls(f.policy("dm"), rolls).map(x => x.id), ["a", "b", "global"]);
});

test("R03: automated facts require witnessed source while explicit global facts stay global", t => {
  const f = fixture(t);
  const startSeq = f.policy("a", ["pc-a"]).startSeq;
  const facts = [
    { id: "legacy", knownBy: "party", source: "chapter", sourceSeq: startSeq - 1 },
    { id: "seen", knownBy: "party", source: "chapter", sourceSeq: f.secret.seq },
    { id: "unscoped", knownBy: "party", source: "simulation", sourceSeq: f.secret.seq + 100 },
    { id: "manual", knownBy: "party", source: "manual", sourceSeq: f.secret.seq + 101 },
    { id: "personal", knownBy: ["pc-a"], source: "simulation", sourceSeq: f.secret.seq + 102 },
  ];
  assert.deepEqual(f.mod.projectSpatialFacts(f.policy("a", ["pc-a"]), facts).map(x => x.id), ["legacy", "seen", "manual", "personal"]);
  assert.deepEqual(f.mod.projectSpatialFacts(f.policy("b", ["pc-b"]), facts).map(x => x.id), ["legacy", "manual"]);
});

test("R03: post-spatial DM notes and mixed chapters fail closed", t => {
  const f = fixture(t);
  const startSeq = f.policy("a").startSeq;
  const notes = [
    { id: "legacy", authorUserId: "dm", authorKind: "dm", characterId: null, visibility: "public", status: "active", seq: startSeq - 1 },
    { id: "dm-new", authorUserId: "dm", authorKind: "dm", characterId: null, visibility: "public", status: "active", seq: startSeq + 10 },
    { id: "member-global", authorUserId: "b", authorKind: "user", characterId: null, visibility: "public", status: "active", seq: startSeq + 11 },
    { id: "mine", authorUserId: "a", authorKind: "user", characterId: null, visibility: "private", status: "active", seq: startSeq + 12 },
  ];
  assert.deepEqual(f.mod.projectSpatialNotes(f.policy("a"), notes).map(x => x.id), ["legacy", "member-global", "mine"]);
  const chapters = [
    { id: "old", seqStart: 0, seqEnd: startSeq - 1 },
    { id: "crosses", seqStart: 0, seqEnd: startSeq + 10 },
    { id: "new", seqStart: startSeq + 1, seqEnd: startSeq + 20 },
    { id: "open", seqStart: startSeq + 21, seqEnd: null },
  ];
  assert.deepEqual(f.mod.projectSpatialChapters(f.policy("a"), chapters).map(x => x.id), ["old"]);
});

test("R03: campaign live state and unrelated addressed rows are redacted", t => {
  const f = fixture(t);
  const policy = f.policy("a", ["pc-a"]);
  const campaign = f.mod.projectSpatialCampaign(policy, {
    scene: "SECRET ROOM NOW", questLog: ["SECRET QUEST"],
    floor: { mode: "initiative", currentName: "Secret Goblin" },
    dmCover: { active: true },
    party: { location: "Secret Vault", activity: "Opening chest", marchingOrder: ["pc-b"], copper: 25, inventory: [] },
  });
  assert.equal(campaign.scene, "");
  assert.deepEqual(campaign.questLog, []);
  assert.deepEqual(campaign.floor, { mode: "open" });
  assert.equal(campaign.dmCover, null);
  assert.equal(campaign.party.location, "");
  assert.equal(campaign.party.activity, "");
  assert.deepEqual(campaign.party.marchingOrder, []);
  assert.equal(campaign.party.copper, 25);
  assert.deepEqual(
    f.mod.projectSpatialOwnedRows(policy, [{ id: "ra", characterId: "pc-a" }, { id: "rb", characterId: "pc-b" }]).map(x => x.id),
    ["ra"],
  );
  assert.deepEqual(
    f.mod.projectSpatialUserRows(policy, [{ id: "pa", userId: "a" }, { id: "pb", userId: "b" }]).map(x => x.id),
    ["pa"],
  );
});
