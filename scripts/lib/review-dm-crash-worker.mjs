// Used by test-review-dm-journal.mjs. Exits abruptly inside SQLite transactions
// to exercise recovery from a closed process, not a caught exception only.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { loadReviewModule, sqliteAdapter } from "./review-module.mjs";
const [filename, phase] = process.argv.slice(2);
const db = new DatabaseSync(filename);
const adapter = sqliteAdapter(db);
const core = { getDatabase: () => adapter };
const turns = {
  getDmTurn: (id) => {
    const row = db.prepare("SELECT payload FROM dm_turns WHERE id=?").get(id);
    return row ? JSON.parse(row.payload) : null;
  },
  saveDmTurn: (turn) => db.prepare("UPDATE dm_turns SET status=?, payload=? WHERE id=?")
    .run(turn.status, JSON.stringify(turn), turn.id),
};
const effects = loadReviewModule(fileURLToPath(new URL("../../src/lib/db/commit-effects.ts", import.meta.url)));
const journal = loadReviewModule(fileURLToPath(new URL("../../src/lib/db/dm-execution.ts", import.meta.url)), {
  "@/lib/db/core": core, "@/lib/db/dm-turns": turns, "@/lib/db/commit-effects": effects,
});
const crash = () => process.exit(86);
const originalPrepare = adapter.prepare;
adapter.prepare = (sql) => {
  const statement = originalPrepare(sql);
  if (!sql.includes("INSERT INTO dm_tool_results")) return statement;
  return { ...statement, run: (...args) => {
    if (phase === "before-result") crash();
    const result = statement.run(...args);
    if (phase === "after-result") crash();
    return result;
  } };
};
const turn = turns.getDmTurn("t");
const call = { id: "award-1", name: "award", rawArguments: '{"gold":10}' };
const batch = journal.prepareDmBatch(turn, { tool_calls: [call] });
if (phase === "before-effect") crash();
journal.commitDmBatch(turn, batch, [call], () => {
  db.exec("UPDATE hero SET gold=gold+10");
  if (phase === "after-effect") crash();
  turn.conversation.push({ role: "tool", tool_call_id: call.id, content: '{"goldAdded":10}' });
  turn.callIndex++;
  return "continue";
}, () => ({ spotlightSet: false, beatCompleted: false, whisperCount: 0, noteCount: 0, encounterNudged: false }));
if (phase === "after-commit") crash();
journal.commitDmFinalization(turn, () => {
  db.exec("INSERT INTO narration VALUES ('t', 'checked'); UPDATE hero SET initiative=initiative+1");
  if (phase === "during-finalization") crash();
  turn.status = "done"; turns.saveDmTurn(turn);
});
if (phase === "after-finalization") crash();
throw new Error(`Unknown crash phase ${phase}`);
