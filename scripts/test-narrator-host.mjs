import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NarratorRunner } from '../narrator/run.mjs';
import { NarratorCostTracker } from '../narrator/cost-tracker.mjs';
import { readJsonSafe } from '../narrator/checkpoint-io.mjs';
import { budgetRead } from '../src/lib/mcp-read-budget.mjs';

async function tempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('M10: Narrator runner lifecycle, checkpoint recovery, and health endpoint', () => tempDir(async dir => {
  const checkpointPath = path.join(dir, 'checkpoint.json');
  let receivedActions = [];
  let currentSeq = 15;
  let pendingAsks = [
    { id: 'ask-1', userId: 'player', queueSeq: 1, question: 'Напиши мне торгового бота на Python.', locale: 'ru', version: 0 },
    { id: 'ask-2', userId: 'player', queueSeq: 2, question: 'Какое среднее значение 2d6 урона?', locale: 'ru', version: 0 },
  ];

  // Mock control API server
  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body);
      receivedActions.push(data);

      if (data.action === 'narrator.connect') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { currentSeq, campaignId: 'c_test' } }));
      } else if (data.action === 'narrator.read') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: {
            currentSeq, nextCursor: currentSeq, hasMore: false,
            asks: pendingAsks,
            askQueue: {
              pending: pendingAsks.length > 0,
              items: pendingAsks,
              nextCursor: pendingAsks.length,
              hasMore: false,
            },
          },
        }));
      } else if (data.action === 'narrator.answer_ask') {
        // Remove answered ask from queue
        pendingAsks = pendingAsks.filter(a => a.id !== data.params.askId);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { askId: data.params.askId, version: 1, replayed: false } }));
      } else {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Unknown action' }));
      }
    });
  });

  const controlPort = await new Promise(resolve => {
    mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port));
  });

  const healthPort = 39871;
  let runner;
  try {
    // 1. Initial runner run
    runner = new NarratorRunner({
      campaignId: 'c_test',
      controlUrl: `http://127.0.0.1:${controlPort}`,
      token: 'test-token-1234567890123456789012',
      checkpointPath,
      healthPort,
      pollIntervalMs: 100,
      maxAsksPerTick: 2,
      askResponder: async () => ({ answer: 'Test rules answer.', citations: [] }),
    });

    runner.startHealthServer();

    // Verify health endpoint
    const healthRes = await fetch(`http://127.0.0.1:${healthPort}/healthz`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.status, 'healthy');

    // Perform initial connect
    await runner.connect();
    assert.equal(runner.lastSeq, 15);

    // Perform one poll tick
    await runner.pollTick();

    // Verify both asks were handled:
    // Ask 1 should be refused as out-of-scope coding
    const ans1 = receivedActions.find(a => a.action === 'narrator.answer_ask' && a.params.askId === 'ask-1');
    assert.ok(ans1, 'Ask-1 was not answered');
    assert.ok(ans1.params.answer.includes('Я отвечаю на вопросы по D&D'), 'Ask-1 did not receive D&D policy refusal');

    // Ask 2 should be answered as in-scope game question
    const ans2 = receivedActions.find(a => a.action === 'narrator.answer_ask' && a.params.askId === 'ask-2');
    assert.ok(ans2, 'Ask-2 was not answered');
    assert.equal(ans2.params.answer, 'Test rules answer.', 'Ask-2 must receive the explicit test adapter answer');

    // Checkpoint must exist on disk and record sequence
    assert.ok(fs.existsSync(checkpointPath));
    const cpData = readJsonSafe(checkpointPath);
    assert.equal(cpData.campaignId, 'c_test');
    assert.equal(cpData.lastSeq, 15);
    assert.equal(cpData.answeredAsks.length, 2);

    // Verify status endpoint
    const statusRes = await fetch(`http://127.0.0.1:${healthPort}/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.status, 'running');
    assert.equal(statusJson.answeredAsksCount, 2);

    // Stop runner
    await runner.stop();

    // 2. Crash recovery: create new runner instance pointing to same checkpoint
    const recoveredRunner = new NarratorRunner({
      campaignId: 'c_test',
      controlUrl: `http://127.0.0.1:${controlPort}`,
      token: 'test-token-1234567890123456789012',
      checkpointPath,
      healthPort: 0, // disable health port for recovered runner
    });

    recoveredRunner.loadCheckpoint();
    assert.equal(recoveredRunner.lastSeq, 15);
    assert.equal(recoveredRunner.answeredAsks.has('ask-1'), true);
    assert.equal(recoveredRunner.answeredAsks.has('ask-2'), true);

    // Even if mock server returns ask-1 again, runner should skip it because it was already answered
    pendingAsks = [{ id: 'ask-1', question: 'repeat', version: 0 }];
    const actionsBefore = receivedActions.length;
    await recoveredRunner.pollTick();
    const newAnswers = receivedActions.slice(actionsBefore).filter(a => a.action === 'narrator.answer_ask');
    assert.equal(newAnswers.length, 0, 'Re-answered an already completed ask');
  } finally {
    await runner?.stop();
    mockServer.closeAllConnections();
    mockServer.close();
  }
}));

test('M11: Narrator cost tracker enforces daily and hourly limits', () => tempDir(dir => {
  const tracker = new NarratorCostTracker({
    storagePath: path.join(dir, 'cost.json'),
    hourlyTokenLimit: 10_000,
    dailyTokenLimit: 20_000,
    dailyCostLimitUsd: 1.00,
  });

  // Check within budget
  let check = tracker.checkBudget(2000);
  assert.equal(check.allowed, true);

  // Record usage
  tracker.recordUsage({ promptTokens: 4000, completionTokens: 5000 });
  assert.equal(tracker.state.hourTokens, 9000);
  assert.equal(tracker.state.dayTokens, 9000);

  // Hourly limit check
  check = tracker.checkBudget(2000);
  assert.equal(check.allowed, false);
  assert.ok(check.reason.includes('Hourly token quota exceeded'));

  // Metrics report
  const metrics = tracker.getMetrics();
  assert.equal(metrics.hourTokens, 9000);
  assert.equal(metrics.hourlyTokenLimit, 10_000);
}));

test('M10: narratorctl.py CLI parses status and checkpoint under isolated root', () => tempDir(dir => {
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const cpPath = path.join(stateDir, 'narrator-checkpoint-c_test.json');
  fs.writeFileSync(cpPath, JSON.stringify({ campaignId: 'c_test', lastSeq: 42, lastAskSeq: 10 }), 'utf8');

  const proc = spawnSync('python3', [
    path.join(process.cwd(), 'deploy/narratorctl.py'),
    'checkpoint',
    '--root', dir,
    '--campaign', 'c_test',
  ], { encoding: 'utf8' });

  assert.equal(proc.status, 0);
  const data = JSON.parse(proc.stdout);
  assert.equal(data.campaignId, 'c_test');
  assert.equal(data.lastSeq, 42);

  const statusProc = spawnSync('python3', [
    path.join(process.cwd(), 'deploy/narratorctl.py'),
    'status',
    '--root', dir,
    '--campaign', 'c_test',
  ], { encoding: 'utf8' });

  assert.equal(statusProc.status, 0);
  const statusData = JSON.parse(statusProc.stdout);
  assert.equal(statusData.campaign_id, 'c_test');
  assert.equal(statusData.checkpoint_exists, true);
}));

test('M10: runner drains independent Ask pages and resumes the nested connect state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-pages-'));
  const actions = [];
  const asks = [
    { id: '00000000-0000-4000-8000-000000000001', userId: 'player', question: 'Напиши мне торгового бота', locale: 'ru', version: 0, queueSeq: 1 },
    { id: '00000000-0000-4000-8000-000000000002', userId: 'player', question: 'Как работает уклонение?', locale: 'ru', version: 0, queueSeq: 2 },
  ];
  try {
    const runner = new NarratorRunner({
      campaignId: 'c_pages',
      maxAsksPerTick: 2,
      askResponder: async () => ({ answer: 'Test rules answer.', citations: [] }),
      token: 'test-token-1234567890123456789012',
      checkpointPath: path.join(dir, 'checkpoint.json'),
      healthPort: 0,
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body);
        actions.push(request);
        if (request.action === 'narrator.connect') {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: { state: { currentSeq: 7, sheets: [] } } }) };
        }
        if (request.action === 'narrator.answer_ask') {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: { replayed: false } }) };
        }
        if (request.action === 'narrator.read') {
          const cursor = request.params.afterAskSeq ?? 0;
          const item = cursor === 0 ? asks[0] : asks[1];
          const last = cursor !== 0;
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ ok: true, result: {
              currentSeq: 7,
              nextCursor: 7,
              hasMore: false,
              asks: [item],
              askQueue: { pending: true, nextCursor: last ? 2 : 1, hasMore: !last },
            } }),
          };
        }
        throw new Error(`unexpected action ${request.action}`);
      },
    });

    await runner.connect();
    assert.equal(runner.lastSeq, 7, 'connect must read the nested state.currentSeq');
    assert.equal(await runner.pollTick(), true);
    const reads = actions.filter((entry) => entry.action === 'narrator.read');
    assert.deepEqual(
      reads.filter((entry) => Object.hasOwn(entry.params, 'afterAskSeq')).map((entry) => entry.params.afterAskSeq),
      [0, 1], // The private Ask worker owns its own scoped read cursor.
    );
    const answers = actions.filter((entry) => entry.action === 'narrator.answer_ask');
    assert.equal(answers.length, 2);
    assert.match(answers[0].params.commandId, /^[0-9a-f-]{36}$/i);
    assert.equal(runner.lastAskSeq, 0, 'bounded Ask worker does not acknowledge a global queue watermark');
    assert.equal(runner.answeredAsks.size, 2, 'individual answers are durably acknowledged instead');
    assert.equal(runner.lastSeq, 7);
    assert.equal(runner.pendingAskCommands.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M10: an Ask timeout replays the exact persisted command', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-retry-'));
  const answerRequests = [];
  let firstAnswer = true;
  const ask = { id: '00000000-0000-4000-8000-000000000005', userId: 'player', question: 'Как работает уклонение?', locale: 'ru', version: 0, queueSeq: 5 };
  try {
    const runner = new NarratorRunner({
      campaignId: 'c_retry',
      askResponder: async () => ({ answer: 'Test rules answer.', citations: [] }),
      token: 'test-token-1234567890123456789012',
      checkpointPath: path.join(dir, 'checkpoint.json'),
      healthPort: 0,
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.action === 'narrator.answer_ask') {
          answerRequests.push(request.params);
          if (firstAnswer) {
            firstAnswer = false;
            throw new Error('simulated transport timeout after commit');
          }
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: { replayed: true } }) };
        }
        if (request.action === 'narrator.read') {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: {
            currentSeq: 1, nextCursor: 1, hasMore: false, asks: [ask],
            askQueue: { pending: true, nextCursor: 5, hasMore: false },
          } }) };
        }
        if (request.action === 'narrator.connect') {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: { currentSeq: 1 } }) };
        }
        throw new Error(`unexpected action ${request.action}`);
      },
    });

    assert.equal(await runner.pollTick(), false);
    assert.equal(runner.pendingAskCommands.size, 1);
    const saved = readJsonSafe(path.join(dir, 'checkpoint.json'));
    assert.equal(saved.pendingAskCommands[ask.id].commandId, runner.pendingAskCommands.get(ask.id).commandId);

    assert.equal(await runner.pollTick(), true);
    assert.equal(answerRequests.length, 2);
    assert.equal(answerRequests[0].commandId, answerRequests[1].commandId);
    assert.equal(answerRequests[0].answer, answerRequests[1].answer);
    assert.equal(runner.answeredAsks.has(ask.id), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M10: paged reads are assembled and a changed hash restarts the page', async () => {
  const state = {
    campaignId: 'c_paged',
    currentSeq: 9,
    nextCursor: 9,
    hasMore: false,
    recentMessages: Array.from({ length: 80 }, (_, index) => ({ id: String(index), content: 'x'.repeat(120) })),
  };
  let conflict = true;
  const readRequests = [];
  const runner = new NarratorRunner({
    campaignId: 'c_paged',
    token: 'test-token-1234567890123456789012',
    healthPort: 0,
    readMaxBytes: 4096,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (request.action !== 'narrator.read') throw new Error(`unexpected action ${request.action}`);
      readRequests.push(request.params);
      if (request.params.pageCursor && conflict) {
        conflict = false;
        return { ok: false, status: 409, headers: new Headers(), json: async () => ({ ok: false, error: 'snapshot changed' }) };
      }
      const page = budgetRead(state, {
        paged: true,
        maxBytes: request.params.maxBytes,
        ...(request.params.pageCursor ? { pageCursor: request.params.pageCursor } : {}),
      });
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true, result: page }) };
    },
  });

  const result = await runner.readSnapshot({ campaignId: 'c_paged', afterSeq: 0, limit: 50, projection: 'full' });
  assert.equal(result.recentMessages.length, 80);
  assert.ok(readRequests.some((params) => params.pageCursor), 'the test must exercise a second page');
  const firstRestart = readRequests.findIndex((params) => params.pageCursor);
  assert.equal(readRequests[firstRestart + 1].pageCursor, undefined, '409 must restart without the old cursor');
});
