import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoundaryMaintenance, buildContext, PLANNER_FIELDS, routeDecision, ScopedRag, selectTools, TurnTelemetry } from '../narrator/dnd-edition.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';
import { OpenCodeAdapter } from '../narrator/opencode-adapter.mjs';
import { createNarratorAdapter } from '../narrator/local-role-adapter.mjs';

test('D&D routing keeps normal and combat medium, gates high and max', () => {
  assert.equal(routeDecision({ input: { content: 'I attack.' } }).effort, 'medium');
  assert.equal(routeDecision({ input: { roomId: 'vault', content: 'I hide.' }, privacyScope: 'room:vault' }).effort, 'high');
  assert.equal(routeDecision({ input: { roomId: 'vault' }, snapshot: { spatial: { enabled: true }, spatialRooms: [{ id: 'vault' }, { id: 'hall' }] }, privacyScope: 'room:vault' }).reason, 'party_split');
  assert.equal(routeDecision({ input: { roomId: 'vault' }, privacyScope: 'room:vault', reasoningFailed: true }).effort, 'high');
  assert.equal(routeDecision({ input: { roomId: 'vault' }, privacyScope: 'room:vault', reasoningFailed: true, exceptionalGate: true }).effort, 'max');
});

test('tool catalog is bounded and contains no admin or coding operations', () => {
  const catalog = [{ actions: ['request_roll', 'pc_attack', 'delete_campaign', 'write_file', 'end_turn'] }];
  assert.deepEqual(selectTools({ input: { content: 'I attack' }, snapshot: { encounter: { active: true } }, catalog }), ['pc_attack', 'request_roll', 'end_turn']);
});

test('RAG no-ops when current context answers, caches and isolates campaign/privacy', async () => {
  let calls = 0; const rag = new ScopedRag({ retriever: async ({ campaignId, visibilityScope }) => { calls++; return [{ id: `${campaignId}-${visibilityScope}`, text: 'old NPC', visibilityScope }]; } });
  assert.equal((await rag.retrieve({ campaignId: 'a', query: 'old npc', activeContext: 'old npc' })).reason, 'not_needed');
  const first = await rag.retrieve({ campaignId: 'a', query: 'old npc', visibilityScope: 'public' });
  const cached = await rag.retrieve({ campaignId: 'a', query: 'old npc', visibilityScope: 'public' });
  await rag.retrieve({ campaignId: 'b', query: 'old npc', visibilityScope: 'public' });
  await rag.retrieve({ campaignId: 'a', query: 'old npc', visibilityScope: 'audience:u', privateInput: true });
  assert.equal(first.chunks.length, 1); assert.equal(cached.cached, true); assert.equal(calls, 3);
  assert.equal((await rag.retrieve({ campaignId: 'a', query: 'secret', privateInput: true })).reason, 'private_scope_required');
});

test('RAG applies one total byte budget after exact scope filtering', async () => {
  const rag = new ScopedRag({ config: { maxBytes: 9000 }, retriever: async () => [
    { id: 'wrong', text: 'secret', visibilityScope: 'audience:other' },
    { id: 'one', text: 'a'.repeat(8000), visibilityScope: 'public' },
    { id: 'two', text: 'b'.repeat(8000), visibilityScope: 'public' },
  ] });
  const result = await rag.retrieve({ campaignId: 'a', query: 'history', visibilityScope: 'public' });
  assert.equal(result.chunks.some(chunk => chunk.id === 'wrong'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(result.chunks)) <= 9000);
});

test('context keeps rooms and asks out of public packets and reports omissions', () => {
  const packet = buildContext({ input: { seq: 4, content: 'look', roomId: 'red', userId: 'u', witnessUserIds: ['u'] }, budgetBytes: 650,
    snapshot: { campaign: { id: 'c' }, messages: [{ seq: 1, roomId: 'blue', content: 'SECRET', authorType: 'player' }, { seq: 2, roomId: 'red', witnessUserIds: ['u'], content: 'seen', authorType: 'player' }, { seq: 3, roomId: 'red', witnessUserIds: ['x'], content: 'not seen', authorType: 'player' }], asks: [{ question: 'private ask' }] } });
  assert.match(JSON.stringify(packet), /seen/); assert.doesNotMatch(JSON.stringify(packet), /SECRET|not seen|private ask/); assert.equal(packet.scope, 'room:red');
  const missingAudience = buildContext({ input: { seq: 5, content: 'look', roomId: 'red' }, snapshot: { campaign: { id: 'c' },
    messages: [{ seq: 4, roomId: 'red', witnessUserIds: ['u'], content: 'witness-only', authorType: 'player' }] } });
  assert.doesNotMatch(JSON.stringify(missingAudience), /witness-only/);
});

test('complete D&D packet stays inside its hard byte budget', () => {
  const packet = buildContext({ input: { seq: 4, content: 'look', characterId: 'hero' }, budgetBytes: 4000,
    snapshot: { campaign: { id: 'c' }, sheets: [{ id: 'hero', name: 'Hero' }, ...Array.from({ length: 20 }, (_, id) => ({ id: `other-${id}`, name: 'x'.repeat(200) }))],
      npcs: Array.from({ length: 20 }, (_, id) => ({ id, notes: 'n'.repeat(500) })), messages: Array.from({ length: 20 }, (_, seq) => ({ seq, content: 'm'.repeat(300), authorType: 'player' })) },
    rag: [{ id: 'r', text: 'r'.repeat(3000) }], outcomes: [{ result: 'confirmed' }], actions: Array.from({ length: 8 }, (_, id) => `action-${id}`), schemas: { action: { description: 's'.repeat(1000) } } });
  assert.ok(Buffer.byteLength(JSON.stringify(packet)) <= 4000);
  assert.equal(packet.characters[0].id, 'hero');
  assert.deepEqual(packet.outcomes, [{ result: 'confirmed' }]);
  assert.ok(packet.omitted.dialogue + packet.omitted.rag + packet.omitted.npcs + packet.omitted.characters > 0);
});

test('oversized essential context pauses before any model call', async () => {
  let calls = 0; const epoch = 'z'.repeat(64), snapshot = { campaign: { id: 'c', gameSettings: {} }, timelineEpoch: epoch, currentSeq: 2, nextCursor: 2, hasMore: false,
    summary: 'x'.repeat(60_000), messages: [{ seq: 2, authorType: 'player', content: 'look' }], sheets: [], events: [], pendingRolls: [] };
  const controller = new NarratorOrchestrator({ dndEdition: true, adapter: { async generate() { calls++; return JSON.stringify({ kind: 'done' }); } } });
  const host = { campaignId: 'c', saveCheckpoint() {}, async callControl(action) { if (action === 'narrator.catalog') return { groups: [] }; throw new Error(action); } };
  assert.equal(await controller.tick(host, snapshot), false); assert.equal(controller.state.paused, 'context_budget'); assert.equal(calls, 0);
});

test('boundary maintenance calls memory once per scene and planner once per chapter', async () => {
  let memory = 0, planner = 0; const maintenance = new BoundaryMaintenance();
  const plan = () => Object.fromEntries(PLANNER_FIELDS.map(field => [field, []]));
  await maintenance.update({ sceneRevision: 1, chapterRevision: 1, memory: async () => memory++, planner: async () => { planner++; return plan(); } });
  await maintenance.update({ sceneRevision: 1, chapterRevision: 1, memory: async () => memory++, planner: async () => { planner++; return plan(); } });
  await maintenance.update({ sceneRevision: 2, chapterRevision: 1, memory: async () => memory++, planner: async () => { planner++; return plan(); } });
  assert.deepEqual({ memory, planner }, { memory: 2, planner: 1 });
});

test('telemetry is metadata only with explicit estimates', () => {
  const telemetry = new TurnTelemetry(); const entry = telemetry.record({ campaign: 'c', role: 'narrator', model: 'gpt-5.6-sol', effort: 'medium', reason: 'normal', totalMs: 2, estimatedInputTokens: 10, estimatedOutputTokens: 4, privacyScope: 'audience:user-secret', prompt: 'must never be copied' });
  telemetry.record({ campaign: 'c', role: 'narrator', model: 'gpt-5.6-sol', effort: 'medium', reason: 'normal', totalMs: 3, inputTokens: 7, outputTokens: 2, usageSource: 'exact' });
  assert.equal(entry.usageSource, 'estimated'); assert.equal(entry.privacyScope, 'audience'); assert.doesNotMatch(JSON.stringify(entry), /prompt|copied|user-secret/);
  assert.deepEqual(telemetry.aggregate(), { calls: 2, totalMs: 5, inputTokens: 7, outputTokens: 2, estimatedInputTokens: 10, estimatedOutputTokens: 4, exactCalls: 1, estimatedCalls: 1 });
});

test('local adapter activates D&D Edition alias and wraps the scoped retriever', async () => {
  const retriever = async () => [];
  const configured = await createNarratorAdapter({ startAfterSeq: 0, endpoint: 'http://127.0.0.1:4096', workspace: '/isolated',
    model: { providerID: 'openai', id: 'gpt-5.6-dnd-edition', variant: 'medium' }, ragRetriever: retriever, fetchImpl: async () => Response.json({}) });
  assert.equal(configured.storyController.dndEdition, true);
  assert.equal(configured.storyController.rag.retriever, retriever);
});

test('local adapter loads only an explicit local RAG module', async t => {
  const directory = fs.mkdtempSync('/tmp/opencode/odm-dnd-rag-'); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = `${directory}/retriever.mjs`;
  fs.writeFileSync(modulePath, 'export function retrieveDndKnowledge() { return [] }\n');
  const configured = await createNarratorAdapter({ startAfterSeq: 0, endpoint: 'http://127.0.0.1:4096', workspace: '/isolated', ragModule: modulePath,
    model: { providerID: 'openai', id: 'gpt-5.6-dnd-edition', variant: 'medium' }, fetchImpl: async () => Response.json({}) });
  assert.equal(typeof configured.storyController.rag.retriever, 'function');
  await assert.rejects(createNarratorAdapter({ startAfterSeq: 0, endpoint: 'http://127.0.0.1:4096', workspace: '/isolated', ragModule: 'https://example.com/rag.mjs',
    model: { providerID: 'openai', id: 'gpt-5.6-dnd-edition', variant: 'medium' }, fetchImpl: async () => Response.json({}) }), /local module/);
});

test('end-to-end edition narrator makes one scoped generation and spatial publication', async () => {
  const epoch = 'e'.repeat(64), calls = [], writes = [];
  const snapshot = { campaign: { id: 'c', scene: 'red room', gameSettings: {} }, timelineEpoch: epoch, currentSeq: 2, nextCursor: 2, hasMore: false,
    spatial: { enabled: true }, spatialRooms: [{ id: 'red', occupants: ['u'] }], location: { roomId: 'red' }, messages: [{ seq: 2, authorType: 'player', roomId: 'red', userId: 'u', witnessUserIds: ['u'], content: 'I look.' }], sheets: [], events: [], pendingRolls: [] };
  const adapter = { lastUsage: { inputTokens: 20, outputTokens: 5, totalMs: 12, usageSource: 'exact' }, async generate(role, prompt, route) { calls.push({ role, packet: JSON.parse(prompt), route }); return JSON.stringify({ kind: 'narrate', text: 'The room waits.', writer: true }); } };
  const controller = new NarratorOrchestrator({ dndEdition: true, adapter });
  const host = { campaignId: 'c', memory: { getPromptContext: () => ({ summary: '' }) }, saveCheckpoint() {}, async drainStory() { return snapshot; }, async callControl(action, params) { if (action === 'narrator.catalog') return { groups: [{ actions: [{ name: 'location_narrate' }, { name: 'request_roll' }] }] }; writes.push({ action, params }); return { commandId: params.commandId, committedSeq: 3, result: {} }; } };
  await controller.tick(host, snapshot);
  assert.equal(calls.length, 1); assert.equal(calls[0].packet.input.roomId, 'red'); assert.equal(calls[0].route.effort, 'high'); assert.equal(controller.state.paused, null); assert.equal(writes[0].params.name, 'location_narrate'); assert.equal(writes[0].params.args.roomId, 'red');
  assert.equal(controller.state.lastRoute.privacyScope, 'audience');
  assert.deepEqual(controller.state.usage.tokens, { inputExact: 20, outputExact: 5, inputEstimated: 0, outputEstimated: 0, exactCalls: 1, estimatedCalls: 0 });
});

test('spatial publication preserves the input audience and fails closed without it', async () => {
  const epoch = 'p'.repeat(64), writes = [];
  const run = async message => {
    const snapshot = { campaign: { id: 'c', gameSettings: {} }, timelineEpoch: epoch, currentSeq: message.seq, nextCursor: message.seq, hasMore: false,
      spatial: { enabled: true }, spatialRooms: [{ id: 'red', occupants: ['u', 'arrival'] }], spatialGrants: [], messages: [message], sheets: [], events: [], pendingRolls: [] };
    const controller = new NarratorOrchestrator({ dndEdition: true, adapter: { async generate() { return JSON.stringify({ kind: 'narrate', text: 'Scoped reply.' }); } } });
    const host = { campaignId: 'c', saveCheckpoint() {}, async drainStory() { return snapshot; }, async callControl(action, params) {
      if (action === 'narrator.catalog') return { groups: [] }; writes.push(params); return { commandId: params.commandId, committedSeq: message.seq + 1, result: {} };
    } };
    await controller.tick(host, snapshot); return controller;
  };
  const scoped = await run({ seq: 2, authorType: 'player', roomId: 'red', userId: 'u', witnessUserIds: ['u'], content: 'I look.' });
  assert.equal(scoped.state.paused, null); assert.equal(writes[0].name, 'location_perceive'); assert.deepEqual(writes[0].args.userIds, ['u']);
  const missing = await run({ seq: 3, authorType: 'player', roomId: 'red', userId: 'u', content: 'I listen.' });
  assert.equal(missing.state.paused, 'spatial_audience_required'); assert.equal(writes.length, 1);
});

test('orchestrator runs memory and planner only after observed boundaries change', async () => {
  const epoch = 'b'.repeat(64), calls = [], plan = Object.fromEntries(PLANNER_FIELDS.map(field => [field, []]));
  const adapter = { async generate(role, prompt, route) {
    calls.push({ role, packet: JSON.parse(prompt), route });
    if (role === 'memory') return JSON.stringify({ summary: 'Scoped prior scene.' });
    if (role === 'planner') return JSON.stringify(plan);
    return JSON.stringify({ kind: 'done' });
  } };
  const controller = new NarratorOrchestrator({ dndEdition: true, adapter });
  const host = { campaignId: 'c', saveCheckpoint() {}, memory: { getPromptContext: () => ({ summary: '' }) },
    async callControl(action) { if (action === 'narrator.catalog') return { groups: [] }; throw new Error(action); } };
  const snapshot = (seq, scene, chapter) => ({ campaign: { id: 'c', scene, gameSettings: {} }, timelineEpoch: epoch, currentSeq: seq, nextCursor: seq, hasMore: false,
    chapters: [{ id: chapter, status: 'open' }], messages: [{ seq, authorType: 'player', content: `turn ${seq}` }], sheets: [], events: [], pendingRolls: [] });
  await controller.tick(host, snapshot(2, 'one', 'chapter-1'));
  await controller.tick(host, snapshot(3, 'two', 'chapter-2'));
  await controller.tick(host, snapshot(4, 'two', 'chapter-2'));
  assert.deepEqual(calls.map(call => call.role), ['referee', 'memory', 'planner', 'referee', 'referee']);
  assert.equal(calls.at(-1).packet.threads, 'Scoped prior scene.');
  assert.deepEqual(calls.at(-1).packet.plan, plan);
});

test('private Ask uses the pinned high D&D route without story publication', async () => {
  const calls = [], controller = new NarratorOrchestrator({ dndEdition: true, adapter: { async generate(role, prompt, route) {
    calls.push({ role, packet: JSON.parse(prompt), route }); return JSON.stringify({ answer: 'Scoped answer.' });
  } } });
  const reply = await controller.answerAsk({ campaignId: 'c', saveCheckpoint() {} }, { id: 'a', userId: 'u', question: 'What do I know?', locale: 'en' }, { summary: 'Only this user knows.' });
  assert.equal(reply.answer, 'Scoped answer.'); assert.equal(calls[0].route.effort, 'high'); assert.equal(calls[0].route.privacyScope, 'audience:u');
});

test('stealth input retains its scope but cannot broaden into room narration', async () => {
  const epoch = 's'.repeat(64), writes = [], snapshot = { campaign: { id: 'c', gameSettings: {} }, timelineEpoch: epoch, currentSeq: 2, nextCursor: 2, hasMore: false, spatial: { enabled: true }, location: { roomId: 'red' }, messages: [{ seq: 2, authorType: 'player', roomId: 'red', witnessUserIds: ['u'], stealth: true, content: 'I slip past.' }], sheets: [], events: [], pendingRolls: [] };
  const controller = new NarratorOrchestrator({ dndEdition: true, adapter: { async generate() { return JSON.stringify({ kind: 'narrate', text: 'revealed' }); } } });
  const host = { campaignId: 'c', memory: { getPromptContext: () => ({ summary: '' }) }, saveCheckpoint() {}, async drainStory() { return snapshot; }, async callControl(action, params) { if (action === 'narrator.catalog') return { groups: [{ actions: [{ name: 'location_stealth_resolve' }] }] }; writes.push(params); return { commandId: params.commandId, committedSeq: 3, result: {} }; } };
  await controller.tick(host, snapshot); assert.equal(controller.state.current.input.roomId, 'red'); assert.deepEqual(controller.state.current.input.witnessUserIds, ['u']); assert.equal(controller.state.paused, 'private_spatial_narration_requires_resolution'); assert.equal(writes.length, 0);
});

test('D&D adapter locks OpenAI route and reports exact or explicitly estimated usage', async () => {
  for (const [usage, source] of [[{ input_tokens: 12, output_tokens: 4, ttft_ms: 7 }, 'exact'], [{ input_tokens: 0, output_tokens: 0 }, 'exact'], [undefined, 'estimated']]) {
    const calls = []; const model = { providerID: 'openai', id: 'gpt-5.6-sol', variant: 'medium' };
    const adapter = new OpenCodeAdapter({ endpoint: 'http://127.0.0.1:4096', workspace: '/isolated', model, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method }); if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url).endsWith('/api/session')) return Response.json({ data: { id: 'ses_owned', agent: 'narrator-referee', model } });
      if (String(url).endsWith('/generate')) return Response.json({ data: { text: 'ok' } });
      return Response.json({ data: usage ? [{ usage }] : [] });
    } });
    await adapter.generate('referee', 'bounded', { providerID: 'openai', model: 'gpt-5.6-sol', effort: 'medium' });
    assert.equal(adapter.lastUsage.usageSource, source); assert.equal(calls.some(call => call.method === 'GET'), true);
  }
  const adapter = new OpenCodeAdapter({ endpoint: 'http://127.0.0.1:4096', workspace: '/isolated', model: { providerID: 'openai', id: 'gpt-5.6-sol' }, fetchImpl: async () => Response.json({}) });
  await assert.rejects(adapter.generate('referee', 'x', { providerID: 'other', model: 'gpt-5.6-sol', effort: 'medium' }), /official OpenAI/);
});
