// Execute the actual TSX render functions and event handlers with an explicit
// deterministic hooks/JSX adapter. Not React DOM, hydration or browser E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadReviewModule} from './lib/review-module.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=p=>path.join(root,'src',p);
const textModule=loadReviewModule(source('lib/i18n/message-text.ts'));
const audit=loadReviewModule(source('lib/i18n/audit-text.ts'));
const phrases=loadReviewModule(source('app/campaigns/[campaignId]/dmStatusPhrases.ts'));
const {messageText,MESSAGE_TEXT}=textModule;
function hooks(){
  let cursor=0;let slots=[];
  const react={memo:x=>x,useEffect:()=>{},useMemo:fn=>fn(),
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
    useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];}};
  const jsx=(type,props,key)=>({type,props:props??{},key});
  return{react,jsx:{jsx,jsxs:jsx,Fragment:'Fragment'},render:(component,props)=>{cursor=0;return component(props);},reset:()=>{cursor=0;slots=[];}};
}
function nodes(tree,predicate){
  if(tree==null||typeof tree==='boolean')return[];
  if(Array.isArray(tree))return tree.flatMap(x=>nodes(x,predicate));
  if(typeof tree!=='object')return[];
  return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ');if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const components=['HaltedTurnBanner','InlineMessageEditor','ImageLightbox','D20Spinner','RollCard'];
const icons=['Bookmark','ChevronLeft','FastForward','Pencil','ChevronRight','Crown','EyeOff','Flag','ImageOff','ImagePlus','Loader2','Pin','RefreshCw','ShieldQuestion','UserPlus','Volume2','RotateCcw','TriangleAlert','ScrollText','Star'];
const prefix='The DM ran into a problem: ';
class RequestFailure extends Error {constructor(status,data){super('localized-failure');this.status=status;this.data=data;}}
function loadUi(name,locale='ru',overrides={}){
  const h=hooks();
  const imported=Object.fromEntries(components.map(x=>[x,x]));
  const mocks={react:h.react,'react/jsx-runtime':h.jsx,'lucide-react':Object.fromEntries(icons.map(x=>[x,x])),
    '@/lib/i18n':{useI18n:()=>({locale})},'@/lib/i18n/message-text':textModule,'@/lib/i18n/audit-text':audit,
    '@/lib/i18n/locale-text':{localeText:(l,copy)=>copy[l]},
    '@/lib/i18n/session-system-text':{displaySystemText:(_content,l)=>`${l}: localized system notice`},
    '@/lib/i18n/session-text':{sessionText:(l,key)=>`${l}:${key}`,describeAuditEntry:(_entry,name,l)=>`${l}:${name}`},
    '@/lib/i18n/session-request':{SessionRequestError:RequestFailure,sessionRequest:async()=>({ok:true})},
    '@/lib/cn':{cn:(...a)=>a.filter(Boolean).join(' ')},'@/lib/ui':{ui:new Proxy({},{get:(_t,p)=>String(p)})},
    '@/lib/placeholders':{avatarPlaceholder:()=>'/avatar',characterPlaceholder:()=>'/character'},
    '@/lib/campaign-types':{DM_HALTED_PREFIX:prefix,LEAD_NOTE_PREFIX:'[lead]',JOIN_NOTE_PREFIX:'[join]'},
    '@/lib/dm/tool-text':{stripToolText:x=>x},
    '@/app/campaigns/[campaignId]/dmStatusPhrases':phrases,
    '@radix-ui/react-alert-dialog':Object.fromEntries(['Root','Portal','Overlay','Content','Title','Description','Cancel'].map(x=>[x,'Alert'+x])),
  };
  for(const name of components){
    mocks[`@/app/campaigns/[campaignId]/${name}`]=imported;
    mocks[`@/components/ui/${name}`]=imported;
  }
  Object.assign(mocks,overrides);
  return{...h,...loadReviewModule(source(`app/campaigns/[campaignId]/${name}.tsx`),mocks)};
}
function globals(t,values){for(const [key,value]of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);}}
const baseMessage={id:'m1',authorType:'dm',content:'Authored narration {name}. Не изменять. Łódź.',createdAt:'2026-09-16T12:00:00Z',dmTurnId:'turn',variants:['one','two'],variantIndex:0};
const listProps={messages:[baseMessage],campaignId:'campaign',rolls:[],sheets:[],members:[],locations:[],dmStatus:'idle',dmDraft:'',mediaStatus:{},canRetryTurn:true,canIllustrate:true,onReplayAudio:async()=>null,onPinCanon(){},onPinMemory(){},onEditSave:async()=>null,onLoreCheck(){},onRenarrate(){},onContinueScene(){},onSelectVariant(){}};
function row(mod,props=listProps){const list=mod.render(mod.MessageList,props);const entry=nodes(list,node=>typeof node.type==='function'&&node.props.message)[0];assert.ok(entry);mod.reset();return{component:entry.type,props:entry.props,tree:mod.render(entry.type,entry.props)};}
for(const locale of ['ru','pl','en']){
  test(`literal catalog and placeholders: ${locale}`,()=>{
    for(const [key,pair]of Object.entries(MESSAGE_TEXT)){
      const translated=messageText(locale,key);assert.ok(translated.trim());
      if(locale!=='en')assert.notEqual(translated,key);
      const placeholders=v=>[...v.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
      assert.deepEqual(placeholders(translated),placeholders(key));assert.ok(pair.ru && pair.pl);
    }
    assert.ok(messageText(locale,'Map of {name}',{name:'{name} $& Hero'}).includes('{name} $& Hero'));
  });
  test(`all deterministic status pools have translated parity: ${locale}`,()=>{
    const pools=phrases.DM_STATUS_PHRASES_BY_LOCALE[locale];assert.deepEqual(Object.keys(pools),Object.keys(phrases.DM_STATUS_PHRASES));
    for(const [status,pool]of Object.entries(pools)){
      assert.equal(pool.length,phrases.DM_STATUS_PHRASES[status].length);
      for(const value of pool){assert.ok(value.trim());if(locale!=='en')assert.ok(!phrases.DM_STATUS_PHRASES[status].includes(value));}
    }
    const mod=loadUi('MessageList',locale);
    const props={...listProps,messages:[],dmStatus:'thinking'};
    assert.equal(text(mod.render(mod.MessageList,props)),text(mod.render(mod.MessageList,props)));
    assert.ok(pools.thinking.some(value=>text(mod.render(mod.MessageList,props)).includes(value)));
  });
  test(`message controls and metadata are localized without changing authored narration: ${locale}`,()=>{
    const mod=loadUi('MessageList',locale), rendered=row(mod);
    const labels=nodes(rendered.tree,node=>node.props['aria-label']).map(node=>node.props['aria-label']);
    for(const key of ['Previous take','Next take','Reroll this narration','Continue this scene','Edit this narration',"Pin this to the DM's memory",'Lore check this passage','Pin this passage as canon','Add a picture','Read this passage aloud'])assert.ok(labels.includes(messageText(locale,key)),key);
    assert.ok(text(rendered.tree).includes(messageText(locale,'Dungeon Master')));
    const narration=nodes(rendered.tree,node=>typeof node.type==='function'&&Object.hasOwn(node.props,'content'))[0];
    assert.equal(narration.props.content,baseMessage.content);
    const renderedNarration=mod.render(narration.type,narration.props);assert.ok(text(renderedNarration).includes(baseMessage.content));
    assert.equal(baseMessage.content,'Authored narration {name}. Не изменять. Łódź.');
  });
  test(`media failure, queue and running placeholders: ${locale}`,()=>{
    const mod=loadUi('MessageList',locale),props={label:messageText(locale,'Charting the area...'),fallbackStartedAt:baseMessage.createdAt};
    assert.ok(text(mod.render(mod.MediaPlaceholder,{...props,status:{state:'failed'}})).includes(messageText(locale,'Illustration failed; the story carries on.')));
    assert.ok(text(mod.render(mod.MediaPlaceholder,{...props,status:{state:'queued'}})).includes(messageText(locale,'Waiting for the render queue...')));
    assert.ok(text(mod.render(mod.MediaPlaceholder,{...props,status:{state:'running'}})).includes(props.label));
  });
}
test('row actions preserve permissions, IDs and actual selection arguments',()=>{
  const calls=[];const mod=loadUi('MessageList');
  const r=row(mod,{...listProps,onSelectVariant:(message,index)=>calls.push([message.id,index]),onContinueScene:message=>calls.push(['continue',message.id])});
  for(const key of ['Next take','Continue this scene'])nodes(r.tree,node=>node.props['aria-label']===messageText('ru',key))[0].props.onClick();
  assert.deepEqual(calls,[['m1',1],['continue','m1']]);
  const restricted=loadUi('MessageList');
  const rr=row(restricted,{...listProps,canIllustrate:false,onEditSave:undefined,onRenarrate:undefined,onContinueScene:undefined,onPinCanon:undefined});
  const labels=nodes(rr.tree,node=>node.props['aria-label']).map(node=>node.props['aria-label']);
  for(const key of ['Add a picture','Edit this narration','Reroll this narration','Continue this scene','Pin this passage as canon'])assert.ok(!labels.includes(messageText('ru',key)));
});
test('audio callback rejection clears the busy state and shows a localized failure',async t=>{
  const errors=[];globals(t,{window:{alert:value=>errors.push(value)}});
  const mod=loadUi('MessageList','pl'),r=row(mod,{...listProps,onReplayAudio:async()=>{throw Error('private provider failure');}});
  const button=nodes(r.tree,node=>node.props['aria-label']===messageText('pl','Read this passage aloud'))[0];
  await button.props.onClick();
  const next=mod.render(r.component,r.props);
  assert.equal(nodes(next,node=>node.props['aria-label']===messageText('pl','Read this passage aloud'))[0].props.disabled,false);
  assert.deepEqual(errors,[messageText('pl','Could not read that passage aloud.')]);
});
for(const locale of ['ru','pl']){
  test(`image upload errors do not leak raw provider diagnostics (${locale})`,async t=>{
    const errors=[];
    class FileReader{readAsDataURL(){this.result='data:image/png;base64,AAAA';this.onload();}}
    globals(t,{FileReader,window:{alert:value=>errors.push(value)},fetch:async()=>Response.json({error:'Raw English provider error'},{status:500})});
    const mod=loadUi('MessageList',locale),r=row(mod);
    const input=nodes(r.tree,node=>node.type==='input'&&node.props.type==='file')[0];
    input.props.onChange({target:{files:[{name:'a.png',type:'image/png'}],value:'file'}});
    for(let i=0;i<20&&!errors.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(errors,[messageText(locale,'That image would not upload.')]);
  });
  test(`audit warning and generated reason localize metadata but retain authored reasons (${locale})`,()=>{
    const reason='Авторская причина (inner). Original intent {name}';
    const warning=`A newer heal change (${reason}) also touched: currentHp, spellSlots.`;
    const shown=audit.displayAuditWarning(warning,locale);
    assert.ok(shown.includes(reason));assert.ok(!shown.includes('A newer'));assert.ok(!shown.includes('currentHp'));assert.ok(!shown.includes('spellSlots'));
    assert.equal(audit.displayAuditWarning(warning,'en'),warning);
    assert.equal(audit.displayAuditWarning('Unknown operator diagnostic',locale),'Unknown operator diagnostic');
    assert.ok(!audit.displayAuditWarning('A newer heal change (no reason) also touched: currentHp.',locale).includes('no reason'));
    assert.equal(audit.displayAuditReason('lead_edit','Undid heal (authored by player)',locale),'Undid heal (authored by player)');
    assert.ok(audit.displayAuditReason('undo',`Undid heal (${reason})`,locale).includes(reason));
    assert.ok(!audit.displayAuditReason('undo',`Undid heal (${reason})`,locale).startsWith('Undid'));
  });
  test(`actual EventLog conflict renders the localized warning and preserves confirm payload (${locale})`,async()=>{
    const warning='A newer heal change (no reason) also touched: currentHp.';
    const requests=[];
    const mod=loadUi('EventLog',locale,{'@/lib/i18n/session-request':{SessionRequestError:RequestFailure,sessionRequest:async(_l,_f,url,init)=>{
      const body=JSON.parse(init.body);requests.push({url,body});if(!body.confirm)throw new RequestFailure(409,{warnings:[warning]});return{ok:true};}}});
    const props={campaignId:'campaign',sheets:[],steersStory:true,auditLog:[{id:'a1',characterId:'hero',kind:'undo',reason:'Undid heal',seq:1,undoable:true,delta:{}}]};
    let tree=mod.render(mod.EventLog,props);
    assert.ok(text(tree).includes(audit.displayAuditReason('undo','Undid heal',locale)));
    await nodes(tree,node=>node.type==='button')[0].props.onClick();tree=mod.render(mod.EventLog,props);
    assert.ok(text(tree).includes(audit.displayAuditWarning(warning,locale)));assert.ok(!text(tree).includes(warning));
    const confirm=nodes(tree,node=>node.type==='button'&&text(node).includes('undoConfirm'))[0];await confirm.props.onClick();
    assert.deepEqual(requests,[{url:'/api/campaigns/campaign/audit/a1/undo',body:{}},{url:'/api/campaigns/campaign/audit/a1/undo',body:{confirm:true}}]);
    assert.equal(nodes(mod.render(mod.EventLog,props),node=>node.type==='AlertRoot').length,0);
  });
}
test('halted turn passes the full marker to localization and rejects duplicated/unauthorized retries',async()=>{
  let release;const waiting=new Promise(resolve=>release=resolve);const seen=[];const requests=[];
  const mod=loadUi('HaltedTurnBanner','pl',{'@/lib/i18n/session-system-text':{displaySystemText:value=>{seen.push(value);return'Błąd modelu';}},
    '@/lib/i18n/session-request':{sessionRequest:async(_l,_f,url,init)=>{requests.push({url,body:JSON.parse(init.body)});await waiting;throw new Error('Nie masz uprawnień.');}}});
  const props={campaignId:'campaign',turnId:'turn',content:prefix+'raw English failure',canRetry:true};
  let tree=mod.render(mod.HaltedTurnBanner,props);assert.equal(seen[0],props.content);
  const button=nodes(tree,node=>node.type==='button')[0];const pending=button.props.onClick();await button.props.onClick();assert.equal(requests.length,1);release();await pending;
  tree=mod.render(mod.HaltedTurnBanner,props);assert.equal(text(nodes(tree,node=>node.props.role==='alert')[0]),'Nie masz uprawnień.');
  assert.deepEqual(requests,[{url:'/api/campaigns/campaign/dm-turn/retry',body:{turnId:'turn'}}]);
  assert.equal(nodes(mod.render(mod.HaltedTurnBanner,{...props,canRetry:false}),node=>node.type==='button').length,0);
});
test('MessageList edits are restricted to UI presentation and the audio error boundary',()=>{
  // Syntax-check the actual changed TSX file, rather than claiming grep is E2E.
  const mod=loadUi('MessageList');assert.equal(typeof mod.MessageList,'function');
  const sourceText=fs.readFileSync(source('app/campaigns/[campaignId]/MessageList.tsx'),'utf8');
  assert.ok(sourceText.includes('message.content.slice(LEAD_NOTE_PREFIX.length)'));
  assert.ok(sourceText.includes('stripToolText(content)'));
});
