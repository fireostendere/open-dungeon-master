// Executes the actual finish service and event bus with SQLite. Member sync
// is an explicit test double that writes rows under the same connection.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const root = path.resolve(import.meta.dirname, "..");
const load = (file, mocks) => loadReviewModule(path.join(root, file), mocks);
const effects = load("src/lib/db/commit-effects.ts");

function fixture({ blocked = "", breakStatus = false, breakEvent = false } = {}) {
  const raw = new DatabaseSync(":memory:");
  const db = sqliteAdapter(raw);
  db.exec(`CREATE TABLE campaigns (id TEXT PRIMARY KEY, kind TEXT, status TEXT, next_seq INTEGER);
    INSERT INTO campaigns VALUES ('c', 'campaign', 'active', 1);
    CREATE TABLE progress (id TEXT PRIMARY KEY, xp INTEGER, revision INTEGER);
    INSERT INTO progress VALUES ('one', 1, 0), ('two', 2, 0);
    CREATE TABLE campaign_events (campaign_id TEXT, seq INTEGER, type TEXT, payload_json TEXT, created_at TEXT);`);
  const delivered = [];
  const campaigns = {
    getCampaignById: (id) => db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id),
    setCampaignStatus: (id, status) => { db.prepare("UPDATE campaigns SET status=? WHERE id=?").run(status, id); if (breakStatus) throw Error("status fault"); },
    allocateSeq: (id) => {
      const { next_seq } = db.prepare("SELECT next_seq FROM campaigns WHERE id=?").get(id);
      db.prepare("UPDATE campaigns SET next_seq=next_seq+1 WHERE id=?").run(id);
      return next_seq;
    },
  };
  const events = load("src/lib/events.ts", {
    "@/lib/db/core": { getDatabase: () => db, nowIso: () => new Date().toISOString(), parseJson: JSON.parse },
    "@/lib/db/campaigns": campaigns, "@/lib/db/commit-effects": effects,
    "@/lib/spatial/event-policy": {
      captureEventAudience() {}, eventSpatialState: () => ({ enabled: false }),
      campaignEventProjector: () => ({ projectEvent: event => event, projectLive: chunk => chunk }),
    },
    "@/lib/spatial/event-privacy": {
      captureEventAudience: () => null, projectEventForUser: (_campaignId, _userId, event) => event,
      ensureEventAudienceColumn: () => {
        if (!db.prepare("PRAGMA table_info(campaign_events)").all().some(column => column.name === "audience_json"))
          db.exec("ALTER TABLE campaign_events ADD COLUMN audience_json TEXT");
      },
    },
  });
  const unsubscribe = events.subscribe("c", (chunk) => delivered.push(chunk));
  const service = load("src/lib/progress/service.ts", {
    "@/lib/db/core": { getDatabase: () => db }, "@/lib/db/campaigns": campaigns,
    "@/lib/db/sheets": {}, "@/lib/db/users": {}, "@/lib/db/commit-effects": effects,
    "@/lib/events": { publishPersisted: (...args) => {
      const result = events.publishPersisted(...args);
      if (breakEvent && args[1] === "campaign.finished_progress_sync") throw Error("event fault");
      return result;
    } },
    "@/lib/db/progress-sync": { syncPartyProgress: () => {
      const synced = [], skipped = [], failed = [];
      for (const id of ["one", "two"]) {
        if (id === "two" && blocked) {
          if (blocked === "unlinked") skipped.push({ sheetId: id, name: id, reason: "unlinked" });
          else failed.push({ sheetId: id, name: id, error: "revision conflict" });
          continue;
        }
        db.transaction(() => {
          db.prepare("UPDATE progress SET xp=xp+10, revision=revision+1 WHERE id=?").run(id);
          events.publishPersisted("c", "member_synced", { sheetId: id });
          synced.push({ sheetId: id, libraryCharacterId: id, xp: 11, level: 1, revision: 1 });
        })();
      }
      return { campaignId: "c", synced, skipped, failed, totals: { candidates: 2, synced: synced.length, skipped: skipped.length, failed: failed.length } };
    } },
  });
  return { db, raw, events, effects, service, delivered, close: () => { unsubscribe(); raw.close(); } };
}

for (const blocked of ["conflict", "unlinked"]) test(`R07: ${blocked} rolls back every earlier member, revision, and event`, () => {
  const f = fixture({ blocked });
  try {
    const result = f.service.finishAndSyncParty({ campaignId: "c", confirm: true });
    assert.equal(result.ended, false);
    assert.equal(result.sync.totals.synced, 0);
    assert.deepEqual(result.sync.synced, []);
    assert.deepEqual(result.sync.rolledBack, ["one"]);
    assert.deepEqual(f.db.prepare("SELECT xp,revision FROM progress ORDER BY id").all().map((x) => ({...x})), [{ xp: 1, revision: 0 }, { xp: 2, revision: 0 }]);
    assert.equal(f.db.prepare("SELECT status FROM campaigns").get().status, "active");
    assert.equal(f.delivered.length, 1);
    assert.match(f.delivered[0], /campaign.finish_sync_blocked/);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events").get().n, 1);
  } finally { f.close(); }
});

test("R07: explicit partial policy commits only successes and ends the campaign", () => {
  const f = fixture({ blocked: "conflict" });
  try {
    const result = f.service.finishAndSyncParty({ campaignId: "c", confirm: true, requireAllSynced: false });
    assert.equal(result.ended, true);
    assert.equal(result.sync.totals.synced, 1);
    assert.equal(f.db.prepare("SELECT xp FROM progress WHERE id='one'").get().xp, 11);
    assert.equal(f.db.prepare("SELECT xp FROM progress WHERE id='two'").get().xp, 2);
    assert.equal(f.db.prepare("SELECT status FROM campaigns").get().status, "ended");
    assert.equal(f.delivered.length, 2);
  } finally { f.close(); }
});
for (const failure of ["breakStatus", "breakEvent"]) test(`R07: ${failure} leaves neither partial progression nor ghost SSE events`, () => {
  const f = fixture({ [failure]: true });
  try {
    assert.throws(() => f.service.finishAndSyncParty({ campaignId: "c", confirm: true }), /fault/);
    assert.equal(f.db.prepare("SELECT SUM(revision) AS n FROM progress").get().n, 0);
    assert.equal(f.db.prepare("SELECT status FROM campaigns").get().status, "active");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events").get().n, 0);
    assert.deepEqual(f.delivered, []);
  } finally { f.close(); }
});
test("R07: full success commits every member and only then notifies subscribers", () => {
  const f = fixture();
  try {
    const result = f.service.finishAndSyncParty({ campaignId: "c", confirm: true });
    assert.equal(result.sync.totals.synced, 2);
    assert.equal(f.db.prepare("SELECT SUM(revision) AS n FROM progress").get().n, 2);
    assert.equal(f.delivered.length, 3);
    assert.equal(f.db.prepare("SELECT status FROM campaigns").get().status, "ended");
  } finally { f.close(); }
});
test("R08: actual event bus discards rolled-back persistent and ephemeral notifications", () => {
  const f = fixture();
  try {
    assert.throws(() => f.effects.withCommittedEffects(() => f.db.transaction(() => {
      f.events.publishPersisted("c", "sheet_updated", { xp: 999 });
      f.events.publishEphemeral("c", "dm_delta", { text: "uncommitted" });
      assert.deepEqual(f.delivered, []);
      throw Error("rollback");
    })()), /rollback/);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM campaign_events").get().n, 0);
    assert.deepEqual(f.delivered, []);
    f.effects.withCommittedEffects(() => f.db.transaction(() => f.events.publishPersisted("c", "sheet_updated", { xp: 10 }))());
    assert.equal(f.delivered.length, 1);
    assert.equal(f.events.listEventsSince("c", 0)[0].payload.xp, 10);
  } finally { f.close(); }
});
