import test from 'node:test';
import assert from 'node:assert/strict';
import { HostContextMemory } from '../narrator/compaction.mjs';
const msg = (id, seq, content, extra = {}) => ({ id,seq,content,roomId:'vault',witnessUserIds:['A'],...extra });
const memory = () => new HostContextMemory({ maxRecentMessages:1,compactionBatchSize:1 });
test('both summary APIs retain witnesses and sequence; group audience is an intersection', () => {
 const m=memory();m.ingestReadSnapshot({messages:[msg('secret',1,'death SECRET'),msg('later',2,'later')]});
 const state=m.serializeState();assert.deepEqual(state.summarySegments[0].witnessUserIds,['A']);assert.equal(state.summarySegments[0].sourceId,'secret');
 assert.equal(state.summaryRecords[0].content,'death SECRET');assert.equal(state.summarySegments[0].fromSeq,1);
 assert.match(JSON.stringify(m.getPromptContext('vault',{audienceUserIds:['A']})),/SECRET/);
 assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault',{audienceUserIds:['A','B']})),/SECRET/);
 assert.doesNotMatch(JSON.stringify(m.getPromptContext({roomId:'vault',viewerUserId:'B'})),/SECRET/);
});
test('legacy summaries remain DM-only across empty reads and a restart', () => {
 for(const state of [{summary:'LEGACY'},{summaries:{'room:vault':'LEGACY'}}]) {
 const m=memory();m.restoreState(state);m.ingestReadSnapshot({messages:[]});const r=memory();r.restoreState(m.serializeState());r.ingestReadSnapshot({});
 assert.match(r.getPromptContext().summary,/LEGACY/);assert.doesNotMatch(JSON.stringify(r.getPromptContext({viewerUserId:'A'})),/LEGACY/);
 }});
test('both v2 checkpoint formats migrate without relabelling private memories', () => {
 for (const state of [
 {version:2,summaryRecords:[{id:'s',seq:1,roomId:'vault',witnessUserIds:['A'],content:'PRESERVED'}]},
 {formatVersion:2,summarySegments:[{sourceId:'s',fromSeq:1,toSeq:1,roomId:'vault',witnessUserIds:['A'],visibility:'witnesses',text:'PRESERVED'}],legacySummary:'DM_OLD'},
 ]) {const m=memory();m.restoreState(state);assert.match(m.getPromptContext('vault',{viewerUserId:'A'}).summary,/PRESERVED/);assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault',{viewerUserId:'B'})),/PRESERVED|DM_OLD/);}
});
test('repeat full snapshots are idempotent including after checkpoint restore',()=>{
 const data={messages:[msg('s',1,'death SECRET'),msg('n',2,'latest')]};const m=memory();m.ingestReadSnapshot(data);const before=m.serializeState();
 for(let i=0;i<5;i++)m.ingestReadSnapshot(data);assert.deepEqual(m.serializeState(),before);
 const r=memory();r.restoreState(before);r.ingestReadSnapshot(data);assert.deepEqual(r.serializeState(),before);assert.equal(r.milestones.length,1);
});
test('evicted backfill cannot resurrect folded messages after restart',()=>{
 const options={maxRecentMessages:1,summaryLimitChars:400};const m=new HostContextMemory(options);
 const messages=Array.from({length:10},(_,i)=>msg(`m${i}`,i+1,`message-${i} `+'x'.repeat(200)));
 m.ingestReadSnapshot({messages});const r=new HostContextMemory(options);r.restoreState(m.serializeState());const before=r.serializeState();
 r.ingestReadSnapshot({recentMessages:messages});assert.deepEqual(r.serializeState(),before);
});
test('edits replace retained content and audience instead of duplicating',()=>{
 const m=memory();m.ingestReadSnapshot({messages:[msg('s',1,'death ORIGINAL'),msg('n',2,'later')]});
 m.ingestReadSnapshot({messages:[msg('s',1,'REVISED',{updatedSeq:3,version:2,witnessUserIds:['B']})]});
 assert.doesNotMatch(JSON.stringify(m.getPromptContext()),/ORIGINAL/);assert.doesNotMatch(JSON.stringify(m.getPromptContext('vault',{viewerUserId:'A'})),/REVISED/);
 assert.match(JSON.stringify(m.getPromptContext('vault',{viewerUserId:'B'})),/REVISED/);assert.equal(m.milestones.length,0);
});
test('scope covers mechanical data and nested encounters as well as prose',()=>{
 const m=memory();m.ingestReadSnapshot({recentRolls:[msg('r',1,'ROLL'),{id:'unknown'}],encounter:{encounter:{roomId:'vault'},witnessUserIds:['A'],secret:'FIGHT'},sheets:[msg('s',1,'ignored',{name:'HERO'})]});
 const foreign=m.getPromptContext('street');assert.equal(foreign.recentRolls.length,0);assert.equal(foreign.activeEncounter,null);assert.equal(foreign.characters.length,0);
 assert.equal(m.getPromptContext('vault',{viewerUserId:'A'}).activeEncounter.secret,'FIGHT');
 assert.equal(m.getPromptContext('vault',{viewerUserId:'B'}).characters.length,0);
});
test('OOC never enters memory even with whitespace, casing or explicit kind',()=>{
 const m=memory();m.ingestReadSnapshot({messages:[msg('a',1,' \n(OOC) secret'),msg('b',2,'other',{kind:'ooc'}),msg('c',3,'story')]});
 assert.deepEqual(m.messages.map(m=>m.id),['c']);assert.doesNotMatch(m.summary,/secret|other/);
});
test('epoch/sequence rollback clears discarded knowledge; cross-campaign data is refused',()=>{
 const m=new HostContextMemory({campaignId:'c'});m.ingestReadSnapshot({timelineEpoch:'one',currentSeq:10,messages:[msg('s',9,'DISCARDED')]});
 m.ingestReadSnapshot({timelineEpoch:'two',currentSeq:12,messages:[msg('n',11,'NEW')]});assert.doesNotMatch(JSON.stringify(m.serializeState()),/DISCARDED/);
 m.ingestReadSnapshot({currentSeq:1,messages:[msg('r',1,'REPLACEMENT')]});assert.doesNotMatch(JSON.stringify(m.serializeState()),/NEW/);
 assert.throws(()=>m.ingestReadSnapshot({campaignId:'other'}),/another campaign/);assert.throws(()=>m.restoreState({campaignId:'other'}),/another campaign/);
});
test('empty or unknown recipient sets never imply public knowledge',()=>{
 const m=memory();m.ingestReadSnapshot({messages:[msg('unknown',1,'PRIVATE',{witnessUserIds:undefined}),msg('public',2,'PUBLIC',{roomId:null,visibility:'global'})]});
 const context=JSON.stringify(m.getPromptContext(null,{audienceUserIds:[]}));assert.match(context,/PUBLIC/);assert.doesNotMatch(context,/PRIVATE/);
});
test('diagnostics expose counts only and contexts are deep copies',()=>{
 const m=memory();m.ingestReadSnapshot({messages:[msg('s',1,'SECRET',{witnessUserIds:['PRIVATE_USER']}),msg('n',2,'later')]});
 assert.doesNotMatch(JSON.stringify(m.serializeState({safe:true})),/SECRET|PRIVATE_USER/);const view=m.getPromptContext();view.recentMessages[0].content='MUTATED';assert.equal(m.messages[0].content,'later');
});
test('invalid budgets cannot stall compaction or exceed the aggregate summary budget',()=>{
 const m=new HostContextMemory({maxRecentMessages:0,compactionBatchSize:0,summaryLimitChars:NaN});
 m.ingestReadSnapshot({messages:Array.from({length:40},(_,i)=>msg(`m${i}`,i,'x'))});assert.equal(m.messages.length,30);assert.ok(m.summary.length<=6000);
});
