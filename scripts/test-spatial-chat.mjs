import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSpatialStore, SpatialError } from "../src/lib/spatial/store.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER NOT NULL DEFAULT 1);
    INSERT INTO users VALUES('dm'),('alice'),('bob'),('carol');
    INSERT INTO campaigns(id) VALUES('game'),('other');`);
  let txn = 0, request = 0, timestamp = Date.parse("2026-09-18T12:00:00Z");
  db.transaction = fn => () => {
    const name = `spatial_test_${++txn}`;
    db.exec(`SAVEPOINT ${name}`);
    try { const value = fn(); db.exec(`RELEASE ${name}`); return value; }
    catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  };
  const store = createSpatialStore(db, {
    nextSeq: campaignId => db.prepare("UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq").get(campaignId).seq,
    now: () => new Date(timestamp).toISOString(),
  });
  const actor = (userId, campaignId = "game") => ({ campaignId, userId, isDm: userId === "dm", memberIds: ["dm", "alice", "bob", "carol"], playerIds: ["alice", "bob", "carol"] });
  const dm = actor("dm"), alice = actor("alice"), bob = actor("bob"), carol = actor("carol");
  const command = (who, operation, input, requestId = `request-${++request}`) => store.command(who, requestId, operation, input);
  const { roomId: outside } = command(dm, "enable", { name: "Street" });
  const { roomId: tavern } = command(dm, "create_room", { name: "Tavern", connectTo: outside, sound: true, sight: true });
  const move = (who, roomId) => command(who, "move", { roomId, expectedRevision: store.view(who).current.revision });
  const say = (who, content, kind = "say", roomId = store.view(who).current?.roomId) => command(who, "send", { roomId, expectedRevision: store.view(who).current?.revision, kind, content });
  const texts = (who, roomId) => store.messages(who, { roomId }).messages.map(message => message.content);
  return { db, store, dm, alice, bob, carol, actor, command, outside, tavern, move, say, texts, tick: ms => { timestamp += ms; } };
}
const denied = (fn, status) => assert.throws(fn, error => error instanceof SpatialError && error.status === status);

test("arrival never discloses earlier messages; departure preserves only witnessed history", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "Before Bob enters");
  denied(() => f.texts(f.bob, f.tavern), 404);
  f.move(f.bob, f.tavern); f.say(f.alice, "Together");
  assert.deepEqual(f.texts(f.bob, f.tavern), ["Together"]);
  f.move(f.bob, f.outside); f.say(f.alice, "After Bob leaves");
  assert.deepEqual(f.texts(f.bob, f.tavern), ["Together"]);
  assert.equal(f.store.view(f.bob).rooms.find(room => room.id === f.tavern).active, false);
});

test("re-entry does not fill the absence gap, even with an arbitrary history cursor", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.move(f.bob, f.tavern); f.say(f.alice, "First visit");
  f.move(f.bob, f.outside); f.say(f.alice, "Secret gap"); f.move(f.bob, f.tavern); f.say(f.alice, "Second visit");
  assert.deepEqual(f.texts(f.bob, f.tavern), ["First visit", "Second visit"]);
  assert.deepEqual(f.store.messages(f.bob, { roomId: f.tavern, beforeSeq: Number.MAX_SAFE_INTEGER }).messages.map(m => m.content), ["First visit", "Second visit"]);
});

test("OOC is global and available without a location", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "Pizza break", "ooc");
  assert.deepEqual(f.texts(f.bob, null), ["Pizza break"]);
  f.db.prepare("DELETE FROM spatial_presence WHERE user_id='carol'").run();
  f.say(f.carol, "Joining shortly", "ooc");
  assert.deepEqual(f.texts(f.alice, null), ["Pizza break", "Joining shortly"]);
  assert.equal(f.store.narratorRead(f.dm).messages.length, 0);
});

test("normal speech never crosses a sound-permeable boundary without an adjudicated grant", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "The password is orchid");
  denied(() => f.texts(f.bob, f.tavern), 404);
  assert.deepEqual(f.texts(f.bob, f.outside), []);
});

test("a loud incident propagates only a separate perception, without source history", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "Secret conspiracy");
  f.command(f.dm, "propagate", { roomId: f.tavern, medium: "sound", content: "An explosion shakes the tavern windows." });
  assert.deepEqual(f.texts(f.bob, f.outside), ["An explosion shakes the tavern windows."]);
  denied(() => f.texts(f.bob, f.tavern), 404);
  const { roomId: farAway } = f.command(f.dm, "create_room", { name: "Other end of town", connectTo: f.outside, sound: true });
  f.command(f.dm, "move", { roomId: farAway, userIds: ["carol"] });
  f.command(f.dm, "propagate", { roomId: f.tavern, medium: "sight", content: "Smoke pours out of the window." });
  assert.deepEqual(f.texts(f.carol, farAway), []);
});

test("eavesdropping grants future speech only, not silent actions or visual narration", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "Old secret");
  f.command(f.dm, "observe", { roomId: f.tavern, userId: "bob", mode: "speech", seconds: 60, reason: "Successful perception check at the window" });
  f.say(f.alice, "Heard words"); f.say(f.alice, "Hides a ring", "do");
  f.command(f.dm, "send", { roomId: f.tavern, kind: "narration", content: "A concealed sign is exchanged." });
  assert.deepEqual(f.texts(f.bob, f.tavern), ["Heard words"]);
  denied(() => f.say(f.bob, "Intrude", "say", f.tavern), 409);
});

test("magic can observe a distant scene but grants no retroactive access", t => {
  const f = fixture(); t.after(() => f.db.close());
  const { roomId } = f.command(f.dm, "create_room", { name: "Remote tower" });
  f.command(f.dm, "move", { roomId, userIds: ["alice"] }); f.say(f.alice, "Past");
  f.command(f.dm, "observe", { roomId, userId: "bob", mode: "scry", seconds: 60, reason: "Scrying adjudicated; spell slot spent separately" });
  f.say(f.alice, "Visible action", "do");
  assert.deepEqual(f.texts(f.bob, roomId), ["Visible action"]);
});

test("expiry, revocation and changing position stop new observations but preserve old knowledge", t => {
  const f = fixture(); t.after(() => f.db.close()); f.move(f.alice, f.tavern);
  const observe = () => f.command(f.dm, "observe", { roomId: f.tavern, userId: "bob", mode: "speech", seconds: 10, reason: "Window" });
  observe(); f.say(f.alice, "Heard"); f.tick(10_000); f.say(f.alice, "Expired");
  const { grantId } = observe(); f.say(f.alice, "Renewed"); f.command(f.dm, "revoke", { grantId }); f.say(f.alice, "Revoked");
  observe(); f.move(f.bob, f.tavern); f.move(f.bob, f.outside); f.say(f.alice, "Moved away and back");
  assert.deepEqual(f.texts(f.bob, f.tavern), ["Heard", "Renewed"]);
});

test("players cannot self-grant observation, narrate, propagate, disable, or create rooms", t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const operation of ["observe", "revoke", "propagate", "perceive", "disable", "create_room", "link"]) denied(() => f.command(f.bob, operation, {}), 403);
  denied(() => f.command(f.bob, "send", { roomId: f.outside, kind: "narration", content: "I am the DM" }), 403);
  denied(() => f.store.narratorRead(f.bob), 403);
});

test("DM can disable location chat without changing campaign state", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.exec("CREATE TABLE encounters(id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, room_id TEXT)");
  f.db.prepare("INSERT INTO encounters(id,campaign_id,room_id) VALUES('encounter','game',?)").run(f.tavern);
  f.move(f.alice, f.tavern); f.say(f.alice, "Private marker");
  const before = f.db.prepare("SELECT next_seq FROM campaigns WHERE id='game'").get().next_seq;
  const result = f.command(f.dm, "disable", {});
  assert.deepEqual(result, { disabled: true, seq: before });
  assert.equal(f.store.enabled("game"), false);
  for (const table of ["spatial_campaigns", "spatial_rooms", "spatial_messages", "spatial_presence", "spatial_visits"]) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE campaign_id='game'`).get().n, 0, table);
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE id='game'").get().n, 1);
  assert.equal(f.db.prepare("SELECT room_id FROM encounters WHERE id='encounter'").get().room_id, null);
  assert.deepEqual(f.command(f.dm, "disable", {}), { disabled: false, alreadyDisabled: true });
});

test("request IDs are idempotent and cannot be reused with different payloads", t => {
  const f = fixture(); t.after(() => f.db.close());
  const input = { roomId: f.outside, expectedRevision: 1, kind: "say", content: "Only once" };
  const first = f.command(f.alice, "send", input, "retry");
  const second = f.command(f.alice, "send", { ...input }, "retry");
  assert.deepEqual(first, second); assert.deepEqual(f.texts(f.bob, f.outside), ["Only once"]);
  denied(() => f.command(f.alice, "send", { ...input, content: "Changed" }, "retry"), 409);
});

test("a stale browser tab cannot send to or leave its previous location", t => {
  const f = fixture(); t.after(() => f.db.close()); f.move(f.alice, f.tavern);
  denied(() => f.command(f.alice, "send", { roomId: f.outside, expectedRevision: 1, kind: "say", content: "Stale" }), 409);
  denied(() => f.command(f.alice, "move", { roomId: f.outside, expectedRevision: 1 }), 409);
  assert.deepEqual(f.texts(f.bob, f.outside), []);
});

test("foreign campaign IDs and arbitrary room IDs cannot cross boundaries", t => {
  const f = fixture(); t.after(() => f.db.close());
  const otherDm = f.actor("dm", "other"); const { roomId } = f.command(otherDm, "enable", { name: "Other campaign" });
  denied(() => f.store.messages(f.bob, { roomId }), 404);
  denied(() => f.command(f.dm, "move", { roomId, userIds: ["alice"] }), 404);
  denied(() => f.store.view({ ...f.bob, memberIds: [] }), 404);
});

test("archived rooms disclose neither live occupants nor remote activity counters", t => {
  const f = fixture(); t.after(() => f.db.close()); f.move(f.bob, f.tavern); f.move(f.bob, f.outside); f.move(f.alice, f.tavern);
  const before = f.store.view(f.bob).rooms.find(room => room.id === f.tavern);
  f.say(f.alice, "Another secret");
  assert.deepEqual(f.store.view(f.bob).rooms.find(room => room.id === f.tavern), before);
  assert.deepEqual(before.occupants, []);
});

test("history pagination filters permissions before the page limit", t => {
  const f = fixture(); t.after(() => f.db.close()); f.move(f.alice, f.tavern); f.move(f.bob, f.tavern); f.say(f.alice, "First");
  f.move(f.bob, f.outside); for (let i = 0; i < 120; i++) f.say(f.alice, `Hidden ${i}`);
  f.move(f.bob, f.tavern); f.say(f.alice, "Last");
  const page = f.store.messages(f.bob, { roomId: f.tavern, limit: 1 });
  assert.equal(page.messages[0].content, "Last"); assert.ok(page.nextBefore);
  const older = f.store.messages(f.bob, { roomId: f.tavern, limit: 1, beforeSeq: page.nextBefore });
  assert.equal(older.messages[0].content, "First"); assert.equal(older.nextBefore, null);
});

test("a failed batch move rolls back every position and sequence allocation", t => {
  const f = fixture(); t.after(() => f.db.close());
  const before = f.db.prepare("SELECT next_seq FROM campaigns WHERE id='game'").get().next_seq;
  denied(() => f.command(f.dm, "move", { roomId: f.tavern, userIds: ["alice", "not-a-player"] }), 404);
  assert.equal(f.store.view(f.alice).current.roomId, f.outside);
  assert.equal(f.db.prepare("SELECT next_seq FROM campaigns WHERE id='game'").get().next_seq, before);
});

test("perceived fragments are limited to named recipients, not everyone in either room", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.command(f.dm, "perceive", { roomId: f.tavern, userIds: ["bob"], content: "You make out the word midnight." });
  assert.deepEqual(f.texts(f.bob, f.tavern), ["You make out the word midnight."]);
  denied(() => f.texts(f.alice, f.tavern), 404);
});

test("removed members receive no new receipts; restored membership does not backfill them", t => {
  const f = fixture(); t.after(() => f.db.close());
  const duringRemoval = { ...f.alice, memberIds: ["dm", "alice", "carol"], playerIds: ["alice", "carol"] };
  f.say(duringRemoval, "Absent member must not see this");
  assert.deepEqual(f.texts(f.bob, f.outside), []);
});

test("account deletion retains witnessed prose without blocking deletion; campaign deletion cascades", t => {
  const f = fixture(); t.after(() => f.db.close()); f.say(f.alice, "Remember this");
  f.db.prepare("DELETE FROM users WHERE id='alice'").run();
  assert.equal(f.store.messages(f.bob, { roomId: f.outside }).messages[0].authorUserId, null);
  f.db.prepare("DELETE FROM campaigns WHERE id='game'").run();
  for (const table of ["spatial_campaigns", "spatial_rooms", "spatial_links", "spatial_presence", "spatial_visits", "spatial_messages", "spatial_receipts", "spatial_observers", "spatial_requests"]) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});

test("closing a sound path revokes eavesdropping without revoking heard history", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern);
  f.command(f.dm, "observe", { roomId: f.tavern, userId: "bob", mode: "speech", seconds: 60, reason: "Open window" });
  f.say(f.alice, "Audible");
  f.command(f.dm, "link", { sourceId: f.tavern, targetId: f.outside, sound: false });
  f.say(f.alice, "Window closed");
  f.command(f.dm, "link", { sourceId: f.tavern, targetId: f.outside, sound: true });
  f.say(f.alice, "Reopened window is not a new permission");
  assert.deepEqual(f.texts(f.bob, f.tavern), ["Audible"]);
  assert.equal(f.store.view(f.bob).grants.length, 0);
});

test("witness IDs are available to the narrator, never to player projections", t => {
  const f = fixture(); t.after(() => f.db.close());
  f.move(f.alice, f.tavern); f.say(f.alice, "Private");
  const message = f.store.narratorRead(f.dm).messages[0];
  assert.deepEqual(message.witnessUserIds, ["alice"]);
  assert.equal(Object.hasOwn(f.store.messages(f.alice, { roomId: f.tavern }).messages[0], "witnessUserIds"), false);
});

test("reopening the store retains visits, gap permissions and durable retries", t => {
  const f = fixture(); t.after(() => f.db.close());
  const payload = { roomId: f.tavern, kind: "narration", content: "One durable message" };
  f.move(f.alice, f.tavern);
  const first = f.command(f.dm, "send", payload, "durable-retry");
  f.move(f.alice, f.outside);
  const reopened = createSpatialStore(f.db, { nextSeq: () => { throw new Error("Retry must not allocate a new sequence"); } });
  assert.deepEqual(reopened.command(f.dm, "durable-retry", "send", payload), first);
  assert.deepEqual(reopened.messages(f.alice, { roomId: f.tavern }).messages.map(m => m.content), ["One durable message"]);
  assert.equal(reopened.view(f.alice).rooms.find(room => room.id === f.tavern).active, false);
});

test("object receipts retain the observed version after a player leaves", t => {
  const f = fixture(); t.after(() => f.db.close());
  const first = f.store.publishObject(f.dm, { objectType: "note", objectId: "notice", roomId: f.outside, payload: { text: "old" } });
  assert.equal(f.store.object(f.bob, "note", "notice").version, first.version);
  f.move(f.bob, f.tavern);
  const second = f.store.publishObject(f.dm, { objectType: "note", objectId: "notice", roomId: f.outside, payload: { text: "new" } });
  assert.equal(f.store.object(f.dm, "note", "notice").version, second.version);
  assert.deepEqual(f.store.object(f.bob, "note", "notice").payload, { text: "old" });
  f.move(f.bob, f.outside);
  assert.deepEqual(f.store.object(f.bob, "note", "notice").payload, { text: "old" });
  f.store.observeObject(f.dm, { objectType: "note", objectId: "notice", userIds: ["bob"] });
  assert.deepEqual(f.store.object(f.bob, "note", "notice").payload, { text: "new" });
});
