import type { ConcentrationSource, ConditionMetaMap, Ability } from "@/lib/schemas/sheet";

type Meta = ConditionMetaMap[string];
type Duration = { rounds?: number; saveEnds?: { ability: Ability; dc: number } };
type Source = ConcentrationSource & Duration;
export type ConditionSaveDue = { name: string; ability: Ability; dc: number; sourceInstanceId?: string; independent?: boolean };
type State = { conditions: string[]; meta: ConditionMetaMap };
const duration = (entry: Duration = {}): Duration => ({
  ...(entry.rounds === undefined ? {} : { rounds: entry.rounds }),
  ...(entry.saveEnds ? { saveEnds: entry.saveEnds } : {}),
});
export const sameConcentrationOwner = (source: ConcentrationSource, owner: Pick<ConcentrationSource, "casterId" | "casterKind" | "spell">) =>
  source.casterId === owner.casterId && source.casterKind === owner.casterKind &&
  source.spell.trim().toLowerCase() === owner.spell.trim().toLowerCase();

// The plain condition name stays active while at least one application lives.
// Never infer ownership of a pre-existing effect from its name.
export function sourceMeta(sources: Source[], independent?: Duration): Meta | null {
  if (!sources.length) return independent === undefined ? null : duration(independent);
  const entries: Duration[] = [...sources, ...(independent === undefined ? [] : [independent])];
  const timed = entries.every(entry => entry.rounds !== undefined);
  return {
    ...(timed ? { rounds: Math.max(...entries.map(entry => entry.rounds!)) } : {}),
    ...(entries.length === 1 && entries[0].saveEnds ? { saveEnds: entries[0].saveEnds } : {}),
    concentrationSources: sources,
    ...(independent === undefined ? {} : { independent: duration(independent) }),
  };
}

export function addConditionSource(conditions: string[], meta: ConditionMetaMap, name: string, source: ConcentrationSource, timing: Duration): State {
  const present = conditions.includes(name), old = meta[name];
  const sources = old?.concentrationSources ?? [];
  if (sources.some(entry => entry.instanceId === source.instanceId)) return { conditions, meta };
  if (sources.length >= 128) throw new Error("Too many independent sources for this condition.");
  if (!present && conditions.length >= 15) throw new Error("Character already has 15 conditions.");
  const independent = sources.length ? old.independent : present ? duration(old) : undefined;
  return {
    conditions: present ? conditions : [...conditions, name],
    meta: { ...meta, [name]: sourceMeta([...sources, { ...source, ...duration(timing) }], independent)! },
  };
}

function updateCondition(state: State, name: string, value: Meta | null): State {
  const meta = { ...state.meta };
  if (value === null) {
    delete meta[name];
    return { conditions: state.conditions.filter(entry => entry !== name), meta };
  }
  meta[name] = value;
  return { conditions: state.conditions, meta };
}

export function removeConcentrationSources(conditions: string[], meta: ConditionMetaMap, owner: Pick<ConcentrationSource, "casterId" | "casterKind" | "spell">): State {
  let state = { conditions, meta };
  for (const name of conditions) {
    const entry = state.meta[name], sources = entry?.concentrationSources;
    if (!sources?.some(source => sameConcentrationOwner(source, owner))) continue;
    state = updateCondition(state, name, sourceMeta(sources.filter(source => !sameConcentrationOwner(source, owner)), entry.independent));
  }
  return state;
}

// Adapt the existing duration engine instead of creating another rule set.
// Each application gets its own tick and save; a success ends only that one.
export function tickSourcedConditions(
  conditions: string[], meta: ConditionMetaMap,
  tick: (conditions: string[], meta: ConditionMetaMap) => State & { expired: string[]; savesDue: ConditionSaveDue[] },
): State & { expired: string[]; savesDue: ConditionSaveDue[] } {
  let state = { conditions, meta };
  const expired: string[] = [], savesDue: ConditionSaveDue[] = [];
  for (const name of conditions) {
    const entry = meta[name];
    if (!entry?.concentrationSources?.length) {
      const result = tick([name], entry ? { [name]: entry } : {});
      if (!result.conditions.includes(name)) { state = updateCondition(state, name, null); expired.push(name); }
      else if (result.meta[name]) state = updateCondition(state, name, result.meta[name]);
      savesDue.push(...result.savesDue);
      continue;
    }
    const kept: Source[] = [];
    for (const source of entry.concentrationSources) {
      const result = tick([name], { [name]: duration(source) });
      if (!result.conditions.includes(name)) continue;
      const { rounds: _rounds, saveEnds: _save, ...identity } = source;
      kept.push({ ...identity, ...duration(result.meta[name]) });
      savesDue.push(...result.savesDue.map(due => ({ ...due, sourceInstanceId: source.instanceId })));
    }
    let independent: Duration | undefined;
    if (entry.independent !== undefined) {
      const result = tick([name], { [name]: entry.independent });
      if (result.conditions.includes(name)) independent = duration(result.meta[name]);
      savesDue.push(...result.savesDue.map(due => ({ ...due, independent: true })));
    }
    const next = sourceMeta(kept, independent);
    state = updateCondition(state, name, next);
    if (next === null) expired.push(name);
  }
  return { ...state, expired, savesDue };
}

export function clearConditionSave(conditions: string[], meta: ConditionMetaMap, due: ConditionSaveDue): State {
  const entry = meta[due.name];
  if (!due.sourceInstanceId && !due.independent) return updateCondition({ conditions, meta }, due.name, null);
  if (!entry?.concentrationSources?.length) {
    // The final spell instance may have expired earlier in this same tick,
    // leaving only the independent condition and its pending save.
    return due.independent ? updateCondition({ conditions, meta }, due.name, null) : { conditions, meta };
  }
  return updateCondition({ conditions, meta }, due.name, sourceMeta(
    entry.concentrationSources.filter(source => source.instanceId !== due.sourceInstanceId),
    due.independent ? undefined : entry.independent,
  ));
}

export function hasConcentrationSource(meta: ConditionMetaMap, source: ConcentrationSource): boolean {
  return Object.values(meta).some(entry => entry.concentrationSources?.some(value => value.instanceId === source.instanceId));
}
