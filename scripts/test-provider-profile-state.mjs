// Database regression tests against an isolated encrypted temporary SQLite DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {register} from 'node:module';
import {removeTempDir} from './lib/remove-temp-dir.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'odm-profile-state-'));
process.env.SQLITE_DB_PATH=path.join(dir,'test.sqlite');process.env.DB_ENCRYPTION_KEY=randomBytes(32).toString('hex');process.chdir(dir);
register('./lib/register-alias.mjs',import.meta.url);
const {createLlmProfile,getLlmProfile,updateLlmProfile,updateLlmProfileCheck,applyLlmProfileToGlobal}=await import('../src/lib/db/llm-profiles.ts');
const {getGlobalConfig}=await import('../src/lib/db/app-settings.ts');
const base={name:'Connection',kind:'custom',protocol:'openai-compatible',baseUrl:'http://localhost:1234/v1',model:'fixture',authMode:'none'};
const check={at:new Date().toISOString(),ok:true,stages:{chat:{ok:true},tool_call:{ok:true},tool_result:{ok:true}}};
let count=0;
try{
  const a=createLlmProfile(base);updateLlmProfileCheck(a.id,check);updateLlmProfile(a.id,{name:'Renamed'});assert.equal(getLlmProfile(a.id).lastCheck.ok,true);count++;
  updateLlmProfile(a.id,{model:'another'});assert.equal(getLlmProfile(a.id).lastCheck,null);count++;
  assert.equal(updateLlmProfileCheck(a.id,check,a),null);assert.equal(getLlmProfile(a.id).lastCheck,null);count++;
  const snapshot=getLlmProfile(a.id);assert.equal(updateLlmProfileCheck(a.id,check,snapshot).lastCheck.ok,true);count++;
  updateLlmProfile(a.id,{apiKey:'new-fixture'});assert.equal(getLlmProfile(a.id).lastCheck,null);count++;
  const tuned=createLlmProfile({...base,sampling:{temperature:1.3,top_p:0.5}});applyLlmProfileToGlobal(tuned.id);assert.equal(getGlobalConfig().sampling.story.temperature,1.3);
  const clean=createLlmProfile({...base,name:'Clean'});applyLlmProfileToGlobal(clean.id);assert.notEqual(getGlobalConfig().sampling.story.temperature,1.3);count++;
  console.log(`Provider profile-state regression: ${count} passed.`);
}finally{removeTempDir(dir);}
