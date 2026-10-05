import crypto from 'node:crypto';

export const NARRATOR_STATE_DELTA_FORMAT = 'odm.state.delta.v1';
export const NARRATOR_STATE_PATCH_FORMAT = 'odm.state.patch.v1';

export const NARRATOR_PATCHABLE_KEYS = Object.freeze([
  'campaign',
  'directorDirective',
  'spatial',
  'spatialRooms',
  'spatialGrants',
  'summary',
  'members',
  'pendingRolls',
  'playerWhispers',
  'sheets',
  'facts',
  'notes',
  'npcs',
  'recentMessages',
  'recentRolls',
  'recentDmWhispers',
  'chapters',
  'location',
  'partyPositions',
  'sceneTracker',
  'encounter',
  'fights',
  'battleMaps',
]);

const entityArrayKeys = new Set([
  'battleMaps',
  'pendingRolls',
  'playerWhispers',
  'sheets',
  'facts',
  'notes',
  'npcs',
  'recentMessages',
  'recentRolls',
  'chapters',
  'spatialRooms',
]);

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const clone = value => value === undefined ? undefined : structuredClone(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function narratorStateScope({ campaignId, timelineEpoch, principal, projection = 'live' }) {
  return JSON.stringify([campaignId, timelineEpoch, principal, projection]);
}

export function extractNarratorState(value) {
  const result = {};
  for (const key of NARRATOR_PATCHABLE_KEYS) {
    if (Object.hasOwn(value ?? {}, key)) result[key] = clone(value[key]);
  }
  return result;
}

export function narratorStateRevision(scope, state) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({ scope, state }))).digest('hex');
}

const itemDigest = item => crypto.createHash('sha256').update(JSON.stringify(canonical(item))).digest('hex');
const entityId = item => item && (typeof item.id === 'string' || typeof item.id === 'number') ? String(item.id) : null;
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function entityPatch(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  if (![...before, ...after].every(item => entityId(item) !== null)) return null;
  const beforeIds = before.map(entityId), afterIds = after.map(entityId);
  if (new Set(beforeIds).size !== beforeIds.length || new Set(afterIds).size !== afterIds.length) return null;
  const previous = new Map(before.map(item => [entityId(item), item]));
  const current = new Map(after.map(item => [entityId(item), item]));
  const upsert = [], update = {};
  for (const [id, item] of current) {
    if (!previous.has(id)) { upsert.push(clone(item)); continue; }
    if (itemDigest(previous.get(id)) === itemDigest(item)) continue;
    // A changed entity carries only its changed fields (one HP tick must not resend a
    // whole character sheet), plus its name so an LLM reader knows whose fields these are.
    const fields = deepPatch(previous.get(id), item);
    if (typeof item.name === 'string' && !fields.set?.name) fields.set = { ...fields.set, name: item.name };
    if (JSON.stringify(fields).length < JSON.stringify(item).length) update[id] = fields;
    else upsert.push(clone(item));
  }
  const remove = [...previous.keys()].filter(id => !current.has(id));
  const beforeOrder = beforeIds, afterOrder = afterIds;
  const order = JSON.stringify(beforeOrder) === JSON.stringify(afterOrder) ? undefined : afterOrder;
  return { upsert, remove, ...(Object.keys(update).length ? { update } : {}), ...(order ? { order } : {}) };
}

function deepPatch(before, after) {
  const patch = { set: {}, unset: [], objects: {}, entities: {} };
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (forbidden.has(key)) continue;
    const hasBefore = Object.hasOwn(before ?? {}, key), hasAfter = Object.hasOwn(after ?? {}, key);
    if (!hasAfter) { patch.unset.push(key); continue; }
    if (!hasBefore) { patch.set[key] = clone(after[key]); continue; }
    if (itemDigest(before[key]) === itemDigest(after[key])) continue;
    const entities = entityPatch(before[key], after[key]);
    if (entities) { patch.entities[key] = entities; continue; }
    if (plainObject(before[key]) && plainObject(after[key])) {
      const nested = deepPatch(before[key], after[key]);
      if (Object.keys(nested).length) patch.objects[key] = nested;
      continue;
    }
    patch.set[key] = clone(after[key]);
  }
  if (!Object.keys(patch.set).length) delete patch.set;
  if (!patch.unset.length) delete patch.unset;
  if (!Object.keys(patch.objects).length) delete patch.objects;
  if (!Object.keys(patch.entities).length) delete patch.entities;
  return patch;
}

export function createNarratorStatePatch(before, after) {
  const patch = { format: NARRATOR_STATE_PATCH_FORMAT, set: {}, unset: [], objects: {}, entities: {} };
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (!NARRATOR_PATCHABLE_KEYS.includes(key) || forbidden.has(key)) continue;
    const hasBefore = Object.hasOwn(before ?? {}, key), hasAfter = Object.hasOwn(after ?? {}, key);
    if (!hasAfter) { patch.unset.push(key); continue; }
    if (!hasBefore) { patch.set[key] = clone(after[key]); continue; }
    if (itemDigest(before[key]) === itemDigest(after[key])) continue;
    const entities = entityArrayKeys.has(key) ? entityPatch(before[key], after[key]) : null;
    if (entities) { patch.entities[key] = entities; continue; }
    if (plainObject(before[key]) && plainObject(after[key])) {
      const nested = deepPatch(before[key], after[key]);
      if (Object.keys(nested).length) patch.objects[key] = nested;
      continue;
    }
    patch.set[key] = clone(after[key]);
  }
  if (!Object.keys(patch.set).length) delete patch.set;
  if (!patch.unset.length) delete patch.unset;
  if (!Object.keys(patch.objects).length) delete patch.objects;
  if (!Object.keys(patch.entities).length) delete patch.entities;
  return patch;
}

function applyEntityPatch(before, change) {
  if (!Array.isArray(before)) throw new Error('Invalid narrator entity patch baseline.');
  const items = new Map(before.map(item => [entityId(item), clone(item)]));
  if ([...items.keys()].some(id => id === null)) throw new Error('Narrator entity baseline has no stable id.');
  for (const id of change.remove ?? []) items.delete(String(id));
  for (const item of change.upsert ?? []) {
    const id = entityId(item);
    if (id === null) throw new Error('Narrator entity patch has no stable id.');
    items.set(id, clone(item));
  }
  for (const [id, fields] of Object.entries(change.update ?? {})) {
    if (!items.has(id)) throw new Error('Narrator entity update references a missing id.');
    items.set(id, applyDeepPatch(items.get(id), fields));
  }
  const order = change.order ?? [...items.keys()];
  if (!Array.isArray(order) || order.length !== items.size || new Set(order.map(String)).size !== items.size)
    throw new Error('Invalid narrator entity order.');
  return order.map(id => {
    const item = items.get(String(id));
    if (item === undefined) throw new Error('Narrator entity order references a missing id.');
    return item;
  });
}

function applyDeepPatch(before, patch) {
  if (!plainObject(before)) throw new Error('Invalid narrator object patch baseline.');
  const result = clone(before);
  for (const key of patch.unset ?? []) {
    if (forbidden.has(key)) throw new Error('Invalid narrator object patch key.');
    delete result[key];
  }
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    if (forbidden.has(key)) throw new Error('Invalid narrator object patch key.');
    result[key] = clone(value);
  }
  for (const [key, nested] of Object.entries(patch.objects ?? {})) {
    if (forbidden.has(key) || !Object.hasOwn(result, key)) throw new Error('Invalid narrator nested object patch.');
    result[key] = applyDeepPatch(result[key], nested);
  }
  for (const [key, change] of Object.entries(patch.entities ?? {})) {
    if (forbidden.has(key) || !Object.hasOwn(result, key)) throw new Error('Invalid narrator nested entity patch.');
    result[key] = applyEntityPatch(result[key], change);
  }
  return result;
}

export function applyNarratorStatePatch(before, patch) {
  if (!patch || patch.format !== NARRATOR_STATE_PATCH_FORMAT) throw new Error('Unsupported narrator state patch.');
  const result = clone(before ?? {});
  for (const key of patch.unset ?? []) {
    if (!NARRATOR_PATCHABLE_KEYS.includes(key) || forbidden.has(key)) throw new Error('Invalid narrator state patch key.');
    delete result[key];
  }
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    if (!NARRATOR_PATCHABLE_KEYS.includes(key) || forbidden.has(key)) throw new Error('Invalid narrator state patch key.');
    result[key] = clone(value);
  }
  for (const [key, nested] of Object.entries(patch.objects ?? {})) {
    if (!NARRATOR_PATCHABLE_KEYS.includes(key) || forbidden.has(key) || !Object.hasOwn(result, key))
      throw new Error('Invalid narrator state object patch.');
    result[key] = applyDeepPatch(result[key], nested);
  }
  for (const [key, change] of Object.entries(patch.entities ?? {})) {
    if (!entityArrayKeys.has(key) || forbidden.has(key) || !Object.hasOwn(result, key)) throw new Error('Invalid narrator entity patch.');
    result[key] = applyEntityPatch(result[key], change);
  }
  return result;
}

export function mergeNarratorState(target, state) {
  for (const key of NARRATOR_PATCHABLE_KEYS) {
    if (Object.hasOwn(state, key)) target[key] = clone(state[key]);
    else delete target[key];
  }
  return target;
}
