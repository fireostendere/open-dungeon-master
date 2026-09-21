import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabase } from '@/lib/db/core';
import { capsFor, getCampaignById, listMembers } from '@/lib/db/campaigns';
import { projectSheetForViewer } from '@/lib/sheet-privacy';
import { currentPublicationScope } from './publication-scope.mjs';
import { projectEventForUser } from './event-privacy';
import { createEventAccess, decodeEventChunk, ephemeralView, publicationView, type EventActor, type EventScope, type EventView } from './event-access.mjs';
const scopes=new AsyncLocalStorage<{campaignId:string;scope:EventScope}>();
export function withEventScope<T>(campaignId:string,scope:EventScope,work:()=>T):T {return scopes.run({campaignId,scope},work);}
export function currentEventScope(campaignId:string):EventScope|undefined {
  const value=scopes.getStore();return value?.campaignId===campaignId?value.scope:undefined;
}
const hasTable=(name:string)=>Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
export function eventSpatialState(campaignId:string) {
  if(!hasTable('spatial_campaigns')) return {enabled:false,startSeq:0};
  const row=getDatabase().prepare('SELECT start_seq FROM spatial_campaigns WHERE campaign_id=?').get(campaignId) as {start_seq:number}|undefined;
  return {enabled:Boolean(row),startSeq:row?.start_seq??0};
}
export function eventActorFor(campaignId:string,userId:string,enabled:boolean):EventActor {
  const campaign=getCampaignById(campaignId);
  const member=Boolean(campaign&&listMembers(campaignId).some(item=>item.userId===userId));
  const sheets=member?getDatabase().prepare('SELECT id FROM character_sheets WHERE campaign_id=? AND user_id=?').all(campaignId,userId) as {id:string}[]:[];
  const presence=enabled&&member?getDatabase().prepare('SELECT room_id FROM spatial_presence WHERE campaign_id=? AND user_id=?').get(campaignId,userId) as {room_id:string}|undefined:undefined;
  return {userId,member,isDm:member&&Boolean(campaign&&capsFor(campaign,userId).role==='dm'),ownedCharacterIds:sheets.map(sheet=>sheet.id),roomId:presence?.room_id??null};
}
function inScope(actor:EventActor,scope?:EventScope):boolean {
  return !scope || scope.kind==='global' || scope.kind==='dm'&&actor.isDm || scope.kind==='room'&&scope.roomId===actor.roomId || scope.kind==='users'&&scope.userIds.includes(actor.userId);
}
export function captureEventAudience(campaignId:string,event:EventView,explicit?:EventScope):void {
  const state=eventSpatialState(campaignId);
  let scope=explicit??currentEventScope(campaignId)??currentPublicationScope(campaignId);
  if(!state.enabled&&!scope) return;
  const actors=listMembers(campaignId).map(member=>eventActorFor(campaignId,member.userId,state.enabled));
  const payload=event.payload as {note?:{id?:string};noteId?:string}|null;
  const noteId=event.type.startsWith('note_')?payload?.note?.id??payload?.noteId:undefined;
  if(noteId&&hasTable('spatial_object_versions')) {
    const row=getDatabase().prepare("SELECT payload_json FROM spatial_object_versions WHERE campaign_id=? AND object_type='domain:note' AND object_id=? ORDER BY version DESC LIMIT 1")
      .get(campaignId,noteId) as {payload_json:string}|undefined;
    if(row) {
      const note=JSON.parse(row.payload_json) as {format:string;scope:EventScope;ownerUserId?:string|null;allowedUserIds?:string[]|null;dmVisible?:boolean;data?:{visibility?:string;status?:string;authorUserId?:string}};
      if(note.format!=='odm.domain.v1') throw new Error('Invalid canonical note audience.');
      const restriction=scope;
      const recipients=actors.filter(actor=>{
        if(!inScope(actor,restriction)) return false;
        if(actor.isDm) return note.dmVisible!==false;
        // Active shared notes never grant remote subscriptions to their author.
        if(note.ownerUserId===actor.userId && (note.data?.visibility==='private'||note.data?.status==='pending')) return true;
        if(note.allowedUserIds!==null&&note.allowedUserIds!==undefined&&!note.allowedUserIds.includes(actor.userId)) return false;
        return inScope(actor,note.scope);
      }).map(actor=>actor.userId);
      scope={kind:'users',userIds:recipients};
    }
  }
  createEventAccess(getDatabase()).capture(campaignId,event,actors,scope);
}
export function campaignEventProjector(campaignId:string,userId:string) {
  const fresh=()=>{const state=eventSpatialState(campaignId);return {state,actor:eventActorFor(campaignId,userId,state.enabled)};};
  const privateSheetFields = (event:EventView, isDm:boolean):EventView => {
    if (event.type !== 'sheet_updated') return event;
    const payload = event.payload as {sheet?:unknown} | null;
    const sheet = payload?.sheet;
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return event;
    return {
      ...event,
      payload: {
        ...(payload as Record<string, unknown>),
        sheet: projectSheetForViewer(sheet as never, userId, { adjudicates: isDm }),
      },
    };
  };
  function projectEvent(event:EventView):EventView {
    const {state,actor}=fresh();
    if(!actor.member) throw new Error('Campaign stream access revoked.');
    const checkpoint={seq:event.seq,type:'stream_checkpoint',payload:{}};
    // SELECT * also accepts historical schemas without audience_json.
    const saved=getDatabase().prepare('SELECT * FROM campaign_events WHERE campaign_id=? AND seq=?').get(campaignId,event.seq) as
      {type:string;payload_json:string;audience_json?:string|null}|undefined;
    if(!saved||saved.type!==event.type||saved.payload_json!==JSON.stringify(event.payload)) return checkpoint;
    if(actor.isDm) return privateSheetFields(event, true);
    if(hasTable('spatial_event_views')) {
      const present=getDatabase().prepare('SELECT 1 FROM spatial_event_views WHERE campaign_id=? AND seq=? AND user_id=?').get(campaignId,event.seq,userId);
      if(present) return privateSheetFields(
        createEventAccess(getDatabase()).project(campaignId,event,actor,{enabled:true,startSeq:0}),
        false,
      );
    }
    // Existing playwright-branch receipts are kept, never reconstructed from
    // today's occupants. New events also retain this compact compatibility form.
    if(saved.audience_json) {
      let audience:{version?:number;userIds?:unknown};try{audience=JSON.parse(saved.audience_json);}catch{return checkpoint;}
      if(audience.version!==1||!Array.isArray(audience.userIds)||!audience.userIds.includes(userId)) return checkpoint;
      // Keep the old metadata/presence redactions as well as the saved audience.
      const legacy=projectEventForUser(campaignId,userId,{...event,audience:{version:1,userIds:audience.userIds as string[]}});
      if(!legacy || legacy.type==='stream_checkpoint') return checkpoint;
      const payload=publicationView(event.type,legacy.payload,actor,{kind:'users',userIds:[userId]});
      return payload===null?checkpoint:privateSheetFields({...event,payload}, false);
    }
    if(!state.enabled) return privateSheetFields(event, false);
    return privateSheetFields(createEventAccess(getDatabase()).project(campaignId,event,actor,state), false);
  }
  return {
    assertAccess(){if(!fresh().actor.member)throw new Error('Campaign stream access revoked.');},
    projectEvent,
    projectLive(chunk:string):string|null {
      const {state,actor}=fresh();if(!actor.member)throw new Error('Campaign stream access revoked.');
      const event=decodeEventChunk(chunk);if(!event)return chunk;
      let result:{seq?:number;type:string;payload:unknown}|null;
      if(event.seq!==undefined) result=event.type==='campaign_rewound'?{seq:event.seq,type:event.type,payload:{reason:'campaign_rewound'}}:projectEvent(event as EventView);
      else result=ephemeralView(event.type,event.payload,actor,state.enabled);
      return result?`${result.seq===undefined?'':`id: ${result.seq}\n`}event: ${result.type}\ndata: ${JSON.stringify(result.payload)}\n\n`:null;
    },
  };
}
