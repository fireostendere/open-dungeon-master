import test from 'node:test';
import assert from 'node:assert/strict';
import { NarratorCostTracker } from '../narrator/cost-tracker.mjs';

test('budget preflight prices prompt and completion estimates separately', () => {
  const tracker = new NarratorCostTracker({
    hourlyTokenLimit: 100000,
    dailyTokenLimit: 100000,
    dailyCostLimitUsd: 5,
    ratePerThousandPrompt: 1,
    ratePerThousandCompletion: 10,
  });
  assert.equal(tracker.checkBudget(2000).allowed, true, 'legacy numeric estimate stays prompt-priced');
  const result = tracker.checkBudget({ promptTokens: 1000, completionTokens: 1000 });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Daily cost budget exceeded/);
});

test('estimated usage is visible instead of pretending provider tokens are exact', () => {
  const tracker = new NarratorCostTracker({
    hourlyTokenLimit: 100000,
    dailyTokenLimit: 100000,
    dailyCostLimitUsd: 100,
  });
  tracker.recordUsage({ promptTokens: 120, completionTokens: 30, estimated: true });
  const metrics = tracker.getMetrics();
  assert.equal(metrics.totalTokens, 150);
  assert.equal(metrics.estimatedTokens, 150);
});
