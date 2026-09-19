import { randomUUID } from 'node:crypto';
import { afterCommit, withCommittedEffects } from '@/lib/db/commit-effects';
import { getDatabase, nowIso, parseJson } from '@/lib/db/core';
import { allocateSeq } from '@/lib/db/campaigns';
import { captureEventAudience, campaignEventProjector, eventSpatialState } from '@/lib/spatial/event-policy';
import { captureEventAudience as ephemeralAudience, ensureEventAudienceColumn, projectEventForUser, type EventScope, type PrivateEvent } from '@/lib/spatial/event-privacy';
type Subscriber=(chunk:string)=>void;
declare global {
  var __odmEventBus:Map<string,Set<Subscriber>>|undefined;
  var __odmEventSubscriberUsers:Map<string,WeakMap<Subscriber,string>>|undefined;
  var __odmRawEventSubscribers:WeakSet<Subscriber>|undefined;
  var __odmPresenceCounts:Map<string,Map<string,number>>|undefined;
  var __odmVoiceEventHook:((campaignId:string,type:string)=>void)|undefined;
}
const bus=()=>globalThis.__odmEventBus??=new Map<string,Set<Subscriber>>();
const rawSubscribers=()=>globalThis.__odmRawEventSubscribers??=new WeakSet<Subscriber>();
function subscriberUsers(campaignId:string) {
  const campaigns=globalThis.__odmEventSubscriberUsers??=new Map<string,WeakMap<Subscriber,string>>();
  let users=campaigns.get(campaignId);if(!users){users=new WeakMap();campaigns.set(campaignId,users);}return users;
}
const presenceCounts=()=>globalThis.__odmPresenceCounts??=new Map<string,Map<string,number>>();
export function onlineUserIds(campaignId:string):string[]{return Array.from(presenceCounts().get(campaignId)?.keys()??[]);}
export function sseChunk(type:string,payload:unknown,id?:number){return `${id===undefined?'':`id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;}
function freezeEvent(campaignId:string,type:string,payload:unknown,scope?:EventScope):PrivateEvent {
  const frozen=JSON.parse(JSON.stringify(payload??null)) as unknown;
  return {type,payload:frozen,audience:ephemeralAudience(campaignId,type,frozen,scope)};
}
function fanOut(campaignId:string,event:PrivateEvent,onlyUserId?:string) {
  const subscribers=bus().get(campaignId);if(!subscribers)return;
  for(const subscriber of subscribers) {
    const userId=subscriberUsers(campaignId).get(subscriber);
    if(onlyUserId&&userId!==onlyUserId)continue;
    try {
      if(rawSubscribers().has(subscriber)&&event.seq!==undefined) {
        subscriber(sseChunk(event.type,event.payload,event.seq));continue;
      }
      if(event.seq!==undefined) {
        if(!userId) {if(!eventSpatialState(campaignId).enabled&&!event.audience)subscriber(sseChunk(event.type,event.payload,event.seq));continue;}
        const projected=campaignEventProjector(campaignId,userId).projectEvent({seq:event.seq,type:event.type,payload:event.payload});
        subscriber(sseChunk(projected.type,projected.payload,projected.seq));continue;
      }
      // Ephemeral recipients are captured before deferral. The HTTP stream
      // additionally rechecks the user's current role before dequeuing them.
      const visible=userId?projectEventForUser(campaignId,userId,event):event.audience?null:event;
      if(!visible)continue;
      const chunk=sseChunk(visible.type,visible.payload);
      const projected=userId?campaignEventProjector(campaignId,userId).projectLive(chunk):chunk;
      if(projected!==null)subscriber(projected);
    } catch {subscribers.delete(subscriber);}
  }
}
function announcePresence(campaignId:string){fanOut(campaignId,freezeEvent(campaignId,'presence',{online:onlineUserIds(campaignId)}));}
function subscribeInternal(campaignId:string,subscriber:Subscriber,userId?:string,raw=false):()=>void {
  let subscribers=bus().get(campaignId);if(!subscribers){subscribers=new Set();bus().set(campaignId,subscribers);}subscribers.add(subscriber);
  if(raw)rawSubscribers().add(subscriber);else rawSubscribers().delete(subscriber);
  if(userId){
    subscriberUsers(campaignId).set(subscriber,userId);
    let counts=presenceCounts().get(campaignId);if(!counts){counts=new Map();presenceCounts().set(campaignId,counts);}
    const next=(counts.get(userId)??0)+1;counts.set(userId,next);if(next===1)announcePresence(campaignId);
  }else subscriberUsers(campaignId).delete(subscriber);
  let released=false;
  return ()=>{
    if(released)return;released=true;subscribers.delete(subscriber);subscriberUsers(campaignId).delete(subscriber);rawSubscribers().delete(subscriber);
    if(!subscribers.size){bus().delete(campaignId);globalThis.__odmEventSubscriberUsers?.delete(campaignId);}
    if(userId){const counts=presenceCounts().get(campaignId);if(counts){const left=(counts.get(userId)??0)-1;
      if(left<=0)counts.delete(userId);else counts.set(userId,left);if(!counts.size)presenceCounts().delete(campaignId);if(left<=0)announcePresence(campaignId);}}
  };
}
export function subscribe(campaignId:string,subscriber:Subscriber,userId?:string):()=>void{return subscribeInternal(campaignId,subscriber,userId);}
/** Trusted process-only feed. HTTP callers MUST install campaignEventProjector
 * at dequeue; raw frames must never be attached directly to a public response.
 */
export function subscribeRaw(campaignId:string,subscriber:Subscriber,userId?:string):()=>void{return subscribeInternal(campaignId,subscriber,userId,true);}
export function publishWithSeq(campaignId:string,seq:number,type:string,payload:unknown,scope?:EventScope) {
  return withCommittedEffects(()=>getDatabase().transaction(()=>{
    ensureEventAudienceColumn();
    const body=type==='campaign_rewound'?{...(payload&&typeof payload==='object'?payload:{}),timelineEpoch:randomUUID()}:payload;
    const frozen=JSON.parse(JSON.stringify(body??null)) as unknown;
    captureEventAudience(campaignId,{seq,type,payload:frozen},scope);
    const db=getDatabase();
    const hasViews=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spatial_event_views'").get();
    const recipients=hasViews?db.prepare('SELECT user_id FROM spatial_event_views WHERE campaign_id=? AND seq=?').all(campaignId,seq) as {user_id:string}[]:[];
    const audience=eventSpatialState(campaignId).enabled||scope||recipients.length?{version:1 as const,userIds:recipients.map(row=>row.user_id).sort()}:null;
    db.prepare('INSERT INTO campaign_events(campaign_id,seq,type,payload_json,created_at,audience_json) VALUES(?,?,?,?,?,?)')
      .run(campaignId,seq,type,JSON.stringify(frozen),nowIso(),audience?JSON.stringify(audience):null);
    const event:PrivateEvent={seq,type,payload:frozen,audience};
    afterCommit(()=>{fanOut(campaignId,event);globalThis.__odmVoiceEventHook?.(campaignId,type);});return seq;
  })());
}
export function publishPersisted(campaignId:string,type:string,payload:unknown,scope?:EventScope) {
  return withCommittedEffects(()=>getDatabase().transaction(()=>publishWithSeq(campaignId,allocateSeq(campaignId),type,payload,scope))());
}
export function publishEphemeral(campaignId:string,type:string,payload:unknown,scope?:EventScope) {
  const event=freezeEvent(campaignId,type,payload,scope);afterCommit(()=>{fanOut(campaignId,event);globalThis.__odmVoiceEventHook?.(campaignId,type);});
}
export function publishUserEphemeral(campaignId:string,userId:string,type:string,payload:unknown) {
  const event=freezeEvent(campaignId,type,payload,{kind:'users',userIds:[userId]});afterCommit(()=>fanOut(campaignId,event,userId));
}
export type StoredEvent={seq:number;type:string;payload:unknown};
export function listEventsSince(campaignId:string,afterSeq:number,limit=500,viewerUserId?:string):StoredEvent[] {
  const rows=getDatabase().prepare('SELECT seq,type,payload_json FROM campaign_events WHERE campaign_id=? AND seq>? ORDER BY seq ASC LIMIT ?')
    .all(campaignId,afterSeq,limit) as {seq:number;type:string;payload_json:string}[];
  const projector=viewerUserId?campaignEventProjector(campaignId,viewerUserId):null;
  return rows.map(row=>{const event={seq:row.seq,type:row.type,payload:parseJson<unknown>(row.payload_json,null)};
    return projector?projector.projectEvent(event):event;});
}
