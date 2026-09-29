import { createHash } from 'node:crypto';
export class ReadBudgetError extends Error {
  constructor(message, status = 413) { super(message); this.name = 'ReadBudgetError'; this.status = status; }
}
export const DEFAULT_READ_BYTES = 64 * 1024;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
// Preserve complete scalar values and array items, especially authoritative
// rolls/tool results. An individually oversized item fails closed, never clips.
export function budgetRead(state, { paged = false, pageCursor, maxBytes = DEFAULT_READ_BYTES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 131072)
    throw new ReadBudgetError('maxBytes must be 4096..131072.', 400);
  if (!paged) {
    if (pageCursor) throw new ReadBudgetError('pageCursor requires paged:true.', 400);
    if (bytes(state) > maxBytes) throw new ReadBudgetError('Read exceeds the context budget. Use paged:true and drain every page before acknowledging nextCursor.');
    return state;
  }
  const hash = digest(state);
  const entries = [], shape = {};
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) {
      shape[key] = 'array';
      for (const [index, item] of value.entries()) entries.push({ key, index, value: item });
    } else { shape[key] = 'value'; entries.push({ key, value }); }
  }
  let offset = 0;
  if (pageCursor) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(pageCursor, 'base64url').toString('utf8')); }
    catch { throw new ReadBudgetError('Invalid snapshot page cursor.', 400); }
    if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > entries.length)
      throw new ReadBudgetError('Invalid snapshot offset.', 400);
    if (cursor.hash !== hash) throw new ReadBudgetError('Snapshot changed while paging; restart the read without a pageCursor.', 409);
    offset = cursor.offset;
  }
  const pageCursorFor = next => Buffer.from(JSON.stringify({ hash, offset: next })).toString('base64url');
  const response = { format: 'odm.read.page.v1', hash, shape, offset, entries: [], nextPage: null,
    complete: false, currentSeq: state.currentSeq, nextCursor: state.nextCursor, hasMore: state.hasMore };
  // Size each entry once. The envelope is measured with the longest cursor it
  // can carry, so the accumulated total never underestimates the final page.
  const envelope = bytes({ ...response, nextPage: pageCursorFor(entries.length) });
  let used = envelope, index = offset;
  for (; index < entries.length; index++) {
    const cost = bytes(entries[index]) + (response.entries.length ? 1 : 0);
    if (used + cost > maxBytes) {
      if (index === offset) throw new ReadBudgetError(`A complete ${entries[index].key} item exceeds maxBytes; raise the budget within its hard limit or pause for operator review.`);
      break;
    }
    response.entries.push(entries[index]);
    used += cost;
  }
  response.nextPage = index < entries.length ? pageCursorFor(index) : null;
  response.complete = response.nextPage === null;
  if (bytes(response) > maxBytes) throw new ReadBudgetError('Snapshot metadata exceeds maxBytes.');
  return response;
}
export function assembleReadPages(pages, maxTotalBytes = 4 * 1024 * 1024) {
  if (!pages.length || !pages.at(-1).complete) throw new ReadBudgetError('Incomplete snapshot pages.', 409);
  const state = {};
  const first = pages[0];
  for (const [key, kind] of Object.entries(first.shape)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !['array', 'value'].includes(kind))
      throw new ReadBudgetError('Invalid snapshot shape.', 400);
    state[key] = kind === 'array' ? [] : undefined;
  }
  let offset = 0, total = 0;
  for (const [pageIndex, page] of pages.entries()) {
    total += bytes(page);
    if (total > maxTotalBytes) throw new ReadBudgetError('Snapshot exceeds the host memory budget.');
    if (page.hash !== first.hash || page.offset !== offset || JSON.stringify(page.shape) !== JSON.stringify(first.shape) ||
        page.complete !== (pageIndex === pages.length - 1)) throw new ReadBudgetError('Snapshot pages are inconsistent.', 409);
    for (const item of page.entries) {
      if (!Object.hasOwn(first.shape, item.key) || ['__proto__', 'constructor', 'prototype'].includes(item.key))
        throw new ReadBudgetError('Invalid snapshot key.', 400);
      if (first.shape[item.key] === 'array') {
        if (item.index !== state[item.key].length) throw new ReadBudgetError('Snapshot array gap.', 409);
        state[item.key].push(item.value);
      } else {
        if (Object.hasOwn(item, 'index')) throw new ReadBudgetError('Unexpected snapshot index.', 400);
        state[item.key] = item.value;
      }
    }
    offset += page.entries.length;
  }
  if (digest(state) !== first.hash) throw new ReadBudgetError('Snapshot integrity mismatch.', 409);
  return state;
}
