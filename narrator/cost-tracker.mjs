/**
 * Cost & Token Budget Tracker for the Autonomous Narrator Host.
 * Prevents runaway API usage, enforces daily and hourly token/dollar limits,
 * and maintains durable spend accounting across host restarts.
 */
import { atomicWriteJson, readJsonSafe } from './checkpoint-io.mjs';

export class BudgetExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BudgetExceededError';
    this.details = details;
  }
}

export class NarratorCostTracker {
  constructor(options = {}) {
    this.storagePath = options.storagePath || null;
    this.hourlyTokenLimit = Number(options.hourlyTokenLimit ?? process.env.ODM_NARRATOR_HOURLY_TOKENS ?? 150_000);
    this.dailyTokenLimit = Number(options.dailyTokenLimit ?? process.env.ODM_NARRATOR_DAILY_TOKENS ?? 1_000_000);
    this.dailyCostLimitUsd = Number(options.dailyCostLimitUsd ?? process.env.ODM_NARRATOR_DAILY_COST_USD ?? 10.00);

    // Provider usage/cost wins when OpenCode exposes it. These are only the
    // fallback/preflight rates and can be tuned for the selected provider.
    this.ratePerThousandPrompt = Number(options.ratePerThousandPrompt ??
      process.env.ODM_NARRATOR_PROMPT_USD_PER_1K ?? 0.0015);
    this.ratePerThousandCompletion = Number(options.ratePerThousandCompletion ??
      process.env.ODM_NARRATOR_COMPLETION_USD_PER_1K ?? 0.006);

    this.state = this._loadInitialState();
  }

  _currentHourKey() {
    const now = new Date();
    return `${now.toISOString().slice(0, 13)}:00`;
  }

  _currentDayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  _loadInitialState() {
    if (this.storagePath) {
      const data = readJsonSafe(this.storagePath);
      if (data && typeof data === 'object') {
        return {
          dayKey: data.dayKey || this._currentDayKey(),
          hourKey: data.hourKey || this._currentHourKey(),
          dayTokens: Number(data.dayTokens || 0),
          dayCostUsd: Number(data.dayCostUsd || 0),
          hourTokens: Number(data.hourTokens || 0),
          totalTokens: Number(data.totalTokens || 0),
          totalCostUsd: Number(data.totalCostUsd || 0),
          estimatedTokens: Number(data.estimatedTokens || 0),
        };
      }
    }
    return {
      dayKey: this._currentDayKey(),
      hourKey: this._currentHourKey(),
      dayTokens: 0,
      dayCostUsd: 0,
      hourTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      estimatedTokens: 0,
    };
  }

  _persist() {
    if (this.storagePath) {
      atomicWriteJson(this.storagePath, this.state);
    }
  }

  _rolloverIfNeeded() {
    const today = this._currentDayKey();
    const currentHour = this._currentHourKey();

    if (this.state.dayKey !== today) {
      this.state.dayKey = today;
      this.state.dayTokens = 0;
      this.state.dayCostUsd = 0;
    }

    if (this.state.hourKey !== currentHour) {
      this.state.hourKey = currentHour;
      this.state.hourTokens = 0;
    }
  }

  /**
   * Check whether a proposed call fits the token and cost budgets. A number
   * keeps the legacy contract (all tokens priced as prompt); new callers
   * should pass separate prompt/completion estimates.
   */
  checkBudget(estimate = 2000) {
    this._rolloverIfNeeded();
    const promptTokens = typeof estimate === 'object' && estimate
      ? Math.max(0, Number(estimate.promptTokens) || 0)
      : Math.max(0, Number(estimate) || 0);
    const completionTokens = typeof estimate === 'object' && estimate
      ? Math.max(0, Number(estimate.completionTokens) || 0)
      : 0;
    const estimatedTokens = promptTokens + completionTokens;

    if (this.state.hourTokens + estimatedTokens > this.hourlyTokenLimit) {
      return {
        allowed: false,
        reason: `Hourly token quota exceeded (${this.state.hourTokens}/${this.hourlyTokenLimit})`,
        usage: { ...this.state },
      };
    }

    if (this.state.dayTokens + estimatedTokens > this.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `Daily token quota exceeded (${this.state.dayTokens}/${this.dailyTokenLimit})`,
        usage: { ...this.state },
      };
    }

    const estimatedCost =
      (promptTokens / 1000) * this.ratePerThousandPrompt +
      (completionTokens / 1000) * this.ratePerThousandCompletion;
    if (this.state.dayCostUsd + estimatedCost > this.dailyCostLimitUsd) {
      return {
        allowed: false,
        reason: `Daily cost budget exceeded ($${this.state.dayCostUsd.toFixed(2)}/$${this.dailyCostLimitUsd.toFixed(2)})`,
        usage: { ...this.state },
      };
    }

    return {
      allowed: true,
      usage: { ...this.state },
    };
  }

  /**
   * Record actual token consumption and calculated dollar cost.
   * @param {{ promptTokens?: number, completionTokens?: number, costUsd?: number }} params
   */
  recordUsage({ promptTokens = 0, completionTokens = 0, costUsd = null, estimated = false } = {}) {
    this._rolloverIfNeeded();

    const totalCallTokens = Math.max(0, promptTokens) + Math.max(0, completionTokens);
    const calculatedCost = typeof costUsd === 'number' && Number.isFinite(costUsd)
      ? costUsd
      : (Math.max(0, promptTokens) / 1000) * this.ratePerThousandPrompt +
        (Math.max(0, completionTokens) / 1000) * this.ratePerThousandCompletion;

    this.state.hourTokens += totalCallTokens;
    this.state.dayTokens += totalCallTokens;
    this.state.dayCostUsd += calculatedCost;
    this.state.totalTokens += totalCallTokens;
    this.state.totalCostUsd += calculatedCost;
    if (estimated) this.state.estimatedTokens += totalCallTokens;

    this._persist();

    return { ...this.state };
  }

  getMetrics() {
    this._rolloverIfNeeded();
    return {
      dayTokens: this.state.dayTokens,
      dailyTokenLimit: this.dailyTokenLimit,
      hourTokens: this.state.hourTokens,
      hourlyTokenLimit: this.hourlyTokenLimit,
      dayCostUsd: Number(this.state.dayCostUsd.toFixed(4)),
      dailyCostLimitUsd: this.dailyCostLimitUsd,
      totalTokens: this.state.totalTokens,
      totalCostUsd: Number(this.state.totalCostUsd.toFixed(4)),
      estimatedTokens: this.state.estimatedTokens,
    };
  }
}
