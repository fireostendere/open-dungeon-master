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

export class NarratorRunner {
  constructor(options = {}) {
    this.campaignId = options.campaignId || process.env.ODM_CAMPAIGN_ID || process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID || '';
    this.controlUrl = (options.controlUrl || process.env.ODM_MCP_URL || process.env.ODM_MCP_CONTROL_URL || 'http://127.0.0.1:3005/api/internal/mcp').trim();
    this.token = (options.token || process.env.ODM_MCP_NARRATOR_TOKEN || process.env.ODM_MCP_TOKEN || '').trim();
    this.pollIntervalMs = Number(options.pollIntervalMs ?? process.env.ODM_NARRATOR_POLL_MS ?? 2000);
    this.healthPort = options.healthPort !== undefined ? Number(options.healthPort) : Number(process.env.ODM_NARRATOR_PORT ?? 3007);
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
    this.running = false;
    this.timer = null;
    this.healthServer = null;
    this.startedAt = Date.now();
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
      memory: this.memory.serializeState(),
      metrics: this.costTracker.getMetrics(),
      updatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
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
      if (result.currentSeq && this.lastSeq === 0) {
        this.lastSeq = result.currentSeq;
      }
      this.memory.ingestReadSnapshot(result);
    }
    return result;
  }

  async pollTick() {
    if (!this.campaignId) return;

    try {
      // 1. Check pending Ask queue
      const askResult = await this.callControl('narrator.read', {
        campaignId: this.campaignId,
        afterAskSeq: this.lastAskSeq,
        askLimit: 20,
        limit: 1, // Minimize story payload while polling asks
      });

      if (askResult?.askQueue?.items?.length) {
        for (const item of askResult.askQueue.items) {
          await this.handlePendingAsk(item);
        }
        if (typeof askResult.askQueue.nextCursor === 'number') {
          this.lastAskSeq = Math.max(this.lastAskSeq, askResult.askQueue.nextCursor);
        }
      }

      // 2. Check story sequence
      const storyResult = await this.callControl('narrator.read', {
        campaignId: this.campaignId,
        afterSeq: this.lastSeq,
        limit: 50,
        paged: true,
      });

      if (storyResult) {
        this.memory.ingestReadSnapshot(storyResult);
        if (typeof storyResult.currentSeq === 'number') {
          this.lastSeq = Math.max(this.lastSeq, storyResult.currentSeq);
        }
      }

      // Checkpoint after successful poll cycle
      this.saveCheckpoint();
    } catch (err) {
      if (err.status === 409) {
        // Stale sequence conflict: re-read without mutating to resync
        try {
          const fresh = await this.callControl('narrator.read', { campaignId: this.campaignId, limit: 1 });
          if (fresh?.currentSeq) this.lastSeq = fresh.currentSeq;
        } catch {}
      } else {
        console.error('[narrator-runner] poll error:', err.message);
      }
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

    const commandId = `cmd-ask-${ask.id}-${ask.version ?? 0}-${crypto.randomBytes(4).toString('hex')}`;

    try {
      await this.callControl('narrator.answer_ask', {
        campaignId: this.campaignId,
        askId: ask.id,
        answer: answerText,
        expectedVersion: ask.version ?? 0,
        commandId,
        citations,
      });

      this.answeredAsks.add(ask.id);
    } catch (err) {
      if (err.status === 409) {
        // Already answered or version conflict; record as answered to prevent tight loop
        this.answeredAsks.add(ask.id);
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
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          status: 'running',
          campaignId: this.campaignId,
          lastSeq: this.lastSeq,
          lastAskSeq: this.lastAskSeq,
          answeredAsksCount: this.answeredAsks.size,
          metrics: this.costTracker.getMetrics(),
          memory: this.memory.serializeState(),
          uptime: process.uptime(),
        }));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.healthServer.listen(this.healthPort, '0.0.0.0', () => {
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
