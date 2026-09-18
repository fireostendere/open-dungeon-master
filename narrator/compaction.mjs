/** Bounded narrator memory. A room is not an audience: keep publication-time
 * witnesses on every record, including extractive summaries and milestones.
 * Unlabelled legacy memory is DM-only, never implicitly public knowledge.
 */
const clone = value => value == null ? value : structuredClone(value);
const bounded = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
const seqOf = value => Number.isSafeInteger(value?.seq) && value.seq >= 0 ? value.seq : -1;
const isOoc = value => value?.kind === 'ooc' || /^\s*\(ooc\)/i.test(value?.content ?? '');
const roomOf = value => value?.roomId ?? value?.encounter?.roomId ?? null;
function provenance(value) {
  return {
    roomId: roomOf(value),
    channel: value?.channel === 'global' || value?.visibility === 'global' ? 'global' : 'private',
    witnessUserIds: [...new Set((value?.witnessUserIds ?? []).filter(id => typeof id === 'string'))].sort(),
    aspects: [...new Set((value?.aspects ?? []).filter(item => typeof item === 'string'))].sort(),
  };
}
function visible(value, scope, viewer) {
  if (scope && roomOf(value) !== scope && value?.channel !== 'global' && value?.visibility !== 'global') return false;
  if (!viewer) return true; // Explicit DM context, not a player projection.
  return value?.channel === 'global' || value?.visibility === 'global' || value?.witnessUserIds?.includes(viewer);
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
    this.campaignId = options.campaignId || '';
    this.reset();
    if (options.initialSummary) this._legacy(options.initialSummary);
  }

  reset({ campaignId = this.campaignId, timelineId = null } = {}) {
    this.campaignId = campaignId;
    this.timelineId = timelineId;
    this.processedSeq = -1;
    this.lastCurrentSeq = null;
    this.summary = '';
    this.summaries = new Map();
    this.summaryRecords = [];
    this.messages = [];
    this.rolls = [];
    this.milestones = [];
    this.sheets = new Map();
    this.encounter = null;
    this.encounters = [];
  }

  _legacy(content, id = 'legacy-summary') {
    if (typeof content !== 'string' || !content) return;
    this.summaryRecords.push({ id, seq: -1, roomId: null, channel: 'private', witnessUserIds: [], aspects: [], legacy: true,
      content: content.slice(-this.summaryLimitChars) });
    this._rebuildSummary();
  }

  ingestReadSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const campaignId = snapshot.campaignId ?? snapshot.campaign?.id ?? this.campaignId;
    if (this.campaignId && campaignId && campaignId !== this.campaignId) throw new Error('Narrator memory belongs to another campaign.');
    const timelineId = snapshot.timelineId ?? snapshot.campaign?.timelineId ?? this.timelineId;
    if ((this.timelineId !== null && timelineId !== this.timelineId) ||
        (Number.isSafeInteger(snapshot.currentSeq) && this.lastCurrentSeq !== null && snapshot.currentSeq < this.lastCurrentSeq)) {
      this.reset({ campaignId, timelineId });
    }
    this.campaignId = campaignId;
    this.timelineId = timelineId;
    if (Number.isSafeInteger(snapshot.currentSeq)) this.lastCurrentSeq = snapshot.currentSeq;
    if (Array.isArray(snapshot.sheets)) this.sheets = new Map(snapshot.sheets.filter(s => s?.id).slice(0, 256).map(s => [s.id, clone(s)]));
    if (snapshot.encounter !== undefined) this.encounter = clone(snapshot.encounter);
    if (Array.isArray(snapshot.encounters)) this.encounters = clone(snapshot.encounters.slice(0, 128));
    for (const roll of snapshot.recentRolls ?? []) {
      if (!roll?.id) continue;
      const index = this.rolls.findIndex(item => item.id === roll.id);
      if (index >= 0) this.rolls[index] = clone(roll); else this.rolls.push(clone(roll));
    }
    this.rolls = this.rolls.slice(-this.maxRecentRolls);

    // Sort the combined backfill and incremental feed before advancing a
    // watermark. A repeated full read must not re-fold evicted old messages.
    const incoming = [...(snapshot.recentMessages ?? []), ...(snapshot.messages ?? [])]
      .filter(msg => msg?.id && !isOoc(msg)).sort((a, b) => seqOf(a) - seqOf(b));
    const priorWatermark = this.processedSeq;
    for (const raw of incoming) {
      const msg = { ...clone(raw), ...provenance(raw) };
      const recent = this.messages.findIndex(m => m.id === msg.id);
      const folded = this.summaryRecords.findIndex(m => m.id === msg.id);
      if (recent >= 0) {
        this.messages[recent] = msg;
      } else if (folded >= 0) {
        this.summaryRecords[folded] = this._summaryRecord(msg);
      } else if (seqOf(msg) > priorWatermark || seqOf(msg) === -1) {
        this.messages.push(msg);
      } else {
        // Evicted backfill is already processed. Older corrections must be
        // delivered as a new version/event, not silently resurrected history.
        continue;
      }
      this.processedSeq = Math.max(this.processedSeq, seqOf(msg));
      this._checkMilestone(msg);
    }
    this.messages.sort((a, b) => seqOf(a) - seqOf(b) || String(a.id).localeCompare(String(b.id)));
    this._compactIfNeeded();
  }

  _checkMilestone(msg) {
    const content = msg.content || '';
    const type = /(?:смерть|умер|killed|death|fallen in battle|погиб)/iu.test(content) ? 'death'
      : /(?:level up|новый уровень|повышение уровня)/iu.test(content) ? 'level_up'
      : /(?:артефакт|легендарный предмет|получил артефакт|quest complete)/iu.test(content) ? 'quest_item' : null;
    this.milestones = this.milestones.filter(m => m.id !== msg.id);
    if (type) this.milestones.push({ id: msg.id, seq: msg.seq, ...provenance(msg), type, text: content.slice(0, 150) });
    this.milestones = this.milestones.slice(-25);
  }

  _summaryRecord(msg) {
    return { id: msg.id, seq: msg.seq, revision: msg.revision ?? msg.version ?? null, ...provenance(msg),
      content: String(msg.content ?? '').slice(0, this.summaryLimitChars) };
  }

  _compactIfNeeded() {
    while (this.messages.length > this.maxRecentMessages) {
      const count = Math.min(this.compactionBatchSize, this.messages.length - this.maxRecentMessages);
      for (const msg of this.messages.splice(0, count)) this.summaryRecords.push(this._summaryRecord(msg));
    }
    // Bound the aggregate, not a separate 6K budget for each possible room.
    let chars = this.summaryRecords.reduce((sum, item) => sum + recordLine(item).length + 1, 0);
    while (chars > this.summaryLimitChars && this.summaryRecords.length > 1) {
      chars -= recordLine(this.summaryRecords.shift()).length + 1;
    }
    if (this.summaryRecords.length === 1) {
      const item = this.summaryRecords[0];
      const overhead = recordLine({ ...item, content: '' }).length;
      item.content = item.content.slice(0, Math.max(0, this.summaryLimitChars - overhead));
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

  // String scope is the DM's view of one room. For a player-facing recap,
  // pass { roomId, viewerUserId }; unknown audience metadata is denied.
  getPromptContext(scope = null) {
    const roomId = typeof scope === 'string' ? scope : scope?.roomId ?? null;
    const viewer = typeof scope === 'object' ? scope?.viewerUserId ?? null : null;
    const permitted = value => visible(value, roomId, viewer) && (!value.legacy || (!roomId && !viewer));
    const encounters = this.encounters.length ? this.encounters : this.encounter ? [this.encounter] : [];
    return clone({
      summary: this.summaryRecords.filter(permitted).map(recordLine).join('\n'),
      summaryRecords: this.summaryRecords.filter(permitted),
      milestones: this.milestones.filter(permitted),
      recentMessages: this.messages.filter(permitted),
      recentRolls: this.rolls.filter(permitted),
      activeEncounter: encounters.find(permitted) ?? null,
      characters: Array.from(this.sheets.values()).filter(permitted).map(s => ({
        id: s.id, name: s.name, hp: s.hp, ac: s.ac, class: s.class, level: s.level, ...provenance(s),
      })),
    });
  }

  serializeState({ safe = false } = {}) {
    if (safe) return {
      campaignId: this.campaignId, messageCount: this.messages.length, rollCount: this.rolls.length,
      sheetCount: this.sheets.size, roomCount: new Set([...this.messages, ...this.summaryRecords].map(m => m.roomId).filter(Boolean)).size,
      milestoneCount: this.milestones.length,
    };
    return clone({ version: 2, campaignId: this.campaignId, timelineId: this.timelineId, processedSeq: this.processedSeq,
      lastCurrentSeq: this.lastCurrentSeq, summary: this.summary, summaryRecords: this.summaryRecords,
      messages: this.messages, rolls: this.rolls, sheets: Array.from(this.sheets.values()),
      encounter: this.encounter, encounters: this.encounters, milestones: this.milestones });
  }

  restoreState(state) {
    if (!state || typeof state !== 'object') return;
    if (this.campaignId && state.campaignId && this.campaignId !== state.campaignId) throw new Error('Narrator checkpoint belongs to another campaign.');
    this.reset({ campaignId: state.campaignId || this.campaignId, timelineId: state.timelineId ?? null });
    if (state.version === 2 && Array.isArray(state.summaryRecords)) {
      this.summaryRecords = clone(state.summaryRecords.filter(item => item?.id).map(item => ({ ...item, ...provenance(item) })));
    } else {
      // Old per-room summaries lost witness provenance. Preserve them for
      // the DM, but never upgrade them into current occupants' knowledge.
      const legacy = state.summary || Object.values(state.summaries ?? {}).filter(v => typeof v === 'string').join('\n');
      this._legacy(legacy);
    }
    this.messages = clone((state.messages ?? []).filter(m => m?.id && !isOoc(m)).map(m => ({ ...m, ...provenance(m) })));
    this.rolls = clone((state.rolls ?? []).slice(-this.maxRecentRolls));
    this.sheets = new Map((state.sheets ?? []).filter(s => s?.id).slice(0, 256).map(s => [s.id, clone(s)]));
    this.encounter = clone(state.encounter ?? null);
    this.encounters = clone((state.encounters ?? []).slice(0, 128));
    this.milestones = clone((state.milestones ?? []).slice(-25).map(m => ({ ...m, ...provenance(m) })));
    this.processedSeq = Math.max(Number.isSafeInteger(state.processedSeq) ? state.processedSeq : -1,
      ...this.messages.map(seqOf), ...this.summaryRecords.map(seqOf));
    this.lastCurrentSeq = Number.isSafeInteger(state.lastCurrentSeq) ? state.lastCurrentSeq : null;
    this._compactIfNeeded();
  }
}
