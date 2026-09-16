import { AsyncLocalStorage } from 'node:async_hooks';
const operation = new AsyncLocalStorage();
export function currentOperationSignal() { return operation.getStore(); }
export function combinedSignal(...signals) {
  const defined = signals.filter(Boolean);
  return defined.length ? AbortSignal.any(defined) : undefined;
}
export function withOperationSignal(signal, callback) {
  const combined = combinedSignal(currentOperationSignal(), signal);
  combined?.throwIfAborted();
  return operation.run(combined, callback);
}
