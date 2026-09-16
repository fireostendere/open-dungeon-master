import { getDatabase } from "@/lib/db/core";

export type JournaledToolResult = Record<string, unknown>;

type ExecutionRow = {
  result_json: string;
};

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS dm_tool_executions (
      turn_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (turn_id, tool_call_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_tool_executions_turn
      ON dm_tool_executions(turn_id, created_at);
  `);
}

function parseResult(value: string): JournaledToolResult | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JournaledToolResult)
      : null;
  } catch {
    return null;
  }
}

export function getJournaledToolResult(
  turnId: string,
  toolCallId: string,
): JournaledToolResult | null {
  ensureSchema();
  const row = getDatabase()
    .prepare("SELECT result_json FROM dm_tool_executions WHERE turn_id = ? AND tool_call_id = ?")
    .get(turnId, toolCallId) as ExecutionRow | undefined;
  return row ? parseResult(row.result_json) : null;
}

// All SQLite-backed state changes made by fn share the same better-sqlite3
// connection and therefore the same outer transaction/savepoint. A crash or
// throw before the journal row commits rolls the mutation back. A retry with
// the same stable tool-call id returns the recorded result without invoking
// fn again.
export function executeToolOnce<T extends JournaledToolResult>(
  input: {
    turnId: string;
    toolCallId: string;
    toolName: string;
  },
  fn: () => T,
): T {
  ensureSchema();
  const db = getDatabase();
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT result_json FROM dm_tool_executions WHERE turn_id = ? AND tool_call_id = ?")
      .get(input.turnId, input.toolCallId) as ExecutionRow | undefined;
    if (existing) {
      const parsed = parseResult(existing.result_json);
      if (!parsed) throw new Error("Stored DM tool execution result is invalid.");
      return parsed as T;
    }

    const result = fn();
    db.prepare(`
      INSERT INTO dm_tool_executions (turn_id, tool_call_id, tool_name, result_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.turnId,
      input.toolCallId,
      input.toolName,
      JSON.stringify(result),
      new Date().toISOString(),
    );
    return result;
  })();
}
