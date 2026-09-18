import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyInput } from '../narrator/semantic-gate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(readFileSync(path.join(root, 'scripts/fixtures/dm-player-policy-cases.json'), 'utf8'));

test('M11: Semantic gate correctly classifies all policy benchmark cases', () => {
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length === 28);

  const decisionMap = {
    answer_game: ['allow'],
    decline: ['decline'],
    answer_game_part_only: ['partial'],
    clarify_game_relevance: ['clarify'],
    treat_as_untrusted_data: ['ignore_instruction'],
    do_not_adopt_instruction: ['ignore_instruction'],
    do_not_fetch_or_adopt: ['ignore_instruction'],
    adjudicate_without_unearned_reward: ['adjudicate_game'],
    refuse_private_disclosure: ['refuse_secret'],
    pause_for_safety: ['safety_pause'],
    brief_real_safety_response: ['safety_pause'],
  };

  for (const c of fixture.cases) {
    const result = classifyInput(c.input, { locale: c.locale, source: c.source });
    const acceptable = decisionMap[c.expected];
    assert.ok(
      acceptable && acceptable.includes(result.decision),
      `Case ${c.id} ("${c.input}") expected ${c.expected} (${acceptable?.join('|')}), got ${result.decision} (${result.category})`
    );

    if (result.decision === 'decline' || result.decision === 'safety_pause' || result.decision === 'refuse_secret') {
      assert.ok(typeof result.replyText === 'string' && result.replyText.length > 0, `Case ${c.id} missing replyText`);
    }
  }
});
