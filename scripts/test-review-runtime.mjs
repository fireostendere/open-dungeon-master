// Execute the production runtime/profile/client modules. SQLite is real; schema,
// framework and provider dependencies are explicit test doubles, not production E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadReviewModule, sqliteAdapter } from './lib/review-module.mjs';
const path = p => fileURLToPath(new URL('../src/lib/' + p, import.meta.url));
const runtime = loadReviewModule(path('model-runtime.ts'));
const snapshot = (overrides={}) => runtime.modelRuntimeSnapshot({id:'profile-A',baseUrl:'http://provider.test/v1',model:'fixture',contextLimit:8192,contextVerified:true,maxOutputTokens:1024,thinking:'auto',...overrides});
const tools=[{type:'function',function:{name:'probe_echo',parameters:{type:'object',properties:{word:{type:'string'}}}}}];
const messages=[{role:'user',content:'Действие героя. Bohater działa.'}];
const defaultConfig = () => ({text:{provider:'custom',localTextModel:'fixture',customBaseUrl:'http://provider.test/v1',customModel:'fixture',customApiKey:'',maxOutputTokens:0,timeoutMs:0,thinking:'',utilityProvider:'',utilityModel:'',utilityBaseUrl:'',utilityApiKey:''},sampling:{profile:'',story:{},utility:{}},images:{defaultBackend:'',comfyUrl:'',comfyCheckpoint:''}});
const defaults={world:'',style:'',textProvider:'custom',localTextModel:'fixture',customBaseUrl:'http://provider.test/v1',customModel:'fixture',customApiKey:'',utilityProvider:'local',utilityModel:'',utilityBaseUrl:'',utilityApiKey:'',imageMode:'fast',imageBackend:'comfyui',comfyUrl:'',comfyCheckpoint:'',imageModel:'',imageBaseUrl:'',imageApiKey:'',aspect:'square',imageGenerationEnabled:false,autoImages:false,proseSize:'medium'};
const modelChecks={isTextProvider:x=>['custom','local','none'].includes(x),isLocalTextModelId:x=>x==='fixture',localModelContextWindow:()=>65536};
const types=loadReviewModule(path('types.ts'));
function fixture(t,config=defaultConfig()) {
  const db = new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY,value_json TEXT); CREATE TABLE campaigns (id TEXT PRIMARY KEY, settings_json TEXT);');
  for(const id of ['A','B'])db.prepare('INSERT INTO campaigns VALUES(?,?)').run(id,JSON.stringify(defaults));
  const adapter=sqliteAdapter(db); let failWrite=false;
  const store={getAppSetting:(key,fallback)=>{const row=db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);return row?JSON.parse(row.value_json):fallback;},
    setAppSetting:(key,value)=>{if(failWrite&&key===runtime.GLOBAL_MODEL_RUNTIME_KEY)throw Error('fixture snapshot write failed');db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));},
    getGlobalConfig:()=>store.getAppSetting('global_config',config),saveGlobalConfig:patch=>{const current=store.getGlobalConfig();const next={...current,...patch,text:{...current.text,...patch.text}};store.setAppSetting('global_config',next);return next;}};
  const settings=loadReviewModule(path('db/settings.ts'),{'@/lib/runtime-defaults':{configuredDefaultStorySettings:()=>defaults},'@/lib/text-models':modelChecks,'@/lib/types':types,'@/lib/model-runtime':runtime});
  const campaigns={updateStorySettings:(id,patch)=>{const row=db.prepare('SELECT settings_json FROM campaigns WHERE id=?').get(id);if(!row)return null;const next=settings.normalizeSettings({...JSON.parse(row.settings_json),...patch});db.prepare('UPDATE campaigns SET settings_json=? WHERE id=?').run(JSON.stringify(next),id);return next;}};
  const profiles=loadReviewModule(path('db/llm-profiles.ts'),{'@/lib/db/core':{getDatabase:()=>adapter,nowIso:()=>new Date().toISOString()},'@/lib/db/app-settings':store,
    '@/lib/schemas/llm-profile':{llmProfileSchema:{safeParse:data=>({success:true,data}),parse:data=>data},maskLlmProfile:({apiKey,...rest})=>({...rest,hasApiKey:!!apiKey})},
    '@/lib/schemas/global-config':{DEFAULT_GLOBAL_CONFIG:defaultConfig()},'@/lib/db/campaigns':campaigns,'@/lib/provider-auth/core.mjs':{profileHasChanged:(a,b)=>JSON.stringify([a.baseUrl,a.model,a.contextLimit])!==JSON.stringify([b.baseUrl,b.model,b.contextLimit])},'@/lib/model-runtime':runtime});
  return {db,store,settings,profiles,failRuntimeWrite:()=>failWrite=true,readCampaign:id=>JSON.parse(db.prepare('SELECT settings_json FROM campaigns WHERE id=?').get(id).settings_json)};
}
function client({config=defaultConfig(),env={},storedRuntime=null,fetchImpl=async()=>Response.json({choices:[{message:{content:'ok'}}]})}={}) {
  const calls=[];
  const module=loadReviewModule(path('model-client.ts'),{
    '@/lib/db/app-settings':{getGlobalConfig:()=>config,getAppSetting:()=>storedRuntime},
    '@/lib/dm/sampling-logic':{describeEndpoint:base=>({allowLocalOnlySamplers:!base.includes('openai.com'),sendZeroPresencePenalty:!base.includes('openai.com'),allowTemplateKwargs:!base.includes('openai.com'),maxTokensField:base.includes('openai.com')?'max_completion_tokens':'max_tokens'}),profileById:()=>({}),resolveSampling:({configured})=>({temperature:0.7,...configured}),unsupportedParamFromError:text=>/Unsupported parameter: (\w+)/.exec(text)?.[1]},
    '@/lib/dm/context-probe-logic':{buildPropsUrl:base=>base+'/props',contextCacheKey:(base,model)=>base+'|'+model,readContextWindow:value=>value.n_ctx},
    '@/lib/server-env':{serverEnv:(key,fallback='')=>env[key]??fallback},'@/lib/text-models':modelChecks,'@/lib/model-runtime':runtime,
    '@/lib/url-guard':{secureEndpointFetch:async(url,init)=>{calls.push({url,init,payload:init.body?JSON.parse(init.body):undefined});return fetchImpl(url,init,calls.length);}},
  });return {...module,calls};
}

test('runtime snapshot contains no secrets and requires its exact endpoint/model',()=>{
  const raw={...snapshot(),apiKey:'secret',nested:{token:'secret'}};
  assert.equal(runtime.normalizeModelRuntime(raw,'http://provider.test/v1/','fixture').contextLimit,8192);
  assert.ok(!JSON.stringify(runtime.normalizeModelRuntime(raw,'http://provider.test/v1','fixture')).includes('secret'));
  for(const [base,model] of [['http://other.test/v1','fixture'],['http://provider.test/v1','other']])assert.equal(runtime.normalizeModelRuntime(raw,base,model),null);
  for(const value of [0,-1,NaN,Infinity,'8192',1.2])assert.equal(runtime.normalizeModelRuntime({...raw,contextLimit:value},raw.baseUrl,raw.model),null);
});
test('two profiles at the same target keep independent campaign contexts and output caps',t=>{
  const f=fixture(t);
  for(const [id,contextLimit,maxOutputTokens] of [['small',8192,1024],['large',131072,8192]])f.profiles.createLlmProfile({id,name:id,baseUrl:defaults.customBaseUrl,model:'fixture',contextLimit,maxOutputTokens,contextVerified:true,thinking:'auto',protocol:'openai-compatible',kind:'custom',authMode:'none'});
  f.profiles.applyLlmProfileToCampaign('small','A');f.profiles.applyLlmProfileToCampaign('large','B');
  const api=client();
  assert.equal(api.storyContextTokens(f.readCampaign('A')),8192);assert.equal(api.storyContextTokens(f.readCampaign('B')),131072);
  f.profiles.updateLlmProfile('small',{contextLimit:4096});
  assert.equal(api.storyContextTokens(f.readCampaign('A')),8192,'editing saved profile cannot silently change an applied campaign');
  f.profiles.applyLlmProfileToCampaign('small','A');assert.equal(api.storyContextTokens(f.readCampaign('A')),4096);
  assert.equal(api.storyContextTokens(f.readCampaign('B')),131072);
  f.profiles.deleteLlmProfile('large');assert.equal(api.storyContextTokens(f.readCampaign('B')),131072,'deleting a saved profile does not invalidate its applied snapshot');
});
test('global backend and runtime snapshot commit together or both roll back in SQLite',t=>{
  const f=fixture(t);const p=f.profiles.createLlmProfile({name:'large',baseUrl:defaults.customBaseUrl,model:'fixture',contextLimit:131072,maxOutputTokens:5000,contextVerified:true,thinking:'off',protocol:'openai-compatible',kind:'custom',authMode:'api-key',apiKey:'secret'});
  f.profiles.applyLlmProfileToGlobal(p.id);
  const before=f.store.getGlobalConfig();const stored=f.store.getAppSetting(runtime.GLOBAL_MODEL_RUNTIME_KEY);
  assert.equal(stored.contextLimit,131072);assert.ok(!JSON.stringify(stored).includes('secret'));assert.equal(before.text.maxOutputTokens,5000);
  f.profiles.updateLlmProfile(p.id,{model:'new-model',contextLimit:8192});f.failRuntimeWrite();
  assert.throws(()=>f.profiles.applyLlmProfileToGlobal(p.id),/snapshot write failed/);
  assert.deepEqual(f.store.getGlobalConfig(),before);assert.deepEqual(f.store.getAppSetting(runtime.GLOBAL_MODEL_RUNTIME_KEY),stored);
});
test('settings preserve matching snapshots, clear incompatible ones and scrub injected secrets',t=>{
  const f=fixture(t);const settings={...defaults,modelRuntime:{...snapshot(),apiKey:'leak'},customApiKey:'secret',utilityApiKey:'secret',imageApiKey:'secret'};
  assert.equal(f.settings.normalizeSettings(settings).modelRuntime.contextLimit,8192);
  assert.equal(f.settings.normalizeSettings({...settings,customModel:'other'}).modelRuntime,null);
  assert.equal(f.settings.normalizeSettings({...settings,textProvider:'local'}).modelRuntime,null);
  for(const projection of [f.settings.scrubStorySettings(settings),f.settings.maskStorySettings(settings)])assert.ok(!JSON.stringify(projection).includes('secret')&&!JSON.stringify(projection).includes('leak'));
});
test('new campaign defaults inherit only the explicitly applied matching global snapshot',t=>{
  const f=fixture(t);f.store.setAppSetting(runtime.GLOBAL_MODEL_RUNTIME_KEY,snapshot({contextLimit:65536}));
  const mod=loadReviewModule(path('runtime-defaults.ts'),{'@/lib/db/app-settings':f.store,'@/lib/defaults':{DEFAULT_STORY_SETTINGS:defaults},'@/lib/server-env':{serverEnv:(_k,v='')=>v},'@/lib/text-models':modelChecks,'@/lib/types':types,'@/lib/model-runtime':runtime});
  assert.equal(mod.configuredDefaultStorySettings().modelRuntime.contextLimit,65536);
  f.store.saveGlobalConfig({text:{customModel:'different'}});assert.equal(mod.configuredDefaultStorySettings().modelRuntime,null);
  f.store.saveGlobalConfig({text:{provider:'none'}});const none=mod.configuredDefaultStorySettings();assert.equal(none.modelRuntime,null);assert.equal(none.customBaseUrl,'');
});
test('environment and backend measurements cap, never enlarge, an explicitly smaller context',async()=>{
  const api=client({env:{OPENAI_COMPAT_CONTEXT:'65536'},fetchImpl:async()=>Response.json({n_ctx:32768})});
  const settings={...defaults,modelRuntime:snapshot()};
  assert.equal(api.storyContextTokens(settings),8192);
  assert.equal(api.storyContextTokens({...settings,modelRuntime:snapshot({contextLimit:131072})}),65536);
  await api.probeCustomContextWindow(defaults.customBaseUrl,'','fixture');
  assert.equal(api.storyContextTokens({...settings,modelRuntime:snapshot({contextLimit:131072})}),32768);
  assert.equal(api.storyContextTokens(settings),8192);
  assert.equal(client().storyContextTokens(defaults),16384);
});
test('sub-2048 declared contexts are not silently increased to a fallback',()=>{
  assert.equal(client().storyContextTokens({...defaults,modelRuntime:snapshot({contextLimit:1024})}),1024);
});
test('request budget accounts for tools, UTF-8 text, framing and image allowance without mutating input',()=>{
  const original=structuredClone(messages);
  const base=runtime.requestBudget(messages,undefined,8192,16384);const withTools=runtime.requestBudget(messages,tools,8192,16384);
  assert.ok(withTools.estimatedInputTokens>base.estimatedInputTokens);
  assert.equal(withTools.estimatedInputTokens+withTools.maxOutputTokens,8192);
  const image=runtime.requestBudget([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'a'.repeat(500000)}}]}],undefined,8192,1024);
  assert.ok(image.estimatedInputTokens<4096);assert.deepEqual(messages,original);
  assert.throws(()=>runtime.requestBudget(messages,tools,10,1024),runtime.ModelContextError);
});
test('custom transport sends the bounded output cap and rejects oversized input before network',async()=>{
  const api=client();
  const result=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages,{contextTokens:1024,maxOutputTokens:16384,tools});
  assert.equal(result.message.content,'ok');const sent=api.calls[0].payload;
  assert.equal(sent.max_tokens,runtime.requestBudget(messages,tools,1024,16384).maxOutputTokens);
  const tooBig=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',[{role:'user',content:'X'.repeat(9000)}],{contextTokens:1024});
  assert.equal(tooBig.error.status,400);assert.equal((await tooBig.error.json()).error,'MODEL_CONTEXT_EXCEEDED');assert.equal(api.calls.length,1);
});
test('SSE fragmented tool arguments and unicode prose are assembled without losing call IDs',async()=>{
  const deltas=[{content:'Привет '},{content:'świecie',tool_calls:[{index:0,id:'call-A',function:{name:'probe_',arguments:'{"word":'}}]},{tool_calls:[{index:0,function:{name:'echo',arguments:'"куб"}'}}]}];
  const api=client({fetchImpl:async()=>new Response(deltas.map(delta=>'data: '+JSON.stringify({choices:[{delta}]})+'\n\n').join('')+'data: [DONE]\n')});const visible=[];
  const result=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages,{onDelta:x=>visible.push(x)});
  assert.equal(result.message.content,'Привет świecie');assert.deepEqual(visible,['Привет ','świecie']);
  assert.deepEqual(result.message.tool_calls,[{id:'call-A',type:'function',function:{name:'probe_echo',arguments:'{"word":"куб"}'}}]);
});
test('non-streaming compatible responses preserve opaque tool metadata',async()=>{
  const message={role:'assistant',content:null,tool_calls:[{id:'opaque',type:'function',function:{name:'probe_echo',arguments:'{}'},extra_content:{google:{thought_signature:'fixture'}}}]};
  const api=client({fetchImpl:async()=>Response.json({choices:[{message}]})});
  assert.deepEqual((await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages)).message,message);
});
test('compatible retries preserve an output bound and stop when both field names are rejected',async()=>{
  const api=client({fetchImpl:async(_url,init)=>new Response('Unsupported parameter: '+('max_tokens' in JSON.parse(init.body)?'max_tokens':'max_completion_tokens'),{status:400})});
  const result=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages);
  assert.equal(result.error.status,502);assert.equal(api.calls.length,2);
  assert.ok(api.calls.every(call=>Number.isInteger(call.payload.max_tokens??call.payload.max_completion_tokens)));
});
test('unsupported parameter retry is bounded, tool fallback does not drop the output cap',async()=>{
  const api=client({fetchImpl:async(_u,_i,n)=>n===1?new Response('Unsupported parameter: temperature',{status:400}):n===2?new Response('does not support tools',{status:400}):Response.json({choices:[{message:{content:'ok'}}]})});
  const result=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages,{tools});
  assert.equal(result.message.content,'ok');assert.equal(api.calls.length,3);
  assert.equal(api.calls[1].payload.temperature,undefined);assert.equal(api.calls[2].payload.tools,undefined);
  assert.ok(api.calls.every(call=>call.payload.max_tokens>0));
});
test('vision fallback retains text while dropping unsupported images',async()=>{
  const api=client({fetchImpl:async(_u,_i,n)=>n===1?new Response('missing mmproj image input',{status:400}):Response.json({choices:[{message:{content:'ok'}}]})});
  await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',[{role:'user',content:[{type:'text',text:'Hero portrait'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}]);
  assert.equal(api.calls[1].payload.messages[0].content,'Hero portrait');assert.equal(api.calls.length,2);
});
test('global, utility and OpenRouter credentials never attach to another endpoint',async()=>{
  const config=defaultConfig();config.text.customApiKey='global-key';config.text.utilityBaseUrl='http://utility.test/v1';config.text.utilityApiKey='utility-key';
  const api=client({config,env:{OPENROUTER_API_KEY:'router-key'}});
  for(const base of ['http://provider.test/v1','http://utility.test/v1','https://evil.test/openrouter.ai','https://openrouter.ai.evil.test/v1','https://openrouter.ai/api/v1'])await api.requestCustomMessage(base,'fixture','',messages);
  assert.deepEqual(api.calls.map(call=>call.init.headers.Authorization),['Bearer global-key','Bearer utility-key',undefined,undefined,'Bearer router-key']);
  await api.requestCustomMessage('http://other.test/v1','fixture','per-campaign-key',messages);assert.equal(api.calls.at(-1).init.headers.Authorization,'Bearer per-campaign-key');
});
test('native Ollama uses the same cap, preserves tool replies and extracts image payload',async()=>{
  const api=client({fetchImpl:async()=>Response.json({message:{content:'ok'}})});
  const inputs=[...messages,{role:'user',content:[{type:'text',text:'image'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}];
  const result=await api.requestLocalMessage('fixture',inputs,{contextTokens:8192,maxOutputTokens:2000});
  assert.equal(result.message.content,'ok');const sent=api.calls[0].payload;
  assert.equal(sent.options.num_ctx,8192);assert.equal(sent.options.num_predict,2000);assert.equal(sent.think,false);assert.equal(sent.stream,false);assert.equal(sent.keep_alive,'30m');
  assert.deepEqual(sent.messages[1].images,['AAAA']);
});
test('Ollama NDJSON and think/tools fallbacks retain correct output',async()=>{
  const api=client({fetchImpl:async(_u,_i,n)=>n===1?new Response('does not support tools',{status:400}):n===2?new Response('does not support think',{status:400}):new Response('{"message":{"content":"A"}}\n{"message":{"content":"B","tool_calls":[{"function":{"name":"x","arguments":{}}}]}}\n')});
  const deltas=[];const result=await api.requestLocalMessage('fixture',messages,{tools,onDelta:x=>deltas.push(x)});
  assert.equal(result.message.content,'AB');assert.equal(result.message.tool_calls[0].function.name,'x');assert.deepEqual(deltas,['A','B']);
  assert.equal(api.calls[2].payload.think,undefined);assert.equal(api.calls[2].payload.tools,undefined);
});
test('malformed stream index and upstream errors become failures rather than valid narration',async()=>{
  for(const data of [{choices:[{delta:{tool_calls:[{index:9999999999,function:{name:'x'}}]}}]},{error:{message:'fixture failure'}}]){
    const api=client({fetchImpl:async()=>new Response('data: '+JSON.stringify(data)+'\n')});
    const result=await api.requestCustomMessage(defaults.customBaseUrl,'fixture','',messages);assert.equal(result.error.status,502);
  }
});
test('DM routing passes the applied per-campaign limits to both compatible and strict clients',async()=>{
  const clientModule=client();const sent=[];
  const mod=loadReviewModule(path('dm/model.ts'),{'@/lib/model-client':{...clientModule,requestCustomMessage:async(...args)=>{sent.push(['custom',args.at(-1)]);return {message:{content:'ok'}};},requestLocalMessage:async(...args)=>{sent.push(['local',args.at(-1)]);return {message:{content:'ok'}};}},
    '@/lib/provider-auth/cloud-client.mjs':{isStrictCloudEndpoint:base=>base.includes('strict')},'@/lib/provider-auth/cloud':{requestStrictCloudMessage:async(...args)=>{sent.push(['strict',args.at(-1)]);return {message:{content:'ok'}};}},'@/lib/model-runtime':runtime,'@/lib/db/app-settings':{getGlobalConfig:defaultConfig}});
  await mod.requestDmMessage({...defaults,modelRuntime:snapshot({contextLimit:4096,maxOutputTokens:1000,thinking:'off',timeoutMs:60000})},messages,{tools,thinking:true});
  const strictBase='https://strict.test/v1';await mod.requestDmMessage({...defaults,customBaseUrl:strictBase,modelRuntime:snapshot({baseUrl:strictBase,contextLimit:131072,maxOutputTokens:5000})},messages,{tools});
  assert.equal(sent[0][1].contextTokens,4096);assert.equal(sent[0][1].maxOutputTokens,1000);assert.equal(sent[0][1].thinking,false);assert.equal(sent[0][1].timeoutMs,60000);
  assert.equal(sent[1][0],'strict');assert.equal(sent[1][1].contextTokens,131072);assert.equal(sent[1][1].maxOutputTokens,5000);
});
test('strict cloud wrapper preserves the already resolved request output cap',async()=>{
  let options;
  const mod=loadReviewModule(path('provider-auth/cloud.ts'),{'@/lib/db/app-settings':{getGlobalConfig:defaultConfig,getAppSetting:(_k,f)=>f,setAppSetting(){}},'@/lib/server-env':{serverEnv:()=>''},'./cloud-client.mjs':{requestCloudCompletion:async(_target,_messages,o)=>{options=o;return {message:{content:'ok'}};}},'./connections.mjs':{chatUrl:x=>x},'./core.mjs':{ProviderError:class extends Error{},publicError:()=> 'error'}});
  await mod.requestStrictCloudMessage('https://strict.test/v1','fixture','',messages,{maxOutputTokens:1234,contextTokens:8192});
  assert.equal(options.maxOutputTokens,1234);assert.equal(options.contextTokens,8192);
});
