// SYNTHETIC: controlled model and fake CAS engine; not a server or model latency claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compactRolePacket } from '../narrator/role-packet.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';
import { atomicWriteJson } from '../narrator/checkpoint-io.mjs';

const input = { id: 'm1', seq: 4, authorType: 'player', userId: 'u1', characterId: 'c1', content: 'I inspect the lock.' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
const summary = values => { const sorted = [...values].sort((a, b) => a - b); return { p50Ms: +percentile(sorted, .5).toFixed(4), p95Ms: +percentile(sorted, .95).toFixed(4) }; };
const packet = (sheets, current) => ({ input, campaign: { scene: 'Synthetic vault', party: current ? { location: 'Synthetic vault' } : undefined, gameSettings: { language: 'en' } },
  public: { scene: 'Synthetic vault', messages: [input, { ...input, id: 'm0', seq: 3, content: 'Earlier.' }] },
  state: { sheets: Array.from({ length: sheets }, (_, index) => ({ id: `c${index}`, portrait: { image: 'x'.repeat(4096) }, hp: 10, mechanics: { slots: 2 } })),
    members: current ? [{ userId: 'u1', role: 'player' }] : undefined, facts: Array.from({ length: 30 }, (_, index) => ({ id: index, fact: 'Synthetic fact '.repeat(30) })) }, actions: [{ name: 'request_roll' }] });

async function baselineHelper() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-baseline-'));
  try {
    for (const file of ['role-packet.mjs', 'orchestration.mjs', 'read-session.mjs', 'checkpoint-io.mjs']) {
      fs.writeFileSync(path.join(directory, file), execFileSync('git', ['show', `7aa73c4:narrator/${file}`], { cwd: root }));
    }
    return {
      ...(await import(pathToFileURL(path.join(directory, 'role-packet.mjs')).href)),
      ...(await import(pathToFileURL(path.join(directory, 'orchestration.mjs')).href)),
      ...(await import(pathToFileURL(path.join(directory, 'checkpoint-io.mjs')).href)),
    };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function comparable(value) {
  const copy = structuredClone(value);
  delete copy.campaign?.party; delete copy.state?.members; delete copy.public?.scene;
  return copy;
}
function measurePacket(name, helper, value, role = 'referee') {
  const samples = [];
  let bytes = 0;
  for (let index = 0; index < 20; index++) JSON.stringify(helper(role, value));
  for (let index = 0; index < 100; index++) {
    const started = performance.now(), json = JSON.stringify(helper(role, value));
    samples.push(performance.now() - started); bytes = Buffer.byteLength(json);
  }
  return { name, warmup: 20, samples: 100, ...summary(samples), bytes };
}

export async function runSyntheticScenario(kind, { omitNarration = false, staleCas = false,
  Orchestrator = NarratorOrchestrator, writeCheckpoint = atomicWriteJson } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odm-turn-bench-'));
  const epoch = 'b'.repeat(64), timings = [], counts = { modelCalls: 0, modelInputBytes: 0, modelOutputBytes: 0,
    mcpCalls: 0, mcpRequestBytes: 0, mcpResponseBytes: 0, checkpointAttempts: 0, checkpointWrites: 0, fsyncCalls: 0, fsyncMs: 0,
    rag: 0, embedding: 0, reranker: 0, dbLoads: 0 };
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = function(...args) { const started = performance.now(); try { return originalFsync.apply(this, args); } finally { counts.fsyncCalls++; counts.fsyncMs += performance.now() - started; } };
  try {
    for (let repeat = -3; repeat < 20; repeat++) {
      if (repeat === 0) for (const key of Object.keys(counts)) counts[key] = 0;
      const turnInput = kind === 'speech' ? { ...input, content: 'Good morning.' } : input;
      let snapshot = { timelineEpoch: epoch, currentSeq: 4, nextCursor: 4, hasMore: false, cursor: 0, spatial: { enabled: false },
        campaign: { id: 'synthetic', scene: 'Synthetic vault', gameSettings: {} }, messages: [turnInput], events: [], pendingRolls: [], sheets: [], facts: [], notes: [], npcs: [] };
      const replies = kind === 'speech' ? [{ kind: 'narrate', text: 'The guard returns the greeting.', writer: false }] : [
        { kind: 'invoke', action: 'request_roll', args: { characterId: 'c1', kind: 'skill_check', skill: 'investigation', dc: 12 } },
        { kind: 'narrate', text: 'The tumblers answer.', writer: false }];
      let controller;
      const memory = { getPromptContext: () => ({ summary: '' }), serializeState: () => ({}), restoreState() {}, ingestReadSnapshot() {} };
      const host = { campaignId: 'synthetic', timelineEpoch: epoch, lastSeq: 4, memory, readMaxBytes: 65536, storyController: null,
        saveCheckpoint() {
          counts.checkpointAttempts++;
          const result = writeCheckpoint(path.join(directory, `checkpoint-${repeat}.json`), { formatVersion: 3, memory: {}, controller: controller.serialize(), repeat, mcp: counts.mcpCalls });
          if (result.written) counts.checkpointWrites++;
        },
        async callControl(action, params) {
          counts.mcpCalls++; counts.mcpRequestBytes += Buffer.byteLength(JSON.stringify({ action, params }));
          let response;
          if (action === 'narrator.catalog') response = { groups: [{ actions: [{ name: 'request_roll' }] }] };
          else if (action === 'narrator.read') {
            response = { ...structuredClone(snapshot), cursor: params.afterSeq, messages: [] };
            host.lastSeq = response.nextCursor;
          }
          else {
            if (staleCas || params.expectedSeq !== snapshot.currentSeq || params.timelineEpoch !== epoch) throw new Error('synthetic CAS rejected stale command');
            const previous = snapshot.currentSeq; snapshot.currentSeq++; snapshot.nextCursor = snapshot.currentSeq;
            if (action === 'narrator.invoke') snapshot.pendingRolls = [{ id: `pending-${repeat}`, characterId: 'c1' }];
            const state = { ...structuredClone(snapshot), cursor: host.lastSeq, messages: [], recentMessages: [] };
            response = { commandId: params.commandId, committedSeq: snapshot.currentSeq, result: action === 'narrator.invoke' ? { parked: true } : { messageId: `n-${repeat}` },
              readAfter: { ...params.readAfter, campaignId: host.campaignId, timelineEpoch: epoch }, state };
            assert.equal(state.cursor, host.lastSeq, 'attached read must start at the acknowledged cursor');
            assert.ok(state.cursor <= previous, 'attached read cannot start after the command cursor');
          }
          counts.mcpResponseBytes += Buffer.byteLength(JSON.stringify(response)); return response;
        },
        async drainStory(options = {}) {
          return host.callControl('narrator.read', { campaignId: host.campaignId, afterSeq: host.lastSeq,
            projection: options.full ? 'full' : 'live' });
        } };
      controller = new Orchestrator({ adapter: { generate: async (_role, prompt) => {
        counts.modelCalls++; counts.modelInputBytes += Buffer.byteLength(prompt);
        const reply = replies.shift(); if (!reply || omitNarration && reply.kind === 'narrate') return JSON.stringify({ kind: 'wait' });
        const response = JSON.stringify(reply); counts.modelOutputBytes += Buffer.byteLength(response); return response;
      } } });
      host.storyController = controller;
      const started = performance.now();
      await controller.tick(host, structuredClone(snapshot));
      if (kind === 'mechanical') {
        assert.equal(snapshot.pendingRolls.length, 1, 'mechanical scenario must park an authoritative roll');
        snapshot.pendingRolls = []; snapshot.currentSeq++; snapshot.nextCursor = snapshot.currentSeq;
        snapshot.events.push({ seq: snapshot.currentSeq, type: 'roll_result', payload: { pendingRollId: `pending-${repeat}`, roll: { id: `roll-${repeat}`, visibility: 'public', total: 15, dc: 12 } } });
        await controller.tick(host, structuredClone(snapshot));
      }
      if (controller.state.handledSeq !== input.seq) throw new Error(`Synthetic ${kind} turn did not narrate and finish.`);
      if (repeat >= 0) timings.push(performance.now() - started);
    }
    const expectedModelCalls = kind === 'speech' ? 20 : 40;
    assert.equal(counts.modelCalls, expectedModelCalls, 'measured model calls must match complete turns');
    return { scenario: kind, warmup: 3, repetitions: 20, ...summary(timings), counts, stubbed: ['rag', 'embedding', 'reranker', 'dbLoads'],
      note: 'Fresh host/catalog per turn; controlled model, fake CAS and physical-roll result; real fsync. No provider or server latency.' };
  } finally { fs.fsyncSync = originalFsync; fs.rmSync(directory, { recursive: true, force: true }); }
}

export async function benchmark() {
  const baseline = await baselineHelper();
  const packetRows = [4, 8].map(sheets => {
    const beforePacket = packet(sheets, false), afterPacket = packet(sheets, true);
    const beforeOutput = baseline.compactRolePacket('referee', beforePacket), afterOutput = compactRolePacket('referee', afterPacket);
    assert.deepEqual(comparable(afterOutput), comparable(beforeOutput), 'packet helpers changed data beyond documented duplicate/correctness fields');
    return { sheets, before: measurePacket('baseline-7aa73c4', baseline.compactRolePacket, beforePacket), after: measurePacket('current-with-party-members', compactRolePacket, afterPacket) };
  });
  const turns = [];
  for (const kind of ['speech', 'mechanical']) turns.push({ scenario: kind,
    before: await runSyntheticScenario(kind, { Orchestrator: baseline.NarratorOrchestrator, writeCheckpoint: baseline.atomicWriteJson }),
    after: await runSyntheticScenario(kind) });
  const prose = { input, language: 'en', unitSystem: 'metric', scene: 'Synthetic vault',
    messages: [input, { ...input, id: 'earlier', seq: 3, content: 'Earlier speech.' }], approvedDraft: 'The guard returns the greeting.' };
  return { kind: 'SYNTHETIC', generatedAt: new Date().toISOString(), node: process.version, packetRows,
    writerPacket: { before: measurePacket('baseline-7aa73c4', baseline.compactRolePacket, prose, 'writer'),
      after: measurePacket('current', compactRolePacket, prose, 'writer') }, turns };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await benchmark();
  if (process.argv.includes('--write')) fs.writeFileSync(new URL('../docs/performance/packet-turns.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
