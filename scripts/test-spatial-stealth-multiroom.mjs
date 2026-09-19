import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createSpatialStore, SpatialError } from "../src/lib/spatial/store.mjs";
import { loadSource } from "./lib/readiness-harness.mjs";

function setupTestEnvironment() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE campaigns (
      id TEXT PRIMARY KEY,
      next_seq INTEGER NOT NULL DEFAULT 100,
      kind TEXT NOT NULL DEFAULT 'campaign',
      status TEXT NOT NULL DEFAULT 'active',
      difficulty TEXT NOT NULL DEFAULT 'normal',
      human_dm_user_id TEXT NOT NULL DEFAULT 'dm',
      owner_user_id TEXT NOT NULL DEFAULT 'dm',
      dm_user_id TEXT NOT NULL DEFAULT 'dm',
      dm_cover INTEGER NOT NULL DEFAULT 0,
      floor_json TEXT NOT NULL DEFAULT '{"mode":"free"}',
      game_settings_json TEXT NOT NULL DEFAULT '{"dmMode":"human","dmAssist":"none","globalTurn":{"enabled":false}}',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      avatar_json TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE members (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('dm','player','spectator')),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (campaign_id, user_id)
    );
    CREATE TABLE campaign_members (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      ready INTEGER NOT NULL DEFAULT 0,
      use_real_dice INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      skip_turns_count INTEGER NOT NULL DEFAULT 0,
      autopilot INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      PRIMARY KEY (campaign_id, user_id)
    );
    CREATE TABLE character_sheets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      current_hp INTEGER NOT NULL DEFAULT 10,
      max_hp INTEGER NOT NULL DEFAULT 10,
      armor_class INTEGER NOT NULL DEFAULT 12,
      speed INTEGER NOT NULL DEFAULT 30,
      conditions_json TEXT NOT NULL DEFAULT '[]',
      resources_json TEXT NOT NULL DEFAULT '{}',
      equipment_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE campaign_messages (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      author_type TEXT NOT NULL,
      user_id TEXT,
      character_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (campaign_id, seq)
    );
    CREATE TABLE campaign_events (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      audience_json TEXT,
      PRIMARY KEY (campaign_id, seq)
    );
    CREATE TABLE encounters (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      room_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
      round INTEGER NOT NULL DEFAULT 1,
      turn_index INTEGER NOT NULL DEFAULT 0,
      order_ready INTEGER NOT NULL DEFAULT 0,
      order_json TEXT NOT NULL DEFAULT '[]',
      waiting_seq INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'fight' CHECK (kind IN ('fight','scene')),
      surprised_ids_json TEXT NOT NULL DEFAULT '[]',
      turn_budget_json TEXT,
      reactions_used_json TEXT NOT NULL DEFAULT '[]',
      ammo_spent_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE INDEX idx_encounters_campaign ON encounters(campaign_id, status);
    CREATE INDEX idx_encounters_room ON encounters(campaign_id, room_id, status);
    CREATE TABLE encounter_enemies (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      max_hp INTEGER NOT NULL,
      current_hp INTEGER NOT NULL,
      ac INTEGER NOT NULL,
      initiative INTEGER,
      status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead','fled')),
      cr REAL NOT NULL DEFAULT 0.25,
      xp INTEGER NOT NULL DEFAULT 50,
      stat_json TEXT NOT NULL DEFAULT '{}',
      conditions_json TEXT NOT NULL DEFAULT '[]',
      condition_meta_json TEXT NOT NULL DEFAULT '{}',
      concentrating_on TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE INDEX idx_encounter_enemies ON encounter_enemies(encounter_id);
    CREATE TABLE battle_maps (
      id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      width INTEGER NOT NULL DEFAULT 20,
      height INTEGER NOT NULL DEFAULT 20,
      terrain TEXT NOT NULL DEFAULT '',
      ambient TEXT NOT NULL DEFAULT 'bright',
      theme TEXT NOT NULL DEFAULT 'field',
      lights_json TEXT NOT NULL DEFAULT '[]',
      seed INTEGER NOT NULL DEFAULT 0,
      round_marker INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE battle_map_tokens (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES battle_maps(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pc','enemy','npc','prop')),
      ref_id TEXT NOT NULL,
      name TEXT NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      moved_this_round INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      size TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
  `);

  let nextSavepoint = 0;
  const db = {
    exec: (text) => sql.exec(text),
    prepare: (text) => sql.prepare(text),
    transaction: (work) => (...args) => {
      const name = `tx_${++nextSavepoint}`;
      sql.exec(`SAVEPOINT ${name}`);
      try {
        const result = work(...args);
        sql.exec(`RELEASE ${name}`);
        return result;
      } catch (err) {
        sql.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    },
  };

  const core = {
    getDatabase: () => db,
    nowIso: () => new Date().toISOString(),
    parseJson: (text, fallback) => {
      try { return JSON.parse(text); } catch { return fallback; }
    },
  };

  const viewer = loadSource("src/lib/dm/viewer.ts");
  const campaigns = loadSource("src/lib/db/campaigns.ts", {
    "@/lib/db/core": core,
    "@/lib/db/settings": { normalizeSettings: (s) => s || {} },
    "@/lib/runtime-defaults": {},
    "@/lib/schemas/game-settings": {
      normalizeGameSettings: (raw) => (typeof raw === "string" ? JSON.parse(raw) : (raw ?? { dmMode: "human" })),
    },
    "@/lib/workshop/kind": {
      normalizeCampaignKind: (k) => k || "campaign",
    },
    "@/lib/uploads": { normalizeCampaignCover: () => null },
    "@/lib/dm/arc-logic": { normalizeStoryArc: () => null },
    "@/lib/dm/delegation": { normalizeCover: () => null, coverInEffect: () => false },
    "@/lib/dm/calendar": { normalizeClock: () => null },
    "@/lib/dm/party-logic": { normalizeParty: () => null },
    "@/lib/dm/viewer": viewer,
  });

  const sheets = {
    getSheetById: (id) => {
      const row = sql.prepare("SELECT * FROM character_sheets WHERE id=?").get(id);
      return row ? { id: row.id, campaignId: row.campaign_id, userId: row.user_id, name: row.name, currentHp: row.current_hp, maxHp: row.max_hp } : null;
    },
    getSheetForUser: (cid, uid) => {
      const row = sql.prepare("SELECT * FROM character_sheets WHERE campaign_id=? AND user_id=?").get(cid, uid);
      return row ? { id: row.id, campaignId: row.campaign_id, userId: row.user_id, name: row.name, currentHp: row.current_hp, maxHp: row.max_hp } : null;
    },
    listSheets: (cid) => {
      return sql.prepare("SELECT * FROM character_sheets WHERE campaign_id=?").all(cid).map((row) => ({
        id: row.id, campaignId: row.campaign_id, userId: row.user_id, name: row.name, currentHp: row.current_hp, maxHp: row.max_hp,
      }));
    },
  };

  const encounters = loadSource("src/lib/db/encounters.ts", {
    "@/lib/db/core": core,
    "@/lib/bestiary/statblock": {},
    "@/lib/schemas/sheet": {},
    "@/lib/dm/action-budget": {},
  });

  const store = createSpatialStore(db, {
    nextSeq: (cid) => campaigns.allocateSeq(cid),
    now: () => core.nowIso(),
    uuid: randomUUID,
  });

  const spatialService = {
    SpatialError,
    spatialStore: () => store,
    spatialEnabled: (cid) => store.enabled(cid),
    spatialContext: (cid, uid) => {
      const campaign = campaigns.getCampaignForUser(cid, uid);
      if (!campaign) throw new SpatialError("Campaign not found.", 404);
      const members = campaigns.listMembers(cid);
      const actor = {
        campaignId: cid,
        userId: uid,
        isDm: campaigns.capsFor(campaign, uid).role === "dm",
        memberIds: members.map((m) => m.userId),
        playerIds: members.filter((m) => m.role !== "dm").map((m) => m.userId),
      };
      return { campaign, actor };
    },
    runSpatialCommand: (cid, uid, raw) => {
      const { actor } = spatialService.spatialContext(cid, uid);
      const { operation, requestId = randomUUID(), ...input } = raw;
      if (operation === "move" && !actor.isDm) {
        const userRoom = store.getUserRoom(cid, uid);
        if (userRoom && encounters.getActiveEncounter(cid, userRoom)) {
          throw new SpatialError("Ask the DM to adjudicate movement during an encounter.", 409);
        }
      }
      return store.command(actor, requestId, operation, input);
    },
  };

  const encounterView = loadSource("src/lib/db/encounter-view.ts", {
    "@/lib/bestiary/health": { healthState: () => "healthy" },
    "@/lib/bestiary/statblock": { creatureTypeOf: () => "humanoid" },
    "@/lib/db/battle-maps": { getBattleMapForEncounter: () => null, listHiddenRefIds: () => [] },
    "@/lib/db/encounters": encounters,
    "@/lib/spatial/service": spatialService,
  });

  const narrator = loadSource("src/lib/spatial/narrator.ts", {
    "@/lib/dm/invoke-catalog": {},
    "@/lib/dm/narrator-command": {
      NarratorCommandError: class extends Error {
        constructor(message, status = 400) { super(message); this.status = status; }
      },
    },
    "@/lib/spatial/service": spatialService,
  });

  // Populate base campaign data
  sql.exec(`
    INSERT INTO campaigns (id) VALUES ('c1');
    INSERT INTO users (id) VALUES ('dm'), ('a'), ('b'), ('c'), ('d'), ('e');
    INSERT INTO members (campaign_id, user_id, role) VALUES
      ('c1', 'dm', 'dm'),
      ('c1', 'a', 'player'),
      ('c1', 'b', 'player'),
      ('c1', 'c', 'player'),
      ('c1', 'd', 'player'),
      ('c1', 'e', 'player');
    INSERT INTO campaign_members (campaign_id, user_id, role) VALUES
      ('c1', 'dm', 'dm'),
      ('c1', 'a', 'player'),
      ('c1', 'b', 'player'),
      ('c1', 'c', 'player'),
      ('c1', 'd', 'player'),
      ('c1', 'e', 'player');
    INSERT INTO character_sheets (id, campaign_id, user_id, name, level, current_hp, max_hp, armor_class) VALUES
      ('char-a', 'c1', 'a', 'Thorin', 3, 28, 28, 16),
      ('char-b', 'c1', 'b', 'Lyra', 3, 22, 22, 14),
      ('char-c', 'c1', 'c', 'Elidor', 3, 20, 20, 13),
      ('char-d', 'c1', 'd', 'Kael', 3, 25, 25, 15),
      ('char-e', 'c1', 'e', 'Milo', 3, 18, 18, 12);
  `);

  // Enable spatial mode and setup rooms
  const dmActor = {
    campaignId: "c1",
    userId: "dm",
    isDm: true,
    memberIds: ["dm", "a", "b", "c", "d", "e"],
    playerIds: ["a", "b", "c", "d", "e"],
  };

  store.command(dmActor, randomUUID(), "enable", { name: "Tavern" });
  const tavernRoom = sql.prepare("SELECT id FROM spatial_rooms WHERE campaign_id='c1' AND name='Tavern'").get();
  const tavernId = tavernRoom.id;

  const { roomId: dungeonId } = store.command(dmActor, randomUUID(), "create_room", {
    name: "Dungeon",
    connectTo: tavernId,
    walkable: true,
    sound: false,
    sight: false,
  });

  const { roomId: forestId } = store.command(dmActor, randomUUID(), "create_room", {
    name: "Forest",
    connectTo: tavernId,
    walkable: true,
    sound: true,
    sight: true,
  });

  const { roomId: gladeId } = store.command(dmActor, randomUUID(), "create_room", {
    name: "Glade",
    connectTo: forestId,
    walkable: true,
    sound: true,
    sight: true,
  });

  // Move players to starting locations:
  // a, b, c in Tavern
  // d in Dungeon
  // e in Forest
  store.command(dmActor, randomUUID(), "move", { roomId: dungeonId, userIds: ["d"] });
  store.command(dmActor, randomUUID(), "move", { roomId: forestId, userIds: ["e"] });

  const getActor = (uid) => ({
    campaignId: "c1",
    userId: uid,
    isDm: uid === "dm",
    memberIds: ["dm", "a", "b", "c", "d", "e"],
    playerIds: ["a", "b", "c", "d", "e"],
  });

  return {
    sql,
    db,
    core,
    campaigns,
    sheets,
    encounters,
    encounterView,
    narrator,
    store,
    spatialService,
    getActor,
    rooms: { tavernId, dungeonId, forestId, gladeId },
  };
}

test("Scenario 1: Room isolation - speech and action are strictly room-scoped", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const actorB = env.getActor("b");
  const actorC = env.getActor("c");
  const actorD = env.getActor("d");
  const actorE = env.getActor("e");

  // A sends a normal 'say' in Tavern
  const revA = env.store.view(actorA).current.revision;
  const { message } = env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "say",
    content: "Greetings tavern companions!",
    expectedRevision: revA,
  });

  assert.ok(message.id, "Message was created");
  assert.equal(message.kind, "say");

  // A, B, C in Tavern receive the message
  const msgsA = env.store.messages(actorA, { roomId: env.rooms.tavernId }).messages;
  const msgsB = env.store.messages(actorB, { roomId: env.rooms.tavernId }).messages;
  const msgsC = env.store.messages(actorC, { roomId: env.rooms.tavernId }).messages;

  assert.equal(msgsA.length, 1);
  assert.equal(msgsB.length, 1);
  assert.equal(msgsC.length, 1);
  assert.equal(msgsA[0].content, "Greetings tavern companions!");
  assert.equal(msgsB[0].content, "Greetings tavern companions!");

  // D in Dungeon and E in Forest do not receive anything
  const msgsD = env.store.messages(actorD, { roomId: env.rooms.dungeonId }).messages;
  const msgsE = env.store.messages(actorE, { roomId: env.rooms.forestId }).messages;
  assert.equal(msgsD.length, 0, "Dungeon occupant receives 0 messages");
  assert.equal(msgsE.length, 0, "Forest occupant receives 0 messages");

  // D cannot read A's message
  assert.equal(env.store.canReadMessage(actorD, message.id), false);
  assert.equal(env.store.canReadMessage(actorE, message.id), false);
});

test("Scenario 2: Personal stealth lifecycle - private pending message, no broadcast to others", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const actorB = env.getActor("b");
  const actorC = env.getActor("c");
  const actorDm = env.getActor("dm");

  const revA = env.store.view(actorA).current.revision;
  const { message } = env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "do",
    content: "I slip behind the wine casks to ambush the corrupt barkeep.",
    stealth: true,
    characterId: "char-a",
    expectedRevision: revA,
  });

  assert.ok(message.id);
  assert.equal(message.stealth, true);
  assert.equal(message.stealthStatus, "pending");

  // A sees their own pending message with stealth: true
  const msgsA = env.store.messages(actorA, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsA.length, 1);
  assert.equal(msgsA[0].stealth, true);
  assert.equal(msgsA[0].stealthStatus, "pending");

  // B and C in the same room receive ZERO messages!
  const msgsB = env.store.messages(actorB, { roomId: env.rooms.tavernId }).messages;
  const msgsC = env.store.messages(actorC, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsB.length, 0, "B received nothing of A's pending stealth");
  assert.equal(msgsC.length, 0, "C received nothing of A's pending stealth");

  // Check stealth state in store
  const stealthState = env.store.getStealthState("c1", "char-a");
  assert.deepEqual(stealthState.status, "pending");
  assert.deepEqual(stealthState.roomId, env.rooms.tavernId);

  // DM can read message
  assert.equal(env.store.canReadMessage(actorDm, message.id), true);

  // Observers haven't detected A yet
  assert.equal(env.store.isDetected("c1", "b", "char-a"), false);
  assert.equal(env.store.isDetected("c1", "c", "char-a"), false);
});

test("Scenario 3: Battlemap and encounter-view filtering during pending stealth", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const revA = env.store.view(actorA).current.revision;

  // A enters pending stealth
  env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "do",
    content: "I hide in the rafters.",
    stealth: true,
    characterId: "char-a",
    expectedRevision: revA,
  });

  // Create an encounter in Tavern with combatants A, B, C and Goblin
  const enc = env.encounters.createEncounter("c1", "Tavern Skirmish", "fight", env.rooms.tavernId);
  enc.orderReady = true;
  enc.order = [
    { kind: "pc", characterId: "char-a", userId: "a", name: "Thorin", initiative: 20 },
    { kind: "pc", characterId: "char-b", userId: "b", name: "Lyra", initiative: 15 },
    { kind: "pc", characterId: "char-c", userId: "c", name: "Elidor", initiative: 10 },
  ];
  env.encounters.saveEncounter(enc);

  // Viewer C looks at the encounter
  const viewForC = env.encounterView.activePublicEncounter("c1", {
    viewerUserId: "c",
    roomId: env.rooms.tavernId,
  });
  assert.ok(viewForC, "Public encounter exists");
  // char-a must be hidden / omitted from C's order list
  const charAInOrderC = viewForC.order.find((e) => e.id === "char-a");
  assert.equal(charAInOrderC, undefined, "Hidden combatant char-a omitted from C's order");
  // C only sees visible combatants: Lyra and Elidor
  assert.equal(viewForC.order.length, 2);

  // Current turn is on Thorin (char-a), so currentActorId should be null for C to avoid leaking turn
  assert.equal(viewForC.currentActorId, null, "Turn actor masked when actor is hidden");

  // Viewer A (Thorin himself) sees himself
  const viewForA = env.encounterView.activePublicEncounter("c1", {
    viewerUserId: "a",
    roomId: env.rooms.tavernId,
  });
  const charAInOrderA = viewForA.order.find((e) => e.id === "char-a");
  assert.ok(charAInOrderA, "A can see their own combatant");

  // DM sees all with details
  const viewForDm = env.encounterView.activePublicEncounter("c1", {
    enemyNumbers: true,
    roomId: env.rooms.tavernId,
  });
  assert.equal(viewForDm.order.length, 3, "DM sees all combatants");
});

test("Scenario 4: Stealth adjudication (stealth_resolve) - selective detection & perceived fragment delivery", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const actorB = env.getActor("b");
  const actorC = env.getActor("c");
  const actorDm = env.getActor("dm");

  const revA = env.store.view(actorA).current.revision;
  const { message } = env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "do",
    content: "I sneak behind the heavy velvet curtains with daggers drawn.",
    stealth: true,
    characterId: "char-a",
    expectedRevision: revA,
  });

  // DM resolves stealth: B detects A via hearing; C fails detection
  const resolveResult = env.store.command(actorDm, randomUUID(), "stealth_resolve", {
    messageId: message.id,
    outcome: "confirmed",
    characterId: "char-a",
    detectedByUserIds: ["b"],
    perceivedText: "You hear the faint rustle of velvet near the back corner.",
    sense: "sound",
  });

  assert.equal(resolveResult.outcome, "confirmed");
  assert.deepEqual(resolveResult.detectedByUserIds, ["b"]);
  assert.ok(resolveResult.perceptionMessage, "Perception message created");

  // Detection mapping
  assert.equal(env.store.isDetected("c1", "b", "char-a"), true, "B detected char-a");
  assert.equal(env.store.isDetected("c1", "b", "a"), true, "B detected user a");
  assert.equal(env.store.isDetected("c1", "c", "char-a"), false, "C did NOT detect char-a");
  assert.equal(env.store.isDetected("c1", "c", "a"), false, "C did NOT detect user a");

  // Message check for B: B sees the perception fragment with stealth haze!
  const msgsB = env.store.messages(actorB, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsB.length, 1);
  assert.equal(msgsB[0].kind, "perception");
  assert.equal(msgsB[0].content, "You hear the faint rustle of velvet near the back corner.");
  assert.equal(msgsB[0].stealth, true);
  assert.equal(msgsB[0].stealthStatus, "confirmed");

  // Crucially: B does NOT see A's inner plan ("I sneak behind the heavy velvet curtains with daggers drawn.")
  assert.doesNotMatch(msgsB[0].content, /daggers drawn/);

  // Message check for C: C receives NOTHING!
  const msgsC = env.store.messages(actorC, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsC.length, 0, "C receives neither the original action nor the perception fragment");

  // Encounter view after detection:
  const enc = env.encounters.createEncounter("c1", "Ambush", "fight", env.rooms.tavernId);
  enc.orderReady = true;
  enc.order = [
    { kind: "pc", characterId: "char-a", userId: "a", name: "Thorin", initiative: 20 },
    { kind: "pc", characterId: "char-b", userId: "b", name: "Lyra", initiative: 15 },
    { kind: "pc", characterId: "char-c", userId: "c", name: "Elidor", initiative: 10 },
  ];
  env.encounters.saveEncounter(enc);

  // B detected A -> A is VISIBLE to B!
  const viewForB = env.encounterView.activePublicEncounter("c1", {
    viewerUserId: "b",
    roomId: env.rooms.tavernId,
  });
  assert.ok(viewForB.order.find((e) => e.id === "char-a"), "char-a is visible to observer B");

  // C did NOT detect A -> A remains HIDDEN from C!
  const viewForC = env.encounterView.activePublicEncounter("c1", {
    viewerUserId: "c",
    roomId: env.rooms.tavernId,
  });
  assert.equal(viewForC.order.find((e) => e.id === "char-a"), undefined, "char-a remains hidden from C");
});

test("Scenario 5: Sensory detection lifecycle (detect & lose_detection)", () => {
  const env = setupTestEnvironment();
  const actorDm = env.getActor("dm");

  // Initially undetected
  assert.equal(env.store.isDetected("c1", "c", "char-a"), false);

  // DM registers detection for C
  env.store.command(actorDm, randomUUID(), "detect", {
    observerId: "c",
    targetId: "char-a",
    roomId: env.rooms.tavernId,
    sense: "sight",
    state: "detected",
  });

  assert.equal(env.store.isDetected("c1", "c", "char-a"), true, "C detects char-a after detect command");

  // DM revokes detection
  env.store.command(actorDm, randomUUID(), "lose_detection", {
    observerId: "c",
    targetId: "char-a",
  });

  assert.equal(env.store.isDetected("c1", "c", "char-a"), false, "C lost detection of char-a");
});

test("Scenario 6: Stealth full reveal outcome (outcome: 'revealed')", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const actorB = env.getActor("b");
  const actorC = env.getActor("c");
  const actorDm = env.getActor("dm");

  const revA = env.store.view(actorA).current.revision;
  const { message } = env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "do",
    content: "I attempt to climb up the chandelier.",
    stealth: true,
    characterId: "char-a",
    expectedRevision: revA,
  });

  // DM resolves with 'revealed'
  const resolveResult = env.store.command(actorDm, randomUUID(), "stealth_resolve", {
    messageId: message.id,
    outcome: "revealed",
    characterId: "char-a",
    perceivedText: "Thorin slips and the chandelier rattles loudly, revealing him to everyone!",
    sense: "sight",
  });

  assert.equal(resolveResult.outcome, "revealed");

  // All room occupants now detect A
  assert.equal(env.store.isDetected("c1", "b", "char-a"), true);
  assert.equal(env.store.isDetected("c1", "c", "char-a"), true);

  // Both B and C receive the revealed perception message
  const msgsB = env.store.messages(actorB, { roomId: env.rooms.tavernId }).messages;
  const msgsC = env.store.messages(actorC, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsB.length, 1);
  assert.equal(msgsC.length, 1);
  assert.equal(msgsB[0].stealthStatus, "revealed");
  assert.equal(msgsC[0].stealthStatus, "revealed");
});

test("Scenario 7: Multi-scene independent combat encounters across rooms", () => {
  const env = setupTestEnvironment();

  // Create two simultaneous combats in Tavern (room 1) and Dungeon (room 2)
  const encTavern = env.encounters.createEncounter("c1", "Brawl in Tavern", "fight", env.rooms.tavernId);
  encTavern.order = [
    { kind: "pc", characterId: "char-a", userId: "a", name: "Thorin", initiative: 18 },
    { kind: "pc", characterId: "char-b", userId: "b", name: "Lyra", initiative: 12 },
  ];
  env.encounters.saveEncounter(encTavern);

  const encDungeon = env.encounters.createEncounter("c1", "Crypt Battle", "fight", env.rooms.dungeonId);
  encDungeon.order = [
    { kind: "pc", characterId: "char-d", userId: "d", name: "Kael", initiative: 15 },
  ];
  env.encounters.saveEncounter(encDungeon);

  assert.ok(encTavern.id);
  assert.ok(encDungeon.id);

  // Both are simultaneously active
  const activeList = env.encounters.listActiveEncounters("c1");
  assert.equal(activeList.length, 2, "Two encounters simultaneously active");

  // Room scoping queries
  assert.equal(env.encounters.getActiveEncounter("c1", env.rooms.tavernId).id, encTavern.id);
  assert.equal(env.encounters.getActiveEncounter("c1", env.rooms.dungeonId).id, encDungeon.id);

  // Character / user encounter resolution
  assert.equal(env.encounters.getEncounterForUser("c1", "a").id, encTavern.id);
  assert.equal(env.encounters.getEncounterForUser("c1", "b").id, encTavern.id);
  assert.equal(env.encounters.getEncounterForUser("c1", "d").id, encDungeon.id);

  // User E in Forest has NO encounter
  assert.equal(env.encounters.getEncounterForUser("c1", "e"), null, "User in peaceful room has no encounter");
});

test("Scenario 8: Independent initiative progression across rooms", () => {
  const env = setupTestEnvironment();

  // Combat in Tavern (A, B, C)
  const encTavern = env.encounters.createEncounter("c1", "Tavern Fight", "fight", env.rooms.tavernId);
  env.encounters.insertEnemy({
    encounterId: encTavern.id,
    campaignId: "c1",
    slug: "goblin",
    displayName: "Goblin Raider",
    initiative: 14,
    stats: { maxHp: 7, ac: 15, cr: 0.25, xp: 50 },
  });

  // Combat in Dungeon (D)
  const encDungeon = env.encounters.createEncounter("c1", "Dungeon Fight", "fight", env.rooms.dungeonId);
  env.encounters.insertEnemy({
    encounterId: encDungeon.id,
    campaignId: "c1",
    slug: "skeleton",
    displayName: "Skeleton Guard",
    initiative: 8,
    stats: { maxHp: 13, ac: 13, cr: 0.25, xp: 50 },
  });

  // Check stage: neither is ready
  assert.equal(env.encounters.getActiveEncounter("c1", env.rooms.tavernId).orderReady, false);
  assert.equal(env.encounters.getActiveEncounter("c1", env.rooms.dungeonId).orderReady, false);

  // Record initiative for Tavern characters A, B, C
  // We simulate recordInitiativeRoll logic for room scoping:
  const rollInit = (charId, roll) => {
    const sheet = env.sheets.getSheetById(charId);
    const userRoom = env.store.getUserRoom("c1", sheet.userId);
    const encounter = env.encounters.getActiveEncounter("c1", userRoom);
    encounter.order.push({ kind: "pc", characterId: sheet.id, userId: sheet.userId, name: sheet.name, initiative: roll });
    const allSheets = env.sheets.listSheets("c1");
    const relevantSheets = encounter.roomId ? allSheets.filter((s) => env.store.getUserRoom("c1", s.userId) === encounter.roomId) : allSheets;
    const staged = encounter.order.filter((e) => e.kind === "pc");
    if (staged.length >= relevantSheets.length) {
      encounter.orderReady = true;
      encounter.turnIndex = 0;
    }
    env.encounters.saveEncounter(encounter);
  };

  rollInit("char-a", 18);
  rollInit("char-b", 12);
  rollInit("char-c", 16);

  // Tavern encounter is READY!
  const updatedTavern = env.encounters.getActiveEncounter("c1", env.rooms.tavernId);
  assert.equal(updatedTavern.orderReady, true, "Tavern combat starts without waiting for other rooms");

  // Dungeon encounter is STILL WAITING for D!
  const updatedDungeon = env.encounters.getActiveEncounter("c1", env.rooms.dungeonId);
  assert.equal(updatedDungeon.orderReady, false, "Dungeon combat is not affected by Tavern starting");

  // D rolls initiative
  rollInit("char-d", 15);
  const dungeonReady = env.encounters.getActiveEncounter("c1", env.rooms.dungeonId);
  assert.equal(dungeonReady.orderReady, true, "Dungeon combat starts independently");
});

test("Scenario 9: Room-scoped floors", () => {
  const env = setupTestEnvironment();

  // Set distinct floors for Tavern and Dungeon
  const floorTavern = { mode: "initiative", encounterId: "enc-1", userIds: ["a"], currentName: "Thorin", round: 1 };
  const floorDungeon = { mode: "initiative", encounterId: "enc-2", userIds: ["d"], currentName: "Kael", round: 1 };

  env.campaigns.setFloor("c1", floorTavern, env.rooms.tavernId);
  env.campaigns.setFloor("c1", floorDungeon, env.rooms.dungeonId);

  // Verify room-scoped floors
  assert.deepEqual(env.campaigns.getFloor("c1", env.rooms.tavernId), floorTavern);
  assert.deepEqual(env.campaigns.getFloor("c1", env.rooms.dungeonId), floorDungeon);

  // Forest has default open floor
  assert.deepEqual(env.campaigns.getFloor("c1", env.rooms.forestId), { mode: "open" });

  // View method returns room-specific floor for each actor
  const viewA = env.store.view(env.getActor("a"));
  assert.deepEqual(viewA.floor, floorTavern);

  const viewD = env.store.view(env.getActor("d"));
  assert.deepEqual(viewD.floor, floorDungeon);

  const viewE = env.store.view(env.getActor("e"));
  assert.equal(viewE.floor, null, "Peaceful room has no custom initiative floor");
});

test("Scenario 10: Peaceful room freedom vs combat movement lock", () => {
  const env = setupTestEnvironment();

  // Put an active encounter in Tavern
  env.encounters.createEncounter("c1", "Tavern Fight", "fight", env.rooms.tavernId);

  // Actor E in Forest has NO encounter in Forest. E can move freely to connected Glade!
  const revE = env.store.view(env.getActor("e")).current.revision;
  const moveResult = env.spatialService.runSpatialCommand("c1", "e", {
    operation: "move",
    roomId: env.rooms.gladeId,
    expectedRevision: revE,
  });
  assert.ok(moveResult.moved, "Player in peaceful room can move without encounter hindrance");
  assert.equal(env.store.getUserRoom("c1", "e"), env.rooms.gladeId);

  // Actor A in Tavern tries to move via self-move:
  const revA = env.store.view(env.getActor("a")).current.revision;
  assert.throws(
    () => {
      env.spatialService.runSpatialCommand("c1", "a", {
        operation: "move",
        roomId: env.rooms.dungeonId,
        expectedRevision: revA,
      });
    },
    (err) => err instanceof SpatialError && /encounter/.test(err.message),
    "Movement during encounter in user's room requires DM adjudication"
  );
});

test("Scenario 11: Independent combat termination", () => {
  const env = setupTestEnvironment();

  const encTavern = env.encounters.createEncounter("c1", "Tavern Fight", "fight", env.rooms.tavernId);
  const encDungeon = env.encounters.createEncounter("c1", "Dungeon Fight", "fight", env.rooms.dungeonId);

  // End tavern encounter
  env.encounters.endEncounter(encTavern.id, "victory");

  // Tavern encounter is finished
  assert.equal(env.encounters.getActiveEncounter("c1", env.rooms.tavernId), null);

  // Dungeon encounter is STILL ACTIVE!
  const activeDungeon = env.encounters.getActiveEncounter("c1", env.rooms.dungeonId);
  assert.ok(activeDungeon, "Dungeon fight remains active after Tavern fight ends");
  assert.equal(activeDungeon.id, encDungeon.id);
});

test("Scenario 12: MCP Narrator tools catalog & operation wiring", () => {
  const env = setupTestEnvironment();

  // Verify catalog entries
  const catalogNames = env.narrator.SPATIAL_NARRATOR_CATALOG.map((e) => e.name);
  assert.ok(catalogNames.includes("location_stealth_resolve"));
  assert.ok(catalogNames.includes("location_detect"));
  assert.ok(catalogNames.includes("location_lose_detection"));
  assert.ok(catalogNames.includes("location_set_floor"));

  // Verify operation map
  assert.equal(env.narrator.SPATIAL_NARRATOR_OPERATIONS.location_stealth_resolve, "stealth_resolve");
  assert.equal(env.narrator.SPATIAL_NARRATOR_OPERATIONS.location_detect, "detect");
  assert.equal(env.narrator.SPATIAL_NARRATOR_OPERATIONS.location_lose_detection, "lose_detection");
  assert.equal(env.narrator.SPATIAL_NARRATOR_OPERATIONS.location_set_floor, "set_floor");

  // Invoke location_detect via invokeSpatialForNarrator
  const detectRes = env.narrator.invokeSpatialForNarrator("c1", "dm", "location_detect", {
    observerId: "b",
    targetId: "char-c",
    roomId: env.rooms.tavernId,
    sense: "sight",
  });
  assert.equal(detectRes.state, "detected");
  assert.equal(env.store.isDetected("c1", "b", "char-c"), true);

  // Invoke location_lose_detection
  const loseRes = env.narrator.invokeSpatialForNarrator("c1", "dm", "location_lose_detection", {
    observerId: "b",
    targetId: "char-c",
  });
  assert.equal(loseRes.lost, true);
  assert.equal(env.store.isDetected("c1", "b", "char-c"), false);

  // Invoke location_set_floor
  const floorRes = env.narrator.invokeSpatialForNarrator("c1", "dm", "location_set_floor", {
    roomId: env.rooms.tavernId,
    floor: { mode: "free", note: "Tavern calm" },
  });
  assert.equal(floorRes.floor.note, "Tavern calm");
  assert.deepEqual(env.store.getRoomFloor("c1", env.rooms.tavernId), { mode: "free", note: "Tavern calm" });
});

test("Scenario 13: Sensory channels (sight vs sound) and multi-observer asymmetric perception", () => {
  const env = setupTestEnvironment();
  const actorA = env.getActor("a");
  const actorB = env.getActor("b");
  const actorC = env.getActor("c");
  const actorD = env.getActor("d");
  const actorDm = env.getActor("dm");

  // A enters stealth in Tavern
  const revA = env.store.view(actorA).current.revision;
  const { message } = env.store.command(actorA, randomUUID(), "send", {
    roomId: env.rooms.tavernId,
    kind: "do",
    content: "I crawl silently under the counter to steal the barkeep's key.",
    stealth: true,
    characterId: "char-a",
    expectedRevision: revA,
  });

  // DM registers B detecting via sound
  env.store.command(actorDm, randomUUID(), "detect", {
    observerId: "b",
    targetId: "char-a",
    roomId: env.rooms.tavernId,
    sense: "sound",
    state: "detected",
  });

  // DM registers C detecting via sight
  env.store.command(actorDm, randomUUID(), "detect", {
    observerId: "c",
    targetId: "char-a",
    roomId: env.rooms.tavernId,
    sense: "sight",
    state: "detected",
  });

  // Verify sensory channels in detections table
  const detB = env.sql.prepare("SELECT * FROM spatial_detections WHERE campaign_id='c1' AND observer_id='b' AND target_id='char-a'").get();
  const detC = env.sql.prepare("SELECT * FROM spatial_detections WHERE campaign_id='c1' AND observer_id='c' AND target_id='char-a'").get();
  assert.equal(detB.sense, "sound");
  assert.equal(detC.sense, "sight");

  // D in Dungeon is unaware
  assert.equal(env.store.isDetected("c1", "d", "char-a"), false);

  // Deliver targeted perception: B gets hearing clue
  const { message: soundPerception } = env.store.command(actorDm, randomUUID(), "perceive", {
    roomId: env.rooms.tavernId,
    userIds: ["b"],
    content: "You hear coins clinking softly under the bar counter.",
  });
  assert.ok(soundPerception.id);

  // Deliver targeted perception: C gets visual clue
  const { message: sightPerception } = env.store.command(actorDm, randomUUID(), "perceive", {
    roomId: env.rooms.tavernId,
    userIds: ["c"],
    content: "You spot a hand reaching into the keybox under the counter.",
  });
  assert.ok(sightPerception.id);

  // B only receives the sound clue
  const msgsB = env.store.messages(actorB, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsB.length, 1);
  assert.equal(msgsB[0].content, "You hear coins clinking softly under the bar counter.");

  // C only receives the sight clue
  const msgsC = env.store.messages(actorC, { roomId: env.rooms.tavernId }).messages;
  assert.equal(msgsC.length, 1);
  assert.equal(msgsC[0].content, "You spot a hand reaching into the keybox under the counter.");

  // Neither saw A's original text ("I crawl silently under the counter to steal the barkeep's key.")
  assert.doesNotMatch(msgsB[0].content, /steal/);
  assert.doesNotMatch(msgsC[0].content, /steal/);

  // D in Dungeon has 0 messages
  const msgsD = env.store.messages(actorD, { roomId: env.rooms.dungeonId }).messages;
  assert.equal(msgsD.length, 0);
});

