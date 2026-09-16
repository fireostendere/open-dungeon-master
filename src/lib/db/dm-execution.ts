import { getDatabase } from "@/lib/db/core";
import { getDmTurn, saveDmTurn, type DmTurn } from "@/lib/db/dm-turns";
import { withCommittedEffects } from "@/lib/db/commit-effects";

export type ExecutionState = {
  spotlightSet: boolean;
  beatCompleted: boolean;
  whisperCount: number;
  noteCount: number;
  encounterNudged: boolean;
};
export type BatchDecision = "continue" | "finish" | "park";
export type PreparedDmBatch<T = unknown> = {
  turnId: string;
  index: number;
  message: T;
  phase: "tools" | "whispers";
  start: DmTurn;
};

type BatchRow = {
  batch_index: number;
  reply_json: string;
  start_json: string;
  completed_json: string | null;
  runtime_json: string | null;
  decision: BatchDecision | null;
  status: "pending" | "done";
  phase: "tools" | "whispers";
};

function database() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_execution_batches (
      turn_id TEXT NOT NULL REFERENCES dm_turns(id) ON DELETE CASCADE,
      batch_index INTEGER NOT NULL,
      reply_json TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'tools' CHECK (phase IN ('tools','whispers')),
      start_json TEXT NOT NULL,
      completed_json TEXT,
      runtime_json TEXT,
      decision TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
      PRIMARY KEY (turn_id, batch_index)
    );
    CREATE TABLE IF NOT EXISTS dm_tool_results (
      turn_id TEXT NOT NULL REFERENCES dm_turns(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      batch_index INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      arguments_json TEXT NOT NULL,
      result_json TEXT,
      PRIMARY KEY (turn_id, tool_call_id)
    );
  `);
  return db;
}

export function pendingDmBatch<T = unknown>(turnId: string): PreparedDmBatch<T> | null {
  const row = database().prepare(`SELECT * FROM dm_execution_batches
    WHERE turn_id = ? AND status = 'pending' ORDER BY batch_index LIMIT 1`).get(turnId) as BatchRow | undefined;
  return row ? { turnId, index: row.batch_index, phase: row.phase, message: JSON.parse(row.reply_json) as T, start: JSON.parse(row.start_json) as DmTurn } : null;
}

export function hasDmExecutionJournal(turnId: string): boolean {
  return Boolean(database().prepare("SELECT 1 FROM dm_execution_batches WHERE turn_id = ? LIMIT 1").get(turnId));
}

export function dmExecutionState(turnId: string): ExecutionState {
  const row = database().prepare(`SELECT runtime_json FROM dm_execution_batches
    WHERE turn_id = ? AND status = 'done' ORDER BY batch_index DESC LIMIT 1`).get(turnId) as { runtime_json: string | null } | undefined;
  return row?.runtime_json ? JSON.parse(row.runtime_json) as ExecutionState : {
    spotlightSet: false, beatCompleted: false, whisperCount: 0, noteCount: 0, encounterNudged: false,
  };
}

// The exact model response and pre-effect checkpoint become durable before
// any handler executes. Retry replays this response, not a new model guess.
export function prepareDmBatch<T>(turn: DmTurn, message: T, phase: "tools" | "whispers" = "tools"): PreparedDmBatch<T> {
  const db = database();
  return db.transaction(() => {
    const pending = pendingDmBatch<T>(turn.id);
    if (pending) return pending;
    const { next } = db.prepare(`SELECT COALESCE(MAX(batch_index), -1) + 1 AS next
      FROM dm_execution_batches WHERE turn_id = ?`).get(turn.id) as { next: number };
    const start = structuredClone(turn);
    db.prepare(`INSERT INTO dm_execution_batches (turn_id, batch_index, reply_json, start_json, phase)
      VALUES (?, ?, ?, ?, ?)`).run(turn.id, next, JSON.stringify(message ?? null), JSON.stringify(start), phase);
    return { turnId: turn.id, index: next, message, phase, start };
  })();
}

export function restoreDmBatch(turn: DmTurn, batch: PreparedDmBatch): void {
  if (turn.id !== batch.turnId || turn.campaignId !== batch.start.campaignId) {
    throw new Error("DM batch belongs to another turn or campaign.");
  }
  Object.assign(turn, structuredClone(batch.start), { status: "running" });
}

// A batch is atomic: every synchronous game mutation, the tool results, the
// turn checkpoint and the completion marker commit together. The key is
// turnId + normalized toolCallId (unique across that turn's conversation).
// Read-only asynchronous retrieval must happen before this function.
export function commitDmBatch(
  turn: DmTurn,
  batch: PreparedDmBatch,
  calls: readonly { id: string; name: string; rawArguments: string }[],
  work: () => BatchDecision,
  runtime: () => ExecutionState,
): BatchDecision {
  const db = database();
  const before = structuredClone(turn);
  try {
    return withCommittedEffects(() => db.transaction(() => {
      const row = db.prepare("SELECT * FROM dm_execution_batches WHERE turn_id = ? AND batch_index = ?")
        .get(turn.id, batch.index) as BatchRow | undefined;
      if (!row) throw new Error("DM batch was not prepared.");
      if (row.status === "done") {
        const persisted = getDmTurn(turn.id);
        Object.assign(turn, persisted ?? JSON.parse(row.completed_json!));
        return persisted?.status === "done" ? "finish" : row.decision!;
      }
      const decision = work();
      for (const call of calls) {
        const result = turn.conversation.findLast((entry) => entry.role === "tool" && entry.tool_call_id === call.id);
        db.prepare(`INSERT INTO dm_tool_results
          (turn_id, tool_call_id, batch_index, tool_name, arguments_json, result_json)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(turn.id, call.id, batch.index, call.name, call.rawArguments, result ? String(result.content) : null);
      }
      saveDmTurn(turn);
      db.prepare(`UPDATE dm_execution_batches SET status = 'done', completed_json = ?, runtime_json = ?, decision = ?
        WHERE turn_id = ? AND batch_index = ? AND status = 'pending'`)
        .run(JSON.stringify(turn), JSON.stringify(runtime()), decision, turn.id, batch.index);
      return decision;
    })());
  } catch (error) {
    Object.assign(turn, before);
    throw error;
  }
}

// Narration, initiative advancement and the done marker share a transaction.
// A crash cannot leave a committed narration with an uncommitted turn finish.
export function commitDmFinalization(turn: DmTurn, work: () => void): void {
  const db = database();
  const before = structuredClone(turn);
  try {
    withCommittedEffects(() => db.transaction(() => {
      const persisted = getDmTurn(turn.id);
      if (persisted?.status === "done") {
        Object.assign(turn, persisted);
        return;
      }
      work();
    })());
  } catch (error) {
    Object.assign(turn, before);
    throw error;
  }
}

export function recordedDmToolResult(turnId: string, toolCallId: string): string | null {
  const row = database().prepare("SELECT result_json FROM dm_tool_results WHERE turn_id = ? AND tool_call_id = ?")
    .get(turnId, toolCallId) as { result_json: string | null } | undefined;
  return row?.result_json ?? null;
}

export function dmReadyToFinalize(turnId: string): boolean {
  const row = database().prepare(`SELECT decision FROM dm_execution_batches
    WHERE turn_id = ? AND status = 'done' ORDER BY batch_index DESC LIMIT 1`)
    .get(turnId) as { decision: BatchDecision } | undefined;
  return row?.decision === "finish";
}
