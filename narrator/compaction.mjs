/**
 * Host Context Compaction & Working Memory Manager for the External Narrator.
 * Keeps memory bounded during multi-hour campaigns, manages rolling scene summaries,
 * preserves critical milestones (deaths, level-ups, boss defeats), and ensures
 * the model prompt stays within token budget.
 */
export class HostContextMemory {
  constructor(options = {}) {
    this.maxRecentMessages = Number(options.maxRecentMessages ?? 30);
    this.maxRecentRolls = Number(options.maxRecentRolls ?? 20);
    this.compactionBatchSize = Number(options.compactionBatchSize ?? 15);
    this.summaryLimitChars = Number(options.summaryLimitChars ?? 6_000);

    this.campaignId = options.campaignId || '';
    this.summary = options.initialSummary || '';
    this.summaries = new Map();
    this.messages = [];
    this.rolls = [];
    this.milestones = [];
    this.sheets = new Map();
    this.encounter = null;
  }

  /**
   * Updates host memory from a fresh narrator read payload.
   * @param {object} snapshot
   */
  ingestReadSnapshot(snapshot) {
    if (!snapshot) return;

    if (snapshot.campaignId) this.campaignId = snapshot.campaignId;

    if (Array.isArray(snapshot.sheets)) {
      for (const sheet of snapshot.sheets) {
        if (sheet?.id) this.sheets.set(sheet.id, sheet);
      }
    }

    if (snapshot.encounter !== undefined) {
      this.encounter = snapshot.encounter;
    }

    if (Array.isArray(snapshot.recentRolls)) {
      for (const roll of snapshot.recentRolls) {
        if (!this.rolls.some(r => r.id === roll.id)) {
          this.rolls.push(roll);
        }
      }
      if (this.rolls.length > this.maxRecentRolls) {
        this.rolls = this.rolls.slice(-this.maxRecentRolls);
      }
    }

    // `messages` is the authoritative incremental feed. `recentMessages` is
    // the legacy/backfill feed; ingesting only the latter silently drops room
    // actions after the host cursor has advanced.
    const incoming = [
      ...(Array.isArray(snapshot.recentMessages) ? snapshot.recentMessages : []),
      ...(Array.isArray(snapshot.messages) ? snapshot.messages : []),
    ];
    for (const msg of incoming) {
      if (!msg?.id || this.messages.some(m => m.id === msg.id)) continue;
      this.messages.push(msg);
      this._checkMilestone(msg);
    }
    this.messages.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.id).localeCompare(String(b.id)));
    this._compactIfNeeded();
  }

  _checkMilestone(msg) {
    const text = msg.content || '';
    const scope = msg.roomId || null;
    const milestone = type => ({ seq: msg.seq, roomId: scope, time: new Date().toISOString(), type, text: text.slice(0, 150) });
    if (/(?:смерть|умер|killed|death|fallen in battle|погиб)/iu.test(text)) {
      this.milestones.push(milestone('death'));
    } else if (/(?:level up|новый уровень|повышение уровня)/iu.test(text)) {
      this.milestones.push(milestone('level_up'));
    } else if (/(?:артефакт|легендарный предмет|получил артефакт|quest complete)/iu.test(text)) {
      this.milestones.push(milestone('quest_item'));
    }

    if (this.milestones.length > 25) {
      this.milestones = this.milestones.slice(-25);
    }
  }

  _compactIfNeeded() {
    while (this.messages.length > this.maxRecentMessages) {
      const count = Math.min(this.compactionBatchSize, this.messages.length - this.maxRecentMessages);
      const toCompact = this.messages.slice(0, count);
      this.messages = this.messages.slice(count);

      for (const msg of toCompact) {
        if (msg.content?.startsWith('(ooc)')) continue;
        const scope = msg.roomId ? `room:${msg.roomId}` : `channel:${msg.channel || 'global'}`;
        const line = `[#${msg.seq ?? '?'}] ${msg.authorName || 'Speaker'}: ${msg.content}`;
        const current = this.summaries.get(scope) || '';
        const next = `${current}${current ? '\n' : `[Прошедшие события]: ${scope}\n`}${line}`;
        this.summaries.set(scope, next.slice(-this.summaryLimitChars));
      }
    }
    this.summary = [...this.summaries.values()].join('\n\n').slice(-this.summaryLimitChars);
  }

  /**
   * Builds the bounded context representation to provide to the model or prompt.
   * @returns {{ summary: string, milestones: Array, recentMessages: Array, recentRolls: Array, activeEncounter: object|null }}
   */
  getPromptContext(scope = null) {
    const scopedMessages = scope
      ? this.messages.filter(message => message.roomId === scope || (!message.roomId && message.channel === 'global'))
      : this.messages;
    const scopedSummary = scope
      ? [this.summaries.get(`room:${scope}`), this.summaries.get('channel:global')].filter(Boolean).join('\n\n')
      : this.summary;
    return {
      summary: scopedSummary,
      milestones: this.milestones.filter(m => !scope || m.roomId === scope || !m.roomId),
      recentMessages: [...scopedMessages],
      recentRolls: [...this.rolls],
      activeEncounter: this.encounter ? { ...this.encounter } : null,
      characters: Array.from(this.sheets.values()).map(s => ({
        id: s.id,
        name: s.name,
        hp: s.hp,
        ac: s.ac,
        class: s.class,
        level: s.level,
      })),
    };
  }

  serializeState({ safe = false } = {}) {
    if (safe) {
      return {
        campaignId: this.campaignId,
        messageCount: this.messages.length,
        rollCount: this.rolls.length,
        sheetCount: this.sheets.size,
        roomCount: new Set(this.messages.map(message => message.roomId).filter(Boolean)).size,
        milestoneCount: this.milestones.length,
      };
    }
    return {
      campaignId: this.campaignId,
      summary: this.summary,
      summaries: Object.fromEntries(this.summaries),
      messages: this.messages,
      rolls: this.rolls,
      sheets: Array.from(this.sheets.values()),
      encounter: this.encounter,
      milestones: this.milestones,
    };
  }

  restoreState(state) {
    if (!state) return;
    if (state.summary) this.summary = state.summary;
    if (state.summaries && typeof state.summaries === 'object') this.summaries = new Map(Object.entries(state.summaries));
    if (Array.isArray(state.messages)) this.messages = state.messages.slice(-this.maxRecentMessages);
    if (Array.isArray(state.rolls)) this.rolls = state.rolls.slice(-this.maxRecentRolls);
    if (Array.isArray(state.sheets)) this.sheets = new Map(state.sheets.filter(s => s?.id).map(s => [s.id, s]));
    if (state.encounter !== undefined) this.encounter = state.encounter;
    if (Array.isArray(state.milestones)) this.milestones = [...state.milestones];
  }
}
