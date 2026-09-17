/** Defer process-local notifications until the enclosing synchronous SQLite
 * transaction commits. This is not a durable external-job queue.
 * Never keep a scope open across an await.
 */
type Effect = () => unknown;
declare global {
  var __odmCommitEffectScopes: Effect[][] | undefined;
}
function activeScopes(): Effect[][] {
  return (globalThis.__odmCommitEffectScopes ??= []);
}

function deliver(effect: Effect) {
  try {
    const result = effect();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      void Promise.resolve(result).catch((error) => console.error("[after-commit] effect failed", error));
    }
  } catch (error) {
    // A notification failure cannot turn a committed transaction into an
    // apparent failure. Persisted SSE events remain available for replay.
    console.error("[after-commit] effect failed", error);
  }
}

export function afterCommit(effect: Effect): void {
  const scopes = activeScopes();
  const scope = scopes[scopes.length - 1];
  if (scope) scope.push(effect);
  else deliver(effect);
}

export function withCommittedEffects<T>(work: () => T): T {
  const scopes = activeScopes();
  const effects: Effect[] = [];
  scopes.push(effects);
  let result: T;
  try {
    result = work();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      throw new Error("A commit-effects scope must be synchronous.");
    }
  } catch (error) {
    scopes.pop();
    throw error;
  }
  scopes.pop();
  const parent = scopes[scopes.length - 1];
  if (parent) parent.push(...effects);
  else for (const effect of effects) deliver(effect);
  return result;
}
