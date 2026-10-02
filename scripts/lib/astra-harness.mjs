// Execute the merged SQL/event/HTTP source on real in-memory SQLite. Only
// session, campaign metadata, framework validation and embeddings are doubled.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const VERSION_TABLES=`
CREATE TABLE IF NOT EXISTS spatial_object_versions(campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 object_type TEXT NOT NULL,object_id TEXT NOT NULL,version INTEGER NOT NULL,room_id TEXT REFERENCES spatial_rooms(id) ON DELETE CASCADE,
 payload_json TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(campaign_id,object_type,object_id,version));
CREATE TABLE IF NOT EXISTS spatial_object_receipts(campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,object_type TEXT NOT NULL,object_id TEXT NOT NULL,version INTEGER NOT NULL,
 observed_seq INTEGER NOT NULL,PRIMARY KEY(campaign_id,user_id,object_type,object_id));`;
export async function astraHarness(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE campaigns(id TEXT PRIMARY KEY,next_seq INTEGER DEFAULT 100);
 CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE members(campaign_id TEXT,user_id TEXT,role TEXT);
 CREATE TABLE character_sheets(id TEXT,campaign_id TEXT,user_id TEXT);
 CREATE TABLE spatial_campaigns(campaign_id TEXT PRIMARY KEY,start_seq INTEGER);
 CREATE TABLE spatial_rooms(id TEXT PRIMARY KEY,campaign_id TEXT,name TEXT);
 CREATE TABLE spatial_presence(campaign_id TEXT,user_id TEXT,room_id TEXT);
 CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,type TEXT,payload_json TEXT,created_at TEXT,PRIMARY KEY(campaign_id,seq));
 CREATE TABLE campaign_notes(id TEXT PRIMARY KEY,campaign_id TEXT,character_id TEXT,author_user_id TEXT,author_kind TEXT,
 visibility TEXT,status TEXT,pinned INTEGER,title TEXT,body TEXT,seq INTEGER,created_at TEXT,updated_at TEXT,embedding BLOB);
 INSERT INTO campaigns(id)VALUES('c'),('other');INSERT INTO users VALUES('a'),('b'),('d'),('dm');
 INSERT INTO members VALUES('c','a','player'),('c','b','player'),('c','d','player'),('c','dm','dm'),('other','d','player');
 INSERT INTO character_sheets VALUES('sheet-a','c','a'),('sheet-b','c','b');
 INSERT INTO spatial_campaigns VALUES('c',10),('other',10);
 INSERT INTO spatial_rooms VALUES('tavern','c','Tavern'),('street','c','Street'),('foreign','other','Foreign');
 INSERT INTO spatial_presence VALUES('c','a','tavern'),('c','b','tavern'),('c','d','street');${VERSION_TABLES}`);
 let tx=0,identity='a',muted=false;
 db.transaction=fn=>(...args)=>{const name=`tx${++tx}`;db.exec(`SAVEPOINT ${name}`);try{const value=fn(...args);db.exec(`RELEASE ${name}`);return value;}catch(error){db.exec(`ROLLBACK TO ${name};RELEASE ${name}`);throw error;}};
 const campaigns={
  getCampaignById:id=>{const row=db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);return row?{...row,dmUserId:'dm'}:null;},
  listMembers:id=>db.prepare('SELECT user_id AS userId,role FROM members WHERE campaign_id=?').all(id),
  capsFor:(campaign,userId)=>({role:db.prepare('SELECT role FROM members WHERE campaign_id=? AND user_id=?').get(campaign.id,userId)?.role}),
  allocateSeq:id=>db.prepare('UPDATE campaigns SET next_seq=next_seq+1 WHERE id=? RETURNING next_seq-1 AS seq').get(id).seq,
  latestSeq:id=>db.prepare('SELECT next_seq-1 AS seq FROM campaigns WHERE id=?').get(id).seq,
  touchCampaign:()=>{},
 };
 campaigns.getCampaignForUser=(id,userId)=>campaigns.listMembers(id).some(m=>m.userId===userId)?campaigns.getCampaignById(id):null;
 const contextFor=id=>{const campaign=campaigns.getCampaignForUser(id,identity);return campaign?{user:{id:identity},campaign}:Response.json({error:'Not found'},{status:404});};
 class SpatialError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const service={SpatialError,
  spatialEnabled:id=>Boolean(db.prepare('SELECT 1 FROM spatial_campaigns WHERE campaign_id=?').get(id)),
  spatialContext:(id,userId)=>{const campaign=campaigns.getCampaignForUser(id,userId);if(!campaign)throw new SpatialError('Campaign not found.',404);
   const members=campaigns.listMembers(id);return{campaign,actor:{campaignId:id,userId,isDm:campaigns.capsFor(campaign,userId).role==='dm',memberIds:members.map(m=>m.userId),playerIds:members.filter(m=>m.role!=='dm').map(m=>m.userId)}};},
  spatialStore:()=>({view:actor=>({enabled:true,isDm:actor.isDm,current:db.prepare('SELECT room_id AS roomId FROM spatial_presence WHERE campaign_id=? AND user_id=?').get(actor.campaignId,actor.userId),rooms:db.prepare('SELECT id FROM spatial_rooms WHERE campaign_id=?').all(actor.campaignId)}),messages:()=>({messages:[]})}),
  runSpatialCommand:()=>({ok:true}),
 };
 const schema=new Proxy({}, {get:(_target,name)=>name==='safeParse'?data=>({success:data!==null&&data!==undefined,data:{title:'',...data}}):()=>schema});
 const sheets={getSheetById:id=>{const row=db.prepare('SELECT * FROM character_sheets WHERE id=?').get(id);return row?{id:row.id,userId:row.user_id,campaignId:row.campaign_id}:null;},listSheets:id=>db.prepare('SELECT id,user_id AS userId,campaign_id AS campaignId FROM character_sheets WHERE campaign_id=?').all(id),getSheetForUser:(campaignId,userId)=>{const row=db.prepare('SELECT * FROM character_sheets WHERE campaign_id=? AND user_id=?').get(campaignId,userId);return row?{id:row.id,userId:row.user_id,campaignId:row.campaign_id}:null;}};
 const embeddingCalls=[];
 const values={
  'node:crypto':{...crypto,default:crypto},'node:async_hooks':{AsyncLocalStorage},
  '@/lib/db/core':{getDatabase:()=>db,nowIso:()=>new Date().toISOString(),parseJson:(raw,fallback)=>{try{return JSON.parse(raw);}catch{return fallback;}}},
  '@/lib/db/campaigns':campaigns,'@/lib/db/sheets':sheets,'@/lib/spatial/service':service,
  '@/lib/campaign-api':{isErrorResponse:value=>value instanceof Response,requireMember:async id=>contextFor(id),
   requireVoice:async id=>muted?Response.json({error:'Muted'},{status:403}):contextFor(id),
   capsFor:context=>campaigns.capsFor(context.campaign,context.user.id),steersStory:context=>campaigns.capsFor(context.campaign,context.user.id).role==='dm'},
  '@/lib/embeddings':{embed:async input=>{embeddingCalls.push(input);return [];},vectorToBuffer:()=>null},
  '@/lib/ingress-budget':{enforcePlayerIngress:()=>null},zod:{z:schema},'@/lib/dm/encounter-tools':{syncFightRosters:()=>[]},
 };
 const aliases={notesRoute:'src/app/api/campaigns/[campaignId]/notes/route.ts',detailRoute:'src/app/api/campaigns/[campaignId]/notes/[noteId]/route.ts',eventRoute:'src/app/api/campaigns/[campaignId]/events/route.ts',locationRoute:'src/app/api/campaigns/[campaignId]/location-chat/route.ts'};
 const context=vm.createContext({console,Buffer,URL,Request,Response,TextEncoder,TextDecoder,ReadableStream,AbortController,AbortSignal,structuredClone,crypto:crypto.webcrypto,performance,setTimeout,clearTimeout,setInterval,clearInterval});
 const cache=new Map();
 function load(specifier,from=root+'/entry.mjs'){
  let key=specifier;
  if(!values[key]){
   const relative=aliases[key]??(key.startsWith('@/')?'src/'+key.slice(2):null);
   key=relative?path.join(root,relative):path.resolve(path.dirname(from),key);
   if(!existsSync(key)){const candidate=['.ts','.mjs','.tsx'].map(ext=>key+ext).find(existsSync);assert.ok(candidate,`Missing ${key}`);key=candidate;}
  }
  if(cache.has(key))return cache.get(key);
  let vmModule;
  if(values[key])vmModule=new vm.SyntheticModule(Object.keys(values[key]),function(){for(const [k,v]of Object.entries(values[key]))this.setExport(k,v);},{context,identifier:key});
  else{
   const source=readFileSync(key,'utf8');vmModule=new vm.SourceTextModule(key.endsWith('.ts')?stripTypeScriptTypes(source):source,{context,identifier:key});
  }
  cache.set(key,vmModule);return vmModule;
 }
 const entry=new vm.SourceTextModule("import * as notes from '@/lib/db/notes';import * as events from '@/lib/events';import * as policy from '@/lib/spatial/event-policy';import * as domain from '@/lib/spatial/domain';import * as effects from '@/lib/db/commit-effects';import * as listRoute from 'notesRoute';import * as detailRoute from 'detailRoute';import * as route from 'eventRoute';import * as locationRoute from 'locationRoute';export {notes,events,policy,domain,effects,listRoute,detailRoute,route,locationRoute};",{context,identifier:root+'/entry.mjs'});
 await entry.link((specifier,parent)=>load(specifier,parent.identifier));await entry.evaluate();
 const modules=entry.namespace;
 return{db,...modules,campaigns,embeddingCalls,
  create:(options={})=>modules.notes.insertNote({campaignId:'c',characterId:null,authorUserId:'dm',visibility:'public',status:'active',title:'Note',body:'V1',seq:campaigns.allocateSeq('c'),audience:{roomId:'tavern'},...options}),
  actor:id=>modules.policy.eventActorFor('c',id,true),
  move:(id,roomId)=>db.prepare('UPDATE spatial_presence SET room_id=? WHERE campaign_id=? AND user_id=?').run(roomId,'c',id),
  login:id=>{identity=id;},mute:()=>{muted=true;},
  detail:id=>({params:Promise.resolve({campaignId:'c',noteId:id})}),
 };
}
