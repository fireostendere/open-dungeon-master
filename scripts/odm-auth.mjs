#!/usr/bin/env node
// Local admin CLI. Provider secrets are read from stdin, never command arguments.
import fs from 'node:fs';
import { authRoot,readOrCreateSecret } from '../src/lib/provider-auth/storage.mjs';
import { loopbackOrigin,publicError,ProviderError } from '../src/lib/provider-auth/core.mjs';
for(const file of ['.env.local','.env','.env.server'])if(fs.existsSync(file))process.loadEnvFile(file);
const args=process.argv.slice(2);
const help=`ODM authentication (run from the repository root):
  node scripts/odm-auth.mjs login chatgpt [--device|--browser]
  node scripts/odm-auth.mjs status chatgpt
  node scripts/odm-auth.mjs models chatgpt
  node scripts/odm-auth.mjs logout chatgpt
  node scripts/odm-auth.mjs connect chatgpt --model MODEL [--apply]
  node scripts/odm-auth.mjs models qwen-local [--base-url URL]
  node scripts/odm-auth.mjs connect qwen-local --model MODEL [--base-url URL] [--apply]
  node scripts/odm-auth.mjs connect gemini --model MODEL --key-stdin [--apply]
  node scripts/odm-auth.mjs connect qwen --model MODEL --key-stdin [--region international|china|token-plan] [--apply]
Set ODM_LOCAL_ORIGIN for a non-default server port. Otherwise ports 3005 and 3000 are checked.
The official login must be completed by you in your browser. No browser cookies are copied.
`;
const flag=name=>args.includes(name);
function option(name){const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new ProviderError('OPTION_VALUE_REQUIRED');return args[i+1];}
async function readKey(){let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>402)throw new ProviderError('API_KEY_TOO_LONG');}return text.trim();}
async function main(){
  if(!args.length||flag('--help')){console.log(help);return;}
  if(!fs.existsSync('package.json')||!fs.existsSync('src/lib/db/llm-profiles.ts'))throw new ProviderError('RUN_FROM_ODM_REPOSITORY_ROOT');
  const action=args[0],provider=args[1]??'chatgpt';
  if(!['login','status','models','logout','connect'].includes(action))throw new ProviderError('UNKNOWN_COMMAND');
  if(flag('--api-key')||flag('--key'))throw new ProviderError('USE_KEY_STDIN_NOT_COMMAND_ARGUMENT');
  let origin=process.env.ODM_LOCAL_ORIGIN?loopbackOrigin(process.env.ODM_LOCAL_ORIGIN):null;
  if(!origin)for(const candidate of [loopbackOrigin(`http://127.0.0.1:${process.env.PORT||3005}`),'http://127.0.0.1:3000']){
    try{const r=await fetch(`${candidate}/api/health`,{redirect:'error',signal:AbortSignal.timeout(1500)});if(r.ok){origin=candidate;break;}}catch{}
  }
  if(!origin)throw new ProviderError('ODM_SERVER_NOT_RUNNING');
  const secret=readOrCreateSecret(authRoot(),'control.key');
  async function call(body){
    let response;try{response=await fetch(`${origin}/api/internal/provider-control`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body),signal:AbortSignal.timeout(action==='connect'?650000:45000)});}catch{throw new ProviderError('ODM_SERVER_UNREACHABLE_OR_TIMED_OUT');}
    const result=await response.json();if(!response.ok)throw new ProviderError(typeof result.error==='string'?result.error:'ODM_REQUEST_FAILED',response.status);return result;
  }
  if(action==='login'){
    if(provider!=='chatgpt')throw new ProviderError('USE_API_KEY_OR_LOCAL_RUNTIME_FOR_THIS_PROVIDER');
    if(flag('--browser')&&flag('--device'))throw new ProviderError('SELECT_ONE_LOGIN_MODE');
    const login=await call({action,provider,mode:flag('--browser')?'browser':'device'});
    console.log(`Откройте в браузере: ${login.authUrl}`);if(login.userCode)console.log(`Код устройства: ${login.userCode}`);
    let interrupted=false;
    const cancel=async()=>{interrupted=true;await call({action:'cancel',provider,operationId:login.operationId}).catch(()=>{});};process.once('SIGINT',cancel);
    try{
      while(!interrupted&&Date.now()<login.expiresAt){await new Promise(r=>setTimeout(r,2000));const status=await call({action:'status',provider});if(status.authenticated){console.log('ChatGPT подключён. Выполните models, затем connect с точным ID модели.');return;}if(!status.login)throw new ProviderError('LOGIN_FAILED_CANCELLED_OR_EXPIRED');}
      if(!interrupted)await call({action:'cancel',provider,operationId:login.operationId}).catch(()=>{});
      throw new ProviderError(interrupted?'LOGIN_CANCELLED':'LOGIN_EXPIRED');
    }finally{process.removeListener('SIGINT',cancel);}
  }
  const body={action,provider};
  if(action==='connect'||action==='models'){body.model=option('--model');body.apply=flag('--apply');body.baseUrl=option('--base-url');body.region=option('--region');if(flag('--key-stdin'))body.apiKey=await readKey();}
  const result=await call(body);console.log(JSON.stringify(result,null,2));if(result.report&&!result.report.ok)process.exitCode=2;
}
main().catch(error=>{console.error(publicError(error));process.exitCode=1;});
