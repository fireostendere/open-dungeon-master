#!/usr/bin/env node
/** Campaign-scoped context collector and lifecycle runner.
 * The CLI does NOT pretend to be a model: an external narrator (e.g. Luna)
 * reads/adjudicates/narrates through MCP. An explicitly supplied askResponder
 * can answer Ask through the durable command path; without it Ask stays pending.
 */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, readJsonSafe } from './checkpoint-io.mjs';
import { classifyInput, DM_REFUSALS } from './semantic-gate.mjs';
import { NarratorCostTracker } from './cost-tracker.mjs';
import { HostContextMemory } from './compaction.mjs';

const integer = (value, fallback, min, max) => Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
const cursorAhead = error => error?.status === 409 && (error.code === 'NARRATOR_CURSOR_AHEAD' || /^Narrator cursor is ahead of campaign state;/.test(error.message));
const hash = value => crypto.createHash('sha256').update(value).digest();
const MAX_READ_BYTES = 4 * 1024 * 1024;

// Keep this assembler in the standalone image; never import src/lib here.
function assembleReadPages(pages) {
  if (!Array.isArray(pages) || !pages.length || !pages.at(-1)?.complete) throw new Error('Incomplete narrator read pages.');
  const first = pages[0];
  if (!first.shape || typeof first.shape !== 'object' || Array.isArray(first.shape)) throw new Error('Invalid narrator read page shape.');
  const state = {};
  for (const [key, kind] of Object.entries(first.shape)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !['array', 'value'].includes(kind)) throw new Error('Invalid narrator read page shape.');
    state[key] = kind === 'array' ? [] : undefined;
  }
  let offset = 0, totalBytes = 0;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    totalBytes += Buffer.byteLength(JSON.stringify(page), 'utf8');
    if (totalBytes > MAX_READ_BYTES) throw new Error('Narrator read exceeds the host memory budget.');
    if (page.hash !== first.hash || page.offset !== offset || JSON.stringify(page.shape) !== JSON.stringify(first.shape) ||
        page.complete !== (index === pages.length - 1) || !Array.isArray(page.entries)) throw new Error('Inconsistent narrator read pages.');
    for (const item of page.entries) {
      if (!item || !Object.hasOwn(first.shape, item.key)) throw new Error('Invalid narrator read page entry.');
      if (first.shape[item.key] === 'array') {
        if (item.index !== state[item.key].length) throw new Error('Narrator read page array gap.');
        state[item.key].push(item.value);
      } else {
        if (Object.hasOwn(item, 'index') || state[item.key] !== undefined) throw new Error('Unexpected narrator read page value.');
        state[item.key] = item.value;
      }
    }
    offset += page.entries.length;
  }
  if (crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex') !== first.hash) throw new Error('Narrator read page integrity check failed.');
  return state;
}

export class NarratorRunner {
  constructor(options = {}) {
    this.campaignId = options.campaignId || process.env.ODM_CAMPAIGN_ID || process.env.ODM_MCP_NARRATOR_CAMPAIGN_ID || '';
    this.controlUrl = (options.controlUrl || process.env.ODM_MCP_URL || process.env.ODM_MCP_CONTROL_URL || 'http://127.0.0.1:3005/api/internal/mcp').trim();
    this.token = (options.token || process.env.ODM_MCP_NARRATOR_TOKEN || process.env.ODM_MCP_TOKEN || '').trim();
    this.pollIntervalMs = integer(options.pollIntervalMs ?? process.env.ODM_NARRATOR_POLL_MS, 2000, 10, 86400000);
    this.readMaxBytes = integer(options.readMaxBytes ?? process.env.ODM_NARRATOR_READ_BYTES, 65536, 4096, 131072);
    this.readPageRetries = integer(options.readPageRetries ?? process.env.ODM_NARRATOR_READ_RETRIES, 2, 0, 10);
    this.healthPort = integer(options.healthPort ?? process.env.ODM_NARRATOR_PORT, 3007, 0, 65535);
    this.statusToken = (options.statusToken || process.env.ODM_NARRATOR_STATUS_TOKEN || '').trim();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    // A callable supplied by the authenticated operator, never a module path
    // or provider instruction taken from player content or a checkpoint.
    this.askResponder = typeof options.askResponder === 'function' ? options.askResponder : null;
    this.mode = this.askResponder ? 'collector-with-ask-adapter' : 'collector';
    this.checkpointPath = options.checkpointPath || process.env.ODM_NARRATOR_CHECKPOINT_PATH ||
      path.join(process.env.ODM_STATE_DIR || './state', `narrator-checkpoint-${this.campaignId || 'default'}.json`);
    this.costTracker = options.costTracker || new NarratorCostTracker({
      storagePath: path.join(path.dirname(this.checkpointPath), `narrator-cost-${this.campaignId || 'default'}.json`),
    });
    this.memory = new HostContextMemory({ campaignId: this.campaignId });
    this.lastSeq = 0;
    this.lastAskSeq = 0;
    this.answeredAsks = new Set();
    this.pendingAskCommands = new Map();
    this.running = false;
    this.polling = false;
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
    this.lastSeq = integer(saved.lastSeq, 0, 0, Number.MAX_SAFE_INTEGER);
    this.lastAskSeq = integer(saved.lastAskSeq, 0, 0, Number.MAX_SAFE_INTEGER);
    this.answeredAsks = new Set(Array.isArray(saved.answeredAsks) ? saved.answeredAsks.filter(id => typeof id === 'string').slice(-200) : []);
    for (const [askId, command] of Object.entries(saved.pendingAskCommands ?? {}).slice(-200)) {
      if (command?.campaignId === this.campaignId && command.askId === askId && typeof command.commandId === 'string') {
        this.pendingAskCommands.set(askId, command);
      }
    }
    if (saved.memory) this.memory.restoreState(saved.memory);
  }

  saveCheckpoint() {
    atomicWriteJson(this.checkpointPath, {
      version: 2, mode: this.mode, campaignId: this.campaignId, lastSeq: this.lastSeq, lastAskSeq: this.lastAskSeq,
      answeredAsks: Array.from(this.answeredAsks).slice(-200),
      pendingAskCommands: Object.fromEntries(Array.from(this.pendingAskCommands.entries()).slice(-200)),
      memory: this.memory.serializeState(), metrics: this.costTracker.getMetrics(), updatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), lastPollAt: this.lastPollAt || null,
      lastError: this.lastError ? 'poll_failed' : null,
    });
  }

  async callControl(action, params = {}, { timeoutMs = 15000 } = {}) {
    if (!this.token) throw new Error('Narrator authentication token is missing.');
    const response = await this.fetchImpl(this.controlUrl, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action, params }), signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || `Control returned HTTP ${response.status}`);
      error.status = response.status; error.code = body?.code;
      throw error;
    }
    if (!body || !Object.hasOwn(body, 'result')) throw new Error('Invalid control response.');
    return body.result;
  }

  resetForRewind() {
    this.lastSeq = 0; this.lastAskSeq = 0;
    this.answeredAsks.clear(); this.pendingAskCommands.clear();
    this.memory.reset({ campaignId: this.campaignId });
  }

  async connect() {
    if (!this.campaignId) throw new Error('Cannot connect narrator without campaignId.');
    const result = await this.callControl('narrator.connect', {
      campaignId: this.campaignId, paged: true, projection: 'live', maxBytes: this.readMaxBytes,
    });
    // A handshake's first byte/story page is NOT an acknowledgement of its
    // currentSeq. Re-read from the durable consumed cursor and drain fully.
    try { await this.drainStory(); }
    catch (error) {
      if (!cursorAhead(error)) throw error;
      this.resetForRewind(); await this.drainStory();
    }
    this.saveCheckpoint();
    return result;
  }

  async readSnapshot(params) {
    for (let attempt = 0; attempt <= this.readPageRetries; attempt++) {
      const pages = [], cursors = new Set();
      let pageCursor, bytes = 0;
      try {
        for (let page = 0; page < 1024; page++) {
          const result = await this.callControl('narrator.read', { ...params, paged: true, maxBytes: this.readMaxBytes,
            ...(pageCursor ? { pageCursor } : {}) });
          if (!result?.format) {
            if (pages.length || !result || typeof result !== 'object') throw new Error('Invalid narrator read response.');
            return result;
          }
          if (result.format !== 'odm.read.page.v1') throw new Error('Unsupported narrator read format.');
          bytes += Buffer.byteLength(JSON.stringify(result), 'utf8');
          if (bytes > MAX_READ_BYTES) throw new Error('Narrator read exceeds the host memory budget.');
          pages.push(result);
          if (result.complete) return assembleReadPages(pages);
          if (typeof result.nextPage !== 'string' || !result.nextPage || cursors.has(result.nextPage)) throw new Error('Narrator read page cursor did not advance.');
          cursors.add(result.nextPage); pageCursor = result.nextPage;
        }
        throw new Error('Narrator byte pages exceeded the safety limit.');
      } catch (error) {
        if (!cursorAhead(error) && error?.status === 409 && attempt < this.readPageRetries) continue;
        throw error;
      }
    }
    throw new Error('Narrator read retry budget exhausted.');
  }

  async drainStory() {
    const savedMemory = this.memory.serializeState();
    let cursor = this.lastSeq;
    try {
      for (let page = 0; page < 1000; page++) {
        const result = await this.readSnapshot({ campaignId: this.campaignId, afterSeq: cursor, limit: 50, projection: 'live' });
        const next = result?.nextCursor, current = result?.currentSeq;
        if (!Number.isSafeInteger(next) || !Number.isSafeInteger(current) || next < cursor || next > current ||
            typeof result.hasMore !== 'boolean' || (result.hasMore && next <= cursor) || (!result.hasMore && next !== current)) {
          throw new Error('Invalid story cursor progression.');
        }
        this.memory.ingestReadSnapshot(result);
        cursor = next;
        if (!result.hasMore) { this.lastSeq = cursor; return; }
      }
      throw new Error('Story stream exceeded the page safety limit.');
    } catch (error) {
      // A partial drain must not leave a compaction watermark ahead of the
      // durable cursor: retrying the page would then silently drop its data.
      this.memory.restoreState(savedMemory);
      throw error;
    }
  }

  async drainAskQueue() {
    let cursor = 0;
    for (let page = 0; page < 1000; page++) {
      const result = await this.readSnapshot({ campaignId: this.campaignId, afterSeq: this.lastSeq,
        afterAskSeq: cursor, askLimit: 20, limit: 1, projection: 'live' });
      for (const ask of result.asks ?? result.askQueue?.items ?? []) await this.handlePendingAsk(ask);
      const queue = result.askQueue ?? {}, next = queue.nextCursor ?? cursor;
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
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await this.drainStory(); await this.drainAskQueue(); break; }
        catch (error) {
          if (attempt || !cursorAhead(error)) throw error;
          this.resetForRewind();
        }
      }
      this.lastPollAt = Date.now(); this.lastError = null; this.saveCheckpoint();
      return true;
    } catch (error) {
      this.lastError = error;
      // Error text may itself contain private content returned by a provider.
      console.error('[narrator-runner] poll failed', { status: error?.status ?? null });
      this.saveCheckpoint();
      return false;
    } finally { this.polling = false; }
  }

  async handlePendingAsk(ask) {
    // Collector mode must not consume another external narrator's queue or
    // publish a fake rules answer. A pending command, however, is retried with
    // its original payload even if an optional adapter is temporarily absent.
    if (!ask?.id || this.answeredAsks.has(ask.id)) return;
    let command = this.pendingAskCommands.get(ask.id);
    if (!command && !this.askResponder) return;
    if (!command) {
      const locale = ask.locale || 'ru';
      const classification = classifyInput(ask.question || '', { locale, source: 'ask' });
      let reply;
      if (['safety_pause', 'decline', 'ignore_instruction', 'refuse_secret', 'clarify'].includes(classification.decision)) {
        reply = { answer: classification.replyText || DM_REFUSALS[locale] || DM_REFUSALS.ru, citations: [] };
      } else {
        reply = await this.askResponder(structuredClone(ask), this.memory.getPromptContext({ viewerUserId: ask.userId }));
      }
      if (reply == null) return;
      if (typeof reply.answer !== 'string' || !reply.answer.trim() || reply.answer.length > 4000 ||
          (reply.citations !== undefined && (!Array.isArray(reply.citations) || reply.citations.length > 50))) throw new Error('Invalid Ask adapter response.');
      // Usage is accepted only when reported by the real adapter. No guessed
      // prompt/completion tokens are recorded without an actual model call.
      if (reply.usage && Number.isSafeInteger(reply.usage.promptTokens) && Number.isSafeInteger(reply.usage.completionTokens) &&
          reply.usage.promptTokens >= 0 && reply.usage.completionTokens >= 0) this.costTracker.recordUsage(reply.usage);
      command = { campaignId: this.campaignId, askId: ask.id, answer: reply.answer, expectedVersion: ask.version ?? 0,
        commandId: crypto.randomUUID(), citations: reply.citations ?? [] };
      this.pendingAskCommands.set(ask.id, command); this.saveCheckpoint();
    }
    try {
      await this.callControl('narrator.answer_ask', command);
      this.answeredAsks.add(ask.id); this.pendingAskCommands.delete(ask.id); this.saveCheckpoint();
    } catch (error) {
      if (error.status !== 409) throw error;
      // A conflict is not proof that a still-pending question was answered.
      // Re-read its version next poll; only confirmed success is remembered.
      this.pendingAskCommands.delete(ask.id); this.saveCheckpoint();
    }
  }

  startHealthServer() {
    if (!this.healthPort || this.healthServer) return;
    this.healthServer = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
      if (url.pathname === '/healthz') {
        response.end(JSON.stringify({ ok: true, status: this.lastError ? 'degraded' : 'healthy', mode: this.mode, uptime: process.uptime() }));
      } else if (url.pathname === '/status') {
        if (this.statusToken && !crypto.timingSafeEqual(hash(request.headers.authorization ?? ''), hash(`Bearer ${this.statusToken}`))) {
          response.writeHead(401); response.end(JSON.stringify({ error: 'Unauthorized' })); return;
        }
        response.end(JSON.stringify({ ok: true, status: 'running', mode: this.mode, campaignId: this.campaignId,
          lastSeq: this.lastSeq, lastAskSeq: this.lastAskSeq, answeredAsksCount: this.answeredAsks.size,
          pendingAskCommandsCount: this.pendingAskCommands.size, lastPollAt: this.lastPollAt || null,
          lastError: this.lastError ? 'poll_failed' : null, metrics: this.costTracker.getMetrics(),
          memory: this.memory.serializeState({ safe: true }), uptime: process.uptime() }));
      } else { response.writeHead(404); response.end(JSON.stringify({ error: 'Not found' })); }
    });
    this.healthServer.listen(this.healthPort, '127.0.0.1');
  }

  async start() {
    this.loadCheckpoint(); this.startHealthServer(); this.running = true;
    try { await this.connect(); }
    catch { console.warn('[narrator-runner] Initial connect failed; collector will retry.'); }
    const schedule = () => {
      if (!this.running) return;
      this.timer = setTimeout(async () => { await this.pollTick(); schedule(); }, this.pollIntervalMs);
    };
    schedule();
  }
  async stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.saveCheckpoint();
    if (this.healthServer) { await new Promise(resolve => this.healthServer.close(resolve)); this.healthServer = null; }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let campaignId = '', once = false, port;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--campaign' && args[index + 1]) campaignId = args[++index];
    else if (args[index] === '--port' && args[index + 1]) port = Number(args[++index]);
    else if (args[index] === '--once') once = true;
  }
  const runner = new NarratorRunner({ campaignId, healthPort: port });
  const shutdown = async () => { await runner.stop(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  if (once) {
    runner.loadCheckpoint();
    try {
      await runner.connect();
      const ok = await runner.pollTick(); runner.saveCheckpoint();
      process.exit(ok ? 0 : 1);
    } catch { console.error('[narrator-runner] Collector once failed.'); process.exit(1); }
  } else runner.start().catch(() => { console.error('[narrator-runner] Collector start failed.'); process.exit(1); });
}
