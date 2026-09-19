/** Bounded narrator memory with publication-time audiences. Both historical
 * checkpoint formats are accepted; unknown legacy provenance stays DM-only.
 */
const clone = value => value == null ? value : structuredClone(value);
const bounded = (value, fallback, max) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
const seqOf = value => Number.isSafeInteger(value?.updatedSeq) && value.updatedSeq >= 0 ? value.updatedSeq : Number.isSafeInteger(value?.seq) && value.seq >= 0 ? value.seq : -1;
const isOoc = value => value?.kind === 'ooc' || /^\s*\(ooc\)/i.test(value?.content ?? '');
const roomOf = value => value?.roomId ?? value?.encounter?.roomId ?? null;
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))].sort() : [];
function provenance(value) {
  const roomId = roomOf(value);
  const global = !value?.dmOnly && value?.visibility !== 'dm' && (value?.visibility === 'global' || value?.channel === 'global');
  return { roomId, channel: global ? 'global' : 'private',
    visibility: value?.dmOnly || value?.visibility === 'dm' ? 'dm' : global ? 'global' : 'witnesses',
    witnessUserIds: ids(value?.witnessUserIds ?? value?.audienceUserIds),
    aspects: ids(value?.aspects ?? value?.permittedAspects),
    permittedAspects: ids(value?.permittedAspects ?? value?.aspects) };
}
function visible(value, roomId, audience) {
  const meta = provenance(value);
  if (roomId && meta.roomId !== roomId && meta.channel !== 'global') return false;
  if (audience === null) return !value.legacy || !roomId;
  if (value.legacy || meta.visibility === 'dm') return false;
  return meta.channel === 'global' || (audience.length > 0 && audience.every(id => meta.witnessUserIds.includes(id)));
}
function recordLine(value) {
  const meta = { id: value.id, seq: value.seq, ...provenance(value), ...(value.legacy ? { legacy: true, dmOnly: true } : {}) };
  return `[${JSON.stringify(meta)}] ${value.content ?? ''}`;
}
export class HostContextMemory {
  constructor(options = {}) {
    this.maxRecentMessages = bounded(options.maxRecentMessages, 30, 1000);
    this.maxRecentRolls = bounded(options.maxRecentRolls, 20, 1000);
    this.compactionBatchSize = bounded(options.compactionBatchSize, 15, 1000);
    this.summaryLimitChars = bounded(options.summaryLimitChars, 6000, 100000);
    this.maxSeenMessages = bounded(options.maxSeenMessages, 20000, 100000);
    this.campaignId = options.campaignId || '';
    this.reset(options.timelineEpoch ?? null);
    if (options.initialSummary) this._legacy(options.initialSummary);
  }
  reset(options = null) {
    const config = options && typeof options === 'object' ? options : { timelineEpoch: options };
    this.campaignId = config.campaignId ?? this.campaignId;
    this.timelineEpoch = config.timelineEpoch ?? config.timelineId ?? null;
    this.timelineId = this.timelineEpoch;
    this.processedSeq = -1; this.compactedThroughSeq = -1; this.lastCurrentSeq = null;
    this.summary = ''; this.summaries = new Map(); this.summaryRecords = []; this.messages = [];
    this.rolls = []; this.milestones = []; this.sheets = new Map(); this.encounter = null; this.encounters = [];
    this.seenMessages = new Map();
  }
  get summarySegments() {
    return this.summaryRecords.filter(item => !item.legacy).map(item => ({ ...clone(item), sourceId: item.id,
      fromSeq: item.seq, toSeq: item.updatedSeq ?? item.seq, text: item.content }));
  }
  _legacy(content, id = 'legacy-summary') {
    if (typeof content !== 'string' || !content) return;
    this.summaryRecords.push({ id, seq: -1, roomId: null, channel: 'private', visibility: 'dm', witnessUserIds: [], aspects: [], legacy: true,
      content: content.slice(-this.summaryLimitChars) });
    this._rebuildSummary();
  }
  ingestReadSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const campaignId = snapshot.campaignId ?? snapshot.campaign?.id ?? this.campaignId;
    if (this.campaignId && campaignId && campaignId !== this.campaignId) throw new Error('Narrator memory belongs to another campaign.');
    const epoch = snapshot.timelineEpoch ?? snapshot.epoch ?? snapshot.timelineId ?? snapshot.campaign?.timelineId ?? this.timelineEpoch;
    if ((this.timelineEpoch !== null && epoch !== this.timelineEpoch) ||
        (Number.isSafeInteger(snapshot.currentSeq) && this.lastCurrentSeq !== null && snapshot.currentSeq < this.lastCurrentSeq)) {
      this.reset({ campaignId, timelineEpoch: epoch });
    }
    this.campaignId = campaignId; this.timelineEpoch = epoch; this.timelineId = epoch;
    if (Number.isSafeInteger(snapshot.currentSeq)) this.lastCurrentSeq = snapshot.currentSeq;
    if (Array.isArray(snapshot.sheets)) this.sheets = new Map(snapshot.sheets.filter(s => s?.id).slice(0, 256).map(s => [s.id, clone(s)]));
    if (snapshot.encounter !== undefined) { this.encounter = clone(snapshot.encounter); this.encounters = this.encounter ? [this.encounter] : []; }
    if (Array.isArray(snapshot.encounters)) this.encounters = clone(snapshot.encounters.slice(0, 128));
    for (const roll of Array.isArray(snapshot.recentRolls) ? snapshot.recentRolls : []) {
      if (!roll?.id) continue;
      const index = this.rolls.findIndex(item => item.id === roll.id);
      if (index >= 0) this.rolls[index] = clone(roll); else this.rolls.push(clone(roll));
    }
    this.rolls = this.rolls.slice(-this.maxRecentRolls);
    const incoming = [...(Array.isArray(snapshot.recentMessages) ? snapshot.recentMessages : []), ...(Array.isArray(snapshot.messages) ? snapshot.messages : [])]
      .filter(msg => msg?.id && !isOoc(msg)).sort((a, b) => seqOf(a) - seqOf(b));
    const priorWatermark = this.processedSeq;
    for (const raw of incoming) {
      const msg = { ...clone(raw), ...provenance(raw) };
      const recent = this.messages.findIndex(m => m.id === msg.id), folded = this.summaryRecords.findIndex(m => m.id === msg.id);
      if (recent >= 0) this.messages[recent] = msg;
      else if (folded >= 0) this.summaryRecords[folded] = this._summaryRecord(msg);
      else if (seqOf(msg) > priorWatermark || seqOf(msg) === -1 && !this.seenMessages.has(msg.id)) this.messages.push(msg);
      else continue;
      this.seenMessages.set(msg.id, seqOf(msg));
      this.processedSeq = Math.max(this.processedSeq, seqOf(msg));
      this._checkMilestone(msg);
    }
    this.messages.sort((a, b) => seqOf(a) - seqOf(b) || String(a.id).localeCompare(String(b.id)));
    this._compactIfNeeded();
    while (this.seenMessages.size > this.maxSeenMessages) this.seenMessages.delete(this.seenMessages.keys().next().value);
  }
  _checkMilestone(msg) {
    const content = msg.content || '';
    const type = /(?:смерть|умер|killed|death|fallen in battle|погиб)/iu.test(content) ? 'death'
      : /(?:level up|новый уровень|повышение уровня)/iu.test(content) ? 'level_up'
      : /(?:артефакт|легендарный предмет|получил артефакт|quest complete)/iu.test(content) ? 'quest_item' : null;
    const previous = this.milestones.find(m => m.id === msg.id);
    this.milestones = this.milestones.filter(m => m.id !== msg.id);
    if (type) this.milestones.push({ id: msg.id, sourceId: msg.id, seq: msg.seq, ...provenance(msg),
      time: msg.createdAt ?? previous?.time ?? null, type, text: content.slice(0, 150) });
    this.milestones.sort((a,b) => seqOf(a)-seqOf(b));
    this.milestones = this.milestones.slice(-25);
  }
  _summaryRecord(msg) {
    return { id: msg.id, seq: msg.seq, updatedSeq: msg.updatedSeq ?? msg.seq, revision: msg.revision ?? msg.version ?? null,
      ...provenance(msg), content: String(msg.content ?? '').slice(0, this.summaryLimitChars) };
  }
  _compactIfNeeded() {
    while (this.messages.length > this.maxRecentMessages) {
      const count = Math.min(this.compactionBatchSize, this.messages.length - this.maxRecentMessages);
      for (const msg of this.messages.splice(0, count)) {
        this.compactedThroughSeq = Math.max(this.compactedThroughSeq, seqOf(msg));
        this.summaryRecords.push(this._summaryRecord(msg));
      }
    }
    let chars = this.summaryRecords.reduce((sum, item) => sum + recordLine(item).length + 1, 0);
    while (chars > this.summaryLimitChars && this.summaryRecords.length > 1) chars -= recordLine(this.summaryRecords.shift()).length + 1;
    if (this.summaryRecords.length === 1) {
      const item = this.summaryRecords[0];
      const overhead = recordLine({ ...item, content: '' }).length;
      if (overhead > this.summaryLimitChars) this.summaryRecords = [];
      else item.content = item.content.slice(0, Math.max(0, this.summaryLimitChars - overhead));
    }
    this._rebuildSummary();
  }
  _rebuildSummary() {
    this.summaries = new Map();
    for (const item of this.summaryRecords) {
      const key = item.legacy ? 'legacy:dm-only' : item.roomId ? `room:${item.roomId}` : `channel:${item.channel}`;
      this.summaries.set(key, [this.summaries.get(key), recordLine(item)].filter(Boolean).join('\n'));
    }
    this.summary = this.summaryRecords.map(recordLine).join('\n');
  }
  getPromptContext(scope = null, options = {}) {
    const roomId = typeof scope === 'string' ? scope : scope?.roomId ?? null;
    const config = scope && typeof scope === 'object' ? scope : options;
    const audience = typeof config.viewerUserId === 'string' && config.viewerUserId ? [config.viewerUserId]
      : Array.isArray(config.audienceUserIds) ? ids(config.audienceUserIds) : null;
    const permitted = value => visible(value, roomId, audience);
    const encounters = this.encounters.length ? this.encounters : this.encounter ? [this.encounter] : [];
    return clone({ summary: this.summaryRecords.filter(permitted).map(recordLine).join('\n'),
      summaryRecords: this.summaryRecords.filter(permitted), summarySegments: this.summarySegments.filter(permitted),
      milestones: this.milestones.filter(permitted), recentMessages: this.messages.filter(permitted), recentRolls: this.rolls.filter(permitted),
      activeEncounter: encounters.find(permitted) ?? null, encounters: encounters.filter(permitted),
      characters: Array.from(this.sheets.values()).filter(permitted).map(s => ({ id:s.id,name:s.name,hp:s.hp,ac:s.ac,class:s.class,level:s.level,...provenance(s) })) });
  }
  serializeState({ safe = false } = {}) {
    if (safe) return { campaignId: this.campaignId, messageCount: this.messages.length, rollCount: this.rolls.length,
      sheetCount: this.sheets.size, roomCount: new Set([...this.messages, ...this.summaryRecords].map(m => m.roomId).filter(Boolean)).size, milestoneCount: this.milestones.length };
    return clone({ version: 3, formatVersion: 3, campaignId: this.campaignId, timelineEpoch: this.timelineEpoch, timelineId: this.timelineEpoch,
      processedSeq: this.processedSeq, compactedThroughSeq: this.compactedThroughSeq, lastCurrentSeq: this.lastCurrentSeq,
      summary: this.summary, summaryRecords: this.summaryRecords, summarySegments: this.summarySegments,
      messages: this.messages, rolls: this.rolls, sheets: Array.from(this.sheets.values()), encounter: this.encounter,
      encounters: this.encounters, milestones: this.milestones, seenMessages: Array.from(this.seenMessages) });
  }
  restoreState(state) {
    if (!state || typeof state !== 'object') return;
    if (this.campaignId && state.campaignId && this.campaignId !== state.campaignId) throw new Error('Narrator checkpoint belongs to another campaign.');
    this.reset({ campaignId: state.campaignId || this.campaignId, timelineEpoch: state.timelineEpoch ?? state.timelineId ?? null });
    if ([2,3].includes(state.version) && Array.isArray(state.summaryRecords)) {
      this.summaryRecords = clone(state.summaryRecords.filter(item => item?.id).map(item => ({ ...item, ...provenance(item) })));
    } else if (state.formatVersion === 2 && Array.isArray(state.summarySegments)) {
      this.summaryRecords = state.summarySegments.map((item,index) => ({ id:item.sourceId ?? `migrated-segment-${index}`,seq:item.fromSeq ?? -1,
        updatedSeq:item.toSeq ?? item.fromSeq ?? -1,revision:item.version ?? null,...provenance(item),content:String(item.text ?? '') }));
      this._legacy(state.legacySummary);
    } else this._legacy(state.summary || Object.values(state.summaries ?? {}).filter(v => typeof v === 'string').join('\n'));
    this.messages = clone((Array.isArray(state.messages) ? state.messages : []).filter(m => m?.id && !isOoc(m)).map(m => ({ ...m, ...provenance(m) })));
    this.rolls = clone((Array.isArray(state.rolls) ? state.rolls : []).slice(-this.maxRecentRolls));
    this.sheets = new Map((Array.isArray(state.sheets) ? state.sheets : []).filter(s => s?.id).slice(0, 256).map(s => [s.id, clone(s)]));
    this.encounter = clone(state.encounter ?? null);
    this.encounters = clone((Array.isArray(state.encounters) ? state.encounters : this.encounter ? [this.encounter] : []).slice(0, 128));
    this.milestones = clone((Array.isArray(state.milestones) ? state.milestones : []).slice(-25).map(m => ({ ...m, id:m.id ?? m.sourceId, ...provenance(m) })));
    this.compactedThroughSeq = Number.isSafeInteger(state.compactedThroughSeq) ? state.compactedThroughSeq : -1;
    this.processedSeq = Math.max(Number.isSafeInteger(state.processedSeq) ? state.processedSeq : -1,
      this.compactedThroughSeq, ...this.messages.map(seqOf), ...this.summaryRecords.map(seqOf));
    this.lastCurrentSeq = Number.isSafeInteger(state.lastCurrentSeq) ? state.lastCurrentSeq : null;
    this.seenMessages = new Map((Array.isArray(state.seenMessages) ? state.seenMessages : []).slice(-this.maxSeenMessages));
    for (const item of [...this.messages, ...this.summaryRecords]) this.seenMessages.set(item.id, seqOf(item));
    this._compactIfNeeded();
  }
}
