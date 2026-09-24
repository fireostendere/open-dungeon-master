import test from 'node:test';
import assert from 'node:assert/strict';
import { locationWebTools } from '../src/lib/spatial/web-tools.mjs';
import { LocationCommandClient } from '../src/lib/spatial/client-commands.mjs';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',roomId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('both UUID aliases produce the identical persisted command and identity guards',async()=>{
 const requests=[];const tools=locationWebTools({campaignId:'c',userId:'A',signal:new AbortController().signal,fetchImpl:async(_url,init)=>{requests.push(init);return Response.json({ok:true});}});
 const send=tools[2].execute,input={kind:'do',roomId,expectedRevision:3,content:'ONE_INTENT'};
 await send({...input,requestId});await send({...input,intentId:requestId});assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['X-ODM-Actor'],'A');assert.equal(requests[0].headers['X-ODM-Expected-User'],'A');
});
test('unknown room/revision and conflicting UUID aliases cannot trigger a request',()=>{
 let requests=0;const send=locationWebTools({campaignId:'c',userId:'A',signal:new AbortController().signal,fetchImpl:async()=>{requests++;return Response.json({});}})[2].execute;
 assert.throws(()=>send({requestId,kind:'do',content:'x'}),/roomId/);assert.throws(()=>send({requestId,kind:'do',roomId,content:'x'}),/revision/);
 assert.throws(()=>send({requestId,intentId:roomId,kind:'ooc',content:'x'}),/Conflicting/);assert.equal(requests,0);
});
test('component cleanup and per-call cancellation invalidate retained tool handles',async()=>{
 const life=new AbortController();let requests=0;const tools=locationWebTools({campaignId:'c',userId:'A',signal:life.signal,fetchImpl:async()=>{requests++;return Response.json({});}});
 const call=new AbortController();call.abort();await assert.rejects(tools[0].execute({}, {signal:call.signal}));assert.equal(requests,0);
 life.abort();await assert.rejects(tools[0].execute({}));await assert.rejects(tools[2].execute({requestId,kind:'ooc',content:'old'}));assert.equal(requests,0);
});
test('ambiguous client writes retry immutable payloads; disposed identities cannot send',async()=>{
 const sent=[];const client=new LocationCommandClient({campaignId:'c',userId:'A',uuid:()=>requestId,fetchImpl:async(_url,init)=>{sent.push(init.body);if(sent.length===1)throw new Error('lost');return Response.json({});}});
 const input={kind:'do',roomId,expectedRevision:1,content:'ORIGINAL'};await assert.rejects(client.command(input));input.content='MUTATED';await client.retry();assert.equal(sent[0],sent[1]);client.dispose();await assert.rejects(client.retry());await assert.rejects(client.command(input));
});
