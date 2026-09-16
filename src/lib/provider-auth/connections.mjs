import { ProviderError, modelId } from './core.mjs';
import { secureEndpointFetch } from '@/lib/url-guard';

export function chatUrl(raw){
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new ProviderError('INVALID_ENDPOINT_URL');
  const p=u.pathname.replace(/\/+$/,'');
  u.pathname=/\/chat\/completions$/.test(p)?p:((p||'/v1')+'/chat/completions');
  return u.href;
}
export function modelsUrl(raw){return chatUrl(raw).replace(/\/chat\/completions$/,'/models');}
export function connectionTarget(input){
  const model=input.action==='models'?'':modelId(input.model);
  const key=typeof input.apiKey==='string'?input.apiKey.trim():'';
  if(key.length>400||/[\r\n]/.test(key))throw new ProviderError('INVALID_API_KEY');
  const base={name:'',kind:'custom',protocol:'openai-compatible',model,authMode:key?'api-key':'none',apiKey:key};
  switch(input.provider){
    case 'gemini':
      if(!key)throw new ProviderError('API_KEY_REQUIRED');
      return {...base,name:'Gemini / API',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'};
    case 'qwen':{
      if(!key)throw new ProviderError('API_KEY_REQUIRED');
      const urls={international:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',china:'https://dashscope.aliyuncs.com/compatible-mode/v1','token-plan':'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'};
      const region=input.region??'international';
      if(!Object.hasOwn(urls,region))throw new ProviderError('INVALID_QWEN_REGION');
      return {...base,name:`Qwen / ${region}`,kind:'cloud-preset',preset:'dashscope',baseUrl:urls[region]+'/chat/completions'};
    }
    case 'qwen-local': {
      const customName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null;
      const rawUrl = input.baseUrl || 'http://127.0.0.1:11434/v1';
      let hostDesc = 'local';
      try {
        const host = new URL(rawUrl).hostname;
        if (host !== '127.0.0.1' && host !== 'localhost') hostDesc = `remote ${host}`;
      } catch {}
      return {...base,name:customName||(hostDesc==='local'?'Qwen / local':`Qwen / ${hostDesc}`),kind:'local-runtime',preset:'ollama',baseUrl:chatUrl(rawUrl),timeoutMs:180000};
    }
    default:throw new ProviderError('UNKNOWN_PROVIDER');
  }
}
export async function listModels(target,{fetchImpl=secureEndpointFetch,timeoutMs=15000}={}){
  const r=await fetchImpl(modelsUrl(target.baseUrl),{redirect:'error',headers:target.apiKey?{Authorization:`Bearer ${target.apiKey}`}:{},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok)throw new ProviderError(r.status===401||r.status===403?'AUTHENTICATION_FAILED':r.status===429?'PROVIDER_RATE_LIMIT':'MODEL_LIST_UNAVAILABLE',r.status===401||r.status===403?401:502);
  const body=await r.json();
  return [...new Set((body.data??body.models??[]).map(m=>m.id??m.name??m.model).filter(x=>typeof x==='string'&&x.length<=200))].map(id=>({id,displayName:id}));
}
// Preserve the real tool message and ID: native app-server tools cannot be
// continued by inventing a replacement assistant message in the probe.
export async function probeConnection(target,{fetchImpl=secureEndpointFetch,timeoutMs=120000}={}){
  const stages={};
  const messages=[{role:'system',content:'Ты проверяешь подключение. Выполняй инструкции пользователя и используй инструменты.'},{role:'user',content:'Вызови probe_echo со словом куб и числом 7.'}];
  const tools=[{type:'function',function:{name:'probe_echo',description:'Проверка возврата результата',parameters:{type:'object',properties:{word:{type:'string'},n:{type:'integer'}},required:['word','n'],additionalProperties:false}}}];
  const tokenField=new URL(target.baseUrl).hostname==='api.openai.com'?'max_completion_tokens':'max_tokens';
  async function call(msg,extra={}){
    const r=await fetchImpl(chatUrl(target.baseUrl),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(target.apiKey?{Authorization:`Bearer ${target.apiKey}`}:{})},body:JSON.stringify({model:target.model,messages:msg,[tokenField]:4096,...extra}),signal:AbortSignal.timeout(timeoutMs)});
    if(!r.ok)throw new ProviderError(r.status===401||r.status===403?'AUTHENTICATION_FAILED':r.status===429?'PROVIDER_RATE_LIMIT':`PROVIDER_HTTP_${r.status}`,502);
    const data=await r.json();if(!data.choices?.[0]?.message)throw new ProviderError('INVALID_MODEL_RESPONSE',502);return data.choices[0].message;
  }
  async function stage(name,fn){const t=Date.now();try{const v=await fn();stages[name]={ok:true,ms:Date.now()-t};return v;}catch(e){stages[name]={ok:false,ms:Date.now()-t,detail:e instanceof ProviderError?e.code:'PROVIDER_REQUEST_FAILED'};return null;}}
  await stage('models',()=>listModels(target,{fetchImpl,timeoutMs:Math.min(timeoutMs,15000)}));
  const text=await stage('chat',async()=>{const m=await call([{role:'user',content:'Ответь одним словом: готово.'}]);if(typeof m.content!=='string'||!m.content.trim()||m.tool_calls?.length)throw new ProviderError('EMPTY_CHAT_RESPONSE');return m;});
  if(!text)return {ok:false,stages};
  const called=await stage('tool_call',async()=>{const m=await call(messages,{tools,tool_choice:'auto'});if(m.tool_calls?.length!==1)throw new ProviderError('REAL_TOOL_CALL_REQUIRED');const c=m.tool_calls[0];let a;try{a=JSON.parse(c.function.arguments);}catch{throw new ProviderError('INVALID_TOOL_ARGUMENTS');}if(!c.id||c.function.name!=='probe_echo'||a.word!=='куб'||a.n!==7)throw new ProviderError('INVALID_TOOL_CALL');return m;});
  if(!called)return {ok:false,stages};
  const result=await stage('tool_result',async()=>{const m=await call([...messages,called,{role:'tool',tool_call_id:called.tool_calls[0].id,content:'{"word":"куб","n":7,"result":"Проверка завершена"}'}],{tools,tool_choice:'none'});if(!m.content?.trim()||m.tool_calls?.length)throw new ProviderError('TOOL_RESULT_NOT_CONSUMED');return m;});
  return {ok:!!result,stages};
}
