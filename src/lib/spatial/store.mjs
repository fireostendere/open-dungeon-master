import { createHash, randomUUID } from "node:crypto";

// This ledger is intentionally NOT campaign_messages or campaign_events.
// A room's membership is a write-time audience, never a read-time history grant.
// All public reads require a freshly authenticated actor supplied by service.ts.
export class SpatialError extends Error {
  constructor(message, status = 400) { super(message); this.name = "SpatialError"; this.status = status; }
}

export const SPATIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS spatial_campaigns (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  start_seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spatial_rooms (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  floor_json TEXT,
  UNIQUE(campaign_id, id)
);
CREATE TABLE IF NOT EXISTS spatial_links (
  campaign_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  walkable INTEGER NOT NULL DEFAULT 1 CHECK(walkable IN (0,1)),
  sound INTEGER NOT NULL DEFAULT 0 CHECK(sound IN (0,1)),
  sight INTEGER NOT NULL DEFAULT 0 CHECK(sight IN (0,1)),
  PRIMARY KEY(campaign_id, source_id, target_id),
  FOREIGN KEY(campaign_id, source_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY(campaign_id, target_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE,
  CHECK(source_id <> target_id)
);
CREATE TABLE IF NOT EXISTS spatial_presence (
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(campaign_id, user_id),
  FOREIGN KEY(campaign_id, room_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS spatial_visits (
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  first_seq INTEGER NOT NULL,
  PRIMARY KEY(campaign_id, user_id, room_id),
  FOREIGN KEY(campaign_id, room_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS spatial_messages (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  room_id TEXT,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('say','do','narration','perception','ooc')),
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stealth INTEGER NOT NULL DEFAULT 0,
  stealth_status TEXT NOT NULL DEFAULT 'none' CHECK(stealth_status IN ('none','pending','confirmed','revealed','failed')),
  UNIQUE(campaign_id, seq),
  UNIQUE(campaign_id, id),
  FOREIGN KEY(campaign_id, room_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE,
  CHECK((kind = 'ooc' AND room_id IS NULL) OR (kind <> 'ooc' AND room_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS spatial_messages_room_seq ON spatial_messages(campaign_id, room_id, seq DESC);
CREATE TABLE IF NOT EXISTS spatial_detections (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  observer_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  room_id TEXT REFERENCES spatial_rooms(id) ON DELETE CASCADE,
  sense TEXT NOT NULL DEFAULT 'sight' CHECK(sense IN ('sight','sound','both','special')),
  state TEXT NOT NULL DEFAULT 'detected' CHECK(state IN ('detected','unaware','suspected')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id, observer_id, target_id)
);
CREATE INDEX IF NOT EXISTS spatial_detections_target ON spatial_detections(campaign_id, target_id);
CREATE INDEX IF NOT EXISTS spatial_detections_room ON spatial_detections(campaign_id, room_id);
CREATE TABLE IF NOT EXISTS spatial_stealth_states (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES spatial_rooms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','revealed','failed')),
  stealth_roll INTEGER,
  passive_dc INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id, character_id)
);
CREATE INDEX IF NOT EXISTS spatial_stealth_room ON spatial_stealth_states(campaign_id, room_id);
CREATE TABLE IF NOT EXISTS spatial_receipts (
  campaign_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(message_id, user_id),
  FOREIGN KEY(campaign_id, message_id) REFERENCES spatial_messages(campaign_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS spatial_receipts_user ON spatial_receipts(campaign_id,user_id,message_id);
CREATE TABLE IF NOT EXISTS spatial_observers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  anchor_revision INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('speech','scry')),
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  FOREIGN KEY(campaign_id, source_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE,
  FOREIGN KEY(campaign_id, anchor_id) REFERENCES spatial_rooms(campaign_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS spatial_observers_source ON spatial_observers(campaign_id,source_id,expires_at);
CREATE TABLE IF NOT EXISTS spatial_requests (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY(campaign_id,actor_id,request_id)
);
CREATE TABLE IF NOT EXISTS spatial_object_versions (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  room_id TEXT REFERENCES spatial_rooms(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,object_type,object_id,version)
);
CREATE INDEX IF NOT EXISTS spatial_object_versions_latest ON spatial_object_versions(campaign_id,object_type,object_id,version DESC);
CREATE TABLE IF NOT EXISTS spatial_object_receipts (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  observed_seq INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,user_id,object_type,object_id)
);`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function text(value, maximum, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new SpatialError(`Invalid ${label}.`);
  return value.trim();
}
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new SpatialError(`Invalid ${label}.`);
  return value;
}
function mapMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    seq: row.seq,
    kind: row.kind,
    authorUserId: row.author_user_id,
    content: row.content,
    createdAt: row.created_at,
    stealth: Boolean(row.stealth),
    stealthStatus: row.stealth_status || "none",
  };
}

export function createSpatialStore(db, { nextSeq, now = () => new Date().toISOString(), uuid = randomUUID }) {
  db.exec(SPATIAL_SCHEMA);
  const addCol = (tbl, col, ddl) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all();
      if (cols.length && !cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${ddl}`);
    } catch {}
  };
  addCol("spatial_messages", "stealth", "INTEGER NOT NULL DEFAULT 0");
  addCol("spatial_messages", "stealth_status", "TEXT NOT NULL DEFAULT 'none'");
  addCol("spatial_rooms", "floor_json", "TEXT DEFAULT NULL");
  addCol("encounters", "room_id", "TEXT");

  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const enabled = campaignId => Boolean(one("SELECT 1 FROM spatial_campaigns WHERE campaign_id=?", campaignId));
  function authorize(actor) {
    if (!actor?.campaignId || !actor?.userId || !actor.memberIds.includes(actor.userId)) throw new SpatialError("Campaign not found.", 404);
  }
  function active(actor) {
    authorize(actor);
    if (!enabled(actor.campaignId)) throw new SpatialError("Location chat is not enabled.", 409);
  }
  function dm(actor) {
    active(actor);
    if (!actor.isDm) throw new SpatialError("Only the Dungeon Master can do that.", 403);
  }
  function room(actor, roomId) {
    const found = one("SELECT id,name FROM spatial_rooms WHERE campaign_id=? AND id=?", actor.campaignId, roomId);
    if (!found) throw new SpatialError("Location not found.", 404);
    return found;
  }
  function position(actor, userId = actor.userId) {
    const row = one("SELECT room_id,revision FROM spatial_presence WHERE campaign_id=? AND user_id=?", actor.campaignId, userId);
    return row ? { roomId: row.room_id, revision: row.revision } : null;
  }
  function visit(actor, userId, roomId, seq) {
    run("INSERT INTO spatial_visits(campaign_id,user_id,room_id,first_seq) VALUES(?,?,?,?) ON CONFLICT DO NOTHING", actor.campaignId, userId, roomId, seq);
  }
  function known(actor, roomId) {
    if (actor.isDm) return Boolean(one("SELECT 1 FROM spatial_rooms WHERE campaign_id=? AND id=?", actor.campaignId, roomId));
    return Boolean(one("SELECT 1 FROM spatial_visits WHERE campaign_id=? AND user_id=? AND room_id=?", actor.campaignId, actor.userId, roomId));
  }
  function occupants(actor, roomId) {
    return all("SELECT user_id FROM spatial_presence WHERE campaign_id=? AND room_id=?", actor.campaignId, roomId)
      .map(row => row.user_id).filter(id => actor.playerIds.includes(id));
  }
  function observers(actor, roomId, kind) {
    return all(`SELECT o.user_id FROM spatial_observers o JOIN spatial_presence p
      ON p.campaign_id=o.campaign_id AND p.user_id=o.user_id AND p.room_id=o.anchor_id AND p.revision=o.anchor_revision
      WHERE o.campaign_id=? AND o.source_id=? AND o.expires_at>? AND (o.mode='scry' OR ?='say')`, actor.campaignId, roomId, now(), kind)
      .map(row => row.user_id).filter(id => actor.playerIds.includes(id));
  }
  function append(actor, roomId, kind, content, recipients, meta = {}) {
    const id = uuid(), seq = nextSeq(actor.campaignId), createdAt = now();
    const stealth = meta.stealth ? 1 : 0;
    const stealthStatus = meta.stealthStatus || (stealth ? "pending" : "none");
    run("INSERT INTO spatial_messages(id,campaign_id,room_id,seq,kind,author_user_id,content,created_at,stealth,stealth_status) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, actor.campaignId, roomId, seq, kind, actor.userId, content, createdAt, stealth, stealthStatus);
    for (const userId of new Set(recipients)) {
      if (!actor.memberIds.includes(userId)) continue;
      run("INSERT INTO spatial_receipts(campaign_id,message_id,user_id) VALUES(?,?,?)", actor.campaignId, id, userId);
      if (roomId) visit(actor, userId, roomId, seq);
    }
    return { id, roomId, seq, kind, authorUserId: actor.userId, content, createdAt, stealth: Boolean(stealth), stealthStatus };
  }
  function objectKey(input) {
    return {
      objectType: text(input.objectType, 80, "object type"),
      objectId: text(input.objectId, 200, "object ID"),
    };
  }
  function latestObject(actor, objectType, objectId) {
    return one(`SELECT * FROM spatial_object_versions
      WHERE campaign_id=? AND object_type=? AND object_id=? ORDER BY version DESC LIMIT 1`, actor.campaignId, objectType, objectId);
  }
  function projectObject(actor, objectType, objectId) {
    const row = actor.isDm
      ? latestObject(actor, objectType, objectId)
      : one(`SELECT v.* FROM spatial_object_receipts r
        JOIN spatial_object_versions v ON v.campaign_id=r.campaign_id AND v.object_type=r.object_type
          AND v.object_id=r.object_id AND v.version=r.version
        WHERE r.campaign_id=? AND r.user_id=? AND r.object_type=? AND r.object_id=?`, actor.campaignId, actor.userId, objectType, objectId);
    if (!row) throw new SpatialError("Object not found.", 404);
    return { objectType: row.object_type, objectId: row.object_id, roomId: row.room_id, version: row.version, seq: row.seq, payload: JSON.parse(row.payload_json) };
  }
  function publishObject(actor, input) {
    dm(actor);
    const { objectType, objectId } = objectKey(input);
    const payload = input.payload;
    if (payload === undefined) throw new SpatialError("Invalid object payload.");
    const roomId = input.roomId == null ? null : room(actor, input.roomId).id;
    const previous = latestObject(actor, objectType, objectId);
    const version = (previous?.version ?? 0) + 1;
    const seq = nextSeq(actor.campaignId);
    run(`INSERT INTO spatial_object_versions(campaign_id,object_type,object_id,version,room_id,payload_json,seq)
      VALUES(?,?,?,?,?,?,?)`, actor.campaignId, objectType, objectId, version, roomId, JSON.stringify(payload), seq);
    const recipients = Array.isArray(input.userIds) ? input.userIds : roomId ? occupants(actor, roomId) : [];
    for (const userId of new Set(recipients)) {
      if (!actor.playerIds.includes(userId)) throw new SpatialError("Player not found.", 404);
      run(`INSERT INTO spatial_object_receipts(campaign_id,user_id,object_type,object_id,version,observed_seq)
        VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,user_id,object_type,object_id)
        DO UPDATE SET version=excluded.version,observed_seq=excluded.observed_seq`, actor.campaignId, userId, objectType, objectId, version, seq);
    }
    return { objectType, objectId, version, seq };
  }
  function observeObject(actor, input) {
    dm(actor);
    const { objectType, objectId } = objectKey(input);
    const row = latestObject(actor, objectType, objectId);
    if (!row) throw new SpatialError("Object not found.", 404);
    const users = input.userIds;
    if (!Array.isArray(users) || !users.length || users.some(userId => !actor.playerIds.includes(userId))) throw new SpatialError("Invalid observation recipients.");
    for (const userId of new Set(users)) run(`INSERT INTO spatial_object_receipts(campaign_id,user_id,object_type,object_id,version,observed_seq)
      VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,user_id,object_type,object_id)
      DO UPDATE SET version=excluded.version,observed_seq=excluded.observed_seq`, actor.campaignId, userId, objectType, objectId, row.version, nextSeq(actor.campaignId));
    return { objectType, objectId, version: row.version };
  }
  function link(actor, sourceId, targetId, input) {
    room(actor, sourceId); room(actor, targetId);
    if (sourceId === targetId) throw new SpatialError("A location cannot connect to itself.");
    for (const [source, target] of [[sourceId, targetId], [targetId, sourceId]]) {
      if (!input.sound) run("DELETE FROM spatial_observers WHERE campaign_id=? AND source_id=? AND anchor_id=? AND mode='speech'", actor.campaignId, source, target);
      run(`INSERT INTO spatial_links(campaign_id,source_id,target_id,walkable,sound,sight) VALUES(?,?,?,?,?,?)
        ON CONFLICT(campaign_id,source_id,target_id) DO UPDATE SET walkable=excluded.walkable,sound=excluded.sound,sight=excluded.sight`,
      actor.campaignId, source, target, Number(input.walkable ?? true), Number(input.sound ?? false), Number(input.sight ?? false));
    }
  }
  function moveOne(actor, userId, roomId, seq) {
    if (!actor.playerIds.includes(userId)) throw new SpatialError("Player not found.", 404);
    const before = position(actor, userId);
    if (before?.roomId === roomId) return before;
    const revision = (before?.revision ?? 0) + 1;
    run(`INSERT INTO spatial_presence(campaign_id,user_id,room_id,revision) VALUES(?,?,?,?)
      ON CONFLICT(campaign_id,user_id) DO UPDATE SET room_id=excluded.room_id,revision=excluded.revision`, actor.campaignId, userId, roomId, revision);
    // Even returning to the same window cannot revive a revoked observation.
    run("DELETE FROM spatial_observers WHERE campaign_id=? AND user_id=?", actor.campaignId, userId);
    visit(actor, userId, roomId, seq);
    return { roomId, revision };
  }

  function mutate(actor, operation, input) {
    authorize(actor);
    if (operation === "enable") {
      if (!actor.isDm) throw new SpatialError("Only the Dungeon Master can enable location chat.", 403);
      if (enabled(actor.campaignId)) throw new SpatialError("Location chat is already enabled.", 409);
      const name = text(input.name, 80, "location name"), roomId = uuid(), seq = nextSeq(actor.campaignId);
      run("INSERT INTO spatial_campaigns(campaign_id,start_seq) VALUES(?,?)", actor.campaignId, seq);
      run("INSERT INTO spatial_rooms(id,campaign_id,name) VALUES(?,?,?)", roomId, actor.campaignId, name);
      for (const userId of actor.playerIds) moveOne(actor, userId, roomId, seq);
      return { roomId };
    }
    active(actor);
    if (operation === "send") {
      const kind = input.kind;
      if (!["say", "do", "narration", "ooc"].includes(kind)) throw new SpatialError("Invalid message kind.");
      const content = text(input.content, kind === "narration" ? 8000 : 2000, "message");
      if (kind === "ooc") return { message: append(actor, null, kind, content, []) };
      if (kind === "narration") dm(actor);
      else if (actor.isDm) throw new SpatialError("The DM must use narration or OOC.", 403);
      room(actor, input.roomId);
      if (!actor.isDm) {
        const current = position(actor);
        if (!current || current.roomId !== input.roomId || current.revision !== input.expectedRevision) {
          throw new SpatialError("Your location changed. Refresh before sending.", 409);
        }
      }
      const isStealth = Boolean(input.stealth);
      if (isStealth) {
        if (actor.isDm || kind === "ooc" || kind === "narration") throw new SpatialError("Stealth is only available for player actions and speech.");
        const msg = append(actor, input.roomId, kind, content, [actor.userId], { stealth: 1, stealthStatus: "pending" });
        const charId = typeof input.characterId === "string" ? input.characterId : actor.userId;
        run(`INSERT INTO spatial_stealth_states(campaign_id,character_id,user_id,room_id,status,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,character_id) DO UPDATE SET
          status='pending',room_id=excluded.room_id,updated_at=excluded.updated_at`,
          actor.campaignId, charId, actor.userId, input.roomId, "pending", now());
        return { message: msg };
      }
      run("UPDATE spatial_stealth_states SET status='revealed',updated_at=? WHERE campaign_id=? AND user_id=? AND room_id=?",
        now(), actor.campaignId, actor.userId, input.roomId);
      return { message: append(actor, input.roomId, kind, content, [actor.userId, ...occupants(actor, input.roomId), ...observers(actor, input.roomId, kind)]) };
    }
    if (operation === "move") {
      room(actor, input.roomId);
      const targets = actor.isDm ? input.userIds : [actor.userId];
      if (!Array.isArray(targets) || !targets.length || targets.length > 20) throw new SpatialError("Choose players to move.");
      if (!actor.isDm) {
        const current = position(actor);
        if (!current || current.revision !== input.expectedRevision) throw new SpatialError("Your location changed. Refresh before moving.", 409);
        if (!one("SELECT 1 FROM spatial_links WHERE campaign_id=? AND source_id=? AND target_id=? AND walkable=1", actor.campaignId, current.roomId, input.roomId)) {
          throw new SpatialError("There is no open passage to that location.", 403);
        }
      }
      const seq = nextSeq(actor.campaignId);
      return { moved: [...new Set(targets)].map(userId => ({ userId, ...moveOne(actor, userId, input.roomId, seq) })) };
    }
    if (operation === "object_read") {
      const { objectType, objectId } = objectKey(input);
      return projectObject(actor, objectType, objectId);
    }
    dm(actor);
    if (operation === "create_room") {
      if (one("SELECT COUNT(*) AS n FROM spatial_rooms WHERE campaign_id=?", actor.campaignId).n >= 128) throw new SpatialError("This campaign has reached its 128-location limit.", 409);
      const name = text(input.name, 80, "location name"), roomId = uuid();
      run("INSERT INTO spatial_rooms(id,campaign_id,name) VALUES(?,?,?)", roomId, actor.campaignId, name);
      if (input.connectTo) link(actor, input.connectTo, roomId, input);
      nextSeq(actor.campaignId);
      return { roomId };
    }
    if (operation === "link") {
      link(actor, input.sourceId, input.targetId, input);
      nextSeq(actor.campaignId);
      return { linked: true };
    }
    if (operation === "observe") {
      if (one("SELECT COUNT(*) AS n FROM spatial_observers WHERE campaign_id=? AND expires_at>?", actor.campaignId, now()).n >= 256) throw new SpatialError("Too many active observation grants.", 409);
      room(actor, input.roomId);
      if (!actor.playerIds.includes(input.userId)) throw new SpatialError("Player not found.", 404);
      const current = position(actor, input.userId);
      if (!current) throw new SpatialError("Place the player before granting perception.", 409);
      if (!["speech", "scry"].includes(input.mode)) throw new SpatialError("Invalid observation mode.");
      const seconds = integer(input.seconds, 1, 3600, "observation duration");
      const reason = text(input.reason, 500, "adjudication reason");
      // Physical eavesdropping needs a sound-permeable boundary. Divination
      // can cross it, but only an explicit DM adjudication grants that mode.
      if (input.mode === "speech" && !one("SELECT 1 FROM spatial_links WHERE campaign_id=? AND source_id=? AND target_id=? AND sound=1", actor.campaignId, input.roomId, current.roomId)) {
        throw new SpatialError("No sound path connects the listener to that location.", 409);
      }
      const grantId = uuid(), expiresAt = new Date(Date.parse(now()) + seconds * 1000).toISOString();
      run("INSERT INTO spatial_observers(id,campaign_id,user_id,source_id,anchor_id,anchor_revision,mode,expires_at,reason) VALUES(?,?,?,?,?,?,?,?,?)",
        grantId, actor.campaignId, input.userId, input.roomId, current.roomId, current.revision, input.mode, expiresAt, reason);
      visit(actor, input.userId, input.roomId, nextSeq(actor.campaignId));
      return { grantId, expiresAt };
    }
    if (operation === "revoke") {
      const result = run("DELETE FROM spatial_observers WHERE campaign_id=? AND id=?", actor.campaignId, input.grantId);
      if (!result.changes) throw new SpatialError("Observation not found.", 404);
      nextSeq(actor.campaignId);
      return { revoked: true };
    }
    if (operation === "propagate") {
      room(actor, input.roomId);
      if (!["sound", "sight"].includes(input.medium)) throw new SpatialError("Invalid perception medium.");
      const content = text(input.content, 2000, "perceived event");
      const destinations = all(`SELECT target_id FROM spatial_links WHERE campaign_id=? AND source_id=? AND ${input.medium}=1`, actor.campaignId, input.roomId);
      // A new, separately written perception is delivered one hop. No source
      // transcript, automatic full-history grant, or recursive rebroadcast.
      const messages = destinations.map(({ target_id: target }) => append(actor, target, "perception", content, occupants(actor, target)));
      if (!messages.length) nextSeq(actor.campaignId);
      return { messages };
    }
    if (operation === "perceive") {
      room(actor, input.roomId);
      const recipients = input.userIds;
      if (!Array.isArray(recipients) || !recipients.length || recipients.length > 20 || recipients.some(id => !actor.playerIds.includes(id))) {
        throw new SpatialError("Invalid perception recipients.");
      }
      return { message: append(actor, input.roomId, "perception", text(input.content, 2000, "perceived fragment"), recipients) };
    }
    if (operation === "stealth_resolve") {
      dm(actor);
      const messageId = text(input.messageId, 100, "message ID");
      const outcome = input.outcome;
      if (!["confirmed", "revealed", "failed"].includes(outcome)) throw new SpatialError("Invalid stealth outcome.");
      const msg = one("SELECT * FROM spatial_messages WHERE campaign_id=? AND id=?", actor.campaignId, messageId);
      if (!msg) throw new SpatialError("Message not found.", 404);
      run("UPDATE spatial_messages SET stealth_status=? WHERE campaign_id=? AND id=?", outcome, actor.campaignId, messageId);
      const targetUserId = msg.author_user_id;
      const charId = typeof input.characterId === "string" ? input.characterId : (targetUserId || messageId);
      if (targetUserId && msg.room_id) {
        run(`INSERT INTO spatial_stealth_states(campaign_id,character_id,user_id,room_id,status,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,character_id) DO UPDATE SET
          status=excluded.status,room_id=excluded.room_id,updated_at=excluded.updated_at`,
          actor.campaignId, charId, targetUserId, msg.room_id, outcome, now());
      }
      const perceivedText = input.perceivedText ? text(input.perceivedText, 2000, "perceived fragment") : null;
      const sense = ["sight", "sound", "both", "special"].includes(input.sense) ? input.sense : "sight";
      const detectedUsers = Array.isArray(input.detectedByUserIds) ? input.detectedByUserIds.filter(id => actor.playerIds.includes(id)) : [];

      if (outcome === "confirmed") {
        for (const obsUserId of detectedUsers) {
          run(`INSERT INTO spatial_detections(campaign_id,observer_id,target_id,room_id,sense,state,created_at)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,observer_id,target_id) DO UPDATE SET
            sense=excluded.sense,state='detected',room_id=excluded.room_id,created_at=excluded.created_at`,
            actor.campaignId, obsUserId, charId, msg.room_id, sense, "detected", now());
          if (targetUserId) {
            run(`INSERT INTO spatial_detections(campaign_id,observer_id,target_id,room_id,sense,state,created_at)
              VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,observer_id,target_id) DO UPDATE SET
              sense=excluded.sense,state='detected',room_id=excluded.room_id,created_at=excluded.created_at`,
              actor.campaignId, obsUserId, targetUserId, msg.room_id, sense, "detected", now());
          }
        }
        let perceptionMessage = null;
        if (perceivedText && detectedUsers.length) {
          perceptionMessage = append(actor, msg.room_id, "perception", perceivedText, detectedUsers, { stealth: 1, stealthStatus: "confirmed" });
        }
        return { messageId, outcome, detectedByUserIds: detectedUsers, perceptionMessage };
      }
      if (outcome === "revealed") {
        const allInRoom = occupants(actor, msg.room_id);
        for (const obsUserId of allInRoom) {
          if (obsUserId !== targetUserId) {
            run(`INSERT INTO spatial_detections(campaign_id,observer_id,target_id,room_id,sense,state,created_at)
              VALUES(?,?,?,?,?,?,?) ON CONFLICT(campaign_id,observer_id,target_id) DO UPDATE SET
              sense=excluded.sense,state='detected',room_id=excluded.room_id,created_at=excluded.created_at`,
              actor.campaignId, obsUserId, charId, msg.room_id, sense, "detected", now());
          }
        }
        let perceptionMessage = null;
        if (perceivedText && allInRoom.length) {
          perceptionMessage = append(actor, msg.room_id, "perception", perceivedText, allInRoom, { stealth: 0, stealthStatus: "revealed" });
        }
        return { messageId, outcome, perceptionMessage };
      }
      return { messageId, outcome };
    }
    if (operation === "detect") {
      dm(actor);
      const observerId = text(input.observerId, 100, "observer ID");
      const targetId = text(input.targetId, 100, "target ID");
      const roomId = input.roomId ? room(actor, input.roomId).id : null;
      const sense = ["sight", "sound", "both", "special"].includes(input.sense) ? input.sense : "sight";
      const state = ["detected", "unaware", "suspected"].includes(input.state) ? input.state : "detected";
      const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
      run(`INSERT INTO spatial_detections(campaign_id,observer_id,target_id,room_id,sense,state,expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,observer_id,target_id) DO UPDATE SET
        room_id=excluded.room_id,sense=excluded.sense,state=excluded.state,expires_at=excluded.expires_at,created_at=excluded.created_at`,
        actor.campaignId, observerId, targetId, roomId, sense, state, expiresAt, now());
      return { observerId, targetId, sense, state };
    }
    if (operation === "lose_detection") {
      dm(actor);
      const observerId = text(input.observerId, 100, "observer ID");
      const targetId = text(input.targetId, 100, "target ID");
      run("DELETE FROM spatial_detections WHERE campaign_id=? AND observer_id=? AND target_id=?", actor.campaignId, observerId, targetId);
      return { lost: true };
    }
    if (operation === "set_floor") {
      dm(actor);
      const roomId = room(actor, input.roomId).id;
      const floorJson = input.floor ? JSON.stringify(input.floor) : null;
      run("UPDATE spatial_rooms SET floor_json=? WHERE campaign_id=? AND id=?", floorJson, actor.campaignId, roomId);
      return { roomId, floor: input.floor ?? null };
    }
    throw new SpatialError("Unknown location operation.");
  }

  return {
    enabled,
    command(actor, requestId, operation, input, normalizeInput = value => value) {
      authorize(actor);
      text(requestId, 100, "request ID");
      const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ operation, input }))).digest("hex");
      return db.transaction(() => {
        const previous = one("SELECT fingerprint,result_json FROM spatial_requests WHERE campaign_id=? AND actor_id=? AND request_id=?", actor.campaignId, actor.userId, requestId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new SpatialError("Request ID was already used with different arguments.", 409);
          return JSON.parse(previous.result_json);
        }
        const result = mutate(actor, operation, normalizeInput(input));
        run("INSERT INTO spatial_requests(campaign_id,actor_id,request_id,fingerprint,result_json) VALUES(?,?,?,?,?)", actor.campaignId, actor.userId, requestId, fingerprint, JSON.stringify(result));
        return result;
      })();
    },
    view(actor) {
      authorize(actor);
      if (!enabled(actor.campaignId)) return { enabled: false };
      const current = position(actor);
      const rooms = (actor.isDm
        ? all("SELECT id,name FROM spatial_rooms WHERE campaign_id=? ORDER BY rowid", actor.campaignId)
        : all(`SELECT r.id,r.name FROM spatial_rooms r JOIN spatial_visits v ON v.campaign_id=r.campaign_id AND v.room_id=r.id
            WHERE r.campaign_id=? AND v.user_id=? ORDER BY v.first_seq,r.id`, actor.campaignId, actor.userId))
        .map(item => ({ ...item, active: current?.roomId === item.id,
          // Never expose a remote room's live roster or activity count.
          occupants: actor.isDm || current?.roomId === item.id ? occupants(actor, item.id) : [] }));
      const exits = current ? all(`SELECT r.id,r.name FROM spatial_links l JOIN spatial_rooms r ON r.campaign_id=l.campaign_id AND r.id=l.target_id
        WHERE l.campaign_id=? AND l.source_id=? AND l.walkable=1 ORDER BY r.name`, actor.campaignId, current.roomId) : [];
      const grants = all(`SELECT o.id,o.user_id AS userId,o.source_id AS roomId,o.mode,o.expires_at AS expiresAt
        FROM spatial_observers o JOIN spatial_presence p ON p.campaign_id=o.campaign_id AND p.user_id=o.user_id
        AND p.room_id=o.anchor_id AND p.revision=o.anchor_revision WHERE o.campaign_id=? AND o.expires_at>? ${actor.isDm ? "" : "AND o.user_id=?"}`,
      actor.campaignId, now(), ...(actor.isDm ? [] : [actor.userId]));
      const { start_seq: startSeq } = one("SELECT start_seq FROM spatial_campaigns WHERE campaign_id=?", actor.campaignId);
      const roomRow = current?.roomId ? one("SELECT floor_json FROM spatial_rooms WHERE campaign_id=? AND id=?", actor.campaignId, current.roomId) : null;
      const floor = roomRow?.floor_json ? JSON.parse(roomRow.floor_json) : null;
      const stealthRow = current?.roomId ? one("SELECT status, updated_at FROM spatial_stealth_states WHERE campaign_id=? AND user_id=? AND room_id=?",
        actor.campaignId, actor.userId, current.roomId) : null;
      const stealth = stealthRow ? { status: stealthRow.status, updatedAt: stealthRow.updated_at } : null;
      return { enabled: true, startSeq, current, rooms, exits, grants, isDm: actor.isDm, floor, stealth };
    },
    messages(actor, { roomId = null, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
      active(actor);
      integer(beforeSeq, 1, Number.MAX_SAFE_INTEGER, "history cursor");
      integer(limit, 1, 100, "page size");
      if (roomId !== null && !known(actor, roomId)) throw new SpatialError("Location not found.", 404);
      const rows = all(`SELECT m.* FROM spatial_messages m WHERE m.campaign_id=? AND m.room_id IS ? AND m.seq<?
        ${actor.isDm || roomId === null ? "" : "AND EXISTS(SELECT 1 FROM spatial_receipts r WHERE r.campaign_id=m.campaign_id AND r.message_id=m.id AND r.user_id=?)"}
        ORDER BY m.seq DESC LIMIT ?`, actor.campaignId, roomId, beforeSeq, ...(actor.isDm || roomId === null ? [] : [actor.userId]), limit + 1);
      const hasMore = rows.length > limit, page = rows.slice(0, limit).reverse().map(mapMessage);
      return { messages: page, nextBefore: hasMore ? page[0].seq : null };
    },
    object(actor, objectType, objectId) {
      active(actor);
      return projectObject(actor, text(objectType, 80, "object type"), text(objectId, 200, "object ID"));
    },
    canReadMessage(actor, messageId) {
      active(actor);
      text(messageId, 200, "message ID");
      return Boolean(actor.isDm || one(`SELECT 1 FROM spatial_receipts
        WHERE campaign_id=? AND message_id=? AND user_id=?`, actor.campaignId, messageId, actor.userId));
    },
    canReadSeq(actor, seq) {
      active(actor);
      integer(seq, 0, Number.MAX_SAFE_INTEGER, "message sequence");
      const message = one("SELECT id,room_id FROM spatial_messages WHERE campaign_id=? AND seq=?", actor.campaignId, seq);
      if (!message) return null;
      if (actor.isDm || message.room_id === null) return true;
      return Boolean(one(`SELECT 1 FROM spatial_receipts
        WHERE campaign_id=? AND message_id=? AND user_id=?`, actor.campaignId, message.id, actor.userId));
    },
    publishObject(actor, input) {
      authorize(actor);
      return db.transaction(() => publishObject(actor, input))();
    },
    observeObject(actor, input) {
      authorize(actor);
      return db.transaction(() => observeObject(actor, input))();
    },
    isDetected(campaignId, observerId, targetId) {
      if (!campaignId || !observerId || !targetId) return false;
      const row = one("SELECT state, expires_at FROM spatial_detections WHERE campaign_id=? AND observer_id=? AND target_id=?",
        campaignId, observerId, targetId);
      if (!row || row.state !== 'detected') return false;
      if (row.expires_at && row.expires_at <= now()) return false;
      return true;
    },
    getStealthState(campaignId, characterId) {
      if (!campaignId || !characterId) return null;
      const row = one("SELECT * FROM spatial_stealth_states WHERE campaign_id=? AND character_id=?",
        campaignId, characterId);
      return row ? { status: row.status, roomId: row.room_id, updatedAt: row.updated_at } : null;
    },
    getRoomFloor(campaignId, roomId) {
      if (!campaignId || !roomId) return null;
      const row = one("SELECT floor_json FROM spatial_rooms WHERE campaign_id=? AND id=?", campaignId, roomId);
      return row?.floor_json ? JSON.parse(row.floor_json) : null;
    },
    setRoomFloor(campaignId, roomId, floor) {
      if (!campaignId || !roomId) return;
      const json = floor ? JSON.stringify(floor) : null;
      run("UPDATE spatial_rooms SET floor_json=? WHERE campaign_id=? AND id=?", json, campaignId, roomId);
    },
    getUserRoom(campaignId, userId) {
      if (!campaignId || !userId) return null;
      const row = one("SELECT room_id FROM spatial_presence WHERE campaign_id=? AND user_id=?", campaignId, userId);
      return row ? row.room_id : null;
    },
    narratorRead(actor, { afterSeq = 0, limit = 100 } = {}) {
      dm(actor);
      integer(afterSeq, 0, Number.MAX_SAFE_INTEGER, "narrator cursor");
      integer(limit, 1, 100, "page size");
      const rows = all("SELECT * FROM spatial_messages WHERE campaign_id=? AND kind<>'ooc' AND seq>? ORDER BY seq LIMIT ?", actor.campaignId, afterSeq, limit + 1);
      const messages = rows.slice(0, limit).map(row => ({ ...mapMessage(row),
        witnessUserIds: all("SELECT user_id FROM spatial_receipts WHERE campaign_id=? AND message_id=?", actor.campaignId, row.id).map(receipt => receipt.user_id) }));
      return { ...this.view(actor), messages, nextCursor: messages.at(-1)?.seq ?? afterSeq, hasMore: rows.length > limit };
    },
  };
}
