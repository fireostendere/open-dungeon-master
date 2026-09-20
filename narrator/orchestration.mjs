import crypto from 'node:crypto';
import { BoundaryMaintenance, buildContext, DND_EDITION_POLICY, memoryRoute, plannerRoute, routeDecision, selectTools, telemetryScope, TurnTelemetry, validateMemoryOutput, validatePlannerOutput } from './dnd-edition.mjs';

const clone = value => structuredClone(value);
const sequence = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.trim() && value.length <= 8000;
const publicMessage = value => value && ['player', 'dm'].includes(value.authorType) && sequence(value.seq) &&
  !value.dmOnly && !value.roomId && !['dm', 'private', 'witnesses'].includes(value.visibility) &&
  !['location', 'private', 'whisper'].includes(value.channel) && value.kind !== 'ooc' && !/^\s*\(ooc\)/i.test(value.content ?? '');
// Queue scope is authoritative input metadata, not prose. Retaining it prevents
// spatial publication from accidentally widening after checkpoint/restart.
const messageView = ({ id, seq, authorType, userId, characterId, content, roomId, witnessUserIds, visibility, channel, stealth, stealthScope }) => ({
  id, seq, authorType, userId, characterId, content, ...(roomId ? { roomId } : {}),
  ...(Array.isArray(witnessUserIds) ? { witnessUserIds: [...witnessUserIds] } : {}),
  ...(visibility ? { visibility } : {}), ...(channel ? { channel } : {}), ...(stealth ? { stealth: true } : {}), ...(stealthScope ? { stealthScope } : {}),
});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inputScope = input => Array.isArray(input.witnessUserIds) && input.witnessUserIds.length
  ? `audience:${[...input.witnessUserIds].sort().join(',')}` : input.roomId ? `room:${input.roomId}` : 'public';
const boundaryIds = snapshot => {
  const chapters = snapshot.chapters ?? [], chapter = chapters.find(value => value.status === 'open') ?? chapters.at(-1);
  return { scene: snapshot.campaign?.scene || snapshot.sceneTracker?.id || null, chapter: chapter?.id ?? chapter?.index ?? null };
};
const spatialAudience = (snapshot, roomId) => [...new Set([
  ...((snapshot.spatialRooms ?? []).find(room => room.id === roomId)?.occupants ?? []),
  ...(snapshot.spatialGrants ?? []).filter(grant => grant.roomId === roomId).map(grant => grant.userId),
].filter(value => typeof value === 'string' && value))].sort();
const sameAudience = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

export function publicProjection(snapshot, history = []) {
  const messages = new Map([...history, ...(snapshot.recentMessages ?? []), ...(snapshot.messages ?? [])]
    .filter(publicMessage).map(message => [message.seq, messageView(message)]));
  return {
    scene: snapshot.campaign?.scene ?? '', language: snapshot.campaign?.gameSettings?.language ?? 'ru',
    unitSystem: snapshot.campaign?.gameSettings?.unitSystem ?? 'metric',
    messages: [...messages.values()].sort((a, b) => a.seq - b.seq).slice(-24),
    rolls: (snapshot.events ?? []).filter(event => event.type === 'roll_result' && event.payload?.roll?.visibility === 'public')
      .map(({ payload: { roll } }) => ({ id: roll.id, characterId: roll.characterId, kind: roll.kind, total: roll.total, dc: roll.dc })),
  };
}

export function validateDecision(value, { allowedActions = new Set() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid referee decision.');
  const keys = {
    invoke: ['kind', 'action', 'args'], catalog: ['kind', 'action'],
    narrate: ['kind', 'text', 'writer', 'releaseFloor'], wait: ['kind'], done: ['kind'], release_floor: ['kind'],
  }[value.kind];
  if (!keys || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unsupported referee decision fields.');
  if (['invoke', 'catalog'].includes(value.kind) && !allowedActions.has(value.action)) throw new Error('Disallowed engine action.');
  if (value.kind === 'invoke' && (!value.args || typeof value.args !== 'object' || Array.isArray(value.args) ||
      ['campaignId', 'expectedSeq', 'commandId', 'timelineEpoch'].some(key => Object.hasOwn(value.args, key)))) throw new Error('Invalid engine arguments.');
  if (value.kind === 'narrate' && (!text(value.text) ||
      value.writer !== undefined && typeof value.writer !== 'boolean' ||
      value.releaseFloor !== undefined && typeof value.releaseFloor !== 'boolean')) throw new Error('Invalid narration.');
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new Error('Decision exceeds its byte budget.');
  return clone(value);
}

export class NarratorOrchestrator {
  constructor({ adapter, startAfterSeq = 0, maxSteps = 24, maxCallsPerHour = 240, dndEdition = false, rag, telemetry } = {}) {
    if (!adapter?.generate || !sequence(startAfterSeq) || !Number.isSafeInteger(maxSteps) || maxSteps < 1 ||
        !Number.isSafeInteger(maxCallsPerHour) || maxCallsPerHour < 1) throw new Error('Invalid narrator controller configuration.');
    this.adapter = adapter; this.maxSteps = maxSteps; this.maxCallsPerHour = maxCallsPerHour; this.dndEdition = dndEdition; this.rag = rag;
    this.telemetry = telemetry ?? new TurnTelemetry(); this.maintenance = new BoundaryMaintenance();
    this.catalog = null; this.schemas = {};
    this.state = { version: 1, epoch: null, handledSeq: startAfterSeq, queue: [], current: null, pending: null,
      history: [], events: [], paused: null, boundaries: null, dmMemoryByScope: {}, dmPlanByScope: {},
      usage: { calls: 0, inputBytes: 0, outputBytes: 0, times: [] } };
  }
  restore(state) {
    if (state?.version !== 1 || !sequence(state.handledSeq) || !Array.isArray(state.queue) || !state.usage) throw new Error('Unsupported orchestration checkpoint.');
    this.state = clone(state);
    this.state.dmMemoryByScope ??= this.state.dmMemory ? { public: this.state.dmMemory } : {};
    this.state.dmPlanByScope ??= this.state.dmPlan ? { public: this.state.dmPlan } : {}; this.state.boundaries ??= null;
    this.maintenance = new BoundaryMaintenance(this.state.boundaries ?? {});
  }
  serialize() { return clone(this.state); }
  reset(epoch) {
    const usage = this.state.usage;
    this.maintenance = new BoundaryMaintenance();
    this.state = { version: 1, epoch, handledSeq: 0, queue: [], current: null, pending: null, history: [], events: [], paused: 'timeline_changed', boundaries: null, dmMemoryByScope: {}, dmPlanByScope: {}, usage };
    this.catalog = null; this.schemas = {};
  }
  resume({ afterSeq } = {}) {
    if (this.state.pending?.attempts >= 2) throw new Error('Ambiguous write requires operator reconciliation, not another retry.');
    if(this.state.paused==='timeline_changed'){
      if(!sequence(afterSeq))throw new Error('Select an acknowledged input cursor after a timeline change.');
      this.state.handledSeq=afterSeq;this.state.queue=this.state.queue.filter(message=>message.seq>afterSeq);
    }
    this.state.paused = null;
    if (this.state.current) { this.state.current.steps = 0; this.state.current.waitSeq = null; }
  }
  ingestReadSnapshot(snapshot) {
    if (this.state.epoch && snapshot.timelineEpoch !== this.state.epoch) throw Object.assign(new Error('Narrator timeline changed.'), { status: 409, code: 'timeline_changed' });
    this.state.epoch = snapshot.timelineEpoch ?? this.state.epoch;
    if ((snapshot.spatial?.enabled || snapshot.spatial === true) && !this.dndEdition) { this.state.paused = 'spatial_campaign_unsupported'; return; }
    this.state.history = publicProjection(snapshot, this.state.history).messages;
    const queued = new Set([this.state.current?.input.seq, ...this.state.queue.map(message => message.seq)]);
    for (const message of snapshot.messages ?? []) {
      const scopedPlayer = this.dndEdition && message?.authorType === 'player' && sequence(message.seq) && message.kind !== 'ooc' && !/^\s*\(ooc\)/i.test(message.content ?? '') &&
        (!message.roomId || message.roomId === snapshot.location?.roomId || snapshot.spatial?.enabled);
      if ((publicMessage(message) || scopedPlayer) && message.authorType === 'player' && message.seq > this.state.handledSeq && !queued.has(message.seq)) {
        this.state.queue.push(messageView(message)); queued.add(message.seq);
      }
    }
    this.state.queue.sort((a, b) => a.seq - b.seq);
    if (this.state.queue.length > 1000) throw new Error('Unprocessed player queue exceeds the host budget; no input was acknowledged.');
    const events = new Map(this.state.events.map(event => [event.seq, event]));
    for (const event of snapshot.events ?? []) if (event.type === 'roll_result') events.set(event.seq, clone(event));
    this.state.events = [...events.values()].sort((a, b) => a.seq - b.seq).slice(-256);
    if (this.state.current?.waiting) {
      for (const event of this.state.events) {
        const id = event.payload?.pendingRollId;
        if (this.state.current.waiting.includes(id)) this.state.current.resolved[id] = clone(event.payload);
      }
    }
  }
  pause(host, reason) { this.state.paused = reason; host.saveCheckpoint(); return false; }
  async generate(host, role, packet, route) {
    const usage = this.state.usage, now = Date.now();
    usage.times = usage.times.filter(time => time > now - 3600000);
    if (usage.times.length >= this.maxCallsPerHour) throw new Error('Narrator model call budget exhausted.');
    const prompt = JSON.stringify(packet);
    usage.calls++; usage.times.push(now); usage.inputBytes += Buffer.byteLength(prompt); host.saveCheckpoint();
    const started = Date.now();
    const response = await this.adapter.generate(role, prompt, route);
    if (typeof response !== 'string') throw new Error('Role did not return text.');
    usage.outputBytes += Buffer.byteLength(response); host.saveCheckpoint();
    const native = this.adapter.lastUsage ?? {};
    const exactInput = Number.isSafeInteger(native.inputTokens) && native.inputTokens >= 0;
    const exactOutput = Number.isSafeInteger(native.outputTokens) && native.outputTokens >= 0;
    const event = this.telemetry.record({ campaign: host.campaignId, role, model: route?.model, effort: route?.effort, reason: route?.reason,
      totalMs: native.totalMs ?? Date.now() - started, ttftMs: native.ttftMs, inputTokens: exactInput ? native.inputTokens : null, outputTokens: exactOutput ? native.outputTokens : null,
      estimatedInputTokens: exactInput ? null : Math.ceil(Buffer.byteLength(prompt) / 4), estimatedOutputTokens: exactOutput ? null : Math.ceil(Buffer.byteLength(response) / 4), usageSource: exactInput || exactOutput ? 'exact' : 'estimated', privacyScope: route?.privacyScope });
    const tokens = usage.tokens ??= { inputExact: 0, outputExact: 0, inputEstimated: 0, outputEstimated: 0, exactCalls: 0, estimatedCalls: 0 };
    tokens.inputExact += exactInput ? native.inputTokens : 0; tokens.outputExact += exactOutput ? native.outputTokens : 0;
    tokens.inputEstimated += event.estimatedInputTokens ?? 0; tokens.outputEstimated += event.estimatedOutputTokens ?? 0;
    if (event.usageSource === 'exact') tokens.exactCalls++; else tokens.estimatedCalls++;
    usage.lastTurn = { totalMs: event.totalMs, inputTokens: event.inputTokens, outputTokens: event.outputTokens, estimatedInputTokens: event.estimatedInputTokens, estimatedOutputTokens: event.estimatedOutputTokens, usageSource: event.usageSource, timestamp: event.timestamp };
    return response;
  }
  async answerAsk(host, ask, context) {
    try {
      const route=this.dndEdition?routeDecision({input:{content:ask.question,private:true},privacyScope:`audience:${ask.userId}`}):undefined;
      const reply=JSON.parse(await this.generate(host,'referee',{task:'answer_ask',question:ask.question,language:ask.locale??'ru',context},route));
      if(!reply||Object.keys(reply).some(key=>key!=='answer')||!text(reply.answer)||reply.answer.length>4000)throw new Error('Invalid private answer.');
      return {answer:reply.answer,citations:[]};
    } catch {
      const failure={ru:'Не удалось обработать этот вопрос по D&D. Уточните его или отправьте ещё раз.',en:'I could not resolve that D&D question. Please clarify or submit it again.',pl:'Nie udało się rozpatrzyć pytania o D&D. Doprecyzuj je lub wyślij ponownie.'};
      return {answer:failure[ask.locale]??failure.ru,citations:[]};
    }
  }
  async tick(host, snapshot) {
    this.ingestReadSnapshot(snapshot); host.saveCheckpoint();
    if (this.state.paused) return false;
    if (snapshot.hasMore || snapshot.nextCursor !== snapshot.currentSeq || snapshot.timelineEpoch !== this.state.epoch) throw new Error('Story must be fully drained before a decision.');
    if (this.state.pending) return this.write(host);
    if (!this.state.current) {
      const input = this.state.queue.shift();
      if (!input) return false;
      this.state.current = { input, steps: 0, outcomes: [], waiting: [], resolved: {}, waitSeq: null }; host.saveCheckpoint();
    }
    const current = this.state.current;
    if (current.waiting.some(id => !current.resolved[id]) || snapshot.pendingRolls?.length) return false;
    if (current.waiting.length) {
      // Physical dice must have a matching roll_result, not merely disappear.
      snapshot = await host.drainStory({ full: true });
      current.outcomes.push({ physicalRolls: clone(Object.values(current.resolved)), authoritativeRolls: (snapshot.recentRolls ?? []).filter(roll => Object.values(current.resolved).some(value => value.roll?.id === roll.id)) });
      current.waiting = []; current.resolved = {}; host.saveCheckpoint();
    }
    if (current.waitSeq === snapshot.currentSeq) return false;
    if (current.steps >= this.maxSteps) return this.pause(host, 'step_budget');
    if (!this.catalog) {
      const catalog = await host.callControl('narrator.catalog', { campaignId: host.campaignId, summaryOnly: true });
      if (!Array.isArray(catalog?.groups)) throw new Error('Invalid engine catalog.');
      this.catalog = catalog.groups;
    }
    const allowedActions = new Set(this.catalog.flatMap(group => (group.actions ?? []).map(action => action.name)));
    const campaign = snapshot.campaign ?? {};
    let packet = {
      input: current.input, public: publicProjection(snapshot, this.state.history),
      campaign: { title: campaign.title, description: campaign.description, theme: campaign.theme, scene: campaign.scene,
        questLog: campaign.questLog, gameSettings: campaign.gameSettings, dmOutline: campaign.dmOutline, storyArc: campaign.storyArc, floor: campaign.floor, clock: campaign.clock },
      state: { sheets: snapshot.sheets, encounter: snapshot.encounter, sceneTracker: snapshot.sceneTracker, location: snapshot.location,
        facts: snapshot.facts, notes: snapshot.notes, npcs: snapshot.npcs, pendingRolls: snapshot.pendingRolls, summary: snapshot.summary },
      historySummary: host.memory?.getPromptContext?.().summary ?? '',
      outcomes: current.outcomes, rollEvents: this.state.events.filter(event => event.seq >= current.input.seq),
      actions: this.catalog, schemas: this.schemas,
    };
    let route;
    if (this.dndEdition) {
      const audienceScope = inputScope(current.input), boundaries = boundaryIds(snapshot);
      if (!this.state.boundaries) {
        this.maintenance = new BoundaryMaintenance(boundaries); this.state.boundaries = this.maintenance.serialize();
      } else if (boundaries.scene !== this.state.boundaries.scene || boundaries.chapter !== this.state.boundaries.chapter) {
        try {
          const boundaryContext = buildContext({ snapshot, input: current.input,
            memory: this.state.dmMemoryByScope[audienceScope] ? { getPromptContext: () => this.state.dmMemoryByScope[audienceScope] } : undefined,
            budgetBytes: DND_EDITION_POLICY.contextBytes });
          const plan = await this.maintenance.update({ sceneRevision: boundaries.scene, chapterRevision: boundaries.chapter, context: boundaryContext,
            memory: async context => { const value = validateMemoryOutput(JSON.parse(await this.generate(host, 'memory', { task: 'scene_boundary', context }, memoryRoute(audienceScope)))); this.state.dmMemoryByScope[audienceScope] = value; },
            planner: async context => validatePlannerOutput(JSON.parse(await this.generate(host, 'planner', { task: 'chapter_boundary', context }, plannerRoute()))) });
          if (plan) this.state.dmPlanByScope[audienceScope] = plan;
          this.state.boundaryStatus = { status: 'ok', scene: boundaries.scene, chapter: boundaries.chapter };
        } catch { this.state.boundaryStatus = { status: 'unavailable', scene: boundaries.scene, chapter: boundaries.chapter }; }
        this.state.boundaries = this.maintenance.serialize(); host.saveCheckpoint();
      }
      route = routeDecision({ input: current.input, snapshot, privacyScope: audienceScope });
      const actionNames = selectTools({ input: current.input, snapshot, catalog: this.catalog });
      const rag = await this.rag?.retrieve?.({ campaignId: host.campaignId, query: current.input.content, visibilityScope: route.privacyScope,
        memoryRevision: `${this.state.boundaries?.scene ?? ''}:${this.state.boundaries?.chapter ?? ''}`, activeContext: snapshot.summary ?? '', privateInput: route.privacyScope !== 'public' }) ?? { chunks: [] };
      route = { ...route, rag: rag.chunks?.length > 0 };
      // D&D Edition never runs compaction per player message; boundary work may
      // place a scoped DM summary in state for subsequent packets.
      try {
        packet = buildContext({ snapshot, input: current.input, memory: this.state.dmMemoryByScope[audienceScope] ? { getPromptContext: () => this.state.dmMemoryByScope[audienceScope] } : undefined,
          plan: this.state.dmPlanByScope[audienceScope] ?? null, rag: rag.chunks ?? [], outcomes: current.outcomes, rollEvents: this.state.events.filter(event => event.seq >= current.input.seq),
          actions: actionNames, schemas: this.schemas, ragStatus: rag.reason, budgetBytes: DND_EDITION_POLICY.contextBytes });
      } catch { return this.pause(host, 'context_budget'); }
      this.state.lastRoute = { profile: route.profile, role: route.role, model: route.model, effort: route.effort, reason: route.reason, rag: route.rag, planner: false, privacyScope: telemetryScope(route.privacyScope) };
      this.state.lastContextBudget = { estimatedBytes: packet.omitted.estimatedBytes, omitted: packet.omitted, label: packet.estimate };
      this.state.lastRag = { used: route.rag, status: rag.reason, evidenceGap: Boolean(rag.evidenceGap) };
      for (const action of [...allowedActions]) if (!actionNames.includes(action)) allowedActions.delete(action);
    }
    let decision;
    try {
      current.steps++; host.saveCheckpoint();
      decision = validateDecision(JSON.parse(await this.generate(host, 'referee', packet, route)), { allowedActions });
    } catch { return this.pause(host, 'model_or_decision_error'); }
    if (decision.kind === 'wait') { current.waitSeq = snapshot.currentSeq; host.saveCheckpoint(); return false; }
    if (decision.kind === 'catalog') {
      const result = await host.callControl('narrator.catalog', { campaignId: host.campaignId, action: decision.action });
      this.schemas[decision.action] = result.groups; return true;
    }
    if (decision.kind === 'done') { this.finish(host); return true; }
    if (decision.kind === 'invoke' && decision.action === 'request_roll' && current.outcomes.some(outcome => outcome.name === decision.action && digest(outcome.args) === digest(decision.args) && !outcome.result?.error)) return this.pause(host, 'duplicate_check');
    let content = decision.text;
    if (decision.kind === 'narrate' && decision.writer && !this.dndEdition) {
      try { content = await this.generate(host, 'writer', { ...publicProjection(snapshot, this.state.history), input: current.input, approvedDraft: decision.text }); }
      catch { return this.pause(host, 'writer_error'); }
      if (!text(content)) return this.pause(host, 'invalid_writer_text');
    }
    // Generation is not a lock: reject a draft based on stale state.
    const fresh = await host.drainStory();
    if (fresh.timelineEpoch !== snapshot.timelineEpoch) return this.pause(host, 'timeline_changed');
    if (fresh.currentSeq !== snapshot.currentSeq) return true;
    const spatialNarration = this.dndEdition && (fresh.spatial?.enabled || fresh.spatial === true) && decision.kind === 'narrate';
    if (spatialNarration && !current.input.roomId) return this.pause(host, 'spatial_room_required');
    if (spatialNarration && (current.input.stealth || current.input.stealthScope || ['private', 'whisper'].includes(current.input.visibility) || current.input.channel === 'private')) return this.pause(host, 'private_spatial_narration_requires_resolution');
    const inputAudience = [...new Set((current.input.witnessUserIds ?? []).filter(value => typeof value === 'string' && value))].sort();
    if (spatialNarration && !inputAudience.length) return this.pause(host, 'spatial_audience_required');
    const exactRoomAudience = spatialNarration && sameAudience(inputAudience, spatialAudience(fresh, current.input.roomId));
    const action = decision.kind === 'invoke' || spatialNarration ? 'narrator.invoke' : decision.kind === 'narrate' ? 'narrator.narrate' : 'narrator.release_floor';
    const params = { campaignId: host.campaignId, expectedSeq: fresh.currentSeq, timelineEpoch: fresh.timelineEpoch, commandId: crypto.randomUUID(),
      ...(decision.kind === 'invoke' ? { name: decision.action, args: decision.args } : spatialNarration ? exactRoomAudience
        ? { name: 'location_narrate', args: { roomId: current.input.roomId, content } }
        : { name: 'location_perceive', args: { roomId: current.input.roomId, userIds: inputAudience, content } }
        : decision.kind === 'narrate' ? { content, releaseFloor: decision.releaseFloor ?? false } : {}) };
    this.state.pending = { action, params, attempts: 0, phase: 'prepared', finishesInput: Boolean(spatialNarration), beforePendingIds: (fresh.pendingRolls ?? []).map(roll => roll.id) };
    host.saveCheckpoint();
    return this.write(host);
  }
  finish(host) {
    this.state.handledSeq = this.state.current.input.seq; this.state.current = null; this.state.pending = null; host.saveCheckpoint();
  }
  async write(host) {
    const pending = this.state.pending;
    if (pending.params.campaignId !== host.campaignId || pending.params.timelineEpoch !== this.state.epoch) return this.pause(host, 'incompatible_command');
    if (pending.phase !== 'committed') {
      if (pending.attempts >= 2) return this.pause(host, 'ambiguous_write');
      pending.attempts++; host.saveCheckpoint();
      let receipt;
      try { receipt = await host.callControl(pending.action, pending.params); }
      catch (error) {
        if (error.code === 'timeline_changed') throw error;
        if (error.status === 409 && /^Stale narrator cursor/.test(error.message)) {
          this.state.pending = null; host.saveCheckpoint(); await host.drainStory(); return false;
        }
        if (error.status >= 400 && error.status < 500 && ![408, 429, 499].includes(error.status)) return this.pause(host, 'command_rejected');
        if (pending.attempts >= 2) return this.pause(host, 'ambiguous_write');
        throw error;
      }
      if (receipt?.commandId !== pending.params.commandId || !sequence(receipt.committedSeq) || !Object.hasOwn(receipt, 'result')) return this.pause(host, 'invalid_command_receipt');
      pending.phase = 'committed'; pending.receipt = clone(receipt); host.saveCheckpoint();
    }
    const fresh = await host.drainStory();
    if (fresh.timelineEpoch !== pending.params.timelineEpoch) return this.pause(host, 'timeline_changed');
    if (pending.finishesInput || pending.action === 'narrator.narrate' || pending.action === 'narrator.release_floor') { this.finish(host); return true; }
    const result = pending.receipt.result;
    const waiting = (fresh.pendingRolls ?? []).filter(roll => !pending.beforePendingIds.includes(roll.id)).map(roll => roll.id);
    // A parked call whose roll vanished before observation needs reconciliation.
    if (result?.parked && !waiting.length) return this.pause(host, 'unobserved_pending_roll');
    this.state.current.outcomes.push({ name: pending.params.name, args: pending.params.args, result, commandId: pending.params.commandId, committedSeq: pending.receipt.committedSeq });
    this.state.current.waiting = waiting; this.state.current.waitSeq = null;
    this.state.pending = null; host.saveCheckpoint(); return true;
  }
}
