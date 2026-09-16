export function currentOperationSignal(): AbortSignal | undefined;
export function combinedSignal(...signals: (AbortSignal | undefined | null)[]): AbortSignal | undefined;
export function withOperationSignal<T>(signal: AbortSignal | undefined, callback: () => T): T;
