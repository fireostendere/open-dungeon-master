import crypto from 'node:crypto';
import { filterNarratorCatalog, narratorModeGuidance, resolveNarratorPlayMode } from './runtime-mode.mjs';
import { parseGameFacadeArgs } from '../shared/dnd-game-facade.mjs';
import { postWriteReadOptions, consumePostWriteRead } from './read-session.mjs';
import { compactRolePacket } from './role-packet.mjs';
import { emitLatency, latencyEnabled } from '../mcp/latency-trace.mjs';

const clone = value => structuredClone(value);
const sequence = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.trim() && value.length <= 8000;
const publicMessage = value => value && ['player', 'dm'].includes(value.authorType) && sequence(value.seq) &&
  !value.dmOnly && !value.roomId && !['dm', 'private', 'witnesses'].includes(value.visibility) &&
  !['location', 'private', 'whisper'].includes(value.channel) && value.kind !== 'ooc' && !/^\s*\(ooc\)/i.test(value.content ?? '');
const spatialPlayerMessage = value => value && value.authorType === 'player' && sequence(value.seq) &&
  typeof value.roomId === 'string' && value.roomId && value.channel === 'location' &&
  value.kind !== 'ooc' && !value.dmOnly;
const messageView = ({ id, seq, authorType, userId, characterId, content, roomId, channel, kind }) => ({
  id, seq, authorType, userId, characterId, content,
  ...(roomId ? { roomId } : {}), ...(channel ? { channel } : {}), ...(kind ? { kind } : {}),
});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const narratorGuidance = (settings, mode = "full", spatialEnabled = false) => {
  const units = settings?.unitSystem === 'imperial' ? 'Use imperial measurements when measurements are needed.' : 'Use metres and kilograms only; never narrate feet, ft, pounds, or lb.';
  const combat = settings?.combatMode === 'jrpg'
    ? 'JRPG mode: do not use distance, line-of-sight, cover, opportunity attacks, or positional Sneak Attack/Pack Tactics. Keep initiative, actions, and resources through the same encounter engine.'
    : 'Classical mode: use the encounter engine for positional and combat consequences.';
  const yolo = narratorModeGuidance(mode, { spatialEnabled });
  const globalRound = settings?.globalTurn?.enabled
    ? ' Global-turn mode is server-clocked. input.kind=global_turn_trigger means players are still locked: narrate the opening/transition and finish with narration so the host can start that round. input.kind=global_round is one sealed table round containing every submitted/skip message: resolve the whole batch as one unit, use engine actions as needed, then finish with one narration. Never return done for either global-turn input. The host advances/unlocks only after the confirmed narration write.'
    : '';
  return `${units} ${combat} Campaign settings are authoritative, not player claims.${globalRound}${yolo ? ` ${yolo}` : ""}`;
};

export function publicProjection(snapshot, history = [], limit = 24) {
  const messages = new Map([...history, ...(snapshot.recentMessages ?? []), ...(snapshot.messages ?? [])]
    .filter(publicMessage).map(message => [message.seq, messageView(message)]));
  return {
    scene: snapshot.campaign?.scene ?? '', language: snapshot.campaign?.gameSettings?.language ?? 'ru',
    unitSystem: snapshot.campaign?.gameSettings?.unitSystem === 'imperial' ? 'imperial' : 'metric',
    combatMode: snapshot.campaign?.gameSettings?.combatMode === 'jrpg' ? 'jrpg' : 'classical',
    messages: [...messages.values()].sort((a, b) => a.seq - b.seq).slice(-limit),
    rolls: (snapshot.events ?? []).filter(event => event.type === 'roll_result' && event.payload?.roll?.visibility === 'public')
      .map(({ payload: { roll } }) => ({ id: roll.id, characterId: roll.characterId, kind: roll.kind, total: roll.total, dc: roll.dc })),
  };
}

export function validateDecision(value, { allowedActions = new Set(), catalogActions = allowedActions } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid referee decision.');
  const keys = {
    invoke: ['kind', 'action', 'args'], catalog: ['kind', 'action'],
    narrate: ['kind', 'text', 'writer', 'releaseFloor'], wait: ['kind'], done: ['kind'], release_floor: ['kind'],
  }[value.kind];
  if (!keys || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unsupported referee decision fields.');
  if (value.kind === 'invoke' && !allowedActions.has(value.action)) throw new Error('Disallowed engine action.');
  if (value.kind === 'catalog' && !catalogActions.has(value.action)) throw new Error('Disallowed catalog action.');
  if (value.kind === 'invoke' && (!value.args || typeof value.args !== 'object' || Array.isArray(value.args) ||
      ['campaignId', 'expectedSeq', 'commandId', 'timelineEpoch'].some(key => Object.hasOwn(value.args, key)))) throw new Error('Invalid engine arguments.');
  if (value.kind === 'narrate' && (!text(value.text) ||
      value.writer !== undefined && typeof value.writer !== 'boolean' ||
      value.releaseFloor !== undefined && typeof value.releaseFloor !== 'boolean')) throw new Error('Invalid narration.');
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new Error('Decision exceeds its byte budget.');
  return clone(value);
}

export class NarratorOrchestrator {
  constructor({ adapter, startAfterSeq = 0, maxSteps, maxCallsPerHour = 240, yolo = false,
    writerEnabled = process.env.ODM_NARRATOR_WRITER_ENABLED !== '0' } = {}) {
    const playMode = resolveNarratorPlayMode(adapter, { requested: yolo });
    const resolvedMaxSteps = maxSteps ?? (playMode === 'yolo' ? 6 : 24);
    if (!adapter?.generate || !sequence(startAfterSeq) || !Number.isSafeInteger(resolvedMaxSteps) || resolvedMaxSteps < 1 ||
        !Number.isSafeInteger(maxCallsPerHour) || maxCallsPerHour < 1) throw new Error('Invalid narrator controller configuration.');
    this.adapter = adapter; this.playMode = playMode; this.maxSteps = resolvedMaxSteps; this.maxCallsPerHour = maxCallsPerHour;
    this.writerEnabled = writerEnabled === true;
    this.catalog = null; this.schemas = {};
    this.state = { version: 1, epoch: null, handledSeq: startAfterSeq, queue: [], current: null, pending: null,
      history: [], events: [], paused: null, usage: { calls: 0, inputBytes: 0, outputBytes: 0, times: [] } };
  }
  restore(state) {
    if (state?.version !== 1 || !sequence(state.handledSeq) || !Array.isArray(state.queue) || !state.usage) throw new Error('Unsupported orchestration checkpoint.');
    this.state = clone(state);
  }
  serialize() { return clone(this.state); }
  reset(epoch) {
    const usage = this.state.usage;
    this.state = { version: 1, epoch, handledSeq: 0, queue: [], current: null, pending: null, history: [], events: [], paused: 'timeline_changed', usage };
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
    if (this.state.paused === 'spatial_campaign_unsupported') this.state.paused = null;
    const spatialEnabled = Boolean(snapshot.spatial?.enabled || snapshot.spatial === true);
    this.state.history = publicProjection(snapshot, this.state.history, this.playMode === "yolo" ? 12 : 24).messages;
    const queued = new Set([this.state.current?.input.seq, ...this.state.queue.map(message => message.seq)]);
    for (const message of snapshot.messages ?? []) {
      const eligible = spatialEnabled ? spatialPlayerMessage(message) : publicMessage(message);
      if (eligible && message.authorType === 'player' && message.seq > this.state.handledSeq && !queued.has(message.seq)) {
        this.state.queue.push(messageView(message)); queued.add(message.seq);
      }
    }
    this.state.queue.sort((a, b) => a.seq - b.seq);
    if (this.state.queue.length > 1000) throw new Error('Unprocessed player queue exceeds the host budget; no input was acknowledged.');
    const events = new Map(this.state.events.map(event => [event.seq, event]));
    for (const event of snapshot.events ?? []) {
      if (
        event.type === 'roll_result' ||
        event.type === 'global_turn_ready' ||
        event.type === 'global_turn_narrator_trigger'
      ) {
        events.set(event.seq, clone(event));
      }
    }
    this.state.events = [...events.values()].sort((a, b) => a.seq - b.seq).slice(-256);
    if (this.state.current?.waiting) {
      for (const event of this.state.events) {
        const id = event.payload?.pendingRollId;
        if (this.state.current.waiting.includes(id)) this.state.current.resolved[id] = clone(event.payload);
      }
    }
  }
  pause(host, reason) { this.state.paused = reason; host.saveCheckpoint(); return false; }
  async generate(host, role, packet) {
    const usage = this.state.usage, now = Date.now();
    usage.times = usage.times.filter(time => time > now - 3600000);
    if (usage.times.length >= this.maxCallsPerHour) throw new Error('Narrator model call budget exhausted.');
    const packetTiming=latencyEnabled(), packetStarted=packetTiming?performance.now():0;
    const prompt = JSON.stringify(compactRolePacket(role, packet));
    if(packetTiming)emitLatency({stage:'packet',role,durationMs:performance.now()-packetStarted,bytes:Buffer.byteLength(prompt)});
    usage.calls++; usage.times.push(now); usage.inputBytes += Buffer.byteLength(prompt); host.saveCheckpoint();
    const modelTiming=latencyEnabled(), startedAt = modelTiming?performance.now():0; let outputBytes=0;
    try {
      const response = await this.adapter.generate(role, prompt);
      if (typeof response !== 'string') throw new Error('Role did not return text.');
      outputBytes=Buffer.byteLength(response);usage.outputBytes += outputBytes;
      // Output byte counters are advisory. The next decision boundary saves
      // them together with its mandatory state, not another full fsync here.
      return response;
    } finally {
      if (modelTiming) emitLatency({ stage: 'narrator_model', role, durationMs: performance.now()-startedAt, inputBytes: Buffer.byteLength(prompt), outputBytes, modelCalls: 1 });
    }
  }
  async answerAsk(host, ask, context) {
    try {
      const reply=JSON.parse(await this.generate(host,'referee',{task:'answer_ask',question:ask.question,language:ask.locale??'ru',context}));
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
      const globalTurnEnabled =
        Boolean(snapshot.campaign?.gameSettings?.globalTurn?.enabled) &&
        !snapshot.encounter?.orderReady;
      let input;
      if (globalTurnEnabled) {
        const globalTurn = snapshot.campaign?.globalTurnState;
        if (globalTurn?.phase === 'waiting') {
          // No player input is accepted in waiting. A persisted narrator
          // trigger wakes the model; its confirmed narration starts the round.
          const trigger = this.state.events.find(
            event =>
              event.type === 'global_turn_narrator_trigger' &&
              event.seq > this.state.handledSeq &&
              Number(event.payload?.roundNumber) === Number(globalTurn.roundNumber),
          );
          if (!trigger) return false;
          const roundNumber = Number(trigger.payload?.roundNumber);
          if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) {
            return this.pause(host, 'invalid_global_round_trigger');
          }
          input = {
            id: `global-turn-trigger:${roundNumber}`,
            seq: trigger.seq,
            authorType: 'system',
            userId: 'server',
            characterId: null,
            kind: 'global_turn_trigger',
            roundNumber,
            content:
              trigger.payload?.kind === 'opening'
                ? 'Open the scene for the party. Players are locked until your narration commits.'
                : 'Transition to the next party round. Players are locked until your narration commits.',
          };
        } else if (globalTurn?.phase === 'ready' || globalTurn?.phase === 'resolving') {
          // Player messages are accumulated until the server emits the exact
          // round barrier. The barrier seq includes materialized skip messages.
          const ready = this.state.events.find(
            event =>
              event.type === 'global_turn_ready' &&
              event.seq > this.state.handledSeq &&
              Number(event.payload?.roundNumber) === Number(globalTurn.roundNumber),
          );
          if (!ready) return false;
          const roundNumber = Number(ready.payload?.roundNumber);
          if (!Number.isSafeInteger(roundNumber) || roundNumber < 1) {
            return this.pause(host, 'invalid_global_round');
          }
          const messages = this.state.queue.filter(message => message.seq <= ready.seq);
          this.state.queue = this.state.queue.filter(message => message.seq > ready.seq);
          input = {
            id: `global-round:${roundNumber}`,
            seq: ready.seq,
            authorType: 'player',
            userId: 'party',
            characterId: null,
            kind: 'global_round',
            roundNumber,
            messages,
            content: messages.map(message => `${message.content}`).join('\n'),
          };
        } else {
          // active/quorum_delay: the server is collecting. Polling is cheap and
          // must not spend a model call before the round barrier.
          return false;
        }
      } else {
        input = this.state.queue.shift();
        if (!input) return false;
      }
      this.state.current = { input, steps: 0, outcomes: [], waiting: [], resolved: {}, waitSeq: null };
      host.saveCheckpoint();
    }
    const current = this.state.current;
    if (current.waiting.some(id => !current.resolved[id]) || snapshot.pendingRolls?.length) return false;
    if (current.waiting.length) {
      snapshot = await host.drainStory({ full: true });
      current.outcomes.push({ physicalRolls: clone(Object.values(current.resolved)), authoritativeRolls: (snapshot.recentRolls ?? []).filter(roll => Object.values(current.resolved).some(value => value.roll?.id === roll.id)) });
      current.waiting = []; current.resolved = {}; host.saveCheckpoint();
    }
    if (current.waitSeq === snapshot.currentSeq) return false;
    if (current.steps >= this.maxSteps) return this.pause(host, 'step_budget');
    if (!this.catalog) {
      const catalog = await host.callControl('narrator.catalog', {
        campaignId: host.campaignId,
        summaryOnly: this.playMode !== 'yolo',
      });
      if (!Array.isArray(catalog?.groups)) throw new Error('Invalid engine catalog.');
      this.catalog = catalog.groups;
    }
    const spatialEnabled = Boolean(snapshot.spatial?.enabled || snapshot.spatial === true);
    const visibleCatalog = filterNarratorCatalog(this.catalog, this.playMode, { spatialEnabled });
    const allowedActions = new Set(visibleCatalog.flatMap(group => (group.actions ?? []).map(action => action.name)));
    const catalogActions = new Set(visibleCatalog.flatMap(group => (group.actions ?? []).flatMap(action =>
      (action.operations ?? []).map(operation => operation.name))));
    const campaign = snapshot.campaign ?? {};
    const safeCampaign = campaign;
    const packet = {
      instructions: narratorGuidance(snapshot.campaign?.gameSettings, this.playMode, spatialEnabled), mode: this.playMode,
      input: current.input, public: publicProjection(snapshot, this.state.history, this.playMode === 'yolo' ? 12 : 24),
      campaign: { title: safeCampaign.title, description: safeCampaign.description, theme: safeCampaign.theme, scene: safeCampaign.scene,
        questLog: safeCampaign.questLog, gameSettings: safeCampaign.gameSettings, globalTurnState: safeCampaign.globalTurnState,
        dmOutline: safeCampaign.dmOutline, storyArc: safeCampaign.storyArc, floor: safeCampaign.floor, clock: safeCampaign.clock, party: safeCampaign.party },
      state: { sheets: snapshot.sheets, encounter: snapshot.encounter, sceneTracker: snapshot.sceneTracker, location: snapshot.location,
        facts: snapshot.facts, notes: snapshot.notes, npcs: snapshot.npcs, pendingRolls: snapshot.pendingRolls, summary: snapshot.summary, members: snapshot.members,
        spatial: spatialEnabled ? { enabled: true, rooms: snapshot.spatialRooms ?? [], grants: snapshot.spatialGrants ?? [] } : { enabled: false } },
      historySummary: host.memory?.getPromptContext?.().summary ?? '',
      outcomes: current.outcomes, rollEvents: this.state.events.filter(event => event.seq >= current.input.seq),
      actions: visibleCatalog, schemas: this.schemas,
    };
    let decision;
    try {
      current.steps++; // generate durably records this and the call budget together
      let rawDecision = JSON.parse(await this.generate(host, 'referee', packet));
      // Compatibility lane for checkpoints/prompts produced before the one-game
      // façade: normalize a directly named engine operation into game instead
      // of forcing an otherwise-correct old narrator to fail mid-campaign.
      if (rawDecision?.kind === 'invoke' &&
          !allowedActions.has(rawDecision.action) &&
          catalogActions.has(rawDecision.action)) {
        rawDecision = {
          kind: 'invoke',
          action: 'game',
          args: { action: rawDecision.action, args: rawDecision.args ?? {} },
        };
      }
      decision = validateDecision(rawDecision, { allowedActions, catalogActions });
      if (spatialEnabled && decision.kind === 'narrate') {
        const roomId = current.input?.roomId ?? (snapshot.spatialRooms?.length === 1 ? snapshot.spatialRooms[0]?.id : null);
        if (!roomId || !catalogActions.has('location_narrate')) throw new Error('Spatial narration needs an authorized room.');
        decision = { kind: 'invoke', action: 'game', args: { action: 'location_narrate', args: { roomId, content: decision.text } } };
      }
    } catch { return this.pause(host, 'model_or_decision_error'); }
    if (host.stopping || this.state.current !== current || this.state.epoch !== snapshot.timelineEpoch) return false;
    if (decision.kind === 'wait') {
      if (
        current.input?.kind === 'global_round' ||
        current.input?.kind === 'global_turn_trigger'
      ) return this.pause(host, 'global_round_cannot_wait_for_new_input');
      current.waitSeq = snapshot.currentSeq; host.saveCheckpoint(); return false;
    }
    if (decision.kind === 'catalog') {
      const result = await host.callControl('narrator.catalog', { campaignId: host.campaignId, action: decision.action });
      this.schemas[decision.action] = result.groups; return true;
    }
    if (decision.kind === 'done') {
      if (
        current.input?.kind === 'global_round' ||
        current.input?.kind === 'global_turn_trigger'
      ) return this.pause(host, 'global_round_requires_narration');
      this.finish(host); return true;
    }
    let invokedAction = decision.action;
    let invokedArgs = decision.args;
    if (decision.kind === 'invoke' && decision.action === 'game') {
      const parsed = parseGameFacadeArgs(decision.args, catalogActions);
      if (!parsed.ok) return this.pause(host, 'invalid_game_action');
      invokedAction = parsed.action;
      invokedArgs = parsed.args;
    }
    if (
      decision.kind === 'invoke' &&
      invokedAction === 'request_player_input' &&
      (current.input?.kind === 'global_round' || current.input?.kind === 'global_turn_trigger')
    ) return this.pause(host, 'global_round_cannot_request_new_input');
    if (decision.kind === 'invoke' && invokedAction === 'request_roll' && current.outcomes.some(outcome => outcome.name === invokedAction && digest(outcome.args) === digest(invokedArgs) && !outcome.result?.error)) return this.pause(host, 'duplicate_check');
    let content = decision.text;
    const combatActive = snapshot.encounter?.status === 'active' && snapshot.encounter?.kind === 'fight';
    if (decision.kind === 'narrate' && decision.writer && this.playMode !== 'yolo' && this.writerEnabled && !combatActive) {
      try { content = await this.generate(host, 'writer', { instructions: narratorGuidance(snapshot.campaign?.gameSettings, this.playMode, spatialEnabled), ...publicProjection(snapshot, this.state.history, 24), input: current.input, approvedDraft: decision.text }); }
      catch { return this.pause(host, 'writer_error'); }
      if (!text(content)) return this.pause(host, 'invalid_writer_text');
    }
    // Generation is not a lock. The engine's transactional expectedSeq/epoch
    // check rejects a stale draft before effects. A redundant pre-write read
    // neither closes that race nor replaces CAS; keep the original read cursor.
    if (host.stopping || this.state.current !== current) return false;
    if (this.state.epoch !== snapshot.timelineEpoch || host.timelineEpoch && host.timelineEpoch !== snapshot.timelineEpoch) return this.pause(host, 'timeline_changed');
    const action = decision.kind === 'invoke' ? 'narrator.invoke' : decision.kind === 'narrate' ? 'narrator.narrate' : 'narrator.release_floor';
    const params = { campaignId: host.campaignId, expectedSeq: snapshot.currentSeq, timelineEpoch: snapshot.timelineEpoch, commandId: crypto.randomUUID(),
      ...(decision.kind === 'invoke' ? { name: invokedAction, args: invokedArgs,
        ...(invokedAction === 'location_narrate' && typeof invokedArgs?.roomId === 'string' ? { scopeRoomId: invokedArgs.roomId } : {}) }
        : decision.kind === 'narrate' ? {
            content,
            releaseFloor: decision.releaseFloor ?? false,
            ...(current.input?.kind === 'global_round'
              ? { completeGlobalRound: current.input.roundNumber }
              : current.input?.kind === 'global_turn_trigger'
                ? { startGlobalRound: current.input.roundNumber }
                : snapshot.campaign?.gameSettings?.globalTurn?.enabled &&
                    snapshot.campaign?.globalTurnState?.phase === 'waiting' &&
                    !snapshot.encounter?.orderReady
                  ? { startGlobalRound: snapshot.campaign.globalTurnState.roundNumber }
                  : {}),
          } : {}),
      ...(sequence(host.lastSeq) ? { readAfter: postWriteReadOptions(host) } : {}) };
    this.state.pending = { action, params, attempts: 0, phase: 'prepared', beforePendingIds: (snapshot.pendingRolls ?? []).map(roll => roll.id) };
    host.saveCheckpoint();
    return this.write(host);
  }
  finish(host) {
    this.state.handledSeq = this.state.current.input.seq; this.state.current = null; this.state.pending = null; host.saveCheckpoint();
  }
  async write(host) {
    const pending = this.state.pending;
    if (pending.params.campaignId !== host.campaignId || pending.params.timelineEpoch !== this.state.epoch) return this.pause(host, 'incompatible_command');
    let readback;
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
      readback = receipt;
      // Persist the small authoritative receipt, not a second copy of the
      // complete private snapshot. Restart recovery reads fresh, never replays.
      const { state: _state, readAfter: _read, readRequired: _required, readError: _error, ...durable } = receipt;
      pending.phase = 'committed'; pending.receipt = clone(durable); host.saveCheckpoint();
    }
    const fresh = readback ? await consumePostWriteRead(host, readback) : await host.drainStory();
    if (fresh.timelineEpoch !== pending.params.timelineEpoch) return this.pause(host, 'timeline_changed');
    if (pending.action === 'narrator.narrate' || pending.action === 'narrator.release_floor') { this.finish(host); return true; }
    const result = pending.receipt.result;
    const waiting = (fresh.pendingRolls ?? []).filter(roll => !pending.beforePendingIds.includes(roll.id)).map(roll => roll.id);
    if (result?.parked && !waiting.length) return this.pause(host, 'unobserved_pending_roll');
    this.state.current.outcomes.push({ name: pending.params.name, args: pending.params.args, result, commandId: pending.params.commandId, committedSeq: pending.receipt.committedSeq });
    this.state.current.waiting = waiting; this.state.current.waitSeq = null;
    this.state.pending = null; host.saveCheckpoint(); return true;
  }
}
