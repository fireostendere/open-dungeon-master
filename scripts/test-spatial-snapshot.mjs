import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSpatialStore } from "../src/lib/spatial/store.mjs";
import { captureSpatialSnapshot, restoreSpatialSnapshot, SPATIAL_TABLES } from "../src/lib/spatial/snapshot.mjs";
import { spatialNarratorBoundary } from "../src/lib/spatial/narrator-page.mjs";

function setup(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER DEFAULT 1); CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO campaigns(id) VALUES('c'); INSERT INTO users VALUES('dm'),('a'),('b');");
  db.transaction = fn => () => { db.exec("SAVEPOINT test"); try { const result = fn(); db.exec("RELEASE test"); return result; } catch (error) { db.exec("ROLLBACK TO test; RELEASE test"); throw error; } };
  const store = createSpatialStore(db, { nextSeq: id => db.prepare("UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq").get(id).seq });
  const actor = userId => ({ campaignId: "c", userId, isDm: userId === "dm", memberIds: ["dm", "a", "b"], playerIds: ["a", "b"] });
  let request = 0;
  const send = (operation, input) => store.command(actor("dm"), `cmd-${++request}`, operation, input);
  const room = send("enable", { name: "Start" }).roomId;
  return { db, store, actor, send, room };
}

test("snapshot restore preserves historical recipients and rolls back absent messages and positions", t => {
  const f = setup(t), tavern = f.send("create_room", { name: "Tavern" }).roomId;
  f.send("move", { roomId: tavern, userIds: ["a"] });
  f.send("send", { roomId: tavern, kind: "narration", content: "Only A witnessed this" });
  const tables = captureSpatialSnapshot(f.db, "c"), nextSeq = f.db.prepare("SELECT next_seq FROM campaigns").get().next_seq;
  f.send("move", { roomId: tavern, userIds: ["b"] });
  f.send("send", { roomId: tavern, kind: "narration", content: "Discarded future" });
  f.db.transaction(() => { restoreSpatialSnapshot(f.db, "c", tables); f.db.prepare("UPDATE campaigns SET next_seq=?").run(nextSeq); })();
  assert.equal(f.store.view(f.actor("b")).current.roomId, f.room);
  assert.throws(() => f.store.messages(f.actor("b"), { roomId: tavern }), /not found/);
  assert.deepEqual(f.store.messages(f.actor("a"), { roomId: tavern }).messages.map(m => m.content), ["Only A witnessed this"]);
  f.send("move", { roomId: tavern, userIds: ["b"] });
  f.send("send", { roomId: tavern, kind: "narration", content: "New timeline" });
  assert.deepEqual(f.store.messages(f.actor("b"), { roomId: tavern }).messages.map(m => m.content), ["New timeline"]);
});

test("rewinding to a legacy snapshot clears spatial state instead of retaining future grants", t => {
  const f = setup(t);
  f.db.transaction(() => restoreSpatialSnapshot(f.db, "c", {}))();
  assert.equal(f.store.enabled("c"), false);
  for (const table of SPATIAL_TABLES) assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test("deleted users do not cause foreign-key failures during spatial restore", t => {
  const f = setup(t);
  f.send("send", { roomId: f.room, kind: "narration", content: "Durable scene" });
  const tables = captureSpatialSnapshot(f.db, "c");
  f.db.prepare("DELETE FROM users WHERE id='dm'").run();
  f.db.transaction(() => restoreSpatialSnapshot(f.db, "c", tables))();
  const message = f.store.messages(f.actor("a"), { roomId: f.room }).messages[0];
  assert.equal(message.authorUserId, null);
  assert.equal(message.content, "Durable scene");
});

test("a cross-campaign snapshot is rejected atomically", t => {
  const f = setup(t), tables = captureSpatialSnapshot(f.db, "c");
  tables.spatial_rooms[0].campaign_id = "another";
  assert.throws(() => f.db.transaction(() => restoreSpatialSnapshot(f.db, "c", tables))(), /another campaign/);
  assert.equal(f.store.view(f.actor("a")).current.roomId, f.room);
});

test("merged narrator pagination never skips a private message or stalls on gaps", () => {
  for (const limit of [1, 2, 7, 50, 100]) {
    const events = Array.from({ length: 333 }, (_, i) => ({ seq: i * 3 + 1 }));
    const messages = Array.from({ length: 451 }, (_, i) => ({ seq: i * 2 + 2, content: `m${i}` }));
    const seenEvents = [], seenMessages = [];
    let cursor = 0, iterations = 0;
    while (cursor < 1100) {
      const remaining = messages.filter(message => message.seq > cursor), page = remaining.slice(0, limit);
      const result = spatialNarratorBoundary({ afterSeq: cursor, currentSeq: 1100, limit,
        events: events.filter(event => event.seq > cursor).slice(0, limit + 1),
        spatial: { messages: page, nextCursor: page.at(-1)?.seq ?? cursor, hasMore: remaining.length > limit } });
      assert.ok(result.nextCursor > cursor);
      assert.equal(result.hasMore, result.nextCursor < 1100);
      seenEvents.push(...result.events); seenMessages.push(...result.roomMessages);
      cursor = result.nextCursor;
      assert.ok(++iterations < 1000);
    }
    assert.deepEqual(seenMessages, messages); assert.deepEqual(seenEvents, events);
  }
});

test("private-only and OOC-only ranges advance without a public SSE event", () => {
  assert.deepEqual(spatialNarratorBoundary({ afterSeq: 10, currentSeq: 20, limit: 5, events: [], spatial: { messages: [], nextCursor: 10, hasMore: false } }),
    { nextCursor: 20, hasMore: false, events: [], roomMessages: [] });
  const result = spatialNarratorBoundary({ afterSeq: 0, currentSeq: 99, limit: 1, events: [], spatial: { messages: [{ seq: 5 }], nextCursor: 5, hasMore: true } });
  assert.equal(result.nextCursor, 5); assert.equal(result.hasMore, true);
});
