import { authRoot, codexEnvironment, readOrCreateSecret } from './storage.mjs';
import { CodexRpc } from './rpc.mjs';
import { CodexGateway, codexLaunchArgs } from './codex.mjs';
import { ProviderError, equalSecret, loopbackOrigin } from './core.mjs';
const globalKey=Symbol.for('odm.provider-auth.service.v1');
export function providerState(){
  if(!globalThis[globalKey]){
    const root=authRoot();
    globalThis[globalKey]={root,controlKey:readOrCreateSecret(root,'control.key'),bridgeKey:readOrCreateSecret(root,'inference.key'),gateway:null,starting:null};
  }
  return globalThis[globalKey];
}
export async function gateway(){
  const state=providerState();
  if(state.gateway&&!state.gateway.closed)return state.gateway;
  if(state.starting)return state.starting;
  state.starting=(async()=>{
    const {env,cwd}=codexEnvironment(state.root);
    const command=process.env.ODM_CODEX_BINARY||'codex';
    // Executable is trusted server configuration, never a request parameter.
    const script=/\.m?js$/i.test(command);
    const rpc=new CodexRpc({command:script?process.execPath:command,args:script?[command,...codexLaunchArgs()]:codexLaunchArgs(),env,cwd});
    try{await rpc.initialize();}catch(error){rpc.close();throw error;}
    state.gateway=new CodexGateway(rpc,{cwd});return state.gateway;
  })();
  try{return await state.starting;}finally{state.starting=null;}
}
export function verifyLocalControl(request){
  return !request.headers.get('origin')&&equalSecret(providerState().controlKey,request.headers.get('authorization')?.replace(/^Bearer /,''));
}
export function verifyInference(request){
  return !request.headers.get('origin')&&equalSecret(providerState().bridgeKey,request.headers.get('authorization')?.replace(/^Bearer /,''));
}
export function bridgeProfile(model,requestOrigin){
  const port=requestOrigin?new URL(requestOrigin).port:process.env.PORT;
  const origin=loopbackOrigin(process.env.ODM_LOCAL_ORIGIN||`http://127.0.0.1:${port||3000}`);
  return {name:'ChatGPT / Codex',kind:'custom',protocol:'openai-compatible',baseUrl:`${origin}/api/internal/codex/v1/chat/completions`,model,authMode:'api-key',apiKey:providerState().bridgeKey,thinking:'auto',timeoutMs:180000};
}
export async function authAction(owner,input){
  if(input?.provider!=='chatgpt')throw new ProviderError('BROWSER_AUTH_ONLY_AVAILABLE_FOR_CHATGPT');
  let client;
  try{client=await gateway();}catch(error){
    if(input.action==='status')return {provider:'chatgpt',available:false,authenticated:false,error:error instanceof ProviderError?error.code:'CODEX_UNAVAILABLE'};
    throw error;
  }
  switch(input.action){
    case 'status':return client.status(owner);
    case 'login':return client.loginStart(owner,input.mode??'device');
    case 'cancel':return client.cancelLogin(owner,input.operationId);
    case 'logout':return client.logout(owner);
    case 'models':return {models:await client.models()};
    default:throw new ProviderError('UNKNOWN_AUTH_ACTION');
  }
}
