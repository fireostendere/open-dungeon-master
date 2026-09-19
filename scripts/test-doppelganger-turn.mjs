import test from 'node:test';
import assert from 'node:assert/strict';
import { domainModules } from './lib/domain-module.mjs';

function fixture() {
  let finish;
  const reply = new Promise(resolve => { finish = resolve; });
  const campaign = { id: 'c', status: 'active', dmUserId: 'dm', gameSettings: { dmMode: 'human', language: 'ru', unitSystem: 'metric' }, settings: {} };
  const sheet = { id: 's', userId: 'p', name: 'Hero', class: 'fighter', level: 1, currentHp: 10, maxHp: 10,
    personality: 'Protective and laconic', backstory: 'Keeps a promise to a childhood friend', conditions: [] };
  const member = { userId: 'p', autopilot: true, skipTurnsCount: 0 };
  const calls = [], messages = [];
  let state = { roundNumber: 1, phase: 'active', actionsByCharacter: {} };
  const load = domainModules({
    '@/lib/db/campaigns': {
      campaignSeats: () => ({}), getCampaignById: () => campaign, getGlobalTurnState: () => state,
      listMembers: () => [member], setGlobalTurnState: (_id, next) => { state = next; },
      setMemberSkipTurns: (_id, _user, count) => { member.skipTurnsCount = count; }, allocateSeq: () => messages.length + 1,
    },
    '@/lib/db/messages': { listRecentMessages: () => [{ authorType: 'player', content: 'I watch the door.' }],
      insertCampaignMessage: message => { messages.push(message); return message; } },
    '@/lib/db/sheets': { listSheets: () => [sheet] },
    '@/lib/db/encounters': { getActiveEncounter: () => null },
    '@/lib/dm/loop': { requestDmTurn() {} },
    '@/lib/dm/delegation': { coverInEffect: () => false },
    '@/lib/dm/viewer': { hasHumanDm: () => true },
    '@/lib/dm/model': { requestUtilityMessage: async (_settings, prompt) => { calls.push(prompt); await reply; return { message: { content: 'I stand watch.' } }; } },
    '@/lib/events': { publishPersisted() {}, publishWithSeq() {} },
  });
  const api = load('@/lib/dm/global-turn-logic');
  return { ...api, campaign, member, sheet, calls, messages, finish, get state() { return state; }, set state(value) { state = value; } };
}

test('concurrent timer and job share one autopilot generation and publication', async () => {
  const f = fixture();
  const first = f.resolveGlobalTurn('c'), second = f.resolveGlobalTurn('c');
  f.finish();
  await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.messages.length, 1);
  assert.equal(f.state.roundNumber, 2);
  await f.resolveGlobalTurn('c', 1);
  assert.equal(f.calls.length, 1, 'a delayed callback from the old round must not start another generation');
  await f.resolveGlobalTurn('c', 2);
  assert.equal(f.calls.length, 2, 'the completed flight must not block the next round');
});

test('a returning player or revoked autopilot wins over an unfinished bot reply', async () => {
  for (const cancel of [
    f => { f.state.actionsByCharacter.s = { actionsCount: 1, phrasesCount: 0 }; },
    f => { f.member.autopilot = false; },
    f => { f.member.skipTurnsCount = 1; },
    f => { f.campaign.status = 'ended'; },
  ]) {
    const f = fixture();
    const pending = f.resolveGlobalTurn('c');
    cancel(f); f.finish(); await pending;
    assert.equal(f.messages.length, 0);
  }
});

test('an old generation cannot publish into or reset a newer round', async () => {
  const f = fixture();
  const pending = f.resolveGlobalTurn('c');
  f.state = { roundNumber: 7, phase: 'active', actionsByCharacter: { s: { actionsCount: 1 } } };
  f.finish(); await pending;
  assert.equal(f.messages.length, 0);
  assert.equal(f.state.roundNumber, 7);
});

test('actor prompt separates trusted instructions from character data and preserves personality', async () => {
  const f = fixture(); f.finish();
  await f.generateDoppelgangerAction(f.campaign, f.sheet);
  assert.equal(f.calls[0][0].role, 'system');
  assert.equal(f.calls[0][1].role, 'user');
  const input = JSON.parse(f.calls[0][1].content);
  assert.equal(input.character.personality, f.sheet.personality);
  assert.equal(input.character.backstory, f.sheet.backstory);
  assert.equal(input.character.currentHp, 10);
  assert.equal(input.language, 'ru');
  assert.equal(input.unitSystem, 'metric');
  assert.equal(Object.hasOwn(input, 'settings'), false);
});

test('autopilot stays opt-in', async () => {
  const f = fixture(); f.member.autopilot = false; f.finish();
  await f.resolveGlobalTurn('c');
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.member.autopilot, false);
});
