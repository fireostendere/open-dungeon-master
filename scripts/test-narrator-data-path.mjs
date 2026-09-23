import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { RevisionCache, NARRATOR_SECTION_SOURCES, projectionDigest } from '../src/lib/db/revision-cache.mjs';
import { withStatementCache } from '../src/lib/db/statement-cache.mjs';
import { readNarratorSections } from '../src/lib/mcp-read-sections.mjs';
import { atomicWriteJson, readJsonSafe } from '../narrator/checkpoint-io.mjs';
import { compactRolePacket } from '../narrator/role-packet.mjs';
import { consumePostWriteRead, postWriteReadOptions } from '../narrator/read-session.mjs';
import { NarratorOrchestrator } from '../narrator/orchestration.mjs';

function database(file=':memory:') {
  const db=new DatabaseSync(file);
  for(const table of ['character_sheets','world_facts','campaign_notes','npcs'])db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,campaign_id TEXT,body TEXT)`);
  db.exec('CREATE TABLE IF NOT EXISTS homebrew_entries(id TEXT PRIMARY KEY,body TEXT); CREATE TABLE IF NOT EXISTS chat(id TEXT,body TEXT)');
  return db;
}
function entry(cache,overrides={}) {
  return cache.get({campaignId:'c',timelineEpoch:'e',principal:'dm',section:'facts',dependencies:['world_facts'],load:()=>cache.db.prepare('SELECT * FROM world_facts WHERE campaign_id=? ORDER BY id').all('c'),...overrides});
}
test('unchanged source avoids loader and keeps the content hash contract',()=>{
  const db=database();try {
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','canon');
    const cache=new RevisionCache(db),a=entry(cache),b=entry(cache);
    assert.equal(a,b);assert.equal(cache.stats.loads,1);assert.equal(cache.stats.hits,1);
    assert.equal(a.version,projectionDigest({campaignId:'c',timelineEpoch:'e',section:'facts',content:a.value()}));
    const value=a.value();value[0].body='mutated';assert.equal(entry(cache).value()[0].body,'canon');
  }finally{db.close();}
});

test('rolled-back DDL cannot alias a later schema version and serve a dropped source',()=>{
  const db=database();try {
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','old canon');
    const cache=new RevisionCache(db);entry(cache);
    db.exec('BEGIN; CREATE TABLE unrelated_migration(id TEXT)');
    assert.equal(entry(cache).value().length,1);
    const observed=cache.schemaVersion();
    db.exec('ROLLBACK; DROP TABLE world_facts');
    assert.equal(cache.schemaVersion(),observed,'fixture must reproduce schema_version reuse');
    assert.throws(()=>entry(cache),/no such table/,'missing source must not reuse the cached pre-drop rows');
    db.exec('CREATE TABLE world_facts(id TEXT PRIMARY KEY,campaign_id TEXT,body TEXT)');
    assert.deepEqual(entry(cache).value(),[]);
  }finally{db.close();}
});
test('chat does not invalidate static data; insert/update/delete do',()=>{
  const db=database();try{
    const cache=new RevisionCache(db),a=entry(cache);
    db.prepare('INSERT INTO chat VALUES(?,?)').run('m','speech');assert.equal(entry(cache),a);
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','a');assert.equal(entry(cache).value().length,1);
    db.prepare('UPDATE world_facts SET body=? WHERE id=?').run('b','f');assert.equal(entry(cache).value()[0].body,'b');
    db.prepare('DELETE FROM world_facts WHERE id=?').run('f');assert.equal(entry(cache).value().length,0);assert.equal(cache.stats.loads,4);
  }finally{db.close();}
});
test('campaign reassignment invalidates both campaigns',()=>{
  const db=database();try{
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','a');
    const cache=new RevisionCache(db);entry(cache);
    const other=()=>entry(cache,{campaignId:'d',load:()=>db.prepare('SELECT * FROM world_facts WHERE campaign_id=?').all('d')});
    other();db.prepare('UPDATE world_facts SET campaign_id=? WHERE id=?').run('d','f');
    assert.equal(entry(cache).value().length,0);assert.equal(other().value().length,1);
  }finally{db.close();}
});
test('rollback cannot reuse a cached uncommitted revision token',()=>{
  const db=database();try{
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','base');const cache=new RevisionCache(db),base=entry(cache);
    db.exec('BEGIN');db.prepare('UPDATE world_facts SET body=?').run('uncommitted');entry(cache);db.exec('ROLLBACK');
    assert.equal(entry(cache).value()[0].body,'base');
    db.prepare('UPDATE world_facts SET body=?').run('different committed value');
    assert.equal(entry(cache).value()[0].body,'different committed value');assert.notEqual(entry(cache).version,base.version);
  }finally{db.close();}
});
test('schema rollback/recreation cannot reuse a cached empty baseline',()=>{
  const db=database();try{
    const cache=new RevisionCache(db);db.exec('BEGIN');entry(cache);db.exec('ROLLBACK');
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','now real');assert.equal(entry(cache).value()[0].body,'now real');
    db.exec('DROP TABLE world_facts;CREATE TABLE world_facts(id TEXT PRIMARY KEY,campaign_id TEXT,body TEXT)');assert.equal(entry(cache).value().length,0);
  }finally{db.close();}
});
test('INSERT OR REPLACE across campaigns invalidates implicit deletes',()=>{
  const db=database();try{
    db.exec('PRAGMA recursive_triggers=OFF');db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','a');
    const cache=new RevisionCache(db);entry(cache);db.prepare('INSERT OR REPLACE INTO world_facts VALUES(?,?,?)').run('f','d','b');
    assert.equal(entry(cache).value().length,0);
  }finally{db.close();}
});
test('other connection writes fire persistent invalidation triggers',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-cache-')),file=path.join(dir,'test.db'),db=database(file),other=new DatabaseSync(file);
  try{const cache=new RevisionCache(db);entry(cache);other.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','external');assert.equal(entry(cache).value()[0].body,'external');}
  finally{other.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('homebrew changes invalidate sheets; facts invalidate NPC witness notes',()=>{
  const db=database();try{
    const cache=new RevisionCache(db),load=()=>[];
    const sheets=()=>entry(cache,{section:'sheets',dependencies:NARRATOR_SECTION_SOURCES.sheets,load});
    const npcs=()=>entry(cache,{section:'npcs',dependencies:NARRATOR_SECTION_SOURCES.npcs,load});
    sheets();npcs();const before=cache.stats.loads;
    db.prepare('INSERT INTO homebrew_entries VALUES(?,?)').run('h','item');sheets();assert.equal(cache.stats.loads,before+1);
    db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','witness');npcs();assert.equal(cache.stats.loads,before+2);
  }finally{db.close();}
});
test('cache scopes timeline and narrator identity; memory and entries are bounded',()=>{
  const db=database();try{
    const cache=new RevisionCache(db,{maxEntries:2,maxBytes:500});entry(cache);entry(cache,{timelineEpoch:'new'});entry(cache,{principal:'other'});
    assert.equal(cache.stats.loads,3);assert.equal(cache.entries.size,2);assert.ok(cache.bytes<=500);
    entry(cache,{load:()=>[{body:'x'.repeat(1000)}],variant:'large'});assert.ok(cache.bytes<=500);
  }finally{db.close();}
});
test('missing dependency tables bypass cache rather than serving stale results',()=>{
  const db=new DatabaseSync(':memory:');try{const cache=new RevisionCache(db);let loads=0;
    const read=()=>entry(cache,{load:()=>[{value:++loads}]});assert.equal(read().value()[0].value,1);assert.equal(read().value()[0].value,2);
  }finally{db.close();}
});
test('section negotiation avoids loading/decoding unchanged data and keeps historical omissions explicit',()=>{
  const db=database();try{
    let loads=0;const loaders=Object.fromEntries(['sheets','facts','notes','npcs','recentMessages','recentRolls','chapters'].map(key=>[key,()=>{loads++;return [{id:key}];}]));
    const options={db,campaignId:'c',timelineEpoch:'e',principal:'dm',live:true,delta:true,loaders};
    const a=readNarratorSections(options);assert.equal(loads,4);
    const b=readNarratorSections({...options,knownSections:a.sectionVersions});assert.equal(loads,4);assert.equal(b.sections.sheets.length,0);assert.ok(b.omittedSections.includes('sheets'));
    assert.equal(b.sectionVersions.sheets,a.sectionVersions.sheets);
    const c=readNarratorSections({...options,live:false});assert.equal(loads,7);assert.equal(c.sections.recentMessages.length,1);
  }finally{db.close();}
});

test('statement reuse caches programs, not results, and respects parameters',()=>{
  const raw=new DatabaseSync(':memory:');let preparations=0;
  const db=withStatementCache({prepare(sql){preparations++;return raw.prepare(sql);},exec:sql=>raw.exec(sql),pragma:sql=>raw.prepare(`PRAGMA ${sql}`).all(),transaction:fn=>fn,close:()=>raw.close()},2);
  try{db.exec('CREATE TABLE x(id INTEGER,value TEXT)');db.prepare('INSERT INTO x VALUES(?,?)').run(1,'a');
    assert.equal(db.prepare('SELECT value FROM x WHERE id=?').get(1).value,'a');const n=preparations;
    assert.equal(db.prepare('SELECT value FROM x WHERE id=?').get(2),undefined);assert.equal(preparations,n);
    db.prepare('UPDATE x SET value=?').run('b');assert.equal(db.prepare('SELECT value FROM x WHERE id=?').get(1).value,'b');
    db.exec('ALTER TABLE x ADD COLUMN extra TEXT');db.prepare('SELECT value FROM x WHERE id=?').get(1);assert.ok(preparations>n);
  }finally{db.close();}
});
function temporary(work){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-checkpoint-'));try{return work(path.join(dir,'state.json'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const checkpoint=()=>({formatVersion:3,memory:{messages:[{content:'canon'}]},lastSeq:2,pendingAskCommands:{},metrics:{calls:1},updatedAt:'a',lastPollAt:1});
test('duplicate checkpoints and idle timestamps do not rewrite durable state',()=>temporary(file=>{
  const data=checkpoint();assert.equal(atomicWriteJson(file,data).written,true);
  assert.equal(atomicWriteJson(file,{...data,updatedAt:'b',lastPollAt:99,lastError:'advisory'}).written,false);
  assert.equal(readJsonSafe(file).lastSeq,2);assert.ok(fs.statSync(file).size<Buffer.byteLength(JSON.stringify(data,null,2)));
}));
for(const field of ['lastSeq','pendingAskCommands','memory','metrics'])test(`checkpoint persists changed ${field}`,()=>temporary(file=>{
  const data=checkpoint();atomicWriteJson(file,data);const next={...data,[field]:field==='lastSeq'?3:{changed:'must persist'}};
  assert.equal(atomicWriteJson(file,next).written,true);assert.deepEqual(readJsonSafe(file)[field],next[field]);
}));
test('external restore invalidates checkpoint duplicate suppression',()=>temporary(file=>{
  const data=checkpoint();atomicWriteJson(file,data);fs.writeFileSync(file,'{}');assert.equal(atomicWriteJson(file,data).written,true);assert.equal(readJsonSafe(file).lastSeq,2);
}));
test('failed fsync preserves prior checkpoint and removes temporary file',()=>temporary(file=>{
  const data=checkpoint();atomicWriteJson(file,data);const original=fs.fsyncSync;
  fs.fsyncSync=()=>{throw new Error('disk failure');};try{assert.throws(()=>atomicWriteJson(file,{...data,lastSeq:3}),/disk failure/);}finally{fs.fsyncSync=original;}
  assert.equal(readJsonSafe(file).lastSeq,2);assert.deepEqual(fs.readdirSync(path.dirname(file)),['state.json']);
}));
test('role projection retains mechanics, rules and audience while removing biography and rendering data',()=>{
  const packet={input:{id:'m',seq:1,content:'attack'},public:{messages:[{id:'m',seq:1,content:'attack'},{id:'old',seq:0,content:'history'}]},state:{sheets:[{id:'p',portrait:{data:'x'.repeat(8000)},backstory:'important',resources:{slots:2},notes:'canon'}]},actions:[{name:'cast'}],schemas:{cast:{rules:'all'}}};
  const result=compactRolePacket('referee',packet);assert.equal(result.state.sheets[0].portrait,undefined);assert.equal(result.state.sheets[0].backstory,undefined);assert.deepEqual(result.state.sheets[0].resources,{slots:2});assert.equal(result.public.messages.length,1);assert.ok(packet.state.sheets[0].portrait);
  assert.deepEqual(compactRolePacket('writer',packet),packet);assert.deepEqual(compactRolePacket('referee',{...packet,task:'answer_ask'}),{...packet,task:'answer_ask'});
});

const epoch='e'.repeat(64), hash='a'.repeat(64);
function host(){return {campaignId:'c',timelineEpoch:epoch,lastSeq:1,readMaxBytes:4096,readPageRetries:0,deltaReads:true,sectionCache:null,
  memory:{value:[],serializeState(){return structuredClone(this.value);},restoreState(value){this.value=value;},ingestReadSnapshot(value){this.value.push(value);}},saveCheckpoint(){},
  async callControl(){throw new Error('unexpected request');},async drainStory(){throw new Error('unexpected redundant read');}};}
const snapshot=()=>({campaign:{id:'c'},timelineEpoch:epoch,cursor:1,currentSeq:2,nextCursor:2,hasMore:false,messages:[{id:'dm',seq:2,authorType:'dm',content:'done'}],pendingRolls:[]});
const receipt=()=>({commandId:'cmd',committedSeq:2,result:{ok:true},state:snapshot(),readAfter:{campaignId:'c',afterSeq:1,projection:'live',delta:true,paged:true,maxBytes:4096,timelineEpoch:epoch}});
function pages(state){const shape={},entries=[];for(const [key,value]of Object.entries(state)){shape[key]=Array.isArray(value)?'array':'value';if(Array.isArray(value))value.forEach((value,index)=>entries.push({key,index,value}));else entries.push({key,value});}
 const hash=crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');const cut=4;
 return [{format:'odm.read.page.v1',hash,shape,offset:0,entries:entries.slice(0,cut),complete:false,nextPage:'next'},
 {format:'odm.read.page.v1',hash,shape,offset:cut,entries:entries.slice(cut),complete:true,nextPage:null}];}
test('receipt snapshot is consumed with zero duplicate network reads',async()=>{const h=host(),state=await consumePostWriteRead(h,receipt());assert.equal(state.currentSeq,2);assert.equal(h.lastSeq,2);assert.equal(h.memory.value.length,1);});
test('readback byte paging starts at the second page with the exact original parameters',async()=>{const h=host(),r=receipt(),list=pages(r.state);r.state=list[0];let calls=0;
 h.callControl=async(action,params)=>{calls++;assert.equal(action,'narrator.read');assert.equal(params.afterSeq,1);assert.equal(params.pageCursor,'next');return list[1];};
 await consumePostWriteRead(h,r);assert.equal(calls,1);assert.equal(h.lastSeq,2);
});
test('incomplete or tampered receipt does not advance cursor or install a baseline',async()=>{const h=host(),r=receipt(),list=pages(r.state);r.state=list[0];list[1].entries[0].value='tampered';h.callControl=async()=>list[1];
 await assert.rejects(consumePostWriteRead(h,r));assert.equal(h.lastSeq,1);assert.equal(h.sectionCache,null);assert.equal(h.memory.value.length,0);
});
test('delta readback restores retained section values without reloading',async()=>{const h=host(),r=receipt();h.sectionCache={scope:`c:${epoch}`,versions:{sheets:hash},values:{sheets:[{id:'p',hp:9}]}};
 r.readAfter.knownSections={sheets:hash};r.state.sectionVersions={sheets:hash};r.state.omittedSections=['sheets'];r.state.sheets=[];
 const state=await consumePostWriteRead(h,r);assert.equal(state.sheets[0].hp,9);
});
test('missing delta baseline fails closed',async()=>{const h=host(),r=receipt();r.readAfter.knownSections={sheets:hash};r.state.sectionVersions={sheets:hash};r.state.omittedSections=['sheets'];r.state.sheets=[];
 await assert.rejects(consumePostWriteRead(h,r),/baseline/);assert.equal(h.lastSeq,1);
});
test('readback older than the committed receipt is rejected',async()=>{const h=host(),r=receipt();r.committedSeq=3;await assert.rejects(consumePostWriteRead(h,r),/predates/);assert.equal(h.lastSeq,1);});
test('failed/foreign readback falls back to read, never another command',async()=>{for(const change of [r=>{r.readRequired=true;},r=>{r.readAfter.campaignId='other';}]){const h=host(),r=receipt();let reads=0;change(r);h.drainStory=async()=>{reads++;return snapshot();};await consumePostWriteRead(h,r);assert.equal(reads,1);}});
test('checkpoint failure rolls back readback memory and cursor',async()=>{const h=host();h.saveCheckpoint=()=>{throw new Error('disk');};await assert.rejects(consumePostWriteRead(h,receipt()),/disk/);assert.equal(h.lastSeq,1);assert.equal(h.memory.value.length,0);});
test('post-write options do not advertise a foreign timeline cache',()=>{const h=host();h.sectionCache={scope:'c:old',versions:{sheets:hash}};assert.equal(postWriteReadOptions(h).knownSections,undefined);});
function play(generate){const h=host();const controller=new NarratorOrchestrator({adapter:{generate}});h.storyController=controller;
 const input={id:'player',seq:1,authorType:'player',userId:'p',content:'look'};const initial={...snapshot(),currentSeq:1,nextCursor:1,messages:[input]};
 controller.catalog=[{actions:[{name:'request_roll'}]}];return {h,controller,initial};}
test('orchestrator publishes one narration and consumes attached state without redundant reads',async()=>{const {h,controller,initial}=play(async()=>JSON.stringify({kind:'narrate',text:'Visible outcome'}));let commands=0;
 h.callControl=async(action,params)=>{commands++;assert.equal(action,'narrator.narrate');assert.equal(params.expectedSeq,1);assert.ok(params.readAfter);return {...receipt(),commandId:params.commandId};};
 assert.equal(await controller.tick(h,initial),true);assert.equal(commands,1);assert.equal(controller.state.handledSeq,1);assert.equal(controller.state.pending,null);
});
test('engine CAS conflict refreshes state without acknowledging input',async()=>{const {h,controller,initial}=play(async()=>JSON.stringify({kind:'narrate',text:'stale'}));let reads=0,writes=0;
 h.callControl=async()=>{writes++;throw Object.assign(new Error('Stale narrator cursor; reread'),{status:409});};h.drainStory=async()=>{reads++;return snapshot();};
 assert.equal(await controller.tick(h,initial),false);assert.equal(writes,1);assert.equal(reads,1);assert.equal(controller.state.handledSeq,0);assert.equal(controller.state.pending,null);
});
test('ambiguous writes retain their exact UUID and payload on receipt recovery',async()=>{const {h,controller,initial}=play(async()=>JSON.stringify({kind:'narrate',text:'one result'}));const calls=[];
 h.callControl=async(_action,params)=>{calls.push(JSON.stringify(params));if(calls.length===1)throw new Error('network');return {...receipt(),commandId:params.commandId,replayed:true};};
 await assert.rejects(controller.tick(h,initial),/network/);await controller.write(h);assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);assert.equal(controller.state.handledSeq,1);
});
test('committed write survives readback failure and restart without replay',async()=>{const {h,controller,initial}=play(async()=>JSON.stringify({kind:'narrate',text:'one'}));let commands=0;
 h.callControl=async(_action,params)=>{commands++;return {...receipt(),commandId:params.commandId,readRequired:true};};h.drainStory=async()=>{throw new Error('read down');};
 await assert.rejects(controller.tick(h,initial),/read down/);assert.equal(controller.state.pending.phase,'committed');assert.equal(controller.state.pending.receipt.state,undefined);
 h.drainStory=async()=>snapshot();await controller.write(h);assert.equal(commands,1);assert.equal(controller.state.handledSeq,1);
});
test('stop while generating never commits the finished draft',async()=>{let finish;const {h,controller,initial}=play(()=>new Promise(resolve=>{finish=resolve;}));const running=controller.tick(h,initial);h.stopping=true;finish(JSON.stringify({kind:'narrate',text:'late'}));assert.equal(await running,false);assert.equal(controller.state.handledSeq,0);});
test('mutation during a loader is not cached under the old revision',()=>{
 const db=database();try{const cache=new RevisionCache(db);let calls=0;
 const load=()=>{calls++;if(calls===1)db.prepare('INSERT INTO world_facts VALUES(?,?,?)').run('f','c','arrived');return [];};
 entry(cache,{load});entry(cache,{load});assert.equal(calls,2);
 }finally{db.close();}
});
test('readback still drains later event pages before acknowledging the final cursor',async()=>{
 const h=host(),r=receipt();r.state.currentSeq=3;r.state.hasMore=true;let calls=0;
 h.readSnapshot=async params=>{calls++;assert.equal(params.afterSeq,2);return {...snapshot(),cursor:2,currentSeq:3,nextCursor:3,messages:[{id:'m3',seq:3,content:'new'}]};};
 const state=await consumePostWriteRead(h,r);assert.equal(calls,1);assert.equal(state.currentSeq,3);assert.equal(h.lastSeq,3);assert.equal(h.memory.value.length,2);
});
test('same-connection rollback invalidates cached prepared statements',()=>{
 let prepared=0,closed=0;const db=withStatementCache({prepare:()=>{prepared++;return {get:()=>1};},transaction:fn=>fn,close:()=>closed++,exec(){},pragma(){}});
 db.prepare('SELECT 1');assert.throws(()=>db.transaction(()=>{throw new Error('rollback');})());db.prepare('SELECT 1');assert.equal(prepared,2);db.close();assert.equal(closed,1);
});
test('model call budget remains durable before invoking the adapter',async()=>{
 let saved=0;const {h,controller,initial}=play(async()=>{assert.ok(saved>0);assert.equal(controller.state.usage.calls,1);return JSON.stringify({kind:'done'});});
 h.saveCheckpoint=()=>{saved++;};await controller.tick(h,initial);assert.equal(controller.state.handledSeq,1);
 const budget=new NarratorOrchestrator({adapter:{generate:async()=>{throw new Error('must not call');}},maxCallsPerHour:1});budget.state.usage.times=[Date.now()];
 await assert.rejects(budget.generate(h,'referee',{}),/budget/);
});
test('timeline reset while generating discards output without acknowledging the new timeline',async()=>{
 let finish;const {h,controller,initial}=play(()=>new Promise(resolve=>{finish=resolve;}));const work=controller.tick(h,initial);
 controller.reset('f'.repeat(64));h.timelineEpoch='f'.repeat(64);finish(JSON.stringify({kind:'done'}));assert.equal(await work,false);assert.equal(controller.state.handledSeq,0);assert.equal(controller.state.paused,'timeline_changed');
});
