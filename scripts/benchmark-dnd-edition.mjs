import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BoundaryMaintenance, buildContext, routeDecision, ScopedRag, selectTools } from '../narrator/dnd-edition.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';

const epoch = 'e'.repeat(64);
const catalog = [{ actions: ['request_roll', 'pc_attack', 'start_encounter', 'end_turn', 'delete_campaign'] }];
const fixtures = [
  { name: 'simple_npc', kind: 'say', content: 'Ask the innkeeper about work.' },
  { name: 'exploration', kind: 'do', content: 'Search the ruined desk.' },
  { name: 'attack', kind: 'do', content: 'Attack the goblin.', snapshot: { encounter: { active: true } } },
  { name: 'old_npc_small_rag', kind: 'say', content: 'What did old Mara promise?', rag: 'ok' },
  { name: 'large_recall_compression', kind: 'say', content: 'Recall the argument.', snapshot: { messages: Array.from({ length: 80 }, (_, seq) => ({ seq, authorType: 'player', content: `memory ${seq}` })) } },
  { name: 'three_room_split', kind: 'do', content: 'Open the vault.', roomId: 'a', witnesses: ['u'], snapshot: { spatial: { enabled: true }, spatialRooms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
  { name: 'secret_invisible', kind: 'do', content: 'Look around.', roomId: 'a', witnesses: ['u'], snapshot: { spatial: { enabled: true }, messages: [{ seq: 1, roomId: 'a', witnessUserIds: ['other'], authorType: 'player', content: 'SECRET_SENTINEL' }] } },
  { name: 'private_ask', kind: 'ask', content: 'What do only I know?', privacyScope: 'audience:u', private: true },
  { name: 'rag_unavailable', kind: 'say', content: 'Recall unavailable lore.', rag: 'unavailable' },
  { name: 'provider_timeout_no_duplicate_mutation', kind: 'do', content: 'Inspect the lock.', mutationRetry: true },
  { name: 'long_campaign_bounded_context', kind: 'say', content: 'Continue.', snapshot: { messages: Array.from({ length: 400 }, (_, seq) => ({ seq, authorType: 'player', content: 'x'.repeat(300) })) } },
  { name: 'chapter_boundary', kind: 'say', content: 'Begin the next chapter.', boundary: true },
];

async function mutationRetryInvariant() {
  const commandIds = [], snapshot = { campaign: { id: 'benchmark', gameSettings: {} }, timelineEpoch: epoch, currentSeq: 2, nextCursor: 2, hasMore: false,
    messages: [{ seq: 2, authorType: 'player', content: 'Inspect the lock.' }], sheets: [], events: [], pendingRolls: [] };
  const controller = new NarratorOrchestrator({ dndEdition: true, adapter: { async generate() { return JSON.stringify({ kind: 'invoke', action: 'request_roll', args: { characterId: 'hero', skill: 'investigation', dc: 12 } }); } } });
  const host = { campaignId: 'benchmark', saveCheckpoint() {}, async drainStory() { return snapshot; }, async callControl(action, params) {
    if (action === 'narrator.catalog') return { groups: [{ actions: [{ name: 'request_roll' }] }] };
    commandIds.push(params.commandId); throw Object.assign(new Error('timeout'), { status: 503 });
  } };
  await controller.tick(host, snapshot).catch(() => {});
  await controller.tick(host, snapshot);
  await controller.tick(host, snapshot);
  assert.equal(commandIds.length, 2); assert.equal(commandIds[0], commandIds[1]); assert.equal(controller.state.paused, 'ambiguous_write');
  return { attempts: commandIds.length, stableCommandId: true, paused: controller.state.paused };
}

async function replay(item, index) {
  const started = performance.now();
  const input = { seq: index + 1, kind: item.kind, content: item.content, ...(item.roomId ? { roomId: item.roomId, witnessUserIds: item.witnesses, userId: item.witnesses?.[0] } : {}), ...(item.private ? { private: true } : {}) };
  const snapshot = { campaign: { id: 'benchmark', scene: 'test', gameSettings: {} }, messages: [], ...item.snapshot };
  const privacyScope = item.privacyScope ?? (item.roomId ? `audience:${item.witnesses.join(',')}` : 'public');
  const route = routeDecision({ input, snapshot, privacyScope });
  let rag = { chunks: [], reason: 'not_needed' };
  if (item.rag) {
    const scoped = new ScopedRag({ retriever: item.rag === 'unavailable' ? async () => { throw new Error('offline'); } : async () => [{ id: 'mara', text: 'Mara promised a safe road.', visibilityScope: privacyScope }] });
    rag = await scoped.retrieve({ campaignId: 'benchmark', query: item.content, visibilityScope: privacyScope, privateInput: item.private });
  }
  const context = buildContext({ input, snapshot, rag: rag.chunks });
  const tools = selectTools({ input, snapshot, catalog });
  const invariants = [Buffer.byteLength(JSON.stringify(context)) <= 48_000, !tools.includes('delete_campaign')];
  const details = {};
  if (item.name === 'three_room_split') invariants.push(route.reason === 'party_split' && route.effort === 'high');
  if (item.name === 'secret_invisible') invariants.push(!JSON.stringify(context).includes('SECRET_SENTINEL'));
  if (item.name === 'private_ask') invariants.push(route.effort === 'high' && route.privacyScope === 'audience:u');
  if (item.rag === 'ok') invariants.push(rag.reason === 'ok' && rag.chunks.length === 1);
  if (item.rag === 'unavailable') invariants.push(rag.reason === 'unavailable' && rag.evidenceGap === true);
  if (item.mutationRetry) Object.assign(details, await mutationRetryInvariant());
  if (item.boundary) {
    let memory = 0, planner = 0; const maintenance = new BoundaryMaintenance({ scene: 'one', chapter: 'one' });
    await maintenance.update({ sceneRevision: 'two', chapterRevision: 'two', context: {}, memory: async () => memory++, planner: async () => { planner++; return null; } });
    invariants.push(memory === 1 && planner === 1); Object.assign(details, { memoryCalls: memory, plannerCalls: planner });
  }
  assert.ok(invariants.every(Boolean), `${item.name} invariant failed`);
  const contextBytes = Buffer.byteLength(JSON.stringify(context));
  const baselineBytes = Buffer.byteLength(JSON.stringify({ input, snapshot, catalog }));
  return { name: item.name, route: { effort: route.effort, reason: route.reason }, contextBytes, baselineBytes,
    estimatedInputTokens: Math.ceil(contextBytes / 4), providerOutputTokens: null, providerTtftMs: null, providerInferenceMs: null,
    tools, rag: rag.reason, invariantChecks: invariants.length, passed: true, wallMs: performance.now() - started, ...details };
}

const results = [];
for (const [index, item] of fixtures.entries()) results.push(await replay(item, index));
const timings = results.map(result => result.wallMs).sort((a, b) => a - b);
const percentile = value => timings[Math.min(timings.length - 1, Math.ceil(timings.length * value) - 1)];
const report = {
  generatedAt: new Date().toISOString(), provider: 'none', measurement: 'deterministic zero-provider replay',
  metrics: { cases: results.length, invariantsPassed: results.every(result => result.passed), wallTimeMs: { p50: percentile(.5), p95: percentile(.95) },
    tokenFields: 'input estimates use context JSON bytes / 4; provider output, TTFT, inference latency and cost were not measured' },
  baseline: { structural: 'input + unbounded snapshot + full catalog JSON bytes' }, dndEdition: results,
};
const target = path.resolve('reports/dnd-edition-benchmark.json');
fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
console.log(target); console.log(JSON.stringify(report.metrics));
