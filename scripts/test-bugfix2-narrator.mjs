// Real HostContextMemory and the actual orchestrator's synchronous ingestion,
// restore/reset and serialization methods. Provider/MCP writes are not run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { HostContextMemory } from '../narrator/compaction.mjs';

let checks=0;
const test=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`);};
const clone=x=>structuredClone(x);
const message=(id='m1',seq=1,content='The hero found an artifact')=>({id,seq,content,authorType:'player',userId:'p1',channel:'global',visibility:'global'});
const snap=(seq,messages=[],events=[],extra={})=>({campaignId:'c',timelineEpoch:'e',currentSeq:seq,cursor:0,nextCursor:seq,hasMore:false,messages,events,campaign:{id:'c',gameSettings:{}},...extra});
const deleted=(id='m1',messageSeq=1,seq=2)=>({type:'message_deleted',seq,payload:{messageId:id,messageSeq}});
const clean=(m,text)=>assert.ok(!JSON.stringify(m.getPromptContext()).includes(text));
const memory=opts=>new HostContextMemory({campaignId:'c',maxRecentMessages:1,compactionBatchSize:1,...opts});

test('deletion clears recent text and derived milestones, not committed mechanics',()=>{
  const m=memory();m.ingestReadSnapshot(snap(1,[message('m1',1,'death of the innkeeper')],[],{sheets:[{id:'pc',hp:3}],recentRolls:[{id:'roll',total:12}]}));
  assert.equal(m.milestones.length,1);m.ingestReadSnapshot(snap(2,[],[deleted()]));
  clean(m,'death of the innkeeper');assert.equal(m.messages.length,0);assert.equal(m.milestones.length,0);
  assert.equal(m.sheets.get('pc').hp,3);assert.equal(m.rolls.length,1);
});
test('deletion clears folded summary records, segments and milestones',()=>{
  const m=memory();m.ingestReadSnapshot(snap(2,[message('m1',1,'quest complete withdrawn'),message('m2',2,'Keep this line')]));
  assert.equal(m.summaryRecords.length,1);m.ingestReadSnapshot(snap(3,[],[deleted('m1',1,3)]));
  clean(m,'quest complete withdrawn');assert.equal(m.summaryRecords.length,0);assert.equal(m.summarySegments.length,0);assert.equal(m.messages[0].id,'m2');
});
test('a deletion wins over overlapping rows even on the first snapshot',()=>{
  const m=memory();m.ingestReadSnapshot(snap(2,[message('m1',1,'withdrawn-before-first-read')],[deleted()]));
  clean(m,'withdrawn-before-first-read');assert.equal(m.messages.length,0);
});
test('a tombstone survives checkpoint restore and blocks stale updated rows',()=>{
  const m=memory();m.ingestReadSnapshot(snap(2,[message()],[deleted()]));
  const restored=memory();restored.restoreState(JSON.parse(JSON.stringify(m.serializeState())));
  restored.ingestReadSnapshot(snap(5,[{...message('m1',1,'stale-replayed-withdrawn'),updatedSeq:4}]));
  clean(restored,'stale-replayed-withdrawn');assert.equal(restored.deletedMessages.has('m1'),true);
});
test('repeated tombstones are idempotent and keep later unrelated messages',()=>{
  const m=memory();m.ingestReadSnapshot(snap(3,[message(),message('m2',2,'Keep me')],[deleted('m1',1,3)]));
  const first=m.serializeState();m.ingestReadSnapshot(snap(3,[],[deleted('m1',1,3)]));
  assert.deepEqual(m.serializeState(),first);assert.equal(m.messages[0].content,'Keep me');
});
test('a newer edit wins over stale recentMessages and clears obsolete milestone text',()=>{
  const m=memory();const old=message('m1',1,'death obsolete');m.ingestReadSnapshot(snap(1,[old]));
  m.ingestReadSnapshot(snap(2,[],[{seq:2,type:'message_updated',payload:{message:{...old,content:'Alive and well',updatedSeq:2}}}],{recentMessages:[old]}));
  assert.equal(m.messages[0].content,'Alive and well');assert.equal(m.milestones.length,0);clean(m,'death obsolete');
});
test('legacy untraceable summary is discarded instead of retaining a withdrawn claim',()=>{
  const m=memory({initialSummary:'legacy withdrawn claim'});m.ingestReadSnapshot(snap(2,[],[deleted()]));
  clean(m,'legacy withdrawn claim');assert.equal(m.summaryRecords.length,0);
});
test('legacy v2 summary ranges are invalidated only where deletion can affect them',()=>{
  const m=memory();m.restoreState({formatVersion:2,campaignId:'c',timelineEpoch:'e',summarySegments:[
    {fromSeq:1,toSeq:3,text:'Withdrawn grouped text'}, {fromSeq:10,toSeq:12,text:'Unaffected grouped text'}
  ]});
  m.ingestReadSnapshot(snap(20,[],[deleted('m2',2,20)]));clean(m,'Withdrawn grouped text');assert.match(m.summary,/Unaffected grouped text/);
});
test('an out-of-order read in the same explicit epoch does not reset tombstones',()=>{
  const m=memory();m.ingestReadSnapshot(snap(3,[],[deleted('m1',1,3)]));
  m.ingestReadSnapshot(snap(1,[message('m1',1,'old snapshot withdrawn')]));
  clean(m,'old snapshot withdrawn');assert.equal(m.lastCurrentSeq,3);assert.equal(m.deletedMessages.has('m1'),true);
});
test('a new timeline can legitimately restore the old message ID',()=>{
  const m=memory();m.ingestReadSnapshot(snap(3,[],[deleted('m1',1,3)]));
  m.ingestReadSnapshot(snap(1,[message('m1',1,'Restored by timeline rewind')],[],{timelineEpoch:'new-epoch'}));
  assert.equal(m.deletedMessages.size,0);assert.equal(m.messages[0].content,'Restored by timeline rewind');
});
test('missing rows in a partial delta do not delete unrelated retained history',()=>{
  const m=memory();m.ingestReadSnapshot(snap(2,[message(),message('m2',2,'Retained')]));
  m.ingestReadSnapshot(snap(4,[],[]));assert.equal(m.summaryRecords.length,1);assert.equal(m.messages[0].id,'m2');
});
test('deletion does not widen any remaining private room audience',()=>{
  const m=memory();const privateMessage={...message('secret',1,'Private surviving text'),roomId:'r',channel:'location',visibility:'witnesses',witnessUserIds:['p1']};
  m.ingestReadSnapshot(snap(3,[privateMessage,message('m2',2,'Public')],[deleted('m2',2,3)]));
  assert.ok(!JSON.stringify(m.getPromptContext({viewerUserId:'p2'})).includes('Private surviving text'));
  assert.ok(JSON.stringify(m.getPromptContext({viewerUserId:'p1'})).includes('Private surviving text'));
});
test('old v3 checkpoints without tombstones remain supported',()=>{
  const m=memory();m.restoreState({version:3,campaignId:'c',timelineEpoch:'e',messages:[message()],summaryRecords:[]});
  m.ingestReadSnapshot(snap(2,[],[deleted()]));assert.equal(m.messages.length,0);
});
test('deletion ledger overflow fails closed instead of forgetting earlier deletions',()=>{
  const m=memory({maxSeenMessages:1});m.ingestReadSnapshot(snap(2,[],[deleted()]));
  assert.throws(()=>m.ingestReadSnapshot(snap(4,[],[deleted('m2',3,4)])),/deletion ledger/);
  assert.equal(m.deletedMessages.has('m1'),true);
});

// Select the production method group, avoiding unrelated provider/runtime
// imports. An optional source path allows running a verified method excerpt
// in a disconnected review environment; repository runs use the full file.
const source=readFileSync(process.env.ODM_ORCHESTRATION_SOURCE ?? new URL('../narrator/orchestration.mjs',import.meta.url),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`Missing source boundary ${start}`);return source.slice(a,b);};
const code=between('const clone =','const narratorGuidance =')+
  between('export function publicProjection','function floorAllowsAutopilot').replace('export function','function')+
  between('export class NarratorOrchestrator','  pause(host, reason)').replace('export class','class')+
  '}\nglobalThis.Controller=NarratorOrchestrator;';
const context={structuredClone,crypto,process,resolveNarratorPlayMode:()=> 'full'};
vm.runInNewContext(code,context);
let releases=0;
const controller=()=>new context.Controller({adapter:{generate:async()=>{throw new Error('Provider calls are outside this test.');},releaseConversation:()=>releases++}});
const current=input=>({input:clone(input),outcomes:[],waiting:[],resolved:{},steps:3});

test('orchestrator removes a queued deleted message from both history and queue',()=>{
  const c=controller();c.ingestReadSnapshot(snap(1,[message()]));assert.equal(c.state.queue.length,1);
  c.ingestReadSnapshot(snap(2,[],[deleted()]));assert.equal(c.state.queue.length,0);assert.equal(c.state.history.length,0);
});
test('orchestrator retracts an uncommitted current input and releases sticky context',()=>{
  const c=controller();c.ingestReadSnapshot(snap(1,[message()]));c.state.current=current(c.state.queue.shift());c.refereeContext={key:'referee'};
  const before=releases;c.ingestReadSnapshot(snap(2,[],[deleted()]));assert.equal(c.state.current,null);assert.equal(releases,before+1);
});
test('batched round deletion removes only the withdrawn input before mechanics',()=>{
  for(const kind of ['global_round','spotlight_batch','lead_response']){
    const c=controller(),a=message('m1',1,'Withdraw this action'),b=message('m2',2,'Keep this action');
    c.state.current=current({id:'batch',seq:3,kind,messages:[a,b],content:a.content+'\n'+b.content});
    c.ingestReadSnapshot(snap(4,[],[deleted('m1',1,4)]));
    assert.equal(c.state.current.input.messages.length,1);assert.equal(c.state.current.input.messages[0].id,'m2');
    assert.ok(!c.state.current.input.content.includes('Withdraw this action'));assert.equal(c.state.current.steps,0);
  }
});
test('deletion after effects or an ambiguous write pauses instead of repeating mechanics',()=>{
  for(const phase of ['outcomes','waiting','pending']){
    const c=controller();c.state.current=current(message());c.refereeContext={key:'referee'};
    if(phase==='pending')c.state.pending={commandId:'keep-existing-id',attempts:1};else c.state.current[phase].push({id:'committed'});
    const before=clone(c.state.pending);c.ingestReadSnapshot(snap(2,[],[deleted()]));
    assert.equal(c.state.paused,'input_changed_after_effects');assert.equal(c.refereeContext,null);assert.deepEqual(c.state.pending,before);
  }
});
test('restored orchestrator checkpoint receives deletion without replaying the input',()=>{
  const c=controller();c.ingestReadSnapshot(snap(1,[message()]));const restored=controller();restored.restore(c.serialize());
  restored.ingestReadSnapshot(snap(2,[],[deleted()]));assert.equal(restored.state.queue.length,0);assert.equal(restored.state.history.length,0);
});
console.log(`Passed ${checks} narrator regression groups.`);
