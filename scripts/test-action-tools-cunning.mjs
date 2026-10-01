import assert from 'node:assert/strict';
import { z } from 'zod';
import { loadSource } from './lib/readiness-harness.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const sheet = { id, name: 'Rogue', userId: 'u1', currentHp: 20, conditions: [], features: [{ name: 'Cunning Action' }] };
const encounter = { id: 'encounter', round: 1, turnIndex: 0, orderReady: true, order: [{ kind: 'pc', characterId: id }], turnBudget: null };
let stored = null;
const actionTools = loadSource('src/lib/dm/action-tools.ts', {
  zod: { z },
  '@/lib/db/campaigns': { allocateSeq: () => 1 },
  '@/lib/db/encounters': { getActiveEncounter: () => encounter, listEnemies: () => [], orderEntryId: entry => entry.characterId ?? entry.enemyId, patchEnemyConditions() {}, saveEncounter: value => { stored = value.turnBudget; } },
  '@/lib/db/sheets': { getSheetById: () => sheet, patchSheet: () => sheet },
  '@/lib/db/rolls': { insertRoll: value => value },
  '@/lib/db/dm-turns': { listOpenPendingRolls: () => [] },
  '@/lib/dice': { d20Expression: () => '1d20', rollExpression: () => ({ total: 10, natural: 10 }) },
  '@/lib/events': { publishPersisted() {}, publishWithSeq() {} },
  '@/lib/srd': { acBreakdownFor: () => ({ stealthDisadvantage: false }), computeSheetDerived: () => ({ skills: {} }), sizeForRace: () => 'Medium' },
  '@/lib/srd/condition-effects': { conditionBlocksReactions: () => false, conditionExtraActions: () => 0 },
  '@/lib/srd/feature-effects': { combatRiders: () => ({ extraAttacks: 0 }), hasCunningAction: value => value.features.some(feature => /cunning action/i.test(feature.name)) },
  '@/lib/bestiary/statblock': { passivePerceptionFor: () => 10, saveModFor: () => 0, sizeRank: () => 2 },
  '@/lib/dm/action-budget': { ...await import('../src/lib/dm/action-budget.ts') },
  '@/lib/dm/enemy-damage': { resolveEnemyRef: () => null, publishEncounter() {} },
  '@/lib/dm/mutations': { applyDmMutation: () => ({}) },
  '@/lib/dm/rolls': { resolveSheetRef: (_ref, _sheets, sheetsById) => sheetsById.get(id) },
  '@/lib/dm/condition-logic': { DODGING: 'dodging', incapacitatedBy: () => null },
  '@/lib/srd/spell-lists': { allSpellNames: lists => lists ? [...(lists.cantrips ?? []), ...lists.known, ...lists.prepared] : [] },
});

function takeAction(args) {
  stored = null;
  return actionTools.handleTakeAction({ id: 'campaign' }, { rollIds: [] }, JSON.stringify({ characterId: id, ...args }), [sheet], new Map([[id, sheet]]));
}

assert.ok(takeAction({ action: 'dash', cunningAction: true }).ok);
assert.equal(stored.bonusUsed, true, 'selected Cunning Action spends the bonus action');
assert.equal(stored.actionUsed, false, 'selected Cunning Action leaves the action available');
assert.equal(stored.dashed, true);

encounter.turnBudget = null;
assert.ok(takeAction({ action: 'dash' }).ok);
assert.equal(stored.actionUsed, true, 'ordinary Dash spends the action');
assert.equal(stored.bonusUsed, false);

encounter.turnBudget = null;
sheet.features = [];
const refused = takeAction({ action: 'dash', cunningAction: true });
assert.match(refused.error, /Cunning Action requires/);
assert.equal(stored, null, 'an invalid Cunning Action does not spend either slot');
console.log('test-action-tools-cunning: passed');
