import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostContextMemory } from '../narrator/compaction.mjs';
const secret = { id: 'old', seq: 1, roomId: 'tavern', witnessUserIds: ['A'], content: 'SECRET_BEFORE_B' };
const current = { id: 'new', seq: 2, roomId: 'tavern', witnessUserIds: ['A', 'B'], content: 'TOGETHER' };

test('R08: folded record and checkpoint retain exact witnesses', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 1 });
  memory.ingestReadSnapshot({ messages: [secret, current] });
  const record = memory.serializeState().summaryRecords[0];
  assert.equal(record.content, secret.content);
  assert.deepEqual(record.witnessUserIds, ['A']);
  assert.equal(memory.getPromptContext({ roomId: 'tavern', viewerUserId: 'B' }).summary.includes(secret.content), false);
  assert.equal(memory.getPromptContext({ roomId: 'tavern', viewerUserId: 'A' }).summary.includes(secret.content), true);
  const restored = new HostContextMemory(); restored.restoreState(memory.serializeState());
  assert.deepEqual(restored.getPromptContext({ roomId: 'tavern', viewerUserId: 'B' }), memory.getPromptContext({ roomId: 'tavern', viewerUserId: 'B' }));
});

test('R08: room-scoped context excludes foreign mechanics, unknown scope and legacy memory', () => {
  const memory = new HostContextMemory({ initialSummary: 'LEGACY_SECRET' });
  memory.ingestReadSnapshot({ recentRolls: [{ id: 'r', roomId: 'vault', reason: 'VAULT_ROLL' }, { id: 'u', reason: 'UNKNOWN' }],
    encounter: { encounter: { roomId: 'vault' }, summary: 'VAULT_BATTLE' },
    sheets: [{ id: 's', roomId: 'vault', name: 'VAULT_HERO' }] });
  const room = memory.getPromptContext('street');
  assert.equal(room.summary, ''); assert.deepEqual(room.recentRolls, []);
  assert.equal(room.activeEncounter, null); assert.deepEqual(room.characters, []);
  assert.equal(memory.getPromptContext('vault').recentRolls[0].reason, 'VAULT_ROLL');
  assert.equal(memory.getPromptContext().summary.includes('LEGACY_SECRET'), true);
});

test('R09: summary-only checkpoint survives first and repeated empty ingests as DM-only', () => {
  const memory = new HostContextMemory(); memory.restoreState({ summary: 'LEGACY_CONFIRMED_HISTORY', milestones: [] });
  for (let n = 0; n < 3; n++) memory.ingestReadSnapshot({ recentMessages: [], messages: [] });
  assert.ok(memory.getPromptContext().summary.includes('LEGACY_CONFIRMED_HISTORY'));
  assert.equal(memory.getPromptContext({ viewerUserId: 'A' }).summary, '');
  assert.equal(memory.getPromptContext('tavern').summary, '');
});

test('R09: old room summary lacking audiences is not treated as public', () => {
  const memory = new HostContextMemory(); memory.restoreState({ summaries: { 'room:tavern': 'OLD_PRIVATE_SCENE' } });
  memory.ingestReadSnapshot({ messages: [current] });
  assert.ok(memory.getPromptContext().summary.includes('OLD_PRIVATE_SCENE'));
  assert.equal(memory.getPromptContext({ roomId: 'tavern', viewerUserId: 'B' }).summary, '');
});

test('R10: identical full and incremental pages do not refold records or milestones', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 1 });
  const data = { recentMessages: [{ ...secret, content: 'killed HISTORICAL_EVENT' }, current], messages: [current] };
  memory.ingestReadSnapshot(data); const before = memory.serializeState();
  for (let n = 0; n < 5; n++) memory.ingestReadSnapshot(data);
  assert.deepEqual(memory.serializeState(), before);
  assert.equal(memory.milestones.length, 1);
  assert.equal(memory.summary.split('HISTORICAL_EVENT').length, 2);
});

test('R10: watermark persists through restart, including evicted records', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 1, summaryLimitChars: 400 });
  const messages = Array.from({ length: 10 }, (_, i) => ({ ...secret, id: `m${i}`, seq: i + 1, content: `message-${i} ` + 'x'.repeat(200) }));
  memory.ingestReadSnapshot({ messages });
  const restored = new HostContextMemory({ maxRecentMessages: 1, summaryLimitChars: 400 }); restored.restoreState(memory.serializeState());
  const before = restored.serializeState();
  restored.ingestReadSnapshot({ recentMessages: messages });
  assert.deepEqual(restored.serializeState(), before);
});

test('updates replace retained records and milestones without duplicating IDs', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 1 });
  memory.ingestReadSnapshot({ messages: [{ ...secret, content: 'death OLD' }, current] });
  memory.ingestReadSnapshot({ messages: [{ ...secret, content: 'CORRECTED', version: 2 }] });
  assert.equal(memory.summaryRecords.length, 1); assert.ok(memory.summary.includes('CORRECTED'));
  assert.equal(memory.milestones.length, 0);
});

test('OOC never enters narrator memory even when differently capitalized or structured', () => {
  const memory = new HostContextMemory();
  memory.ingestReadSnapshot({ messages: [
    { id: 'a', seq: 1, content: ' \n(OOC) secret' }, { id: 'b', seq: 2, kind: 'ooc', content: 'secret' }, current,
  ] });
  assert.equal(memory.messages.length, 1); assert.equal(memory.messages[0].id, current.id);
});

test('rewind/timeline change clears stale knowledge; cross-campaign ingestion refuses', () => {
  const memory = new HostContextMemory({ campaignId: 'c' });
  memory.ingestReadSnapshot({ currentSeq: 10, timelineId: 't1', messages: [secret] });
  memory.ingestReadSnapshot({ currentSeq: 1, timelineId: 't2', messages: [{ ...current, seq: 1 }] });
  assert.equal(JSON.stringify(memory.serializeState()).includes(secret.content), false);
  assert.throws(() => memory.ingestReadSnapshot({ campaignId: 'other' }), /another campaign/);
  assert.throws(() => memory.restoreState({ campaignId: 'other' }), /another campaign/);
});

test('safe diagnostics contain no prose, witness list, mechanics or summary', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 1 }); memory.ingestReadSnapshot({ messages: [secret, current] });
  assert.deepEqual(Object.keys(memory.serializeState({ safe: true })).sort(), ['campaignId', 'messageCount', 'milestoneCount', 'rollCount', 'roomCount', 'sheetCount'].sort());
  const context = memory.getPromptContext(); context.recentMessages[0].content = 'MUTATED';
  assert.equal(memory.messages[0].content, current.content);
});

test('a global OOC-free publication remains available to both rooms and users', () => {
  const memory = new HostContextMemory(); memory.ingestReadSnapshot({ messages: [
    { id: 'global', seq: 1, channel: 'global', content: 'PUBLIC_WORLD_EVENT' }, secret,
  ] });
  const b = memory.getPromptContext({ roomId: 'street', viewerUserId: 'B' });
  assert.deepEqual(b.recentMessages.map(m => m.id), ['global']);
});

test('invalid memory budgets cannot cause an endless compaction loop', () => {
  const memory = new HostContextMemory({ maxRecentMessages: 0, compactionBatchSize: 0, summaryLimitChars: NaN });
  memory.ingestReadSnapshot({ messages: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, seq: i, content: 'x' })) });
  assert.equal(memory.messages.length, 30); assert.ok(memory.summary.length <= 6000);
});
