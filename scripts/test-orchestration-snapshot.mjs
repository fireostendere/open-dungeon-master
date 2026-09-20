import assert from "node:assert/strict";
import { buildOrchestrationSnapshot } from "../shared/orchestration-snapshot.mjs";

const epoch = "a".repeat(64);
const raw = {
  campaign: {
    id: "campaign",
    title: "Compact table",
    description: "A test campaign",
    status: "active",
    kind: "campaign",
    theme: "mystery",
    scene: "A locked archive.",
    questLog: ["Find the ledger"],
    difficulty: "normal",
    startingLevel: 3,
    gameSettings: {
      language: "ru",
      unitSystem: "metric",
      combatMode: "classical",
      dmMode: "human",
      customApiKey: "SECRET_PROVIDER_KEY",
    },
    dmOutline: "SECRET_OUTLINE",
    storyArc: { secret: "SECRET_ARC" },
    floor: { mode: "open" },
    clock: { day: 2, hour: 21 },
  },
  currentSeq: 42,
  timelineEpoch: epoch,
  spatial: { enabled: false },
  pending: { rolls: [], whispers: 0, asks: false },
  party: {
    members: [{ userId: "user", username: "alice", role: "player", ready: true }],
    sheets: [{
      id: "hero", userId: "user", name: "Ada", class: "rogue", level: 3,
      currentHp: 17, maxHp: 20, tempHp: 0, ac: 15, conditions: [],
      resources: { cunning: { max: 1, used: 0 } },
      spellcasting: null, notes: "PRIVATE_SHEET_NOTE",
    }],
  },
  combat: [],
  location: { location: { id: "loc", name: "Archive", layoutDescription: "Shelves and a sealed door.", connections: ["Hall"] }, sceneTracker: null },
  recent: {
    messages: [{ seq: 41, authorType: "player", userId: "user", characterId: "hero", content: "I inspect the seal." }],
    rolls: [],
    events: [{ seq: 41, type: "message_added", payload: { secret: "SECRET_EVENT_PAYLOAD" } }],
  },
  memory: {
    summary: { summary: "The party entered the archive.", coveredCount: 10 },
    facts: [{ id: "f", category: "clue", subject: "seal", fact: "It bears a moon mark.", pinned: true, hidden: "SECRET_FACT_FIELD" }],
    notes: [{ id: "n", title: "Lead", body: "Check the western wall.", pinned: true, secret: "SECRET_NOTE_FIELD" }],
  },
  npcs: [{ id: "npc", name: "Mira", attitude: "friendly", trait: "Archivist", secret: "SECRET_NPC_FIELD" }],
};

const snapshot = buildOrchestrationSnapshot(raw, { maxBytes: 8192 });
assert.equal(snapshot.format, "odm.orchestration.v1");
assert.equal(snapshot.campaign.id, "campaign");
assert.equal(snapshot.party.characters[0].hp, 17);
assert.equal(snapshot.recent.events[0].type, "message_added");
assert.ok(snapshot.actionFamilies.includes("state"));
assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= 8192);
const serialized = JSON.stringify(snapshot);
for (const secret of ["SECRET_PROVIDER_KEY", "SECRET_OUTLINE", "SECRET_ARC", "PRIVATE_SHEET_NOTE", "SECRET_EVENT_PAYLOAD", "SECRET_FACT_FIELD", "SECRET_NOTE_FIELD", "SECRET_NPC_FIELD"]) {
  assert.equal(serialized.includes(secret), false, "compact projection leaked " + secret);
}

const spatialRaw = structuredClone(raw);
spatialRaw.spatial = {
  enabled: true, startSeq: 30, current: null,
  rooms: [{ id: "room-a", name: "Cellar", active: false, occupants: ["user"] }],
  exits: [], grants: [], floor: null, stealth: null, hasMore: false,
  messages: [{ id: "hidden-1", roomId: "room-a", seq: 42, kind: "do", authorUserId: "user", content: "I palm the key.", stealth: true, stealthStatus: "confirmed", witnessUserIds: ["user"] }],
};
const spatialSnapshot = buildOrchestrationSnapshot(spatialRaw, { maxBytes: 8192 });
assert.equal(spatialSnapshot.spatial.enabled, true);
assert.equal(spatialSnapshot.spatial.messages.at(-1).content, "I palm the key.");
assert.equal(spatialSnapshot.spatial.messages.at(-1).stealth, true);
assert.deepEqual(spatialSnapshot.spatial.messages.at(-1).witnessUserIds, ["user"]);

const unchanged = buildOrchestrationSnapshot(raw, { maxBytes: 8192, knownRevision: snapshot.revision });
assert.deepEqual(Object.keys(unchanged).sort(), ["campaignId", "currentSeq", "format", "revision", "timelineEpoch", "unchanged"].sort());
assert.equal(unchanged.unchanged, true);

const combatOnly = buildOrchestrationSnapshot({
  campaign: raw.campaign, currentSeq: 42, timelineEpoch: epoch, spatial: raw.spatial, pending: raw.pending, combat: [],
}, { maxBytes: 8192 });
assert.equal(Object.hasOwn(combatOnly, "party"), false);
assert.ok(Array.isArray(combatOnly.combat));

const noisy = structuredClone(raw);
noisy.memory.notes = Array.from({ length: 30 }, (_, i) => ({ id: "n" + i, title: "note", body: "x".repeat(240) }));
noisy.memory.facts = Array.from({ length: 30 }, (_, i) => ({ id: "f" + i, category: "fact", subject: "s", fact: "y".repeat(240) }));
noisy.npcs = Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, name: "NPC " + i, trait: "z".repeat(180) }));
const bounded = buildOrchestrationSnapshot(noisy, { maxBytes: 4096 });
assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= 4096);
assert.ok(Array.isArray(bounded.omitted) && bounded.omitted.length > 0);

console.log("PASS compact orchestration snapshot");
