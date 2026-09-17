import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, sqliteFixture } from './lib/readiness-harness.mjs';
import { withOperationSignal } from '../src/lib/operation-scope.mjs';
import * as operation from '../src/lib/operation-scope.mjs';

function fixture() {
  const f = sqliteFixture();
  const queue = loadSource('src/lib/dm/queue.ts');
  const receipts = loadSource('src/lib/db/narrator-commands.ts', { '@/lib/db/core': f.core });
  const commands = loadSource('src/lib/dm/narrator-command.ts', {
    '@/lib/db/core': f.core, '@/lib/db/campaigns': f.campaigns,
    '@/lib/db/commit-effects': f.effects, '@/lib/db/narrator-commands': receipts,
    '@/lib/dm/tool-transaction': f.transactions, '@/lib/dm/queue': queue,
    '@/lib/events': f.events, '@/lib/operation-scope.mjs': operation,
  });
  const state = { value: 0, nested: { gold: 3 } };
  const opts = {
    campaignId: 'c1', commandId: crypto.randomUUID(), expectedSeq: 0,
    operation: 'narrator.invoke', payload: { name: 'heal', args: { hp: 1 } },
    loadState: () => state,
    work: () => { state.value++; return { applied: state.value }; },
  };
  return { ...f, ...commands, queue, receipts, state, opts };
}

test('M05: abort while queued never runs work, consumes sequence, or writes a receipt', async () => {
  const f = fixture();
  let release;
  const held = f.queue.enqueueDmJob('c1', () => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  const abort = new AbortController();
  const waiting = withOperationSignal(abort.signal, () => f.executeNarratorCommand(f.opts));
  abort.abort(); release();
  await held;
  await assert.rejects(waiting, (error) => error.status === 499);
  assert.equal(f.state.value, 0);
  assert.equal(f.campaigns.latestSeq('c1'), 0);
  assert.equal(f.receipts.getNarratorReceipt('c1', f.opts.commandId), null);
  f.close();
});

test('M05: already cancelled and stale commands never call work', async () => {
  const f = fixture();
  const abort = new AbortController(); abort.abort();
  assert.throws(() => withOperationSignal(abort.signal, () => f.executeNarratorCommand(f.opts)));
  await assert.rejects(f.executeNarratorCommand({ ...f.opts, expectedSeq: 9 }), (e) => e.status === 409);
  assert.equal(f.state.value, 0); f.close();
});

test('M02/M05: exact retry after lost response returns receipt without a second mutation or public secret', async () => {
  const f = fixture();
  const first = await f.executeNarratorCommand(f.opts);
  const second = await f.executeNarratorCommand(f.opts);
  assert.equal(first.replayed, false); assert.equal(second.replayed, true);
  assert.deepEqual(second.result, first.result); assert.equal(f.state.value, 1);
  assert.equal(f.campaigns.latestSeq('c1'), 1);
  const events = f.events.listEventsSince('c1', 0);
  assert.deepEqual(events, [{ seq: 1, type: 'narrator_command_completed', payload: { receiptId: first.receiptId } }]);
  assert.equal(JSON.stringify(events).includes('heal'), false);
  await assert.rejects(f.executeNarratorCommand({ ...f.opts, payload: { name: 'award_xp' } }), (e) => e.status === 409);
  assert.equal(f.state.value, 1); f.close();
});

test('M02: receipt/event failure rolls back SQL, cached state, sequence, and deferred effects', async () => {
  const f = fixture(); const heard = [];
  const unsubscribe = f.events.subscribe('c1', (chunk) => heard.push(chunk));
  f.db.exec(`CREATE TRIGGER refuse_receipt BEFORE INSERT ON campaign_events WHEN NEW.type = 'narrator_command_completed'
    BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;`);
  await assert.rejects(f.executeNarratorCommand({ ...f.opts, work: () => {
    f.state.value++; f.state.nested.gold--;
    f.messages.insertCampaignMessage({ campaignId: 'c1', seq: f.campaigns.allocateSeq('c1'), content: 'private' });
    f.events.publishEphemeral('c1', 'whisper_activity', {});
    return { ok: true };
  } }), /injected receipt failure/);
  assert.deepEqual(f.state, { value: 0, nested: { gold: 3 } });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM campaign_messages').get().n, 0);
  assert.equal(f.campaigns.latestSeq('c1'), 0); assert.deepEqual(heard, []);
  unsubscribe(); f.close();
});

test('M05: synchronous cancellation before commit rolls back; cancellation from after-commit delivery keeps receipt', async () => {
  const f = fixture(); const abort = new AbortController();
  await assert.rejects(withOperationSignal(abort.signal, () => f.executeNarratorCommand({ ...f.opts, work: () => {
    f.state.value++; abort.abort(); return { ok: true };
  } })), (e) => e.status === 499);
  assert.equal(f.state.value, 0);
  const nextAbort = new AbortController();
  const unsubscribe = f.events.subscribe('c1', () => nextAbort.abort());
  const result = await withOperationSignal(nextAbort.signal, () => f.executeNarratorCommand(f.opts));
  assert.equal(result.replayed, false); assert.equal(f.state.value, 1);
  assert.equal((await f.executeNarratorCommand(f.opts)).replayed, true);
  unsubscribe(); f.close();
});

test('M02: async callbacks are rejected before invocation, including before their first write', async () => {
  const f = fixture(); let called = false;
  await assert.rejects(f.executeNarratorCommand({ ...f.opts, work: async () => { called = true; return {}; } }), /synchronous/);
  assert.equal(called, false); f.close();
});

test('receipt from a rewound timeline cannot authorize replay, including a reused numeric sequence', async () => {
  const f = fixture(); await f.executeNarratorCommand(f.opts);
  f.db.exec("DELETE FROM campaign_events; UPDATE campaigns SET next_seq = 1 WHERE id = 'c1'");
  f.events.publishPersisted('c1', 'message_added', { content: 'new timeline' });
  await assert.rejects(f.executeNarratorCommand(f.opts), (e) => e.status === 409);
  assert.equal(f.state.value, 1); f.close();
});

test('legacy requests also recover an identical result; campaign and authorization checks remain in force', async () => {
  const f = fixture(); const legacy = { ...f.opts, commandId: undefined };
  await f.executeNarratorCommand(legacy);
  assert.equal((await f.executeNarratorCommand(legacy)).replayed, true);
  await assert.rejects(f.executeNarratorCommand({ ...legacy, loadState: () => { throw new Error('membership revoked'); } }), /membership revoked/);
  assert.equal(f.receipts.getNarratorReceipt('c2', f.opts.commandId), null);
  f.close();
});
