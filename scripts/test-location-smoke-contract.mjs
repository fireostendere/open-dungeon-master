// Tests the smoke's assertions/control flow, not Chromium or the application.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreparedLocationSmoke, assertLocalTarget } from './e2e/location-privacy.e2e.mjs';
function fixture({ outsiderStatus=404, bStatus=404, leak=false, omitPositive=false, native=false }={}) {
  const opened=[],closed=[],calls=[];
  const response=(status,payload)=>({status:()=>status,json:async()=>payload,text:async()=>JSON.stringify(payload)});
  const browser={newContext:async ({storageState:role})=>{
    opened.push(role);
    return {close:async()=>closed.push(role),request:{get:async url=>{
      calls.push([role,url]);
      if(role==='OUTSIDER')return response(outsiderStatus,{});
      if(url.endsWith('/location-chat'))return response(200,{enabled:true,current:{roomId:role==='A'?'tavern':'street'}});
      if(url.includes('/location-chat?'))return role==='B'?response(bStatus,{messages:leak?['SECRET']:[]}):response(200,{messages:omitPositive?[]:['SECRET']});
      return response(200,{});
    }},newPage:async()=>({goto:async()=>{},getByTestId:()=>({waitFor:async()=>{}}),evaluate:async()=>{if(!native)throw new Error('Native unavailable');return {current:{roomId:'tavern'}};}})};
  }};
  return {browser,opened,closed,calls,options:{browser,baseUrl:'http://127.0.0.1:3010',campaignId:'c',marker:'SECRET',states:{DM:'DM',A:'A',B:'B',OUTSIDER:'OUTSIDER'},requireNativeWebMcp:false}};
}
test('R11: a correct outsider 404 is accepted instead of contradictorily demanding 200',async()=>{
  const f=fixture();const result=await runPreparedLocationSmoke(f.options);
  assert.equal(result.fullAcceptance,false);assert.equal(f.opened.length,4);assert.equal(f.closed.length,4);
  assert.ok(f.calls.some(([role,url])=>role==='A'&&url.includes('/location-chat?')));
});
test('R11: outsider 200 is an access leak, not a passing fixture',async()=>{
  const f=fixture({outsiderStatus:200});await assert.rejects(runPreparedLocationSmoke(f.options),/Outsider must be denied/);assert.equal(f.closed.length,4);
});
test('R11: B with a retained archive may receive 200 but not the unwitnessed secret',async()=>{
  const f=fixture({bStatus:200});await runPreparedLocationSmoke(f.options);
  const leaky=fixture({bStatus:200,leak:true});await assert.rejects(runPreparedLocationSmoke(leaky.options),/unwitnessed/);
});
test('R11: empty panels everywhere cannot pass without an authorized positive control',async()=>{
  const f=fixture({omitPositive:true});await assert.rejects(runPreparedLocationSmoke(f.options),/positive control/);
});
test('R11: native WebMCP absence fails when native testing is required',async()=>{
  const f=fixture();await assert.rejects(runPreparedLocationSmoke({...f.options,requireNativeWebMcp:true}),/Native unavailable/);
});
test('R11: a native-read smoke still does not claim MCP transport/full acceptance',async()=>{
  const f=fixture({native:true});const result=await runPreparedLocationSmoke({...f.options,requireNativeWebMcp:true});
  assert.equal(result.checks.length,3);assert.equal(result.fullAcceptance,false);assert.ok(result.notCovered.includes('MCP transport tool calls'));
});
test('R11: production origins and credential-bearing URLs are refused before browser work',()=>{
  for(const url of ['https://example.com','file:///tmp/file','http://user:pass@localhost:3000','http://localhost:3000/path'])assert.throws(()=>assertLocalTarget(url));
  assert.equal(assertLocalTarget('http://127.0.0.1:3000'),'http://127.0.0.1:3000');
});
