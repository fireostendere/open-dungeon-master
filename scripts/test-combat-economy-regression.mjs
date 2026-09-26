import assert from 'node:assert/strict';
import test from 'node:test';
import * as economy from '../src/lib/dm/action-budget.ts';
import { matchWeapon } from '../src/lib/srd/weapons.ts';

const fresh = (attacksAllowed = 1) => economy.freshBudget({ ownerId: 'hero', round: 6, attacksAllowed });

test('named Russian equipment retains its actual weapon profile', () => {
  assert.equal(matchWeapon('Булава «Аргумент»')?.name, 'Mace');
  assert.equal(matchWeapon('Боевой посох «Ветка» +1')?.name, 'Quarterstaff');
  assert.equal(matchWeapon('Сумка с булавами'), null);
});

test('Healing Word and a weapon attack share one turn, not two actions', () => {
  const heal = economy.spendSpell(fresh(), 'bonus', 1, 'Healing Word', 'Hero');
  assert.equal(heal.ok, true);
  assert.equal(heal.budget.actionUsed, false);
  const attack = economy.spendAttack(heal.budget, 'Hero');
  assert.equal(attack.ok, true);
  assert.equal(economy.spendSpell(attack.budget, 'bonus', 1, 'Healing Word', 'Hero').ok, false);
  assert.equal(economy.spendAttack(attack.budget, 'Hero').ok, false);
});

test('2014 bonus-action spell rule allows an action cantrip, in either order', () => {
  for (const reverse of [false, true]) {
    const spells = [['bonus', 1], ['action', 0]];
    if (reverse) spells.reverse();
    let budget = fresh(2);
    for (const [cost, level] of spells) {
      const cast = economy.spendSpell(budget, cost, level, 'Spell', 'Hero');
      assert.equal(cast.ok, true);
      budget = cast.budget;
    }
    assert.equal(economy.spendAttack(budget, 'Hero').ok, false, 'Extra Attack cannot turn a spell into weapon swings');
  }
  for (const reverse of [false, true]) {
    const spells = [['bonus', 1], ['action', 1]];
    if (reverse) spells.reverse();
    const first = economy.spendSpell(fresh(), ...spells[0], 'Spell', 'Hero');
    assert.equal(economy.spendSpell(first.budget, ...spells[1], 'Spell', 'Hero').ok, false);
  }
});

test('Haste permits its restricted actions, never another spell or Dodge', () => {
  const budget = { ...fresh(), actionUsed: true, extraActions: 1 };
  assert.equal(economy.spendSpell(budget, 'action', 0, 'Fire Bolt', 'Hero').ok, false);
  assert.equal(economy.spendAction(budget, 'action', 'Dodge', 'Hero').ok, false);
  assert.equal(economy.spendAction(budget, 'action', 'Dash', 'Hero', true).ok, true);
  assert.equal(economy.attacksLeft(budget), 0);
});
