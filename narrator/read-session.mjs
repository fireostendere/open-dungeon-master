import crypto from 'node:crypto';
import { emitLatency, latencyEnabled } from '../mcp/latency-trace.mjs';
import { normalizeEncounterSnapshot } from './encounter-state.mjs';
import {
  NARRATOR_STATE_DELTA_FORMAT,
  applyNarratorStatePatch,
  extractNarratorState,
  mergeNarratorState,
  narratorStateRevision,
  narratorStateScope,
} from '../shared/narrator-state-delta.mjs';
const fail=(message,status=409,code)=>Object.assign(new Error(message),{status,code});
const seq=value=>Number.isSafeInteger(value)&&value>=0;
const epochOf=state=>typeof state?.timelineEpoch==='string'?state.timelineEpoch:null;
const changed=error=>error?.code==='timeline_changed'||error?.code==='NARRATOR_CURSOR_AHEAD'||/^Narrator cursor is ahead of campaign state/.test(error?.message??'');
const cachedSections=['sheets','facts','notes','npcs','recentMessages','recentRolls','chapters'];
function stateScope(params,state,baseline) {
  const campaign=state.campaign??baseline?.value?.campaign;
  const principal=campaign?.dmUserId;
  if(typeof principal!=='string'||!principal)throw fail('Narrator state delta has no principal.',409);
  return narratorStateScope({campaignId:params.campaignId,timelineEpoch:state.timelineEpoch??baseline?.timelineEpoch,principal,projection:params.projection??'full'});
}
function restoreStateDelta(host,state,params,baseline) {
  const delta=state?.stateDelta;
  if(!delta)return state;
  if(delta.format!==NARRATOR_STATE_DELTA_FORMAT||!/^[a-f0-9]{64}$/.test(delta.revision??''))throw fail('Unsupported narrator state delta.',400);
  if(delta.full) {
    const value=extractNarratorState(state),scope=stateScope(params,state,baseline);
    if(narratorStateRevision(scope,value)!==delta.revision)throw fail('Narrator state checksum mismatch.',409);
    host.stateCache={scope,revision:delta.revision,value,timelineEpoch:state.timelineEpoch,projection:params.projection??'full'};
    return state;
  }
  if(delta.resyncRequired)throw fail('Narrator state requested a full resync.',409,'state_resync');
  if(!baseline||baseline.revision!==delta.baseRevision)throw fail('Missing narrator state baseline.',409,'state_resync');
  const scope=stateScope(params,state,baseline);
  if(baseline.scope!==scope)throw fail('Narrator state baseline scope changed.',409,'state_resync');
  let value;
  try{value=applyNarratorStatePatch(baseline.value,delta.patch);}
  catch(error){throw fail(error instanceof Error?error.message:'Invalid narrator state patch.',409,'state_resync');}
  if(narratorStateRevision(scope,value)!==delta.revision)throw fail('Narrator state checksum mismatch.',409,'state_resync');
  mergeNarratorState(state,value);
  host.stateCache={scope,revision:delta.revision,value,timelineEpoch:state.timelineEpoch??baseline.timelineEpoch,projection:params.projection??'full'};
  return state;
}
function restoreSections(host,state,params,baseline) {
  if(state.campaign?.id&&state.campaign.id!==params.campaignId)throw fail('Read belongs to another campaign.',400);
  if(params.timelineEpoch&&state.timelineEpoch&&params.timelineEpoch!==state.timelineEpoch)throw fail('Narrator timeline changed.',409,'timeline_changed');
  if(!state.sectionVersions)return state;
  const scope=`${params.campaignId}:${state.timelineEpoch}`;
  const values=baseline?.scope===scope?{...baseline.values}:{},versions=baseline?.scope===scope?{...baseline.versions}:{};
  if(Object.keys(state.sectionVersions).some(key=>!cachedSections.includes(key)))throw fail('Unknown narrator section.',400);
  for(const key of cachedSections){
    if(!Object.hasOwn(state.sectionVersions,key))continue;
    if(!/^[a-f0-9]{64}$/.test(state.sectionVersions[key]??''))throw fail('Invalid section version.',400);
    if(state.omittedSections?.includes(key)){
      if(baseline?.scope!==scope||baseline.versions[key]!==state.sectionVersions[key]||params.knownSections?.[key]!==state.sectionVersions[key])throw fail('Missing delta baseline.',409);
      state[key]=structuredClone(baseline.values[key]);
    }
    if(!Array.isArray(state[key]))throw fail('Invalid narrator section.',400);
    values[key]=structuredClone(state[key]);
    versions[key]=state.sectionVersions[key];
  }
  host.sectionCache={scope,versions,values};
  return state;
}
export function assembleReadPages(pages) {
  if(!Array.isArray(pages)||!pages.length||!pages.at(-1)?.complete)throw fail('Incomplete narrator read pages.');
  const first=pages[0];
  if(!first?.shape||typeof first.shape!=='object'||Array.isArray(first.shape))throw fail('Invalid narrator page shape.',400);
  const state={};
  for(const [key,kind] of Object.entries(first.shape)){
    if(['__proto__','constructor','prototype'].includes(key)||!['array','value'].includes(kind))throw fail('Invalid narrator page shape.',400);
    state[key]=kind==='array'?[]:undefined;
  }
  let offset=0,bytes=0;const scalarKeys=new Set();
  for(const [index,page] of pages.entries()){
    bytes+=Buffer.byteLength(JSON.stringify(page));if(bytes>4*1024*1024)throw fail('Narrator read exceeds the host memory budget.',413);
    if(page.hash!==first.hash||page.offset!==offset||JSON.stringify(page.shape)!==JSON.stringify(first.shape)||page.complete!==(index===pages.length-1))throw fail('Inconsistent narrator read pages.');
    if(!Array.isArray(page.entries))throw fail('Invalid narrator page entries.',400);
    for(const item of page.entries){
      if(!item||!Object.hasOwn(first.shape,item.key)||['__proto__','constructor','prototype'].includes(item.key))throw fail('Invalid narrator page entry.',400);
      if(first.shape[item.key]==='array'){
        if(item.index!==state[item.key].length)throw fail('Narrator read page array gap.');state[item.key].push(item.value);
      }else{
        if(Object.hasOwn(item,'index')||scalarKeys.has(item.key))throw fail('Duplicate or indexed narrator scalar.',400);
        scalarKeys.add(item.key);state[item.key]=item.value;
      }
    }
    offset+=page.entries.length;
  }
  if(Object.entries(first.shape).some(([key,kind])=>kind==='value'&&!scalarKeys.has(key)))throw fail('Missing narrator scalar.');
  if(crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex')!==first.hash)throw fail('Narrator page integrity check failed.');
  return state;
}
export async function readNarratorSnapshot(host,params,{firstPage,exactParams=false}={}) {
  const baseline=host.sectionCache,stateBaseline=host.stateCache;
  if(!exactParams&&host.deltaReads&&params.delta!==false){
    const projection=params.projection??'full';
    const reusable=stateBaseline&&stateBaseline.projection===projection&&stateBaseline.timelineEpoch===host.timelineEpoch;
    params={...params,delta:true,stateDelta:true,...(reusable?{knownStateRevision:stateBaseline.revision}:baseline?{knownSections:{...baseline.versions}}:{})};
  }
  for(let attempt=0;attempt<=host.readPageRetries;attempt++){
    const pages=[],cursors=new Set();let pageCursor,bytes=0;
    try{
      for(let count=0;count<2048;count++){
        const result=attempt===0&&count===0&&firstPage!==undefined?structuredClone(firstPage):await host.callControl('narrator.read',{...params,paged:true,maxBytes:params.maxBytes??host.readMaxBytes,...(pageCursor?{pageCursor}:{})});
        if(!result?.format){
          if(pages.length)throw fail('A paged read changed format.');
          if(!result||typeof result!=='object'||Array.isArray(result))throw fail('Invalid narrator read response.',400);
          if(Buffer.byteLength(JSON.stringify(result))>4*1024*1024)throw fail('Narrator read exceeds the host memory budget.',413);
          return normalizeEncounterSnapshot(restoreSections(host,restoreStateDelta(host,result,params,stateBaseline),params,baseline));
        }
        if(result.format!=='odm.read.page.v1')throw fail('Unsupported narrator read format.',400);
        bytes+=Buffer.byteLength(JSON.stringify(result));if(bytes>4*1024*1024)throw fail('Narrator read exceeds the host memory budget.',413);
        pages.push(result);if(result.complete)return normalizeEncounterSnapshot(restoreSections(host,restoreStateDelta(host,assembleReadPages(pages),params,stateBaseline),params,baseline));
        if(typeof result.nextPage!=='string'||!result.nextPage||cursors.has(result.nextPage))throw fail('Narrator byte-page cursor did not advance.',400);
        cursors.add(result.nextPage);pageCursor=result.nextPage;
      }
      throw fail('Narrator byte-page safety limit exceeded.',413);
    }catch(error){if(error?.status===409&&!changed(error)&&attempt<host.readPageRetries)continue;throw error;}
  }
  throw fail('Narrator read retry budget exhausted.');
}
export function resetNarratorTimeline(host,epoch) {
  host.lastSeq=0;host.lastAskSeq=0;host.timelineEpoch=epoch;host.answeredAsks.clear();host.pendingAskCommands.clear();
  host.pendingAskAttempts?.clear();host.askBlocked=false;
  host.sectionCache=null;host.stateCache=null;host.storyController?.reset?.(epoch);
  host.pendingStoryCommands?.clear();host.memory.reset(epoch);host.saveCheckpoint();
}
export async function connectNarrator(host) {
  if(!host.campaignId)throw new Error('Cannot connect narrator withoutCampaignId.');
  const result=await host.callControl('narrator.connect',{campaignId:host.campaignId,maxBytes:host.readMaxBytes,projection:'live',stateDelta:true});
  // Contract v4 returns cursor metadata without echoing a full state snapshot.
  // Legacy servers are still accepted through one bounded metadata read.
  let metadata=result?.cursor;
  if(!metadata||!seq(metadata.currentSeq))metadata=await host.readSnapshot({campaignId:host.campaignId,afterSeq:0,limit:1,projection:'live',includeAsks:false});
  if(!metadata||!seq(metadata.currentSeq))throw fail('Narrator metadata has no valid current sequence.',400);
  const epoch=epochOf(metadata);
  if(host.timelineEpoch!==null&&epoch!==null&&host.timelineEpoch!==epoch||host.lastSeq>metadata.currentSeq)resetNarratorTimeline(host,epoch);
  else host.timelineEpoch=epoch??host.timelineEpoch;
  await host.drainStory({ full: true });return result;
}
function isVerifiedUnchangedStateDelta(result, cursor, epoch) {
  const delta=result?.stateDelta, patch=delta?.patch;
  return result?.hasMore===false &&
    result?.nextCursor===cursor &&
    (result?.timelineEpoch??epoch)===epoch &&
    Array.isArray(result?.events) && result.events.length===0 &&
    Array.isArray(result?.messages) && result.messages.length===0 &&
    delta?.full===false && delta?.resyncRequired===false &&
    typeof delta?.revision==='string' && delta.revision===delta.baseRevision &&
    patch && typeof patch==='object' && !Array.isArray(patch) &&
    Object.keys(patch).length===1 && typeof patch.format==='string';
}

export async function drainNarratorStory(host, { full = false, firstSnapshot } = {}) {
  for(let page=0;page<1000;page++){
    const cursor=host.lastSeq;
    const result=page===0&&firstSnapshot?firstSnapshot:await host.readSnapshot({campaignId:host.campaignId,afterSeq:cursor,limit:50,projection:full?'full':'live',includeAsks:false,...(host.timelineEpoch?{timelineEpoch:host.timelineEpoch}:{})});
    if(!result||!seq(result.currentSeq))throw fail('Narrator snapshot has no valid current sequence.',400);
    if(result.cursor!==undefined&&result.cursor!==cursor)throw fail('Read does not start at the acknowledged cursor.',409);
    if(result.campaign?.id&&result.campaign.id!==host.campaignId)throw fail('Read belongs to another campaign.',400);
    const epoch=epochOf(result);
    if(host.timelineEpoch!==null&&epoch!==null&&host.timelineEpoch!==epoch)throw fail('Narrator timeline changed.',409,'timeline_changed');
    if(result.currentSeq<cursor)throw fail('Narrator cursor is ahead of campaign state.',409,'NARRATOR_CURSOR_AHEAD');
    const next=result.nextCursor??(result.hasMore?null:result.currentSeq);
    if(!seq(next)||next<cursor||next>result.currentSeq||result.hasMore&&next<=cursor||!result.hasMore&&next!==result.currentSeq)throw fail('Story cursor did not advance safely.',400);
    if((result.messages||[]).some(message=>!seq(message.seq)||message.seq<=cursor||message.seq>next))throw fail('Story message lies outside its acknowledged range.',400);
    // A cryptographically verified empty delta means both story cursor and
    // patchable live state are identical to the host baseline. Do not
    // re-ingest the same objects or fsync an identical checkpoint on every
    // idle poll.
    if(!full && isVerifiedUnchangedStateDelta(result,cursor,host.timelineEpoch)) return result;
    const before=host.memory.serializeState(),previousEpoch=host.timelineEpoch,controller=host.storyController?.serialize?.();
    try{
      host.memory.ingestReadSnapshot(result);host.storyController?.ingestReadSnapshot?.(result);
      host.timelineEpoch=epoch??host.timelineEpoch;host.lastSeq=next;host.saveCheckpoint();
    }catch(error){host.memory.restoreState(before);if(controller)host.storyController.restore(controller);host.timelineEpoch=previousEpoch;host.lastSeq=cursor;throw error;}
    // Every completed byte/story page is durable. A later failure retries the
    // first unacknowledged page and never leaves memory ahead of its checkpoint.
    if(!result.hasMore)return result;
  }
  throw fail('Story stream exceeded the page safety limit.',413);
}

/** Read options are transport metadata, never authorization or a new command.
 * Do not send hashes unless this host retains their values in this timeline.
 */
export function postWriteReadOptions(host) {
  const cache=host.sectionCache,state=host.stateCache;
  const reusable=state&&state.projection==='live'&&state.timelineEpoch===host.timelineEpoch;
  return {afterSeq:host.lastSeq,projection:'live',delta:true,stateDelta:true,includeAsks:false,paged:true,maxBytes:host.readMaxBytes??65536,
    ...(reusable?{knownStateRevision:state.revision}:cache?.scope===`${host.campaignId}:${host.timelineEpoch}`?{knownSections:{...cache.versions}}:{})};
}
/** Consume the receipt's read without requesting the first page again. A
 * committed command stays committed on any read/merge/checkpoint failure.
 * Never install a partial delta baseline or acknowledge unverified events.
 */
export async function consumePostWriteRead(host,receipt) {
  const timing=latencyEnabled(),started=timing?performance.now():0;
  try {
  if(!receipt?.state||receipt.readRequired||!receipt.readAfter)return await host.drainStory();
  const params=receipt.readAfter, baseline=host.sectionCache,stateBaseline=host.stateCache;
  if(params.campaignId!==host.campaignId||params.afterSeq!==host.lastSeq||
     params.timelineEpoch&&params.timelineEpoch!==host.timelineEpoch)return await host.drainStory();
  const reader={sectionCache:baseline,stateCache:stateBaseline,deltaReads:false,readPageRetries:host.readPageRetries??2,
    readMaxBytes:host.readMaxBytes??65536,callControl:host.callControl.bind(host)};
  try{
    const state=await readNarratorSnapshot(reader,params,{firstPage:receipt.state,exactParams:true});
    if(!seq(receipt.committedSeq)||!seq(state.currentSeq)||state.currentSeq<receipt.committedSeq)throw fail('Read predates the command receipt.',409);
    // Publish the cache only together with a fully validated/drained read.
    // Subsequent event pages may use this baseline, but never partial byte pages.
    host.sectionCache=reader.sectionCache;host.stateCache=reader.stateCache;
    return await drainNarratorStory(host,{firstSnapshot:state});
  }catch(error){host.sectionCache=baseline;host.stateCache=stateBaseline;throw error;}
  } finally { if(timing)emitLatency({stage:'post_write_read',durationMs:performance.now()-started}); }
}
