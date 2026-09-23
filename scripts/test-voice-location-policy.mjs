import assert from "node:assert/strict";
import { test } from "node:test";
import { mayShareVoice, voiceChannel, projectVoiceRoster, revokeOutOfScope } from "../src/lib/voice/location-policy.ts";
const access = (scope = "location", rooms = { a: "tavern", b: "tavern", c: "forest" }) => ({
  scope, members: new Set(["a", "b", "c", "unplaced"]), rooms: new Map(Object.entries(rooms)),
});
const peers = [{ userId: "a", channelId: "forged" }, { userId: "b", channelId: "forged" }, { userId: "c", channelId: "forged" }];
const closable = () => ({ closed: false, close() { this.closed = true; } });
const calls = () => new Map(["a", "b", "c"].map(userId => [userId, {
  userId, channelId: "table", sendTransport: closable(), recvTransport: closable(),
  consumers: new Map(["a", "b", "c"].filter(id => id !== userId).map(id => [id, closable()])),
}]));

test("global joins all campaign members across locations", () => {
  assert.equal(mayShareVoice(access("global"), "a", "c"), true);
  assert.equal(voiceChannel(access("global"), "a"), "table");
});
test("global never joins an outsider", () => {
  assert.equal(mayShareVoice(access("global"), "a", "outsider"), false);
  assert.equal(mayShareVoice(access("global"), "outsider", "outsider"), false);
});
test("private channels are bidirectionally isolated", () => {
  assert.equal(mayShareVoice(access(), "a", "b"), true);
  assert.equal(mayShareVoice(access(), "a", "c"), false);
  assert.equal(mayShareVoice(access(), "c", "a"), false);
});
test("missing locations fail closed, not a shared null room", () => {
  const value = access("location", {});
  assert.equal(mayShareVoice(value, "a", "b"), false);
  assert.equal(mayShareVoice(value, "a", "a"), true);
  assert.notEqual(voiceChannel(value, "a"), voiceChannel(value, "b"));
});
test("roster projects only same-room identities and overwrites spoofed channels", () => {
  assert.deepEqual(projectVoiceRoster(access(), "a", peers), [
    { userId: "a", channelId: "location:tavern" }, { userId: "b", channelId: "location:tavern" },
  ]);
  assert.deepEqual(projectVoiceRoster(access(), "outsider", peers), []);
  assert.equal(peers[0].channelId, "forged");
});
test("movement closes both old directions synchronously without closing microphones", () => {
  const live = calls(); const outgoing = live.get("a").consumers.get("b");
  const incoming = live.get("b").consumers.get("a");
  revokeOutOfScope(access("location", { a: "forest", b: "tavern", c: "forest" }), live);
  assert.equal(outgoing.closed, true); assert.equal(incoming.closed, true);
  assert.equal(live.get("a").consumers.has("c"), true);
  assert.equal(live.get("a").sendTransport.closed, false);
});
test("switching global to private immediately removes cross-room media", () => {
  const live = calls(); revokeOutOfScope(access("global"), live);
  assert.equal(live.get("a").consumers.size, 2);
  revokeOutOfScope(access(), live);
  assert.deepEqual([...live.get("a").consumers.keys()], ["b"]);
  assert.equal(live.get("c").consumers.size, 0);
});
test("returning to global permits rebuilding subscriptions without unmuting microphones", () => {
  const live = calls(); revokeOutOfScope(access(), live);
  revokeOutOfScope(access("global"), live);
  assert.equal(mayShareVoice(access("global"), "a", "c"), true);
  assert.equal(live.get("a").channelId, "table");
});
test("member removal closes transports and all inbound consumers", () => {
  const live = calls(); const removed = live.get("b"); const value = access(); value.members.delete("b");
  revokeOutOfScope(value, live);
  assert.equal(live.has("b"), false); assert.equal(removed.sendTransport.closed, true);
  assert.equal(removed.recvTransport.closed, true);
  for (const peer of live.values()) assert.equal(peer.consumers.has("b"), false);
});
test("repeated revocation is idempotent", () => {
  const live = calls(); assert.equal(revokeOutOfScope(access(), live), true);
  assert.equal(revokeOutOfScope(access(), live), false);
});
test("leader/DM-looking identities do not bypass room policy", () => {
  const value = access(); value.members.add("dm"); value.members.add("leader");
  assert.equal(mayShareVoice(value, "dm", "a"), false);
  assert.equal(mayShareVoice(value, "leader", "a"), false);
});
