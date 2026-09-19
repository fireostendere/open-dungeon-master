/** Bounded narrator memory. Audience provenance is data, not a room-name hint. */
import { createHash } from 'node:crypto';

const copy = value => value == null ? value : structuredClone(value);
const positive = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const users = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))].sort() : null;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sequence = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function provenance(item = {}) {
  const roomId = typeof item.roomId === 'string' ? item.roomId : null;
  const witnessUserIds = users(item.witnessUserIds ?? item.audienceUserIds);
  const global = item.visibility === 'global' || item.kind === 'ooc' || (!roomId && item.channel === 'global');
  return {
    roomId,
    witnessUserIds,
    visibility: item.dmOnly || item.visibility === 'dm' || (!global && witnessUserIds === null) ? 'dm' : global ? 'global' : 'witnesses',
    permittedAspects: Array.isArray(item.permittedAspects) ? [...item.permittedAspects] : [],
  };
}

function visible(item, roomId, audience) {
  const p = provenance(item);
  if (roomId && p.roomId !== roomId && p.visibility !== 'global') return false;
  if (audience !== null) {
    if (p.visibility === 'dm') return false;
    if (p.visibility !== 'global' && !audience.every(id => p.witnessUserIds?.includes(id))) return false;
  }
  return true;
}

export class HostContextMemory {
  constructor(options = {}) {
    this.maxRecentMessages = positive(options.maxRecentMessages, 30);
    this.maxRecentRolls = positive(options.maxRecentRolls, 20);
    this.compactionBatchSize = positive(options.compactionBatchSize, 15);
    this.summaryLimitChars = positive(options.summaryLimitChars, 6_000);
    this.maxSeenMessages = positive(options.maxSeenMessages, 20_000);
    this.campaignId = options.campaignId || '';
    this.reset(options.timelineEpoch ?? null);
    this.legacySummary = String(options.initialSummary || '').slice(-this.summaryLimitChars);
    this._rebuildSummary();
  }

  reset(timelineEpoch = null) {
    this.timelineEpoch = timelineEpoch;
    this.legacySummary = '';
    this.summary = '';
    this.summaries = new Map();
    this.summarySegments = [];
    this.messages = [];
    this.rolls = [];
    this.milestones = [];
    this.sheets = new Map();
    this.encounter = null;
    this.encounters = [];
    this.seenMessages = new Map();
    this.compactedThroughSeq = -1;
  }

  ingestReadSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const epoch = snapshot.timelineEpoch ?? snapshot.epoch ?? this.timelineEpoch;
    if ((snapshot.campaignId && this.campaignId && snapshot.campaignId !== this.campaignId) ||
        (this.timelineEpoch !== null && epoch !== this.timelineEpoch)) this.reset(epoch);
    this.timelineEpoch = epoch;
    if (snapshot.campaignId) this.campaignId = snapshot.campaignId;
    if (Array.isArray(snapshot.sheets)) {
      for (const sheet of snapshot.sheets) if (sheet?.id) this.sheets.set(sheet.id, copy(sheet));
    }
    if (snapshot.encounter !== undefined) {
      this.encounter = copy(snapshot.encounter);
      this.encounters = this.encounter ? [this.encounter] : [];
    }
    if (Array.isArray(snapshot.encounters)) this.encounters = copy(snapshot.encounters);
    if (Array.isArray(snapshot.recentRolls)) {
      for (const roll of snapshot.recentRolls) {
        if (!roll?.id) continue;
        const index = this.rolls.findIndex(existing => existing.id === roll.id);
        if (index < 0) this.rolls.push(copy(roll));
        else this.rolls[index] = copy(roll);
      }
      this.rolls = this.rolls.slice(-this.maxRecentRolls);
    }
    const incoming = [...(Array.isArray(snapshot.recentMessages) ? snapshot.recentMessages : []),
      ...(Array.isArray(snapshot.messages) ? snapshot.messages : [])];
    for (const raw of incoming) {
      if (!raw?.id) continue;
      const msg = { ...copy(raw), ...provenance(raw) };
      const fingerprint = digest(msg);
      const seen = this.seenMessages.get(msg.id);
      const seq = sequence(msg.updatedSeq) ?? sequence(msg.seq);
      if (seen?.fingerprint === fingerprint) continue;
      // Old backfill cannot resurrect evicted history. Updates beyond the bounded
      // ledger must carry a new monotonic updatedSeq, like other domain events.
      if (!seen && seq !== null && seq <= this.compactedThroughSeq) continue;
      this.messages = this.messages.filter(item => item.id !== msg.id);
      this.summarySegments = this.summarySegments.filter(item => item.sourceId !== msg.id);
      this.milestones = this.milestones.filter(item => item.sourceId !== msg.id);
      this.seenMessages.delete(msg.id);
      this.seenMessages.set(msg.id, { fingerprint, seq });
      this.messages.push(msg);
      this._checkMilestone(msg);
    }
    this.messages.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.id).localeCompare(String(b.id)));
    this._compactIfNeeded();
    while (this.seenMessages.size > this.maxSeenMessages) this.seenMessages.delete(this.seenMessages.keys().next().value);
  }

  _checkMilestone(msg) {
    const text = String(msg.content || '');
    const type = /(?:смерть|умер|killed|death|fallen in battle|погиб)/iu.test(text) ? 'death'
      : /(?:level up|новый уровень|повышение уровня)/iu.test(text) ? 'level_up'
      : /(?:артефакт|легендарный предмет|получил артефакт|quest complete)/iu.test(text) ? 'quest_item' : null;
    if (!type) return;
    this.milestones.push({ ...provenance(msg), sourceId: msg.id, seq: msg.seq, version: msg.version ?? null,
      time: msg.createdAt || null, type, text: text.slice(0, 150) });
    this.milestones = this.milestones.slice(-25);
  }

  _compactIfNeeded() {
    while (this.messages.length > this.maxRecentMessages) {
      const batch = this.messages.splice(0, Math.min(this.compactionBatchSize, this.messages.length - this.maxRecentMessages));
      for (const msg of batch) {
        this.compactedThroughSeq = Math.max(this.compactedThroughSeq, sequence(msg.updatedSeq) ?? sequence(msg.seq) ?? -1);
        if (msg.kind === 'ooc' || msg.content?.startsWith('(ooc)')) continue;
        this.summarySegments.push({ ...provenance(msg), sourceId: msg.id, version: msg.version ?? null,
          fromSeq: msg.seq ?? null, toSeq: msg.updatedSeq ?? msg.seq ?? null,
          text: `${msg.authorName || 'Speaker'}: ${msg.content || ''}`.slice(-this.summaryLimitChars) });
      }
    }
    // Drop whole old segments, never detach content from its audience metadata.
    let remaining = this.summaryLimitChars;
    const kept = [];
    for (const segment of [...this.summarySegments].reverse()) {
      if (remaining <= 0) break;
      const text = String(segment.text || '').slice(-remaining);
      kept.push({ ...segment, text });
      remaining -= text.length;
    }
    this.summarySegments = kept.reverse();
    this.legacySummary = this.legacySummary.slice(-Math.max(0, remaining));
    if (remaining <= 0) this.legacySummary = '';
    this._rebuildSummary();
  }

  _render(segments) {
    return (segments.length ? '[Прошедшие события]:\n' : '') + segments.map(segment => `[${segment.fromSeq ?? '?'}..${segment.toSeq ?? '?'}; room=${segment.roomId || '-'}; ` +
      `audience=${segment.visibility === 'global' ? 'global' : segment.visibility === 'dm' ? 'dm-only' : JSON.stringify(segment.witnessUserIds)}]\n${segment.text}`).join('\n');
  }

  _rebuildSummary() {
    this.summaries = new Map();
    for (const segment of this.summarySegments) {
      const key = segment.roomId ? `room:${segment.roomId}` : `channel:${segment.visibility}`;
      this.summaries.set(key, `${this.summaries.get(key) || ''}${this.summaries.has(key) ? '\n' : ''}${this._render([segment])}`);
    }
    this.summary = [this.legacySummary && `[Legacy memory: DM-only, audience unknown]\n${this.legacySummary}`, this._render(this.summarySegments)].filter(Boolean).join('\n\n');
  }

  /** With audienceUserIds, every returned fact is authorized for the whole reply audience. */
  getPromptContext(scope = null, options = {}) {
    const roomId = typeof scope === 'object' && scope ? scope.roomId || null : scope;
    const config = typeof scope === 'object' && scope ? scope : options;
    const audience = config.viewerUserId ? [config.viewerUserId] : users(config.audienceUserIds);
    const allowed = item => visible(item, roomId, audience);
    const segments = this.summarySegments.filter(allowed);
    const encounters = this.encounters.filter(allowed);
    return copy({
      summary: !roomId && audience === null ? this.summary : this._render(segments),
      summarySegments: segments,
      milestones: this.milestones.filter(allowed),
      recentMessages: this.messages.filter(allowed),
      recentRolls: this.rolls.filter(allowed),
      activeEncounter: encounters[0] || null,
      encounters,
      characters: Array.from(this.sheets.values()).filter(allowed).map(sheet => ({
        ...provenance(sheet), id: sheet.id, name: sheet.name, hp: sheet.hp, ac: sheet.ac, class: sheet.class, level: sheet.level,
      })),
    });
  }

  serializeState({ safe = false } = {}) {
    if (safe) return {
      campaignId: this.campaignId, messageCount: this.messages.length, rollCount: this.rolls.length,
      sheetCount: this.sheets.size, roomCount: new Set(this.messages.map(message => message.roomId).filter(Boolean)).size,
      milestoneCount: this.milestones.length,
    };
    return copy({
      formatVersion: 2, campaignId: this.campaignId, timelineEpoch: this.timelineEpoch,
      summary: this.summary, legacySummary: this.legacySummary, summarySegments: this.summarySegments,
      messages: this.messages, rolls: this.rolls, sheets: Array.from(this.sheets.values()),
      encounter: this.encounter, encounters: this.encounters, milestones: this.milestones,
      seenMessages: Array.from(this.seenMessages), compactedThroughSeq: this.compactedThroughSeq,
    });
  }

  restoreState(state) {
    if (!state || typeof state !== 'object') return;
    this.reset(state.timelineEpoch ?? null);
    if (state.campaignId) this.campaignId = state.campaignId;
    if (state.formatVersion === 2) {
      this.legacySummary = String(state.legacySummary || '');
      this.summarySegments = Array.isArray(state.summarySegments) ? copy(state.summarySegments) : [];
      this.seenMessages = new Map(Array.isArray(state.seenMessages) ? state.seenMessages.slice(-this.maxSeenMessages) : []);
      this.compactedThroughSeq = Number.isSafeInteger(state.compactedThroughSeq) ? state.compactedThroughSeq : -1;
    } else {
      // Old room summaries have already lost witnesses. Keep them for the DM,
      // but do not silently relabel them as knowledge of today's room occupants.
      this.legacySummary = String(state.summary || Object.values(state.summaries || {}).join('\n\n'));
    }
    this.messages = Array.isArray(state.messages) ? state.messages.map(msg => ({ ...copy(msg), ...provenance(msg) })) : [];
    for (const msg of this.messages) if (msg?.id && !this.seenMessages.has(msg.id)) this.seenMessages.set(msg.id, { fingerprint: digest(msg), seq: sequence(msg.seq) });
    this.rolls = Array.isArray(state.rolls) ? copy(state.rolls.slice(-this.maxRecentRolls)) : [];
    this.sheets = new Map(Array.isArray(state.sheets) ? state.sheets.filter(sheet => sheet?.id).map(sheet => [sheet.id, copy(sheet)]) : []);
    this.encounter = copy(state.encounter ?? null);
    this.encounters = Array.isArray(state.encounters) ? copy(state.encounters) : this.encounter ? [this.encounter] : [];
    this.milestones = Array.isArray(state.milestones) ? state.milestones.slice(-25).map(item => ({ ...copy(item), ...provenance(item) })) : [];
    this._compactIfNeeded();
  }
}
