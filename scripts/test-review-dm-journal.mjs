import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadReviewModule, sqliteAdapter } from "./lib/review-module.mjs";
const commitEffects = loadReviewModule(fileURLToPath(new URL("../src/lib/db/commit-effects.ts", import.meta.url)));
const { withCommittedEffects, afterCommit } = commitEffects;
const defaults = () => ({ spotlightSet: false, beatCompleted: false, whisperCount: 0, noteCount: 0, encounterNudged: false });

for (const phase of ["before-effect", "after-effect", "before-result", "after-result", "after-commit", "during-finalization", "after-finalization"]) {
  test(`R08: durable recovery after process exit ${phase}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-journal-"));
    const filename = path.join(dir, "game.sqlite");
    let db = new DatabaseSync(filename);
    try {
      db.exec(`CREATE TABLE dm_turns (id TEXT PRIMARY KEY, campaign_id TEXT, status TEXT, payload TEXT);
        CREATE TABLE hero (gold INTEGER, initiative INTEGER); INSERT INTO hero VALUES (0,0);
        CREATE TABLE narration (turn_id TEXT PRIMARY KEY, content TEXT);`);
      const initial = { id: "t", campaignId: "c", status: "running", callIndex: 0, conversation: [], narrationParts: [], rollIds: [] };
      db.prepare("INSERT INTO dm_turns VALUES ('t','c','running',?)").run(JSON.stringify(initial));
      db.close(); db = null;
      const exited = spawnSync(process.execPath, [fileURLToPath(new URL("./lib/review-dm-crash-worker.mjs", import.meta.url)), filename, phase], {
        encoding: "utf8", timeout: 15000,
      });
      assert.equal(exited.status, 86, exited.stderr || exited.error?.message);
      db = new DatabaseSync(filename);
      const adapter = sqliteAdapter(db);
      const turns = {
        getDmTurn: (id) => JSON.parse(db.prepare("SELECT payload FROM dm_turns WHERE id=?").get(id).payload),
        saveDmTurn: (turn) => db.prepare("UPDATE dm_turns SET status=?, payload=? WHERE id=?")
          .run(turn.status, JSON.stringify(turn), turn.id),
      };
      const journal = loadReviewModule(fileURLToPath(new URL("../src/lib/db/dm-execution.ts", import.meta.url)), {
        "@/lib/db/core": { getDatabase: () => adapter },
        "@/lib/db/dm-turns": turns, "@/lib/db/commit-effects": commitEffects,
      });
      let turn = turns.getDmTurn("t");
      const pending = journal.pendingDmBatch("t");
      const row = db.prepare("SELECT * FROM dm_execution_batches WHERE turn_id='t'").get();
      const batch = pending ?? { turnId: "t", index: row.batch_index, start: JSON.parse(row.start_json), message: JSON.parse(row.reply_json) };
      const call = batch.message.tool_calls[0];
      if (pending) journal.restoreDmBatch(turn, pending);
      // The same key is deliberately replayed twice. A completed batch
      // returns its saved checkpoint/result without running the closure.
      let executed = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        journal.commitDmBatch(turn, batch, [call], () => {
          executed++;
          db.exec("UPDATE hero SET gold=gold+10");
          turn.conversation.push({ role: "tool", tool_call_id: call.id, content: '{"goldAdded":10}' });
          turn.callIndex++;
          return "continue";
        }, defaults);
      }
      assert.equal(executed, pending ? 1 : 0);
      assert.equal(db.prepare("SELECT gold FROM hero").get().gold, 10);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_tool_results").get().n, 1);
      // Use the database row after batch replay: a later finalization may
      // already be committed, and must never be undone by a cached batch.
      turn = turns.getDmTurn("t");
      for (let attempt = 0; attempt < 2; attempt++) journal.commitDmFinalization(turn, () => {
        db.exec("INSERT INTO narration VALUES ('t','checked'); UPDATE hero SET initiative=initiative+1");
        turn.status = "done"; turns.saveDmTurn(turn);
      });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM narration").get().n, 1);
      assert.equal(db.prepare("SELECT initiative FROM hero").get().initiative, 1);
      assert.equal(turns.getDmTurn("t").status, "done");
    } finally {
      db?.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("R08/R19: notification scopes flush only after commit and discard all rollback effects", () => {
  const emitted = [];
  assert.throws(() => withCommittedEffects(() => {
    afterCommit(() => emitted.push("outer"));
    withCommittedEffects(() => afterCommit(() => emitted.push("inner")));
    assert.deepEqual(emitted, []);
    throw new Error("rollback");
  }), /rollback/);
  assert.deepEqual(emitted, []);
  withCommittedEffects(() => {
    afterCommit(() => emitted.push("outer"));
    withCommittedEffects(() => afterCommit(() => emitted.push("inner")));
    assert.deepEqual(emitted, []);
  });
  assert.deepEqual(emitted, ["outer", "inner"]);
});
