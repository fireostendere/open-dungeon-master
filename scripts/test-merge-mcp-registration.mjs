// Execute the actual ESM server factory with an SDK registry double. This does
// not claim a real SDK initialize/tools/list or HTTP session has run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as path from 'node:path';
import * as url from 'node:url';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {z}=require('zod');
if(z.__mergeTestAdapter)console.log('SCHEMA DEPENDENCY: local adapter; SDK registry is an explicit test double.');
const source=fileURLToPath(new URL('../mcp/server.mjs',import.meta.url));

async function fixture(){
  const calls=[];
  class Registry {
    constructor(){this._registeredTools={};this.resources={};}
    registerTool(name,config,callback){assert.ok(!this._registeredTools[name]);return this._registeredTools[name]={config,callback};}
    registerResource(name,uri,config,callback){assert.ok(!this.resources[uri]);this.resources[uri]={name,config,callback};}
  }
  const context=vm.createContext({console,URL,Response,AbortSignal,process:{argv:['node','/test/runner.mjs'],env:{ODM_MCP_TOKEN:'isolated-test-token'},once(){}}});
  const mocked={
    'node:crypto':crypto,'node:http':http,'node:path':path,'node:url':url,
    '@modelcontextprotocol/server':{McpServer:Registry,createMcpHandler:()=>{throw Error('HTTP must not start on import');}},
    '@modelcontextprotocol/server/stdio':{serveStdio:()=>{throw Error('stdio must not start on import');}},
    '@modelcontextprotocol/node':{toNodeHandler:()=>{}},'zod/v4':z,
    './control-client.mjs':{callControl:async(action,params)=>{calls.push({action,params});return{accepted:true};},
      withMcpCancellation:callback=>(...args)=>{args.at(-1)?.mcpReq?.signal?.throwIfAborted();return callback(...args);}},
    './http-boundary.mjs':{createSafeHttpListener:()=>{throw Error('listener must not start on import');}},
  };
  const module=new vm.SourceTextModule(fs.readFileSync(source,'utf8'),{context,identifier:source,initializeImportMeta(meta){meta.url=new URL('../mcp/server.mjs',import.meta.url).href;}});
  await module.link(async name=>{const exports=mocked[name];if(!exports)throw Error('Unexpected module: '+name);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});});
  await module.evaluate();
  return{api:module.namespace,server:module.namespace.createVerifiedMcpServer({expectPreload:false}),calls};
}

test('merged server retains all base tools and exposes the fourth narrator resource',async()=>{
  const f=await fixture();
  assert.deepEqual(Object.keys(f.server._registeredTools).sort(),Array.from(f.api.BASE_MCP_TOOLS).sort());
  assert.deepEqual(Object.keys(f.server.resources).sort(),['odm://narrator/instructions','odm://narrator/playbook','odm://server/capabilities','odm://server/status']);
  assert.throws(()=>f.api.createVerifiedMcpServer(),/missing expected tool/,'preload verification must remain enforced');
});

test('answer_ask schema and dispatch retain the campaign, answer and citations',async()=>{
  const f=await fixture();const tool=f.server._registeredTools.odm_narrator;
  const request={operation:'answer_ask',campaignId:'11111111-1111-4111-8111-111111111111',askId:'22222222-2222-4222-8222-222222222222',answer:'Grounded answer',expectedSeq:12,citations:[{kind:'rule',ref:'reference',quote:'evidence'}]};
  const parsed=tool.config.inputSchema.parse(request);
  const response=await tool.callback(parsed,{});
  const {operation,...params}=request;
  // Compare the JSON wire payload, not object prototypes from different VM realms.
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{action:'narrator.answer_ask',params}]);assert.equal(response.structuredContent.accepted,true);
});

test('new narrator operation still passes through the cancellation wrapper',async()=>{
  const f=await fixture();
  await assert.rejects(async()=>f.server._registeredTools.odm_narrator.callback({operation:'answer_ask'},{mcpReq:{signal:AbortSignal.abort()}}),{name:'AbortError'});
  assert.equal(f.calls.length,0);
});

test('playbook preserves authoritative dice, drained cursors, private Ask and no automatic replay',async()=>{
  const f=await fixture();const uri='odm://narrator/playbook';const result=await f.server.resources[uri].callback(new URL(uri),{});
  const content=result.contents[0];assert.equal(content.uri,uri);assert.equal(content.mimeType,'text/markdown');
  for(const term of ['hasMore is false','NEVER automatically replay','private','askId','The server owns dice'])assert.ok(content.text.includes(term),term);
  assert.ok(!content.text.includes('isolated-test-token'));assert.equal(f.calls.length,0);
});

test('existing model probe-only operations retain apply:false on the wire',async()=>{
  const f=await fixture();
  await f.server._registeredTools.odm_models.callback({operation:'test_and_connect',provider:'qwen-local',model:'fixture',apply:false,campaignId:'11111111-1111-4111-8111-111111111111'},{});
  assert.equal(f.calls[0].params.apply,false);assert.equal(f.calls[0].action,'models.test_and_connect');
});
