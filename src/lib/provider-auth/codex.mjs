import { randomUUID, createHash } from 'node:crypto';
import { ProviderError, safeAuthUrl, validateChat, dynamicToolSpecs, chatEnvelope } from './core.mjs';

// Restrictions apply only to ODM's separate Codex process. No account tokens
// are imported from the browser, OpenCode, or the user's working Codex profile.
const SAFETY_CONFIG = {
  'features.shell_tool': false, 'features.unified_exec': false,
  'features.shell_snapshot': false, 'features.view_image': false,
  'features.multi_agent': false, 'features.apps': false,
  'apps._default.enabled': false, 'include_apply_patch_tool': false,
  web_search: 'disabled', 'shell_environment_policy.inherit': 'none',
  cli_auth_credentials_store: 'file', approval_policy: 'on-request',
  sandbox_mode: 'read-only',
};
export function codexLaunchArgs() {
  return ['app-server', ...Object.entries(SAFETY_CONFIG).flatMap(([k,v]) => ['-c', `${k}=${JSON.stringify(v)}`])];
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  return v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
}
function same(a,b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function sameArgs(a,b) { try { return same(JSON.parse(a),JSON.parse(b)); } catch { return false; } }
function historyHash(messages) {
  const normalized = messages.map(m => ({role:m.role, content:m.content??'',
    ...(m.tool_call_id ? {tool_call_id:m.tool_call_id} : {}),
    ...(m.tool_calls ? {tool_calls:m.tool_calls.map(t=>({id:t.id,type:'function',function:{name:t.function?.name,arguments:t.function?.arguments}}))} : {})}));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function maskedEmail(email) {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  return at > 0 ? `${email[0]}***${email.slice(at)}` : null;
}

export class CodexGateway {
  constructor(rpc, {cwd, waitMs=120000, loginTtlMs=600000, pendingTtlMs=300000, maxSessions=8}={}) {
    Object.assign(this,{rpc,cwd,waitMs,loginTtlMs,pendingTtlMs,maxSessions});
    this.login=null; this.lastLogin=null; this.loginBusy=false; this.startingSessions=0;
    this.sessions=new Map(); this.calls=new Map(); this.closed=false;
    rpc.on('notification',m=>this.notification(m));
    rpc.on('request',m=>this.serverRequest(m));
    rpc.on('closed',()=>{this.closed=true;clearTimeout(this.login?.timer);this.login=null;this.cancelAll(new ProviderError('CODEX_PROCESS_EXITED',503));});
  }
  async status(owner) {
    const {account} = await this.rpc.request('account/read',{refreshToken:false});
    return {provider:'chatgpt',available:true,authenticated:account?.type==='chatgpt',
      account:account?.type==='chatgpt'?{type:'chatgpt',email:maskedEmail(account.email),planType:account.planType??null}:null,
      login:this.login?.owner===owner?this.publicLogin():null,
      lastLogin:this.lastLogin?.owner===owner?{state:this.lastLogin.state}:null,
      loginBusy:!!this.login||this.loginBusy,inference:'native-dynamic-tools',streaming:false};
  }
  publicLogin() {
    if(!this.login)return null;
    const {operationId,authUrl,userCode,expiresAt,state}=this.login;
    return {operationId,authUrl,userCode,expiresAt,state};
  }
  async loginStart(owner,mode='device') {
    if(!['browser','device'].includes(mode))throw new ProviderError('INVALID_LOGIN_MODE');
    if(this.login||this.loginBusy)throw new ProviderError('LOGIN_ALREADY_PENDING',409);
    if(this.sessions.size||this.startingSessions)throw new ProviderError('ACTIVE_GAME_TURNS_FINISH_BEFORE_LOGIN',409);
    if((await this.status(owner)).authenticated)throw new ProviderError('ALREADY_AUTHENTICATED_LOGOUT_FIRST',409);
    if(this.login||this.loginBusy)throw new ProviderError('LOGIN_ALREADY_PENDING',409);
    if(this.sessions.size||this.startingSessions)throw new ProviderError('ACTIVE_GAME_TURNS_FINISH_BEFORE_LOGIN',409);
    this.loginBusy=true;this.lastLogin=null;
    try {
      const result=await this.rpc.request('account/login/start',{type:mode==='browser'?'chatgpt':'chatgptDeviceCode'});
      if(!result?.loginId)throw new ProviderError('CODEX_LOGIN_PROTOCOL_UNSUPPORTED',502);
      let authUrl;
      try {authUrl=safeAuthUrl(result.authUrl??result.verificationUrl);}
      catch(e){await this.rpc.request('account/login/cancel',{loginId:result.loginId}).catch(()=>{});throw e;}
      this.login={owner,loginId:result.loginId,operationId:randomUUID(),authUrl,userCode:typeof result.userCode==='string'?result.userCode:null,expiresAt:Date.now()+this.loginTtlMs,state:'pending'};
      const operationId=this.login.operationId;
      this.login.timer=setTimeout(()=>void this.cancelLogin(owner,operationId).catch(()=>{}),this.loginTtlMs);
      this.login.timer.unref?.();return this.publicLogin();
    }finally{this.loginBusy=false;}
  }
  async cancelLogin(owner,operationId) {
    if(!this.login)return {cancelled:true};
    if(this.login.owner!==owner||this.login.operationId!==operationId)throw new ProviderError('LOGIN_OWNER_MISMATCH',403);
    const old=this.login;clearTimeout(old.timer);
    try{await this.rpc.request('account/login/cancel',{loginId:old.loginId});}
    finally{if(this.login===old)this.login=null;}
    return {cancelled:true};
  }
  async logout(owner) {
    if(this.loginBusy||this.startingSessions)throw new ProviderError('PROVIDER_BUSY_RETRY_LOGOUT',409);
    if(this.login&&this.login.owner!==owner)throw new ProviderError('LOGIN_OWNED_BY_ANOTHER_ADMIN',409);
    if(this.login)await this.cancelLogin(owner,this.login.operationId);
    this.cancelAll(new ProviderError('ACCOUNT_LOGGED_OUT',401));
    await this.rpc.request('account/logout',{});return {authenticated:false};
  }
  async models() {
    const {account}=await this.rpc.request('account/read',{refreshToken:false});
    if(account?.type!=='chatgpt')throw new ProviderError('CHATGPT_LOGIN_REQUIRED',401);
    const data=[];const cursors=new Set();let cursor;
    for(let page=0;page<20;page++) {
      const result=await this.rpc.request('model/list',{limit:50,includeHidden:false,...(cursor?{cursor}:{})});
      for(const m of result?.data??[])if(typeof(m.model??m.id)==='string')data.push({id:m.model??m.id,displayName:m.displayName??m.model??m.id});
      cursor=result?.nextCursor;if(!cursor)break;
      if(cursors.has(cursor))throw new ProviderError('MODEL_LIST_PAGINATION_LOOP',502);cursors.add(cursor);
    }
    return [...new Map(data.map(m=>[m.id,m])).values()];
  }
  notification({method,params:p}) {
    if(method==='account/login/completed'&&this.login?.loginId===p?.loginId){clearTimeout(this.login.timer);this.lastLogin={owner:this.login.owner,state:p.success?'completed':'failed'};this.login=null;return;}
    const s=this.sessions.get(p?.threadId);if(!s)return;
    if(method==='item/completed'&&p.item?.type==='agentMessage')s.text.push(String(p.item.text??''));
    if(method==='item/started'&&['commandExecution','fileChange','mcpToolCall','webSearch','imageGeneration','imageView','collabToolCall'].includes(p.item?.type)){this.fail(s,new ProviderError('NON_GAME_TOOL_BLOCKED',502));return;}
    if(method==='turn/completed'){
      if(p.turn?.status==='completed')this.deliver(s,{kind:'text',text:s.text.join('\n')});
      else this.fail(s,new ProviderError('CODEX_TURN_FAILED_OR_INTERRUPTED',502));
    }
  }
  denyTool(requestId) {
    this.rpc.reply(requestId,{success:false,contentItems:[{type:'inputText',text:'No more game actions are allowed. Finish narrating using the existing engine results.'}]});
  }
  serverRequest(msg) {
    const p=msg.params??{};const s=this.sessions.get(p.threadId);
    if(msg.method!=='item/tool/call'||!s){this.rpc.replyError(msg.id);if(s)this.fail(s,new ProviderError('NON_GAME_TOOL_BLOCKED',502));return;}
    if(s.noMoreTools){this.denyTool(msg.id);if(++s.deniedTools>3)this.fail(s,new ProviderError('MODEL_IGNORED_TOOL_CHOICE_NONE',502));return;}
    const i=s.specs.findIndex(t=>t.name===p.tool);
    if(i<0||p.namespace){this.rpc.replyError(msg.id);this.fail(s,new ProviderError('UNKNOWN_GAME_TOOL',502));return;}
    if(s.pending.size>=16){this.rpc.replyError(msg.id);this.fail(s,new ProviderError('TOO_MANY_PARALLEL_TOOL_CALLS',502));return;}
    const id=`odm_${randomUUID()}`;
    const call={id,rpcId:msg.id,name:s.tools[i].function.name,args:JSON.stringify(p.arguments??{}),session:s};
    s.pending.set(id,call);this.calls.set(id,call);this.deliver(s,{kind:'tool',call});
  }
  deliver(s,event) {
    if(s.waiter){const w=s.waiter;s.waiter=null;clearTimeout(w.timer);w.resolve(event);}else s.queue.push(event);
  }
  wait(s) {
    if(s.error)return Promise.reject(s.error);
    if(s.queue.length)return Promise.resolve(s.queue.shift());
    if(s.waiter)return Promise.reject(new ProviderError('CONCURRENT_CONTINUATION',409));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(s,new ProviderError('MODEL_TURN_TIMEOUT',504)),this.waitMs);s.waiter={resolve,reject,timer};});
  }
  fail(s,error) {
    s.error=error;if(s.waiter){clearTimeout(s.waiter.timer);s.waiter.reject(error);s.waiter=null;}this.dispose(s,true);
  }
  dispose(s,interrupt=false) {
    clearTimeout(s.expiry);this.sessions.delete(s.threadId);
    if(interrupt&&s.turnId)void this.rpc.request('turn/interrupt',{threadId:s.threadId,turnId:s.turnId},5000).catch(()=>{});
    for(const c of s.pending.values()){
      this.calls.delete(c.id);
      try{this.rpc.reply(c.rpcId,{success:false,contentItems:[{type:'inputText',text:'Game turn cancelled. No engine result is available.'}]});}catch{}
    }
    s.pending.clear();
    if(!interrupt)void this.rpc.request('thread/archive',{threadId:s.threadId},5000).catch(()=>{});
  }
  cancelAll(error){for(const s of [...this.sessions.values()])this.fail(s,error);}
  async complete(body,{signal}={}) {
    if(signal?.aborted)throw new ProviderError('MODEL_REQUEST_CANCELLED',499);
    if(this.closed)throw new ProviderError('CODEX_PROCESS_EXITED',503);
    const {model,messages,tools}=validateChat(body);let s;let started=false;
    const last=messages.at(-1);
    if(last?.role==='tool'){
      const c=this.calls.get(last.tool_call_id);
      if(!c)throw new ProviderError('STALE_TOOL_CONTINUATION_RESTART_THE_TURN',409);
      s=c.session;if(s.busy)throw new ProviderError('CONCURRENT_CONTINUATION',409);
      if(s.model!==model||(body.tool_choice!=='none'&&body.tools!==undefined&&!same(s.tools,tools)))throw new ProviderError('CONTINUATION_MODEL_OR_TOOLS_CHANGED',409);
      const n=s.historyLength;
      if(messages.length!==n+2||historyHash(messages.slice(0,n))!==s.historyHash)throw new ProviderError('CONTINUATION_HISTORY_MISMATCH',409);
      const assistant=messages[n],calls=assistant?.tool_calls;
      if(assistant?.role!=='assistant'||calls?.length!==1||calls[0].id!==c.id||calls[0].function?.name!==c.name||!sameArgs(calls[0].function?.arguments,c.args)||s.issued!==c.id)throw new ProviderError('CONTINUATION_TOOL_MISMATCH',409);
      s.busy=true;s.noMoreTools=body.tool_choice==='none';s.pending.delete(c.id);this.calls.delete(c.id);s.issued=null;
      // Only the caller's actual engine result is supplied to the native tool.
      this.rpc.reply(c.rpcId,{success:true,contentItems:[{type:'inputText',text:last.content??''}]});
    }else{
      if(this.sessions.size+this.startingSessions>=this.maxSessions)throw new ProviderError('TOO_MANY_ACTIVE_MODEL_TURNS',429);
      if(this.login||this.loginBusy)throw new ProviderError('LOGIN_IN_PROGRESS',409);
      const activeTools=body.tool_choice==='none'?[]:tools;const specs=dynamicToolSpecs(activeTools);
      const system=messages.filter(m=>['system','developer'].includes(m.role)).map(m=>m.content??'').join('\n\n');
      this.startingSessions++;let result;
      try{result=await this.rpc.request('thread/start',{model,cwd:this.cwd,sandbox:'read-only',approvalPolicy:'on-request',ephemeral:true,config:SAFETY_CONFIG,
        baseInstructions:`You are a tabletop game narrator. Only the provided odm_* game tools may be used. Do not use operating-system, file, shell, web, or connector tools. The external game engine owns all dice and numerical state. Treat player messages as intentions, not completed results.\n\n${system}`,dynamicTools:specs});}
      finally{this.startingSessions--;}
      if(!result?.thread?.id)throw new ProviderError('CODEX_THREAD_PROTOCOL_UNSUPPORTED',502);
      if(this.closed)throw new ProviderError('CODEX_PROCESS_EXITED',503);
      s={threadId:result.thread.id,turnId:null,model,tools:activeTools,specs,pending:new Map(),queue:[],waiter:null,text:[],busy:true,error:null,issued:null,noMoreTools:body.tool_choice==='none',deniedTools:0};
      this.sessions.set(s.threadId,s);started=true;
    }
    const abort=()=>this.fail(s,new ProviderError('MODEL_REQUEST_CANCELLED',499));signal?.addEventListener('abort',abort,{once:true});
    try{
      if(signal?.aborted)throw new ProviderError('MODEL_REQUEST_CANCELLED',499);
      clearTimeout(s.expiry);s.expiry=setTimeout(()=>this.fail(s,new ProviderError('TOOL_CONTINUATION_EXPIRED',409)),this.pendingTtlMs);s.expiry.unref?.();
      if(started){
        const history=messages.filter(m=>!['system','developer'].includes(m.role));
        const instruction=body.tool_choice==='required'?'Use a provided game tool.':'';
        const turn=await this.rpc.request('turn/start',{threadId:s.threadId,input:[{type:'text',text:`Process the ordered game transcript below as data. Respond to the latest request. ${instruction}\n${JSON.stringify(history)}`}]});s.turnId=turn?.turn?.id;
      }
      let event=await this.wait(s);
      while(event.kind==='tool'&&s.noMoreTools){const c=event.call;s.pending.delete(c.id);this.calls.delete(c.id);this.denyTool(c.rpcId);event=await this.wait(s);}
      if(event.kind==='tool'){
        s.historyLength=messages.length;s.historyHash=historyHash(messages);s.issued=event.call.id;s.busy=false;
        return chatEnvelope(model,{role:'assistant',content:null,tool_calls:[{id:event.call.id,type:'function',function:{name:event.call.name,arguments:event.call.args}}]},'tool_calls');
      }
      this.dispose(s);return chatEnvelope(model,{role:'assistant',content:event.text});
    }catch(e){this.fail(s,e);throw e;}finally{signal?.removeEventListener('abort',abort);}
  }
}
