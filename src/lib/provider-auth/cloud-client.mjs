// Strict official cloud endpoints. Opaque tool metadata stays on the server
// because ODM's mechanical tool loop deliberately echoes only public fields.
import {createHash,randomUUID} from 'node:crypto';
import {ProviderError} from './core.mjs';
import {chatUrl} from './connections.mjs';
const HOSTS=new Set(['generativelanguage.googleapis.com','dashscope-intl.aliyuncs.com','dashscope.aliyuncs.com','token-plan.ap-southeast-1.maas.aliyuncs.com']);
export function isStrictCloudEndpoint(raw){try{const u=new URL(raw);return u.protocol==='https:'&&HOSTS.has(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
function canonical(v){if(Array.isArray(v))return v.map(canonical);return v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
function equalArgs(a,b){try{return JSON.stringify(canonical(JSON.parse(a)))===JSON.stringify(canonical(JSON.parse(b)));}catch{return a===b;}}
function getEntry(id,scope,store){
  const item=store[id];
  if(!item||item.scope!==scope)throw new ProviderError('CLOUD_TOOL_STATE_MISSING_OR_WRONG_PROVIDER',409);
  return item;
}
function restoreMessages(messages,scope,store){
  return messages.map(m=>{
    if(m.role==='tool'&&m.tool_call_id?.startsWith('odm_vendor_'))return {...m,tool_call_id:getEntry(m.tool_call_id,scope,store).call.id};
    if(m.role!=='assistant'||!Array.isArray(m.tool_calls))return m;
    let extra={};
    const calls=m.tool_calls.map(c=>{
      if(!c.id?.startsWith('odm_vendor_'))return c;
      const item=getEntry(c.id,scope,store);
      if(item.call.function.name!==c.function?.name||!equalArgs(item.call.function.arguments,c.function?.arguments))throw new ProviderError('CLOUD_TOOL_HISTORY_CHANGED',409);
      extra=item.extra;
      return item.call;
    });
    return {...m,...extra,tool_calls:calls};
  });
}
export async function requestCloudCompletion(target,messages,options={},dependencies={}){
  if(!isStrictCloudEndpoint(target.baseUrl))throw new ProviderError('UNSUPPORTED_STRICT_CLOUD_ENDPOINT');
  if(!target.apiKey)throw new ProviderError('API_KEY_REQUIRED',401);
  const endpoint=chatUrl(target.baseUrl);
  const scope=createHash('sha256').update(endpoint+'\n'+target.model+'\n'+target.apiKey).digest('hex');
  const read=dependencies.read??(()=>({})),write=dependencies.write??(()=>{}),fetchImpl=dependencies.fetchImpl??fetch;
  const prior=read();const stored=prior&&typeof prior==='object'&&!Array.isArray(prior)?prior:{};
  const body={model:target.model,messages:restoreMessages(messages,scope,stored),stream:false,max_tokens:options.maxOutputTokens??16384};
  if(options.temperature!==undefined)body.temperature=options.temperature;
  if(options.top_p!==undefined)body.top_p=options.top_p;
  if(options.tools?.length){body.tools=options.tools;body.tool_choice=options.toolChoice??'auto';}
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${target.apiKey}`},body:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs??180000)});
  if(!response.ok)throw new ProviderError(response.status===401||response.status===403?'CLOUD_AUTHENTICATION_FAILED':response.status===429?'CLOUD_RATE_LIMIT':`CLOUD_HTTP_${response.status}`,response.status>=400&&response.status<=599?response.status:502);
  const raw=(await response.json()).choices?.[0]?.message;
  if(!raw||typeof raw!=='object')throw new ProviderError('INVALID_CLOUD_RESPONSE',502);
  const message={content:typeof raw.content==='string'?raw.content:''};
  if(Array.isArray(raw.tool_calls)&&raw.tool_calls.length){
    const extra={};for(const key of ['reasoning_content','extra_content'])if(raw[key]!==undefined)extra[key]=raw[key];
    const additions={};
    message.tool_calls=raw.tool_calls.map(call=>{
      if(call.type!=='function'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')throw new ProviderError('INVALID_CLOUD_TOOL_CALL',502);
      const id='odm_vendor_'+randomUUID();
      additions[id]={scope,at:Date.now(),call:{...call,id:call.id||id},extra};
      return {id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}};
    });
    // Re-read after the await so simultaneous campaigns cannot lose each other's metadata.
    const fresh={...read(),...additions};const cutoff=Date.now()-7*24*60*60*1000;
    const entries=Object.entries(fresh).filter(([,item])=>item&&item.at>=cutoff).sort((a,b)=>b[1].at-a[1].at).slice(0,1024);
    write(Object.fromEntries(entries));
  }
  if(message.content&&options.onDelta)options.onDelta(message.content);
  return {message};
}
