#!/usr/bin/env node
/** Standalone narrator host: bounded reads, durable recovery and diagnostics. */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, readJsonSafe } from './checkpoint-io.mjs';
import { classifyInput, DM_REFUSALS } from './semantic-gate.mjs';
import { NarratorCostTracker } from './cost-tracker.mjs';
import { HostContextMemory } from './compaction.mjs';
import { connectNarrator, drainNarratorStory, readNarratorSnapshot } from './read-session.mjs';

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
    this.checkpointPath = options.checkpointPath || process.env.ODM_NARRATOR_CHECKPOINT_PATH || path.join(defaultStateDir, `narrator-checkpoint-${this.campaignId || 'default'}.json`);
    this.costTracker = options.costTracker || new NarratorCostTracker({ storagePath: path.join(path.dirname(this.checkpointPath), `narrator-cost-${this.campaignId || 'default'}.json`) });
    this.memory = new HostContextMemory({ campaignId: this.campaignId });
    this.lastSeq = 0;
    this.lastAskSeq = 0;
    this.timelineEpoch = null;
    this.answeredAsks = new Set();
    this.pendingAskCommands = new Map();
    this.running = false;
    this.polling = false;
    this.connected = false;
    this.timer = null;
    this.healthServer = null;
    this.startedAt = Date.now();
    this.lastPollAt = 0;
    this.lastError = null;
  }

  loadCheckpoint() {
    const saved = readJsonSafe(this.checkpointPath);
    if (!saved || typeof saved !== 'object' || (this.campaignId && saved.campaignId !== this.campaignId)) return;
    if (!this.campaignId && saved.campaignId) this.campaignId = saved.campaignId;
    this.lastSeq = Number.isSafeInteger(saved.lastSeq) && saved.lastSeq >= 0 ? saved.lastSeq : 0;
    this.lastAskSeq = Number.isSafeInteger(saved.lastAskSeq) && saved.lastAskSeq >= 0 ? saved.lastAskSeq : 0;
    this.timelineEpoch = typeof saved.timelineEpoch === 'string' ? saved.timelineEpoch : null;
    if (Array.isArray(saved.answeredAsks)) this.answeredAsks = new Set(saved.answeredAsks.slice(-200));
    if (saved.pendingAskCommands && typeof saved.pendingAskCommands === 'object') {
      for (const [askId, command] of Object.entries(saved.pendingAskCommands).slice(-200)) {
        if (command && typeof command === 'object' && typeof command.commandId === 'string') this.pendingAskCommands.set(askId, command);
      }
    }
    if (saved.memory) this.memory.restoreState(saved.memory);
  }

  saveCheckpoint() {
    atomicWriteJson(this.checkpointPath, {
      formatVersion: 2, campaignId: this.campaignId, timelineEpoch: this.timelineEpoch,
      lastSeq: this.lastSeq, lastAskSeq: this.lastAskSeq,
      answeredAsks: Array.from(this.answeredAsks).slice(-200),
      pendingAskCommands: Object.fromEntries(Array.from(this.pendingAskCommands.entries()).slice(-200)),
      memory: this.memory.serializeState(), metrics: this.costTracker.getMetrics(),
      updatedAt: new Date().toISOString(), uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      lastPollAt: this.lastPollAt || null, lastError: this.lastError ? 'poll_failed' : null,
    });
  }

  async callControl(action, params = {}, { timeoutMs = 15000 } = {}) {
    if (!this.token) throw new Error('Narrator authentication token is missing.');
    const res = await this.fetchImpl(this.controlUrl, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action, params }), signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) throw Object.assign(new Error(body?.error || `Control returned HTTP ${res.status}`), { status: res.status, code: body?.code });
    return body?.result;
  }

  async connect() { this.connected = false; const result = await connectNarrator(this); this.connected = true; return result; }
  readSnapshot(params) { return readNarratorSnapshot(this, params); }
  drainStory() { return drainNarratorStory(this); }

  async drainAskQueue() {
    let cursor = 0;
    for (let page = 0; page < 1000; page++) {
      const result = await this.readSnapshot({ campaignId: this.campaignId, afterSeq: this.lastSeq, afterAskSeq: cursor,
        askLimit: 20, limit: 1, projection: 'live', ...(this.timelineEpoch ? { timelineEpoch: this.timelineEpoch } : {}) });
      if (this.timelineEpoch && result?.timelineEpoch && result.timelineEpoch !== this.timelineEpoch) throw Object.assign(new Error('Narrator timeline changed.'), { status: 409, code: 'timeline_changed' });
      for (const item of result?.asks || result?.askQueue?.items || []) await this.handlePendingAsk(item);
      const queue = result?.askQueue || {}, next = Number(queue.nextCursor ?? cursor);
      if (!Number.isSafeInteger(next) || next < cursor || (queue.hasMore && next <= cursor)) throw new Error('Ask queue cursor did not advance.');
      if (!queue.hasMore) { this.lastAskSeq = next; return; }
      cursor = next;
    }
    throw new Error('Ask queue exceeded the page safety limit.');
  }

  async pollTick() {
    if (!this.campaignId || this.polling) return false;
    this.polling = true;
    try {
      if (!this.connected) await this.connect();
      await this.drainAskQueue();
      await this.drainStory();
      this.lastPollAt = Date.now(); this.lastError = null; this.saveCheckpoint();
      return true;
    } catch (error) {
      if (error?.status === 409) {
        // A metadata reconnect confirms epoch/counter changes before deleting
        // memory. A mere byte-page conflict does not erase accepted history.
        try { await this.connect(); }
        catch { /* retry from the last durable page on the next bounded tick */ }
      }
      this.lastError = 'poll_failed';
      console.error('[narrator-runner] poll_failed');
      this.saveCheckpoint();
      return false;
    } finally { this.polling = false; }
  }

  async handlePendingAsk(ask) {
    if (!ask?.id || this.answeredAsks.has(ask.id)) return;
    const text = ask.question || '', locale = ask.locale || 'ru';
    const classification = classifyInput(text, { locale, source: 'ask' });
    let answerText = '';
    const citations = [];
    if (['safety_pause', 'refuse_secret', 'clarify'].includes(classification.decision)) answerText = classification.replyText;
    else if (['decline', 'ignore_instruction'].includes(classification.decision)) answerText = classification.replyText || DM_REFUSALS[locale] || DM_REFUSALS.ru;
    else {
      this.costTracker.recordUsage({ promptTokens: Math.ceil(text.length / 4) + 100, completionTokens: 150 });
      answerText = `[Ведущий]: Ответ на вопрос "${text}": действие выполняется согласно правилам D&D 5e и обстановке на сцене.`;
    }
    const command = this.pendingAskCommands.get(ask.id) || {
      campaignId: this.campaignId, askId: ask.id, answer: answerText, expectedVersion: ask.version ?? 0,
      commandId: crypto.randomUUID(), citations, ...(this.timelineEpoch ? { timelineEpoch: this.timelineEpoch } : {}),
    };
    this.pendingAskCommands.set(ask.id, command); this.saveCheckpoint();
    try {
      await this.callControl('narrator.answer_ask', command);
      this.answeredAsks.add(ask.id); this.pendingAskCommands.delete(ask.id); this.saveCheckpoint();
    } catch (error) {
      // A timeline/version conflict is not proof of delivery. Preserve the
      // pending command until a fresh queue or epoch proves its disposition.
      throw error;
    }
  }

  startHealthServer() {
    if (!this.healthPort || this.healthServer) return;
    this.healthServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      res.setHeader('cache-control', 'no-store');
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'healthy', uptime: process.uptime() }));
      } else if (url.pathname === '/status') {
        if (this.statusToken && req.headers.authorization !== `Bearer ${this.statusToken}`) {
          res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'running', campaignId: this.campaignId,
          lastSeq: this.lastSeq, lastAskSeq: this.lastAskSeq, answeredAsksCount: this.answeredAsks.size,
          pendingAskCommandsCount: this.pendingAskCommands.size, lastPollAt: this.lastPollAt || null,
          lastError: this.lastError ? 'poll_failed' : null, metrics: this.costTracker.getMetrics(),
          memory: this.memory.serializeState({ safe: true }), uptime: process.uptime(),
        }));
      } else { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' })); }
    });
    this.healthServer.listen(this.healthPort, '127.0.0.1', () => console.log(`[narrator-runner] Health server listening on port ${this.healthPort}`));
  }

  async start() {
    this.loadCheckpoint(); this.startHealthServer(); this.running = true;
    try { await this.connect(); console.log(`[narrator-runner] Connected to campaign ${this.campaignId} (seq: ${this.lastSeq}, askSeq: ${this.lastAskSeq})`); }
    catch { console.warn('[narrator-runner] Initial connect failed; the poll loop will retry.'); }
    const scheduleNext = () => {
      if (!this.running) return;
      this.timer = setTimeout(async () => { await this.pollTick(); scheduleNext(); }, this.pollIntervalMs);
    };
    scheduleNext();
  }

  async stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.saveCheckpoint();
    if (this.healthServer) { await new Promise(resolve => this.healthServer.close(resolve)); this.healthServer = null; }
    console.log('[narrator-runner] Stopped gracefully. Checkpoint saved.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2); let campaignId = '', once = false, port;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--campaign' && args[i + 1]) campaignId = args[++i];
    else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === '--once') once = true;
  }
  const runner = new NarratorRunner({ campaignId, healthPort: port });
  const shutdown = async () => { await runner.stop(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  if (once) {
    runner.loadCheckpoint();
    try { await runner.connect(); } catch { console.warn('[narrator-runner] Connect failed.'); }
    const success = await runner.pollTick(); runner.saveCheckpoint();
    console.log(success ? '[narrator-runner] Once completed.' : '[narrator-runner] Once failed.'); process.exit(success ? 0 : 1);
  } else runner.start().catch(() => { console.error('[narrator-runner] Fatal error.'); process.exit(1); });
}
