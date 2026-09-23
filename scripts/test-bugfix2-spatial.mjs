// Run with: node scripts/test-bugfix2-spatial.mjs
// Real spatial store, real SQLite nested transactions and the actual service.
// Campaign/round/auth/parser/RakoBot dependencies are controlled fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import { createSpatialStore, SpatialError } from '../src/lib/spatial/store.mjs';

let checks = 0;
const test = (name, fn) => { fn(); console.log(`ok ${++checks} - ${name}`); };
const plain = x => JSON.parse(JSON.stringify(x));
const db = new DatabaseSync(':memory:');
let transactionId = 0, depth = 0;
const commitEffects = [];
db.transaction = fn => (...args) => {
  const name = `test_${++transactionId}`, effectsStart = commitEffects.length;
  db.exec(`SAVEPOINT ${name}`); depth++;
  let result;
  try { result = fn(...args); db.exec(`RELEASE ${name}`); }
  catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); commitEffects.length = effectsStart; throw error; }
  finally { depth--; }
  if (!depth) for (const effect of commitEffects.splice(0)) effect();
  return result;
};
const afterCommit = fn => depth ? commitEffects.push(fn) : fn();
db.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE campaigns(id TEXT PRIMARY KEY,seq INTEGER NOT NULL DEFAULT 0,floor_json TEXT,global_turn_json TEXT);
CREATE TABLE test_outbox(message_id TEXT PRIMARY KEY,kind TEXT);
`);
const camp = randomUUID(), dm = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID();
const characterA = randomUUID(), characterB = randomUUID(), characterC = randomUUID();
for (const id of [dm, a, b, c]) db.prepare('INSERT INTO users VALUES(?)').run(id);
db.prepare('INSERT INTO campaigns(id,floor_json,global_turn_json) VALUES(?,?,?)').run(camp, '{"mode":"open"}', '{}');
const sheets = [{id:characterA,userId:a},{id:characterB,userId:b},{id:characterC,userId:c}];
const members = [dm,a,b,c].map(userId => ({userId, autopilot:false}));
const settings = { dmMode:'human', unitSystem:'metric', globalTurn:{enabled:true},holdSubmissions:false };
const campaign = {id:camp,kind:'campaign',status:'active',dmUserId:dm,gameSettings:settings};
let encounter = null, pending = [], touches = 0, notifications = 0, resolved = 0, quorum = Infinity;
const row = () => db.prepare('SELECT * FROM campaigns WHERE id=?').get(camp);
const readRound = () => JSON.parse(row().global_turn_json);
const setRound = (phase='active', roundNumber=1) => db.prepare('UPDATE campaigns SET global_turn_json=? WHERE id=?').run(JSON.stringify({phase,roundNumber,actionsByCharacter:{}}), camp);
setRound();
const allocateSeq = () => Number(db.prepare('UPDATE campaigns SET seq=seq+1 WHERE id=? RETURNING seq').get(camp).seq);
const floorOf = (id, roomId) => {
  const raw = roomId && db.prepare('SELECT floor_json FROM spatial_rooms WHERE campaign_id=? AND id=?').get(id,roomId)?.floor_json;
  return JSON.parse(raw || row().floor_json || '{"mode":"open"}');
};
const setFloor = (id,floor,roomId) => roomId
  ? db.prepare('UPDATE spatial_rooms SET floor_json=? WHERE campaign_id=? AND id=?').run(JSON.stringify(floor), id,roomId)
  : db.prepare('UPDATE campaigns SET floor_json=? WHERE id=?').run(JSON.stringify(floor),id);
const canAct = (floor,userId,kind) => kind === 'ooc' || floor.mode === 'open' || floor.mode !== 'hold' && floor.userIds.includes(userId);
const recordAction = (id,sheetId,userId,kind) => {
  const state = readRound();
  if (!['active','quorum_delay'].includes(state.phase)) return {allowed:false,error:'Round closed'};
  const entry = state.actionsByCharacter[sheetId] ?? {actionsCount:0,phrasesCount:0};
  const key = kind === 'do' ? 'actionsCount':'phrasesCount';
  if (entry[key]) return {allowed:false,error:'Quota exhausted'};
  entry[key]++; state.actionsByCharacter[sheetId] = entry;
  db.prepare('UPDATE campaigns SET global_turn_json=? WHERE id=?').run(JSON.stringify(state),id);
  return {allowed:true,state,shouldResolve:Object.keys(state.actionsByCharacter).length>=quorum};
};
const schema = new Proxy({}, {get: (_,key) => key === 'safeParse' ? data => ({success:true,data}) : () => schema});
const z = new Proxy({}, {get: () => () => schema});
const dependencies = {
  zod:{z},
  '@/lib/db/core':{getDatabase:() => db},
  '@/lib/db/commit-effects':{afterCommit},
  '@/lib/spatial/updates.mjs':{notifySpatialChange:() => notifications++},
  '@/lib/db/campaigns':{
    allocateSeq,campaignSeats:() => ({dm}),capsFor:(_,id) => ({role:id===dm?'dm':'player'}),
    getCampaignForUser:(id,user) => id===camp && members.some(m=>m.userId===user)?campaign:null,
    getGlobalTurnState:readRound,listMembers:()=>members,touchCampaign:()=>touches++,canAct,getFloor:floorOf,setFloor,
    normalizeFloor:raw=>raw??{mode:'open'},
  },
  '@/lib/db/sheets':{getSheetForUser:(id,userId) => sheets.find(s=>s.userId===userId)},
  '@/lib/db/encounters':{getActiveEncounter:(id,roomId)=>encounter && (!roomId||encounter.roomId===roomId)?encounter:null},
  '@/lib/db/dm-turns':{listOpenPendingRolls:()=>pending},
  '@/lib/db/moderation':{isMemberMuted:()=>false},
  '@/lib/dm/delegation':{coverInEffect:()=>false},
  '@/lib/dm/global-turn-logic':{recordGlobalTurnAction:recordAction,resolveGlobalTurn:async()=>{resolved++;}},
  '@/lib/dm/viewer':{isDmSeat:(_,userId)=>userId===dm},
  '@/lib/spatial/store.mjs':{createSpatialStore,SpatialError},
  '@/lib/spatial/domain-migration':{capturePreSpatialEntities:()=>{}},
  '@/lib/units/narration':{normalizeNarrationUnits:x=>x},
  '@/lib/events':{publishEphemeral:()=>{}},
  '@/lib/integrations/rakobot':{queuePlayerAction:(campaignId,source,id,kind)=>{
    assert.equal(campaignId,camp); assert.equal(source,'spatial');
    assert.ok(db.prepare('SELECT id FROM spatial_messages WHERE id=?').get(id));
    db.prepare('INSERT INTO test_outbox VALUES(?,?)').run(id,kind);
  }},
};
const source = readFileSync(new URL('../src/lib/spatial/service.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(output.diagnostics.length,0);
const module = {exports:{}};
vm.runInNewContext(output.outputText, {module, exports:module.exports, console, require:specifier => {
  assert.ok(dependencies[specifier],`Unexpected dependency ${specifier}`);
  return dependencies[specifier];
}}, {filename:'spatial/service.ts'});
const {runSpatialCommand:command,spatialStore,spatialContext}=module.exports;
const request = (user, data) => command(camp,user,{requestId:randomUUID(),...data});
const room = request(dm,{operation:'enable',name:'Tavern'}).roomId;
const send = (user,overrides={})=>({operation:'send',requestId:randomUUID(),roomId:room,expectedRevision:spatialStore().getUserPosition(camp,user).revision,kind:'do',content:'Inspect the door',...overrides});
const count = table => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
const counts=()=>({messages:count('spatial_messages'),requests:count('spatial_requests'),outbox:count('test_outbox'),notifications,resolved});
let first;
test('fresh send accounts once and persists the canonical character',()=>{
  first=send(a,{stealth:true}); command(camp,a,first);
  assert.equal(readRound().actionsByCharacter[characterA].actionsCount,1);
  assert.equal(spatialStore().getStealthState(camp,characterA).status,'pending');
  assert.equal(spatialStore().getStealthState(camp,a),null);
});
test('same/later-round replay does not consume quota or duplicate feed/wakeups',()=>{
  const result=command(camp,a,first), before=counts();
  for(const phase of ['active','ready','resolving']) {
    setRound(phase,1); assert.deepEqual(plain(command(camp,a,first)),plain(result));
    assert.deepEqual(readRound().actionsByCharacter,{});
  }
  setRound('active',2); assert.deepEqual(plain(command(camp,a,first)),plain(result));
  assert.deepEqual(readRound().actionsByCharacter,{}); assert.deepEqual(counts(),before);
});
test('changed payload under an old request ID is rejected atomically',()=>{
  const before=counts(); assert.throws(()=>command(camp,a,{...first,content:'Different'}),e=>e.status===409);
  assert.deepEqual(counts(),before);
});
test('a removed member cannot retrieve an old private receipt',()=>{
  const index=members.findIndex(m=>m.userId===a), member=members.splice(index,1)[0];
  assert.throws(()=>command(camp,a,first),e=>e.status===404); members.splice(index,0,member);
});
test('foreign, enemy and nonexistent character IDs cannot modify stealth',()=>{
  const before=counts();
  for(const target of [characterB,'enemy-1',randomUUID()]) assert.throws(()=>command(camp,a,send(a,{characterId:target,stealth:true})),e=>e.status===403);
  assert.deepEqual(counts(),before); assert.equal(spatialStore().getStealthState(camp,characterB),null);
});
test('quota rejection rolls message, receipt, outbox and floor back together',()=>{
  setRound(); command(camp,a,send(a));
  setFloor(camp,{mode:'spotlight',userIds:[a,b],respondedUserIds:[],prompt:'Act'},room);
  const retry=send(a), before=counts(); assert.throws(()=>command(camp,a,retry),e=>e.status===409);
  assert.deepEqual(counts(),before); assert.deepEqual(floorOf(camp,room).respondedUserIds,[]);
  setRound('active',3); command(camp,a,retry); assert.deepEqual(floorOf(camp,room).respondedUserIds,[a]);
  setFloor(camp,{mode:'open'},room);
});
test('hold blocks do/say but not OOC; sealed global phases reject new input',()=>{
  setFloor(camp,{mode:'hold',next:{mode:'open'}},room);
  for(const kind of ['do','say']) assert.throws(()=>command(camp,b,send(b,{kind})),e=>e.status===409);
  const before=count('test_outbox'); command(camp,b,{...send(b),kind:'ooc',roomId:null}); assert.equal(count('test_outbox'),before);
  setFloor(camp,{mode:'open'},room);
  for(const phase of ['waiting','ready','resolving']) {setRound(phase);assert.throws(()=>command(camp,b,send(b)),e=>e.status===409);}
  setRound();
});
test('initiative permits only its PC with ready order and no pending rolls',()=>{
  encounter={id:randomUUID(),roomId:room,round:1,turnIndex:0,orderReady:true,order:[{kind:'pc',characterId:characterA}]};
  const floor={mode:'initiative',encounterId:encounter.id,userIds:[a],currentName:'A',round:1}; setFloor(camp,floor,room);
  assert.throws(()=>command(camp,b,send(b)),e=>e.status===409);
  encounter.orderReady=false; assert.throws(()=>command(camp,a,send(a)),e=>e.status===409);
  encounter.orderReady=true; pending=[{userId:a,characterId:characterA}]; assert.throws(()=>command(camp,a,send(a)),e=>e.status===409); pending=[];
  const action=send(a), accepted=command(camp,a,action); assert.equal(floorOf(camp,room).mode,'hold');
  assert.throws(()=>command(camp,a,send(a)),e=>e.status===409); assert.deepEqual(plain(command(camp,a,action)),plain(accepted));
  request(dm,{operation:'send',roomId:room,kind:'narration',content:'The attempt resolves.'}); assert.equal(floorOf(camp,room).mode,'initiative');
  encounter=null;setFloor(camp,{mode:'open'},room);setRound();
});
test('hidden occupants are observer-specific, expire, and preserve room prose audience',()=>{
  settings.globalTurn.enabled=false;
  const message=command(camp,a,send(a,{stealth:true})).message;
  request(dm,{operation:'stealth_resolve',messageId:message.id,outcome:'confirmed'});
  const visible=user=>spatialStore().view(spatialContext(camp,user).actor).rooms.find(r=>r.id===room).occupants;
  assert.ok(visible(a).includes(a));assert.ok(visible(dm).includes(a));assert.ok(!visible(b).includes(a));
  request(dm,{operation:'detect',observerId:characterC,targetId:characterA,roomId:room,state:'detected'});
  assert.ok(visible(c).includes(a));assert.ok(!visible(b).includes(a));
  request(dm,{operation:'detect',observerId:b,targetId:characterA,roomId:room,state:'detected',expiresAt:'2000-01-01T00:00:00.000Z'});
  assert.ok(!visible(b).includes(a));
  const narration=request(dm,{operation:'send',roomId:room,kind:'narration',content:'A bell rings.'}).message;
  assert.ok(spatialStore().canReadMessage(spatialContext(camp,a).actor,narration.id));
  request(dm,{operation:'stealth_resolve',messageId:message.id,outcome:'revealed'}); assert.ok(visible(b).includes(a));
});
test('outer narrator rollback leaves no message, receipt, feed entry or wakeup',()=>{
  const before=counts();
  assert.throws(()=>db.transaction(()=>{command(camp,b,send(b));throw new Error('Narrator abort');})(),/Narrator abort/);
  assert.deepEqual(counts(),before);
});
test('autopilot-style send resolves omitted room and revision for do and say',()=>{
  settings.globalTurn.enabled=true; setRound();
  for(const kind of ['do','say']) {
    const result=request(a,{operation:'send',kind,characterId:characterA,content:'Autopilot action'});
    assert.equal(result.message.roomId,room); assert.equal(result.message.authorUserId,a);
  }
  assert.deepEqual(readRound().actionsByCharacter[characterA],{actionsCount:1,phrasesCount:1});
});
test('omitted-position retry stays pinned to its receipt after a move and new round',()=>{
  setRound(); const action={requestId:randomUUID(),operation:'send',kind:'do',characterId:characterA,content:'Autopilot action'};
  const original=command(camp,a,action);
  const elsewhere=request(dm,{operation:'create_room',name:'Cellar',connectTo:room}).roomId;
  request(dm,{operation:'move',roomId:elsewhere,userIds:[a]});setRound('active',99);
  const before=counts();assert.deepEqual(plain(command(camp,a,action)),plain(original));assert.deepEqual(counts(),before);
  assert.deepEqual(readRound().actionsByCharacter,{});
  const fresh=request(a,{operation:'send',kind:'do',content:'New action'}); assert.equal(fresh.message.roomId,elsewhere);
  request(dm,{operation:'move',roomId:room,userIds:[a]});setRound();
});
test('explicit stale or partial positions cannot silently retarget a send',()=>{
  const before=counts();
  for(const fields of [{roomId:room},{expectedRevision:1},{roomId:null},{roomId:room,expectedRevision:999}]) {
    assert.throws(()=>request(a,{operation:'send',kind:'do',content:'Stale action',...fields}),e=>e.status===409);
  }
  assert.deepEqual(counts(),before);
});
test('missing placement returns a domain conflict and can be safely retried after placement',()=>{
  db.prepare('DELETE FROM spatial_presence WHERE user_id=?').run(a);
  const action={requestId:randomUUID(),operation:'send',kind:'do',content:'Autopilot action'}, before=counts();
  assert.throws(()=>command(camp,a,action),e=>e.status===409&&/Place the player/.test(e.message)); assert.deepEqual(counts(),before);
  request(dm,{operation:'move',roomId:room,userIds:[a]}); command(camp,a,action);
});
test('last autopilot response seals only after commit and never twice on replay',()=>{
  setRound();quorum=1;
  const action={requestId:randomUUID(),operation:'send',kind:'do',content:'Final action'}, before=resolved;
  db.transaction(()=>{command(camp,b,action);assert.equal(resolved,before);})();
  assert.equal(resolved,before+1);command(camp,b,action);assert.equal(resolved,before+1);quorum=Infinity;
});
db.close();
console.log(`Passed ${checks} spatial regression groups.`);
