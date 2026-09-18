import { getDatabase } from "@/lib/db/core";
import { withCommittedEffects } from "@/lib/db/commit-effects";

/** Snapshot the mutable JSON/Map/Set graph without losing existing references.
 * A sheet may occur in both the array and the id map. Restoring copies instead
 * would leave one of those references pointing at a refused tool's changes.
 * Only synchronous game state is accepted; no external IO is rolled back here.
 */
function checkpoint(roots: readonly unknown[]): () => void {
  const seen = new Set<object>();
  const restores: (() => void)[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      const entries = [...value.entries()];
      restores.push(() => { value.clear(); for (const [key, item] of entries) value.set(key, item); });
      for (const [key, item] of entries) { visit(key); visit(item); }
    } else if (value instanceof Set) {
      const entries = [...value.values()];
      restores.push(() => { value.clear(); for (const item of entries) value.add(item); });
      for (const item of entries) visit(item);
    } else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
      const record = value as Record<string, unknown>;
      const entries = Object.entries(record);
      const length = Array.isArray(value) ? value.length : null;
      if (!Object.isFrozen(value)) restores.push(() => {
        for (const key of Object.keys(record)) delete record[key];
        if (Array.isArray(value) && length !== null) value.length = length;
        for (const [key, item] of entries) Object.defineProperty(record, key, { value: item, writable: true, enumerable: true, configurable: true });
      });
      for (const [, item] of entries) visit(item);
    }
  };
  for (const root of roots) visit(root);
  return () => { for (const restore of restores) restore(); };
}

/** The enclosing batch already owns SQL rollback; mirror it in cached state. */
export function withGameStateRollback<T>(state: readonly unknown[], work: () => T): T {
  const restore = checkpoint(state);
  try { return work(); }
  catch (error) { restore(); throw error; }
}

class RefusedTool extends Error {
  readonly result: unknown;
  constructor(result: unknown) {
    super("Tool refused");
    this.result = result;
  }
}
function refused(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("error" in value) return true;
  // Mutation and encounter dispatchers return { result, ...bookkeeping }.
  return "result" in value && value.result !== null && typeof value.result === "object" && "error" in value.result;
}

/**
 * A returned {error} is just as much a refusal as a thrown validation error.
 * Roll back that call's savepoint and queued notifications before returning its
 * error to the model. Unexpected exceptions still abort the whole durable batch.
 * A legitimate dice failure ({success:false}) is NOT an operation failure.
 */
export function executeDmTool<T>(state: readonly unknown[], work: () => T): T {
  try {
    return withGameStateRollback(state, () => withCommittedEffects(() => getDatabase().transaction(() => {
      const result = work();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("A DM tool transaction must be synchronous.");
      }
      if (refused(result)) throw new RefusedTool(result);
      return result;
    })()));
  } catch (error) {
    if (error instanceof RefusedTool) return error.result as T;
    throw error;
  }
}
