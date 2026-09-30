import test from 'node:test';
import assert from 'node:assert/strict';
import { drainNarratorStory, readNarratorSnapshot } from '../narrator/read-session.mjs';
import { NarratorStateDeltaCache, projectNarratorStateDelta } from '../src/lib/mcp-state-delta-cache.mjs';

const epoch='a'.repeat(64);
const dm='11111111-1111-4111-8111-111111111111';
const campaignId='22222222-2222-4222-8222-222222222222';

function snapshot(hp=17) {
  return {
    campaign:{id:campaignId,dmUserId:dm,scene:'gate'},
    currentSeq:7,timelineEpoch:epoch,cursor:7,nextCursor:7,hasMore:false,
    events:[],messages:[],commands:[],summary:{},members:[],pendingRolls:[],
    playerWhispers:[],recentDmWhispers:[],asks:[],askQueue:{nextCursor:0,hasMore:false},
    sheets:[{id:'hero',name:'Hero',hp,ac:16}],facts:[],notes:[],npcs:[],
    recentMessages:[],recentRolls:[],chapters:[],location:null,sceneTracker:null,encounter:null,
    spatial:{enabled:false},spatialRooms:[],spatialGrants:[],
  };
}

function hostFor(states) {
  const serverCache=new NarratorStateDeltaCache();
  let index=0;
  const requests=[];
  const host={
    campaignId,timelineEpoch:epoch,deltaReads:true,sectionCache:null,stateCache:null,
    readPageRetries:0,readMaxBytes:65536,requests,
    callControl:async(action,params)=>{
      assert.equal(action,'narrator.read');requests.push(structuredClone(params));
      const state=states[Math.min(index++,states.length-1)];
      return projectNarratorStateDelta(state,{
        campaignId,timelineEpoch:epoch,principal:dm,projection:params.projection??'live',
        knownStateRevision:params.knownStateRevision,cache:serverCache,
      });
    },
  };
  return host;
}

test('host negotiates a revision and reconstructs the next entity patch',async()=>{
  const host=hostFor([snapshot(17),snapshot(12)]);
  const first=await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  assert.equal(first.sheets[0].hp,17);
  assert.match(host.stateCache.revision,/^[a-f0-9]{64}$/);
  const firstRevision=host.stateCache.revision;

  const second=await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  assert.equal(host.requests[1].knownStateRevision,firstRevision);
  assert.equal(host.requests[1].stateDelta,true);
  assert.equal(second.sheets[0].hp,12);
  assert.notEqual(host.stateCache.revision,firstRevision);
});

test('host accepts a full self-healing resync after server cache loss',async()=>{
  let state=snapshot(17);
  let cache=new NarratorStateDeltaCache();
  const requests=[];
  const host={
    campaignId,timelineEpoch:epoch,deltaReads:true,sectionCache:null,stateCache:null,
    readPageRetries:0,readMaxBytes:65536,
    callControl:async(_action,params)=>{
      requests.push(structuredClone(params));
      return projectNarratorStateDelta(state,{
        campaignId,timelineEpoch:epoch,principal:dm,projection:'live',
        knownStateRevision:params.knownStateRevision,cache,
      });
    },
  };
  await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  const old=host.stateCache.revision;
  cache=new NarratorStateDeltaCache();
  state=snapshot(9);
  const healed=await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  assert.equal(requests[1].knownStateRevision,old);
  assert.equal(healed.stateDelta.full,true);
  assert.equal(healed.stateDelta.resyncRequired,true);
  assert.equal(healed.sheets[0].hp,9);
  assert.notEqual(host.stateCache.revision,old);
});

test('verified unchanged live delta performs no memory ingest or checkpoint write',async()=>{
  const serverCache=new NarratorStateDeltaCache();
  const state=snapshot(17);
  let ingests=0,saves=0;
  const host={
    campaignId,timelineEpoch:epoch,lastSeq:7,deltaReads:true,sectionCache:null,stateCache:null,
    readPageRetries:0,readMaxBytes:65536,
    memory:{
      ingestReadSnapshot(){ingests++;},
      serializeState(){return {};},
      restoreState(){},
    },
    saveCheckpoint(){saves++;},
    callControl:async(_action,params)=>projectNarratorStateDelta(state,{
      campaignId,timelineEpoch:epoch,principal:dm,projection:params.projection??'live',
      knownStateRevision:params.knownStateRevision,cache:serverCache,
    }),
  };
  host.readSnapshot=params=>readNarratorSnapshot(host,params);
  await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  ingests=0;saves=0;
  const result=await drainNarratorStory(host);
  assert.equal(result.currentSeq,7);
  assert.equal(ingests,0);
  assert.equal(saves,0);
});

test('host rejects a tampered patch and keeps its previous baseline',async()=>{
  const serverCache=new NarratorStateDeltaCache();
  const firstState=snapshot(17),secondState=snapshot(12);
  let count=0;
  const host={
    campaignId,timelineEpoch:epoch,deltaReads:true,sectionCache:null,stateCache:null,
    readPageRetries:0,readMaxBytes:65536,
    callControl:async(_action,params)=>{
      const result=projectNarratorStateDelta(count++?secondState:firstState,{
        campaignId,timelineEpoch:epoch,principal:dm,projection:'live',
        knownStateRevision:params.knownStateRevision,cache:serverCache,
      });
      if(!result.stateDelta.full)result.stateDelta.patch.entities.sheets.update.hero.set.hp=1;
      return result;
    },
  };
  await readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'});
  const prior=structuredClone(host.stateCache);
  await assert.rejects(
    readNarratorSnapshot(host,{campaignId,afterSeq:7,projection:'live'}),
    /checksum mismatch/,
  );
  assert.deepEqual(host.stateCache,prior);
});
