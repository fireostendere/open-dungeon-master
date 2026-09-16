import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {loadReviewModule,sqliteAdapter} from './lib/review-module.mjs';
const source = p => fileURLToPath(new URL('../src/lib/'+p,import.meta.url));
function fixture(t){
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
  db.exec('CREATE TABLE effects(n INTEGER);INSERT INTO effects VALUES(0)');
  const adapter=sqliteAdapter(db);
  const effects=loadReviewModule(source('db/commit-effects.ts'));
  const tool=loadReviewModule(source('dm/tool-transaction.ts'),{'@/lib/db/core':{getDatabase:()=>adapter},'@/lib/db/commit-effects':effects});
  return {db,adapter,...effects,...tool,count:()=>db.prepare('SELECT n FROM effects').get().n};
}
test('returned error rolls back aliased records, arrays, maps, sets and notifications',t=>{
  const f=fixture(t), sheet={hp:10}, sheets=[sheet], map=new Map([['hero',sheet]]), set=new Set(['old']);
  const state={sheets,map,set};state.self=state;const emitted=[];
  const result=f.executeDmTool([state],()=>{
    f.db.exec('UPDATE effects SET n=1');sheet.hp=3;sheets.length=0;map.clear();set.add('new');
    state.added={};delete state.self;f.afterCommit(()=>emitted.push(1));return {error:'refused'};
  });
  assert.equal(result.error,'refused');assert.equal(f.count(),0);assert.equal(sheet.hp,10);
  assert.equal(sheets[0],sheet);assert.equal(map.get('hero'),sheet);assert.deepEqual([...set],['old']);
  assert.equal(state.self,state);assert.equal(state.added,undefined);assert.deepEqual(emitted,[]);
});
test('legitimate failed dice outcomes retain their authoritative effects',t=>{
  const f=fixture(t), state={hp:10}, emitted=[];
  const result=f.executeDmTool([state],()=>{state.hp=7;f.db.exec('UPDATE effects SET n=1');f.afterCommit(()=>emitted.push(1));return {success:false,hit:false};});
  assert.deepEqual(result,{success:false,hit:false});assert.equal(state.hp,7);assert.equal(f.count(),1);assert.deepEqual(emitted,[1]);
});
test('successful sibling commits while a nested dispatcher refusal rolls back',t=>{
  const f=fixture(t), a={n:0}, b={n:0}, emitted=[];
  f.withCommittedEffects(()=>f.adapter.transaction(()=>{
    f.executeDmTool([a],()=>{a.n=1;f.db.exec('UPDATE effects SET n=n+1');f.afterCommit(()=>emitted.push('a'));return {ok:true};});
    const result=f.executeDmTool([b],()=>{b.n=1;f.db.exec('UPDATE effects SET n=n+10');f.afterCommit(()=>emitted.push('b'));return {result:{error:'bad'},handled:true};});
    assert.equal(result.result.error,'bad');assert.deepEqual(emitted,[]);
  })());
  assert.equal(f.count(),1);assert.equal(a.n,1);assert.equal(b.n,0);assert.deepEqual(emitted,['a']);
});
test('unexpected exception rolls back all enclosing SQL and restores the whole cached graph',t=>{
  const f=fixture(t), state={n:0}, error=new Error('persistence fault'), emitted=[];
  assert.throws(()=>f.withGameStateRollback([state],()=>f.withCommittedEffects(()=>f.adapter.transaction(()=>{
    f.executeDmTool([state],()=>{state.n++;f.db.exec('UPDATE effects SET n=n+1');f.afterCommit(()=>emitted.push(1));return {ok:true};});
    f.executeDmTool([state],()=>{state.n++;f.db.exec('UPDATE effects SET n=n+1');throw error;});
  })())),actual=>actual===error);
  assert.equal(state.n,0);assert.equal(f.count(),0);assert.deepEqual(emitted,[]);
});
test('rollback cannot turn a JSON __proto__ property into prototype mutation',t=>{
  const f=fixture(t), state=JSON.parse('{"__proto__":{"n":1},"value":2}');
  const proto=Object.getPrototypeOf(state);
  f.executeDmTool([state],()=>{state.__proto__.n=99;state.value=3;return {error:'refused'};});
  assert.equal(Object.getPrototypeOf(state),proto);assert.equal(Object.hasOwn(state,'__proto__'),true);
  assert.equal(state.__proto__.n,1);assert.equal(state.value,2);assert.equal({}.n,undefined);
});
test('null and undefined non-mutating results preserve the existing handler contract',t=>{
  const f=fixture(t);
  assert.equal(f.executeDmTool([],()=>null),null);assert.equal(f.executeDmTool([],()=>undefined),undefined);
});
test('asynchronous handlers are rejected rather than committed as successful synchronous tools',t=>{
  const f=fixture(t), state={n:0};
  assert.throws(()=>f.executeDmTool([state],()=>{state.n++;f.db.exec('UPDATE effects SET n=n+1');return Promise.resolve({ok:true});}),/must be synchronous/);
  assert.equal(state.n,0);assert.equal(f.count(),0);
});
