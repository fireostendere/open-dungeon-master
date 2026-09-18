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

    if (Array.isArray(snapshot.recentMessages)) {
      for (const msg of snapshot.recentMessages) {
        if (!this.messages.some(m => m.id === msg.id)) {
          this.messages.push(msg);
          // Detect milestone events in message text or meta
          this._checkMilestone(msg);
        }
      }
      this._compactIfNeeded();
    }
  }

  _checkMilestone(msg) {
    const text = msg.content || '';
    if (/(?:смерть|умер|killed|death|fallen in battle|погиб)/iu.test(text)) {
      this.milestones.push({ seq: msg.seq, time: new Date().toISOString(), type: 'death', text: text.slice(0, 150) });
    } else if (/(?:level up|новый уровень|повышение уровня)/iu.test(text)) {
      this.milestones.push({ seq: msg.seq, time: new Date().toISOString(), type: 'level_up', text: text.slice(0, 150) });
    } else if (/(?:артефакт|легендарный предмет|получил артефакт|quest complete)/iu.test(text)) {
      this.milestones.push({ seq: msg.seq, time: new Date().toISOString(), type: 'quest_item', text: text.slice(0, 150) });
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

      const foldLines = toCompact
        .filter(m => !m.content?.startsWith('(ooc)'))
        .map(m => `[#${m.seq ?? '?'}] ${m.authorName || 'Speaker'}: ${m.content}`);

      if (foldLines.length > 0) {
        const addition = foldLines.join('\n');
        if (this.summary) {
          this.summary = `${this.summary}\n\n[Прошедшие события]:\n${addition}`;
        } else {
          this.summary = `[Прошедшие события]:\n${addition}`;
        }

        if (this.summary.length > this.summaryLimitChars) {
          this.summary = this.summary.slice(-this.summaryLimitChars);
        }
      }
    }
  }

  /**
   * Builds the bounded context representation to provide to the model or prompt.
   * @returns {{ summary: string, milestones: Array, recentMessages: Array, recentRolls: Array, activeEncounter: object|null }}
   */
  getPromptContext() {
    return {
      summary: this.summary,
      milestones: [...this.milestones],
      recentMessages: [...this.messages],
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

  serializeState() {
    return {
      campaignId: this.campaignId,
      summary: this.summary,
      milestones: this.milestones,
      messageCount: this.messages.length,
      rollCount: this.rolls.length,
      sheetCount: this.sheets.size,
    };
  }

  restoreState(state) {
    if (!state) return;
    if (state.summary) this.summary = state.summary;
    if (Array.isArray(state.milestones)) this.milestones = [...state.milestones];
  }
}
