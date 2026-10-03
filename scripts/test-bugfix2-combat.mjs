// Focused regression of the real mutation/death/concentration modules.
// Persistence, content, dice and character derivation use controlled fixtures;
// this is not a substitute for the full database/HTTP suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as actionBudget from '../src/lib/dm/action-budget.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const sheets = new Map(), enemies = new Map();
let activeEncounter = null;
const encounters = new Map();
const audits = [], events = [], rolls = [], characterEvents = [];
let seq = 0, natural = 15, checks = 0;
const campaign = { id: 'campaign', gameSettings: { variantRules: {} } };
const spellData = spell => {
  const key = spell.toLowerCase();
  const defs = {bless:['Bless','buff','blessed',1],haste:['Haste','buff','hasted',3],polymorph:['Polymorph','buff','polymorphed',4],guidance:['Guidance','buff','guided',0],'hold person':['Hold Person','save','paralyzed',2]};
  const def=defs[key]; if(!def)return null;
  return {name:def[0],concentration:true,spellLevel:def[3],mech:{resolution:def[1],buff:def[1]==='buff'?{condition:def[2],rounds:10,target:'allies'}:undefined,condition:def[1]==='save'?{name:def[2],saveEnds:true}:undefined,save:def[1]==='save'?'wis':undefined}};
};
const track = (extra = {}) => ({ successes: 0, failures: 0, stable: false, dead: false, ...extra });
const makeSheet = (extra = {}) => ({
  id: 'pc', campaignId:'campaign', level:10, equipment:[], proficiencies:{weapons:[]}, userId: 'user-pc', name: 'Hero', libraryCharacterId: 'library-pc',
  currentHp: 30, maxHp: 30, tempHp: 0, deathSaves: null, concentratingOn: null,
  wildShape: null, conditions: [], conditionMeta: {}, resources: {}, features: [],
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  ...extra,
});
const form = hp => ({ form: 'Bear', beastHp: hp, beastMaxHp: 30, beastAc: 12,
  kind: 'wildshape', abilities: { str: 19, dex: 10, con: 16 } });
function reset(extra = {}) {
  sheets.clear();enemies.clear();encounters.clear();activeEncounter=null; sheets.set('pc', makeSheet(extra));
  audits.length = events.length = rolls.length = characterEvents.length = 0;
  seq = 0; natural = 15;
}
const getSheetById = id => sheets.has(id) ? clone(sheets.get(id)) : null;
const patchSheet = (id, patch) => {
  const current = sheets.get(id);
  if (!current) return null;
  sheets.set(id, { ...current, ...clone(patch) });
  return getSheetById(id);
};
// Only already-valid fixture arguments are passed to Zod. Parser validation is
// outside the scope of these domain regression tests.
const schema = new Proxy({}, { get: (_, key) => key === 'parse' ? value => value
  : key === 'safeParse' ? data => ({ success: true, data }) : () => schema });
const z = new Proxy({}, { get: (_, key) => key === 'coerce' ? z : () => schema });
const unused = name => () => { throw new Error(`Unexpected dependency: ${name}`); };
const removeConditions = (conditions, meta = {}, wanted) => ({
  conditions: conditions.filter(name => !wanted.includes(name)),
  meta: Object.fromEntries(Object.entries(meta).filter(([name]) => !wanted.includes(name))),
});
const fixtures = {
  "@/lib/dm/concealment": { revealAfterAction() {} },
  "@/lib/dm/combat-target": { resolveCombatTarget: (_campaign, _encounter, args) => {
    const enemy = enemies.get(args.targetEnemyId);
    return enemy ? { ...clone(enemy), enemy: clone(enemy), sheet: null } : { error: 'Choose a living enemy.' };
  } },
  "@/lib/spatial/service": { spatialStore: unused('spatialStore') },
  zod: { z },
  '@/lib/db/sheets': { getSheetById, patchSheet, listSheets: () => [...sheets.values()].map(clone) },
  '@/lib/db/campaigns': { allocateSeq: () => ++seq },
  '@/lib/db/sheet-audit': { insertSheetAudit: entry => { audits.push(clone(entry)); return entry; } },
  '@/lib/db/character-events': { insertCharacterEvent: entry => characterEvents.push(clone(entry)) },
  '@/lib/db/messages': { insertCampaignMessage: message => message },
  '@/lib/db/rolls': { insertRoll: roll => { rolls.push(clone(roll)); return roll; } },
  '@/lib/events': { publishPersisted: (...args) => events.push(clone(args)), publishWithSeq: (...args) => events.push(clone(args)) },
  '@/lib/db/encounters': {
    getActiveEncounter: () => activeEncounter,
    getEnemy: id => enemies.has(id)?clone(enemies.get(id)):null,
    listEnemies: id => [...enemies.values()].filter(e=>e.encounterId===id).map(clone),
    patchEnemyConditions: (id,conditions,conditionMeta)=>enemies.set(id,{...enemies.get(id),conditions:clone(conditions),conditionMeta:clone(conditionMeta)}),
    setEnemyConcentration: (id,concentration)=>enemies.set(id,{...enemies.get(id),concentration}),
    patchEnemyHp: (id,currentHp,status)=>{enemies.set(id,{...enemies.get(id),currentHp,status});return clone(enemies.get(id));},
    saveEncounter: value => { activeEncounter = value; }, endEncounter: unused('endEncounter'),
  },
  '@/lib/db/core':{getDatabase:()=>({prepare:sql=>{assert.equal(sql,'SELECT id FROM encounters WHERE campaign_id = ?');return {all:id=>[...encounters.values()].filter(e=>e.campaignId===id).map(clone)};}})},
  '@/lib/db/encounter-view':{activePublicEncounter:()=>null},
  '@/lib/content': { listConditions: () => [], findSpellByName: name => spellData(name), spellMechanicsFor: ({spell}) => spellData(spell),
    searchSpells: ({q}) => spellData(q) ? [{ name: q, level: spellData(q).spellLevel, data: { casting_time: '1 action' } }] : [], spellDamageFor: () => null, spellNameMatches: (entry, name) => entry.name === name },
  '@/lib/srd': { levelForXp: () => 1, abilityMod: score => Math.floor((score - 10) / 2), findClass: () => null,
    spellSaveDcFor:()=>13, computeSheetDerived: sheet => ({ saves: { str:0,dex:0,wis:0,int:0,cha:0,con: Math.floor(((sheet.wildShape?.abilities?.con ?? sheet.abilities.con) - 10) / 2) } }) },
  '@/lib/srd/class-resources': { RAGING: 'raging', matchResource: () => null,
    spendRelentlessEndurance: resources => {
      const value = resources.relentless_endurance;
      return value && value.used < value.max ? { ...resources, relentless_endurance: { ...value, used: value.used + 1 } } : null;
    } },
  '@/lib/dm/action-budget': actionBudget,
  '@/lib/dm/resource-action-cost': { RESOURCE_ACTIONS: {} },
  '@/lib/srd/feature-effects': {hasBrave:()=>false, combatRiders: () => ({ extraAttacks: 0 }) },
  '@/lib/srd/condition-effects': { conditionEffectsFor:()=>null, conditionExtraActions: () => 0, conditionConcentrationFloor: () => 0 },
  '@/lib/srd/spell-mechanics': { authoredSpellRow: () => null },
  '@/lib/schemas/sheet': { fullPatchSheetSchema: schema, concentrationSourceSchema:schema },
  '@/lib/srd/currency': { addCopper: unused('addCopper'), COPPER_PER_GOLD: 100, formatCopper: unused('formatCopper'), formatPurse: unused('formatPurse'), parseCoins: unused('parseCoins') },
  '@/lib/dm/companion-tools': { autoLevelCompanion: unused('autoLevelCompanion') },
  '@/lib/dm/condition-logic': { incapacitatedBy: () => null, removeConditions, ROUNDS_PER_MINUTE: 10,
    conditionRoundsFrom: ({ rounds = 0, minutes = 0, hours = 0 }) => rounds + minutes * 10 + hours * 600 || undefined,
    describeConditionDuration: rounds => `${rounds} rounds`, tickConditions: (conditions,meta,by=1)=>{
    const nextMeta={},expired=[],savesDue=[];
    for(const name of conditions){const entry=meta?.[name];if(!entry)continue;
      if(typeof entry.rounds==='number'){const left=entry.rounds-by;if(left<=0){expired.push(name);continue;}nextMeta[name]={...entry,rounds:left};}else nextMeta[name]=entry;
      if(entry.saveEnds)savesDue.push({name,ability:entry.saveEnds.ability,dc:entry.saveEnds.dc});
    }
    return {conditions:conditions.filter(n=>!expired.includes(n)),meta:nextMeta,expired,savesDue};
  }, pruneMeta: (conditions, meta) => Object.fromEntries(Object.entries(meta).filter(([key]) => conditions.includes(key))),
    describeExhaustion: unused('describeExhaustion'), pcResistances: sheet => sheet.resistance ?? '',
    damageAdjust: (amount, type, resistance) => ({ amount: resistance === 'immune' ? 0 : resistance === type ? Math.floor(amount / 2) : amount }) },
  '@/lib/dm/arg-coerce': { normalizeAbility: x => x, normalizeListAction: x => x },
  '@/lib/dm/resource-tools': { resourceTools: [], computePurchase: unused('computePurchase'), computeUseItem: unused('computeUseItem'), computeUseResource: unused('computeUseResource'), rollHealing: unused('rollHealing') },
  '@/lib/content/mechanics': { suggestedSpellCount: () => null },
  '@/lib/classes': { spellClassFor: unused('spellClassFor') },
  '@/lib/dm/aura': { allySaveAura: () => null },
  '@/lib/dice': { isValidExpression:()=>true, d20Expression: mod => `1d20${mod < 0 ? mod : `+${mod}`}`,
    rollExpression: expression => ({ total: natural + Number(expression.match(/^1d20([+-]\d+)$/)?.[1] ?? 0), natural }) },
};
Object.assign(fixtures,{
  '@/lib/dm/rolls':{resolveSheetRef:(ref,ss,byId)=>byId.get(ref)??null,resolveRollExpression:()=>({expression:'1d20+0'})},
  '@/lib/srd/beast-forms':{findBeastForm:()=>({name:'Bear',cr:1,hp:30,ac:12,abilities:{con:16},speed:30,attacks:[]}),formatCr:x=>String(x)},
  '@/lib/bestiary/statblock':{saveModFor:()=>0},
  '@/lib/dm/attack-logic':{resolveAttackWeapon:unused('resolveAttackWeapon')},
  '@/lib/dm/action-tools':{attacksAllowedFor:()=>1,budgetFor:()=>null,currentCombatantId:()=>null,storeBudget:unused('storeBudget')},
  '@/lib/db/active-effects':{tickEffectRound:()=>[]},
  '@/lib/db/dm-turns':{getDmTurn:unused('getDmTurn'), listOpenPendingRolls: () => []},
  '@/lib/db/battle-maps':{getBattleMapForEncounter:()=>null,removeTokenByRef:unused('removeTokenByRef')},
  '@/lib/bestiary/health':{healthState:()=> 'healthy'},
  '@/lib/srd/ammunition':{ammoCount:unused('ammoCount'),recoveredAmmo:unused('recoveredAmmo'),withAmmoCount:unused('withAmmoCount')},
  '@/lib/dm/encounter-logic':{enemyDamageMath:(hp,d)=>({currentHp:Math.max(0,hp-d),dropped:d>=hp})},
  '@/lib/dm/map-tools':{publishBattleMapUpdate:()=>{}},
  '@/lib/dm/ambience-tools':{followCombatAmbience:()=>{}},
  '@/lib/dm/waypoint-tick':{tickWaypointsFrom:()=>[]},
  '@/lib/dm/team-round':{isTeamRoundFight:()=>false},
  '@/lib/srd/spell-lists': { allSpellNames: lists => lists ? [...(lists.cantrips ?? []), ...lists.known, ...lists.prepared] : [],
    checklistClassSpell: () => null, isCantripName: () => false, spellsAgainstLimit: names => names.length },
  '@/lib/srd/spell-prep': { casterViewsOf: () => [], notReadyReason: () => null, spellbookOf: unused('spellbookOf'), withCasterViews: unused('withCasterViews') },
  '@/lib/srd/features': { subclassSpellsFor: () => [] },
});
const real = new Set(['mutations', 'mutation-math', 'death', 'death-logic', 'concentration','condition-sources','cast-tools','condition-tick','enemy-damage']);
const cache = new Map();
function load(specifier) {
  if(specifier==='node:crypto')return crypto;
  if (fixtures[specifier]) return fixtures[specifier];
  const name = specifier.replace('@/lib/dm/', '');
  assert.ok(real.has(name), `Unregistered import ${specifier}`);
  if (cache.has(name)) return cache.get(name).exports;
  const filename = fileURLToPath(new URL(`../src/lib/dm/${name}.ts`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0, `Syntax diagnostics in ${name}`);
  const record = { exports: {} }; cache.set(name, record);
  vm.runInNewContext(output.outputText, { require: load, module: record, exports: record.exports, console }, { filename });
  return record.exports;
}
const mutations = load('@/lib/dm/mutations');
const death = load('@/lib/dm/death');
const deathLogic = load('@/lib/dm/death-logic');
const math = load('@/lib/dm/mutation-math');
const call = (tool, args = {}) => mutations.applyDmMutation(campaign, 'turn', tool, JSON.stringify({ characterId: 'pc', ...args }), [...sheets.values()], new Map(sheets)).result;
const hit = (amount, extra = {}) => call('apply_damage', { amount, ...extra });
const test = (name, run) => { run(); console.log(`ok ${++checks} - ${name}`); };

test('third successful save resets both counters', () => {
  const result = deathLogic.applyDeathSaveRoll(track({ successes: 2, failures: 2 }), 10);
  assert.equal(result.outcome, 'stable');
  assert.deepEqual(clone(result.track), track({ stable: true }));
  assert.deepEqual(clone(deathLogic.onDamageAtZero(result.track, false)), track({ failures: 1 }));
});
test('manual stabilization resets counters and is idempotent', () => {
  reset({ currentHp: 0, deathSaves: track({ successes: 2, failures: 2 }) });
  assert.equal(call('stabilize').ok, true);
  assert.deepEqual(sheets.get('pc').deathSaves, track({ stable: true }));
  const count = audits.length; call('stabilize'); assert.equal(audits.length, count);
  hit(1); assert.deepEqual(sheets.get('pc').deathSaves, track({ failures: 1 }));
});
test('legacy stable tracks are normalized on damage or stabilization', () => {
  for (const crit of [false, true]) {
    reset({ currentHp: 0, deathSaves: track({ stable: true, successes: 3, failures: 2 }) });
    hit(1, { crit }); assert.deepEqual(sheets.get('pc').deathSaves, track({ failures: crit ? 2 : 1 }));
  }
  reset({ currentHp: 0, deathSaves: track({ stable: true, successes: 3, failures: 2 }) });
  call('stabilize'); assert.deepEqual(sheets.get('pc').deathSaves, track({ stable: true }));
});
test('massive damage boundary works at already zero HP, stable or dying', () => {
  for (const stable of [false, true]) for (const amount of [19, 20, 21]) for (const crit of [false, true]) {
    reset({ currentHp: 0, maxHp: 20, deathSaves: track({ stable }) });
    hit(amount, { crit });
    assert.equal(sheets.get('pc').deathSaves.dead, amount >= 20);
    assert.equal(characterEvents.length, amount >= 20 ? 1 : 0);
    if (amount < 20) assert.equal(sheets.get('pc').deathSaves.failures, crit ? 2 : 1);
  }
});
test('instant death emits once; the hook cannot duplicate a death', () => {
  reset({ currentHp: 0, maxHp: 20, deathSaves: track() });
  const before = getSheetById('pc'); hit(20);
  death.applyDamageDeathHook(campaign, 'turn', before, math.applyDamageMath(0, 0, 20), false);
  assert.equal(characterEvents.length, 1); assert.match(hit(1).error, /already dead/);
});
test('a zero-HP legacy sheet without a death track receives the correct state', () => {
  reset({ currentHp: 0, maxHp: 20 }); hit(1);
  assert.deepEqual(sheets.get('pc').deathSaves, track({ failures: 1 }));
  reset({ currentHp: 0, maxHp: 20 }); hit(20); assert.equal(sheets.get('pc').deathSaves.dead, true);
});
test('Relentless Endurance cannot negate instant death', () => {
  for (const amount of [24, 25, 26]) {
    reset({ currentHp: 5, maxHp: 20, resources: { relentless_endurance: { max: 1, used: 0 } } });
    const result = hit(amount);
    assert.equal(sheets.get('pc').currentHp, amount === 24 ? 1 : 0);
    assert.equal(sheets.get('pc').resources.relentless_endurance.used, amount === 24 ? 1 : 0);
    assert.equal(Boolean(result.dead), amount >= 25);
  }
});
test('successful Relentless Endurance still checks concentration once', () => {
  reset({ currentHp: 5, concentratingOn: 'Bless', resources: { relentless_endurance: { max: 1, used: 0 } } });
  const result = hit(10); assert.equal(rolls.length, 1); assert.equal(result.concentration.dc, 10);
  assert.equal(sheets.get('pc').currentHp, 1);
});
test('Wild Shape surviving a hit still checks concentration', () => {
  reset({ concentratingOn: 'Bless', wildShape: form(30) });
  const result = hit(5); assert.equal(rolls.length, 1); assert.equal(result.concentration.dc, 10);
  assert.equal(sheets.get('pc').wildShape.beastHp, 25);
  assert.equal(result.concentration.rolled, 18);
});
test('exactly depleted form and carryover each check the entire hit once', () => {
  for (const amount of [25, 30]) {
    reset({ concentratingOn: 'Bless', wildShape: form(25) });
    const result = hit(amount);
    assert.equal(rolls.length, 1); assert.equal(result.concentration.dc, Math.floor(amount / 2));
    assert.equal(result.concentration.rolled, 18, 'incoming beast CON must survive reversion');
    assert.equal(sheets.get('pc').wildShape, null);
    assert.equal(sheets.get('pc').currentHp, 30 - Math.max(0, amount - 25));
  }
});
test('zero HP after a form breaks ends concentration without a redundant roll', () => {
  reset({ currentHp: 5, concentratingOn: 'Bless', wildShape: form(5) });
  const result = hit(10); assert.equal(rolls.length, 0); assert.equal(result.concentrationBroken, 'Bless');
  assert.equal(sheets.get('pc').concentratingOn, null);
});
test('resistance, immunity and temporary HP do not bypass or duplicate saves', () => {
  reset({ concentratingOn: 'Bless', resistance: 'fire' }); hit(30, { type: 'fire' });
  assert.equal(rolls.length, 1); assert.equal(rolls[0].dc, 10);
  reset({ concentratingOn: 'Bless', resistance: 'immune', wildShape: form(25) }); hit(30);
  assert.equal(rolls.length, 0); assert.equal(sheets.get('pc').wildShape.beastHp, 25);
  reset({ concentratingOn: 'Bless', tempHp: 40 }); hit(30);
  assert.equal(rolls.length, 1); assert.equal(rolls[0].dc, 15); assert.equal(sheets.get('pc').currentHp, 30);
});
test('a failed save in a surviving form really breaks concentration', () => {
  reset({ concentratingOn: 'Bless', wildShape: form(30) }); natural = 1;
  const result = hit(5); assert.equal(result.concentration.held, false);
  assert.equal(sheets.get('pc').concentratingOn, null); assert.equal(rolls.length, 1);
});
test('form collapse does not resurrect a removed polymorph condition via rage cleanup', () => {
  reset({ currentHp: 5, conditions: ['polymorphed', 'raging'], wildShape: { ...form(5), kind: 'polymorph' } });
  hit(10); assert.deepEqual(sheets.get('pc').conditions, []);
});


const concentration=load('@/lib/dm/concentration'), sources=load('@/lib/dm/condition-sources');
const casts=load('@/lib/dm/cast-tools'), upkeep=load('@/lib/dm/condition-tick');
const enemyDamage=load('@/lib/dm/enemy-damage');
const turn={id:'turn',rollIds:[]};
const party=()=>[...sheets.values()].map(clone), partyMap=()=>new Map(party().map(s=>[s.id,s]));
const caster=(id)=>makeSheet({id,name:id,userId:`user-${id}`,spellcasting:{known:['Bless','Haste','Polymorph','Hold Person','Guidance'],prepared:[],slots:{1:{max:4,used:0},2:{max:4,used:0},3:{max:4,used:0},4:{max:4,used:0}}}});
const buff=(id,spell,targets)=>casts.handleCastBuff(campaign,turn,JSON.stringify({characterId:id,spell,targetCharacterIds:targets,variant:'Bear'}),party(),partyMap());
const prepareParty=()=>{reset();sheets.clear();for(const id of ['A','B','C','D'])sheets.set(id,caster(id));};
const fight=(id='fight')=>{const e={id,campaignId:campaign.id,roomId:id,orderReady:true,order:[],turnIndex:0,round:1};encounters.set(id,e);activeEncounter=e;return e;};
const enemy=(id,encounterId='fight')=>{const e={id,campaignId:campaign.id,encounterId,displayName:id,status:'alive',currentHp:30,maxHp:30,conditions:[],conditionMeta:{},concentration:null,stats:{conditionImmune:'',resist:'',immune:'',vulnerable:''}};enemies.set(id,e);return e;};
test('damage absorbed by temporary HP at zero still breaks stabilization',()=>{
  reset({currentHp:0,tempHp:5,deathSaves:track({stable:true})});hit(1);
  assert.deepEqual(sheets.get('pc').deathSaves,track({failures:1}));
});
test('two real cast_buff calls on separate targets have independent ownership',()=>{
  prepareParty();assert.equal(buff('A','Bless',['C']).ok,true);assert.equal(buff('B','Bless',['D']).ok,true);
  concentration.breakConcentration(campaign,turn.id,'A','damage');
  assert.deepEqual(sheets.get('C').conditions,[]);assert.deepEqual(sheets.get('D').conditions,['blessed']);
  assert.equal(sheets.get('B').concentratingOn,'Bless');
});
test('same condition on one target survives loss of either caster, without stacking names',()=>{
  for(const first of ['A','B']){
    prepareParty();buff('A','Bless',['C']);buff('B','Bless',['C']);
    assert.deepEqual(sheets.get('C').conditions,['blessed']);
    assert.equal(sheets.get('C').conditionMeta.blessed.concentrationSources.length,2);
    concentration.breakConcentration(campaign,turn.id,first,'damage');
    assert.deepEqual(sheets.get('C').conditions,['blessed']);
    concentration.breakConcentration(campaign,turn.id,first==='A'?'B':'A','damage');
    assert.deepEqual(sheets.get('C').conditions,[]);
  }
});
test('manual and legacy conditions are preserved rather than assigned a guessed owner',()=>{
  prepareParty();sheets.get('C').conditions=['blessed'];sheets.get('C').conditionMeta={blessed:{rounds:3}};
  buff('A','Bless',['C']); concentration.breakConcentration(campaign,turn.id,'A','damage');
  assert.deepEqual(sheets.get('C').conditions,['blessed']);assert.deepEqual(sheets.get('C').conditionMeta,{blessed:{rounds:3}});
  concentration.clearSpellConditionsByName(campaign,'Bless');assert.deepEqual(sheets.get('C').conditions,['blessed']);
});
test('same-spell recast removes only old owned targets before adding new ones',()=>{
  prepareParty();buff('A','Bless',['C']);buff('B','Bless',['C']);buff('A','Bless',['D']);
  assert.deepEqual(sheets.get('C').conditionMeta.blessed.concentrationSources.map(s=>s.casterId),['B']);
  assert.deepEqual(sheets.get('D').conditionMeta.blessed.concentrationSources.map(s=>s.casterId),['A']);
  buff('A','Haste',['D']);assert.deepEqual(sheets.get('D').conditions,['hasted']);
});
test('separate Polymorphs revert only the form owned by the broken caster',()=>{
  prepareParty();buff('A','Polymorph',['C']);buff('B','Polymorph',['D']);
  assert.equal(sheets.get('C').wildShape.concentrationSource.casterId,'A');
  concentration.breakConcentration(campaign,turn.id,'A','damage');
  assert.equal(sheets.get('C').wildShape,null);assert.equal(sheets.get('D').wildShape.kind,'polymorph');
});
test('per-source timers survive JSON persistence and expiration of the other instance',()=>{
  prepareParty();buff('A','Bless',['C']);buff('B','Bless',['C']);
  sheets.get('C').conditionMeta.blessed.concentrationSources[0].rounds=1;
  sheets.get('C').conditionMeta.blessed.concentrationSources[1].rounds=3;
  sheets.set('C',clone(sheets.get('C')));const encounter=fight();
  upkeep.tickEncounterConditions(campaign,encounter);
  assert.deepEqual(sheets.get('C').conditions,['blessed']);
  assert.deepEqual(sheets.get('C').conditionMeta.blessed.concentrationSources.map(s=>[s.casterId,s.rounds]),[['B',2]]);
  concentration.breakConcentration(campaign,turn.id,'A','damage');assert.deepEqual(sheets.get('C').conditions,['blessed']);
  upkeep.tickEncounterConditions(campaign,encounter);upkeep.tickEncounterConditions(campaign,encounter);assert.deepEqual(sheets.get('C').conditions,[]);
});
test('successful periodic save removes its instance, not another caster with a higher DC',()=>{
  prepareParty();fight();enemy('E');natural=1;
  for(const id of ['A','B']) {
    activeEncounter.order = [{ kind: 'pc', characterId: id }]; activeEncounter.turnBudget = null;
    assert.equal(casts.handleCastAtEnemy(campaign,turn,JSON.stringify({characterId:id,targetEnemyId:'E',spell:'Hold Person',level:2,saveAbility:'wis'}),party(),partyMap()).ok,true);
  }
  const effect=enemies.get('E').conditionMeta.paralyzed;
  assert.equal(effect.concentrationSources.length,2);effect.concentrationSources[0].saveEnds.dc=5;effect.concentrationSources[1].saveEnds.dc=20;
  natural=10;upkeep.tickEncounterConditions(campaign,activeEncounter);
  assert.deepEqual(enemies.get('E').conditions,['paralyzed']);assert.equal(enemies.get('E').conditionMeta.paralyzed.concentrationSources[0].casterId,'B');
});
test('enemy casts and damage use the same source-scoped concentration cleanup',()=>{
  prepareParty();fight();enemy('E1');enemy('E2');natural=1;
  for(const [e,target] of [['E1','C'],['E2','D']]) {
    const r=casts.handleCastAtPlayer(campaign,turn,JSON.stringify({characterId:target,casterEnemyId:e,spell:'Hold Person',condition:'paralyzed',saveAbility:'wis',dc:13}),party(),partyMap());
    assert.equal(r.ok,true);assert.equal(sheets.get(target).conditionMeta.paralyzed.concentrationSources[0].casterId,e);
  }
  enemyDamage.applyEnemyDamage(campaign,turn,activeEncounter,clone(enemies.get('E1')),5,party(),partyMap());
  assert.deepEqual(sheets.get('C').conditions,[]);assert.deepEqual(sheets.get('D').conditions,['paralyzed']);
});
test('cleanup reaches owned targets across encounters but leaves other-room casters untouched',()=>{
  prepareParty();fight('R1');enemy('E1','R1');fight('R2');enemy('E2','R2');
  concentration.setConcentration(campaign,turn.id,'A','Hold Person');concentration.setConcentration(campaign,turn.id,'B','Hold Person');
  for(const [target,casterId] of [['E1','A'],['E2','B']]){
    const e=enemies.get(target),identity=concentration.concentrationSourceFor(campaign,casterId,'pc','Hold Person');
    const next=sources.addConditionSource(e.conditions,e.conditionMeta,'paralyzed',identity,{rounds:10});
    e.conditions=clone(next.conditions);e.conditionMeta=clone(next.meta);
  }
  concentration.breakConcentration(campaign,turn.id,'A','damage');assert.deepEqual(enemies.get('E1').conditions,[]);assert.deepEqual(enemies.get('E2').conditions,['paralyzed']);
});
test('invalid caster ownership cannot add a sourced condition',()=>{
  prepareParty();sheets.get('A').campaignId='other';sheets.get('A').concentratingOn='Bless';
  const r=mutations.applyDmMutation(campaign,turn.id,'set_condition',JSON.stringify({characterId:'C',condition:'blessed',conditionSource:{casterId:'A',casterKind:'pc',spell:'Bless',instanceId:crypto.randomUUID()}}),party(),partyMap()).result;
  assert.ok(r.error);assert.deepEqual(sheets.get('C').conditions,[]);
});
test('clearing is idempotent and audited pre-images retain source metadata',()=>{
  prepareParty();buff('A','Bless',['C']);concentration.breakConcentration(campaign,turn.id,'A','damage');
  const entry=audits.find(a=>a.kind==='concentration_effects');assert.equal(entry.before.conditionMeta.blessed.concentrationSources[0].casterId,'A');
  const n=audits.length;concentration.breakConcentration(campaign,turn.id,'A','again');assert.equal(audits.length,n);
});
console.log(`Passed ${checks} combat regression groups.`);
