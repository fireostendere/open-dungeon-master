// Integration of selected real TS/TSX/SQLite modules. UI, model and queue are
// explicit doubles; this is NOT a Next/browser/live-provider acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { loadModule, sqliteAdapter } from './lib/merge-test-module.mjs';
const require = createRequire(import.meta.url);
process.env.DB_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { z } = require('zod');
if (z.__mergeTestAdapter) console.log('SCHEMA DEPENDENCY: local adapter; real Zod/full application validation is NOT verified in this run.');
const root = fileURLToPath(new URL('../', import.meta.url));
const load = (name, mocks) => loadModule(root + name, mocks);
const types = load('src/lib/campaign-types.ts');
const player = load('src/lib/player-message.ts', { '@/lib/campaign-types': types });
const filter = load('src/lib/mcp-event-filter.ts', { '@/lib/campaign-types': types });

for (const [raw,kind,text] of [
  ['"Hello"','do','"Hello"'],[' «Привет» ','do','«Привет»'],['“Cześć”','do','“Cześć”'],
  ['**Opens door**','do','Opens door'],['*Идёт*','do','Идёт'],['Just acts','do','Just acts'],
  ['  (OOC) outside chat','ooc','outside chat'],['(ooc)\n2 + 2','ooc','2 + 2'],
  ['**','do',''],['"unmatched','do','"unmatched'],['«mismatched”','do','«mismatched”'],
  ['(oocish) text','do','(oocish) text'],['"(ooc) quoted speech"','do','"(ooc) quoted speech"'],
]) test(`player projection: ${JSON.stringify(raw)}`,()=>{
  const source={content:raw};const before=structuredClone(source);
  assert.deepEqual(player.parsePlayerMessage(source.content),{kind,text});assert.deepEqual(source,before);
});

test('OOC event projection filters new/edited talk, preserves opaque unrelated events',()=>{
  for(const type of ['message_added','message_updated']) {
    assert.equal(filter.isNarratorEvent({type,payload:{message:{content:' (OoC) private table chatter'}}}),false);
    assert.equal(filter.isNarratorEvent({type,payload:{message:{content:'A real action'}}}),true);
  }
  for(const payload of [null,undefined,[],{message:null},{message:4},{message:{content:12}}])assert.equal(filter.isNarratorEvent({type:'message_added',payload}),true);
  assert.equal(filter.isNarratorEvent({type:'roll_result',payload:{message:{content:'(ooc)'}}}),true);
});

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fixture(t) {
  const db=new DatabaseSync(':memory:');const adapter=sqliteAdapter(db);
  db.exec(`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO campaigns (id) VALUES ('${A}'), ('${B}');
    CREATE TABLE campaign_asks(id TEXT PRIMARY KEY,campaign_id TEXT,user_id TEXT,character_id TEXT,
    visibility TEXT CHECK(visibility IN ('private','table')),scope TEXT CHECK(scope IN ('story','rules','sheet')),
    question TEXT,answer TEXT,citations_json TEXT,status TEXT CHECK(status IN ('answered','failed')),created_at TEXT);
    CREATE TABLE campaign_events(campaign_id TEXT,seq INTEGER,type TEXT,payload_json TEXT,created_at TEXT);
    CREATE TABLE campaign_messages(campaign_id TEXT,seq INTEGER,author_type TEXT,content TEXT);`);
  const core={getDatabase:()=>adapter,nowIso:()=>new Date().toISOString(),parseJson:(raw,fallback)=>{try{return JSON.parse(raw)}catch{return fallback;}}};
  const effects=load('src/lib/db/commit-effects.ts');
  const campaigns=new Map([A,B].map(id=>[id,{id,kind:'campaign',status:'active',dmUserId:'dm',gameSettings:{dmMode:'human',ttsEnabled:false,mapsEnabled:false,language:'ru'},floor:{mode:'open'}}]));
  let seq=0,invoked=0,modelCalls=0,voiceError;
  const campaignApi={getCampaignById:id=>campaigns.get(id),getCampaignForUser:id=>campaigns.get(id),capsFor:(_campaign,userId)=>({role:userId==='dm'?'dm':'player'}),latestSeq:()=>seq,allocateSeq:()=>++seq,
    getCampaignSummaryState:()=>({summary:''}),listMembers:()=>[{userId:'alice'},{userId:'bob'},{userId:'dm'}],setFloor:(id,value)=>{campaigns.get(id).floor=value;}};
  globalThis.__odmEventBus=new Map();globalThis.__odmPresenceCounts=new Map();globalThis.__odmEventSubscriberUsers=new Map();
  const eventPrivacy=load('src/lib/spatial/event-privacy.ts',{'@/lib/db/core':core,'@/lib/db/campaigns':campaignApi});
  const eventPolicy={captureEventAudience(){},eventSpatialState:()=>({enabled:false,startSeq:0}),campaignEventProjector:()=>({projectEvent:event=>event,projectLive:chunk=>chunk})};
  const events=load('src/lib/events.ts',{'@/lib/db/core':core,'@/lib/db/campaigns':campaignApi,'@/lib/db/commit-effects':effects,
    '@/lib/spatial/event-policy':eventPolicy,'@/lib/spatial/event-privacy':eventPrivacy,
    '@/lib/integrations/rakobot':{queueLegacyPlayerEvent(){},queuePlayerAction(){}},
    '@/lib/voice/location-access':{voiceAccess:()=>({scope:'global',members:new Set(['alice','bob','dm']),rooms:new Map()}),getVoiceScope:()=>'global',setVoiceScope(){}},
    '@/lib/voice/location-policy':{mayShareVoice:()=>true,projectVoiceRoster:(_a,_u,p)=>p}});
  const asks=load('src/lib/db/asks.ts',{'@/lib/db/core':core});
  const savedMessages=id=>db.prepare('SELECT seq,author_type AS authorType,content FROM campaign_messages WHERE campaign_id=? ORDER BY seq').all(id);
  const narrator=load('src/lib/mcp-narrator-control.ts',{
    zod:{z},'@/lib/campaign-types':types,'@/lib/mcp-event-filter':filter,
    '@/lib/spatial/narrator':{SPATIAL_NARRATOR_CATALOG:[],SPATIAL_NARRATOR_OPERATIONS:{},readSpatialForNarrator:()=>null},
    '@/lib/spatial/narrator-page.mjs':{spatialNarratorBoundary:({currentSeq,limit,events:page})=>({nextCursor:page.length>limit?page[limit-1].seq:currentSeq,hasMore:page.length>limit,events:page.slice(0,limit),roomMessages:[]})},
    '@/lib/spatial/service':{spatialEnabled:()=>false,SpatialError:class SpatialError extends Error{}},
    '@/lib/spatial/battle-map':{},'@/lib/spatial/timeline':{campaignTimelineEpoch:()=> 'test-epoch'},
    '@/lib/db/core':core,'@/lib/db/narrator-lease':{touchNarratorLease(){},NarratorLeaseConflict:class NarratorLeaseConflict extends Error{}},
    '@/lib/spatial/narrator-concurrency.mjs':{},'@/lib/mcp-post-write.mjs':{},
    '@/lib/mcp-read-sections.mjs':{readNarratorSections:({loaders})=>({sections:Object.fromEntries(Object.entries(loaders).map(([key,run])=>[key,run()])),sectionVersions:{},omittedSections:[]})},
    '@/lib/mcp-state-delta-cache.mjs':{},'@/lib/dm/encounter-tools':{},
    '@/lib/db/campaigns':campaignApi,'@/lib/db/chapters':{listChapters:()=>[]},
    '@/lib/db/director-arms':{getDirectorArm:()=>null},'@/lib/dm/director-logic':{buildDirectorBlock:()=>null},
    '@/lib/db/dm-turns':{listOpenPendingRolls:()=>[]},
    '@/lib/db/dm-whispers':{listRecentWhispersForPrompt:()=>[],listPendingPlayerWhispers:()=>[]},
    '@/lib/db/encounters':{getActiveEncounter:()=>null,listEnemies:()=>[]},
    '@/lib/db/facts':{listActiveFacts:()=>[]},'@/lib/db/locations':{getCurrentLocation:()=>null},
    '@/lib/db/messages':{listMessagesInSeqRange:(id,low,high)=>savedMessages(id).filter(x=>x.seq>=low&&x.seq<=high),listRecentMessages:savedMessages},
    '@/lib/db/notes':{listPublicCampaignNotes:()=>[]},'@/lib/db/rolls':{listRecentRolls:()=>[]},
    '@/lib/db/scene-tracker':{getSceneTracker:()=>null},'@/lib/db/sheets':{listSheets:()=>[]},
    '@/lib/dm/message-edit-logic':{},'@/lib/dm/renarrate-logic':{},'@/lib/sheet-privacy':{projectSheetsForViewer:sheets=>sheets},
    '@/lib/dm/invoke-catalog':{consoleAdjudications:()=>[{entries:[{name:'request_roll'},{name:'unknown_future_action'}]}]},
    '@/lib/dm/invoke':{invokeEngineSynchronous:()=>{invoked++;return{ok:true};}},
    '@/lib/dm/human-narration':{persistHumanNarration:()=>{throw Error('Unexpected story write');}},
    '@/lib/dm/narrator-command':{NarratorCommandError:class NarratorCommandError extends Error{constructor(message,status=400){super(message);this.status=status;}},executeNarratorCommand:(_id,_payload,work)=>work()},
    '@/lib/dm/global-turn-logic':{},'@/lib/db/narrator-commands':{listNarratorReceipts:()=>[]},
    '@/lib/dm/delegation':{coverInEffect:()=>false},
    '@/lib/dm/social-tools':{npcRosterForPrompt:()=>[]},'@/lib/db/asks':asks,'@/lib/events':events,
    '@/lib/mcp-snapshot-cache.mjs':{narratorSnapshots:{restore:()=>null,remember:()=>true}},
    '@/lib/mcp-read-budget.mjs':{budgetRead:state=>state,ReadBudgetError:class ReadBudgetError extends Error{}},
    '../../shared/orchestration-snapshot.mjs':{},
  });
  const actionCalls=[];
  const control=load('src/lib/mcp-control.ts',{
    '@/lib/mcp-control-actions':{executeMcpControl:async(action,p)=>{
      actionCalls.push({action,p});
      if(action==='campaigns.events'){
        if(!campaigns.has(p.campaignId))throw Error('campaign not found');
        return{events:events.listEventsSince(p.campaignId,p.afterSeq??0,p.limit??100)};
      }
      if(action==='sheets.patch'||action==='characters.instantiate')return{sheet:{id:'sheet'}};
      return {ok:true};
    }},'@/lib/db/sheets':{getSheetById:()=>({id:'sheet',campaignId:A,userId:'alice'})},
    '@/lib/db/campaigns':campaignApi,'@/lib/events':events,'@/lib/mcp-event-filter':filter,
  });
  const route=load('src/app/api/campaigns/[campaignId]/ask/route.ts',{
    zod:{z},'@/lib/campaign-api':{requireVoice:async()=>voiceError??{campaign:campaigns.get(A),user:{id:'alice'}},requireMember:async()=>voiceError??{user:{id:'bob'}},isErrorResponse:x=>x instanceof Response},
    '@/lib/ingress-budget':{enforcePlayerIngress:()=>null},
    '@/lib/db/campaigns':campaignApi,'@/lib/db/asks':asks,'@/lib/db/sheets':{getSheetForUser:()=>({id:'sheet'})},
    '@/lib/events':events,'@/lib/dm/ask':{runAsk:async()=>{modelCalls++;return{answer:'AI response',citations:[]};}},
    '@/lib/dm/ask-logic':{ASK_SCOPES:['story','rules','sheet'],ASK_VISIBILITIES:['private','table'],QUESTION_MAX_CHARS:1000,clampQuestion:x=>x,inferScope:()=> 'story'},
  });
  const streams={alice:[],bob:[],dm:[],anonymous:[],other:[]};
  const stops=['alice','bob','dm'].map(user=>events.subscribe(A,chunk=>streams[user].push(chunk),user));
  stops.push(events.subscribe(A,chunk=>streams.anonymous.push(chunk)),events.subscribe(B,chunk=>streams.other.push(chunk),'alice'));
  for(const value of Object.values(streams))value.length=0;
  t.after(()=>{stops.forEach(stop=>stop());db.close();});
  const insert=(campaignId=A,visibility='private')=>asks.insertAsk({campaignId,userId:'alice',characterId:'sheet',visibility,scope:'story',question:'Secret question',answer:'Awaiting reply',citations:[],status:'pending'});
  const message=(content,type='message_added')=>{
    const n=++seq;db.prepare('INSERT INTO campaign_messages VALUES(?,?,?,?)').run(A,n,'player',content);
    events.publishWithSeq(A,n,type,{message:{content}});return n;
  };
  const submit=(body,language='ru')=>route.POST(new Request('http://app/api/campaigns/'+A+'/ask',{method:'POST',headers:{'content-type':'application/json',cookie:`odm_locale=${language}`},body:JSON.stringify(body)}),{params:Promise.resolve({campaignId:A})});
  return {db,asks,events,effects,adapter,campaigns,narrator,control,route,streams,insert,message,submit,actionCalls,
    setSeq:n=>seq=n,getSeq:()=>seq,invoked:()=>invoked,modelCalls:()=>modelCalls,deny:response=>voiceError=response};
}

test('answerAsk scopes both SQL write and return value to its campaign',t=>{
  const f=fixture(t);const ask=f.insert();
  assert.equal(f.asks.answerAsk(B,ask.id,'wrong campaign'),null);
  assert.equal(f.asks.listAsksForCampaign(A)[0].answer,'Awaiting reply');
  const answer=f.asks.answerAsk(A,ask.id,'Correct',[]);
  assert.equal(answer.answer,'Correct');assert.equal(answer.campaignId,A);
});

test('external narrator cannot use another campaign ID to answer a known ask',async t=>{
  const f=fixture(t);const ask=f.insert(B);
  await assert.rejects(f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:'Should not land'}),error=>error.status===404);
  assert.equal(f.asks.listAsksForCampaign(B)[0].answer,'Awaiting reply');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM campaign_events').get().n,0);
  for(const stream of Object.values(f.streams))assert.deepEqual(stream,[]);
});

test('private reply reaches only its author; story sequence, floor and other campaigns are unchanged',async t=>{
  const f=fixture(t);const ask=f.insert();const floor=structuredClone(f.campaigns.get(A).floor);
  const outcome=await f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:'Private answer',citations:[{kind:'rule',ref:'test',quote:'Grounding'}]});
  assert.equal(outcome.result.ask.answer,'Private answer');assert.equal(f.getSeq(),0);assert.deepEqual(f.campaigns.get(A).floor,floor);
  assert.equal(f.streams.alice.length,1);assert.ok(f.streams.alice[0].includes('event: ask_activity'));assert.ok(!f.streams.alice[0].includes('Private answer'));
  for(const key of ['bob','dm','anonymous','other'])assert.deepEqual(f.streams[key],[]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM campaign_messages').get().n,0);
});

test('table reply sends a contentless notification to the table',async t=>{
  const f=fixture(t),ask=f.insert(A,'table');
  await f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:'Public answer'});
  assert.equal(f.streams.bob.length,1);assert.ok(!f.streams.bob[0].includes('Public answer'));assert.equal(f.getSeq(),0);
});

test('private human Ask submission cannot enter shared persisted/SSE payloads or run the model',async t=>{
  const f=fixture(t);const response=await f.submit({question:'PRIVATE SENTINEL'});
  assert.equal(response.status,202);const {ask}=await response.json();assert.equal(ask.question,'PRIVATE SENTINEL');
  assert.equal(f.modelCalls(),0);assert.equal(f.getSeq(),0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM campaign_events').get().n,0);
  for(const stream of Object.values(f.streams))assert.ok(!stream.join('').includes('PRIVATE SENTINEL'));
  assert.equal(f.streams.alice.length,1);assert.equal(f.streams.dm.length,1);
  for(const key of ['bob','anonymous','other'])assert.deepEqual(f.streams[key],[]);
  const read=await f.route.GET(new Request('http://app/ask'),{params:Promise.resolve({campaignId:A})});assert.deepEqual((await read.json()).asks,[]);
  const dm=await f.narrator.executeMcpNarratorControl('narrator.read',{campaignId:A});assert.equal(dm.result.asks[0].id,ask.id);
});

for(const [locale,fragment]of [['ru','Вопрос передан'],['en','Your question']])test(`human Ask acknowledgement: ${locale}`,async t=>{
  const f=fixture(t);const {ask}=await (await f.submit({question:'Question',visibility:'table'},locale)).json();
  assert.ok(ask.answer.includes(fragment));assert.equal(f.streams.bob.length,1);
  assert.equal(f.asks.listAsksForUser(A,'bob')[0].id,ask.id);
});

test('muted/unauthorized Ask request returns the existing denial before any write',async t=>{
  const f=fixture(t);f.deny(Response.json({error:'Forbidden'},{status:403}));
  assert.equal((await f.submit({question:'not allowed'})).status,403);assert.equal(f.asks.listAsksForCampaign(A).length,0);
});

test('Ask never invokes a server model even for a legacy AI-mode campaign',async t=>{
  const f=fixture(t);f.campaigns.get(A).gameSettings.dmMode='ai';
  const response=await f.submit({question:'AI question'});assert.equal(response.status,202);
  assert.equal((await response.json()).ask.status,'pending');assert.equal(f.modelCalls(),0);
});

test('missing/wrong DM mode, stale sequence, invalid answer and unknown ask are rejected',async t=>{
  const f=fixture(t),ask=f.insert();
  await assert.rejects(f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:'x',expectedSeq:2}),error=>error.status===409);
  await assert.rejects(f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:' '}),error=>error.status===400);
  f.campaigns.get(A).gameSettings.dmMode='ai';
  await assert.rejects(f.narrator.executeMcpNarratorControl('narrator.answer_ask',{campaignId:A,askId:ask.id,answer:'x'}),error=>error.status===409);
  assert.equal(f.asks.listAsksForCampaign(A)[0].answer,'Awaiting reply');
});

for(const mode of ['narrator','control'])test(`OOC-only pages advance their unfiltered cursor (${mode})`,async t=>{
  const f=fixture(t);f.message('(ooc) first');f.message(' (OOC) second');f.message('An in-character action');f.message('(ooc) edited','message_updated');f.setSeq(8);
  const read=async afterSeq=>mode==='narrator'?(await f.narrator.executeMcpNarratorControl('narrator.read',{campaignId:A,afterSeq,limit:1})).result:f.control.executeMcpControl('campaigns.events',{campaignId:A,afterSeq,limit:1});
  const first=await read(0);assert.equal(first.events.length,0);assert.equal(first.nextCursor,1);assert.equal(first.hasMore,true);
  const second=await read(first.nextCursor);assert.equal(second.events.length,0);assert.equal(second.nextCursor,2);assert.equal(second.hasMore,true);
  const third=await read(second.nextCursor);assert.equal(third.events[0].seq,3);assert.equal(third.nextCursor,3);assert.equal(third.hasMore,true);
  const fourth=await read(third.nextCursor);assert.equal(fourth.events.length,mode==='narrator'?1:0);
  if(mode==='narrator')assert.equal(fourth.events[0].payload.removed,true);
  assert.equal(fourth.nextCursor,8);assert.equal(fourth.hasMore,false);
  if(mode==='narrator'){assert.deepEqual(first.messages,[]);assert.equal(third.messages[0].content,'An in-character action');assert.equal(first.recentMessages.length,1);}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM campaign_messages').get().n,4,'OOC must remain in the actual chat');
});

test('control boundary retains sheet/member update events',async t=>{
  const f=fixture(t);
  await f.control.executeMcpControl('characters.instantiate',{campaignId:A});
  assert.deepEqual(f.events.listEventsSince(A,0).map(x=>x.type),['sheet_updated','member_updated']);
});

test('private notification rolls back with its enclosing operation',t=>{
  const f=fixture(t);
  assert.throws(()=>f.effects.withCommittedEffects(()=>f.adapter.transaction(()=>{
    f.events.publishUserEphemeral(A,'alice','ask_activity',{});throw Error('Rollback');
  })()),/Rollback/);
  assert.deepEqual(f.streams.alice,[]);
});

test('subscriber identity is campaign-scoped and an anonymous subscription gets no private event',t=>{
  const f=fixture(t),received=[];const callback=chunk=>received.push(chunk);
  const stopA=f.events.subscribe(A,callback,'alice'),stopB=f.events.subscribe(B,callback);
  received.length=0;f.events.publishUserEphemeral(B,'alice','ask_activity',{});assert.equal(received.length,0);
  f.events.publishUserEphemeral(A,'alice','ask_activity',{});assert.equal(received.length,1);
  stopA();stopB();
});

function jsxRuntime(){const jsx=(type,props,key)=>({type,props:props??{},key});return{jsx,jsxs:jsx,Fragment:'Fragment'};}
function walk(tree,predicate){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(x=>walk(x,predicate));return[...(predicate(tree)?[tree]:[]),...walk(tree.props?.children,predicate)];}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ');return typeof tree==='object'?text(tree.props?.children):String(tree);}
function uiFixture(locale){
  const jsx=jsxRuntime();const icons=Object.fromEntries(['Bookmark','ChevronLeft','FastForward','Pencil','ChevronRight','Crown','EyeOff','Flag','ImageOff','ImagePlus','Loader2','Pin','RefreshCw','ShieldQuestion','UserPlus','Volume2','MessageSquare','Swords','Users'].map(name=>[name,name]));
  const style=load('src/app/campaigns/[campaignId]/PlayerMessageStyle.tsx',{'react/jsx-runtime':jsx,'lucide-react':icons,'@/lib/player-message':player});
  const react={memo:x=>x,useEffect(){},useLayoutEffect(){},useMemo:f=>f(),useRef:x=>({current:x}),useState:x=>[typeof x==='function'?x():x,()=>{}]};
  const mocks={react,'react/jsx-runtime':jsx,'lucide-react':icons,'@/lib/cn':{cn:(...x)=>x.filter(Boolean).join(' ')},'@/lib/ui':{ui:{iconAction:'icon'}},
    '@/lib/placeholders':{avatarPlaceholder:()=>'/avatar',characterPlaceholder:()=>'/character'},'@/lib/campaign-types':types,
    '@/app/campaigns/[campaignId]/PlayerMessageStyle':style,'@/app/campaigns/[campaignId]/HaltedTurnBanner':{HaltedTurnBanner:'HaltedTurnBanner'},
    '@/app/campaigns/[campaignId]/InlineMessageEditor':{InlineMessageEditor:'InlineMessageEditor'},'@/lib/dm/tool-text':{stripToolText:x=>x},
    '@/app/campaigns/[campaignId]/AskPanel':{AskChatEntry:'AskChatEntry'},
    '@/components/ui/ImageLightbox':{ImageLightbox:'ImageLightbox'},'@/components/ui/GameIcon':{GameIcon:'GameIcon'},'@/components/ui/D20Spinner':{D20Spinner:'D20Spinner'},
    '@/app/campaigns/[campaignId]/RollCard':{RollCard:'RollCard'},'@/app/campaigns/[campaignId]/dmStatusPhrases':{DM_STATUS_PHRASES_BY_LOCALE:Object.fromEntries(['ru','en','pl'].map(l=>[l,{thinking:['thinking'],idle:[]}]))},
    '@/lib/i18n':{useI18n:()=>({locale})},'@/lib/i18n/message-text':{messageText:(l,key)=>`${l}:${key}`},
    '@/lib/i18n/session-system-text':{displaySystemText:(content,l)=>`${l}:${content}`},
  };
  const list=load('src/app/campaigns/[campaignId]/MessageList.tsx',mocks);
  const row=(message,extra={})=>{
    const tree=list.MessageList({messages:[message],campaignId:A,rolls:[],sheets:[],dmStatus:'idle',dmDraft:'',...extra});
    const node=walk(tree,n=>typeof n.type==='function'&&n.type.name==='MessageItem')[0];
    return node.type(node.props);
  };
  return{style,list,row};
}
for(const [locale,labels]of [['ru',['Действие','Действие','Вне игры']],['en',['Action','Action','OOC']]])test(`merged player styles and labels (${locale})`,()=>{
  const f=uiFixture(locale);
  for(const [i,content]of ['"Says"','*Acts*','(ooc) Table chat'].entries()){
    const message={id:'m',authorType:'player',userId:'alice',content};const before=structuredClone(message);let reported;
    const row=f.row(message,{onReport:m=>reported=m});
    const badge=walk(row,n=>n.type===f.style.PlayerMessageBadge)[0];assert.equal(text(badge.type(badge.props)).trim(),labels[i]);
    const body=walk(row,n=>n.type===f.style.PlayerMessageBody)[0];assert.equal(body.type(body.props).props['data-message-kind'],['do','do','ooc'][i]);
    const report=walk(row,n=>n.type==='button')[0];assert.equal(report.props['aria-label'],`${locale}:Report this message`);report.props.onClick();assert.equal(reported,message);
    assert.deepEqual(message,before);
  }
});

test('merge preserves blocked/own-message reporting and halted-turn/DM rendering branches',()=>{
  const f=uiFixture('ru');const playerMessage={id:'p',userId:'alice',authorType:'player',content:'Secret'};
  const blocked=f.row(playerMessage,{blockedUserIds:['alice']});assert.ok(!text(blocked).includes('Secret'));assert.equal(walk(blocked,n=>n.type===f.style.PlayerMessageBody).length,0);
  const own=f.row(playerMessage,{meUserId:'alice',onReport(){}});assert.equal(walk(own,n=>n.type==='button').length,0);
  const halted=f.row({id:'f',authorType:'system',content:types.DM_HALTED_PREFIX+'error',dmTurnId:'turn'});assert.equal(halted.type,'HaltedTurnBanner');
  const dm=f.row({id:'d',authorType:'dm',content:'Narration'});assert.equal(walk(dm,n=>n.type===f.style.PlayerMessageBody).length,0);assert.ok(text(dm).includes('ru:Dungeon Master'));
});
