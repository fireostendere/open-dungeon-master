// Real official Codex executable, fresh isolated HOME, no login and no model call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexRpc} from '../../src/lib/provider-auth/rpc.mjs';
import {codexLaunchArgs} from '../../src/lib/provider-auth/codex.mjs';
import {codexEnvironment} from '../../src/lib/provider-auth/storage.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-real-codex-'));
const {cwd,env}=codexEnvironment(dir);
const binary=process.env.ODM_SMOKE_CODEX_BINARY||'codex';
const script=/\.m?js$/i.test(binary);
const rpc=new CodexRpc({command:script?process.execPath:binary,args:script?[binary,...codexLaunchArgs()]:codexLaunchArgs(),cwd,env,timeoutMs:15000});
try{
  const schemasDir=path.join(dir,'schemas');fs.mkdirSync(schemasDir);
  await rpc.initialize();const account=await rpc.request('account/read',{refreshToken:false});
  assert.equal(account.account,null,'test must not inherit any personal login');
  // thread/start validates the native tool schema before any paid inference.
  const result=await rpc.request('thread/start',{model:'gpt-5',cwd,sandbox:'read-only',approvalPolicy:'on-request',ephemeral:true,dynamicTools:[{name:'odm_smoke',description:'Offline schema validation only',inputSchema:{type:'object',properties:{n:{type:'integer'}},required:['n'],additionalProperties:false}}]});
  assert.ok(result.thread?.id);console.log('PASS: official Codex initialize, isolated account/read, native dynamic-tool thread/start; no model request or login.');
}finally{rpc.close();await new Promise(r=>setTimeout(r,200));fs.rmSync(dir,{recursive:true,force:true});}
