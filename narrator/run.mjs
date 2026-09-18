#!/usr/bin/env node
/**
 * Standalone Autonomous Narrator Host & Lifecycle Runner for Open Dungeon Master (ODM).
 *
 * Runs as an independent daemon or container, connecting to the ODM server / MCP sidecar,
 * managing checkpoint/recovery, semantic input validation, cost limits, and bounded memory.
 */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, readJsonSafe } from './checkpoint-io.mjs';
import { classifyInput, DM_REFUSALS } from './semantic-gate.mjs';
import { NarratorCostTracker } from './cost-tracker.mjs';
import { HostContextMemory } from './compaction.mjs';

// The standalone narrator image does not contain src/lib. Keep the small
// page assembler here so Docker and local runs use the same MCP contract.
function assembleReadPages(pages) {
  if (!Array.isArray(pages) || !pages.length || !pages.at(-1)?.complete) {
    const error = new Error('Incomplete narrator read pages.');
    error.status = 409;
    throw error;
  }
  const first = pages[0];
  if (!first || !first.shape || typeof first.shape !== 'object' || Array.isArray(first.shape)) {
    const error = new Error('Invalid narrator read page shape.');
    error.status = 400;
    throw error;
  }
  const state = {};
  for (const [key, kind] of Object.entries(first.shape || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !['array', 'value'].includes(kind)) {
      const error = new Error('Invalid narrator read page shape.');
      error.status = 400;
      throw error;
    }
    state[key] = kind === 'array' ? [] : undefined;
  }
  let offset = 0;
  let totalBytes = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    totalBytes += Buffer.byteLength(JSON.stringify(page), 'utf8');
    if (totalBytes > 4 * 1024 * 1024) {
      const error = new Error('Narrator read exceeds the host memory budget.');
      error.status = 413;
      throw error;
    }
    if (page.hash !== first.hash || page.offset !== offset ||
        JSON.stringify(page.shape) !== JSON.stringify(first.shape) ||
        page.complete !== (pageIndex === pages.length - 1)) {
      const error = new Error('Inconsistent narrator read pages.');
      error.status = 409;
      throw error;
    }
    if (!Array.isArray(page.entries)) {
      const error = new Error('Invalid narrator read page entries.');
      error.status = 400;
      throw error;
    }
    for (const item of page.entries) {
      if (!Object.hasOwn(first.shape, item.key) ||
          ['__proto__', 'constructor', 'prototype'].includes(item.key)) {
        const error = new Error('Invalid narrator read page entry.');
        error.status = 400;
        throw error;
      }
      if (first.shape[item.key] === 'array') {
        if (item.index !== state[item.key].length) {
          const error = new Error('Narrator read page array gap.');
          error.status = 409;
          throw error;
        }
        state[item.key].push(item.value);
      } else {
        if (Object.hasOwn(item, 'index')) {
          const error = new Error('Unexpected narrator read page index.');
          error.status = 400;
          throw error;
        }
        state[item.key] = item.value;
      }
    }
    offset += (page.entries || []).length;
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
  if (digest !== first.hash) {
    const error = new Error('Narrator read page integrity check failed.');
    error.status = 409;
    throw error;
  }
  return state;
}

export class NarratorRunner {
  constructor(options = {}) {
    this.campaignId = options.campaignId || process.env.ODM_CAMPAIGN_ID || process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID || '';
    this.controlUrl = (options.controlUrl || process.env.ODM_MCP_URL || process.env.ODM_MCP_CONTROL_URL || 'http://127.0.0.1:3005/api/internal/mcp').trim();
    this.token = (options.token || process.env.ODM_MCP_NARRATOR_TOKEN || process.env.ODM_MCP_TOKEN || '').trim();
    this.pollIntervalMs = Number(options.pollIntervalMs ?? process.env.ODM_NARRATOR_POLL_MS ?? 2000);
    this.readMaxBytes = Number(options.readMaxBytes ?? process.env.ODM_NARRATOR_READ_BYTES ?? 65536);
    this.readPageRetries = Number(options.readPageRetries ?? process.env.ODM_NARRATOR_READ_RETRIES ?? 2);
    this.healthPort = options.healthPort !== undefined ? Number(options.healthPort) : Number(process.env.ODM_NARRATOR_PORT ?? 3007);
    this.statusToken = (options.statusToken || process.env.ODM_NARRATOR_STATUS_TOKEN || '').trim();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;

    const defaultStateDir = process.env.ODM_STATE_DIR || './state';
    this.checkpointPath = options.checkpointPath || process.env.ODM_NARRATOR_CHECKPOINT_PATH ||
      path.join(defaultStateDir, `narrator-checkpoint-${this.campaignId || 'default'}.json`);

    this.costTracker = options.costTracker || new NarratorCostTracker({
      storagePath: path.join(path.dirname(this.checkpointPath), `narrator-cost-${this.campaignId || 'default'}.json`),
    });

    this.memory = new HostContextMemory({ campaignId: this.campaignId });

    this.lastSeq = 0;
    this.lastAskSeq = 0;
    this.answeredAsks = new Set();
    this.pendingAskCommands = new Map();
    this.running = false;
    this.timer = null;
    this.healthServer = null;
    this.startedAt = Date.now();
    this.lastPollAt = 0;
    this.lastError = null;
  }

  loadCheckpoint() {
    const saved = readJsonSafe(this.checkpointPath);
    if (saved && typeof saved === 'object') {
      if (saved.campaignId === this.campaignId || !this.campaignId) {
        if (!this.campaignId && saved.campaignId) this.campaignId = saved.campaignId;
        this.lastSeq = Number(saved.lastSeq || 0);
        this.lastAskSeq = Number(saved.lastAskSeq || 0);
        if (Array.isArray(saved.answeredAsks)) {
          this.answeredAsks = new Set(saved.answeredAsks.slice(-200));
        }
        if (saved.pendingAskCommands && typeof saved.pendingAskCommands === 'object') {
          for (const [askId, command] of Object.entries(saved.pendingAskCommands).slice(-200)) {
            if (command && typeof command === 'object' && typeof command.commandId === 'string') {
              this.pendingAskCommands.set(askId, command);
            }
          }
        }
        if (saved.memory) {
          this.memory.restoreState(saved.memory);
        }
      }
    }
  }

  saveCheckpoint() {
    const data = {
      campaignId: this.campaignId,
      lastSeq: this.lastSeq,
      lastAskSeq: this.lastAskSeq,
      answeredAsks: Array.from(this.answeredAsks).slice(-200),
      pendingAskCommands: Object.fromEntries(Array.from(this.pendingAskCommands.entries()).slice(-200)),
      memory: this.memory.serializeState(),
      metrics: this.costTracker.getMetrics(),
      updatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      lastPollAt: this.lastPollAt || null,
      lastError: this.lastError ? 'poll_failed' : null,
    };
    atomicWriteJson(this.checkpointPath, data);
  }

  async callControl(action, params = {}, { timeoutMs = 15000 } = {}) {
    if (!this.token) {
      throw new Error('Narrator authentication token is missing.');
    }
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await this.fetchImpl(this.controlUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ action, params }),
      signal,
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      const err = new Error(body?.error || `Control returned HTTP ${res.status}`);
      err.status = res.status;
      err.code = body?.code;
      throw err;
    }
    return body?.result;
  }

  async connect() {
    if (!this.campaignId) throw new Error('Cannot connect narrator without campaignId.');
    const result = await this.callControl('narrator.connect', { campaignId: this.campaignId });
    if (result && typeof result === 'object') {
      const state = result.state && typeof result.state === 'object' ? result.state : result;
      if (Number.isSafeInteger(state.currentSeq) &&
          (this.lastSeq === 0 || this.lastSeq > state.currentSeq)) {
        this.lastSeq = state.currentSeq;
      }
      this.memory.ingestReadSnapshot(state);
    }
    return result;
  }

  async readSnapshot(params) {
    for (let attempt = 0; attempt <= this.readPageRetries; attempt += 1) {
      const pages = [];
      let pageCursor;
      try {
        while (true) {
          const request = {
            ...params,
            paged: true,
            maxBytes: this.readMaxBytes,
            ...(pageCursor ? { pageCursor } : {}),
          };
          const result = await this.callControl('narrator.read', request);
          if (!result?.format) return result;
          if (result.format !== 'odm.read.page.v1') {
            throw new Error(`Unsupported narrator read format: ${result.format}`);
          }
          pages.push(result);
          if (result.complete) return assembleReadPages(pages);
          if (!result.nextPage) throw new Error('Narrator read page has no nextPage.');
          pageCursor = result.nextPage;
        }
      } catch (error) {
        if (error?.status === 409 && attempt < this.readPageRetries) continue;
        throw error;
      }
    }
    throw new Error('Narrator read retry budget exhausted.');
  }

  async drainAskQueue() {
    // Ask is an independent pending queue. Start at zero on every poll so a
    // still-pending item behind an old cursor cannot be stranded.
    let cursor = 0;
    for (let page = 0; page < 1000; page += 1) {
      const result = await this.readSnapshot({
        campaignId: this.campaignId,
        afterSeq: this.lastSeq,
        afterAskSeq: cursor,
        askLimit: 20,
        limit: 1,
        projection: 'live',
      });
      for (const item of result?.asks || result?.askQueue?.items || []) {
        await this.handlePendingAsk(item);
      }

      const queue = result?.askQueue || {};
      const next = Number(queue.nextCursor ?? cursor);
      if (!queue.hasMore) {
        this.lastAskSeq = next;
        return;
      }
      if (!Number.isSafeInteger(next) || next <= cursor) {
        throw new Error('Ask queue cursor did not advance.');
      }
      cursor = next;
    }
    throw new Error('Ask queue exceeded the page safety limit.');
  }

  async drainStory() {
    let cursor = this.lastSeq;
    for (let page = 0; page < 1000; page += 1) {
      const result = await this.readSnapshot({
        campaignId: this.campaignId,
        afterSeq: cursor,
        limit: 50,
        projection: 'full',
      });
      if (!result) return;
      this.memory.ingestReadSnapshot(result);
      const next = Number(result.nextCursor ?? result.currentSeq ?? cursor);
      if (!result.hasMore) {
        this.lastSeq = Math.max(this.lastSeq, Number.isSafeInteger(next) ? next : cursor);
        return;
      }
      if (!Number.isSafeInteger(next) || next <= cursor) {
        throw new Error('Story cursor did not advance.');
      }
      cursor = next;
    }
    throw new Error('Story stream exceeded the page safety limit.');
  }

  async pollTick() {
    if (!this.campaignId) return;

    try {
      await this.drainAskQueue();
      await this.drainStory();

      // Checkpoint after successful poll cycle
      this.lastPollAt = Date.now();
      this.lastError = null;
      this.saveCheckpoint();
      return true;
    } catch (err) {
      this.lastError = err?.message || String(err);
      console.error('[narrator-runner] poll error:', this.lastError);
      // Keep cursors unchanged on a failed read. The next tick retries the
      // same page; jumping ahead here silently loses player input.
      this.saveCheckpoint();
      return false;
    }
  }

  async handlePendingAsk(ask) {
    if (!ask?.id || this.answeredAsks.has(ask.id)) return;

    const text = ask.question || '';
    const locale = ask.locale || 'ru';
    const classification = classifyInput(text, { locale, source: 'ask' });

    let answerText = '';
    let citations = [];

    if (classification.decision === 'safety_pause') {
      answerText = classification.replyText;
    } else if (classification.decision === 'decline' || classification.decision === 'ignore_instruction') {
      answerText = classification.replyText || DM_REFUSALS[locale] || DM_REFUSALS.ru;
    } else if (classification.decision === 'refuse_secret') {
      answerText = classification.replyText;
    } else if (classification.decision === 'clarify') {
      answerText = classification.replyText;
    } else {
      // In-scope game question
      this.costTracker.recordUsage({ promptTokens: Math.ceil(text.length / 4) + 100, completionTokens: 150 });
      answerText = `[Ведущий]: Ответ на вопрос "${text}": действие выполняется согласно правилам D&D 5e и обстановке на сцене.`;
    }

    const command = this.pendingAskCommands.get(ask.id) || {
      campaignId: this.campaignId,
      askId: ask.id,
      answer: answerText,
      expectedVersion: ask.version ?? 0,
      commandId: crypto.randomUUID(),
      citations,
    };
    this.pendingAskCommands.set(ask.id, command);
    // Persist before sending: a timeout after the server commits must replay
    // the exact same command instead of creating a second answer.
    this.saveCheckpoint();

    try {
      await this.callControl('narrator.answer_ask', command);

      this.answeredAsks.add(ask.id);
      this.pendingAskCommands.delete(ask.id);
      this.saveCheckpoint();
    } catch (err) {
      if (err.status === 409) {
        // Already answered or version conflict; record as answered to prevent tight loop
        this.answeredAsks.add(ask.id);
        this.pendingAskCommands.delete(ask.id);
        this.saveCheckpoint();
      } else {
        throw err;
      }
    }
  }

  startHealthServer() {
    if (!this.healthPort || this.healthServer) return;

    this.healthServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'healthy', uptime: process.uptime() }));
      } else if (url.pathname === '/status') {
        if (this.statusToken && req.headers.authorization !== `Bearer ${this.statusToken}`) {
          res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          status: 'running',
          campaignId: this.campaignId,
          lastSeq: this.lastSeq,
          lastAskSeq: this.lastAskSeq,
          answeredAsksCount: this.answeredAsks.size,
          pendingAskCommandsCount: this.pendingAskCommands.size,
          lastPollAt: this.lastPollAt || null,
          // Never expose provider errors, prompts, tokens or private prose in
          // diagnostics. The detailed error remains in the operator log.
          lastError: this.lastError ? 'poll_failed' : null,
          metrics: this.costTracker.getMetrics(),
          memory: this.memory.serializeState({ safe: true }),
          uptime: process.uptime(),
        }));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.healthServer.listen(this.healthPort, '127.0.0.1', () => {
      console.log(`[narrator-runner] Health server listening on port ${this.healthPort}`);
    });
  }

  async start() {
    this.loadCheckpoint();
    this.startHealthServer();
    this.running = true;

    try {
      await this.connect();
      console.log(`[narrator-runner] Connected to campaign ${this.campaignId} (seq: ${this.lastSeq}, askSeq: ${this.lastAskSeq})`);
    } catch (err) {
      console.warn('[narrator-runner] Initial connect failed, will retry in loop:', err.message);
    }

    const scheduleNext = () => {
      if (!this.running) return;
      this.timer = setTimeout(async () => {
        await this.pollTick();
        scheduleNext();
      }, this.pollIntervalMs);
    };

    scheduleNext();
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.saveCheckpoint();
    if (this.healthServer) {
      await new Promise(resolve => this.healthServer.close(resolve));
      this.healthServer = null;
    }
    console.log('[narrator-runner] Stopped gracefully. Checkpoint saved.');
  }
}

// Direct execution CLI entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let campaignId = '';
  let once = false;
  let port = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--campaign' && args[i + 1]) campaignId = args[++i];
    else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === '--once') once = true;
  }

  const runner = new NarratorRunner({ campaignId, healthPort: port });

  const shutdown = async () => {
    await runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (once) {
    runner.loadCheckpoint();
    await runner.connect().catch(e => console.warn('Connect warning:', e.message));
    await runner.pollTick();
    runner.saveCheckpoint();
    console.log('[narrator-runner] Once completed.');
    process.exit(0);
  } else {
    runner.start().catch(err => {
      console.error('[narrator-runner] Fatal error:', err);
      process.exit(1);
    });
  }
}
