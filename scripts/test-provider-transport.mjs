import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOrCreateSecret, codexEnvironment } from '../src/lib/provider-auth/storage.mjs';
import { CodexRpc } from '../src/lib/provider-auth/rpc.mjs';
function fixture(options={}) {
  const child=new EventEmitter();
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.killed=true;};
  return {child,rpc:new CodexRpc({spawnProcess:()=>child,...options})};
}
test('persistent private local secret and isolated runtime',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-provider-'));
  try {
    const key=readOrCreateSecret(dir,'control.key');
    assert.match(key,/^[a-f0-9]{64}$/);assert.equal(readOrCreateSecret(dir,'control.key'),key);
    if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'control.key')).mode&0o777,0o600);
    const r=codexEnvironment(dir);
    assert.equal(r.env.DB_ENCRYPTION_KEY,undefined);assert.equal(r.env.CODEX_HOME,path.join(dir,'codex'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('handshake accepts split JSON frames',async()=>{
  const {child,rpc}=fixture();const seen=[];let buffer='';
  child.stdin.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){
    const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);seen.push(m);
    if(m.id!==undefined){const s=JSON.stringify({id:m.id,result:{ok:true}})+'\n';child.stdout.write(s.slice(0,4));child.stdout.write(s.slice(4));}
  }});
  try {await rpc.initialize();assert.equal(seen[0].method,'initialize');assert.equal(seen[1].method,'initialized');assert.equal(rpc.pending.size,0);}
  finally {rpc.close();}
});
test('timeout clears pending state',async()=>{
  const {rpc}=fixture({timeoutMs:5});
  try{await assert.rejects(rpc.request('fixture',{}),/CODEX_RPC_TIMEOUT/);assert.equal(rpc.pending.size,0);}
  finally{rpc.close();}
});
test('malformed and oversized frames close process',()=>{
  for(const text of ['invalid\n','[]\n','x'.repeat(4*1024*1024+1)]){
    const {rpc,child}=fixture();rpc.feed(text);assert.equal(rpc.closed,true);assert.equal(child.killed,true);
  }
});
test('close rejects unfinished requests',async()=>{
  const {rpc}=fixture();const result=rpc.request('fixture',{});rpc.close();
  await assert.rejects(result,/CODEX_CLOSED/);assert.equal(rpc.pending.size,0);
  await assert.rejects(rpc.request('again',{}),/CODEX_PIPE_CLOSED/);
});
