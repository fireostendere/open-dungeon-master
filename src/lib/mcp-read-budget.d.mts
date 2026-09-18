export class ReadBudgetError extends Error { constructor(message: string, status?: number); status: number; }
export const DEFAULT_READ_BYTES: number;
export type ReadPage = { format: 'odm.read.page.v1'; hash: string; shape: Record<string, 'array'|'value'>;
  offset: number; entries: { key: string; index?: number; value: unknown }[]; nextPage: string|null;
  complete: boolean; currentSeq?: unknown; nextCursor?: unknown; hasMore?: unknown };
export function budgetRead<T extends Record<string, unknown>>(state: T, options?: { paged?: boolean; pageCursor?: string; maxBytes?: number }): T | ReadPage;
export function assembleReadPages(pages: ReadPage[], maxTotalBytes?: number): Record<string, unknown>;
