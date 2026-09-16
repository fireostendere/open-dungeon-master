// Actual TSX event handlers executed with a deterministic hook/JSX adapter.
// This suite is NOT a browser, hydration, Radix accessibility or React DOM test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadReviewModule } from './lib/review-module.mjs';
const source = p => fileURLToPath(new URL('../src/' + p, import.meta.url));
const catalog = loadReviewModule(source('lib/i18n/session-text.ts'));
const request = loadReviewModule(source('lib/i18n/session-request.ts'), {'./session-text':catalog});
const locales = ['ru','en','pl'];
const localeModule = {
  isLocale: x => locales.includes(x), nextLocale: x => locales[(locales.indexOf(x)+1)%3],
  translations: Object.fromEntries(locales.map(locale => [locale,{common:{save:catalog.SESSION_TEXT[locale].save},units:{meters:'m',feet:'ft',kilograms:'kg',pounds:'lb',tiles:'tiles'}}])),
};
function hooks() {
  const slots=[]; const effects=[]; let cursor=0;
  const react={
    createContext: value => ({Provider:'Provider',value}), useContext: ctx => ctx.value,
    useState: initial => { const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i], next => slots[i]=typeof next==='function'?next(slots[i]):next]; },
    useRef: initial => { const i=cursor++; if(!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useMemo: callback => callback(), useEffect: callback => { effects.push(callback); },
  };
  const jsx=(type,props,key)=>({type,props:props??{},key});
  return {react, effects, jsx:{jsx,jsxs:jsx,Fragment:'Fragment'}, render: (component,props)=>{cursor=0;return component(props);}};
}
function walk(tree, predicate) {
  if(tree==null||typeof tree==='boolean')return [];
  if(Array.isArray(tree))return tree.flatMap(node=>walk(node,predicate));
  if(typeof tree!=='object')return [];
  return [...(predicate(tree)?[tree]:[]), ...walk(tree.props?.children,predicate)];
}
function text(tree) {
  if(tree==null||typeof tree==='boolean')return '';
  if(Array.isArray(tree))return tree.map(text).join(' ');
  if(typeof tree!=='object')return String(tree);
  return text(tree.props?.children);
}
function globals(t, values) {
  for(const [key,value] of Object.entries(values)){
    const saved=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    t.after(()=>saved?Object.defineProperty(globalThis,key,saved):delete globalThis[key]);
  }
}
function loadUi(path, locale='ru') {
  const h=hooks();
  const names=['MessageList','ReportDialog','ItemProposalBar','UtilityCallStrip','AskDock','DmCoverNotice','NarrationLanguageSetting'];
  const imported=Object.fromEntries(names.map(name=>[name,name]));
  const mocks={react:h.react,'react/jsx-runtime':h.jsx,'@/lib/i18n':{useI18n:()=>({locale})},'@/lib/i18n/translations':localeModule,
    '@/lib/i18n/session-text':catalog,'@/lib/i18n/session-request':request,'@/lib/cn':{cn:(...args)=>args.filter(Boolean).join(' ')},
    '@/lib/ui':{ui:new Proxy({},{get:(_t,p)=>String(p)})},
    'lucide-react':Object.fromEntries(['Loader2','RotateCcw','ScrollText','Star'].map(x=>[x,x])),
    '@radix-ui/react-alert-dialog':Object.fromEntries(['Root','Portal','Overlay','Content','Title','Description','Cancel'].map(x=>[x,'Alert'+x])),
  };
  for(const file of ['MessageList','ReportDialog','ItemProposalBar','UtilityCallStrip','AskPanel','DmDelegationPanel','NarrationLanguageSetting']) mocks[`@/app/campaigns/[campaignId]/${file}`]=imported;
  return {...h,...loadReviewModule(source(`app/campaigns/[campaignId]/${path}.tsx`),mocks)};
}
for(const locale of locales){
  test(`catalog parity and interpolation: ${locale}`,()=>{
    assert.deepEqual(Object.keys(catalog.SESSION_TEXT[locale]).sort(),Object.keys(catalog.SESSION_TEXT.en).sort());
    for(const [key,value] of Object.entries(catalog.SESSION_TEXT[locale])){
      assert.ok(value.trim());
      assert.deepEqual([...value.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),[...catalog.SESSION_TEXT.en[key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort());
      if(locale!=='en')assert.notEqual(value,catalog.SESSION_TEXT.en[key],key);
    }
    assert.ok(catalog.sessionText(locale,'damage',{name:'Hero {amount}',amount:3,hp:7,type:''}).includes('Hero {amount}'));
  });
}
test('every audit kind has a localized description, retaining numeric results and names',()=>{
  const entries=[['apply_damage',{amount:4,currentHp:8}],['apply_damage',{form:'Wolf',reverted:true,carryover:3}],
    ['heal',{amount:4,newHp:12}],['award_xp',{amount:25,newXp:200}],['modify_gold',{delta:-5,gold:15}],
    ['grant_item',{name:'Ruby',qty:2}],['remove_item',{name:'Ruby',removed:2}],['set_condition',{condition:'poisoned'}],
    ['clear_condition',{condition:'poisoned'}],['use_spell_slot',{level:2}],['use_item',{item:'Potion'}],
    ['purchase',{action:'sell',item:'Ruby',qty:2,price:5}],['use_resource',{resource:'Inspiration',from:'Ally'}],
    ['grant_temp_hp',{tempHp:5}],['learn_spell',{spell:'Light'}],['learn_spell',{spell:'Light',action:'remove'}],
    ['update_sheet',{currentHp:3}],['undo',{}],['lead_edit',{reason:'test',xp:100}],['player_adjust',{currentHp:9}]];
  for(const [kind,delta] of entries){
    const original=structuredClone(delta);
    for(const locale of ['ru','pl']){
      const result=catalog.describeAuditEntry({kind,delta},'Hero',locale);
      assert.ok(result.includes('Hero')); assert.doesNotMatch(result,/\{\w+\}/);
      assert.notEqual(result,catalog.describeAuditEntry({kind,delta},'Hero','en'));
      if(kind.includes('condition'))assert.ok(!result.includes('poisoned'));
    }
    assert.deepEqual(delta,original);
  }
});
for(const locale of locales){
  test(`UI locale setter never writes shared settings: ${locale}`,t=>{
    let fetches=0; const storage=new Map(); const queued=[];
    globals(t,{document:{documentElement:{lang:'en'},cookie:''},window:{location:{pathname:'/campaigns/campaign'},setTimeout:fn=>queued.push(fn),clearTimeout:()=>{}},
      localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},fetch:()=>{fetches++;throw Error('unexpected network');}});
    const h=hooks();const mod=loadReviewModule(source('lib/i18n/context.tsx'),{react:h.react,'react/jsx-runtime':h.jsx,'./translations':localeModule});
    let tree=h.render(mod.I18nProvider,{children:null,initialLocale:'en'});
    h.effects[0]();queued.forEach(fn=>fn());
    tree=h.render(mod.I18nProvider,{children:null,initialLocale:'en'});
    tree.props.value.setLocale(locale);
    tree=h.render(mod.I18nProvider,{children:null,initialLocale:'en'});
    assert.equal(tree.props.value.locale,locale);assert.equal(document.documentElement.lang,locale);
    assert.equal(storage.get('odm_locale'),locale);assert.ok(document.cookie.includes(`odm_locale=${locale};`));
    assert.equal(fetches,0);
    tree.props.value.setLocale('invalid');assert.equal(storage.get('odm_locale'),locale);
  });
}
test('unavailable localStorage does not prevent personal locale selection',t=>{
  globals(t,{document:{documentElement:{},cookie:''},localStorage:{setItem:()=>{throw Error('blocked');}}});
  const h=hooks();const mod=loadReviewModule(source('lib/i18n/context.tsx'),{react:h.react,'react/jsx-runtime':h.jsx,'./translations':localeModule});
  h.render(mod.I18nProvider,{children:null}).props.value.setLocale('pl');
  assert.equal(document.documentElement.lang,'pl');
});
for(const locale of ['ru','pl']){
  test(`HTTP and network errors remain localized: ${locale}`,async t=>{
    for(const status of [401,403,404,409,500]){
      globals(t,{fetch:async()=>Response.json({error:'Internal English failure'},{status})});
      await assert.rejects(request.sessionRequest(locale,'editFailed','/fixture'),error=>error instanceof request.SessionRequestError&&error.status===status&&!error.message.includes('English'));
    }
    globals(t,{fetch:async()=>{throw new TypeError('fetch failed');}});
    await assert.rejects(request.sessionRequest(locale,'editFailed','/fixture'),error=>error.message===catalog.sessionText(locale,'networkFailed'));
  });
}
const auditProps={campaignId:'campaign',sheets:[],steersStory:true,auditLog:[
  {id:'a1',seq:1,turnId:'turn',characterId:'hero',characterName:'Hero',kind:'award_xp',delta:{amount:25,newXp:200},undoable:true},
  {id:'a2',seq:2,turnId:'turn',characterId:'hero',kind:'heal',delta:{amount:2,newHp:10},undoable:true},
  {id:'a3',seq:3,characterId:'hero',kind:'undo',delta:{},undoable:false,revertedAt:'now'},
]};
for(const locale of ['ru','pl']){
  test(`EventLog empty, populated and permission states: ${locale}`,()=>{
    const mod=loadUi('EventLog',locale);
    assert.equal(text(mod.render(mod.EventLog,{...auditProps,auditLog:[]})).trim(),catalog.sessionText(locale,'empty'));
    const tree=mod.render(mod.EventLog,auditProps);
    assert.ok(text(tree).includes(catalog.sessionText(locale,'revert',{count:2})));
    assert.ok(text(tree).includes(catalog.sessionText(locale,'undone')));
    assert.equal(walk(tree,node=>node.type==='button'&&node.props.title===catalog.sessionText(locale,'revertTip')).length,1);
    assert.equal(walk(mod.render(mod.EventLog,{...auditProps,steersStory:false}),node=>node.type==='button').length,0);
  });
}
test('undo conflict needs explicit confirmation, rejects duplicates and retains a failed dialog',async t=>{
  const mod=loadUi('EventLog','pl');let calls=[];let complete;
  globals(t,{fetch:async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body});
    if(calls.length===1)return Response.json({warnings:['field changed']},{status:409});
    if(calls.length===2){await new Promise(resolve=>complete=resolve);return Response.json({error:'Forbidden'},{status:403});}
    return Response.json({ok:true});
  }});
  const undo=walk(mod.render(mod.EventLog,auditProps),node=>node.type==='button'&&node.props.title===catalog.sessionText('pl','undoTip'))[0];
  await undo.props.onClick();
  let tree=mod.render(mod.EventLog,auditProps);
  const confirm=walk(tree,node=>node.type==='button'&&text(node).includes(catalog.sessionText('pl','undoConfirm')))[0];
  const waiting=confirm.props.onClick();await confirm.props.onClick();
  assert.equal(calls.length,2);complete();await waiting;
  tree=mod.render(mod.EventLog,auditProps);
  assert.equal(walk(tree,node=>node.type==='AlertRoot').length,1);
  assert.equal(text(walk(tree,node=>node.props.role==='alert')[0]),catalog.sessionText('pl','forbidden'));
  await walk(tree,node=>node.type==='button'&&text(node).includes(catalog.sessionText('pl','undoConfirm')))[0].props.onClick();
  assert.equal(walk(mod.render(mod.EventLog,auditProps),node=>node.type==='AlertRoot').length,0);
  assert.deepEqual(calls.map(x=>x.body),[{}, {confirm:true},{confirm:true}]);
});
const chatState={campaign:{gameSettings:{ttsEnabled:true,language:'ru'}},messages:[],rolls:[],sheets:[],members:[],locations:[],dmStatus:null,dmDraft:'',utilityCalls:[],blockedUserIds:[],mediaStatus:{},narrationAudio:{},itemProposals:[],asks:[],asksLoaded:true};
const message={id:'message',content:'A fact worth preserving',seq:7,authorType:'dm'};
function chatProps(overrides={}){
  return {state:structuredClone(chatState),campaignId:'campaign',meUserId:'user',steersStory:true,narration:{unlock(){},play(){}},visible:true,askOpen:false,onAskOpenChange(){},refreshAsks:async()=>{},refreshFacts:async()=>{},onError(){},onLoreCheck(){},onRenarrate(){},onPinned(){},children:null,...overrides};
}
test('chat actions keep their routes, payloads, callbacks and authority gates',async t=>{
  const mod=loadUi('SessionChatColumn','ru');const calls=[];let pinned=0,facts=0;
  globals(t,{window:{getSelection:()=>({toString:()=>''})},fetch:async(url,init)=>{calls.push({url,body:init.body?JSON.parse(init.body):undefined});return Response.json({url:'/generated-audio/a.wav'});}});
  const props=chatProps({onPinned:()=>pinned++,refreshFacts:async()=>facts++});
  const handlers=walk(mod.render(mod.SessionChatColumn,props),node=>node.type==='MessageList')[0].props;
  await handlers.onContinueScene(message);await handlers.onSelectVariant(message,2);await handlers.onEditSave(message,'Edited');
  await handlers.onPinMemory(message);await handlers.onPinCanon(message);await handlers.onReplayAudio(message.id);
  assert.deepEqual(calls.map(x=>x.url),['messages/message/continue','messages/message/renarrate','messages/message/edit','pins','facts','messages/message/narrate'].map(x=>'/api/campaigns/campaign/'+x));
  assert.deepEqual(calls[1].body,{action:'select',index:2});assert.deepEqual(calls[2].body,{content:'Edited'});
  assert.equal(pinned,1);assert.equal(facts,1);
  const restricted=walk(mod.render(mod.SessionChatColumn,{...props,steersStory:false}),node=>node.type==='MessageList')[0].props;
  for(const key of ['onContinueScene','onSelectVariant','onEditSave','onPinCanon','onRenarrate'])assert.equal(restricted[key],undefined);
  assert.equal(walk(mod.render(mod.SessionChatColumn,{...props,steersStory:false}),node=>node.type==='NarrationLanguageSetting').length,0);
});
test('failed chat writes never fire success callbacks and are localized',async t=>{
  const mod=loadUi('SessionChatColumn','pl');let success=0;const errors=[];
  globals(t,{window:{getSelection:()=>null},fetch:async()=>Response.json({error:'Internal English failure'},{status:500})});
  const props=chatProps({onError:x=>errors.push(x),onPinned:()=>success++,refreshFacts:async()=>success++});
  const handlers=walk(mod.render(mod.SessionChatColumn,props),node=>node.type==='MessageList')[0].props;
  await handlers.onPinMemory(message);await handlers.onPinCanon(message);await handlers.onContinueScene(message);await handlers.onSelectVariant(message,1);
  assert.equal(success,0);assert.equal(errors.length,4);assert.ok(errors.every(x=>!x.includes('English')));
  assert.equal(await handlers.onEditSave(message,'edit'),catalog.sessionText('pl','editFailed'));
  assert.equal(await handlers.onReplayAudio(message.id),catalog.sessionText('pl','audioFailed'));
});
test('narration language changes only on explicit save and does not send uiLocale',async t=>{
  const mod=loadUi('NarrationLanguageSetting','pl');let calls=[];
  globals(t,{fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});return Response.json({gameSettings:body});}});
  const props={campaignId:'campaign',language:'ru'};
  let tree=mod.render(mod.NarrationLanguageSetting,props);
  walk(tree,node=>node.type==='select')[0].props.onChange({target:{value:'en'}});
  assert.equal(calls.length,0);
  tree=mod.render(mod.NarrationLanguageSetting,props);
  await tree.props.onSubmit({preventDefault(){}});
  assert.deepEqual(calls,[{url:'/api/campaigns/campaign/settings',body:{language:'en'}}]);
  tree=mod.render(mod.NarrationLanguageSetting,props);
  assert.equal(walk(tree,node=>node.type==='select')[0].props.value,'en');
  tree=mod.render(mod.NarrationLanguageSetting,{...props,language:'pl'});
  assert.equal(walk(tree,node=>node.type==='select')[0].props.value,'pl');
});
test('narration save refusal and malformed success never show a saved result',async t=>{
  for(const reply of [()=>Response.json({error:'Forbidden'},{status:403}),()=>Response.json({})]){
    const mod=loadUi('NarrationLanguageSetting','ru');globals(t,{fetch:async()=>reply()});
    const props={campaignId:'campaign',language:'ru'};
    walk(mod.render(mod.NarrationLanguageSetting,props),node=>node.type==='select')[0].props.onChange({target:{value:'pl'}});
    await mod.render(mod.NarrationLanguageSetting,props).props.onSubmit({preventDefault(){}});
    const tree=mod.render(mod.NarrationLanguageSetting,props);
    assert.equal(walk(tree,node=>node.props.role==='status').length,0);
    assert.equal(walk(tree,node=>node.props.role==='alert').length,1);
  }
});
