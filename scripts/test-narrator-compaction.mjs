import test from 'node:test';
import assert from 'node:assert/strict';
import { HostContextMemory } from '../narrator/compaction.mjs';

test('M13: Host context memory bounds message history and compacts into summary', () => {
  const memory = new HostContextMemory({
    campaignId: 'c1',
    maxRecentMessages: 10,
    compactionBatchSize: 5,
    summaryLimitChars: 2000,
  });

  // Ingest 25 sequential messages
  const messages = Array.from({ length: 25 }, (_, i) => ({
    id: `m_${i}`,
    seq: i + 1,
    authorName: `Player${i % 3}`,
    content: i === 5
      ? 'Воин пал в бою и погиб от яда!'
      : i === 12
      ? 'Маг получил повышение уровня!'
      : `Обычное действие номер ${i}`,
  }));

  memory.ingestReadSnapshot({
    campaignId: 'c1',
    recentMessages: messages,
    recentRolls: [{ id: 'r1', dice: '1d20', result: 18 }],
    sheets: [{ id: 's1', name: 'Торин', hp: 24, ac: 16, class: 'Fighter', level: 3 }],
  });

  // Verify bounded message buffer
  assert.ok(memory.messages.length <= 15, `Expected <= 15 messages, got ${memory.messages.length}`);

  // Verify milestones preserved
  assert.equal(memory.milestones.length, 2);
  assert.equal(memory.milestones[0].type, 'death');
  assert.equal(memory.milestones[1].type, 'level_up');

  // Verify rolling summary formed
  assert.ok(memory.summary.includes('[Прошедшие события]:'));
  assert.ok(memory.summary.includes('Обычное действие'));

  // Test serialization and restoration
  const state = memory.serializeState();
  assert.equal(state.campaignId, 'c1');
  assert.equal(state.milestones.length, 2);

  const restored = new HostContextMemory({ campaignId: 'c1' });
  restored.restoreState(state);
  assert.equal(restored.milestones.length, 2);
  assert.equal(restored.summary, memory.summary);
});
