// The broader finish suite exercises rollback and the event bus. This focused
// test invokes the real finish service twice to verify receipt idempotency.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const root = path.resolve(import.meta.dirname, "..");
test("R07: repeat finish returns its receipt without repeating member writes", () => {
  const raw = new DatabaseSync(":memory:");
  const db = sqliteAdapter(raw);
  db.exec("CREATE TABLE campaigns(id TEXT PRIMARY KEY, kind TEXT, status TEXT); INSERT INTO campaigns VALUES ('c','campaign','active');");
  let writes = 0;
  const effects = loadReviewModule(path.join(root, "src/lib/db/commit-effects.ts"));
  const service = loadReviewModule(path.join(root, "src/lib/progress/service.ts"), {
    "@/lib/db/core": { getDatabase: () => db },
    "@/lib/db/sheets": {}, "@/lib/db/users": {}, "@/lib/events": { publishPersisted: () => {} },
    "@/lib/db/commit-effects": effects,
    "@/lib/db/campaigns": {
      getCampaignById: (id) => db.prepare("SELECT * FROM campaigns WHERE id=?").get(id),
      setCampaignStatus: (id, status) => db.prepare("UPDATE campaigns SET status=? WHERE id=?").run(status, id),
    },
    "@/lib/db/progress-sync": { syncPartyProgress: () => {
      writes++;
      return { campaignId: "c", synced: [], skipped: [], failed: [], totals: { candidates: 0, synced: 0, skipped: 0, failed: 0 } };
    } },
  });
  try {
    const request = { campaignId: "c", confirm: true };
    const first = service.finishAndSyncParty(request);
    const second = service.finishAndSyncParty(request);
    assert.deepEqual(second, first);
    assert.equal(writes, 1);
  } finally { raw.close(); }
});
