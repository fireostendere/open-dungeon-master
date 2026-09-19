import test from 'node:test';
import assert from 'node:assert/strict';
import { narratorHarness as runner,snapshot,message,pages } from './lib/astra-narrator-harness.mjs';
test('handshake and metadata never acknowledge an unread story page',async()=>{
 const f=await runner({control:(action,p)=>action==='narrator.connect'?{state:snapshot(0,1,3,true,[message(1)])}:p.afterSeq===0?snapshot(0,1,3,true,[message(1)]):snapshot(1,3,3,false,[message(2),message(3)])});
 await f.instance.connect();const storyReads=f.calls.filter(c=>c.action==='narrator.read'&&c.params.limit===50);assert.deepEqual(storyReads.map(c=>c.params.afterSeq),[0,1]);assert.deepEqual(storyReads.map(c=>c.params.projection),['full','full']);
 assert.equal(f.instance.lastSeq,3);assert.deepEqual(f.instance.memory.messages.map(m=>m.id),['m1','m2','m3']);assert.equal(f.saved.at(-1).lastSeq,3);
});
test('accepted pages remain durable after a later failure; retry does not lose input',async()=>{
 let fail=true;const f=await runner({control:(_a,p)=>{if(p.afterSeq===0)return snapshot(0,1,2,true,[message(1)]);if(fail)throw new Error('Network failure');return snapshot(1,2,2,false,[message(2)]);}});
 await assert.rejects(f.instance.drainStory(),/Network/);assert.equal(f.instance.lastSeq,1);assert.equal(f.saved.at(-1).lastSeq,1);assert.equal(f.instance.memory.messages.length,1);
 fail=false;await f.instance.drainStory();assert.equal(f.instance.lastSeq,2);assert.deepEqual(f.instance.memory.messages.map(m=>m.id),['m1','m2']);
});
test('byte pages assemble and hash-verify before any durable acknowledgement',async()=>{
 const chunks=pages(snapshot(0,2,2,false,[message(1),message(2)]));const f=await runner({control:(_a,p)=>p.pageCursor?chunks[1]:chunks[0]});
 await f.instance.drainStory();assert.equal(f.instance.lastSeq,2);assert.equal(f.instance.memory.messages.length,2);assert.equal(f.calls[1].params.afterSeq,0);assert.equal(f.calls[1].params.pageCursor,'p2');
});
test('repeated byte cursor and wrong page hash are rejected without partial memory',async()=>{
 const chunks=pages(snapshot(0,1,1,false,[message(1)]));const f=await runner({control:()=>chunks[0]});await assert.rejects(f.instance.drainStory(),/cursor did not advance/);assert.equal(f.instance.lastSeq,0);
 const bad=await runner({control:(_a,p)=>p.pageCursor?{...chunks[1],hash:'wrong'}:chunks[0]});await assert.rejects(bad.instance.drainStory(),/Inconsistent/);assert.equal(bad.instance.memory.messages.length,0);
});
test('epoch recovery catches a rewind even after sequence numbers have regrown',async()=>{
 const f=await runner({control:(action,p)=>{
  if(action==='narrator.connect')return{};
  return snapshot(p.afterSeq,105,105,false,p.afterSeq===0?[message(1,'REPLACEMENT')]:[],{timelineEpoch:'new'});
 }});f.instance.connected=true;f.instance.timelineEpoch='old';f.instance.lastSeq=100;
 f.instance.memory.ingestReadSnapshot({campaignId:'c',timelineEpoch:'old',currentSeq:100,messages:[message(99,'DISCARDED_SECRET')]});f.instance.answeredAsks.add('old-ask');
 assert.equal(await f.instance.pollTick(),true);assert.equal(f.instance.lastSeq,105);assert.equal(f.instance.answeredAsks.size,0);
 assert.doesNotMatch(JSON.stringify(f.instance.memory.serializeState()),/DISCARDED_SECRET/);assert.match(JSON.stringify(f.instance.memory.serializeState()),/REPLACEMENT/);
});
test('unverified conflicts do not erase the consumed cursor or memory',async()=>{
 const f=await runner({control:()=>{throw Object.assign(new Error('Snapshot changed'),{status:409});}});f.instance.lastSeq=9;f.instance.connected=true;
 f.instance.memory.ingestReadSnapshot({messages:[message(9,'KNOWN')]});assert.equal(await f.instance.pollTick(),false);assert.equal(f.instance.lastSeq,9);assert.match(JSON.stringify(f.instance.memory.serializeState()),/KNOWN/);
});
test('invalid story cursors and messages outside the acknowledged range fail closed',async()=>{
 for(const data of [snapshot(0,0,10,true),snapshot(0,5,10,false),snapshot(0,-1,10,false),snapshot(0,1,1,false,[message(2)])]){
 const f=await runner({control:()=>data});await assert.rejects(f.instance.drainStory());assert.equal(f.instance.lastSeq,0);assert.equal(f.instance.memory.messages.length,0);}
});
test('checkpoint write failure rolls memory and cursor back together',async()=>{
 const f=await runner({failCheckpoint:true,control:()=>snapshot(0,1,1,false,[message(1)])});await assert.rejects(f.instance.drainStory(),/Checkpoint/);assert.equal(f.instance.lastSeq,0);assert.equal(f.instance.memory.messages.length,0);
});
test('collector leaves Ask pending and does not fabricate replies or usage',async()=>{
 const f=await runner({control:()=>{throw new Error('Collector must not write');}});await f.instance.handlePendingAsk({id:'q',userId:'A',version:1,question:'Can I hide?'});
 assert.equal(f.calls.length,0);assert.equal(f.usage.length,0);assert.equal(f.instance.answeredAsks.size,0);assert.equal(f.instance.mode,'collector');
});
test('a real adapter gets only the asker context and ambiguous retries keep the exact UUID',async()=>{
 let attempts=0,modelCalls=0;const f=await runner({askResponder:async(_ask,context)=>{modelCalls++;assert.doesNotMatch(JSON.stringify(context),/FOREIGN_SECRET/);return{answer:'Adapter answer',citations:[],usage:{promptTokens:12,completionTokens:3}};},
 control:action=>{assert.equal(action,'narrator.answer_ask');if(++attempts===1)throw new Error('Lost after commit');return{ok:true};}});
 f.instance.memory.ingestReadSnapshot({messages:[{...message(1,'FOREIGN_SECRET'),witnessUserIds:['B']}]});const ask={id:'q',userId:'A',version:1,question:'Can I hide?'};
 await assert.rejects(f.instance.handlePendingAsk(ask),/Lost/);await f.instance.handlePendingAsk(ask);assert.equal(modelCalls,1);assert.equal(f.usage.length,1);assert.deepEqual(f.calls[0].params,f.calls[1].params);assert.equal(f.instance.answeredAsks.has('q'),true);
});
test('a version conflict never marks a question answered',async()=>{
 const f=await runner({askResponder:async()=>({answer:'A',citations:[]}),control:()=>{throw Object.assign(new Error('Version changed'),{status:409});}});
 await f.instance.handlePendingAsk({id:'q',userId:'A',question:'Question',version:0});assert.equal(f.instance.answeredAsks.has('q'),false);assert.equal(f.instance.pendingAskCommands.size,0);
});
test('existing checkpoint resumes at its durable cursor after metadata verification',async()=>{
 const f=await runner({checkpoint:{campaignId:'c',lastSeq:5,memory:{summary:'KNOWN'}},control:(action,p)=>{
 if(action==='narrator.connect')return{};return p.limit===1?snapshot(0,1,10,true):snapshot(5,10,10,false,[message(6)]);
 }});f.instance.loadCheckpoint();await f.instance.connect();assert.equal(f.instance.lastSeq,10);assert.match(f.instance.memory.summary,/KNOWN/);
 assert.deepEqual(f.calls.filter(c=>c.params.projection==='full').map(c=>c.params.afterSeq),[5]);
});
test('unattributed Ask cannot obtain the unrestricted DM context',async()=>{
 let called=false;const f=await runner({askResponder:async()=>{called=true;return{answer:'A'};}});await assert.rejects(f.instance.handlePendingAsk({id:'q',question:'Question'}),/author is required/);assert.equal(called,false);
});
