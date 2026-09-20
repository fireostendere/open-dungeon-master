// Deterministic policy and packet shaping for the external D&D narrator.
const json = value => JSON.stringify(value);
const bytes = value => Buffer.byteLength(json(value));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const visible = message => message && message.kind !== 'ooc' && !/^\s*\(ooc\)/i.test(message.content ?? '');
const privateScope = scope => scope && scope !== 'public';
export const telemetryScope = scope => { const value = String(scope ?? 'public'); return value.startsWith('audience:') ? 'audience' : value.startsWith('room:') ? 'room' : ['public', 'dm'].includes(value) ? value : 'private'; };

export const DND_EDITION_POLICY = Object.freeze({
  narrator: { providerID: 'openai', id: 'gpt-5.6-sol', variant: 'medium' },
  planner: { providerID: 'openai', id: 'gpt-5.6-sol', variant: 'high' },
  reader: { providerID: 'openai', id: 'gpt-5.6-luna', variant: 'low' },
  contextBytes: 48_000, recentMessages: 12, rag: { topK: 4, maxChunks: 4, maxBytes: 9_000, ttlMs: 300_000 },
  actionBudget: 8,
});
export const PLANNER_FIELDS = Object.freeze(['scene_goal', 'open_threads', 'npc_goals', 'npc_secrets', 'known_facts', 'unknowns', 'possible_escalations', 'possible_rewards', 'possible_clues', 'constraints', 'privacy_notes', 'must_not_contradict']);

export function plannerRoute(reason = 'chapter_boundary') { return Object.freeze({ profile: 'dnd-edition', role: 'planner', providerID: 'openai', model: 'gpt-5.6-sol', effort: 'high', reason, rag: false, planner: true, privacyScope: 'dm' }); }
export function memoryRoute(privacyScope = 'public') { return Object.freeze({ profile: 'dnd-edition', role: 'memory', providerID: 'openai', model: 'gpt-5.6-luna', effort: 'low', reason: 'scene_boundary', rag: false, planner: false, privacyScope }); }
export function validatePlannerOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !PLANNER_FIELDS.includes(key)) || PLANNER_FIELDS.some(key => !Array.isArray(value[key]) || value[key].length > 10 || value[key].some(item => typeof item !== 'string' || item.length > 500)) || bytes(value) > 16_000) throw new Error('Invalid D&D planner output.');
  return value;
}
export function validateMemoryOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'summary') || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 8000) throw new Error('Invalid D&D memory output.');
  return value;
}

export function routeDecision({ input = {}, snapshot = {}, privacyScope = 'public', reasoningFailed = false, exceptionalGate = false } = {}) {
  const content = clean(input.content);
  const spatial = Boolean(snapshot.spatial?.enabled || snapshot.spatial === true || input.roomId);
  const privateInput = privateScope(privacyScope) || Boolean(input.private || input.stealth || input.visibility === 'private');
  const split = spatial && ((snapshot.spatialRooms ?? snapshot.spatial?.rooms ?? []).length > 1);
  const canon = /retcon|contradic|canon|remember|раньше|противореч/i.test(content);
  const reason = split ? 'party_split' : privateInput ? 'private_or_stealth' : canon ? 'canon_conflict' : spatial ? 'spatial' : 'normal';
  let effort = (privateInput || split || canon || spatial) ? 'high' : 'medium';
  if (reasoningFailed && exceptionalGate && effort === 'high') effort = 'max';
  return Object.freeze({ profile: 'dnd-edition', role: 'narrator', model: 'gpt-5.6-sol', providerID: 'openai', effort,
    reason, rag: false, planner: false, reader: false, privacyScope: privateInput ? privacyScope : 'public', spatial });
}

export function selectTools({ input = {}, snapshot = {}, catalog = [], actionBudget = DND_EDITION_POLICY.actionBudget } = {}) {
  const names = new Set(catalog.flatMap(group => (group.actions ?? []).map(action => action.name ?? action)));
  const content = clean(input.content);
  const combat = Boolean(snapshot.encounter?.active || snapshot.encounter?.initiative?.length || /attack|cast|strike|ата[кк]|заклин/i.test(content));
  const wanted = combat
    ? ['start_encounter', 'pc_attack', 'cast_spell', 'request_roll', 'move_token', 'end_turn', 'release_floor']
    : ['request_roll', 'move_token', 'use_resource', 'grant_item', 'modify_gold', 'release_floor'];
  return wanted.filter(name => names.has(name)).slice(0, actionBudget);
}

export function buildContext({ snapshot = {}, input = {}, memory, plan = null, rag = [], outcomes = [], rollEvents = [], actions = [], schemas = {}, ragStatus, budgetBytes = DND_EDITION_POLICY.contextBytes } = {}) {
  const roomId = input.roomId ?? null;
  const audience = new Set(input.witnessUserIds ?? (input.userId ? [input.userId] : []));
  const inScope = item => !roomId || item.roomId === roomId || (!item.roomId && !item.visibility);
  const messages = [...(snapshot.recentMessages ?? []), ...(snapshot.messages ?? [])]
    .filter(visible).filter(inScope).filter(message => !message.witnessUserIds || audience.size > 0 && message.witnessUserIds.some(id => audience.has(id)))
    .slice(-DND_EDITION_POLICY.recentMessages).map(({ seq, authorType, characterId, content }) => ({ seq, authorType, characterId, content }));
  const scope = roomId ? `room:${roomId}` : 'public';
  const characters = (snapshot.sheets ?? []).filter(inScope).map(({ id, name, currentHp, conditions, resources }) => ({ id, name, currentHp, conditions, resources }));
  characters.sort((a, b) => Number(b.id === input.characterId) - Number(a.id === input.characterId));
  const packet = {
    estimate: 'byte-based estimate; not an exact token count',
    campaign: { id: snapshot.campaign?.id, title: snapshot.campaign?.title, language: snapshot.campaign?.gameSettings?.language ?? 'ru', unitSystem: snapshot.campaign?.gameSettings?.unitSystem ?? 'metric' },
    scene: snapshot.campaign?.scene ?? snapshot.sceneTracker?.scene ?? '',
    characters,
    npcs: (snapshot.npcs ?? []).filter(inScope), encounter: snapshot.encounter ?? null, dialogue: messages,
    threads: memory?.getPromptContext?.({ roomId, audience: [...audience] })?.summary ?? snapshot.summary ?? '', rag, input: { seq: input.seq, kind: input.kind, content: input.content, characterId: input.characterId, roomId, audience: [...audience] },
    scope, plan, outcomes, rollEvents, actions, schemas, ragStatus,
    omitted: { dialogue: 0, rag: 0, npcs: 0, plan: 0, characters: 0, actions: 0, schemas: 0, estimatedBytes: 0 },
  };
  const drop = () => {
    if (packet.dialogue.length) { packet.dialogue.shift(); packet.omitted.dialogue++; return true; }
    if (packet.rag.length) { packet.rag.pop(); packet.omitted.rag++; return true; }
    if (packet.npcs.length) { packet.npcs.pop(); packet.omitted.npcs++; return true; }
    if (packet.plan) { packet.plan = null; packet.omitted.plan = 1; return true; }
    const removableCharacter = packet.characters.findLastIndex(character => character.id !== input.characterId);
    if (removableCharacter >= 0) { packet.characters.splice(removableCharacter, 1); packet.omitted.characters++; return true; }
    if (packet.actions.length) { packet.actions.pop(); packet.omitted.actions++; return true; }
    const schema = Object.keys(packet.schemas).at(-1);
    if (schema) { delete packet.schemas[schema]; packet.omitted.schemas++; return true; }
    return false;
  };
  for (;;) {
    packet.omitted.estimatedBytes = bytes(packet);
    if (bytes(packet) <= budgetBytes) return packet;
    if (!drop()) throw new Error('D&D context exceeds its hard byte budget.');
  }
}

export class ScopedRag {
  constructor({ retriever, config = {} } = {}) { this.retriever = retriever; this.config = { ...DND_EDITION_POLICY.rag, ...config }; this.cache = new Map(); }
  async retrieve({ campaignId, query, visibilityScope = 'public', memoryRevision = 0, activeContext = '', privateInput = false } = {}) {
    const normalized = clean(query);
    if (!this.retriever || !campaignId || !normalized || clean(activeContext).includes(normalized) || privateInput && !visibilityScope.startsWith('audience:')) return { chunks: [], reason: privateInput ? 'private_scope_required' : 'not_needed' };
    const key = `${campaignId}\0${normalized}\0${visibilityScope}\0${memoryRevision}`, now = Date.now(), cached = this.cache.get(key);
    if (cached && cached.until > now) return { ...cached.value, cached: true };
    try {
      const raw = await this.retriever({ campaignId, query: normalized, visibilityScope, topK: this.config.topK, maxChunks: this.config.maxChunks });
      const seen = new Set(), chunks = [];
      const candidates = (Array.isArray(raw) ? raw : raw?.chunks ?? []).filter(chunk => chunk && chunk.visibilityScope === visibilityScope && !seen.has(chunk.id ?? chunk.sourceId ?? chunk.text) && seen.add(chunk.id ?? chunk.sourceId ?? chunk.text));
      for (const chunk of candidates) {
        if (chunks.length >= this.config.maxChunks) break;
        const candidate = { id: chunk.id ?? chunk.sourceId, sourceId: chunk.sourceId ?? chunk.id, text: String(chunk.text ?? ''), visibilityScope: chunk.visibilityScope };
        if (bytes([...chunks, candidate]) <= this.config.maxBytes) { chunks.push(candidate); continue; }
        let low = 0, high = candidate.text.length, fitted = '';
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), value = candidate.text.slice(0, middle);
          if (bytes([...chunks, { ...candidate, text: value }]) <= this.config.maxBytes) { fitted = value; low = middle + 1; } else high = middle - 1;
        }
        if (fitted) chunks.push({ ...candidate, text: fitted });
        break;
      }
      const value = { chunks, reason: chunks.length ? 'ok' : 'evidence_gap' }; this.cache.set(key, { until: now + this.config.ttlMs, value }); return value;
    } catch { return { chunks: [], reason: 'unavailable', evidenceGap: true }; }
  }
}

export class TurnTelemetry {
  constructor({ sink } = {}) { this.sink = sink; this.turn = []; }
  record(entry) { const safe = { timestamp: new Date().toISOString(), campaign: entry.campaign, role: entry.role, model: entry.model, effort: entry.effort, reason: entry.reason, totalMs: entry.totalMs, ttftMs: entry.ttftMs ?? null, inputTokens: entry.inputTokens ?? null, outputTokens: entry.outputTokens ?? null, estimatedInputTokens: entry.estimatedInputTokens ?? null, estimatedOutputTokens: entry.estimatedOutputTokens ?? null, usageSource: entry.usageSource ?? 'estimated', ragMs: entry.ragMs ?? 0, readMs: entry.readMs ?? 0, mutationMs: entry.mutationMs ?? 0, tools: entry.tools ?? 0, retry: Boolean(entry.retry), fallback: entry.fallback ?? null, privacyScope: telemetryScope(entry.privacyScope) }; this.turn.push(safe); this.sink?.(safe); return safe; }
  aggregate() { return this.turn.reduce((total, event) => ({ calls: total.calls + 1, totalMs: total.totalMs + (event.totalMs ?? 0), inputTokens: total.inputTokens + (event.inputTokens ?? 0), outputTokens: total.outputTokens + (event.outputTokens ?? 0), estimatedInputTokens: total.estimatedInputTokens + (event.estimatedInputTokens ?? 0), estimatedOutputTokens: total.estimatedOutputTokens + (event.estimatedOutputTokens ?? 0), exactCalls: total.exactCalls + Number(event.usageSource === 'exact'), estimatedCalls: total.estimatedCalls + Number(event.usageSource !== 'exact') }), { calls: 0, totalMs: 0, inputTokens: 0, outputTokens: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, exactCalls: 0, estimatedCalls: 0 }); }
}

export class BoundaryMaintenance {
  constructor(state = {}) { this.scene = state.scene ?? null; this.chapter = state.chapter ?? null; }
  serialize() { return { scene: this.scene, chapter: this.chapter }; }
  async update({ sceneRevision, chapterRevision, memory, planner, context }) {
    const sceneChanged = sceneRevision !== undefined && sceneRevision !== this.scene, chapterChanged = chapterRevision !== undefined && chapterRevision !== this.chapter;
    if (chapterChanged) { this.chapter = chapterRevision; this.scene = sceneRevision; await memory?.(context); const plan = planner ? await planner(context, plannerRoute()) : null; return plan ? validatePlannerOutput(plan) : null; }
    if (sceneChanged) { this.scene = sceneRevision; await memory?.(context); }
    return null;
  }
}
