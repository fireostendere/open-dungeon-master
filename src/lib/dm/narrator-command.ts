import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/core";
import { latestSeq } from "@/lib/db/campaigns";
import { withCommittedEffects } from "@/lib/db/commit-effects";
import { getNarratorReceipt, narratorReceiptInTimeline, saveNarratorReceipt } from "@/lib/db/narrator-commands";
import { withGameStateRollback } from "@/lib/dm/tool-transaction";
import { enqueueDmJob } from "@/lib/dm/queue";
import { publishPersisted } from "@/lib/events";
import { currentOperationSignal } from "@/lib/operation-scope.mjs";
import { emitLatency, latencyEnabled, withLatencyTrace } from "../../../mcp/latency-trace.mjs";

export class NarratorCommandError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
function notCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new NarratorCommandError("Narrator command cancelled before commit.", signal.reason?.name === "TimeoutError" ? 504 : 499);
  }
}
function fingerprint(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

type CommandOptions<State extends object> = {
  campaignId: string;
  expectedSeq: number;
  commandId?: string;
  operation: string;
  payload: unknown;
  loadState: () => State;
  work: (state: State) => Record<string, unknown>;
  // A server-selected, narrow dependency proof. Never supplied by a client.
  acceptUnrelated?: (state: State, currentSeq: number) => boolean;
};
type CommandResult = { result: unknown; commandId: string; receiptId: string; committedSeq: number; currentSeq: number; replayed: boolean };

/** Serialize, CAS, mutate and record a private result in one synchronous commit.
 * Cancellation while queued cannot start a mutation. Cancellation after commit
 * cannot undo it: the identical request can recover its durable receipt.
 */
export async function executeNarratorCommand<State extends object>(options: CommandOptions<State>): Promise<CommandResult> {
  return withLatencyTrace(async () => {
  const startedAt = performance.now();
  let queueMs = 0;
  const signal = currentOperationSignal() as AbortSignal | undefined;
  notCancelled(signal);
  if (options.work.constructor.name === "AsyncFunction") throw new NarratorCommandError("Narrator command work must be synchronous.", 500);
  const hash = fingerprint({ campaignId: options.campaignId, expectedSeq: options.expectedSeq, operation: options.operation, payload: options.payload });
  // Legacy callers also get safe retries of the identical expectedSeq/payload.
  // This private key is never placed on the shared event bus.
  const commandId = options.commandId ?? `legacy:${hash}`;
  let outcome: CommandResult | undefined;
  let failure: unknown;
  await enqueueDmJob(options.campaignId, async () => {
    queueMs = performance.now() - startedAt;
    try {
      notCancelled(signal);
      const state = options.loadState(); // repeats authorization/mode checks after waiting
      const previous = getNarratorReceipt(options.campaignId, commandId);
      if (previous) {
        if (previous.fingerprint !== hash) throw new NarratorCommandError("Command ID was already used with different arguments.", 409);
        if (!narratorReceiptInTimeline(options.campaignId, previous)) throw new NarratorCommandError("This command belongs to a rewound timeline. Reread and use a new command ID.", 409);
        outcome = { result: previous.result, commandId, receiptId: previous.receiptId,
          committedSeq: previous.committedSeq, currentSeq: latestSeq(options.campaignId), replayed: true };
        return;
      }
      notCancelled(signal);
      outcome = withGameStateRollback([state], () => withCommittedEffects(() => getDatabase().transaction(() => {
        notCancelled(signal);
        // Both the ordinary CAS and the optional proof run under the write's
        // transaction; shared mechanics still require exact campaign sequence.
        const currentSeq = latestSeq(options.campaignId);
        if (currentSeq !== options.expectedSeq && !options.acceptUnrelated?.(state, currentSeq)) {
          throw new NarratorCommandError("Stale narrator cursor; reread and drain events before writing.", 409);
        }
        const result = options.work(state);
        if (result && typeof result.then === "function") throw new NarratorCommandError("Narrator command returned asynchronous work.", 500);
        notCancelled(signal);
        const receiptId = randomUUID();
        // Argument-free, random correlation only. Private results, arguments
        // and their hashes never enter the public campaign stream.
        publishPersisted(options.campaignId, "narrator_command_completed", { receiptId });
        const committedSeq = latestSeq(options.campaignId);
        saveNarratorReceipt(options.campaignId, { commandId, receiptId, fingerprint: hash, operation: options.operation, result, committedSeq });
        return { result, commandId, receiptId, committedSeq, currentSeq: committedSeq, replayed: false };
      })()));
    } catch (error) { failure = error; }
  });
  if (latencyEnabled()) emitLatency({ stage: "narrator_write", queueMs, durationMs: performance.now() - startedAt, ok: !failure, replayed: outcome?.replayed ?? false, attemptCount: 1, errorCount: failure ? 1 : 0 });
  if (failure) throw failure instanceof NarratorCommandError ? failure
    : new NarratorCommandError(failure instanceof Error ? failure.message : "Narrator command failed.", 500);
  if (!outcome) throw new NarratorCommandError("Narrator command did not execute.", 500);
  // Do not check cancellation here: the commit is already durable.
  return outcome;
  });
}
