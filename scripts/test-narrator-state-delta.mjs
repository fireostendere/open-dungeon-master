import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NARRATOR_STATE_DELTA_FORMAT,
  applyNarratorStatePatch,
  createNarratorStatePatch,
  extractNarratorState,
  narratorStateRevision,
  narratorStateScope,
} from '../shared/narrator-state-delta.mjs';
import { NarratorStateDeltaCache, projectNarratorStateDelta } from '../src/lib/mcp-state-delta-cache.mjs';

const epoch='a'.repeat(64);
const principal='11111111-1111-4111-8111-111111111111';
const scope=narratorStateScope({campaignId:'campaign',timelineEpoch:epoch,principal,projection:'live'});
const baseline={
  campaign:{id:'campaign',dmUserId:principal,scene:'gate'},
  currentSeq:10,timelineEpoch:epoch,cursor:10,nextCursor:10,hasMore:false,
  sheets:[
    {id:'hero-a',name:'A',hp:17,ac:16},
    {id:'hero-b',name:'B',hp:9,ac:13},
  ],
  facts:[{id:'fact-a',content:'Known'}],
  pendingRolls:[],
  location:{id:'loc-a',name:'Gate'},
  encounter:null,
};
const changed={
  ...baseline,
  currentSeq:11,nextCursor:11,
  sheets:[
    {id:'hero-a',name:'A',hp:12,ac:16},
    {id:'hero-b',name:'B',hp:9,ac:13},
  ],
};

test('entity patch sends only changed entities and reconstructs the authoritative state',()=>{
  const before=extractNarratorState(baseline),after=extractNarratorState(changed);
  const patch=createNarratorStatePatch(before,after);
  assert.equal(patch.entities.sheets.upsert.length,1);
  assert.equal(patch.entities.sheets.upsert[0].id,'hero-a');
  assert.equal(patch.entities.sheets.upsert[0].hp,12);
  assert.deepEqual(patch.entities.sheets.remove,[]);
  assert.equal(patch.set,undefined);
  const rebuilt=applyNarratorStatePatch(before,patch);
  assert.deepEqual(rebuilt,after);
  assert.equal(narratorStateRevision(scope,rebuilt),narratorStateRevision(scope,after));
});

test('entity deletion is represented as a tombstone instead of resending the array',()=>{
  const before=extractNarratorState(changed);
  const after=extractNarratorState({...changed,sheets:[changed.sheets[0]]});
  const patch=createNarratorStatePatch(before,after);
  assert.deepEqual(patch.entities.sheets.remove,['hero-b']);
  assert.deepEqual(patch.entities.sheets.upsert,[]);
  assert.deepEqual(applyNarratorStatePatch(before,patch),after);
});

test('array order changes are explicit and deterministic',()=>{
  const before=extractNarratorState(changed);
  const after=extractNarratorState({...changed,sheets:[changed.sheets[1],changed.sheets[0]]});
  const patch=createNarratorStatePatch(before,after);
  assert.deepEqual(patch.entities.sheets.order,['hero-b','hero-a']);
  assert.deepEqual(applyNarratorStatePatch(before,patch),after);
});

test('nested object state is deep-diffed instead of resending the whole object',()=>{
  const before=extractNarratorState(baseline);
  const after=extractNarratorState({...baseline,location:{id:'loc-b',name:'Vault'},encounter:{encounter:{id:'enc-1'},enemies:[]}});
  const patch=createNarratorStatePatch(before,after);
  assert.deepEqual(patch.objects.location.set,{id:'loc-b',name:'Vault'});
  assert.deepEqual(patch.set.encounter,{encounter:{id:'enc-1'},enemies:[]});
  assert.equal(patch.entities,undefined);
  assert.deepEqual(applyNarratorStatePatch(before,patch),after);
});

test('nested encounter entities patch one enemy without resending encounter metadata',()=>{
  const start={...baseline,encounter:{
    encounter:{id:'enc-1',round:2,turnIndex:1,orderReady:true},
    enemies:[
      {id:'goblin-a',name:'Goblin A',hp:10,ac:13},
      {id:'goblin-b',name:'Goblin B',hp:8,ac:13},
    ],
  }};
  const next={...start,encounter:{
    ...start.encounter,
    enemies:[
      {id:'goblin-a',name:'Goblin A',hp:3,ac:13},
      {id:'goblin-b',name:'Goblin B',hp:8,ac:13},
    ],
  }};
  const before=extractNarratorState(start),after=extractNarratorState(next);
  const patch=createNarratorStatePatch(before,after);
  assert.equal(patch.set,undefined);
  assert.equal(patch.objects.encounter.set,undefined);
  assert.equal(patch.objects.encounter.objects,undefined);
  assert.equal(patch.objects.encounter.entities.enemies.upsert.length,1);
  assert.equal(patch.objects.encounter.entities.enemies.upsert[0].id,'goblin-a');
  assert.equal(patch.objects.encounter.entities.enemies.upsert[0].hp,3);
  assert.deepEqual(applyNarratorStatePatch(before,patch),after);
});

test('campaign object changes only carry changed nested fields',()=>{
  const start={...baseline,campaign:{...baseline.campaign,clock:{day:3,hour:8},floor:{mode:'open'},questLog:['Find the gate']}};
  const next={...start,campaign:{...start.campaign,clock:{day:3,hour:9}}};
  const before=extractNarratorState(start),after=extractNarratorState(next);
  const patch=createNarratorStatePatch(before,after);
  assert.deepEqual(patch.objects.campaign.objects.clock.set,{hour:9});
  assert.equal(patch.objects.campaign.objects.clock.set.day,undefined);
  assert.equal(patch.objects.campaign.set,undefined);
  assert.deepEqual(applyNarratorStatePatch(before,patch),after);
});

test('server cache negotiates full snapshot, compact patch and self-healing full resync',()=>{
  const cache=new NarratorStateDeltaCache({maxEntries:4,maxBytes:1024*1024});
  const full=projectNarratorStateDelta(baseline,{campaignId:'campaign',timelineEpoch:epoch,principal,projection:'live',cache});
  assert.equal(full.stateDelta.format,NARRATOR_STATE_DELTA_FORMAT);
  assert.equal(full.stateDelta.full,true);
  assert.equal(full.stateDelta.resyncRequired,false);
  assert.ok(Array.isArray(full.sheets));
  assert.equal(full.sectionVersions,undefined);

  const delta=projectNarratorStateDelta(changed,{campaignId:'campaign',timelineEpoch:epoch,principal,projection:'live',knownStateRevision:full.stateDelta.revision,cache});
  assert.equal(delta.stateDelta.full,false);
  assert.equal(delta.sheets,undefined);
  assert.equal(delta.location,undefined);
  assert.equal(delta.stateDelta.patch.entities.sheets.upsert.length,1);
  assert.equal(delta.stateDelta.patch.entities.sheets.upsert[0].hp,12);

  const reconstructed=applyNarratorStatePatch(extractNarratorState(full),delta.stateDelta.patch);
  assert.equal(narratorStateRevision(scope,reconstructed),delta.stateDelta.checksum);

  cache.clear();
  const resync=projectNarratorStateDelta(changed,{campaignId:'campaign',timelineEpoch:epoch,principal,projection:'live',knownStateRevision:delta.stateDelta.revision,cache});
  assert.equal(resync.stateDelta.full,true);
  assert.equal(resync.stateDelta.resyncRequired,true);
  assert.ok(Array.isArray(resync.sheets));
});

test('revision is scoped by campaign timeline principal and projection',()=>{
  const state=extractNarratorState(baseline);
  const a=narratorStateRevision(scope,state);
  const b=narratorStateRevision(narratorStateScope({campaignId:'other',timelineEpoch:epoch,principal,projection:'live'}),state);
  const c=narratorStateRevision(narratorStateScope({campaignId:'campaign',timelineEpoch:'b'.repeat(64),principal,projection:'live'}),state);
  const d=narratorStateRevision(narratorStateScope({campaignId:'campaign',timelineEpoch:epoch,principal,projection:'full'}),state);
  assert.notEqual(a,b);assert.notEqual(a,c);assert.notEqual(a,d);
});
