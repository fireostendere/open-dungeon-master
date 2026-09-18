import test from 'node:test';
import assert from 'node:assert/strict';
import { HostContextMemory } from '../narrator/compaction.mjs';

const message = (id, seq, content, extra = {}) => ({ id, seq, content, roomId: 'vault', witnessUserIds: ['A'], ...extra });
const memory = () => new HostContextMemory({ maxRecentMessages: 1, compactionBatchSize: 1 });

test('compaction and milestones retain witnesses, source and sequence', () => {
  const m = memory();
  m.ingestReadSnapshot({ messages: [message('secret', 1, 'death SECRET'), message('later', 2, 'later')] });
  const saved = m.serializeState();
  assert.deepEqual(saved.summarySegments[0].witnessUserIds, ['A']);
  assert.equal(saved.summarySegments[0].sourceId, 'secret');
  assert.equal(saved.summarySegments[0].fromSeq, 1);
  assert.deepEqual(saved.milestones[0].witnessUserIds, ['A']);
  assert.match(JSON.stringify(m.getPromptContext('vault', { audienceUserIds: ['A'] })), /SECRET/);
  assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault', { audienceUserIds: ['A', 'B'] })), /SECRET/);
  assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault', { viewerUserId: 'B' })), /SECRET/);
});

test('legacy checkpoint and initial summary survive empty ingestion but remain DM-only', () => {
  for (const initial of [false, true]) {
    const m = new HostContextMemory(initial ? { initialSummary: 'LEGACY_CONFIRMED_HISTORY' } : {});
    if (!initial) m.restoreState({ summary: 'LEGACY_CONFIRMED_HISTORY' });
    m.ingestReadSnapshot({ messages: [] });
    assert.match(m.getPromptContext().summary, /LEGACY_CONFIRMED_HISTORY/);
    assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault', { viewerUserId: 'A' })), /LEGACY_CONFIRMED_HISTORY/);
    const restored = memory(); restored.restoreState(m.serializeState()); restored.ingestReadSnapshot({});
    assert.match(restored.summary, /LEGACY_CONFIRMED_HISTORY/);
  }
});

test('repeated full snapshot is idempotent across compaction and checkpoint restore', () => {
  const snapshot = { recentMessages: [message('old', 1, 'death HISTORICAL_EVENT'), message('new', 2, 'latest')] };
  const m = memory(); m.ingestReadSnapshot(snapshot);
  const expected = m.serializeState();
  for (let n = 0; n < 5; n++) m.ingestReadSnapshot(snapshot);
  assert.deepEqual(m.serializeState(), expected);
  const restored = memory(); restored.restoreState(expected); restored.ingestReadSnapshot(snapshot);
  assert.deepEqual(restored.serializeState(), expected);
  assert.equal(m.milestones.length, 1);
});

test('scope filters rolls, encounters and characters, not just prose', () => {
  const m = memory();
  m.ingestReadSnapshot({ recentRolls: [message('roll', 1, 'VAULT_ROLL')],
    encounter: message('fight', 2, 'VAULT_FIGHT'), sheets: [message('sheet', 3, 'ignored', { name: 'VAULT_PC' })] });
  assert.doesNotMatch(JSON.stringify(m.getPromptContext('street')), /VAULT/);
  const context = m.getPromptContext('vault', { viewerUserId: 'A' });
  assert.equal(context.recentRolls.length, 1); assert.equal(context.characters.length, 1);
  assert.equal(context.activeEncounter.id, 'fight');
  assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault', { viewerUserId: 'B' })), /VAULT/);
});

test('message revision replaces previous content and its audience instead of duplicating it', () => {
  const m = memory();
  m.ingestReadSnapshot({ messages: [message('old', 1, 'ORIGINAL'), message('new', 2, 'new')] });
  m.ingestReadSnapshot({ messages: [message('old', 1, 'REVISED', { version: 2, updatedSeq: 3, witnessUserIds: ['B'] })] });
  assert.doesNotMatch(JSON.stringify(m.getPromptContext()), /ORIGINAL/);
  assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault', { viewerUserId: 'A' })), /REVISED/);
  assert.match(JSON.stringify(m.getPromptContext('vault', { viewerUserId: 'B' })), /REVISED/);
});

test('timeline epoch and campaign changes clear incompatible memory and dedupe', () => {
  const m = memory();
  m.ingestReadSnapshot({ campaignId: 'one', timelineEpoch: 'before', messages: [message('same', 1, 'FUTURE')] });
  m.ingestReadSnapshot({ campaignId: 'one', timelineEpoch: 'after', messages: [message('same', 1, 'REWOUND')] });
  assert.doesNotMatch(JSON.stringify(m.serializeState()), /FUTURE/);
  assert.match(JSON.stringify(m.getPromptContext()), /REWOUND/);
  m.ingestReadSnapshot({ campaignId: 'two', messages: [] });
  assert.doesNotMatch(JSON.stringify(m.getPromptContext()), /REWOUND/);
});

test('explicit global events stay accessible and unknown provenance is not public', () => {
  const m = new HostContextMemory();
  m.ingestReadSnapshot({ messages: [message('public', 1, 'GLOBAL', { roomId: null, visibility: 'global', witnessUserIds: undefined }),
    message('unknown', 2, 'UNKNOWN', { witnessUserIds: undefined })] });
  const context = JSON.stringify(m.getPromptContext('street', { viewerUserId: 'B' }));
  assert.match(context, /GLOBAL/); assert.doesNotMatch(context, /UNKNOWN/);
});

test('diagnostics contain counts but no secret content or witness IDs', () => {
  const m = memory();
  m.ingestReadSnapshot({ messages: [message('secret', 1, 'SECRET', { witnessUserIds: ['SECRET_WITNESS'] })] });
  assert.doesNotMatch(JSON.stringify(m.serializeState({ safe: true })), /SECRET/);
});
