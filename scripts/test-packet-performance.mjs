import test from 'node:test';
import assert from 'node:assert/strict';
import { compactRolePacket } from '../narrator/role-packet.mjs';
import { runSyntheticScenario } from './benchmark-narrator-turns.mjs';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

const input = { id: 'm1', seq: 4, authorType: 'player', userId: 'u1', characterId: 'c1', content: 'Open it.' };

test('packet projection is frozen-input safe and removes only exact duplicate render fields', () => {
  const packet = freeze({ input, campaign: { scene: 'Vault' }, public: { scene: 'Vault', messages: [input,
    { ...input, id: 'near-id' }, { ...input, authorType: 'dm' }, { ...input, content: 'Near content' }] },
    state: { sheets: [{ id: 'c1', portrait: { bytes: 'rendering' }, currentHp: 7, backstory: 'canon' }] }, actions: [{ name: 'cast' }] });
  const referee = compactRolePacket('referee', packet);
  assert.equal(referee.state.sheets[0].portrait, undefined);
  assert.equal(referee.state.sheets[0].currentHp, 7);
  assert.equal(referee.public.scene, undefined);
  assert.deepEqual(referee.public.messages, packet.public.messages.slice(1));
  assert.ok(packet.state.sheets[0].portrait);
  referee.state.sheets[0].backstory = 'Projected only';
  referee.public.messages.push({ id: 'new' });
  assert.equal(packet.state.sheets[0].backstory, 'canon');
  assert.equal(packet.public.messages.length, 4);
  const privatePacket = { ...packet, task: 'answer_ask' };
  assert.strictEqual(compactRolePacket('referee', privatePacket), privatePacket);
  assert.strictEqual(compactRolePacket('writer', privatePacket), privatePacket);
});

test('unidentified input and a differing scene are retained', () => {
  const packet = freeze({ input: { seq: 4, content: 'Open it.' }, campaign: { scene: 'Authoritative scene' },
    public: { scene: 'Different public scene', messages: [{ id: 'm1', seq: 4, content: 'Open it.' }] }, state: { sheets: [] } });
  const result = compactRolePacket('referee', packet);
  assert.strictEqual(result.public.messages, packet.public.messages);
  assert.equal(result.public.scene, 'Different public scene');
});

test('writer policy preserves approved draft and never accepts raw referee state', () => {
  const packet = freeze({ messages: [input, { ...input, id: 'old', seq: 3, content: 'Earlier.' }], input,
    approvedDraft: 'Approved.' });
  const writer = compactRolePacket('writer', packet);
  assert.deepEqual(writer.messages, [packet.messages[1]]);
  assert.equal(writer.approvedDraft, 'Approved.');
});

test('synthetic benchmark rejects missing narration and stale CAS', async () => {
  await assert.rejects(runSyntheticScenario('speech', { omitNarration: true }), /did not narrate/);
  await assert.rejects(runSyntheticScenario('speech', { staleCas: true }), /stale command/);
});
