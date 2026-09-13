import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {CodexGateway} from '../src/lib/provider-auth/codex.mjs';
class Rpc extends EventEmitter{
  constructor(){super();this.threads=[];this.results=[];this.interrupts=0;}
  async request(method,p){
    if(method==='thread/start'){this.threads.push(p);return {thread:{id:'thread-'+this.threads.length}};}
    if(method==='turn/interrupt')this.interrupts++;
    if(method==='turn/start'){const n=this.threads.length;setImmediate(()=>{
      if(n===1)this.emit('request',{id:17,method:'item/tool/call',params:{threadId:p.threadId,tool:'odm_0',arguments:{}}});
      else{this.emit('notification',{method:'item/completed',params:{threadId:p.threadId,item:{type:'agentMessage',text:'Continued from the existing engine result'}}});this.emit('notification',{method:'turn/completed',params:{threadId:p.threadId,turn:{status:'completed'}}});}
    });return {turn:{id:'turn'}};}
    return {};
  }
  reply(id,result){this.results.push({id,result});}
  replyError(){throw new Error('unexpected request');}
}
const firstTool={type:'function',function:{name:'start_encounter',parameters:{type:'object'}}};
const combatTool={type:'function',function:{name:'pc_attack',parameters:{type:'object'}}};
const original={model:'fixture',messages:[{role:'user',content:'Enter combat'}],tools:[firstTool]};
async function turn(){const rpc=new Rpc(),g=new CodexGateway(rpc,{cwd:'/isolated'});const first=await g.complete(original);return {rpc,g,first,history:[...original.messages,first.choices[0].message,{role:'tool',tool_call_id:first.choices[0].message.tool_calls[0].id,content:'{"encounterId":"saved","initiative":17}'}]};}
test('combat registry transition preserves real tool result exactly once',async()=>{
  const {rpc,g,history}=await turn();const answer=await g.complete({...original,messages:history,tools:[combatTool]});
  assert.match(answer.choices[0].message.content,/existing engine/);assert.equal(rpc.results.length,1);assert.equal(rpc.results[0].result.success,true);assert.match(rpc.results[0].result.contentItems[0].text,/initiative/);
  assert.equal(rpc.threads.length,2);assert.match(rpc.threads[1].dynamicTools[0].description,/pc_attack/);assert.equal(rpc.interrupts,1);assert.equal(g.calls.size,0);assert.equal(g.sessions.size,0);
});
test('authoritative map update after a parked roll starts a fresh context',async()=>{
  const {rpc,g,history}=await turn();const answer=await g.complete({...original,messages:[...history,{role:'user',content:'[GAME STATE UPDATE] positions changed'}],tool_choice:'none'});
  assert.equal(answer.choices[0].finish_reason,'stop');assert.equal(rpc.results.length,1);assert.equal(rpc.threads[1].dynamicTools.length,0);assert.equal(g.calls.size,0);
});
