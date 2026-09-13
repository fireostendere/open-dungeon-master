import test from 'node:test';
import assert from 'node:assert/strict';
import {isStrictCloudEndpoint,requestCloudCompletion} from '../src/lib/provider-auth/cloud-client.mjs';
const target={baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',model:'fixture-gemini',apiKey:'private-fixture-key'};
const tools=[{type:'function',function:{name:'roll_dice',parameters:{type:'object'}}}];
const messages=[{role:'user',content:'Roll a d20'}];
test('strict endpoint allowlist excludes host spoofing and local services',()=>{
  assert.equal(isStrictCloudEndpoint(target.baseUrl),true);assert.equal(isStrictCloudEndpoint('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),true);
  for(const url of ['http://localhost/v1','https://generativelanguage.googleapis.com.evil.test/v1','https://evil.test/?googleapis.com','http://generativelanguage.googleapis.com/v1'])assert.equal(isStrictCloudEndpoint(url),false);
});
test('Gemini thought signature survives the actual ODM field-stripping tool loop',async()=>{
  let store={},count=0;const deps={read:()=>store,write:s=>{store=s;},fetchImpl:async(url,init)=>{
    const b=JSON.parse(init.body);assert.equal(url,target.baseUrl);assert.equal(b.chat_template_kwargs,undefined);assert.equal(b.top_k,undefined);assert.equal(b.presence_penalty,undefined);
    if(!count++){return Response.json({choices:[{message:{role:'assistant',content:null,reasoning_content:'vendor-private',tool_calls:[{id:'vendor-call',type:'function',function:{name:'roll_dice',arguments:'{"sides":20}'},extra_content:{google:{thought_signature:'opaque-signature'}}}]}}]});}
    assert.equal(b.messages[1].tool_calls[0].extra_content.google.thought_signature,'opaque-signature');assert.equal(b.messages[1].reasoning_content,'vendor-private');assert.equal(b.messages[2].tool_call_id,'vendor-call');assert.equal(b.messages[2].content,'{"total":17}');
    return Response.json({choices:[{message:{content:'Your roll is 17.'}}]});
  }};
  const first=await requestCloudCompletion(target,messages,{tools},deps);
  assert.ok(!JSON.stringify(first).includes('opaque-signature'));assert.ok(!JSON.stringify(first).includes('vendor-private'));
  const call=first.message.tool_calls[0];
  const second=await requestCloudCompletion(target,[...messages,{role:'assistant',content:'',tool_calls:[call]},{role:'tool',tool_call_id:call.id,content:'{"total":17}'}],{tools,toolChoice:'none'},deps);
  assert.match(second.message.content,/17/);
});
test('cloud metadata persists across transport instances but not across account keys',async()=>{
  let store={};const deps={read:()=>store,write:s=>{store=JSON.parse(JSON.stringify(s));},fetchImpl:async()=>Response.json({choices:[{message:{tool_calls:[{id:'call',type:'function',function:{name:'roll_dice',arguments:'{}'}}]}}]})};
  const first=await requestCloudCompletion(target,messages,{tools},deps);const call=first.message.tool_calls[0];
  const history=[...messages,{role:'assistant',content:'',tool_calls:[call]},{role:'tool',tool_call_id:call.id,content:'17'}];
  await assert.rejects(requestCloudCompletion({...target,apiKey:'different'},history,{tools},deps),/WRONG_PROVIDER/);
  const changed=structuredClone(history);changed[1].tool_calls[0].function.arguments='{"changed":true}';await assert.rejects(requestCloudCompletion(target,changed,{tools},deps),/HISTORY_CHANGED/);
});
test('upstream keys and error bodies never appear in errors',async()=>{
  await assert.rejects(requestCloudCompletion(target,messages,{}, {fetchImpl:async()=>new Response('private-fixture-key',{status:401})}),error=>error.message==='CLOUD_AUTHENTICATION_FAILED');
  await assert.rejects(requestCloudCompletion({...target,apiKey:''},messages),/API_KEY_REQUIRED/);
});
